import { useState, type ReactNode } from "react";
import type { RunnerPhase } from "../store";
import type { SessionInfo } from "../types";
import { TEST_MODE_NOTICE } from "../content";

const PHASE_LABEL: Record<RunnerPhase, string> = {
  loading: "Loading",
  error: "Error",
  consent: "Consent",
  gaze_consent: "Gaze consent",
  gaze_setup: "Screen setup",
  calibration: "Eye calibration",
  gaze_failed: "Gaze excluded",
  demographics: "Demographics",
  baseline: "Baseline affect",
  instructions: "Instructions",
  practice_intro: "Practice",
  practice_trial: "Practice trial",
  practice_result: "Practice",
  block_intro: "Emotion block",
  induction: "Emotion induction",
  checkin: "Check-in",
  trial_intro: "Trial",
  trial: "Trial",
  product: "Product",
  block_end: "Neutral reset",
  questionnaires: "Questionnaires",
  debrief: "Debrief",
  aborted: "Stopped",
  complete: "Complete"
};

export function SessionChrome({
  session,
  phase,
  blockIndex,
  trialIndex,
  fastMode,
  onStop,
  children
}: {
  session: SessionInfo;
  phase: RunnerPhase;
  blockIndex: number;
  trialIndex: number;
  fastMode: boolean;
  onStop: (reason: string) => void;
  children: ReactNode;
}) {
  const [showStop, setShowStop] = useState(false);
  return (
    <div className="session-shell" data-testid="session-shell">
      <header className="session-bar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            M
          </div>
          <div>
            <div className="brand-name">MERIDIAN</div>
            <div className="brand-sub">Timepieces · pilot</div>
          </div>
        </div>
        <div className="session-progress">
          <span className="phase-pill">{PHASE_LABEL[phase]}</span>
          <span className="progress-text">
            {phase === "block_intro" || phase === "induction" || phase === "checkin" || phase === "trial_intro" || phase === "trial"
              ? `Block ${blockIndex + 1} of 4 · Trial ${trialIndex + 1} of 3`
              : `Session ${session.session_id.slice(-6)}`}
          </span>
        </div>
        <div className="session-actions">
          {fastMode ? <span className="test-badge">{TEST_MODE_NOTICE}</span> : null}
          <button type="button" className="button stop" onClick={() => setShowStop(true)} data-testid="stop-control">
            Stop
          </button>
        </div>
      </header>
      <main className="session-main">{children}</main>
      {showStop ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stop-title" data-testid="stop-dialog">
            <div className="eyebrow">Stop control</div>
            <h2 id="stop-title">Do you want to stop?</h2>
            <p>
              You can stop at any time without giving a reason. If you stop, the session ends and the researcher will
              take you through the debrief. Partial data may be retained unless you ask for withdrawal.
            </p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setShowStop(false)} autoFocus>
                Keep going
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  setShowStop(false);
                  onStop("participant_stop");
                }}
                data-testid="confirm-stop"
              >
                End session and debrief
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
