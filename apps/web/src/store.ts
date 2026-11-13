import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GazeUnavailableReason } from "@meridian/scoring";
import type { GazeConsent } from "@meridian/analysis";
import type { StudyDesign, SessionInfo, ParticipantInfo } from "./types";

export type RunnerPhase =
  | "loading"
  | "error"
  | "consent"
  | "gaze_consent"
  | "calibration"
  | "gaze_failed"
  | "demographics"
  | "baseline"
  | "instructions"
  | "practice_intro"
  | "practice_trial"
  | "practice_result"
  | "block_intro"
  | "induction"
  | "checkin"
  | "trial_intro"
  | "trial"
  | "product"
  | "block_end"
  | "questionnaires"
  | "debrief"
  | "aborted"
  | "complete";

interface RunnerState {
  sessionId: string | null;
  session: SessionInfo | null;
  participant: ParticipantInfo | null;
  design: StudyDesign | null;
  phase: RunnerPhase;
  practiceIndex: number;
  blockIndex: number;
  trialIndex: number;
  checkinPhase: "baseline" | "post_induction" | "post_trials";
  startedLogged: boolean;
  fastMode: boolean;
  completionCode: string | null;
  abortReason: string | null;
  stopSource: "participant" | "system" | null;
  calibrationResumePhase: RunnerPhase | null;
  gazeConsent: GazeConsent | null;
  gazeUnavailable: GazeUnavailableReason | null;
  setBootstrap: (bundle: {
    session: SessionInfo;
    participant: ParticipantInfo | null;
    design: StudyDesign | null;
    fastMode: boolean;
  }) => void;
  setPhase: (phase: RunnerPhase) => void;
  setSession: (session: SessionInfo) => void;
  setDesign: (design: StudyDesign) => void;
  setParticipant: (participant: ParticipantInfo | null) => void;
  setStartedLogged: (value: boolean) => void;
  setCheckinPhase: (phase: "baseline" | "post_induction" | "post_trials") => void;
  setGazeConsent: (consent: GazeConsent) => void;
  setGazeUnavailable: (reason: GazeUnavailableReason) => void;
  clearGaze: () => void;
  startPractice: () => void;
  nextPractice: () => void;
  startBlock: (index: number) => void;
  nextTrial: () => void;
  finishBlock: () => void;
  complete: (code: string) => void;
  abort: (reason: string, source?: "participant" | "system") => void;
  reset: () => void;
}

const initial = {
  sessionId: null,
  session: null,
  participant: null,
  design: null,
  phase: "loading" as RunnerPhase,
  practiceIndex: 0,
  blockIndex: 0,
  trialIndex: 0,
  checkinPhase: "baseline" as const,
  startedLogged: false,
  fastMode: false,
  completionCode: null,
  abortReason: null,
  stopSource: null,
  calibrationResumePhase: null,
  gazeConsent: null,
  gazeUnavailable: null
};

function resumePhase(phase: RunnerPhase, hasGaze: boolean): RunnerPhase {
  if (phase === "practice_trial" || phase === "practice_result") return "practice_intro";
  if (phase === "trial" || phase === "product" || phase === "trial_intro") return hasGaze ? "calibration" : "trial_intro";
  if (phase === "calibration" || phase === "gaze_failed") return hasGaze ? "calibration" : "block_intro";
  return phase;
}

export const useRunnerStore = create<RunnerState>()(
  persist(
    (set, get) => ({
      ...initial,
      setBootstrap: ({ session, participant, design, fastMode }) => {
        const previous = get();
        // Older builds could persist a previous run's stop reason on an active page.
        const staleStop = previous.abortReason !== null && previous.phase !== "aborted" && previous.phase !== "complete";
        const same = previous.sessionId === session.session_id && !staleStop;
        const restore = (patch: Partial<RunnerState>) => set(same ? patch : { ...initial, ...patch });
        const gazeConsent = same ? previous.gazeConsent : null;
        const gazeUnavailable = same ? previous.gazeUnavailable : null;
        if (session.status === "completed") {
          restore({
            sessionId: session.session_id,
            session,
            participant,
            design,
            phase: "complete",
            fastMode,
            gazeConsent
          });
          return;
        }
        if (session.status === "aborted" || session.status === "withdrawn") {
          restore({
            sessionId: session.session_id,
            session,
            participant,
            design,
            phase: "aborted",
            fastMode,
            abortReason: session.abort_reason ?? "stopped_by_server",
            stopSource: same && previous.stopSource ? previous.stopSource : session.abort_reason === "participant_stop" || session.abort_reason?.startsWith("distress_") ? "participant" : "system",
            gazeConsent
          });
          return;
        }
        if (!participant?.consented_at) {
          restore({
            sessionId: session.session_id,
            session,
            participant,
            design,
            phase: "consent",
            fastMode,
            gazeConsent: null
          });
          return;
        }
        if (!gazeConsent && !gazeUnavailable) {
          restore({
            sessionId: session.session_id,
            session,
            participant,
            design,
            phase: "gaze_consent",
            fastMode,
            gazeConsent: null
          });
          return;
        }
        if (!design) {
          restore({
            sessionId: session.session_id,
            session,
            participant,
            design: null,
            phase: "demographics",
            fastMode,
            gazeConsent
          });
          return;
        }
        const blockIndex = same ? previous.blockIndex : 0;
        let phase: RunnerPhase = same ? resumePhase(previous.phase, !gazeUnavailable) : "baseline";
        if (
          phase === "loading" ||
          phase === "error" ||
          phase === "consent" ||
          phase === "demographics" ||
          phase === "gaze_consent"
        ) {
          phase = "baseline";
        }
        const needsCalibration =
          phase === "block_intro" ||
          phase === "induction" ||
          (phase === "checkin" && previous.checkinPhase !== "baseline") ||
          (phase === "block_end" && blockIndex + 1 < design.blocks.length);
        const calibrationResumePhase = same && previous.phase === "calibration"
          ? previous.calibrationResumePhase
          : previous.phase === "trial" || previous.phase === "product" || previous.phase === "trial_intro"
            ? "trial_intro"
            : previous.phase === "induction" ? "block_intro" : previous.phase;
        if (needsCalibration && !gazeUnavailable) phase = "calibration";
        restore({
          sessionId: session.session_id,
          session,
          participant,
          design,
          phase,
          calibrationResumePhase: phase === "calibration" ? calibrationResumePhase : null,
          fastMode,
          practiceIndex: same ? previous.practiceIndex : 0,
          blockIndex,
          trialIndex: same ? previous.trialIndex : 0,
          checkinPhase: same ? previous.checkinPhase : "baseline",
          startedLogged: same ? previous.startedLogged : false,
          gazeConsent
        });
      },
      setPhase: (phase) => {
        if (get().abortReason || get().phase === "complete") return;
        set({ phase });
      },
      setSession: (session) => set({ session }),
      setDesign: (design) => set({ design }),
      setParticipant: (participant) => set({ participant }),
      setStartedLogged: (startedLogged) => set({ startedLogged }),
      setCheckinPhase: (checkinPhase) => set({ checkinPhase }),
      setGazeConsent: (gazeConsent) => set({ gazeConsent }),
      setGazeUnavailable: (gazeUnavailable) => set({ gazeUnavailable }),
      clearGaze: () => set({ gazeConsent: null }),
      startPractice: () => {
        if (get().abortReason || get().phase === "complete") return;
        set({ phase: "practice_intro", practiceIndex: 0 });
      },
      nextPractice: () => {
        if (get().abortReason || get().phase === "complete") return;
        const { practiceIndex, design } = get();
        if (!design) return;
        if (practiceIndex + 1 >= design.practiceTrials.length) set({ phase: "block_intro", blockIndex: 0 });
        else set({ practiceIndex: practiceIndex + 1, phase: "practice_intro" });
      },
      startBlock: (index) => {
        if (get().abortReason || get().phase === "complete") return;
        const { design } = get();
        if (!design) return;
        const block = design.blocks[index];
        if (!block) {
          set({ phase: "questionnaires" });
          return;
        }
        set({ blockIndex: index, trialIndex: 0, phase: "block_intro" });
      },
      nextTrial: () => {
        if (get().abortReason || get().phase === "complete") return;
        const { trialIndex, blockIndex, design } = get();
        if (!design) return;
        const block = design.blocks[blockIndex];
        if (!block) return;
        if (trialIndex + 1 >= block.trialIds.length) {
          set({ phase: "checkin", checkinPhase: "post_trials" });
        } else {
          set({ trialIndex: trialIndex + 1, phase: "trial_intro" });
        }
      },
      finishBlock: () => {
        if (get().abortReason || get().phase === "complete") return;
        const { blockIndex, design } = get();
        if (!design) return;
        if (blockIndex + 1 >= design.blocks.length) set({ phase: "questionnaires" });
        else set({ blockIndex: blockIndex + 1, trialIndex: 0, phase: "block_intro" });
      },
      complete: (code) => set({ completionCode: code, phase: "complete" }),
      abort: (reason, source = "participant") => set({ abortReason: reason, stopSource: source, phase: "aborted" }),
      reset: () => set({ ...initial })
    }),
    {
      name: "meridian.runner.v2",
      partialize: (state) => ({
        sessionId: state.sessionId,
        session: state.session,
        participant: state.participant,
        design: state.design,
        phase: state.phase,
        practiceIndex: state.practiceIndex,
        blockIndex: state.blockIndex,
        trialIndex: state.trialIndex,
        checkinPhase: state.checkinPhase,
        startedLogged: state.startedLogged,
        fastMode: state.fastMode,
        completionCode: state.completionCode,
        abortReason: state.abortReason,
        stopSource: state.stopSource,
        calibrationResumePhase: state.calibrationResumePhase,
        gazeConsent: state.gazeConsent,
        gazeUnavailable: state.gazeUnavailable
      })
    }
  )
);
