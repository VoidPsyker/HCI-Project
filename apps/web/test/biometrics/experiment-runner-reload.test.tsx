import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperimentRunner } from "../../src/ExperimentRunner";
import { useRunnerStore } from "../../src/store";
import type { SessionInfo, StudyDesign } from "../../src/types";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  loadSession: vi.fn(),
  patchSessionState: vi.fn()
}));

vi.mock("../../src/api", () => ({
  loadSession: mocks.loadSession,
  loadSessionStatus: vi.fn(async () => ({ status: "in_progress", phase: "calibration", abort_reason: null })),
  patchSessionState: mocks.patchSessionState,
  recordConsent: vi.fn(async () => ({ session: {} })),
  stopSession: vi.fn(async () => ({ session: {} })),
  submitDemographics: vi.fn(async () => ({ design: null, session: {} })),
  submitQuestionnaires: vi.fn(async () => ({ ok: true, accepted: 0 })),
  withdrawSession: vi.fn(async () => ({ ok: true }))
}));

vi.mock("../../src/logger", () => ({
  EventLogger: class {
    log() {}
    setContext() {}
    interruptTrial() {}
    beacon() {}
    flush() {}
    discard() {}
    destroy() {}
  }
}));

vi.mock("../../src/gaze/GazeController", () => ({
  GazeController: class {
    status = "idle";
    report = null;
    start() {
      return mocks.start();
    }
    stop() {
      return mocks.stop();
    }
  }
}));

vi.mock("../../src/gaze/gazeClient", () => ({
  gazeApi: { consent: vi.fn(), batch: vi.fn(), complete: vi.fn() }
}));

vi.mock("../../src/biometrics/webgazer", () => ({
  WebGazerSource: class {
    info = { kind: "webcam", adapter: "test", device: "test", nominal_hz: null, hardware_backed: false, synthetic: false, capabilities: ["gaze"], notes: "" };
  }
}));

vi.mock("../../src/biometrics/webgazerLoader", () => ({ loadBundledWebGazer: vi.fn() }));
vi.mock("../../src/biometrics/consent", () => ({ grantGazeConsent: vi.fn() }));

const session = (): SessionInfo => ({
  session_id: "S-race",
  participant_id: "P-race",
  study: "pilot",
  status: "in_progress",
  phase: "calibration",
  created_at: new Date().toISOString(),
  started_at: null,
  ended_at: null,
  abort_reason: null,
  sequence_id: null,
  target_set: null,
  colour_mapping: null
});

const design = { blocks: [], practiceTrials: [], trials: [] } as unknown as StudyDesign;

describe("ExperimentRunner calibration reload", () => {
  beforeEach(() => {
    mocks.patchSessionState.mockResolvedValue({ session: {} });
  });

  afterEach(() => {
    cleanup();
    useRunnerStore.getState().reset();
    localStorage.clear();
  });

  it("does not lose a failed camera start when bootstrap refreshes the same session", async () => {
    mocks.start.mockImplementation(
      () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error("permission_denied")), 50))
    );
    mocks.stop.mockResolvedValue(undefined);
    mocks.loadSession.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                session: session(),
                participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() },
                design
              }),
            10
          )
        )
    );

    useRunnerStore.setState({
      sessionId: "S-race",
      session: session(),
      participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() },
      design,
      phase: "calibration",
      gazeConsent: {
        participant_id: "P-race",
        session_id: "S-race",
        version: "v1",
        granted_at: new Date().toISOString(),
        scope: "eye_tracking_only",
        camera_used: true,
        raw_video_retention: false,
        separate_from_core_consent: true
      },
      gazeViewport: { width_px: 1920, height_px: 1080 },
      gazeGeometry: { width_px: 1920, height_px: 1080, width_mm: 530, height_mm: 300, viewing_distance_mm: 600 }
    });

    render(<ExperimentRunner sessionId="S-race" />);

    expect(await screen.findByTestId("gaze-calibration-retry", {}, { timeout: 1000 })).toBeVisible();
  });

  it("fails closed when a reloaded debrief has no gaze controller", async () => {
    mocks.loadSession.mockResolvedValue({
      session: session(),
      participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() },
      design
    });

    useRunnerStore.setState({
      sessionId: "S-race",
      session: session(),
      participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() },
      design,
      phase: "debrief",
      gazeConsent: {
        participant_id: "P-race",
        session_id: "S-race",
        version: "v1",
        granted_at: new Date().toISOString(),
        scope: "eye_tracking_only",
        camera_used: true,
        raw_video_retention: false,
        separate_from_core_consent: true
      },
      gazeViewport: { width_px: 1920, height_px: 1080 },
      gazeGeometry: { width_px: 1920, height_px: 1080, width_mm: 530, height_mm: 300, viewing_distance_mm: 600 }
    });

    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("debrief-screen");
    fireEvent.click(screen.getByTestId("finish-session"));

    expect(await screen.findByText(/could not be finalized/i)).toBeVisible();
    await waitFor(() => {
      expect(mocks.patchSessionState.mock.calls.filter(([, patch]) => patch?.status === "completed")).toHaveLength(0);
    });
    expect(useRunnerStore.getState().phase).toBe("debrief");
  });
});
