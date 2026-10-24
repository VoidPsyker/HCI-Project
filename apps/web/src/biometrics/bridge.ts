import type {
  ClockSyncReport,
  GazeConsent,
  GazeSample,
  GazeSampleListener,
  GazeSource,
  GazeSourceInfo,
  GazeSourceStatus,
  Viewport
} from "@meridian/analysis";
import { BRIDGE_PROTOCOL_VERSION, ClockSynchronizer, assertGazeConsent, pingPongEstimate } from "@meridian/analysis";

export interface BridgeHello {
  type: "hello";
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  participant_id: string;
  session_id: string;
  source: string;
  device: string;
  nominal_hz: number | null;
  viewport: Viewport;
  device_clock?: { method: string; residual_ms: number | null };
}

export interface BridgeSampleMessage {
  type: "sample";
  seq: number;
  t_bridge_ms: number;
  t_device_ms?: number | null;
  x_px: number | null;
  y_px: number | null;
  valid?: boolean;
  pupil_left_mm?: number | null;
  pupil_right_mm?: number | null;
}

export interface BridgePong {
  type: "pong";
  id: string;
  t_bridge_recv_ms: number;
  t_bridge_send_ms: number;
}

export type BridgeMessage = BridgeHello | BridgeSampleMessage | BridgePong;

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketGazeSourceOptions {
  url: string;
  participant_id: string;
  session_id: string;
  viewport: () => Viewport;
  createSocket?: WebSocketFactory;
  now?: () => number;
  pingIntervalMs?: number;
  syncTimeoutMs?: number;
  maxBufferedSamples?: number;
  onStatus?: (status: GazeSourceStatus) => void;
}

const OPEN = 1;

function defaultSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

/**
 * The bridge is a local device transport. Refuse any non-loopback destination
 * before a socket exists, so gaze/consent traffic cannot be sent off-host.
 */
function assertLocalBridgeUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("bridge_url_invalid");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("bridge_url_scheme_invalid");
  if (url.username || url.password) throw new Error("bridge_url_credentials_forbidden");
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new Error("bridge_url_not_loopback");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Generic local hardware bridge. The native process (Tobii Pro SDK, Gazepoint
 * Open Gaze API, etc.) owns the device and maps its clock to `t_bridge_ms`;
 * this browser source maps `t_bridge_ms` to the capture clock with NTP-style
 * ping/pong exchanges. No vendor dependency is embedded here.
 */
export class WebSocketGazeSource implements GazeSource {
  private readonly options: WebSocketGazeSourceOptions;
  private readonly clockSync = new ClockSynchronizer("ping_pong");
  private readonly listeners = new Set<GazeSampleListener>();
  private readonly pending: BridgeSampleMessage[] = [];
  private readonly pings = new Map<string, number>();
  private socket: WebSocketLike | null = null;
  private state: GazeSourceStatus = "idle";
  private seq = 0;
  private lastDeviceSeq = 0;
  private lastBridgeTime = -Infinity;
  private pingSeq = 0;
  private hello: BridgeHello | null = null;
  private intentionalStop = false;
  private paused = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private infoValue: GazeSourceInfo;
  private readonly now: () => number;

  constructor(options: WebSocketGazeSourceOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.infoValue = {
      kind: "hardware",
      adapter: "meridian.websocket-gaze/1",
      device: "unidentified local tracker",
      nominal_hz: null,
      hardware_backed: true,
      synthetic: false,
      capabilities: ["gaze", "device_clock"]
    };
  }

  get info(): GazeSourceInfo {
    return this.infoValue;
  }

  get status(): GazeSourceStatus {
    return this.state;
  }

  get clock(): ClockSyncReport {
    return this.clockSync.report();
  }

  get deviceClock(): { method: string; residual_ms: number | null } | null {
    return this.hello?.device_clock ?? null;
  }

  private setStatus(status: GazeSourceStatus): void {
    this.state = status;
    this.options.onStatus?.(status);
  }

  async start(consent: GazeConsent | null): Promise<void> {
    if (this.state === "running" || this.state === "starting") throw new Error("bridge_already_started");
    assertGazeConsent(consent);
    assertLocalBridgeUrl(this.options.url);
    this.intentionalStop = false;
    this.paused = false;
    this.clockSync.reset();
    this.pings.clear();
    this.pending.length = 0;
    this.hello = null;
    this.lastDeviceSeq = 0;
    this.lastBridgeTime = -Infinity;
    this.lastError = null;
    this.setStatus("starting");
    const factory = this.options.createSocket ?? defaultSocketFactory;
    let socket: WebSocketLike;
    try {
      socket = factory(this.options.url);
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.setStatus("running");
      this.sendPing();
      const interval = this.options.pingIntervalMs ?? 30_000;
      if (interval > 0) this.pingTimer = setInterval(() => this.sendPing(), interval);
      const timeout = this.options.syncTimeoutMs ?? 10_000;
      this.syncTimer = setTimeout(() => {
        if (!this.clock.synchronized) this.fail("bridge_clock_sync_timeout");
      }, timeout);
    };
    socket.onmessage = (event) => this.onMessage(event.data);
    socket.onerror = () => this.fail("bridge_socket_error");
    socket.onclose = () => {
      if (!this.intentionalStop) this.fail("bridge_socket_closed");
      else this.setStatus("stopped");
    };
  }

  private fail(reason: string): void {
    if (this.state === "error" || this.state === "stopped") return;
    this.setStatus("error");
    this.cleanupTimers();
    try {
      this.socket?.close();
    } catch {
      // Ignore teardown errors.
    }
    this.socket = null;
    this.lastError = reason;
  }

  private lastError: string | null = null;

  get errorReason(): string | null {
    return this.lastError;
  }

  private cleanupTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.pingTimer = null;
    this.syncTimer = null;
  }

  /** Public for deterministic tests and for an immediate post-connect sync. */
  sendPing(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    const sentAt = this.now();
    this.pingSeq += 1;
    const id = `ping-${this.pingSeq}-${sentAt}`;
    this.pings.set(id, sentAt);
    socket.send(JSON.stringify({ type: "ping", id }));
  }

  private validateNoMedia(message: Record<string, unknown>): boolean {
    for (const forbidden of ["image", "video", "frame", "raw_video", "face_image"]) {
      if (Object.prototype.hasOwnProperty.call(message, forbidden)) {
        this.fail(`bridge_forbidden_media_field_${forbidden}`);
        return false;
      }
    }
    return true;
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      this.fail("bridge_message_not_text");
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
      message = parsed;
    } catch {
      this.fail("bridge_message_invalid_json");
      return;
    }
    if (!this.validateNoMedia(message)) return;
    if (message.type === "hello") this.onHello(message);
    else if (message.type === "pong") this.onPong(message);
    else if (message.type === "sample") this.onSample(message);
    else this.fail("bridge_message_unknown_type");
  }

  private onHello(message: Record<string, unknown>): void {
    if (this.hello) return this.fail("bridge_hello_duplicate");
    const viewport = this.options.viewport();
    const declared = message.viewport;
    if (message.protocol !== BRIDGE_PROTOCOL_VERSION) return this.fail("bridge_protocol_mismatch");
    if (typeof message.source !== "string" || typeof message.device !== "string") return this.fail("bridge_hello_invalid");
    if (
      typeof message.participant_id !== "string" ||
      typeof message.session_id !== "string" ||
      message.participant_id !== this.options.participant_id ||
      message.session_id !== this.options.session_id
    ) {
      return this.fail("bridge_session_mismatch");
    }
    if (
      !isRecord(declared) ||
      declared.width_px !== viewport.width_px ||
      declared.height_px !== viewport.height_px
    ) {
      return this.fail("bridge_viewport_mismatch");
    }
    const nominal = message.nominal_hz;
    if (nominal !== null && (typeof nominal !== "number" || !Number.isFinite(nominal) || nominal <= 0)) {
      return this.fail("bridge_nominal_hz_invalid");
    }
    const deviceClock = message.device_clock;
    if (
      deviceClock !== undefined &&
      (!isRecord(deviceClock) ||
        typeof deviceClock.method !== "string" ||
        !(
          deviceClock.residual_ms === null ||
          (typeof deviceClock.residual_ms === "number" && Number.isFinite(deviceClock.residual_ms))
        ))
    ) {
      return this.fail("bridge_device_clock_invalid");
    }
    this.hello = {
      type: "hello",
      protocol: BRIDGE_PROTOCOL_VERSION,
      participant_id: String(message.participant_id),
      session_id: String(message.session_id),
      source: message.source,
      device: message.device,
      nominal_hz: nominal,
      viewport: { width_px: viewport.width_px, height_px: viewport.height_px },
      ...(isRecord(deviceClock)
        ? { device_clock: { method: String(deviceClock.method), residual_ms: deviceClock.residual_ms as number | null } }
        : {})
    };
    this.infoValue = {
      ...this.infoValue,
      adapter: message.source,
      device: message.device,
      nominal_hz: nominal,
      capabilities: [
        "gaze",
        "device_clock",
        ...(isRecord(deviceClock) ? (["screen_geometry"] as const) : [])
      ],
      notes: isRecord(deviceClock)
        ? `Device→bridge clock mapping: ${String(deviceClock.method)} (residual ${String(deviceClock.residual_ms)} ms).`
        : "Bridge did not declare a device→bridge clock mapping; raw device timestamps are retained."
    };
    this.tryFlush();
  }

  private onPong(message: Record<string, unknown>): void {
    if (typeof message.id !== "string") return this.fail("bridge_pong_invalid");
    const sentAt = this.pings.get(message.id);
    if (sentAt === undefined) return this.fail("bridge_pong_unknown_ping");
    const t1 = message.t_bridge_recv_ms;
    const t2 = message.t_bridge_send_ms;
    if (typeof t1 !== "number" || typeof t2 !== "number" || !Number.isFinite(t1) || !Number.isFinite(t2)) {
      return this.fail("bridge_pong_invalid");
    }
    const estimate = pingPongEstimate({
      t0_local_ms: sentAt,
      t1_source_ms: t1,
      t2_source_ms: t2,
      t3_local_ms: this.now()
    });
    this.clockSync.addPair(estimate.source_ms, estimate.local_ms, estimate.rtt_ms);
    this.pings.delete(message.id);
    if (this.clockSync.report().pairs >= 3) {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = null;
      this.setStatus("running");
      this.tryFlush();
    }
  }

  private tryFlush(): void {
    if (!this.hello || this.clockSync.report().pairs < 3) return;
    while (this.pending.length > 0) {
      const message = this.pending.shift()!;
      this.emitSample(message);
    }
  }

  private onSample(message: Record<string, unknown>): void {
    const seq = message.seq;
    const tBridge = message.t_bridge_ms;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq <= 0) return this.fail("bridge_sample_seq_invalid");
    if (typeof tBridge !== "number" || !Number.isFinite(tBridge)) return this.fail("bridge_sample_time_invalid");
    if (seq <= this.lastDeviceSeq) return this.fail("bridge_sample_seq_duplicate");
    if (tBridge <= this.lastBridgeTime) return this.fail("bridge_sample_time_backwards");
    this.lastDeviceSeq = seq;
    this.lastBridgeTime = tBridge;
    const x = message.x_px;
    const y = message.y_px;
    if (x !== null && (typeof x !== "number" || !Number.isFinite(x))) return this.fail("bridge_sample_x_invalid");
    if (y !== null && (typeof y !== "number" || !Number.isFinite(y))) return this.fail("bridge_sample_y_invalid");
    if ((x === null) !== (y === null)) return this.fail("bridge_sample_point_incomplete");
    if (message.t_device_ms !== undefined && message.t_device_ms !== null) {
      if (typeof message.t_device_ms !== "number" || !Number.isFinite(message.t_device_ms)) {
        return this.fail("bridge_sample_device_time_invalid");
      }
    }
    if (message.valid !== undefined && typeof message.valid !== "boolean") return this.fail("bridge_sample_valid_invalid");
    for (const pupil of [message.pupil_left_mm, message.pupil_right_mm]) {
      if (pupil !== undefined && pupil !== null && (typeof pupil !== "number" || !Number.isFinite(pupil) || pupil < 0)) {
        return this.fail("bridge_sample_pupil_invalid");
      }
    }
    const sample: BridgeSampleMessage = {
      type: "sample",
      seq,
      t_bridge_ms: tBridge,
      x_px: typeof x === "number" ? x : null,
      y_px: typeof y === "number" ? y : null,
      ...(typeof message.t_device_ms === "number" ? { t_device_ms: message.t_device_ms } : {}),
      ...(typeof message.valid === "boolean" ? { valid: message.valid } : {}),
      ...(typeof message.pupil_left_mm === "number" ? { pupil_left_mm: message.pupil_left_mm } : {}),
      ...(typeof message.pupil_right_mm === "number" ? { pupil_right_mm: message.pupil_right_mm } : {})
    };
    const maxBuffered = this.options.maxBufferedSamples ?? 5000;
    if (!this.hello || this.clockSync.report().pairs < 3) {
      if (this.pending.length >= maxBuffered) return this.fail("bridge_sample_buffer_overflow");
      this.pending.push(sample);
      return;
    }
    this.emitSample(sample);
  }

  private emitSample(message: BridgeSampleMessage): void {
    const viewport = this.options.viewport();
    const hasPoint = message.x_px !== null && message.y_px !== null;
    const inBounds =
      hasPoint &&
      message.x_px! >= 0 &&
      message.y_px! >= 0 &&
      message.x_px! <= viewport.width_px &&
      message.y_px! <= viewport.height_px;
    const valid = message.valid !== false && inBounds;
    const sample: GazeSample = {
      seq: ++this.seq,
      t_ms: this.clockSync.toLocal(message.t_bridge_ms),
      t_source_ms: message.t_device_ms ?? message.t_bridge_ms,
      x_px: message.x_px,
      y_px: message.y_px,
      valid,
      ...(valid
        ? {}
        : { invalid_reason: hasPoint && !inBounds ? ("out_of_bounds" as const) : ("no_prediction" as const) }),
      ...(message.pupil_left_mm === undefined ? {} : { pupil_left_mm: message.pupil_left_mm }),
      ...(message.pupil_right_mm === undefined ? {} : { pupil_right_mm: message.pupil_right_mm }),
      trial_id: null
    };
    if (this.paused) return;
    for (const listener of this.listeners) listener(sample);
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.cleanupTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: "stop" }));
      } catch {
        // Best effort.
      }
      try {
        socket.close();
      } catch {
        // Best effort.
      }
    }
    this.pending.length = 0;
    this.setStatus("stopped");
  }

  async pause(): Promise<void> {
    if (this.state !== "running") return;
    this.paused = true;
    this.sendControl("pause");
    this.setStatus("paused");
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    this.paused = false;
    this.sendControl("resume");
    this.setStatus("running");
  }

  private sendControl(type: "pause" | "resume"): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify({ type }));
  }

  subscribe(listener: GazeSampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
