import { useCallback, useEffect, useState } from "react";
import type { AdminSession, QaCriterion, QaReport } from "../types";
import {
  abortAdminSession,
  addAdminNote,
  createAdminSession,
  deleteAdminSession,
  downloadExport,
  getAdminSessions,
  getGoNoGo,
  getQa
} from "../api";

const STORAGE_KEY = "meridian.admin.password";
const EXPORTS = ["events.jsonl", "events.csv", "trials.jsonl", "trials.csv", "checkins.jsonl", "checkins.csv", "questionnaires.jsonl", "questionnaires.csv", "assignments.csv", "tasks.csv", "manifest"];

const STATUS_LABEL: Record<string, string> = {
  created: "Created",
  consented: "Consented",
  in_progress: "In progress",
  completed: "Completed",
  aborted: "Stopped",
  withdrawn: "Withdrawn"
};

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AdminDashboard() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(STORAGE_KEY) ?? "");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [qa, setQa] = useState<QaReport | null>(null);
  const [goNoGo, setGoNoGo] = useState<QaCriterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminSession | null>(null);
  const [note, setNote] = useState("");
  const [abortTarget, setAbortTarget] = useState<AdminSession | null>(null);
  const [abortReason, setAbortReason] = useState("researcher_stop");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const load = useCallback(async (key: string) => {
    const [sessionResponse, qaResponse, goResponse] = await Promise.all([
      getAdminSessions(key),
      getQa(key),
      getGoNoGo(key)
    ]);
    setSessions(sessionResponse.sessions);
    setQa(qaResponse);
    setGoNoGo(goResponse.criteria);
    setError(null);
  }, []);

  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    setBusy((current) => current ?? "refresh");
    load(password)
      .catch((loadError: Error) => {
        if (cancelled) return;
        if (loadError.message === "admin_password_required") {
          sessionStorage.removeItem(STORAGE_KEY);
          setPassword("");
          setError("That password was not accepted.");
        } else {
          setError(loadError.message);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [load, password]);

  useEffect(() => {
    if (!password) return;
    const interval = setInterval(() => {
      void load(password).catch(() => undefined);
    }, 10_000);
    return () => clearInterval(interval);
  }, [load, password]);

  const refresh = () => {
    if (!password) return;
    void load(password).catch((refreshError: Error) => setError(refreshError.message));
  };

  if (!password) {
    return (
      <div className="admin-gate">
        <div className="panel narrow">
          <div className="brand-lockup admin-brand">
            <div className="brand-mark">M</div>
            <div>
              <div className="brand-name">MERIDIAN</div>
              <div className="brand-sub">Researcher console</div>
            </div>
          </div>
          <h1>Admin sign-in</h1>
          <p className="lede">Enter the researcher password from the server environment. The default local value is pilot-admin.</p>
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              sessionStorage.setItem(STORAGE_KEY, passwordDraft);
              setPassword(passwordDraft);
              setError(null);
            }}
          >
            <label className="field">
              <span>Admin password</span>
              <input
                type="password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error ? <div className="banner error">{error}</div> : null}
            <button type="submit" className="button primary">
              Open dashboard
            </button>
          </form>
          <p className="small-note">
            <a href="/">← Back to the pilot home</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <div className="eyebrow">Meridian Timepieces · pilot</div>
          <h1>Researcher console</h1>
          <p className="small-note">Sessions, data quality, go/no-go checks, and exports. Local only.</p>
        </div>
        <div className="admin-header-actions">
          <a className="button secondary" href="/lab">
            Menu lab
          </a>
          <button type="button" className="button secondary" onClick={refresh} disabled={busy === "refresh"}>
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              sessionStorage.removeItem(STORAGE_KEY);
              setPassword("");
              setSessions([]);
              setQa(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="banner warning" role="note" data-testid="ethics-banner">
        Pilot build, ethics approval required before real participants.
      </div>

      {error ? (
        <div className="banner error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      ) : null}

      <section className="admin-grid admin-summary">
        <div className="stat-card">
          <span>Total sessions</span>
          <strong>{qa?.sessions.total ?? sessions.length}</strong>
        </div>
        <div className="stat-card">
          <span>Completed</span>
          <strong>{qa?.sessions.completed ?? sessions.filter((s) => s.status === "completed").length}</strong>
        </div>
        <div className="stat-card">
          <span>In progress</span>
          <strong>{qa?.sessions.in_progress ?? sessions.filter((s) => s.status === "in_progress").length}</strong>
        </div>
        <div className="stat-card">
          <span>Stopped / withdrawn</span>
          <strong>{(qa?.sessions.aborted ?? 0) + sessions.filter((s) => s.status === "withdrawn").length}</strong>
        </div>
        <div className={`stat-card overall ${qa?.overall ?? ""}`}>
          <span>QA overall</span>
          <strong>{qa?.overall ?? "—"}</strong>
          <small>{qa ? `${qa.criteria.filter((c) => c.status === "pass").length}/${qa.criteria.length} criteria pass` : ""}</small>
        </div>
      </section>

      <section className="admin-section">
        <div className="section-head">
          <div>
            <h2>New participant</h2>
            <p className="small-note">Assignments are generated on this server and recorded in assignments_audit.</p>
          </div>
        </div>
        <form
          className="create-row"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy("create");
            setCreatedUrl(null);
            void createAdminSession(password, label.trim() || undefined)
              .then((response) => {
                setCreatedUrl(`${window.location.origin}${response.participant_url}`);
                setLabel("");
                refresh();
              })
              .catch((createError: Error) => setError(createError.message))
              .finally(() => setBusy(null));
          }}
        >
          <label className="field">
            <span>Participant label (optional)</span>
            <input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. P09" />
          </label>
          <button type="submit" className="button primary" disabled={busy === "create"} data-testid="create-session">
            {busy === "create" ? "Creating…" : "Create session link"}
          </button>
        </form>
        {createdUrl ? (
          <div className="created-link" data-testid="created-link">
            <span>Participant link</span>
            <code>{createdUrl}</code>
            <button
              type="button"
              className="button tiny"
              onClick={() => void navigator.clipboard?.writeText(createdUrl)}
            >
              Copy
            </button>
            <a className="button tiny" href={createdUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        ) : null}
      </section>

      <section className="admin-section">
        <div className="section-head">
          <div>
            <h2>Sessions</h2>
            <p className="small-note">Progress updates every ten seconds. Click a row to open the note panel.</p>
          </div>
          <span className="small-note">{sessions.length} rows</span>
        </div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Participant</th>
                <th>Status</th>
                <th>Phase</th>
                <th>Sequence</th>
                <th>Latest</th>
                <th>Events</th>
                <th>Trials</th>
                <th>Last event</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.session_id}
                  className={selected?.session_id === session.session_id ? "selected-row" : undefined}
                  onClick={() => {
                    setSelected(session);
                    setNote("");
                  }}
                >
                  <td>
                    <strong>{session.label}</strong>
                    <small className="mono">{session.session_id.slice(-8)}</small>
                  </td>
                  <td>
                    <span className={`status-badge status-${session.status}`}>{STATUS_LABEL[session.status] ?? session.status}</span>
                    {session.checkin_distress !== null && session.checkin_distress > 6 ? (
                      <small className="danger-text">distress {session.checkin_distress}/10</small>
                    ) : null}
                    {(session.stuck_seconds ?? 0) >= 60 ? (
                      <small className="danger-text" data-testid="stuck-flag">stuck {session.stuck_seconds}s</small>
                    ) : null}
                    {session.viewport_warning ? (
                      <small className="danger-text" data-testid="viewport-warning">{session.viewport_warning}</small>
                    ) : null}
                  </td>
                  <td>{session.phase}</td>
                  <td>
                    {session.sequence_index ?? "—"}
                    <small className="mono">{session.sequence_id ?? ""}</small>
                  </td>
                  <td>
                    {session.latest_event_type ?? "—"}
                    <small>
                      {session.latest_menu_id ? `Menu ${session.latest_menu_id}` : ""}
                      {session.latest_state_label ? ` · ${session.latest_state_label}` : ""}
                    </small>
                  </td>
                  <td>{session.event_count}</td>
                  <td>{session.trial_count}</td>
                  <td>{formatTime(session.last_event_at)}</td>
                  <td>
                    <div className="table-actions" onClick={(event) => event.stopPropagation()}>
                      <a className="button tiny" href={`/run/${session.session_id}`} target="_blank" rel="noreferrer">
                        Open
                      </a>
                      <button
                        type="button"
                        className="button tiny danger-ghost"
                        onClick={() => {
                          setAbortTarget(session);
                          setAbortReason("researcher_stop");
                        }}
                      >
                        Abort &amp; debrief
                      </button>
                      <button
                        type="button"
                        className="button tiny quiet"
                        onClick={() => {
                          if (!window.confirm(`Delete all data for ${session.label}? This cannot be undone.`)) return;
                          void deleteAdminSession(password, session.session_id)
                            .then(() => {
                              if (selected?.session_id === session.session_id) setSelected(null);
                              refresh();
                            })
                            .catch((deleteError: Error) => setError(deleteError.message));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-cell">No sessions yet. Create one above or run npm run seed.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-two-col">
        <section className="admin-section">
          <div className="section-head">
            <div>
              <h2>QA and go/no-go</h2>
              <p className="small-note">Generated {qa ? new Date(qa.generated_at).toLocaleString("en-GB") : "—"}.</p>
            </div>
            <span className={`status-badge overall-${qa?.overall ?? "na"}`}>{qa?.overall ?? "—"}</span>
          </div>
          {qa ? (
            <>
              <div className="qa-counts">
                <span>{qa.counts.events} events</span>
                <span>{qa.counts.main_trials} main trials</span>
                <span>{qa.counts.questionnaires} questionnaire rows</span>
                <span>{qa.counts.checkins} check-ins</span>
              </div>
              <ul className="criteria-list">
                {qa.criteria.map((criterion) => (
                  <li key={criterion.id} className={`criterion criterion-${criterion.status}`}>
                    <span className="criterion-status">{criterion.status}</span>
                    <div>
                      <strong>{criterion.label}</strong>
                      <small>
                        {criterion.value} · target {criterion.threshold}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
              <h3>Technical QA</h3>
              <div className="detail-grid qa-grid" data-testid="technical-qa">
                {Object.entries(qa.data_quality).map(([key, value]) => (
                  <div key={key}>
                    <span>{key.replace(/_/g, " ")}</span>
                    <strong>{value ?? "—"}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="small-note">Loading QA…</p>
          )}
        </section>

        <section className="admin-section">
          <div className="section-head">
            <div>
              <h2>Pilot go/no-go</h2>
              <p className="small-note">Fixed criteria from the research plan.</p>
            </div>
          </div>
          <ul className="criteria-list">
            {goNoGo.map((criterion) => (
              <li key={criterion.id} className={`criterion criterion-${criterion.status}`}>
                <span className="criterion-status">{criterion.status}</span>
                <div>
                  <strong>{criterion.label}</strong>
                  <small>
                    {criterion.value} · target {criterion.threshold}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {qa ? (
        <section className="admin-section" data-testid="calibration-table">
          <div className="section-head">
            <div>
              <h2>Task calibration</h2>
              <p className="small-note">Main trials only. Median time is over successful trials.</p>
            </div>
          </div>
          <div className="admin-two-col">
            {([
              ["By task", qa.calibration.by_task],
              ["By menu", qa.calibration.by_menu]
            ] as const).map(([title, rows]) => (
              <div key={title} className="table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{title}</th>
                      <th>n</th>
                      <th>Success</th>
                      <th>Median time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          {row.key}
                          {row.difficulty ? <small>{row.difficulty}</small> : null}
                        </td>
                        <td>{row.n}</td>
                        <td>{row.success_pct === null ? "—" : `${row.success_pct}%`}</td>
                        <td>{row.median_success_s === null ? "—" : `${row.median_success_s} s`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="admin-section">
        <div className="section-head">
          <div>
            <h2>Exports</h2>
            <p className="small-note">Every download is generated from the database with a SHA-256 checksum.</p>
          </div>
          {exportStatus ? <span className="small-note">{exportStatus}</span> : null}
        </div>
        <div className="export-grid">
          {EXPORTS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="export-card"
              disabled={busy === `export-${kind}`}
              onClick={() => {
                setBusy(`export-${kind}`);
                setExportStatus(null);
                void downloadExport(password, kind)
                  .then((file) => {
                    download(file.blob, kind === "manifest" ? "manifest.json" : kind);
                    setExportStatus(`${kind}: ${file.rows || "?"} rows · SHA-256 ${file.checksum.slice(0, 16)}…`);
                  })
                  .catch((exportError: Error) => setError(exportError.message))
                  .finally(() => setBusy(null));
              }}
            >
              <span>{kind}</span>
              <small>{kind.endsWith(".jsonl") ? "NDJSON" : kind.endsWith(".csv") ? "CSV" : "JSON manifest"}</small>
            </button>
          ))}
        </div>
        <p className="small-note">
          CLI equivalent: <code>npm run export</code>. Files are written to <code>exports/&lt;timestamp&gt;/</code> with a manifest and checksums.
        </p>
      </section>

      {selected ? (
        <section className="admin-section selected-session" data-testid="session-detail">
          <div className="section-head">
            <div>
              <h2>{selected.label}</h2>
              <p className="small-note mono">{selected.session_id}</p>
            </div>
            <button type="button" className="button quiet" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="detail-grid">
            <div>
              <span>Status</span>
              <strong>{STATUS_LABEL[selected.status] ?? selected.status}</strong>
            </div>
            <div>
              <span>Stratum</span>
              <strong>{selected.stratum ?? "—"}</strong>
            </div>
            <div>
              <span>Sequence</span>
              <strong>{selected.sequence_index ?? "—"}</strong>
            </div>
            <div>
              <span>Target set</span>
              <strong>{selected.target_set ?? "—"}</strong>
            </div>
            <div>
              <span>Latest state</span>
              <strong>{selected.latest_state_label ?? "—"}</strong>
            </div>
            <div>
              <span>Stuck</span>
              <strong>{selected.stuck_seconds ? `${selected.stuck_seconds}s` : "—"}</strong>
            </div>
            <div>
              <span>Viewport</span>
              <strong>{selected.viewport_warning ?? "1920x1080 at 1x"}</strong>
            </div>
          </div>
          <label className="field">
            <span>Researcher note</span>
            <textarea
              rows={3}
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Observation, technical issue, or follow-up."
            />
          </label>
          <button
            type="button"
            className="button primary"
            disabled={!note.trim() || busy === "note"}
            onClick={() => {
              setBusy("note");
              void addAdminNote(password, selected.session_id, note.trim())
                .then(() => {
                  setNote("");
                  refresh();
                })
                .catch((noteError: Error) => setError(noteError.message))
                .finally(() => setBusy(null));
            }}
          >
            Save note
          </button>
        </section>
      ) : null}

      {abortTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="abort-title">
            <div className="eyebrow">Researcher stop</div>
            <h2 id="abort-title">Stop {abortTarget.label}?</h2>
            <p>The participant screen will move to the debrief on its next status check. This does not delete data.</p>
            <label className="field">
              <span>Reason</span>
              <input value={abortReason} onChange={(event) => setAbortReason(event.target.value)} maxLength={500} />
            </label>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setAbortTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                disabled={!abortReason.trim()}
                onClick={() => {
                  const target = abortTarget;
                  setAbortTarget(null);
                  setBusy("abort");
                  void abortAdminSession(password, target.session_id, abortReason.trim())
                    .then(refresh)
                    .catch((abortError: Error) => setError(abortError.message))
                    .finally(() => setBusy(null));
                }}
              >
                Stop session
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
