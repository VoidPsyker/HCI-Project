import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminSession, QaCriterion, QaReport, SessionInfo } from "../types";
import {
  adminLogin,
  adminRequest,
  abortAdminSession,
  addAdminNote,
  createAdminSession,
  deleteAdminSession,
  downloadExport,
  downloadGazeExport,
  getGazeSummary,
  getAdminSessions,
  getGoNoGo,
  getQa
} from "../api";

const STORAGE_KEY = "meridian.admin.sign-in";
const EXPORTS = ["events.jsonl", "events.csv", "trials.jsonl", "trials.csv", "checkins.jsonl", "checkins.csv", "demographics.jsonl", "demographics.csv", "questionnaires.jsonl", "questionnaires.csv", "assignments.csv", "tasks.csv", "gaze_samples.csv", "manifest"];

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

function GazeExports({ sessionId, token, onAuthError }: { sessionId: string; token: string; onAuthError: (failure: Error) => void }) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getGazeSummary>>["gaze"]>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const { gaze } = await getGazeSummary(token, sessionId);
        if (cancelled) return;
        setSummary(gaze);
        setError(null);
      } catch (failure) {
        if (cancelled) return;
        setSummary(undefined);
        const message = (failure as Error).message;
        setError(message === "gaze_session_not_found" ? null : message);
        if (message === "admin_password_required") onAuthError(failure as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, sessionId, onAuthError]);

  const save = async (filename: string) => {
    setDownloading(filename);
    setError(null);
    try {
      const { blob } = await downloadGazeExport(token, sessionId, filename);
      download(blob, sessionId + "-" + filename);
    } catch (failure) {
      setError((failure as Error).message);
      if ((failure as Error).message === "Export failed: HTTP 401") onAuthError(failure as Error);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <section data-testid="gaze-exports">
      <h3>Eye tracking</h3>
      {loading ? <p>Loading gaze data…</p> : summary ? (
        <p>{summary.sample_count} samples saved. {summary.status === "completed"
          ? (summary.analysis_ready ? "Quality checks passed." : "See the quality report before analysis.")
          : summary.sample_count > 0 ? "The CSV contains samples received so far." : "Capture begins in scored trials after calibration."}</p>
      ) : !error ? <p>No eye-tracking data yet. Capture begins in scored trials after calibration.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="export-grid">
        {summary?.export_files.map((filename) => (
          <button key={filename} type="button" className="export-card" onClick={() => void save(filename)} disabled={downloading !== null}>
            {filename}
          </button>
        ))}
      </div>
    </section>
  );
}

interface SignIn {
  token: string;
  expires_at: string;
}

function storedSignIn(): SignIn | null {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as SignIn | null;
    if (stored?.token && Date.parse(stored.expires_at) > Date.now()) return stored;
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable or hold an unreadable value; ask for the password again.
  }
  return null;
}

export function AdminDashboard() {
  const [signIn, setSignIn] = useState<SignIn | null>(storedSignIn);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signOut = useCallback((message: string | null = null) => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored to remove.
    }
    setSignIn(null);
    setPasswordDraft("");
    setError(message);
  }, []);

  if (!signIn) {
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
          <p className="lede">Enter the researcher password configured for this study. You stay signed in on this browser for 3 days.</p>
          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSigningIn(true);
              setError(null);
              adminLogin(passwordDraft)
                .then((result) => {
                  try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
                  } catch {
                    // Without storage the sign-in lasts until this tab closes.
                  }
                  setSignIn(result);
                  setPasswordDraft("");
                })
                .catch((failure: Error) => {
                  setError(failure.message === "admin_password_required" ? "That password was not accepted." : failure.message);
                })
                .finally(() => setSigningIn(false));
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
            {error ? <div className="banner error" role="alert">{error}</div> : null}
            <button type="submit" className="button primary" disabled={signingIn}>
              {signingIn ? "Signing in…" : "Open dashboard"}
            </button>
          </form>
          <p className="small-note">
            <a href="/">← Back to the pilot home</a>
          </p>
        </div>
      </div>
    );
  }

  return <AuthenticatedDashboard key={signIn.token} token={signIn.token} expiresAt={signIn.expires_at} signOut={signOut} />;
}

function AuthenticatedDashboard({ token, expiresAt, signOut }: { token: string; expiresAt: string; signOut: (message?: string | null) => void }) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [qa, setQa] = useState<QaReport | null>(null);
  const [goNoGo, setGoNoGo] = useState<QaCriterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sessions.find((session) => session.session_id === selectedId) ?? null;
  const [detail, setDetail] = useState<{ session: SessionInfo; notes: Array<{ note_id: number; note: string; created_at: string }> } | null>(null);
  const [note, setNote] = useState("");
  const [abortTarget, setAbortTarget] = useState<AdminSession | null>(null);
  const [abortReason, setAbortReason] = useState("researcher_stop");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const requestVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const handleError = useCallback((failure: Error) => {
    if (!mounted.current) return;
    if (failure.message === "admin_password_required" || failure.message === "Export failed: HTTP 401") {
      signOut("Your sign-in has expired or the password changed. Sign in again.");
    } else {
      setError(failure.message);
    }
  }, [signOut]);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const responses = await Promise.allSettled([
      getAdminSessions(token), getQa(token), getGoNoGo(token)
    ]);
    if (version !== requestVersion.current) return;
    const [sessionResponse, qaResponse, goResponse] = responses;
    if (sessionResponse.status === "fulfilled") setSessions(sessionResponse.value.sessions);
    if (qaResponse.status === "fulfilled") setQa(qaResponse.value);
    if (goResponse.status === "fulfilled") setGoNoGo(goResponse.value.criteria);
    const failures = responses.filter((response) => response.status === "rejected");
    const failure = failures.find((response) => response.reason?.message === "admin_password_required") ?? failures[0];
    if (failure) handleError(failure.reason as Error);
    else setError(null);
  }, [token, handleError]);

  useEffect(() => {
    setBusy("refresh");
    void load().finally(() => setBusy(null));
    const interval = setInterval(() => void load(), 10_000);
    return () => {
      requestVersion.current++;
      clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    let cancelled = false;
    void adminRequest<NonNullable<typeof detail>>(`/api/admin/sessions/${encodeURIComponent(selected.session_id)}`, token)
      .then((response) => { if (!cancelled) setDetail(response); })
      .catch((failure: Error) => { if (!cancelled) handleError(failure); });
    return () => { cancelled = true; };
  }, [selected, token, handleError]);

  useEffect(() => {
    if (abortTarget && !sessions.some((session) => session.session_id === abortTarget.session_id && !["completed", "aborted", "withdrawn"].includes(session.status))) {
      setAbortTarget(null);
    }
  }, [sessions, abortTarget]);

  const refresh = () => {
    setBusy("refresh");
    return load().finally(() => setBusy(null));
  };

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
          <button type="button" className="button secondary" onClick={refresh} disabled={busy !== null}>
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </button>
          <span className="small-note" data-testid="signed-in-until">Signed in until {formatTime(expiresAt)}</span>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              signOut();
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
          <strong>{(qa?.sessions.aborted ?? sessions.filter((s) => s.status === "aborted").length) + sessions.filter((s) => s.status === "withdrawn").length}</strong>
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
            void createAdminSession(token, label.trim() || undefined)
              .then((response) => {
                setCreatedUrl(`${window.location.origin}${response.participant_url}`);
                setLabel("");
                return refresh();
              })
              .catch(handleError)
              .finally(() => setBusy(null));
          }}
        >
          <label className="field">
            <span>Participant label (optional)</span>
            <input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. P09" />
          </label>
          <button type="submit" className="button primary" disabled={busy !== null} data-testid="create-session">
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
              onClick={() => {
                if (!navigator.clipboard) { setError("Clipboard unavailable. Copy the participant link manually."); return; }
                void navigator.clipboard.writeText(createdUrl).catch(() => setError("Could not copy the participant link. Copy it manually."));
              }}
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
                    setSelectedId(session.session_id);
                    setNote("");
                  }}
                >
                  <td>
                    <button type="button" className="button tiny quiet" onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(session.session_id);
                      setNote("");
                    }}>{session.label}</button>
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
                        disabled={busy !== null || ["completed", "aborted", "withdrawn"].includes(session.status)}
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
                        disabled={busy !== null}
                        onClick={() => {
                          if (!window.confirm(`Delete all data for ${session.label}? This cannot be undone.`)) return;
                          setBusy("delete");
                          void deleteAdminSession(token, session.session_id)
                            .then(() => {
                              if (selected?.session_id === session.session_id) setSelectedId(null);
                              return refresh();
                            })
                            .catch(handleError)
                            .finally(() => setBusy(null));
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
            <p className="small-note">{error ? "QA unavailable. Refresh to retry." : "Loading QA…"}</p>
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
              disabled={busy !== null}
              onClick={() => {
                setBusy(`export-${kind}`);
                setExportStatus(null);
                void downloadExport(token, kind)
                  .then((file) => {
                    download(file.blob, kind === "manifest" ? "manifest.json" : kind);
                    setExportStatus(`${kind}: ${file.rows || "?"} rows · SHA-256 ${file.checksum.slice(0, 16)}…`);
                  })
                  .catch(handleError)
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
            <button type="button" className="button quiet" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <div className="detail-grid">
            <div>
              <span>Status</span>
              <strong>{STATUS_LABEL[selected.status] ?? selected.status}</strong>
            </div>
            <div>
              <span>Stop reason</span>
              <strong>{detail?.session.abort_reason ?? "—"}</strong>
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
              <strong>{selected.viewport_warning ?? "No viewport warning reported"}</strong>
            </div>
          </div>
          <GazeExports key={selected.session_id} sessionId={selected.session_id} token={token} onAuthError={handleError} />
          {detail?.notes.map((entry) => <p key={entry.note_id}><time>{formatTime(entry.created_at)}</time> · {entry.note}</p>)}
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
            disabled={!note.trim() || busy !== null}
            onClick={() => {
              setBusy("note");
              void addAdminNote(token, selected.session_id, note.trim())
                .then(() => {
                  setNote("");
                  return refresh();
                })
                .catch(handleError)
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
              <button type="button" className="button secondary" disabled={busy === "abort"} onClick={() => setAbortTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                disabled={!abortReason.trim() || busy !== null}
                onClick={() => {
                  const target = abortTarget;
                  setBusy("abort");
                  void abortAdminSession(token, target.session_id, abortReason.trim())
                    .then(() => { setAbortTarget(null); return refresh(); })
                    .catch(handleError)
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
