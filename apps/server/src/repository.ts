import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { TASK_BY_ID, type MenuId, type Task } from "@meridian/taxonomy";
import { scoreTrial, type EventInput, type ResearchEvent } from "@meridian/scoring";
import { SCHEMA_SQL } from "./schema";
import { generateDesign, designSummary, type StudyDesign, type StateLabel } from "./design";

type Db = InstanceType<typeof Database>;

export interface SessionRow {
  session_id: string;
  participant_id: string;
  study: string;
  status: string;
  phase: string;
  sequence_index: number | null;
  sequence_id: string | null;
  stratum: string | null;
  target_set: number | null;
  seed_hash: string | null;
  taxonomy_hash: string | null;
  design_json: string | null;
  colour_mapping: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_event_at: string | null;
  abort_reason: string | null;
}

export interface ParticipantRow {
  participant_id: string;
  label: string;
  created_at: string;
  consent_version: string | null;
  consented_at: string | null;
  age_band: string | null;
  gender: string | null;
  education: string | null;
  shopping_freq: string | null;
  watch_expertise: number | null;
  tech_savvy: number | null;
  colour_vision: string | null;
  withdrawn_at: string | null;
}

export interface EventRow {
  event_id: string;
  participant_id: string;
  session_id: string;
  study: string;
  block_id: string | null;
  trial_id: string | null;
  task_id: string | null;
  target_id: string | null;
  menu_id: string | null;
  state_label: string;
  condition: string;
  event_type: string;
  t_client: number;
  t_server: string;
  elapsed_ms: number | null;
  level: number | null;
  element_id: string | null;
  element_label: string | null;
  parent_id: string | null;
  x: number | null;
  y: number | null;
  input_type: string;
  meta_json: string;
}

export interface TrialRow {
  trial_id: string;
  session_id: string;
  participant_id: string;
  block_id: string | null;
  trial_index: number | null;
  task_id: string | null;
  target_id: string | null;
  menu_id: string | null;
  state_label: string | null;
  condition: string | null;
  practice: number;
  success: number;
  completion_time_ms: number | null;
  elapsed_ms: number | null;
  clicks: number;
  wrong_department: number;
  wrong_subcategory: number;
  wrong_leaf: number;
  backtracks: number;
  category_switches: number;
  path_efficiency: number | null;
  first_click_ok: number | null;
  first_click_element_id: string | null;
  search_attempts: number;
  timed_out: number;
  gave_up: number;
  trial_end_count: number;
  missing_trial_start: number;
  missing_trial_end: number;
  event_count: number;
  path_json: string;
  scored_at: string;
}

export interface AdminSession {
  session_id: string;
  participant_id: string;
  label: string;
  status: string;
  phase: string;
  sequence_index: number | null;
  sequence_id: string | null;
  stratum: string | null;
  target_set: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_event_at: string | null;
  event_count: number;
  trial_count: number;
  questionnaire_count: number;
  latest_event_type: string | null;
  latest_trial_id: string | null;
  latest_menu_id: string | null;
  latest_state_label: string | null;
  checkin_distress: number | null;
  checkin_dominant_state: string | null;
  stuck_seconds: number | null;
}

function parseMeta(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class Repository {
  readonly db: Db;
  readonly rawDir: string;
  readonly seed: string;

  constructor(dbPath: string, rawDir: string, seed = process.env.STUDY_SEED ?? "meridian-pilot-2026") {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.mkdirSync(rawDir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.rawDir = rawDir;
    this.seed = seed;
  }

  close(): void {
    this.db.close();
  }

  createSession(label?: string): { session: SessionRow; participant: ParticipantRow } {
    const participantId = makeId("P");
    const sessionId = makeId("S");
    const createdAt = nowIso();
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM participants").get() as { n: number }).n;
    const participantLabel = label ?? `Participant ${String(count + 1).padStart(2, "0")}`;
    const tx = this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO participants (participant_id, label, created_at) VALUES (?, ?, ?)")
        .run(participantId, participantLabel, createdAt);
      this.db
        .prepare(
          "INSERT INTO sessions (session_id, participant_id, study, status, phase, created_at) VALUES (?, ?, 'pilot', 'created', 'consent', ?)"
        )
        .run(sessionId, participantId, createdAt);
    });
    tx();
    return {
      session: this.getSession(sessionId)!,
      participant: this.getParticipant(participantId)!
    };
  }

  getSession(sessionId: string): SessionRow | null {
    return (this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as SessionRow | undefined) ?? null;
  }

  getParticipant(participantId: string): ParticipantRow | null {
    return (
      (this.db.prepare("SELECT * FROM participants WHERE participant_id = ?").get(participantId) as ParticipantRow | undefined) ?? null
    );
  }

  getDesign(sessionId: string): StudyDesign | null {
    const row = this.getSession(sessionId);
    if (!row?.design_json) return null;
    return JSON.parse(row.design_json) as StudyDesign;
  }

  recordConsent(sessionId: string, version: string): SessionRow {
    const session = this.getSession(sessionId);
    if (!session) throw new Error("session not found");
    if (session.design_json) throw new Error("session already randomised");
    const at = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE participants SET consent_version = ?, consented_at = ? WHERE participant_id = ?")
        .run(version, at, session.participant_id);
      this.db.prepare("UPDATE sessions SET status = 'consented', phase = 'demographics' WHERE session_id = ?").run(sessionId);
    });
    tx();
    return this.getSession(sessionId)!;
  }

  assignDesign(sessionId: string, demographics: Record<string, unknown>, sequenceOverride?: number): StudyDesign {
    const session = this.getSession(sessionId);
    if (!session) throw new Error("session not found");
    const existing = this.getDesign(sessionId);
    if (existing) return existing;

    const gender = String(demographics.gender ?? "prefer not to say");
    const shopping = String(demographics.shopping_freq ?? "rarely");
    const stratum = `${gender}|${shopping}`;
    const genderSelf = String(demographics.gender_self_describe ?? "");

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE participants SET age_band=?, gender=?, education=?, shopping_freq=?,
             watch_expertise=?, tech_savvy=?, colour_vision=? WHERE participant_id=?`
        )
        .run(
          String(demographics.age_band ?? ""),
          genderSelf ? `${gender}: ${genderSelf}` : gender,
          String(demographics.education ?? ""),
          shopping,
          Number(demographics.watch_expertise ?? 0),
          Number(demographics.tech_savvy ?? 0),
          String(demographics.colour_vision ?? ""),
          session.participant_id
        );

      const assigned =
        sequenceOverride ??
        (this.db.prepare("SELECT COUNT(*) AS n FROM assignments_audit WHERE stratum = ?").get(stratum) as { n: number }).n;
      const design = generateDesign({
        sessionId,
        participantId: session.participant_id,
        sequenceIndex: assigned,
        stratum,
        seed: this.seed,
        now: nowIso()
      });
      const at = nowIso();
      this.db
        .prepare(
          `INSERT INTO assignments_audit
            (participant_id, session_id, sequence_index, sequence_id, stratum, block_order, menu_orders, target_set,
             colour_mapping, seed_hash, taxonomy_hash, assigned_at, design_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          session.participant_id,
          sessionId,
          design.sequenceIndex,
          design.sequenceId,
          stratum,
          JSON.stringify(design.blockOrder),
          JSON.stringify(design.blocks.map((b) => b.menuIds)),
          design.targetSet,
          JSON.stringify(design.colourMapping),
          design.seedHash,
          design.taxonomyHash,
          at,
          JSON.stringify(design)
        );
      this.db
        .prepare(
          `UPDATE sessions SET status='in_progress', phase='baseline', sequence_index=?, sequence_id=?, stratum=?,
             target_set=?, seed_hash=?, taxonomy_hash=?, design_json=?, colour_mapping=?, started_at=?
           WHERE session_id=?`
        )
        .run(
          design.sequenceIndex,
          design.sequenceId,
          stratum,
          design.targetSet,
          design.seedHash,
          design.taxonomyHash,
          JSON.stringify(design),
          JSON.stringify(design.colourMapping),
          at,
          sessionId
        );
      this.setMeta("seed_hash", design.seedHash);
      this.setMeta("taxonomy_hash", design.taxonomyHash);
      this.setMeta("seed", this.seed);
    });
    tx();
    return this.getDesign(sessionId)!;
  }

  updateSession(sessionId: string, patch: { status?: string; phase?: string; abort_reason?: string }): SessionRow {
    const session = this.getSession(sessionId);
    if (!session) throw new Error("session not found");
    const status = patch.status ?? session.status;
    const phase = patch.phase ?? session.phase;
    const endedAt = status === "completed" || status === "aborted" || status === "withdrawn" ? nowIso() : session.ended_at;
    this.db
      .prepare("UPDATE sessions SET status=?, phase=?, abort_reason=?, ended_at=? WHERE session_id=?")
      .run(status, phase, patch.abort_reason ?? session.abort_reason, endedAt, sessionId);
    return this.getSession(sessionId)!;
  }

  completeSession(sessionId: string): SessionRow {
    return this.updateSession(sessionId, { status: "completed", phase: "debrief" });
  }

  abortSession(sessionId: string, reason: string): SessionRow {
    return this.updateSession(sessionId, { status: "aborted", phase: "debrief", abort_reason: reason });
  }

  withdrawSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM events WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM trials WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM questionnaires WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM researcher_notes WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM assignments_audit WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM participants WHERE participant_id = ?").run(session.participant_id);
    });
    tx();
    const rawFile = path.join(this.rawDir, `${sessionId}.jsonl`);
    if (fs.existsSync(rawFile)) fs.rmSync(rawFile, { force: true });
  }

  insertEvents(events: EventInput[]): { accepted: number; duplicates: number; trialEndConflicts: number } {
    const acceptedRows: Array<EventRow & { meta: Record<string, unknown> }> = [];
    let duplicates = 0;
    let trialEndConflicts = 0;
    const sessionCache = new Map<string, SessionRow>();
    const seenTrialEnds = new Set<string>();
    const tx = this.db.transaction(() => {
      for (const input of events) {
        const session = sessionCache.get(input.session_id) ?? this.getSession(input.session_id);
        if (!session) throw new Error(`session not found: ${input.session_id}`);
        sessionCache.set(input.session_id, session);
        if (session.participant_id !== input.participant_id) throw new Error("participant/session mismatch");
        if (input.event_type === "trial_end" && input.trial_id) {
          const existing = this.db
            .prepare("SELECT event_id FROM events WHERE trial_id = ? AND event_type = 'trial_end' LIMIT 1")
            .get(input.trial_id) as { event_id: string } | undefined;
          if ((existing && existing.event_id !== input.event_id) || seenTrialEnds.has(input.trial_id)) {
            trialEndConflicts++;
            continue;
          }
          seenTrialEnds.add(input.trial_id);
        }
        const tServer = nowIso();
        const row: EventRow = {
          event_id: input.event_id,
          participant_id: input.participant_id,
          session_id: input.session_id,
          study: input.study,
          block_id: input.block_id ?? null,
          trial_id: input.trial_id ?? null,
          task_id: input.task_id ?? null,
          target_id: input.target_id ?? null,
          menu_id: input.menu_id ?? null,
          state_label: input.state_label,
          condition: input.condition,
          event_type: input.event_type,
          t_client: input.t_client,
          t_server: tServer,
          elapsed_ms: input.elapsed_ms ?? null,
          level: input.level ?? null,
          element_id: input.element_id ?? null,
          element_label: input.element_label ?? null,
          parent_id: input.parent_id ?? null,
          x: input.x ?? null,
          y: input.y ?? null,
          input_type: input.input_type,
          meta_json: JSON.stringify(input.meta ?? {})
        };
        const result = this.db
          .prepare(
            `INSERT OR IGNORE INTO events
             (event_id, participant_id, session_id, study, block_id, trial_id, task_id, target_id, menu_id,
              state_label, condition, event_type, t_client, t_server, elapsed_ms, level, element_id, element_label,
              parent_id, x, y, input_type, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(...Object.values(row));
        if (result.changes === 0) {
          duplicates++;
          continue;
        }
        acceptedRows.push({ ...row, meta: input.meta ?? {} });
        this.db
          .prepare("UPDATE sessions SET last_event_at=? WHERE session_id=?")
          .run(tServer, input.session_id);
        if (input.event_type === "session_end") {
          this.db
            .prepare("UPDATE sessions SET status='completed', phase='debrief', ended_at=? WHERE session_id=?")
            .run(tServer, input.session_id);
        }
        if (input.event_type === "session_start") {
          this.db
            .prepare("UPDATE sessions SET started_at=COALESCE(started_at, ?) WHERE session_id=?")
            .run(tServer, input.session_id);
        }
      }
    });
    tx();

    const trialIds = new Set<string>();
    for (const row of acceptedRows) {
      const archived = { ...row, meta: row.meta };
      delete (archived as { meta_json?: string }).meta_json;
      const line = JSON.stringify(archived) + "\n";
      fs.appendFileSync(path.join(this.rawDir, `${row.session_id}.jsonl`), line, "utf8");
      if (row.trial_id) trialIds.add(row.trial_id);
    }
    for (const trialId of trialIds) this.recomputeTrial(trialId);
    return { accepted: acceptedRows.length, duplicates, trialEndConflicts };
  }

  rowToEvent(row: EventRow): ResearchEvent {
    return {
      event_id: row.event_id,
      participant_id: row.participant_id,
      session_id: row.session_id,
      study: row.study as ResearchEvent["study"],
      block_id: row.block_id,
      trial_id: row.trial_id,
      task_id: row.task_id,
      target_id: row.target_id,
      menu_id: (row.menu_id as MenuId | null) ?? null,
      state_label: row.state_label as StateLabel,
      condition: row.condition as ResearchEvent["condition"],
      event_type: row.event_type as ResearchEvent["event_type"],
      t_client: row.t_client,
      t_server: row.t_server,
      elapsed_ms: row.elapsed_ms,
      level: row.level as ResearchEvent["level"],
      element_id: row.element_id,
      element_label: row.element_label,
      parent_id: row.parent_id,
      x: row.x,
      y: row.y,
      input_type: row.input_type as ResearchEvent["input_type"],
      meta: parseMeta(row.meta_json)
    };
  }

  getTrialEvents(trialId: string): ResearchEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE trial_id = ? ORDER BY t_client ASC, t_server ASC")
      .all(trialId) as EventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  recomputeTrial(trialId: string): TrialRow | null {
    const events = this.getTrialEvents(trialId);
    const end = events.find((e) => e.event_type === "trial_end");
    if (!end || !end.menu_id || !end.target_id) return null;
    const score = scoreTrial(events, end.target_id, end.menu_id);
    const meta = end.meta ?? {};
    const practice = meta.practice === true || /-P\d+$/.test(trialId);
    const match = trialId.match(/-B(\d+)-T(\d+)$/);
    const trialIndex = match ? Number(match[2]) - 1 : null;
    const task = end.task_id ? TASK_BY_ID.get(end.task_id) : undefined;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO trials
         (trial_id, session_id, participant_id, block_id, trial_index, task_id, target_id, menu_id, state_label,
          condition, practice, success, completion_time_ms, elapsed_ms, clicks, wrong_department, wrong_subcategory,
          wrong_leaf, backtracks, category_switches, path_efficiency, first_click_ok, first_click_element_id,
          search_attempts, timed_out, gave_up, trial_end_count, missing_trial_start, missing_trial_end, event_count,
          path_json, scored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        trialId,
        end.session_id,
        end.participant_id,
        end.block_id,
        trialIndex,
        end.task_id,
        end.target_id,
        end.menu_id,
        end.state_label,
        end.condition,
        practice ? 1 : 0,
        score.success ? 1 : 0,
        score.completionTimeMs,
        score.elapsedMs,
        score.clicks,
        score.wrongDepartment ? 1 : 0,
        score.wrongSubcategory ? 1 : 0,
        score.wrongLeaf ? 1 : 0,
        score.backtracks,
        score.categorySwitches,
        score.pathEfficiency,
        score.firstClickCorrect === null ? null : score.firstClickCorrect ? 1 : 0,
        score.firstClickElementId,
        score.searchAttempts,
        score.timedOut ? 1 : 0,
        score.gaveUp ? 1 : 0,
        score.trialEndCount,
        score.missingTrialStart ? 1 : 0,
        score.missingTrialEnd ? 1 : 0,
        score.eventCount,
        JSON.stringify(score.path),
        nowIso()
      );
    return this.db.prepare("SELECT * FROM trials WHERE trial_id = ?").get(trialId) as TrialRow;
  }

  insertQuestionnaires(responses: Array<Record<string, unknown>>): number {
    const tx = this.db.transaction(() => {
      let count = 0;
      for (const r of responses) {
        const sessionId = String(r.session_id ?? "");
        if (!this.getSession(sessionId)) throw new Error(`session not found: ${sessionId}`);
        this.db
          .prepare(
            `INSERT OR REPLACE INTO questionnaires
             (response_id, session_id, block_id, menu_id, instrument, item_id, value, text_value, answered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            String(r.response_id ?? crypto.randomUUID()),
            sessionId,
            (r.block_id as string | null | undefined) ?? null,
            (r.menu_id as string | null | undefined) ?? null,
            String(r.instrument ?? ""),
            String(r.item_id ?? ""),
            r.value === null || r.value === undefined ? null : Number(r.value),
            (r.text_value as string | null | undefined) ?? null,
            String(r.answered_at ?? nowIso())
          );
        count++;
      }
      return count;
    });
    return tx();
  }

  latestEvent(sessionId: string): EventRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM events WHERE session_id=? ORDER BY t_server DESC, rowid DESC LIMIT 1")
        .get(sessionId) as EventRow | undefined) ?? null
    );
  }

  latestCheckin(sessionId: string): EventRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM events WHERE session_id=? AND event_type='checkin' ORDER BY t_server DESC, rowid DESC LIMIT 1")
        .get(sessionId) as EventRow | undefined) ?? null
    );
  }

  listAdminSessions(): AdminSession[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, p.label FROM sessions s JOIN participants p ON p.participant_id=s.participant_id
         ORDER BY s.created_at DESC`
      )
      .all() as Array<SessionRow & { label: string }>;
    return rows.map((row) => {
      const counts = this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM events WHERE session_id=?) AS events,
             (SELECT COUNT(*) FROM trials WHERE session_id=?) AS trials,
             (SELECT COUNT(*) FROM questionnaires WHERE session_id=?) AS questionnaires`
        )
        .get(row.session_id, row.session_id, row.session_id) as { events: number; trials: number; questionnaires: number };
      const latest = this.latestEvent(row.session_id);
      const checkin = this.latestCheckin(row.session_id);
      const checkinMeta = checkin ? parseMeta(checkin.meta_json) : {};
      const lastStart = this.db
        .prepare("SELECT MAX(t_server) AS t FROM events WHERE session_id=? AND event_type='trial_start'")
        .get(row.session_id) as { t: string | null };
      const lastEnd = this.db
        .prepare("SELECT MAX(t_server) AS t FROM events WHERE session_id=? AND event_type IN ('trial_end','timeout','give_up')")
        .get(row.session_id) as { t: string | null };
      let stuckSeconds: number | null = null;
      if (
        row.status === "in_progress" &&
        lastStart.t &&
        (!lastEnd.t || lastStart.t > lastEnd.t) &&
        row.last_event_at
      ) {
        const ms = Date.now() - new Date(lastStart.t).getTime();
        if (Number.isFinite(ms) && ms > 0) stuckSeconds = Math.round(ms / 1000);
      }
      const latestMeta = latest ? parseMeta(latest.meta_json) : {};
      const distressRaw = checkinMeta.distress;
      const distress = typeof distressRaw === "number" ? distressRaw : null;
      return {
        session_id: row.session_id,
        participant_id: row.participant_id,
        label: row.label,
        status: row.status,
        phase: row.phase,
        sequence_index: row.sequence_index,
        sequence_id: row.sequence_id,
        stratum: row.stratum,
        target_set: row.target_set,
        created_at: row.created_at,
        started_at: row.started_at,
        ended_at: row.ended_at,
        last_event_at: row.last_event_at,
        event_count: counts.events,
        trial_count: counts.trials,
        questionnaire_count: counts.questionnaires,
        latest_event_type: latest?.event_type ?? null,
        latest_trial_id: latest?.trial_id ?? null,
        latest_menu_id: latest?.menu_id ?? null,
        latest_state_label: latest?.state_label ?? null,
        checkin_distress: distress,
        checkin_dominant_state:
          typeof checkinMeta.dominant_state === "string" ? checkinMeta.dominant_state : null,
        stuck_seconds: stuckSeconds
      };
    });
  }

  getSessionEvents(sessionId: string, limit = 200): EventRow[] {
    return this.db
      .prepare("SELECT * FROM events WHERE session_id=? ORDER BY t_server DESC, rowid DESC LIMIT ?")
      .all(sessionId, limit) as EventRow[];
  }

  addNote(sessionId: string, note: string): { note_id: number; created_at: string } {
    if (!this.getSession(sessionId)) throw new Error("session not found");
    const createdAt = nowIso();
    const result = this.db
      .prepare("INSERT INTO researcher_notes (session_id, note, created_at) VALUES (?, ?, ?)")
      .run(sessionId, note, createdAt);
    return { note_id: Number(result.lastInsertRowid), created_at: createdAt };
  }

  getNotes(sessionId: string): Array<{ note_id: number; note: string; created_at: string }> {
    return this.db
      .prepare("SELECT note_id, note, created_at FROM researcher_notes WHERE session_id=? ORDER BY note_id DESC")
      .all(sessionId) as Array<{ note_id: number; note: string; created_at: string }>;
  }

  allEvents(): EventRow[] {
    return this.db.prepare("SELECT * FROM events ORDER BY t_server ASC, rowid ASC").all() as EventRow[];
  }

  allTrials(): Array<TrialRow & { difficulty: string | null; task_description: string | null }> {
    const rows = this.db.prepare("SELECT * FROM trials ORDER BY session_id, trial_id").all() as TrialRow[];
    return rows.map((row) => {
      const task: Task | undefined = row.task_id ? TASK_BY_ID.get(row.task_id) : undefined;
      return { ...row, difficulty: task?.difficulty ?? null, task_description: task?.description ?? null };
    });
  }

  allQuestionnaires(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT * FROM questionnaires ORDER BY session_id, instrument, item_id").all() as Array<
      Record<string, unknown>
    >;
  }

  allAssignments(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT * FROM assignments_audit ORDER BY sequence_index").all() as Array<Record<string, unknown>>;
  }

  allCheckins(): Array<{
    event_id: string;
    session_id: string;
    participant_id: string;
    block_id: string | null;
    state_label: string;
    t_server: string;
    meta: Record<string, unknown>;
  }> {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE event_type='checkin' ORDER BY session_id, t_client")
      .all() as EventRow[];
    return rows.map((row) => ({
      event_id: row.event_id,
      session_id: row.session_id,
      participant_id: row.participant_id,
      block_id: row.block_id,
      state_label: row.state_label,
      t_server: row.t_server,
      meta: parseMeta(row.meta_json)
    }));
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }
}
