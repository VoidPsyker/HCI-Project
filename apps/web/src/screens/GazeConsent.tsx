import { useState } from "react";
import { GAZE_CONSENT_PARAGRAPHS, GAZE_CONSENT_VERSION } from "../content";

/**
 * Separate, explicit gaze consent. No camera is touched here; the controller
 * only starts acquisition after this screen grants consent and the server
 * records it.
 */
export function GazeConsentScreen({
  onGrant,
  onRefuse,
  busy,
  error
}: {
  onGrant: (cameraUsed: boolean) => Promise<void>;
  onRefuse: () => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <section className="panel narrow" data-testid="gaze-consent-screen">
      <div className="eyebrow">Separate eye-tracking consent</div>
      <h1>Webcam eye tracking</h1>
      <div className="consent-copy">
        {GAZE_CONSENT_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {error ? (
        <div className="warning-box" role="alert">
          {error}
        </div>
      ) : null}
      <label className="check-row">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          data-testid="gaze-consent-checkbox"
        />
        <span>
          I agree to webcam eye tracking for this session. I understand that refusing means the scored search trials
          cannot run.
        </span>
      </label>
      <div className="panel-actions">
        <span className="small-note">Gaze consent version: {GAZE_CONSENT_VERSION}.</span>
        <div className="debrief-secondary">
          <button type="button" className="button danger-ghost" disabled={busy} onClick={() => void onRefuse()} data-testid="gaze-consent-refuse">
            Refuse and end session
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!agreed || busy}
            onClick={() => void onGrant(true)}
            data-testid="gaze-consent-grant"
          >
            {busy ? "Saving consent..." : "Agree and continue"}
          </button>
        </div>
      </div>
    </section>
  );
}
