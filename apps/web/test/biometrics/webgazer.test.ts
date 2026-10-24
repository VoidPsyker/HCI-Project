import { afterEach, describe, expect, it, vi } from "vitest";
import { assertCameraConsent, grantGazeConsent } from "../../src/biometrics/consent";
import { WebGazerSource } from "../../src/biometrics/webgazer";
import type { WebGazerApi, WebGazerGazeData, WebGazerTracker } from "../../src/biometrics/webgazerApi";

class FakeWebGazer implements WebGazerApi {
  params = {
    faceMeshSolutionPath: "",
    saveDataAcrossSessions: true,
    showVideo: true,
    showFaceOverlay: true,
    showFaceFeedbackBox: true,
    showGazeDot: true,
    applyKalmanFilter: true,
    storingPoints: true
  };
  calls: string[] = [];
  listener: ((data: WebGazerGazeData | null, elapsedTime: number) => void) | null = null;
  recordCalls: Array<{ x: number; y: number; type: string }> = [];
  beginShouldFail = false;

  begin(): Promise<WebGazerApi> {
    this.calls.push("begin");
    return this.beginShouldFail ? Promise.reject(new Error("permission_denied")) : Promise.resolve(this);
  }
  end(): WebGazerApi {
    this.calls.push("end");
    return this;
  }
  stopVideo(): WebGazerApi {
    this.calls.push("stopVideo");
    return this;
  }
  pause(): WebGazerApi {
    this.calls.push("pause");
    return this;
  }
  resume(): WebGazerApi {
    this.calls.push("resume");
    return this;
  }
  setGazeListener(listener: (data: WebGazerGazeData | null, elapsedTime: number) => void): WebGazerApi {
    this.calls.push("setGazeListener");
    this.listener = listener;
    return this;
  }
  clearGazeListener(): WebGazerApi {
    this.calls.push("clearGazeListener");
    this.listener = null;
    return this;
  }
  clearData(): Promise<void> {
    this.calls.push("clearData");
    return Promise.resolve();
  }
  removeMouseEventListeners(): void {
    this.calls.push("removeMouseEventListeners");
  }
  addMouseEventListeners(): WebGazerApi {
    this.calls.push("addMouseEventListeners");
    return this;
  }
  recordScreenPosition(x: number, y: number, eventType = "click"): void {
    this.recordCalls.push({ x, y, type: eventType });
  }
  detectCompatibility(): boolean {
    return true;
  }
  emit(data: WebGazerGazeData | null, elapsedTime: number): void {
    this.listener?.(data, elapsedTime);
  }
}

const PARTICIPANT = "P001";
const SESSION = "S001";

class FakeTracker implements WebGazerTracker {
  calls: Array<{ width: number; height: number }> = [];
  result: unknown = false;

  async getEyePatches(
    _video: HTMLVideoElement,
    _canvas: HTMLCanvasElement,
    width: number,
    height: number
  ): Promise<unknown> {
    this.calls.push({ width, height });
    return this.result;
  }
}

class FakeWebGazerWithTracker extends FakeWebGazer {
  tracker = new FakeTracker();

  getTracker(): WebGazerTracker {
    return this.tracker;
  }
}

function fakeVideo(options: { rvfc: boolean; decodedFrameCount: boolean }) {
  let callback: ((now: number, metadata: { presentedFrames: number; mediaTime: number }) => void) | null = null;
  let handle = 0;
  let total = 0;
  const element = {
    requestVideoFrameCallback: options.rvfc
      ? vi.fn((next: (now: number, metadata: { presentedFrames: number; mediaTime: number }) => void) => {
          callback = next;
          handle += 1;
          return handle;
        })
      : undefined,
    cancelVideoFrameCallback: vi.fn(),
    getVideoPlaybackQuality: options.decodedFrameCount
      ? vi.fn(() => ({ totalVideoFrames: total }))
      : undefined
  };
  return {
    video: element as unknown as HTMLVideoElement,
    element,
    present(frame: number) {
      callback?.(performance.now(), { presentedFrames: frame, mediaTime: frame * 0.05 });
    },
    setDecodedFrames(frames: number) {
      total = frames;
    }
  };
}

const CANVAS = {} as HTMLCanvasElement;

function cameraConsent() {
  return grantGazeConsent({
    participant_id: PARTICIPANT,
    session_id: SESSION,
    version: "eye-1",
    camera_used: true,
    granted_at: "2026-10-24T10:00:00.000Z"
  });
}

function installCamera(): void {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
}

function source(api: FakeWebGazer, now: () => number = () => 1000, loader?: () => Promise<WebGazerApi>) {
  return new WebGazerSource({
    participant_id: PARTICIPANT,
    session_id: SESSION,
    load: loader ?? (() => Promise.resolve(api)),
    viewport: () => ({ width_px: 1000, height_px: 1000 }),
    now,
    wait: async () => undefined
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gaze consent", () => {
  it("forces separate eye-tracking consent and no raw video retention", () => {
    const consent = cameraConsent();
    expect(consent).toMatchObject({
      scope: "eye_tracking_only",
      camera_used: true,
      raw_video_retention: false,
      separate_from_core_consent: true
    });
    expect(() => assertCameraConsent({ ...consent, camera_used: false }, PARTICIPANT, SESSION)).toThrow(
      "gaze_consent_camera_not_granted"
    );
    expect(() => assertCameraConsent(consent, PARTICIPANT, "other-session")).toThrow("gaze_consent_session_mismatch");
  });
});

describe("WebGazerSource", () => {
  it("stops video before waiting for model storage cleanup", async () => {
    installCamera();
    const api = new FakeWebGazer();
    const webgazer = source(api);
    await webgazer.start(cameraConsent());
    let finishCleanup!: () => void;
    api.clearData = () => new Promise<void>((resolve) => { finishCleanup = resolve; });
    const stopping = webgazer.stop();
    expect(api.calls).toContain("stopVideo");
    expect(api.calls).toContain("end");
    finishCleanup();
    await stopping;
  });

  it("stops a stream created after stop while begin was pending", async () => {
    installCamera();
    const api = new FakeWebGazer();
    let resolveBegin!: () => void;
    let live = false;
    api.begin = vi.fn(() => new Promise<WebGazerApi>((resolve) => {
      resolveBegin = () => { live = true; resolve(api); };
    }));
    api.stopVideo = vi.fn(() => { live = false; return api; });
    const webgazer = source(api);
    const starting = webgazer.start(cameraConsent());
    await vi.waitFor(() => expect(api.begin).toHaveBeenCalledOnce());
    await webgazer.stop();
    resolveBegin();
    await starting;
    expect(live).toBe(false);
    expect(webgazer.status).toBe("stopped");
    expect(api.listener).toBeNull();
  });

  it("keeps stopped status when pending begin rejects", async () => {
    installCamera();
    const api = new FakeWebGazer();
    let rejectBegin!: (error: Error) => void;
    api.begin = vi.fn(() => new Promise<WebGazerApi>((_resolve, reject) => { rejectBegin = reject; }));
    const webgazer = source(api);
    const starting = webgazer.start(cameraConsent());
    await vi.waitFor(() => expect(api.begin).toHaveBeenCalledOnce());
    await webgazer.stop();
    rejectBegin(new Error("late permission rejection"));
    await starting;
    expect(webgazer.status).toBe("stopped");
  });

  it("does not even load the library without camera consent", async () => {
    const api = new FakeWebGazer();
    let loads = 0;
    const webgazer = source(api, () => 1000, () => {
      loads += 1;
      return Promise.resolve(api);
    });
    await expect(webgazer.start(null)).rejects.toThrow("gaze_consent_required");
    await expect(webgazer.start({ ...cameraConsent(), camera_used: false })).rejects.toThrow(
      "gaze_consent_camera_not_granted"
    );
    expect(loads).toBe(0);
    expect(api.calls).toHaveLength(0);
  });

  it("refuses to start when getUserMedia is unavailable", async () => {
    const api = new FakeWebGazer();
    const webgazer = source(api);
    await expect(webgazer.start(cameraConsent())).rejects.toThrow("camera_unavailable");
    expect(api.calls).toHaveLength(0);
  });

  it("sets privacy defaults, disables implicit click training, and streams samples", async () => {
    installCamera();
    const api = new FakeWebGazer();
    let now = 1050;
    const webgazer = source(api, () => now);
    const samples: number[] = [];
    webgazer.subscribe((sample) => samples.push(sample.seq));
    await webgazer.start(cameraConsent());
    expect(webgazer.status).toBe("running");
    expect(api.params).toMatchObject({
      saveDataAcrossSessions: false,
      showVideo: false,
      showFaceOverlay: false,
      showFaceFeedbackBox: false,
      showGazeDot: false,
      applyKalmanFilter: true,
      storingPoints: false,
      faceMeshSolutionPath: "/vendor/webgazer/mediapipe/face_mesh"
    });
    expect(api.calls.indexOf("clearData")).toBeLessThan(api.calls.indexOf("begin"));
    expect(api.calls).toContain("removeMouseEventListeners");
    api.emit({ x: 100, y: 200 }, 100);
    expect(samples).toEqual([1]);
    const first = webgazer.clock;
    expect(first.pairs).toBe(1);
    now = 1150;
    api.emit(null, 200);
    expect(samples).toEqual([1, 2]);
    expect(webgazer.clock.pairs).toBe(2);
    expect(webgazer.cameraActive).toBe(true);
  });

  it("marks out-of-bounds predictions invalid", async () => {
    installCamera();
    const api = new FakeWebGazer();
    const webgazer = source(api, () => 1000);
    const samples: Array<{ valid: boolean; reason?: string }> = [];
    webgazer.subscribe((sample) => samples.push({ valid: sample.valid, reason: sample.invalid_reason }));
    await webgazer.start(cameraConsent());
    api.emit({ x: -1, y: 500 }, 100);
    expect(samples[0]).toEqual({ valid: false, reason: "out_of_bounds" });
  });

  it("releases the camera and clears the model on stop", async () => {
    installCamera();
    const api = new FakeWebGazer();
    const webgazer = source(api, () => 1000);
    await webgazer.start(cameraConsent());
    await webgazer.stop();
    expect(webgazer.status).toBe("stopped");
    expect(webgazer.cameraActive).toBe(false);
    expect(api.calls.indexOf("stopVideo")).toBeLessThan(api.calls.indexOf("end"));
    expect(api.calls.filter((call) => call === "clearData")).toHaveLength(2);
    expect(api.listener).toBeNull();
  });

  it("reports begin failure without leaving a live camera", async () => {
    installCamera();
    const api = new FakeWebGazer();
    api.beginShouldFail = true;
    const webgazer = source(api);
    await expect(webgazer.start(cameraConsent())).rejects.toThrow("permission_denied");
    expect(webgazer.status).toBe("error");
    expect(webgazer.cameraActive).toBe(false);
  });

  it("records five explicit calibration clicks per point", async () => {
    installCamera();
    const api = new FakeWebGazer();
    const webgazer = source(api);
    await webgazer.start(cameraConsent());
    expect(api.calls).toContain("removeMouseEventListeners");
    expect(api.calls).not.toContain("addMouseEventListeners");
    api.calls.length = 0;
    await webgazer.recordCalibrationTarget({ id: "p1", order: 1, x_px: 100, y_px: 100 });
    expect(api.recordCalls).toHaveLength(5);
    expect(api.recordCalls.every((call) => call.x === 100 && call.y === 100 && call.type === "click")).toBe(true);
    // Calibration must train only the explicit target calls, never WebGazer's
    // implicit mouse/click listeners that would leak cursor data into the model.
    expect(api.calls).toEqual([]);
    expect(api.calls).not.toContain("addMouseEventListeners");
    expect(api.params.faceMeshSolutionPath).toBe("/vendor/webgazer/mediapipe/face_mesh");
    expect(api.params.faceMeshSolutionPath).not.toMatch(/^https?:/);
    await webgazer.pause();
    await expect(webgazer.recordCalibrationTarget({ id: "p2", order: 2, x_px: 500, y_px: 500 })).rejects.toThrow(
      "webgazer_not_running"
    );
    await webgazer.resume();
    await webgazer.setCalibrationFeedback(true);
    expect(api.params.showVideo).toBe(true);
    expect(api.params.showFaceOverlay).toBe(true);
    await webgazer.stop();
  });

  it("skips duplicate presented frames without regression on cached patches or duplicate samples", async () => {
    installCamera();
    const api = new FakeWebGazerWithTracker();
    const frames = fakeVideo({ rvfc: true, decodedFrameCount: true });
    const webgazer = source(api);
    const samples: Array<{ seq: number; valid: boolean; reason?: string }> = [];
    webgazer.subscribe((sample) => samples.push({ seq: sample.seq, valid: sample.valid, reason: sample.invalid_reason }));
    await webgazer.start(cameraConsent());

    frames.setDecodedFrames(1);
    const first = await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(first).toBe(false);
    expect(api.tracker.calls).toHaveLength(1);
    api.emit(null, 100);
    expect(samples).toEqual([{ seq: 1, valid: false, reason: "no_prediction" }]);

    // Same presented frame: no inference, no cached eye patches, no sample.
    const duplicate = await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(duplicate).toBeNull();
    expect(api.tracker.calls).toHaveLength(1);
    api.emit(null, 116);
    expect(samples).toHaveLength(1);

    // A genuinely new decoded frame with no face remains a real missing
    // observation, even while rVFC metadata has not arrived yet.
    frames.setDecodedFrames(2);
    const noFace = await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(noFace).toBe(false);
    expect(api.tracker.calls).toHaveLength(2);
    api.emit(null, 132);
    expect(samples).toHaveLength(2);
    expect(samples[1]).toEqual({ seq: 2, valid: false, reason: "no_prediction" });

    // A new decoded frame with a prediction is delivered normally.
    api.tracker.result = { left: {}, right: {} };
    frames.setDecodedFrames(3);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(3);
    api.emit({ x: 100, y: 200 }, 148);
    expect(samples).toHaveLength(3);
    expect(samples[2]).toEqual({ seq: 3, valid: true, reason: undefined });
    expect(webgazer.status).toBe("running");
    await webgazer.stop();
  });

  it("uses totalVideoFrames when requestVideoFrameCallback is unavailable", async () => {
    installCamera();
    const api = new FakeWebGazerWithTracker();
    const frames = fakeVideo({ rvfc: false, decodedFrameCount: true });
    const webgazer = source(api);
    await webgazer.start(cameraConsent());

    frames.setDecodedFrames(7);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(1);

    frames.setDecodedFrames(8);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(2);
    await webgazer.stop();
  });

  it("uses presentedFrame metadata when decoded frame count is unavailable", async () => {
    installCamera();
    const api = new FakeWebGazerWithTracker();
    const frames = fakeVideo({ rvfc: true, decodedFrameCount: false });
    const webgazer = source(api);
    await webgazer.start(cameraConsent());

    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(1);
    frames.present(2);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(2);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(2);
    await webgazer.stop();
  });

  it("fails open when no frame identity is available", async () => {
    installCamera();
    const api = new FakeWebGazerWithTracker();
    const frames = fakeVideo({ rvfc: false, decodedFrameCount: false });
    const webgazer = source(api);
    await webgazer.start(cameraConsent());

    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(2);
    await webgazer.stop();
  });

  it("restores the tracker hook on stop and reinstalls it after restart", async () => {
    installCamera();
    const api = new FakeWebGazerWithTracker();
    const frames = fakeVideo({ rvfc: true, decodedFrameCount: true });
    const original = api.tracker.getEyePatches;
    const webgazer = source(api);
    await webgazer.start(cameraConsent());
    expect(api.tracker.getEyePatches).not.toBe(original);

    frames.setDecodedFrames(1);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(1);
    await webgazer.stop();
    expect(api.tracker.getEyePatches).toBe(original);
    expect(frames.element.cancelVideoFrameCallback).toHaveBeenCalled();

    // Restored: the real tracker runs for every call after teardown.
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(3);

    await webgazer.start(cameraConsent());
    expect(api.tracker.getEyePatches).not.toBe(original);
    frames.setDecodedFrames(2);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(4);
    await webgazer.stop();
    expect(api.tracker.getEyePatches).toBe(original);
  });

  it("lets every frame through while calibration targets are being recorded", async () => {
    installCamera();
    const api = new FakeWebGazerWithTracker();
    const frames = fakeVideo({ rvfc: true, decodedFrameCount: true });
    const webgazer = new WebGazerSource({
      participant_id: PARTICIPANT,
      session_id: SESSION,
      load: () => Promise.resolve(api),
      viewport: () => ({ width_px: 1000, height_px: 1000 }),
      now: () => 1000,
      wait: async () => {
        await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
      }
    });
    await webgazer.start(cameraConsent());
    frames.setDecodedFrames(1);

    await webgazer.recordCalibrationTarget({ id: "p1", order: 1, x_px: 100, y_px: 100 });
    expect(api.tracker.calls).toHaveLength(5);
    expect(api.recordCalls).toHaveLength(5);

    // Re-enabled after training: one fresh inference, then duplicate skip.
    frames.setDecodedFrames(2);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    await api.tracker.getEyePatches(frames.video, CANVAS, 640, 480);
    expect(api.tracker.calls).toHaveLength(6);
    await webgazer.stop();
  });
});
