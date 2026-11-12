import { useRef, useState } from "react";
import { CONSENT_PARAGRAPHS, CONSENT_VERSION } from "../content";

export function ConsentScreen({ onConsent, busy }: { onConsent: (version: string) => Promise<void>; busy: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const submit = async () => {
    if (!agreed || busy || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(false);
    try {
      await onConsent(CONSENT_VERSION);
    } catch {
      setError(true);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
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
      {error ? <p role="alert">Consent could not be saved. Please try again.</p> : null}
      <div className="panel-actions">
        <span className="small-note">Version: {CONSENT_VERSION}. Placeholder pending ethics approval.</span>
        <button
          type="button"
          className="button primary"
          disabled={!agreed || busy || saving}
          onClick={() => void submit()}
          data-testid="consent-continue"
        >
          {busy || saving ? "Saving…" : "Continue to eye-tracking consent"}
        </button>
      </div>
    </section>
  );
}
