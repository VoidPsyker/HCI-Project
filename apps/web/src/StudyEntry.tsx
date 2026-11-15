import { useRef, useState } from "react";
import { startStudySession } from "./api";

export function StudyEntry({ linkId }: { linkId: string }) {
  const startId = useRef<string | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      startId.current ??= crypto.randomUUID();
      const session = await startStudySession(linkId, startId.current);
      window.location.replace(`/run/${session.session_id}`);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "study_link_not_found"
        ? "This study link is invalid."
        : "Could not start the study. Please try again.");
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="home-shell">
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1>Meridian Timepieces study</h1>
          <button type="button" className="button primary big" disabled={busy} onClick={() => void start()}>
            {busy ? "Starting…" : "Start study"}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </section>
    </main>
  );
}
