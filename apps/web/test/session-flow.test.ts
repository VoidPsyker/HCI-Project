import { afterEach, expect, it, vi } from "vitest";
import { useRunnerStore } from "../src/store";
import { request } from "../src/api";
import { EventLogger } from "../src/logger";
import type { SessionInfo, StudyDesign } from "../src/types";
const session = { session_id: "s", participant_id: "p", status: "in_progress", abort_reason: null } as SessionInfo;
const bundle = { session, participant: { label: "P", consented_at: "2026-01-01", consent_version: "v" }, design: { blocks: [{ trialIds: ["t"] }] } as StudyDesign, fastMode: false };
afterEach(() => { useRunnerStore.getState().reset(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("distinguishes server termination from participant stop across bootstrap", () => {
  useRunnerStore.getState().setBootstrap({ ...bundle, session: { ...session, status: "aborted", abort_reason: "gaze_quality_gate_failed" } });
  expect(useRunnerStore.getState()).toMatchObject({ abortReason: "gaze_quality_gate_failed", stopSource: "system" });
  useRunnerStore.getState().abort("participant_stop");
  expect(useRunnerStore.getState().stopSource).toBe("participant");
});
it("returns to the interrupted trial after reload calibration", () => {
  useRunnerStore.setState({ sessionId: "s", phase: "trial", gazeConsent: {} as never, gazeGeometry: {} as never });
  useRunnerStore.getState().setBootstrap(bundle);
  expect(useRunnerStore.getState()).toMatchObject({ phase: "calibration", calibrationResumePhase: "trial_intro" });
});
it("keeps HTTP status when an upstream server sends HTML", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<h1>Unavailable</h1>", { status: 503 })));
  await expect(request("/api/test")).rejects.toThrow("HTTP 503");
});
it("honors explicit null context on session-level events", async () => {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true })); vi.stubGlobal("fetch", fetchMock);
  const logger = new EventLogger("p", "s");
  logger.setContext({ trial_id: "t" }); logger.log({ event_type: "session_end", trial_id: null });
  await logger.flush();
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).events[0].trial_id).toBeNull();
  logger.discard();
});
it("ignores late trial and phase callbacks after a stop", () => {
  useRunnerStore.getState().setBootstrap(bundle);
  useRunnerStore.getState().abort("participant_stop");
  useRunnerStore.getState().nextTrial();
  useRunnerStore.getState().setPhase("instructions");
  expect(useRunnerStore.getState().phase).toBe("aborted");
});
