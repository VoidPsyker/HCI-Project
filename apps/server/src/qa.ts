import { MENU_IDS, PRACTICE_TASKS, SCORED_TASKS, validateTaxonomy } from "@meridian/taxonomy";
import { manipulationCheckPassed, type AffectRatings } from "@meridian/scoring";
import questionnaires from "../../web/content/questionnaires.json";
import timing from "../../web/content/session-timing.json";
import type { Repository } from "./repository";

export type CheckStatus = "pass" | "fail" | "na";

export interface QaCriterion {
  id: string;
  label: string;
  status: CheckStatus;
  value: string;
  threshold: string;
  note?: string;
}

export interface QaReport {
  generated_at: string;
  sessions: { total: number; completed: number; in_progress: number; aborted: number };
  counts: { events: number; trials: number; main_trials: number; practice_trials: number; questionnaires: number; checkins: number };
  data_quality: {
    missing_trial_ends: number;
    missing_trial_starts: number;
    duplicate_trial_ends: number;
    event_order_violations: number;
    clock_skew_flags: number;
    duplicate_event_ids: number;
    reconstructable_trials_pct: number;
    questionnaire_completeness_pct: number | null;
    median_fps: number | null;
    min_fps: number | null;
    fps_samples: number;
    console_errors: number;
    distress_events: number;
    sessions_over_100_min: number;
  };
  criteria: QaCriterion[];
  calibration: { by_task: CalibrationRow[]; by_menu: CalibrationRow[] };
  overall: "pass" | "fail" | "conditional";
}

export interface CalibrationRow {
  key: string;
  difficulty?: string | null;
  n: number;
  success_pct: number | null;
  median_success_s: number | null;
}

/** Task calibration table (plan §7.4): main-trial success and median successful time by task and by menu. */
export function buildCalibration(
  trials: Array<{ practice: unknown; success: unknown; completion_time_ms: number | null; task_id: string | null; menu_id: string | null; difficulty: string | null }>
) {
  const main = trials.filter((t) => !t.practice);
  const group = (key: (t: (typeof main)[number]) => string | null) => {
    const groups = new Map<string, typeof main>();
    for (const t of main) {
      const k = key(t);
      if (k) groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, rows]): CalibrationRow => {
        const times = rows.filter((t) => t.success && t.completion_time_ms !== null).map((t) => (t.completion_time_ms ?? 0) / 1000);
        const med = median(times);
        return {
          key: k,
          n: rows.length,
          success_pct: pct(rows.filter((t) => t.success).length, rows.length),
          median_success_s: med === null ? null : Math.round(med * 10) / 10
        };
      });
  };
  const difficulty = new Map(main.map((t) => [t.task_id, t.difficulty]));
  return {
    by_task: group((t) => t.task_id).map((row) => ({ ...row, difficulty: difficulty.get(row.key) ?? null })),
    by_menu: group((t) => t.menu_id)
  };
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function pass(id: string, label: string, value: string, threshold: string, note?: string): QaCriterion {
  return { id, label, status: "pass", value, threshold, note };
}
function fail(id: string, label: string, value: string, threshold: string, note?: string): QaCriterion {
  return { id, label, status: "fail", value, threshold, note };
}
function na(id: string, label: string, value: string, threshold: string, note?: string): QaCriterion {
  return { id, label, status: "na", value, threshold, note };
}

/** An empty path is the true record of a trial ended without clicks (e.g. an immediate give-up); only a success needs one. */
function isReconstructable(t: { event_count: number; trial_end_count: number; path_json: string; success: unknown; missing_trial_start?: unknown; missing_trial_end?: unknown }): boolean {
  return !t.missing_trial_start && !t.missing_trial_end && t.event_count > 0 && t.trial_end_count === 1 && (!t.success || t.path_json !== "[]");
}

function questionnaireCompleteness(
  completed: Array<{ session_id: string }>,
  events: ReturnType<Repository["allEvents"]>,
  answers: ReturnType<Repository["allQuestionnaires"]>
): number | null {
  const protocols = new Map<string, string>();
  for (const event of events) {
    if (event.event_type === "session_start") {
      const meta = JSON.parse(event.meta_json);
      protocols.set(event.session_id, meta.protocol_version);
    }
  }
  const base = questionnaires.sus.length + questionnaires.nasa_tlx.length
    + questionnaires.open.length + questionnaires.credibility.length;
  let expected = 0;
  let answered = 0;
  for (const session of completed) {
    const protocol = protocols.get(session.session_id);
    const count = [timing.protocolVersion, "short-pilot-v3", "short-pilot-v4", "study-v5"].includes(protocol ?? "")
      ? base + 1 : protocol === "short-pilot-v2" ? base : base + 5 * questionnaires.sus.length;
    const unique = new Set(answers.filter((answer) => answer.session_id === session.session_id)
      .map((answer) => JSON.stringify([answer.instrument, answer.menu_id, answer.item_id])));
    expected += count;
    answered += Math.min(count, unique.size);
  }
  return expected ? answered / expected * 100 : null;
}

export function buildGoNoGo(repo: Repository): QaCriterion[] {
  const criteria: QaCriterion[] = [];
  const sessions = repo.listAdminSessions();
  const completed = sessions.filter((s) => s.status === "completed");
  const trials = repo.allTrials();
  const main = trials.filter((t) => !t.practice);
  const practice = trials.filter((t) => t.practice);
  const checkins = repo.allCheckins();
  const events = repo.allEvents();
  const answers = repo.allQuestionnaires();

  const practiceByMenu = new Map<string, { success: number; total: number }>();
  for (const t of practice) {
    if (!t.menu_id) continue;
    const entry = practiceByMenu.get(t.menu_id) ?? { success: 0, total: 0 };
    entry.total++;
    if (t.success) entry.success++;
    practiceByMenu.set(t.menu_id, entry);
  }
  if (practiceByMenu.size === 0) {
    criteria.push(na("practice_success", "Practice success per menu", "no practice data", ">= 80% for every menu"));
  } else {
    const rates = [...practiceByMenu.entries()].map(([menu, v]) => ({ menu, rate: v.success / v.total }));
    const lowest = rates.reduce((a, b) => (a.rate <= b.rate ? a : b));
    const value = `${lowest.menu}: ${Math.round(lowest.rate * 1000) / 10}%`;
    criteria.push(
      MENU_IDS.every((menu) => practiceByMenu.has(menu)) && lowest.rate >= 0.8
        ? pass("practice_success", "Practice success per menu", value, ">= 80% for every menu")
        : fail("practice_success", "Practice success per menu", value, ">= 80% for every menu")
    );
  }

  const states = ["happy", "frustrated", "confused", "bored"] as const;
  const manipulation = states.map((state) => {
    const relevant = checkins.filter((c) => c.state_label === state && c.meta.phase === "post_induction");
    const hits = relevant.filter((c) => manipulationCheckPassed(state, c.meta as AffectRatings));
    const intensity = relevant.length ? relevant.reduce((sum, c) => sum + Number(c.meta[state] ?? 0), 0) / relevant.length : null;
    return { state, rate: relevant.length ? hits.length / relevant.length : null, intensity, n: relevant.length };
  });
  if (manipulation.every((m) => m.n === 0)) {
    criteria.push(na("manipulation", "Induction manipulation check", "no check-in data", ">= 60% dominant state per induction, intensity >= 5/7"));
  } else {
    const valid = manipulation.filter((m) => m.n > 0);
    const lowest = valid.reduce((a, b) => ((a.rate ?? 0) <= (b.rate ?? 0) ? a : b));
    const value = valid
      .map((m) => `${m.state}: ${m.rate === null ? "NA" : Math.round(m.rate * 1000) / 10 + "%"}, intensity ${m.intensity?.toFixed(1) ?? "NA"}`)
      .join("; ");
    criteria.push(
      valid.length === states.length && (lowest.rate ?? 0) >= 0.6 && valid.every((m) => (m.intensity ?? 0) >= 5)
        ? pass("manipulation", "Induction manipulation check", value, ">= 60% dominant state per induction, intensity >= 5/7")
        : fail("manipulation", "Induction manipulation check", value, ">= 60% dominant state per induction, intensity >= 5/7")
    );
  }

  const distress = checkins.filter((c) => Number(c.meta.distress ?? 0) > 6);
  criteria.push(
    distress.length === 0
      ? pass("distress", "No distress above 6/10", "0 events", "0 events; immediate stop if > 6")
      : fail("distress", "No distress above 6/10", `${distress.length} events`, "0 events; immediate stop if > 6")
  );

  const inductionByBlock = new Map<string, { start?: number; end?: number }>();
  for (const e of events) {
    if (e.event_type !== "induction_start" && e.event_type !== "induction_end") continue;
    const key = `${e.session_id}:${e.block_id ?? "unknown"}`;
    const entry = inductionByBlock.get(key) ?? {};
    if (e.event_type === "induction_start") entry.start = e.t_client;
    if (e.event_type === "induction_end") entry.end = e.t_client;
    inductionByBlock.set(key, entry);
  }
  const durations = [...inductionByBlock.values()]
    .filter((v) => v.start !== undefined && v.end !== undefined)
    .map((v) => ((v.end ?? 0) - (v.start ?? 0)) / 1000);
  if (durations.length === 0) {
    criteria.push(na("induction_duration", "Induction duration", "no induction timing", "<= 150 s"));
  } else {
    const max = Math.max(...durations);
    criteria.push(
      max <= 150
        ? pass("induction_duration", "Induction duration", `${max.toFixed(0)} s max`, "<= 150 s")
        : fail("induction_duration", "Induction duration", `${max.toFixed(0)} s max`, "<= 150 s")
    );
  }

  const mainSuccess = main.filter((t) => t.success).length;
  const mainRate = main.length ? mainSuccess / main.length : null;
  if (mainRate === null) {
    criteria.push(na("overall_success", "Main-trial success", "no main trials", "75–90%"));
  } else {
    const value = `${Math.round(mainRate * 1000) / 10}% (${mainSuccess}/${main.length})`;
    criteria.push(
      mainRate >= 0.75 && mainRate <= 0.9
        ? pass("overall_success", "Main-trial success", value, "75–90%")
        : fail("overall_success", "Main-trial success", value, "75–90%")
    );
  }

  const byDifficulty = ["Easy", "Medium", "Hard"].map((difficulty) => {
    const subset = main.filter((t) => t.difficulty === difficulty);
    return { difficulty, rate: subset.length ? subset.filter((t) => t.success).length / subset.length : null, n: subset.length };
  });
  if (byDifficulty.some((d) => d.n === 0)) {
    criteria.push(na("difficulty_gradient", "Difficulty gradient", "missing difficulty cells", "Easy > Medium > Hard"));
  } else {
    const [easy, medium, hard] = byDifficulty.map((d) => d.rate ?? 0);
    const value = `Easy ${Math.round((easy ?? 0) * 100)}% > Medium ${Math.round((medium ?? 0) * 100)}% > Hard ${Math.round((hard ?? 0) * 100)}%`;
    criteria.push(
      (easy ?? 0) > (medium ?? 0) && (medium ?? 0) > (hard ?? 0)
        ? pass("difficulty_gradient", "Difficulty gradient", value, "Easy > Medium > Hard")
        : fail("difficulty_gradient", "Difficulty gradient", value, "Easy > Medium > Hard")
    );
  }

  const shortPilotStarts = new Map<string, { wall_time_ms?: number; fast_mode?: boolean; protocol_version: string }>();
  const sessionEnds = new Map<string, number>();
  for (const event of events) {
    if (event.event_type === "session_start") {
      const meta = JSON.parse(event.meta_json);
      if ([timing.protocolVersion, "short-pilot-v2", "short-pilot-v3", "short-pilot-v4", "study-v5"].includes(meta.protocol_version)) {
        shortPilotStarts.set(event.session_id, meta);
      }
    } else if (event.event_type === "session_end") {
      const meta = JSON.parse(event.meta_json);
      if (meta.completed === true && typeof meta.wall_time_ms === "number") {
        sessionEnds.set(event.session_id, meta.wall_time_ms);
      }
    }
  }
  const durationsSeconds = completed.flatMap((session) => {
    const start = shortPilotStarts.get(session.session_id);
    const end = sessionEnds.get(session.session_id);
    if (start?.fast_mode || typeof start?.wall_time_ms !== "number" || end === undefined || end < start.wall_time_ms) return [];
    return [(end - start.wall_time_ms) / 1000];
  });
  const durationLabel = "Average short pilot duration";
  const durationTarget = "≤ " + timing.targetSeconds / 60 + " min target";
  if (durationsSeconds.length === 0) {
    criteria.push(na("session_duration", durationLabel, "no completed short pilot sessions", durationTarget));
  } else {
    const average = durationsSeconds.reduce((sum, duration) => sum + duration, 0) / durationsSeconds.length;
    const value = (average / 60).toFixed(1) + " min (" + durationsSeconds.length + (durationsSeconds.length === 1 ? " session)" : " sessions)");
    criteria.push(average <= timing.targetSeconds
      ? pass("session_duration", durationLabel, value, durationTarget)
      : fail("session_duration", durationLabel, value, durationTarget));
  }

  const completionTimes = main.filter((t) => t.success && t.completion_time_ms !== null).map((t) => t.completion_time_ms ?? 0);
  const med = median(completionTimes);
  if (med === null) {
    criteria.push(na("trial_time", "Median main-trial time", "no successful trials", "<= 45 s"));
  } else {
    criteria.push(
      med <= 45000
        ? pass("trial_time", "Median main-trial time", `${(med / 1000).toFixed(1)} s`, "<= 45 s")
        : fail("trial_time", "Median main-trial time", `${(med / 1000).toFixed(1)} s`, "<= 45 s")
    );
  }

  const completeness = questionnaireCompleteness(completed, events, answers);
  if (completeness === null) {
    criteria.push(na("questionnaire_completeness", "Questionnaire completeness", "no completed sessions", ">= 95%"));
  } else {
    criteria.push(
      completeness >= 95
        ? pass("questionnaire_completeness", "Questionnaire completeness", `${completeness.toFixed(1)}%`, ">= 95%")
        : fail("questionnaire_completeness", "Questionnaire completeness", `${completeness.toFixed(1)}%`, ">= 95%")
    );
  }

  for (const [id, label, subset] of [
    ["practice_reconstructable", "Practice trials reconstructable from event log", practice],
    ["reconstructable", "Main trials reconstructable from event log", main]
  ] as const) {
    const reconstructablePct = pct(subset.filter(isReconstructable).length, subset.length);
    if (reconstructablePct === null) criteria.push(na(id, label, "no trials", "100%"));
    else if (reconstructablePct === 100) criteria.push(pass(id, label, `${reconstructablePct}%`, "100%"));
    else criteria.push(fail(id, label, `${reconstructablePct}%`, "100%"));
  }

  const fps = events
    .filter((e) => e.event_type === "trial_end")
    .map((e) => {
      try {
        const meta = JSON.parse(e.meta_json) as { fps?: number };
        return typeof meta.fps === "number" ? meta.fps : null;
      } catch {
        return null;
      }
    })
    .filter((v): v is number => v !== null);
  const fpsMedian = median(fps);
  if (fpsMedian === null) {
    criteria.push(na("fps", "Frame rate during trials", "no samples", ">= 50 fps"));
  } else {
    criteria.push(
      fpsMedian >= 50
        ? pass("fps", "Frame rate during trials", `${fpsMedian.toFixed(1)} fps`, ">= 50 fps")
        : fail("fps", "Frame rate during trials", `${fpsMedian.toFixed(1)} fps`, ">= 50 fps")
    );
  }

  const taxonomy = validateTaxonomy();
  criteria.push(
    taxonomy.ok
      ? pass("label_parity", "Label and taxonomy parity", `${taxonomy.products} products, ${taxonomy.paths} paths`, "0 parity failures")
      : fail("label_parity", "Label and taxonomy parity", `${taxonomy.errors.length} errors`, "0 parity failures", taxonomy.errors.join("; "))
  );

  criteria.push(
    na("external_requests", "No external requests during trials", "verified by Playwright suite", "0 external requests", "Run npm run test:e2e")
  );
  criteria.push(
    na("hit_targets", "Hit targets, clipping and keyboard walkthrough", "verified by Playwright suite", ">= 44 x 44 px; no clipping", "Run npm run test:e2e")
  );

  return criteria;
}

export function buildQaReport(repo: Repository): QaReport {
  const sessions = repo.listAdminSessions();
  const completed = sessions.filter((s) => s.status === "completed");
  const events = repo.allEvents();
  const trials = repo.allTrials();
  const main = trials.filter((t) => !t.practice);
  const practice = trials.filter((t) => t.practice);
  const checkins = repo.allCheckins();
  const answers = repo.allQuestionnaires();

  const byTrial = new Map<string, typeof events>();
  for (const e of events) {
    if (!e.trial_id) continue;
    const list = byTrial.get(e.trial_id) ?? [];
    list.push(e);
    byTrial.set(e.trial_id, list);
  }
  let orderViolations = 0;
  for (const list of byTrial.values()) {
    const sorted = [...list].sort((a, b) => a.t_server.localeCompare(b.t_server));
    for (let i = 1; i < sorted.length; i++) {
      if ((sorted[i]?.t_client ?? 0) < (sorted[i - 1]?.t_client ?? 0)) {
        orderViolations++;
        break;
      }
    }
  }

  let clockSkew = 0;
  const bySession = new Map<string, typeof events>();
  for (const e of events) {
    const list = bySession.get(e.session_id) ?? [];
    list.push(e);
    bySession.set(e.session_id, list);
  }
  for (const list of bySession.values()) {
    const sorted = [...list].sort((a, b) => a.t_server.localeCompare(b.t_server));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (!prev || !curr) continue;
      const dtClient = curr.t_client - prev.t_client;
      const dtServer = new Date(curr.t_server).getTime() - new Date(prev.t_server).getTime();
      if (dtClient >= 0 && dtClient < 1000 && dtServer > dtClient + 5000) clockSkew++;
    }
  }

  const missingTrialEnds = completed.reduce((sum, session) => {
    const observed = trials.filter((trial) => trial.session_id === session.session_id);
    // Sessions keep the design they were assigned, so count against that design.
    return sum + Math.max(0, (session.expected_trials ?? SCORED_TASKS.length + PRACTICE_TASKS.length) - observed.length);
  }, 0) + trials.filter((t) => t.missing_trial_end).length;
  const missingStarts = trials.filter((t) => t.missing_trial_start).length;
  const duplicateEnds = trials.filter((t) => t.trial_end_count > 1).length;
  const reconstructablePct = pct(main.filter(isReconstructable).length, main.length) ?? 0;
  const completeness = questionnaireCompleteness(completed, events, answers);

  const fpsSamples: number[] = [];
  for (const e of events) {
    if (e.event_type !== "trial_end") continue;
    try {
      const meta = JSON.parse(e.meta_json) as { fps?: number };
      if (typeof meta.fps === "number") fpsSamples.push(meta.fps);
    } catch {
      // ignore malformed metadata; reported separately below
    }
  }
  const consoleErrors = events.reduce((sum, e) => {
    try {
      const meta = JSON.parse(e.meta_json) as { console_errors?: unknown[] };
      return sum + (Array.isArray(meta.console_errors) ? meta.console_errors.length : 0);
    } catch {
      return sum;
    }
  }, 0);
  const distress = checkins.filter((c) => Number(c.meta.distress ?? 0) > 6).length;
  const over100 = completed.filter((s) => {
    if (!s.started_at || !s.ended_at) return false;
    return new Date(s.ended_at).getTime() - new Date(s.started_at).getTime() > 6000 * 1000;
  }).length;

  const criteria = buildGoNoGo(repo);
  const overall = criteria.some((c) => c.status === "fail")
    ? "fail"
    : criteria.some((c) => c.status === "pass")
      ? "pass"
      : "conditional";

  return {
    generated_at: new Date().toISOString(),
    sessions: {
      total: sessions.length,
      completed: completed.length,
      in_progress: sessions.filter((s) => s.status === "in_progress").length,
      aborted: sessions.filter((s) => s.status === "aborted").length
    },
    counts: {
      events: events.length,
      trials: trials.length,
      main_trials: main.length,
      practice_trials: practice.length,
      questionnaires: answers.length,
      checkins: checkins.length
    },
    data_quality: {
      missing_trial_ends: missingTrialEnds,
      missing_trial_starts: missingStarts,
      duplicate_trial_ends: duplicateEnds,
      event_order_violations: orderViolations,
      clock_skew_flags: clockSkew,
      duplicate_event_ids: Number(repo.getMeta("duplicate_event_ids") ?? 0),
      reconstructable_trials_pct: reconstructablePct,
      questionnaire_completeness_pct: completeness,
      median_fps: median(fpsSamples),
      min_fps: fpsSamples.length ? Math.min(...fpsSamples) : null,
      fps_samples: fpsSamples.length,
      console_errors: consoleErrors,
      distress_events: distress,
      sessions_over_100_min: over100
    },
    criteria,
    calibration: buildCalibration(trials),
    overall
  };
}
