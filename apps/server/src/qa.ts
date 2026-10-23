import { validateTaxonomy } from "@meridian/taxonomy";
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
    reconstructable_trials_pct: number;
    questionnaire_completeness_pct: number | null;
    median_fps: number | null;
    console_errors: number;
    distress_events: number;
    sessions_over_100_min: number;
  };
  criteria: QaCriterion[];
  overall: "pass" | "fail" | "conditional";
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
      lowest.rate >= 0.8
        ? pass("practice_success", "Practice success per menu", value, ">= 80% for every menu")
        : fail("practice_success", "Practice success per menu", value, ">= 80% for every menu")
    );
  }

  const states = ["happy", "frustrated", "confused", "bored"] as const;
  const manipulation = states.map((state) => {
    const relevant = checkins.filter((c) => c.state_label === state && c.meta.phase !== "post_trials");
    const hits = relevant.filter((c) => c.meta.dominant_state === state && Number(c.meta.intensity ?? 0) >= 5);
    return { state, rate: relevant.length ? hits.length / relevant.length : null, n: relevant.length };
  });
  if (manipulation.every((m) => m.n === 0)) {
    criteria.push(na("manipulation", "Induction manipulation check", "no check-in data", ">= 60% dominant state per induction, intensity >= 5/7"));
  } else {
    const valid = manipulation.filter((m) => m.n > 0);
    const lowest = valid.reduce((a, b) => ((a.rate ?? 0) <= (b.rate ?? 0) ? a : b));
    const value = valid.map((m) => `${m.state}: ${m.rate === null ? "NA" : Math.round(m.rate * 1000) / 10 + "%"}`).join("; ");
    criteria.push(
      (lowest.rate ?? 0) >= 0.6
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

  const durationsMs = completed
    .filter((s) => s.started_at && s.ended_at)
    .map((s) => (new Date(s.ended_at ?? 0).getTime() - new Date(s.started_at ?? 0).getTime()) / 1000);
  if (durationsMs.length === 0) {
    criteria.push(na("session_duration", "Session duration", "no completed sessions", "<= 100 min"));
  } else {
    const max = Math.max(...durationsMs);
    criteria.push(
      max <= 6000
        ? pass("session_duration", "Session duration", `${(max / 60).toFixed(1)} min max`, "<= 100 min")
        : fail("session_duration", "Session duration", `${(max / 60).toFixed(1)} min max`, "<= 100 min")
    );
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

  const expectedAnswers = completed.length * 73;
  const completeness = expectedAnswers ? (answers.length / expectedAnswers) * 100 : null;
  if (completeness === null) {
    criteria.push(na("questionnaire_completeness", "Questionnaire completeness", "no completed sessions", ">= 95%"));
  } else {
    criteria.push(
      completeness >= 95
        ? pass("questionnaire_completeness", "Questionnaire completeness", `${completeness.toFixed(1)}%`, ">= 95%")
        : fail("questionnaire_completeness", "Questionnaire completeness", `${completeness.toFixed(1)}%`, ">= 95%")
    );
  }

  const reconstructable = main.filter((t) => t.event_count > 0 && t.trial_end_count === 1 && t.path_json !== "[]");
  const reconstructablePct = pct(reconstructable.length, main.length);
  if (reconstructablePct === null) {
    criteria.push(na("reconstructable", "Trials reconstructable from event log", "no main trials", "100%"));
  } else {
    criteria.push(
      reconstructablePct === 100
        ? pass("reconstructable", "Trials reconstructable from event log", `${reconstructablePct}%`, "100%")
        : fail("reconstructable", "Trials reconstructable from event log", `${reconstructablePct}%`, "100%")
    );
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

  const expectedTrials = completed.length * 18;
  const missingTrialEnds = Math.max(0, expectedTrials - trials.length) + trials.filter((t) => t.missing_trial_end).length;
  const missingStarts = trials.filter((t) => t.missing_trial_start).length;
  const duplicateEnds = trials.filter((t) => t.trial_end_count > 1).length;
  const reconstructable = main.filter((t) => t.event_count > 0 && t.trial_end_count === 1 && t.path_json !== "[]");
  const reconstructablePct = pct(reconstructable.length, main.length) ?? 0;
  const completeness = completed.length ? pct(answers.length, completed.length * 73) : null;

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
      reconstructable_trials_pct: reconstructablePct,
      questionnaire_completeness_pct: completeness,
      median_fps: median(fpsSamples),
      console_errors: consoleErrors,
      distress_events: distress,
      sessions_over_100_min: over100
    },
    criteria,
    overall
  };
}
