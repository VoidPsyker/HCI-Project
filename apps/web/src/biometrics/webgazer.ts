import type {
  CalibrationTarget,
  ClockSyncReport,
  GazeConsent,
  GazeSample,
  GazeSampleListener,
  GazeSource,
  GazeSourceInfo,
  GazeSourceStatus,
  Viewport
} from "@meridian/analysis";
import { ClockSynchronizer, assertViewport } from "@meridian/analysis";
import { assertCameraConsent } from "./consent";
import type { WebGazerApi } from "./webgazerApi";

export interface WebGazerSourceOptions {
  participant_id: string;
  session_id: string;
  load: () => Promise<WebGazerApi>;
  viewport: () => Viewport;
  now?: () => number;
  mediaPipeSolutionPath?: string;
  calibrationRepetitions?: number;
  repetitionDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  onStatus?: (status: GazeSourceStatus) => void;
}

const DEFAULT_MEDIAPIPE_PATH = "/vendor/webgazer/mediapipe/face_mesh";

interface FrameGate {
  consumeDuplicate(): boolean;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

interface PresentedFrameMetadata {
  presentedFrames: number;
  mediaTime: number;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * WebGazer alerts on `http://127.0.0.1` because its check only accepts the
 * literal hostname `localhost`, although 127.0.0.1 is a secure context. Refuse
 * genuinely insecure origins and suppress that false-positive alert only on a
 * verified loopback origin, so `begin()` is not blocked by a modal dialog.
 */
function assertWebGazerContext(): void {
  const location = window.location;
  if (window.isSecureContext === false) throw new Error("webgazer_requires_secure_context");
  if (location.protocol !== "https:" && !isLoopbackHost(location.hostname)) {
    throw new Error("webgazer_requires_https_or_loopback");
  }
}

function beginWebGazer(api: WebGazerApi): Promise<unknown> {
  const location = window.location;
  const needsHttpsWorkaround =
    location.protocol !== "https:" &&
    location.hostname !== "localhost" &&
    Boolean((window as unknown as { chrome?: unknown }).chrome);
  if (!needsHttpsWorkaround) return Promise.resolve(api.begin());
  const originalAlert = window.alert;
  window.alert = () => undefined;
  try {
    return Promise.resolve(api.begin());
  } finally {
    window.alert = originalAlert;
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Webcam source backed by WebGazer. Camera access happens only in `start()`
 * after separate gaze + camera consent. Implicit click/cursor training is
 * removed so calibration is the controlled 9-point procedure; calibration
 * points are recorded explicitly via `recordCalibrationTarget`.
 */
export class WebGazerSource implements GazeSource {
  readonly info: GazeSourceInfo = {
    kind: "webcam",
    adapter: "webgazer@3.5.3",
    device: "browser-selected webcam",
    nominal_hz: null,
    hardware_backed: false,
    synthetic: false,
    capabilities: ["gaze"],
    notes: "Webcam gaze is lower quality than a dedicated 120 Hz tracker; measured error is reported, not assumed."
  };
  private readonly options: WebGazerSourceOptions;
  private readonly clockSync = new ClockSynchronizer("observed_arrival");
  private readonly listeners = new Set<GazeSampleListener>();
  private api: WebGazerApi | null = null;
  private state: GazeSourceStatus = "idle";
  private seq = 0;
  private viewport: Viewport = { width_px: 0, height_px: 0 };
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private generation = 0;
  private starting = false;
  private frameGate: FrameGate | null = null;

  constructor(options: WebGazerSourceOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.wait = options.wait ?? defaultWait;
  }

  get status(): GazeSourceStatus {
    return this.state;
  }

  get clock(): ClockSyncReport {
    return this.clockSync.report();
  }

  get cameraActive(): boolean {
    return this.api !== null && (this.state === "running" || this.state === "paused");
  }

  private setStatus(status: GazeSourceStatus): void {
    this.state = status;
    this.options.onStatus?.(status);
  }

  private isInterrupted(gen: number): boolean {
    return this.generation !== gen || this.state === "stopping" || this.state === "stopped";
  }

  async start(consent: GazeConsent | null): Promise<void> {
    if (this.starting || this.state === "running" || this.state === "starting") throw new Error("webgazer_already_started");
    assertCameraConsent(consent, this.options.participant_id, this.options.session_id);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("camera_unavailable");
    assertWebGazerContext();
    this.viewport = this.options.viewport();
    assertViewport(this.viewport);
    this.clockSync.reset();
    this.setStatus("starting");
    const currentGen = ++this.generation;
    this.starting = true;
    let api: WebGazerApi | null = null;
    try {
      api = await this.options.load();
      if (this.isInterrupted(currentGen)) {
        await this.releaseApi(api);
        return;
      }
      this.api = api;
      if (api.detectCompatibility && !api.detectCompatibility()) throw new Error("webgazer_incompatible");
      api.params.faceMeshSolutionPath = this.options.mediaPipeSolutionPath ?? DEFAULT_MEDIAPIPE_PATH;
      api.params.saveDataAcrossSessions = false;
      api.params.showVideo = false;
      api.params.showFaceOverlay = false;
      api.params.showFaceFeedbackBox = false;
      api.params.showGazeDot = false;
      api.params.applyKalmanFilter = true;
      api.params.storingPoints = false;
      await api.clearData();
      if (this.isInterrupted(currentGen)) {
        await this.releaseApi(api);
        return;
      }
      await beginWebGazer(api);
      if (this.isInterrupted(currentGen)) {
        await this.releaseApi(api);
        return;
      }
      api.removeMouseEventListeners?.();
      api.setGazeListener((data, elapsedTime) => this.onGaze(data, elapsedTime));
      this.installFrameGate(api);
      this.setStatus("running");
    } catch (error) {
      await this.releaseApi(api);
      if (this.isInterrupted(currentGen)) return;
      this.setStatus("error");
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private installFrameGate(api: WebGazerApi): void {
    const tracker = api.getTracker?.();
    if (!tracker || typeof tracker.getEyePatches !== "function") return;
    const original = tracker.getEyePatches;
    let video: HTMLVideoElement | null = null;
    let latestPresented: PresentedFrameMetadata | null = null;
    let callbackHandle: number | null = null;
    let lastInferredKey: string | null = null;
    let duplicate = false;
    let enabled = true;
    let stopped = false;

    const onPresentedFrame = (_now: number, metadata: PresentedFrameMetadata): void => {
      if (stopped) return;
      latestPresented = {
        presentedFrames: metadata.presentedFrames,
        mediaTime: metadata.mediaTime
      };
      if (video && typeof video.requestVideoFrameCallback === "function") {
        callbackHandle = video.requestVideoFrameCallback(onPresentedFrame);
      }
    };

    const frameKey = (element: HTMLVideoElement): string | null => {
      if (video !== element) {
        video = element;
        latestPresented = null;
        lastInferredKey = null;
        if (typeof element.requestVideoFrameCallback === "function") {
          callbackHandle = element.requestVideoFrameCallback(onPresentedFrame);
        }
      }
      if (typeof element.getVideoPlaybackQuality === "function") {
        const quality = element.getVideoPlaybackQuality();
        if (Number.isFinite(quality.totalVideoFrames)) {
          // Decoded frame count is stable for hidden video and avoids a
          // one-frame double inference when rVFC metadata first arrives.
          return `decoded:${quality.totalVideoFrames}`;
        }
      }
      if (latestPresented) {
        return `presented:${latestPresented.presentedFrames}:${latestPresented.mediaTime}`;
      }
      return null;
    };

    const wrapper = async (
      element: HTMLVideoElement,
      canvas: HTMLCanvasElement,
      width: number,
      height: number
    ): Promise<unknown> => {
      if (stopped || !enabled) {
        duplicate = false;
        return original.call(tracker, element, canvas, width, height);
      }
      const key = frameKey(element);
      if (key !== null && key === lastInferredKey) {
        // A duplicate frame gets no eye patches: WebGazer must not regress or
        // Kalman-update cached features. The matching callback is suppressed.
        duplicate = true;
        return null;
      }
      duplicate = false;
      const patches = await original.call(tracker, element, canvas, width, height);
      if (key !== null) lastInferredKey = key;
      return patches;
    };

    tracker.getEyePatches = wrapper;
    const gate: FrameGate = {
      consumeDuplicate: () => {
        const pending = duplicate;
        duplicate = false;
        return pending;
      },
      setEnabled: (next: boolean) => {
        if (stopped) return;
        enabled = next;
        if (!next) duplicate = false;
      },
      dispose: () => {
        if (stopped) return;
        stopped = true;
        enabled = false;
        duplicate = false;
        latestPresented = null;
        if (callbackHandle !== null && video && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(callbackHandle);
        }
        callbackHandle = null;
        if (tracker.getEyePatches === wrapper) tracker.getEyePatches = original;
        if (this.frameGate === gate) this.frameGate = null;
      }
    };
    this.frameGate = gate;
  }

  private onGaze(data: { x: number; y: number } | null, elapsedTime: number): void {
    // Duplicate frames are not observations: no clock pair, no sample seq.
    if (this.frameGate?.consumeDuplicate()) return;
    if (!Number.isFinite(elapsedTime)) return;
    const local = this.now();
    this.clockSync.addPair(elapsedTime, local);
    const t = this.clockSync.toLocal(elapsedTime);
    const viewport = this.viewport;
    let x: number | null = null;
    let y: number | null = null;
    let valid = false;
    let invalidReason: GazeSample["invalid_reason"];
    if (!data) {
      invalidReason = "no_prediction";
    } else {
      x = data.x;
      y = data.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        invalidReason = "non_finite";
      } else if (x < 0 || y < 0 || x > viewport.width_px || y > viewport.height_px) {
        invalidReason = "out_of_bounds";
      } else {
        valid = true;
      }
    }
    const sample: GazeSample = {
      seq: ++this.seq,
      t_ms: t,
      t_source_ms: elapsedTime,
      x_px: x,
      y_px: y,
      valid,
      ...(invalidReason ? { invalid_reason: invalidReason } : {}),
      trial_id: null
    };
    for (const listener of this.listeners) listener(sample);
  }

  private async releaseApi(api: WebGazerApi | null = this.api): Promise<void> {
    if (this.api === api) this.api = null;
    if (!api) return;
    this.frameGate?.dispose();
    try {
      api.clearGazeListener();
    } catch {
      // Cleanup continues; the camera may already be gone.
    }
    try {
      api.stopVideo();
    } catch {
      // stopVideo can fail if the preview DOM was already removed.
    }
    try {
      api.end();
    } catch {
      // end() can fail if init did not complete.
    }
    try {
      await api.clearData();
    } catch {
      // Model clearing is best effort during teardown.
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    if (this.state === "stopped" || this.state === "idle") {
      if (this.api) await this.releaseApi();
      return;
    }
    this.setStatus("stopping");
    await this.releaseApi();
    this.setStatus("stopped");
  }

  async pause(): Promise<void> {
    if (this.state !== "running" || !this.api) return;
    this.api.pause();
    this.setStatus("paused");
  }

  async resume(): Promise<void> {
    if (this.state !== "paused" || !this.api) return;
    await this.api.resume();
    this.setStatus("running");
  }

  subscribe(listener: GazeSampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Records one calibration target. The official WebGazer example accepts five
   * clicks per point; the caller presents the target and optionally collects
   * held-out predictions during the dwell for validation.
   */
  async recordCalibrationTarget(target: CalibrationTarget): Promise<void> {
    if (this.state !== "running" || !this.api) throw new Error("webgazer_not_running");
    if (!this.api.recordScreenPosition) throw new Error("webgazer_calibration_unavailable");
    const repetitions = this.options.calibrationRepetitions ?? 5;
    if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error("webgazer_calibration_repetitions_invalid");
    const delay = this.options.repetitionDelayMs ?? 120;
    // Calibration clicks consume WebGazer's latestEyeFeatures, so let every
    // camera frame through while training points are being recorded.
    const gate = this.frameGate;
    gate?.setEnabled(false);
    try {
      for (let index = 0; index < repetitions; index += 1) {
        if (this.state !== "running") throw new Error("webgazer_not_running");
        await this.wait(delay);
        if (this.state !== "running" || !this.api) throw new Error("webgazer_not_running");
        this.api.recordScreenPosition(target.x_px, target.y_px, "click");
      }
    } finally {
      gate?.setEnabled(true);
    }
  }

  /** Live preview is opt-in, calibration-only, and never recorded. */
  setCalibrationFeedback(enabled: boolean): void {
    if (!this.api) throw new Error("webgazer_not_started");
    this.api.params.showVideo = enabled;
    this.api.params.showFaceOverlay = enabled;
    this.api.params.showFaceFeedbackBox = enabled;
  }
}
