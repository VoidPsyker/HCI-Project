import { useEffect, useState } from "react";

function lastSessionId(): string | null {
  try {
    const raw = localStorage.getItem("meridian.runner.v2");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { sessionId?: string | null } };
    return parsed.state?.sessionId ?? null;
  } catch {
    return null;
  }
}

export function Home() {
  const [resume, setResume] = useState<string | null>(null);
  useEffect(() => setResume(lastSessionId()), []);
  return (
    <div className="home-shell">
      <header className="home-nav">
        <div className="brand-lockup">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">MERIDIAN</div>
            <div className="brand-sub">Timepieces · pilot instrument</div>
          </div>
        </div>
        <nav className="home-nav-links" aria-label="Primary">
          <a href="/admin">Researcher console</a>
          <a href="/lab">Menu lab</a>
          <a href="#evidence">Evidence</a>
        </nav>
      </header>

      <main>
        <section className="home-hero">
          <div className="home-hero-copy">
            <div className="eyebrow">Emotion-contingent navigation · pilot</div>
            <h1>Six menus. Four moods. One searching study.</h1>
            <p className="home-lede">
              A complete, local-first pilot instrument for the Meridian Timepieces study. It runs consent, emotion
              scenarios, twelve scored searches, questionnaires, logging, and the researcher dashboard without any
              external network requests during trials.
            </p>
            <div className="home-actions">
              <a className="button primary big" href="/admin">
                Start a participant session
              </a>
              <a className="button secondary big" href="/lab">
                Inspect the menus
              </a>
              {resume ? (
                <a className="button quiet" href={`/run/${resume}`}>
                  Resume last session
                </a>
              ) : null}
            </div>
            <div className="home-facts">
              <span>12 scored trials</span>
              <span>6 balanced menus</span>
              <span>≤ 100 minutes</span>
              <span>Webcam eye tracking · separate consent</span>
            </div>
          </div>
          <div className="home-hero-art" aria-hidden="true">
            <div className="hero-orbit hero-orbit-1" />
            <div className="hero-orbit hero-orbit-2" />
            <div className="hero-watch">M</div>
            <div className="hero-label">Research build · 2026</div>
          </div>
        </section>

        <section className="home-grid">
          <article className="home-card">
            <span className="home-card-number">01</span>
            <h2>Participant run</h2>
            <p>
              Consent, separate gaze consent, measured screen setup, calibration, demographics, baseline affect, six
              practice trials, four counterbalanced scenarios, twelve scored trials, check-ins, neutral resets,
              questionnaires, and debrief.
            </p>
            <a href="/admin">Create a link →</a>
          </article>
          <article className="home-card">
            <span className="home-card-number">02</span>
            <h2>Researcher console</h2>
            <p>
              Live session status, sequence and stratum audit, distress flags, notes, abort, withdrawal, QA/go-no-go,
              and checksummed CSV/JSONL exports.
            </p>
            <a href="/admin">Open console →</a>
          </article>
          <article className="home-card">
            <span className="home-card-number">03</span>
            <h2>Menu lab</h2>
            <p>
              Click through A–F over the same 72-product taxonomy. Switch the colour mapping and state context to
              inspect parity and transition behaviour.
            </p>
            <a href="/lab">Open lab →</a>
          </article>
        </section>

        <section className="home-evidence" id="evidence">
          <div>
            <div className="eyebrow">Evidence before claims</div>
            <h2>Local-first, reconstructable, and resumable.</h2>
          </div>
          <ul>
            <li>Server-assigned sequences recorded in <code>assignments_audit</code>.</li>
            <li>Every raw event appended to <code>data/raw/&lt;session_id&gt;.jsonl</code>.</li>
            <li>Trials are recomputed from events, so a browser crash does not lose the path.</li>
            <li>Reduced-motion support, visible Stop control, and a distress threshold that stops the induction.</li>
            <li>Gaze is stored separately with restricted access; raw video is never recorded, and a failed calibration blocks scored trials.</li>
            <li>No external requests: all fonts, icons, illustrations, WebGazer assets, and data are local.</li>
          </ul>
        </section>
      </main>

      <footer className="home-footer">
        <span>Meridian Timepieces pilot instrument</span>
        <span>Ethics copy is a placeholder until approval. Do not collect real participant data yet.</span>
      </footer>
    </div>
  );
}
