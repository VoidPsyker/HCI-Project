import { beforeEach, expect, it, vi } from "vitest";
import { GazeUploader, resumeGazeFinalization, saveGazeFinalization } from "../src/gaze/gazeClient";
import type { GazeApi, GazeCompletionPayload } from "../src/gaze/gazeClient";

beforeEach(() => sessionStorage.clear());
it("replays a pending batch with the same id and finalizes after reload, then confirms completion", async () => {
  const payload = { calibration: null, quality: { overall: "fail" }, metrics: [], clock: {}, max_samples: 500000, rejected_samples: 0, dropped_samples: 0 } as unknown as GazeCompletionPayload;
  saveGazeFinalization("reload", "token", payload);
  const uploader = new GazeUploader({ sessionId: "reload", token: "token", autoFlushMs: null, persist: true, postBatch: async () => { throw new Error("offline"); } });
  uploader.push({ seq: 1, t_ms: 100, t_source_ms: 100, x_px: 10, y_px: 20, valid: true });
  await expect(uploader.flush()).rejects.toThrow("offline");
  const pendingId = JSON.parse(sessionStorage.getItem("meridian:gaze-finalization:reload")!).pending.batch_id;
  const batch = vi.fn<GazeApi["batch"]>(async () => ({ ok: true, accepted: 1, duplicate: false, last_seq: 1 }));
  const complete = vi.fn(async () => ({ ok: true, manifest: {}, sample_count: 1, files: [] }));
  const api = { batch, complete } as unknown as GazeApi;
  batch.mockRejectedValueOnce(new Error("still_offline"));
  await expect(resumeGazeFinalization("reload", api)).rejects.toThrow("still_offline");
  expect(complete).not.toHaveBeenCalled();
  await resumeGazeFinalization("reload", api);
  expect(batch).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenCalledWith("reload", "token", payload);
  const batchId = batch.mock.calls[0]?.[2]?.batch_id;
  expect(batchId).toBe(pendingId);
  expect(batch.mock.calls[1]?.[2]?.batch_id).toBe(pendingId);
  await resumeGazeFinalization("reload", api);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem("meridian:gaze-finalization:reload")!).token).toBeNull();
});

it("does not recreate the recovery credential when a pending upload settles after withdrawal", async () => {
  let resolveBatch!: (value: { ok: boolean; accepted: number; duplicate: boolean; last_seq: number }) => void;
  const uploader = new GazeUploader({ sessionId: "withdraw", token: "token", autoFlushMs: null, persist: true, postBatch: () => new Promise((resolve) => { resolveBatch = resolve; }) });
  uploader.push({ seq: 1, t_ms: 100, t_source_ms: 100, x_px: 10, y_px: 20, valid: true });
  const sending = uploader.flush();
  uploader.clear();
  resolveBatch({ ok: true, accepted: 1, duplicate: false, last_seq: 1 });
  await sending;
  expect(sessionStorage.getItem("meridian:gaze-finalization:withdraw")).toBeNull();
});
