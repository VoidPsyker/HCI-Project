import { useState } from "react";
import { CONSENT_PARAGRAPHS, CONSENT_VERSION } from "../content";

export function ConsentScreen({ onConsent, busy }: { onConsent: (version: string) => Promise<void>; busy: boolean }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <section className="panel narrow" data-testid="consent-screen">
      <div className="eyebrow">Before we begin</div>
      <h1>Information and consent</h1>
      <div className="consent-copy">
        {CONSENT_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>I have read the placeholder information and agree to take part.</span>
      </label>
      <div className="panel-actions">
        <span className="small-note">Version: {CONSENT_VERSION}. Placeholder pending ethics approval.</span>
        <button
          type="button"
          className="button primary"
          disabled={!agreed || busy}
          onClick={() => void onConsent(CONSENT_VERSION)}
          data-testid="consent-continue"
        >
          {busy ? "Saving…" : "Continue to eye-tracking consent"}
        </button>
      </div>
    </section>
  );
}
