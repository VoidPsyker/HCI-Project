import { useState } from "react";
import { DEBRIEF_PARAGRAPHS } from "../content";

export function DebriefScreen({
  aborted,
  reason,
  completionCode,
  busy,
  onFinish,
  onWithdraw
}: {
  aborted: boolean;
  reason: string | null;
  completionCode: string | null;
  busy: boolean;
  onFinish: () => void;
  onWithdraw: () => Promise<void>;
}) {
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
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
      <h1>{aborted ? "Thank you for stopping" : "That is the end of the session"}</h1>
      {aborted ? (
        <div className="warning-box" role="alert">
          <strong>The session was stopped.</strong> Reason recorded: {reason ?? "participant stop"}. The researcher will
          check on you now. Nothing you did caused a problem.
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
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    await onWithdraw();
                    setWithdrawn(true);
                  })();
                }}
                data-testid="confirm-withdraw"
              >
                Yes, delete my data
              </button>
              <button type="button" className="button secondary" onClick={() => setConfirmWithdraw(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
        <button type="button" className="button primary" onClick={onFinish} disabled={busy} data-testid="finish-session">
          {aborted ? "Close debrief" : "Finish and mark complete"}
        </button>
      </div>
    </section>
  );
}
