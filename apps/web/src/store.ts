import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StudyDesign, SessionInfo, ParticipantInfo } from "./types";

export type RunnerPhase =
  | "loading"
  | "error"
  | "consent"
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
  startPractice: () => void;
  nextPractice: () => void;
  startBlock: (index: number) => void;
  nextTrial: () => void;
  finishBlock: () => void;
  complete: (code: string) => void;
  abort: (reason: string) => void;
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
  abortReason: null
};

function resumePhase(phase: RunnerPhase): RunnerPhase {
  if (phase === "practice_trial" || phase === "practice_result") return "practice_intro";
  if (phase === "trial" || phase === "product") return "trial_intro";
  return phase;
}

export const useRunnerStore = create<RunnerState>()(
  persist(
    (set, get) => ({
      ...initial,
      setBootstrap: ({ session, participant, design, fastMode }) => {
        const previous = get();
        const same = previous.sessionId === session.session_id;
        if (session.status === "completed") {
          set({ sessionId: session.session_id, session, participant, design, phase: "complete", fastMode });
          return;
        }
        if (session.status === "aborted" || session.status === "withdrawn") {
          set({
            sessionId: session.session_id,
            session,
            participant,
            design,
            phase: "aborted",
            fastMode,
            abortReason: session.abort_reason
          });
          return;
        }
        if (!participant?.consented_at) {
          set({ sessionId: session.session_id, session, participant, design, phase: "consent", fastMode });
          return;
        }
        if (!design) {
          set({ sessionId: session.session_id, session, participant, design: null, phase: "demographics", fastMode });
          return;
        }
        let phase: RunnerPhase = same ? resumePhase(previous.phase) : "baseline";
        if (phase === "loading" || phase === "error" || phase === "consent" || phase === "demographics") phase = "baseline";
        set({
          sessionId: session.session_id,
          session,
          participant,
          design,
          phase,
          fastMode,
          practiceIndex: same ? previous.practiceIndex : 0,
          blockIndex: same ? previous.blockIndex : 0,
          trialIndex: same ? previous.trialIndex : 0,
          checkinPhase: same ? previous.checkinPhase : "baseline",
          startedLogged: same ? previous.startedLogged : false
        });
      },
      setPhase: (phase) => set({ phase }),
      setSession: (session) => set({ session }),
      setDesign: (design) => set({ design }),
      setParticipant: (participant) => set({ participant }),
      setStartedLogged: (startedLogged) => set({ startedLogged }),
      setCheckinPhase: (checkinPhase) => set({ checkinPhase }),
      startPractice: () => set({ phase: "practice_intro", practiceIndex: 0 }),
      nextPractice: () => {
        const { practiceIndex, design } = get();
        if (!design) return;
        if (practiceIndex + 1 >= design.practiceTrials.length) set({ phase: "block_intro", blockIndex: 0 });
        else set({ practiceIndex: practiceIndex + 1, phase: "practice_intro" });
      },
      startBlock: (index) => {
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
        const { blockIndex, design } = get();
        if (!design) return;
        if (blockIndex + 1 >= design.blocks.length) set({ phase: "questionnaires" });
        else set({ blockIndex: blockIndex + 1, trialIndex: 0, phase: "block_intro" });
      },
      complete: (code) => set({ completionCode: code, phase: "complete" }),
      abort: (reason) => set({ abortReason: reason, phase: "aborted" }),
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
        abortReason: state.abortReason
      })
    }
  )
);
