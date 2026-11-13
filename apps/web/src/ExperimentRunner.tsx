import { useEffect, useRef, useState } from "react";
import { manipulationCheckPassed, reportedState, type GazeUnavailableReason, type StateLabel } from "@meridian/scoring";
import { estimateScreenGeometry, type GazeSourceStatus } from "@meridian/analysis";
import { loadSession, loadSessionStatus, patchSessionState, recordConsent, stopSession, submitDemographics, submitQuestionnaires, withdrawSession } from "./api";
import { EventLogger } from "./logger";
import { useRunnerStore } from "./store";
import type { CheckinPayload, SessionInfo, StudyDesign } from "./types";
import { SessionChrome } from "./components/SessionChrome";
import { ConsentScreen } from "./screens/Consent";
import { GazeConsentScreen } from "./screens/GazeConsent";
import { GazeCalibrationScreen } from "./screens/GazeCalibration";
import { GazeFailureScreen } from "./screens/GazeFailure";
import { DemographicsScreen } from "./screens/Demographics";
import { CheckinScreen } from "./screens/Checkin";
import { InductionScreen } from "./screens/Induction";
import { QuestionnairesScreen } from "./screens/Questionnaires";
import { DebriefScreen } from "./screens/Debrief";
import { BlockIntroScreen, CompleteScreen, InstructionsScreen, NeutralResetScreen } from "./screens/Interstitials";
import { TrialRunner, type TrialInstruction } from "./components/TrialRunner";
import { GazeController } from "./gaze/GazeController";
import { gazeApi, resumeGazeFinalization, clearGazeFinalization } from "./gaze/gazeClient";
import { gazeErrorCode } from "./gaze/startErrors";
import { WebGazerSource } from "./biometrics/webgazer";
import { loadBundledWebGazer } from "./biometrics/webgazerLoader";
import { grantGazeConsent } from "./biometrics/consent";
import { GAZE_CONSENT_VERSION, SESSION_TIMING } from "./content";

const SERVER_PHASE: Partial<Record<string, string>> = {
  gaze_consent: "consent",
  calibration: "calibration",
  gaze_failed: "excluded",
  baseline: "baseline",
  instructions: "instructions",
  practice_intro: "practice",
  block_intro: "block_intro",
  induction: "induction",
  checkin: "checkin",
  trial_intro: "trials",
  trial: "trials",
  product: "trials",
  block_end: "neutral_reset",
  questionnaires: "questionnaires"
};

function makeCode(): string {
  const raw = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PILOT-${raw}`;
}

export function ExperimentRunner({ sessionId }: { sessionId: string }) {
  const state = useRunnerStore();
  const [logger, setLogger] = useState<EventLogger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const loggerRef = useRef<EventLogger | null>(null);
  const gazeRef = useRef<GazeController | null>(null);
  const gazeStartingRef = useRef(false);
  const gazeCalibratedRef = useRef(false);
  const gazeFinalizedRef = useRef(false);
  const completionLoggedRef = useRef<string | null>(null);
  const [gazeAttempt, setGazeAttempt] = useState(0);
  const [gazeStarting, setGazeStarting] = useState(false);
  const [gazeStartError, setGazeStartError] = useState<string | null>(null);
  const [gazeReady, setGazeReady] = useState(false);
  const fastMode = new URLSearchParams(window.location.search).get("fast") === "1";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSession(sessionId)
      .then((bundle) => {
        if (cancelled) return;
        state.setBootstrap({ ...bundle, fastMode });
        setError(null);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message === "session_not_found" ? "This session link is not valid." : loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The session id is the only bootstrap input; store actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, fastMode]);

  useEffect(() => {
    if (loading || state.sessionId !== sessionId || !state.session?.participant_id) return;
    const instance = new EventLogger(state.session.participant_id, state.session.session_id, setBanner);
    loggerRef.current = instance;
    setLogger(instance);
    return () => {
      instance.destroy();
      loggerRef.current = null;
      setLogger(null);
    };
  }, [loading, sessionId, state.sessionId, state.session?.participant_id, state.session?.session_id]);

  useEffect(() => {
    if (!logger) return;
    const onUnload = () => {
      logger.interruptTrial("page_unload");
      logger.beacon();
      gazeRef.current?.flushBeacon();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [logger]);

  useEffect(() => {
    return () => {
      void gazeRef.current?.stop().catch(() => undefined);
      gazeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!logger || state.startedLogged) return;
    if (state.phase === "loading" || state.phase === "error" || state.phase === "consent") return;
    if (!state.participant?.consented_at) return;
    logger.log({
      event_type: "session_start",
      state_label: "mixed",
      meta: {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        device_pixel_ratio: window.devicePixelRatio,
        fast_mode: fastMode,
        taxonomy_hash: state.design?.taxonomyHash ?? null,
        study: "pilot",
        protocol_version: SESSION_TIMING.protocolVersion,
        session_target_seconds: SESSION_TIMING.targetSeconds,
        wall_time_ms: Date.parse(state.participant.consented_at)
      }
    });
    state.setStartedLogged(true);
  }, [fastMode, logger, state]);

  useEffect(() => {
    if (loading || state.sessionId !== sessionId || !SERVER_PHASE[state.phase]) return;
    const timer = setTimeout(() => {
      void patchSessionState(state.sessionId!, { status: "in_progress", phase: SERVER_PHASE[state.phase] }).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [loading, sessionId, state.phase, state.sessionId]);

  useEffect(() => {
    if (loading || state.sessionId !== sessionId) return;
    let cancelled = false;
    const interval = setInterval(() => {
      void loadSessionStatus(state.sessionId!)
        .then((status) => {
          if (cancelled || useRunnerStore.getState().sessionId !== sessionId) return;
          const current = useRunnerStore.getState();
          if ((status.status === "aborted" || status.status === "withdrawn") && current.phase !== "aborted" && current.phase !== "complete") {
            loggerRef.current?.interruptTrial(status.abort_reason ?? "stopped_by_server");
            state.abort(status.abort_reason ?? "stopped_by_server", "system");
            void gazeRef.current?.stop().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
    // The poll only needs the id and a stable action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sessionId, state.sessionId, state.phase]);

  useEffect(() => {
    if (state.phase !== "calibration") return;
    if (loading || state.sessionId !== sessionId) return;
    if (gazeStartingRef.current || (gazeRef.current && gazeRef.current.status !== "failed")) return;
    if (!state.session || !state.gazeConsent) return;
    let cancelled = false;
    gazeStartingRef.current = true;
    setGazeStarting(true);
    setGazeStartError(null);
    let previousSourceStatus: GazeSourceStatus = "idle";
    // Captured when the camera starts, so earlier window changes cannot invalidate calibration.
    const viewport = { width_px: window.innerWidth, height_px: window.innerHeight };
    const controller: GazeController = gazeRef.current ?? new GazeController({
      participant_id: state.session.participant_id,
      session_id: state.session.session_id,
      consent: state.gazeConsent,
      viewport,
      geometry: estimateScreenGeometry(viewport),
      source: new WebGazerSource({
        participant_id: state.session.participant_id,
        session_id: state.session.session_id,
        load: loadBundledWebGazer,
        viewport: () => ({ width_px: window.innerWidth, height_px: window.innerHeight }),
        onStatus: (status) => {
          const wasAcquiring = previousSourceStatus === "running" || previousSourceStatus === "paused";
          previousSourceStatus = status;
          // A failed start rejects controller.start() with its real cause; handle only sources that ran.
          if (status !== "error" || !wasAcquiring) return;
          setGazeReady(false);
          if (useRunnerStore.getState().phase === "calibration") {
            void controller.failAcquisition().catch(() => undefined).then(() => {
              setGazeStartError("gaze_source_stopped");
            });
          } else {
            markGazeUnavailable("camera_unavailable");
            setBanner("The eye tracker stopped. You can finish the study without eye tracking.");
            void controller.stop().catch(() => undefined);
          }
        }
      }),
      api: gazeApi,
      onError: (message) => {
        if (message === "gaze_viewport_changed") {
          if (useRunnerStore.getState().phase === "calibration") {
            setGazeReady(false);
            state.setPhase("gaze_failed");
          } else {
            markGazeUnavailable("viewport_changed");
            setBanner("The window size changed. You can finish the study without eye tracking.");
          }
          return;
        }
        if (message) setBanner(`Eye-tracking upload: ${message}`);
      }
    });
    gazeRef.current = controller;
    controller
      .start()
      .then(() => {
        if (!cancelled && gazeRef.current === controller && controller.status === "ready" && !useRunnerStore.getState().abortReason) setGazeReady(true);
      })
      .catch((startFailure: Error) => {
        if (cancelled || gazeRef.current !== controller) return;
        setGazeReady(false);
        setGazeStartError(gazeErrorCode(startFailure));
      })
      .finally(() => {
        gazeStartingRef.current = false;
        if (!cancelled) setGazeStarting(false);
      });
    return () => {
      cancelled = true;
    };
    // The controller is created once per calibration attempt. Depend on the
    // session identity, not the bootstrap object: refreshing the same session
    // must not cancel an in-flight camera start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.phase,
    loading,
    sessionId,
    gazeAttempt,
    state.session?.session_id,
    state.session?.participant_id,
    state.gazeConsent
  ]);

  useEffect(() => {
    const controller = gazeRef.current;
    if (!controller) return;
    if (state.phase === "trial" || state.phase === "product" || state.phase === "calibration") return;
    void controller.pause().catch(() => undefined);
  }, [state.phase]);

  const handleConsent = async (version: string) => {
    if (!logger) return;
    setBusy(true);
    setBanner(null);
    try {
      const response = await recordConsent(sessionId, version);
      if (useRunnerStore.getState().sessionId !== sessionId || useRunnerStore.getState().abortReason) return;
      logger.log({ event_type: "consent", state_label: "mixed", meta: { version } });
      state.setSession(response.session);
      state.setParticipant({
        label: state.participant?.label ?? "Participant",
        consent_version: version,
        consented_at: new Date().toISOString()
      });
      state.setPhase("gaze_consent");
    } catch (consentError) {
      setBanner((consentError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleGazeConsent = async (cameraUsed: boolean) => {
    if (!state.session) return;
    setBusy(true);
    setBanner(null);
    try {
      const consent = grantGazeConsent({
        participant_id: state.session.participant_id,
        session_id: state.session.session_id,
        version: GAZE_CONSENT_VERSION,
        camera_used: cameraUsed
      });
      state.setGazeConsent(consent);
      state.setPhase("demographics");
    } catch (gazeConsentError) {
      setBanner((gazeConsentError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  function markGazeUnavailable(reason: GazeUnavailableReason) {
    const current = useRunnerStore.getState();
    if (current.sessionId !== sessionId || current.abortReason || current.gazeUnavailable) return false;
    loggerRef.current?.log({ event_type: "gaze_unavailable", state_label: "mixed", meta: { reason } });
    current.setGazeUnavailable(reason);
    gazeCalibratedRef.current = false;
    setGazeReady(false);
    return true;
  }

  const continueWithoutGaze = async (reason: GazeUnavailableReason) => {
    if (!markGazeUnavailable(reason)) return;
    setGazeStartError(null);
    setBanner(null);
    state.setPhase(reason === "consent_declined" ? "demographics" : state.calibrationResumePhase ?? "block_intro");
    void gazeRef.current?.stop().catch(() => undefined);
  };

  // Gaze continues whatever the calibration error; the stored error decides inclusion at analysis.
  const handleCalibrated = () => {
    if (useRunnerStore.getState().sessionId !== sessionId || useRunnerStore.getState().abortReason) return;
    gazeCalibratedRef.current = true;
    const resume = state.calibrationResumePhase ?? "block_intro";
    useRunnerStore.setState({ calibrationResumePhase: null });
    state.setPhase(resume);
  };

  const handleDemographics = async (data: Record<string, unknown>) => {
    if (!logger) return;
    setBusy(true);
    setBanner(null);
    try {
      const response = await submitDemographics(sessionId, data);
      if (useRunnerStore.getState().sessionId !== sessionId || useRunnerStore.getState().abortReason) return;
      logger.log({
        event_type: "demographics",
        state_label: "mixed",
        meta: { completed: true, prior_menu_experience: data.prior_menu_experience ?? [] }
      });
      if (response.design) state.setDesign(response.design);
      state.setSession(response.session);
      state.setPhase("baseline");
    } catch (demographicsError) {
      setBanner((demographicsError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleBaseline = async (payload: CheckinPayload) => {
    if (!logger) return;
    logger.log({ event_type: "checkin", state_label: "mixed", meta: { ...payload } });
    if (payload.distress > 6) {
      await stopForDistress("distress_at_baseline");
      return;
    }
    state.setCheckinPhase("baseline");
    state.setPhase("instructions");
  };

  const startPractice = () => {
    logger?.log({ event_type: "practice_start", state_label: "mixed", meta: { count: state.design?.practiceTrials.length ?? 0 } });
    state.startPractice();
  };

  const startBlock = () => {
    const block = state.design?.blocks[state.blockIndex];
    if (!block) {
      state.setPhase("questionnaires");
      return;
    }
    logger?.setContext({ block_id: block.blockId, state_label: block.stateLabel, menu_id: null, trial_id: null, task_id: null, target_id: null });
    logger?.log({
      event_type: "block_start",
      block_id: block.blockId,
      state_label: block.stateLabel,
      meta: { block_index: block.blockIndex, menu_ids: block.menuIds }
    });
    state.setPhase("induction");
  };

  const handleInductionComplete = () => {
    if (useRunnerStore.getState().sessionId !== sessionId || useRunnerStore.getState().abortReason) return;
    const block = state.design?.blocks[state.blockIndex];
    logger?.setContext({ block_id: block?.blockId ?? null, state_label: block?.stateLabel ?? "mixed" });
    state.setCheckinPhase("post_induction");
    state.setPhase("checkin");
  };

  const submitCheckin = async (payload: CheckinPayload) => {
    const block = state.design?.blocks[state.blockIndex];
    logger?.setContext({ block_id: block?.blockId ?? null, state_label: block?.stateLabel ?? "mixed" });
    logger?.log({
      event_type: "checkin",
      block_id: block?.blockId ?? null,
      state_label: block?.stateLabel ?? "mixed",
      meta: {
        ...payload,
        reported_state: reportedState(payload),
        manipulation_check_passed: manipulationCheckPassed(block?.stateLabel ?? "mixed", payload)
      }
    });
    if (payload.distress > 6) {
      await stopForDistress("distress_gt_6");
      return;
    }
    if (payload.phase === "baseline") {
      state.setPhase("instructions");
      return;
    }
    if (payload.phase === "post_induction") {
      state.setPhase(gazeCalibratedRef.current || state.gazeUnavailable ? "trial_intro" : "calibration");
      return;
    }
    state.setPhase("block_end");
  };

  const stopForDistress = async (reason: string) => {
    if (useRunnerStore.getState().abortReason || useRunnerStore.getState().phase === "complete") return;
    if (!logger) {
      state.abort(reason);
      return;
    }
    if (state.phase === "induction") {
      const block = state.design?.blocks[state.blockIndex];
      logger.log({
        event_type: "induction_end",
        block_id: block?.blockId ?? null,
        state_label: block?.stateLabel ?? "mixed",
        meta: { completed: false, distress_stop: true, stopped_by: "checkin_or_stop" }
      });
    }
    state.abort(reason);
    logger.interruptTrial(reason);
    try {
      await gazeRef.current?.stop();
      gazeRef.current = null;
    } catch {
      // Retain the controller so the debrief can retry unsaved gaze data.
    }
    setGazeReady(false);
    try {
      const response = await stopSession(sessionId, reason);
      state.setSession(response.session);
    } catch {
      // The local debrief still runs; the admin dashboard can reconcile the session.
    }
  };

  const handleStop = (reason: string) => {
    void stopForDistress(reason);
  };

  const finishPractice = () => {
    const lastPractice = state.practiceIndex + 1 >= (state.design?.practiceTrials.length ?? 0);
    state.nextPractice();
    if (lastPractice && !state.gazeUnavailable) state.setPhase("calibration");
  };

  const finishMainTrial = () => {
    state.nextTrial();
  };

  const finishBlock = () => {
    const block = state.design?.blocks[state.blockIndex];
    logger?.log({
      event_type: "block_end",
      block_id: block?.blockId ?? null,
      state_label: block?.stateLabel ?? "mixed",
      meta: { neutral_reset_completed: true }
    });
    state.finishBlock();
  };

  const submitAllQuestionnaires = async (responses: Array<Record<string, unknown>>) => {
    setBusy(true);
    setBanner(null);
    try {
      await submitQuestionnaires(responses);
      if (!useRunnerStore.getState().abortReason) state.setPhase("debrief");
    } catch (questionnaireError) {
      setBanner((questionnaireError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishDebrief = async () => {
    if (state.phase === "aborted" || state.abortReason) {
      try {
        if (state.stopSource === "participant" && state.session?.status !== "aborted" && state.session?.status !== "withdrawn") {
          const response = await stopSession(sessionId, state.abortReason ?? "participant_stop");
          state.setSession(response.session);
        }
        await gazeRef.current?.stop();
        gazeRef.current = null;
      } catch {
        setBanner("Eye-tracking data have not finished saving. Keep this page open and retry when connected.");
        return;
      }
      if (!(await logger?.flush())) {
        setBanner("Session data have not finished saving. Keep this page open and retry when connected.");
        return;
      }
      state.complete("STOPPED");
      return;
    }
    if (state.gazeConsent && !state.gazeUnavailable && !gazeFinalizedRef.current && !gazeRef.current) {
      setBusy(true);
      setBanner(null);
      try {
        await resumeGazeFinalization(sessionId);
        gazeFinalizedRef.current = true;
      } catch (error) {
        setBanner(`Eye-tracking data could not be finalized: ${(error as Error).message}. Keep this page open and retry; ask the researcher if recovery is unavailable.`);
        return;
      } finally {
        setBusy(false);
      }
    }
    if (gazeRef.current && !state.gazeUnavailable) {
      setBusy(true);
      setBanner(null);
      try {
        await gazeRef.current.complete();
        gazeFinalizedRef.current = true;
        gazeRef.current = null;
        setGazeReady(false);
      } catch (gazeCompleteError) {
        setBanner(
          `Eye-tracking data could not be saved: ${(gazeCompleteError as Error).message}. Do not close this page; ask the researcher to retry.`
        );
        return;
      } finally {
        setBusy(false);
      }
    }
    const code = completionLoggedRef.current ?? makeCode();
    if (!completionLoggedRef.current) {
      logger?.setContext({ state_label: "mixed", block_id: null, trial_id: null, task_id: null, target_id: null, menu_id: null });
      logger?.log({ event_type: "session_end", state_label: "mixed", meta: { completed: true, completion_code: code, wall_time_ms: Date.now() } });
      completionLoggedRef.current = code;
    }
    if (!(await logger?.flush())) {
      setBanner("Session data have not finished saving. Keep this page open and retry when connected.");
      return;
    }
    state.complete(code);
  };

  const handleWithdraw = async () => {
    setBusy(true);
    try {
      await gazeRef.current?.withdraw();
      gazeRef.current = null;
      setGazeReady(false);
      await withdrawSession(sessionId);
      clearGazeFinalization(sessionId);
      logger?.discard();
      state.abort("withdrawn", "participant");
    } catch (withdrawError) {
      setBanner(`Withdrawal could not finish: ${(withdrawError as Error).message}. Please retry.`);
      throw withdrawError;
    } finally {
      setBusy(false);
    }
  };

  const design = state.design;
  const finalTrial = design?.trials.at(-1);
  const session = state.session;
  const block = design?.blocks[state.blockIndex];
  const practice = design?.practiceTrials[state.practiceIndex];
  const mainTrial = block ? design?.trials.find((trial) => trial.trialId === block.trialIds[state.trialIndex]) : undefined;

  const practiceSpec: TrialInstruction | null = practice
    ? {
        trialId: practice.practiceId,
        blockId: "practice",
        menuId: practice.menuId,
        taskId: practice.taskId,
        targetId: practice.targetId,
        taskDescription: practice.taskDescription,
        stateLabel: "mixed",
        practice: true,
        trialIndex: state.practiceIndex
      }
    : null;
  const mainSpec: TrialInstruction | null = mainTrial
    ? {
        trialId: mainTrial.trialId,
        blockId: mainTrial.blockId,
        menuId: mainTrial.menuId,
        taskId: mainTrial.taskId,
        targetId: mainTrial.targetId,
        taskDescription: mainTrial.taskDescription,
        stateLabel: mainTrial.stateLabel,
        practice: false,
        trialIndex: mainTrial.trialIndex
      }
    : null;

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>Loading session…</p>
      </div>
    );
  }
  if (error || !session) {
    return (
      <div className="center-screen">
        <div className="panel narrow">
          <h1>Session unavailable</h1>
          <p>{error ?? "The session could not be loaded."}</p>
          <p className="small-note">Ask the researcher for a fresh participant link.</p>
        </div>
      </div>
    );
  }

  let content: React.ReactNode = null;
  if (state.phase === "consent") {
    content = <ConsentScreen onConsent={handleConsent} busy={busy} />;
  } else if (state.phase === "gaze_consent") {
    content = (
      <GazeConsentScreen
        onGrant={handleGazeConsent}
        onRefuse={() => continueWithoutGaze("consent_declined")}
        busy={busy}
        error={banner}
      />
    );
  } else if (state.phase === "calibration") {
    content = (
      <GazeCalibrationScreen
        controller={gazeReady ? gazeRef.current : null}
        starting={gazeStarting}
        startError={gazeStartError}
        onRetry={() => {
          setGazeStartError(null);
          setGazeAttempt((attempt) => attempt + 1);
        }}
        onCalibrated={handleCalibrated}
        onSkip={() => void continueWithoutGaze("camera_unavailable")}
      />
    );
  } else if (state.phase === "gaze_failed") {
    content = <GazeFailureScreen onContinue={() => void continueWithoutGaze("viewport_changed")} />;
  } else if (state.phase === "demographics") {
    content = <DemographicsScreen onSubmit={handleDemographics} busy={busy} />;
  } else if (state.phase === "baseline") {
    content = <CheckinScreen key="baseline" phase="baseline" onSubmit={handleBaseline} busy={busy} />;
  } else if (state.phase === "instructions") {
    content = <InstructionsScreen onStart={startPractice} />;
  } else if (state.phase === "practice_intro" && practiceSpec) {
    content = (
      <TrialRunner
        key={practiceSpec.trialId}
        spec={practiceSpec}
        colourMapping={design?.colourMapping ?? { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" }}
        logger={logger!}
        fastMode={fastMode}
        onComplete={finishPractice}
      />
    );
  } else if (state.phase === "block_intro" && block) {
    content = <BlockIntroScreen blockIndex={state.blockIndex} state={block.stateLabel as Exclude<StateLabel, "mixed">} onStart={startBlock} />;
  } else if (state.phase === "induction" && block) {
    content = (
      <InductionScreen
        key={block.blockId}
        state={block.stateLabel as Exclude<StateLabel, "mixed">}
        blockId={block.blockId}
        fastMode={fastMode}
        logger={logger!}
        onComplete={handleInductionComplete}
        onDistressStop={() => void stopForDistress("distress_during_induction")}
      />
    );
  } else if (state.phase === "checkin") {
    content = (
      <CheckinScreen
        key={`checkin-${state.blockIndex}-${state.checkinPhase}`}
        phase={state.checkinPhase}
        onSubmit={submitCheckin}
        busy={busy}
      />
    );
  } else if ((state.phase === "trial_intro" || state.phase === "trial" || state.phase === "product") && mainSpec) {
    content = (
      <TrialRunner
        key={mainSpec.trialId}
        spec={mainSpec}
        colourMapping={design?.colourMapping ?? { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" }}
        logger={logger!}
        fastMode={fastMode}
        gaze={state.gazeUnavailable ? undefined : gazeRef.current ?? undefined}
        onComplete={finishMainTrial}
      />
    );
  } else if (state.phase === "block_end" && block) {
    content = <NeutralResetScreen fastMode={fastMode} state={block.stateLabel as Exclude<StateLabel, "mixed">} onContinue={finishBlock} />;
  } else if (state.phase === "questionnaires" && finalTrial) {
    content = (
      <QuestionnairesScreen
        sessionId={sessionId}
        usabilityMenu={finalTrial.menuId}
        logger={logger!}
        fastMode={fastMode}
        busy={busy}
        onSubmit={submitAllQuestionnaires}
      />
    );
  } else if (state.phase === "debrief" || state.phase === "aborted") {
    content = (
      <DebriefScreen
        aborted={state.phase === "aborted"}
        reason={state.abortReason}
        stopSource={state.stopSource}
        completionCode={state.completionCode}
        busy={busy}
        onFinish={finishDebrief}
        onWithdraw={handleWithdraw}
      />
    );
  } else if (state.phase === "complete") {
    content = <CompleteScreen code={state.completionCode} aborted={Boolean(state.abortReason)} />;
  } else {
    content = (
      <div className="panel medium">
        <h1>Resume this session</h1>
        <p>The session is ready. Reload the page or ask the researcher if this screen does not advance.</p>
      </div>
    );
  }

  return (
    <SessionChrome
      session={session}
      phase={state.phase}
      blockIndex={state.blockIndex}
      trialIndex={state.trialIndex}
      fastMode={fastMode}
      onStop={handleStop}
    >
      {banner ? (
        <div className="banner error" role="alert">
          {banner}
          <button type="button" onClick={() => setBanner(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {content}
    </SessionChrome>
  );
}


