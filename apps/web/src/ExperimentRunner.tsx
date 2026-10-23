import { useEffect, useRef, useState } from "react";
import type { StateLabel } from "@meridian/scoring";
import { loadSession, loadSessionStatus, patchSessionState, recordConsent, stopSession, submitDemographics, submitQuestionnaires, withdrawSession } from "./api";
import { EventLogger } from "./logger";
import { useRunnerStore } from "./store";
import type { CheckinPayload, SessionInfo, StudyDesign } from "./types";
import { SessionChrome } from "./components/SessionChrome";
import { ConsentScreen } from "./screens/Consent";
import { DemographicsScreen } from "./screens/Demographics";
import { CheckinScreen } from "./screens/Checkin";
import { InductionScreen } from "./screens/Induction";
import { QuestionnairesScreen } from "./screens/Questionnaires";
import { DebriefScreen } from "./screens/Debrief";
import { BlockIntroScreen, CompleteScreen, InstructionsScreen, NeutralResetScreen } from "./screens/Interstitials";
import { TrialRunner, type TrialInstruction } from "./components/TrialRunner";

const SERVER_PHASE: Partial<Record<string, string>> = {
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
    if (!state.session || !state.session.participant_id) return;
    const instance = new EventLogger(state.session.participant_id, state.session.session_id);
    loggerRef.current = instance;
    setLogger(instance);
    return () => {
      instance.destroy();
      loggerRef.current = null;
      setLogger(null);
    };
  }, [state.session?.participant_id, state.session?.session_id]);

  useEffect(() => {
    if (!logger) return;
    const onUnload = () => {
      logger.interruptTrial("page_unload");
      logger.beacon();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [logger]);

  useEffect(() => {
    if (!logger || state.startedLogged) return;
    if (state.phase === "loading" || state.phase === "error" || state.phase === "consent") return;
    if (!state.participant?.consented_at) return;
    logger.log({
      event_type: "session_start",
      state_label: "mixed",
      meta: {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        fast_mode: fastMode,
        taxonomy_hash: state.design?.taxonomyHash ?? null,
        study: "pilot"
      }
    });
    state.setStartedLogged(true);
  }, [fastMode, logger, state]);

  useEffect(() => {
    if (!state.sessionId || !SERVER_PHASE[state.phase]) return;
    const timer = setTimeout(() => {
      void patchSessionState(state.sessionId!, { status: "in_progress", phase: SERVER_PHASE[state.phase] }).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [state.phase, state.sessionId]);

  useEffect(() => {
    if (!state.sessionId) return;
    const interval = setInterval(() => {
      void loadSessionStatus(state.sessionId!)
        .then((status) => {
          if ((status.status === "aborted" || status.status === "withdrawn") && state.phase !== "aborted" && state.phase !== "complete") {
            state.abort(status.abort_reason ?? "stopped_by_server");
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(interval);
    // The poll only needs the id and a stable action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId, state.phase]);

  const handleConsent = async (version: string) => {
    if (!logger) return;
    setBusy(true);
    setBanner(null);
    try {
      const response = await recordConsent(sessionId, version);
      logger.log({ event_type: "consent", state_label: "mixed", meta: { version } });
      state.setSession(response.session);
      state.setParticipant({
        label: state.participant?.label ?? "Participant",
        consent_version: version,
        consented_at: new Date().toISOString()
      });
      state.setPhase("demographics");
    } catch (consentError) {
      setBanner((consentError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDemographics = async (data: Record<string, unknown>) => {
    if (!logger) return;
    setBusy(true);
    setBanner(null);
    try {
      const response = await submitDemographics(sessionId, data);
      logger.log({ event_type: "demographics", state_label: "mixed", meta: { completed: true } });
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
      meta: { ...payload }
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
      state.setPhase("trial_intro");
      return;
    }
    state.setPhase("block_end");
  };

  const stopForDistress = async (reason: string) => {
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
    logger.interruptTrial(reason);
    try {
      await stopSession(sessionId, reason);
    } catch {
      // The local debrief still runs; the admin dashboard can reconcile the session.
    }
    state.abort(reason);
  };

  const handleStop = (reason: string) => {
    void stopForDistress(reason);
  };

  const finishPractice = () => {
    state.nextPractice();
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
      state.setPhase("debrief");
    } catch (questionnaireError) {
      setBanner((questionnaireError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishDebrief = async () => {
    if (state.phase === "aborted" || state.abortReason) {
      state.complete("STOPPED");
      return;
    }
    const code = makeCode();
    logger?.setContext({ state_label: "mixed", block_id: null, trial_id: null, task_id: null, target_id: null, menu_id: null });
    logger?.log({ event_type: "session_end", state_label: "mixed", meta: { completed: true, completion_code: code } });
    try {
      await patchSessionState(sessionId, { status: "completed", phase: "debrief" });
    } catch {
      // Ingestion of session_end already marks the session complete.
    }
    await logger?.flush();
    state.complete(code);
  };

  const handleWithdraw = async () => {
    setBusy(true);
    try {
      logger?.discard();
      await withdrawSession(sessionId);
      state.reset();
    } finally {
      setBusy(false);
    }
  };

  const design = state.design;
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
        stateLabel: "happy",
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
        <p>Loading sessionâ€¦</p>
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
        onComplete={finishMainTrial}
      />
    );
  } else if (state.phase === "block_end") {
    content = <NeutralResetScreen fastMode={fastMode} onContinue={finishBlock} />;
  } else if (state.phase === "questionnaires") {
    content = (
      <QuestionnairesScreen sessionId={sessionId} logger={logger!} fastMode={fastMode} busy={busy} onSubmit={submitAllQuestionnaires} />
    );
  } else if (state.phase === "debrief" || state.phase === "aborted") {
    content = (
      <DebriefScreen
        aborted={state.phase === "aborted"}
        reason={state.abortReason}
        completionCode={state.completionCode}
        busy={busy}
        onFinish={() => void finishDebrief()}
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
            Ã—
          </button>
        </div>
      ) : null}
      {content}
    </SessionChrome>
  );
}


