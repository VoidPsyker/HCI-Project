import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperimentRunner } from "../../src/ExperimentRunner";
import { useRunnerStore } from "../../src/store";
import type { SessionInfo, StudyDesign } from "../../src/types";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  resumeGazeFinalization: vi.fn(),
  sourceStatus: null as null | ((status: string) => void),
  stop: vi.fn(),
  loadSession: vi.fn(),
  patchSessionState: vi.fn(),
  recordConsent: vi.fn(),
  stopSession: vi.fn(),
  log: vi.fn(),
  flush: vi.fn(),
  submitDemographics: vi.fn()
}));

vi.mock("../../src/api", () => ({
  loadSession: mocks.loadSession,
  loadSessionStatus: vi.fn(async () => ({ status: "in_progress", phase: "calibration", abort_reason: null })),
  patchSessionState: mocks.patchSessionState,
  recordConsent: mocks.recordConsent,
  stopSession: mocks.stopSession,
  submitDemographics: mocks.submitDemographics,
  submitQuestionnaires: vi.fn(async () => ({ ok: true, accepted: 0 })),
  withdrawSession: vi.fn(async () => ({ ok: true }))
}));

vi.mock("../../src/logger", () => ({
  EventLogger: class {
    log(event: unknown) { mocks.log(event); }
    setContext() {}
    interruptTrial() {}
    beacon() {}
    flush() { return mocks.flush(); }
    discard() {}
    destroy() {}
  }
}));

vi.mock("../../src/gaze/GazeController", () => ({
  GazeController: class {
    status = "idle";
    report = null;
    async start() {
      await mocks.start();
      this.status = "ready";
    }
    stop() {
      return mocks.stop();
    }
    async failAcquisition() { await mocks.stop(); this.status = "failed"; }
  }
}));

vi.mock("../../src/gaze/gazeClient", () => ({
  resumeGazeFinalization: mocks.resumeGazeFinalization,
  clearGazeFinalization: vi.fn(),
  gazeApi: { consent: vi.fn(), batch: vi.fn(), complete: vi.fn() }
}));

vi.mock("../../src/biometrics/webgazer", () => ({
  WebGazerSource: class {
    constructor(options: { onStatus?: (status: string) => void }) { mocks.sourceStatus = options.onStatus ?? null; }
    info = { kind: "webcam", adapter: "test", device: "test", nominal_hz: null, hardware_backed: false, synthetic: false, capabilities: ["gaze"], notes: "" };
  }
}));

vi.mock("../../src/components/TrialRunner", () => ({
  TrialRunner: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>Complete practice</button>
}));

vi.mock("../../src/screens/Demographics", () => ({
  DemographicsScreen: ({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => void }) => <button onClick={() => onSubmit({})}>Submit demographics</button>
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
  it.each([false, true])("opens eye-tracking consent after a previous stop (already opened: %s)", async (alreadyOpened) => {
    const previous = { ...session(), session_id: "S-previous", status: "aborted", abort_reason: "researcher_stop" };
    useRunnerStore.setState({
      sessionId: alreadyOpened ? session().session_id : previous.session_id,
      session: previous,
      phase: alreadyOpened ? "consent" : "aborted",
      abortReason: "researcher_stop",
      startedLogged: true
    });
    const fresh = { ...session(), status: "created", phase: "consent" };
    mocks.recordConsent.mockResolvedValue({ session: { ...fresh, status: "consented" } });
    mocks.loadSession.mockResolvedValue({
      session: fresh,
      participant: { label: "Participant", consent_version: null, consented_at: null },
      design: null
    });

    render(<ExperimentRunner sessionId={fresh.session_id} />);
    await screen.findByTestId("consent-screen");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("consent-continue"));

    expect(await screen.findByTestId("gaze-consent-screen")).toBeVisible();
    expect(useRunnerStore.getState().abortReason).toBeNull();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ event_type: "session_start" }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patchSessionState.mockResolvedValue({ session: {} });
    mocks.stopSession.mockResolvedValue({ session: {} });
    mocks.flush.mockResolvedValue(true);
    mocks.resumeGazeFinalization.mockRejectedValue(new Error("gaze_finalization_not_available"));
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
  it("finalizes recovered gaze before completing a reloaded debrief", async () => {
    mocks.loadSession.mockResolvedValue({ session: session(), participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() }, design });
    useRunnerStore.setState({ sessionId: "S-race", session: session(), phase: "debrief", gazeViewport: { width_px: 1920, height_px: 1080 }, gazeGeometry: { width_px: 1920, height_px: 1080, width_mm: 530, height_mm: 300, viewing_distance_mm: 600 }, gazeConsent: { participant_id: "P-race", session_id: "S-race", version: "v1", granted_at: new Date().toISOString(), scope: "eye_tracking_only", camera_used: true, raw_video_retention: false, separate_from_core_consent: true } });
    mocks.resumeGazeFinalization.mockResolvedValue({ ok: true });
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("debrief-screen");
    fireEvent.click(screen.getByTestId("finish-session"));
    await waitFor(() => expect(useRunnerStore.getState().phase).toBe("complete"));
    expect(mocks.resumeGazeFinalization).toHaveBeenCalledWith("S-race");
  });

  it("completes a reloaded debrief when gaze was unavailable and never collected", async () => {
    mocks.loadSession.mockResolvedValue({ session: session(), participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() }, design });
    useRunnerStore.setState({ sessionId: "S-race", session: session(), phase: "debrief", gazeUnavailable: "camera_unavailable" });
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("debrief-screen");
    fireEvent.click(screen.getByTestId("finish-session"));
    await waitFor(() => expect(useRunnerStore.getState().phase).toBe("complete"));
    expect(mocks.resumeGazeFinalization).not.toHaveBeenCalled();
  });

  it("shows camera failure when a running source reports an error", async () => {
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.loadSession.mockResolvedValue({ session: session(), participant: { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() }, design });
    useRunnerStore.setState({ sessionId: "S-race", session: session(), phase: "calibration", gazeConsent: { participant_id: "P-race", session_id: "S-race", version: "v1", granted_at: new Date().toISOString(), scope: "eye_tracking_only", camera_used: true, raw_video_retention: false, separate_from_core_consent: true }, gazeViewport: { width_px: 1920, height_px: 1080 }, gazeGeometry: { width_px: 1920, height_px: 1080, width_mm: 530, height_mm: 300, viewing_distance_mm: 600 } });
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("gaze-calibration-start");
    act(() => mocks.sourceStatus?.("error"));
    expect(await screen.findByTestId("gaze-calibration-retry")).toBeVisible();
  });

  it("keeps a run available after the 15-minute target", async () => {
    const participant = { label: "Participant", consent_version: "v1", consented_at: new Date(Date.now() - 901_000).toISOString() };
    mocks.loadSession.mockResolvedValue({ session: session(), participant, design });
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("gaze-consent-screen");
    fireEvent(window, new Event("focus"));
    fireEvent(document, new Event("visibilitychange"));
    expect(useRunnerStore.getState().abortReason).toBeNull();
    expect(useRunnerStore.getState().phase).toBe("gaze_consent");
    expect(mocks.stopSession).not.toHaveBeenCalled();
  });

  it("does not show completion while stopped session events remain unsaved", async () => {
    const participant = { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() };
    const stopped = { ...session(), status: "aborted", abort_reason: "participant_stop" };
    mocks.loadSession.mockResolvedValue({ session: stopped, participant, design });
    mocks.flush.mockResolvedValue(false);
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("debrief-screen");
    fireEvent.click(screen.getByTestId("finish-session"));
    expect(await screen.findByText(/have not finished saving/i)).toBeVisible();
    expect(useRunnerStore.getState().phase).toBe("aborted");
    mocks.flush.mockResolvedValue(true);
    fireEvent.click(screen.getByTestId("finish-session"));
    await waitFor(() => expect(useRunnerStore.getState().phase).toBe("complete"));
  });

  it("allows a pending form save to finish after the time target", async () => {
    const participant = { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() };
    mocks.loadSession.mockResolvedValue({ session: session(), participant, design });
    let resolveSave!: (value: unknown) => void;
    mocks.submitDemographics.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("gaze-consent-screen");
    act(() => useRunnerStore.getState().setPhase("demographics"));
    fireEvent.click(screen.getByText("Submit demographics"));
    act(() => useRunnerStore.getState().setParticipant({ ...participant, consented_at: new Date(Date.now() - 901_000).toISOString() }));
    await act(async () => resolveSave({ session: session(), design }));
    expect(useRunnerStore.getState().phase).toBe("baseline");
    expect(useRunnerStore.getState().abortReason).toBeNull();
  });

  it("retries completion without emitting another completion code", async () => {
    const participant = { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() };
    mocks.loadSession.mockResolvedValue({ session: session(), participant, design });
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("gaze-consent-screen");
    act(() => useRunnerStore.getState().setPhase("debrief"));
    mocks.flush.mockResolvedValue(false);
    fireEvent.click(screen.getByTestId("finish-session"));
    await screen.findByText(/have not finished saving/i);
    mocks.flush.mockResolvedValue(true);
    fireEvent.click(screen.getByTestId("finish-session"));
    await waitFor(() => expect(useRunnerStore.getState().phase).toBe("complete"));
    expect(mocks.log.mock.calls.filter(([event]) => event.event_type === "session_end")).toHaveLength(1);
  });

  it("calibrates after practice before starting the first induction", async () => {
    const participant = { label: "Participant", consent_version: "v1", consented_at: new Date().toISOString() };
    const practiceDesign = { ...design, practiceTrials: [{ practiceId: "P1", menuId: "A", taskId: "task", targetId: "target", taskDescription: "Find target", difficulty: "Easy" }] } as StudyDesign;
    mocks.loadSession.mockResolvedValue({ session: session(), participant, design: practiceDesign });
    render(<ExperimentRunner sessionId="S-race" />);
    await screen.findByTestId("gaze-consent-screen");
    act(() => useRunnerStore.getState().setPhase("practice_intro"));
    fireEvent.click(screen.getByText("Complete practice"));
    expect(useRunnerStore.getState().phase).toBe("calibration");
    expect(mocks.log.mock.calls.filter(([event]) => event.event_type === "induction_start")).toHaveLength(0);
  });

});
