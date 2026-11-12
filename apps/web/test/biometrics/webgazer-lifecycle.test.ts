import { afterEach, expect, it, vi } from "vitest";
import { WebGazerSource } from "../../src/biometrics/webgazer";
import { grantGazeConsent } from "../../src/biometrics/consent";
import type { WebGazerApi } from "../../src/biometrics/webgazerApi";

const consent = grantGazeConsent({ participant_id: "p", session_id: "s", version: "1", camera_used: true });
function fixture() {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
  let listener: Parameters<WebGazerApi["setGazeListener"]>[0] = () => undefined;
  const api: WebGazerApi = {
    params: {} as WebGazerApi["params"],
    begin: vi.fn(async () => api), end: vi.fn(() => api), stopVideo: vi.fn(() => api),
    pause: vi.fn(() => api), resume: vi.fn(() => api), clearData: vi.fn(),
    setGazeListener: vi.fn((next) => { listener = next; return api; }), clearGazeListener: vi.fn(() => api)
  };
  const wait = vi.fn(async (_ms: number): Promise<void> => undefined);
  const source = new WebGazerSource({ participant_id: "p", session_id: "s", load: async () => api,
    viewport: () => ({ width_px: 1000, height_px: 800 }), wait });
  return { api, source, wait, emit: () => listener({ x: 50, y: 60 }, 100) };
}
afterEach(() => vi.unstubAllGlobals());
it("rejects a second start while paused and ignores pending callbacks", async () => {
  const { api, source, emit } = fixture();
  const sample = vi.fn(); source.subscribe(sample);
  await source.start(consent); await source.pause(); emit();
  expect(sample).not.toHaveBeenCalled();
  await expect(source.start(consent)).rejects.toThrow("webgazer_already_started");
  expect(api.begin).toHaveBeenCalledTimes(1);
  await source.stop(); emit(); expect(sample).not.toHaveBeenCalled();
});
it("does not resurrect a stopped session when resume settles late", async () => {
  const { api, source } = fixture();
  await source.start(consent); await source.pause();
  let finish!: () => void;
  api.resume = () => new Promise((resolve) => { finish = () => resolve(api); });
  const resuming = source.resume(); await source.stop(); finish(); await resuming;
  expect(source.status).toBe("stopped");
});
it("reports resume failure and releases the camera", async () => {
  const { api, source } = fixture();
  await source.start(consent); await source.pause();
  api.resume = async () => { throw new Error("resume_failed"); };
  await expect(source.resume()).rejects.toThrow("resume_failed");
  expect(source.status).toBe("error"); expect(source.cameraActive).toBe(false);
});

it("stops every attached track even when upstream teardown throws", async () => {
  const { api, source } = fixture();
  await source.start(consent);
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const video = document.createElement("video"); video.id = "webgazerVideoFeed";
  Object.defineProperty(video, "srcObject", { value: { getTracks: () => tracks }, writable: true });
  document.body.append(video);
  api.stopVideo = () => { throw new Error("partial init"); };
  await source.stop();
  expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  expect(video.srcObject).toBeNull(); video.remove();
});
it("rejects start while paused without clearing the live model", async () => {
  const { api, source } = fixture();
  await source.start(consent); await source.pause();
  await expect(source.start(consent)).rejects.toThrow("webgazer_already_started");
  expect(api.begin).toHaveBeenCalledTimes(1);
  await source.stop();
});
it("does not train a restarted session with a previous calibration target", async () => {
  const { api, source, wait } = fixture();
  api.recordScreenPosition = vi.fn();
  await source.start(consent);
  let finish!: () => void;
  wait.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const recording = source.recordCalibrationTarget({ id: "p", order: 1, x_px: 50, y_px: 60 });
  await source.stop(); await source.start(consent); finish();
  await expect(recording).rejects.toThrow("webgazer_not_running");
  expect(api.recordScreenPosition).not.toHaveBeenCalled();
  await source.stop();
});
