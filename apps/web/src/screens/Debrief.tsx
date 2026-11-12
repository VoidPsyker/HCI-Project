import { useRef, useState } from "react";
import { DEBRIEF_PARAGRAPHS, DEBRIEF_STOPPED_TITLE, DEBRIEF_STOP_REASONS, DEBRIEF_STOP_SUPPORT } from "../content";

export function DebriefScreen({
  aborted,
  stopSource,
  reason,
  completionCode,
  busy,
  onFinish,
  onWithdraw
}: {
  aborted: boolean;
  stopSource: "participant" | "system" | null;
  reason: string | null;
  completionCode: string | null;
  busy: boolean;
  onFinish: () => void | Promise<void>;
  onWithdraw: () => Promise<void>;
}) {
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const withdrawing = useRef(false);
  const finished = useRef(false);
  const [saving, setSaving] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [error, setError] = useState(false);
  const withdraw = async () => {
    if (busy || withdrawing.current || finished.current) return;
    withdrawing.current = true;
    setSaving(true);
    setError(false);
    try {
      await onWithdraw();
      setWithdrawn(true);
    } catch {
      withdrawing.current = false;
      setSaving(false);
      setError(true);
    }
  };
  if (withdrawn) {
    return (
      <section className="panel narrow" data-testid="withdrawn-screen">
        <div className="eyebrow">Withdrawal complete</div>
        <h1>Your data have been deleted</h1>
        <p className="lede">
          The session record, raw event file, questionnaire answers and notes for this session have been removed. You
          may close this window. Thank you for taking part.
        </p>
      </section>
    );
  }
  return (
    <section className="panel wide debrief-panel" data-testid="debrief-screen">
      <div className="eyebrow">{aborted ? "Session stopped" : "Debrief"}</div>
      <h1>{aborted ? stopSource === "participant" ? "Thank you for taking part" : DEBRIEF_STOPPED_TITLE : "That is the end of the session"}</h1>
      {aborted ? (
        <div className="warning-box" role="alert">
          <strong>{DEBRIEF_STOP_REASONS[reason ?? "default"] ?? DEBRIEF_STOP_REASONS.default}</strong>{" "}
          {DEBRIEF_STOP_SUPPORT}
        </div>
      ) : null}
      <div className="debrief-copy">
        {DEBRIEF_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {completionCode && !aborted ? (
        <div className="completion-code">
          <span>Completion code</span>
          <strong>{completionCode}</strong>
          <small>Give this code to the researcher. It contains no personal data.</small>
        </div>
      ) : null}
      {finishError ? <p role="alert">The session could not be closed. Please try again.</p> : null}
      {error ? <p role="alert">Your data could not be deleted. Please try again or ask the researcher for help.</p> : null}
      <div className="panel-actions">
        <div className="debrief-secondary">
          {!confirmWithdraw ? (
            <button type="button" className="button danger-ghost" onClick={() => setConfirmWithdraw(true)}>
              Withdraw my data
            </button>
          ) : (
            <div className="withdraw-confirm" role="alertdialog" aria-label="Confirm withdrawal">
              <span>Delete all data from this session permanently?</span>
              <button
                type="button"
                className="button danger"
                disabled={busy || saving}
                onClick={() => void withdraw()}
                data-testid="confirm-withdraw"
              >
                Yes, delete my data
              </button>
              <button type="button" className="button secondary" disabled={busy || saving} onClick={() => setConfirmWithdraw(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
        <button type="button" className="button primary" onClick={() => {
          if (busy || withdrawing.current || finished.current) return;
          finished.current = true;
          setFinishError(false);
          void (async () => {
            try {
              await onFinish();
            } catch {
              setFinishError(true);
            } finally {
              finished.current = false;
            }
          })();
        }} disabled={busy || saving} data-testid="finish-session">
          {aborted ? "Close debrief" : "Finish and mark complete"}
        </button>
      </div>
    </section>
  );
}
