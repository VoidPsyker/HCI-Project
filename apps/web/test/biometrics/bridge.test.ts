import { describe, expect, it } from "vitest";
import { BRIDGE_PROTOCOL_VERSION } from "@meridian/analysis";
import type { GazeSample } from "@meridian/analysis";
import { WebSocketGazeSource } from "../../src/biometrics/bridge";
import type { WebSocketLike } from "../../src/biometrics/bridge";
import { grantGazeConsent } from "../../src/biometrics/consent";

const consent = () =>
  grantGazeConsent({
    participant_id: "P001",
    session_id: "S001",
    version: "eye-1",
    camera_used: false,
    granted_at: "2026-10-24T10:00:00.000Z"
  });

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value: unknown): void {
    this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) });
  }
  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map((item) => JSON.parse(item) as Record<string, unknown>);
  }
}

const HELLO = {
  type: "hello",
  protocol: BRIDGE_PROTOCOL_VERSION,
  participant_id: "P001",
  session_id: "S001",
  source: "tobii-bridge",
  device: "Tobii Pro Fusion",
  nominal_hz: 120,
  viewport: { width_px: 1000, height_px: 1000 },
  device_clock: { method: "tobii-dual-timestamp", residual_ms: 0.4 }
};

function makeSource(options: { now?: () => number; url?: string } = {}) {
  let socket: FakeSocket | null = null;
  let creates = 0;
  const source = new WebSocketGazeSource({
    url: options.url ?? "ws://127.0.0.1:8765/gaze",
    participant_id: "P001",
    session_id: "S001",
    viewport: () => ({ width_px: 1000, height_px: 1000 }),
    now: options.now ?? (() => 1000),
    createSocket: () => {
      creates += 1;
      socket = new FakeSocket();
      return socket;
    },
    pingIntervalMs: 0,
    syncTimeoutMs: 60_000
  });
  return {
    source,
    socket: () => {
      if (!socket) throw new Error("socket_not_created");
      return socket;
    },
    creates: () => creates
  };
}

function sync(source: WebSocketGazeSource, socket: FakeSocket, getNow: () => number, setNow: (value: number) => void): void {
  for (let index = 0; index < 3; index += 1) {
    const t0 = getNow();
    source.sendPing();
    const pings = socket.sentJson().filter((message) => message.type === "ping");
    const ping = pings[pings.length - 1]!;
    setNow(t0 + 10);
    const sourceMid = 5000 + (t0 - 1000) + 2;
    socket.message({
      type: "pong",
      id: ping.id,
      t_bridge_recv_ms: sourceMid,
      t_bridge_send_ms: sourceMid + 3
    });
  }
}

describe("WebSocketGazeSource", () => {
  it("requires consent before creating a socket", async () => {
    const { source, creates } = makeSource();
    await expect(source.start(null)).rejects.toThrow("gaze_consent_required");
    expect(creates()).toBe(0);
  });

  it("refuses a remote bridge URL before creating a socket", async () => {
    const { source, creates } = makeSource({ url: "wss://gaze.example.com/collect" });
    await expect(source.start(consent())).rejects.toThrow("bridge_url_not_loopback");
    expect(creates()).toBe(0);
  });

  it("refuses credentials or unsafe schemes in the bridge URL", async () => {
    const credentialed = makeSource({ url: "ws://user:pass@127.0.0.1:8765/gaze" });
    await expect(credentialed.source.start(consent())).rejects.toThrow("bridge_url_credentials_forbidden");
    expect(credentialed.creates()).toBe(0);
    const unsafe = makeSource({ url: "https://127.0.0.1:8765/gaze" });
    await expect(unsafe.source.start(consent())).rejects.toThrow("bridge_url_scheme_invalid");
    expect(unsafe.creates()).toBe(0);
  });

  it("syncs the bridge clock, buffers then flushes samples", async () => {
    let now = 1000;
    const { source, socket } = makeSource({ now: () => now });
    const samples: GazeSample[] = [];
    source.subscribe((sample) => samples.push(sample));
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message(HELLO);
    expect(source.info).toMatchObject({ kind: "hardware", device: "Tobii Pro Fusion", nominal_hz: 120 });
    ws.message({ type: "sample", seq: 1, t_bridge_ms: 6000, t_device_ms: 6001, x_px: 500, y_px: 500 });
    expect(samples).toHaveLength(0);
    sync(source, ws, () => now, (value) => {
      now = value;
    });
    expect(source.clock.synchronized).toBe(true);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ seq: 1, x_px: 500, y_px: 500, valid: true, t_source_ms: 6001 });
    ws.message({ type: "sample", seq: 2, t_bridge_ms: 6100, x_px: 510, y_px: 510 });
    expect(samples).toHaveLength(2);
    await source.stop();
    expect(ws.closeCalls).toBe(1);
  });

  it("rejects a viewport mismatch before accepting samples", async () => {
    const { source, socket } = makeSource();
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message({ ...HELLO, viewport: { width_px: 800, height_px: 600 } });
    expect(source.status).toBe("error");
    expect(source.errorReason).toBe("bridge_viewport_mismatch");
  });

  it("refuses a bridge bound to another participant or session", async () => {
    const { source, socket } = makeSource();
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message({ ...HELLO, session_id: "other-session" });
    expect(source.status).toBe("error");
    expect(source.errorReason).toBe("bridge_session_mismatch");
  });

  it("refuses backwards device timestamps", async () => {
    let now = 1000;
    const { source, socket } = makeSource({ now: () => now });
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message(HELLO);
    sync(source, ws, () => now, (value) => {
      now = value;
    });
    ws.message({ type: "sample", seq: 1, t_bridge_ms: 6000, x_px: 500, y_px: 500 });
    ws.message({ type: "sample", seq: 2, t_bridge_ms: 5999, x_px: 500, y_px: 500 });
    expect(source.status).toBe("error");
    expect(source.errorReason).toBe("bridge_sample_time_backwards");
  });

  it("rejects media payloads outright", async () => {
    const { source, socket } = makeSource();
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message({ ...HELLO, video: "frame" });
    expect(source.status).toBe("error");
    expect(source.errorReason).toBe("bridge_forbidden_media_field_video");
  });

  it("rejects duplicate device sequence numbers", async () => {
    let now = 1000;
    const { source, socket } = makeSource({ now: () => now });
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message(HELLO);
    sync(source, ws, () => now, (value) => {
      now = value;
    });
    ws.message({ type: "sample", seq: 1, t_bridge_ms: 6000, x_px: 500, y_px: 500 });
    ws.message({ type: "sample", seq: 1, t_bridge_ms: 6010, x_px: 500, y_px: 500 });
    expect(source.status).toBe("error");
    expect(source.errorReason).toBe("bridge_sample_seq_duplicate");
  });

  it("marks out-of-bounds hardware samples invalid and honours pause/resume", async () => {
    let now = 1000;
    const { source, socket } = makeSource({ now: () => now });
    const samples: GazeSample[] = [];
    source.subscribe((sample) => samples.push(sample));
    await source.start(consent());
    const ws = socket();
    ws.open();
    ws.message(HELLO);
    sync(source, ws, () => now, (value) => {
      now = value;
    });
    ws.message({ type: "sample", seq: 1, t_bridge_ms: 6000, x_px: 2000, y_px: 500 });
    expect(samples[0]).toMatchObject({ valid: false, invalid_reason: "out_of_bounds" });
    await source.pause();
    ws.message({ type: "sample", seq: 2, t_bridge_ms: 6010, x_px: 500, y_px: 500 });
    expect(samples).toHaveLength(1);
    await source.resume();
    ws.message({ type: "sample", seq: 3, t_bridge_ms: 6020, x_px: 500, y_px: 500 });
    expect(samples).toHaveLength(2);
    expect(ws.sentJson().some((message) => message.type === "pause")).toBe(true);
    expect(ws.sentJson().some((message) => message.type === "resume")).toBe(true);
    await source.stop();
    expect(ws.sentJson().some((message) => message.type === "stop")).toBe(true);
    expect(source.status).toBe("stopped");
  });
});
