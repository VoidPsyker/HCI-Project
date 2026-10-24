import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_BY_ID, semanticPath, type MenuId, type TaxonomyNode } from "@meridian/taxonomy";
import type { EventInput, EventType, ResearchEvent, StateLabel } from "@meridian/scoring";
import { Repository } from "./repository";
import { config } from "./config";
import type { PracticeTrialSpec, StudyDesign, TrialSpec } from "./design";

const MENU_LABELS: Record<MenuId, string> = {
  A: "Horizontal bar",
  B: "Vertical sidebar",
  C: "Mega menu",
  D: "Fractal tiles",
  E: "Icon grid",
  F: "Radial lattice"
};

function labelFor(id: string): string {
  return NODE_BY_ID.get(id)?.label ?? id;
}

function event(
  design: StudyDesign,
  input: {
    event_type: EventType;
    t_client: number;
    block_id?: string | null;
    trial_id?: string | null;
    task_id?: string | null;
    target_id?: string | null;
    menu_id?: MenuId | null;
    state_label?: StateLabel;
    elapsed_ms?: number | null;
    level?: 0 | 1 | 2 | 3 | null;
    element_id?: string | null;
    element_label?: string | null;
    parent_id?: string | null;
    meta?: Record<string, unknown>;
  }
): EventInput {
  return {
    event_id: crypto.randomUUID(),
    participant_id: design.participantId,
    session_id: design.sessionId,
    study: "pilot",
    block_id: input.block_id ?? null,
    trial_id: input.trial_id ?? null,
    task_id: input.task_id ?? null,
    target_id: input.target_id ?? null,
    menu_id: input.menu_id ?? null,
    state_label: input.state_label ?? "mixed",
    condition: "static",
    event_type: input.event_type,
    t_client: input.t_client,
    elapsed_ms: input.elapsed_ms ?? null,
    level: input.level ?? null,
    element_id: input.element_id ?? null,
    element_label: input.element_label ?? null,
    parent_id: input.parent_id ?? null,
    x: null,
    y: null,
    input_type: "mouse",
    meta: input.meta ?? {}
  };
}

function pathNodes(targetId: string): TaxonomyNode[] {
  return semanticPath(targetId);
}

function successTrial(
  design: StudyDesign,
  spec: { trialId: string; blockId: string; menuId: MenuId; taskId: string; targetId: string; stateLabel: StateLabel; practice: boolean; trialIndex: number },
  start: number
): { events: EventInput[]; end: number } {
  const out: EventInput[] = [];
  const path = pathNodes(spec.targetId);
  const clickPlan =
    spec.menuId === "C"
      ? [path[0], path[2]]
      : path;
  let t = start;
  out.push(
    event(design, {
      event_type: "trial_start",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: 0,
      meta: { practice: spec.practice, trial_index: spec.trialIndex }
    })
  );
  for (const node of clickPlan) {
    if (!node) continue;
    t += 2000;
    out.push(
      event(design, {
        event_type: node.level === 3 ? "leaf_select" : "node_click",
        t_client: t,
        block_id: spec.blockId,
        trial_id: spec.trialId,
        task_id: spec.taskId,
        target_id: spec.targetId,
        menu_id: spec.menuId,
        state_label: spec.stateLabel,
        elapsed_ms: t - start,
        level: node.level,
        element_id: node.id,
        element_label: node.label,
        parent_id: node.parentId,
        meta: { practice: spec.practice, menu: MENU_LABELS[spec.menuId] }
      })
    );
  }
  t += 1000;
  out.push(
    event(design, {
      event_type: "product_view",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: t - start,
      level: 3,
      element_id: spec.targetId,
      element_label: labelFor(spec.targetId),
      meta: { practice: spec.practice, correct: true }
    })
  );
  t += 200;
  out.push(
    event(design, {
      event_type: "trial_end",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: t - start,
      meta: { practice: spec.practice, trial_index: spec.trialIndex, success: true, fps: 60, console_errors: [] }
    })
  );
  return { events: out, end: t };
}

function failureTrial(
  design: StudyDesign,
  spec: { trialId: string; blockId: string; menuId: MenuId; taskId: string; targetId: string; stateLabel: StateLabel; practice: boolean; trialIndex: number },
  start: number
): { events: EventInput[]; end: number } {
  const out: EventInput[] = [];
  const path = pathNodes(spec.targetId);
  const correctDept = path[0];
  const correctSub = path[1];
  const wrongDept = correctDept?.id === "sport" ? "dress" : "sport";
  let t = start;
  out.push(
    event(design, {
      event_type: "trial_start",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: 0,
      meta: { practice: spec.practice, trial_index: spec.trialIndex }
    })
  );
  t += 2000;
  out.push(
    event(design, {
      event_type: "node_click",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: t - start,
      level: 1,
      element_id: wrongDept,
      element_label: labelFor(wrongDept),
      parent_id: null,
      meta: { practice: spec.practice, wrong_department: true }
    })
  );
  t += 2500;
  out.push(
    event(design, {
      event_type: "back",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: t - start,
      meta: { practice: spec.practice }
    })
  );
  t += 2500;
  if (correctDept) {
    out.push(
      event(design, {
        event_type: "node_click",
        t_client: t,
        block_id: spec.blockId,
        trial_id: spec.trialId,
        task_id: spec.taskId,
        target_id: spec.targetId,
        menu_id: spec.menuId,
        state_label: spec.stateLabel,
        elapsed_ms: t - start,
        level: 1,
        element_id: correctDept.id,
        element_label: correctDept.label,
        parent_id: null,
        meta: { practice: spec.practice }
      })
    );
  }
  if (correctSub && spec.menuId !== "C") {
    t += 2000;
    out.push(
      event(design, {
        event_type: "node_click",
        t_client: t,
        block_id: spec.blockId,
        trial_id: spec.trialId,
        task_id: spec.taskId,
        target_id: spec.targetId,
        menu_id: spec.menuId,
        state_label: spec.stateLabel,
        elapsed_ms: t - start,
        level: 2,
        element_id: correctSub.id,
        element_label: correctSub.label,
        parent_id: correctDept?.id ?? null,
        meta: { practice: spec.practice }
      })
    );
  }
  t += 30000;
  out.push(
    event(design, {
      event_type: "give_up",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: t - start,
      meta: { practice: spec.practice }
    })
  );
  t += 100;
  out.push(
    event(design, {
      event_type: "trial_end",
      t_client: t,
      block_id: spec.blockId,
      trial_id: spec.trialId,
      task_id: spec.taskId,
      target_id: spec.targetId,
      menu_id: spec.menuId,
      state_label: spec.stateLabel,
      elapsed_ms: t - start,
      meta: { practice: spec.practice, trial_index: spec.trialIndex, success: false, gave_up: true, fps: 60, console_errors: [] }
    })
  );
  return { events: out, end: t };
}

function checkinMeta(state: StateLabel, phase: "baseline" | "post_induction" | "post_trials", fatigue: number): Record<string, unknown> {
  const stateScore = state === "mixed" ? 3 : 6;
  const base: Record<string, number> = { happy: 2, frustrated: 2, confused: 2, bored: 2 };
  if (state !== "mixed") base[state] = stateScore;
  return {
    phase,
    valence: state === "happy" ? 7 : state === "bored" ? 3 : 4,
    arousal: state === "happy" || state === "confused" ? 5 : state === "frustrated" ? 6 : 3,
    ...base,
    distress: state === "happy" ? 1 : 2,
    dominant_state: state === "mixed" ? "mixed" : state,
    intensity: state === "mixed" ? 3 : 6,
    fatigue
  };
}

function questionnaires(design: StudyDesign, startT: number): { rows: Array<Record<string, unknown>>; events: EventInput[]; tEnd: number } {
  const rows: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  const menus: MenuId[] = ["A", "B", "C", "D", "E", "F"];
  for (const menu of menus) {
    for (let q = 1; q <= 10; q++) {
      rows.push({
        response_id: crypto.randomUUID(),
        session_id: design.sessionId,
        menu_id: menu,
        instrument: "SUS",
        item_id: `Q${q}`,
        value: q % 2 === 0 ? 4 : 2,
        text_value: null,
        answered_at: now
      });
    }
  }
  for (const item of ["mental_demand", "physical_demand", "temporal_demand", "performance", "effort", "frustration"]) {
    rows.push({
      response_id: crypto.randomUUID(),
      session_id: design.sessionId,
      instrument: "NASA_TLX",
      item_id: item,
      value: item === "performance" ? 25 : 45,
      text_value: null,
      answered_at: now
    });
  }
  for (const [item, text] of [
    ["confusing", "Which subcategory held the trail watches."],
    ["fast", "The mega menu once I knew the department."],
    ["frustrating", "The dense menu felt slower than the simpler one."]
  ] as const) {
    rows.push({
      response_id: crypto.randomUUID(),
      session_id: design.sessionId,
      instrument: "OPEN",
      item_id: item,
      value: null,
      text_value: text,
      answered_at: now
    });
  }
  for (const block of design.blocks) {
    rows.push({
      response_id: crypto.randomUUID(),
      session_id: design.sessionId,
      block_id: block.blockId,
      instrument: "CREDIBILITY",
      item_id: `credible_${block.stateLabel}`,
      value: 5,
      text_value: null,
      answered_at: now
    });
  }
  const events: EventInput[] = [];
  let t = startT;
  for (const instrument of ["SUS", "NASA_TLX", "OPEN", "CREDIBILITY"]) {
    t += 1000;
    events.push(
      event(design, {
        event_type: "questionnaire",
        t_client: t,
        state_label: "mixed",
        meta: { instrument, count: rows.filter((r) => r.instrument === instrument).length }
      })
    );
  }
  return { rows, events, tEnd: t };
}

/**
 * Rehearsal sessions are synthetic through the same persisted gaze provenance
 * as any other synthetic capture; completion is never exempted by a label.
 */
function seedSyntheticGaze(repo: Repository, sessionId: string): void {
  repo.createGazeConsent(sessionId, {
    version: "pilot-gaze-consent-placeholder-v1",
    camera_used: false,
    synthetic: true,
    viewport: { width_px: 1920, height_px: 1080 },
    geometry: {
      width_px: 1920,
      height_px: 1080,
      width_mm: 531,
      height_mm: 298,
      viewing_distance_mm: 600
    },
    source: {
      kind: "synthetic",
      adapter: "seed-rehearsal",
      device: "Seeded rehearsal",
      nominal_hz: 60,
      hardware_backed: false,
      synthetic: true,
      capabilities: ["gaze"]
    }
  });
  repo.completeGazeSession(sessionId, {
    calibration: null,
    quality: {
      overall: "fail",
      analysis_ready: false,
      angular_metrics_ready: false,
      missing_pct: 100,
      sample_count: 0,
      valid_sample_count: 0,
      rejected_samples: 0,
      dropped_samples: 0
    },
    metrics: [],
    clock: { method: "same_clock", offset_ms: 0 },
    max_samples: 0,
    rejected_samples: 0,
    dropped_samples: 0
  });
}

function seedSession(repo: Repository, index: number, failurePlan: { Easy: number; Medium: number; Hard: number }): StudyDesign {
  const created = repo.createSession(`SEED-${String(index + 1).padStart(2, "0")}`);
  const sessionId = created.session.session_id;
  repo.recordConsent(sessionId, "pilot-consent-placeholder-v1");
  const demographics = {
    age_band: ["18-24", "25-34", "35-44", "45-54"][index % 4],
    gender: ["woman", "man", "non-binary", "prefer not to say"][index % 4],
    gender_self_describe: "",
    education: ["undergraduate", "postgraduate", "vocational", "secondary"][index % 4],
    shopping_freq: ["monthly", "weekly", "rarely", "monthly"][index % 4],
    watch_expertise: 2 + (index % 5),
    tech_savvy: 3 + (index % 4),
    colour_vision: "typical"
  };
  const design = repo.assignDesign(sessionId, demographics, index);
  repo.addNote(sessionId, "Synthetic rehearsal data. Not a human participant; excluded from confirmatory analysis.");
  seedSyntheticGaze(repo, sessionId);

  const events: EventInput[] = [];
  let t = 0;
  events.push(
    event(design, {
      event_type: "session_start",
      t_client: t,
      state_label: "mixed",
      meta: { synthetic: true, taxonomy_hash: design.taxonomyHash, viewport: "1920x1080", browser: "seed" }
    })
  );
  t += 1000;
  events.push(event(design, { event_type: "consent", t_client: t, state_label: "mixed", meta: { version: "pilot-consent-placeholder-v1", synthetic: true } }));
  t += 1000;
  events.push(event(design, { event_type: "demographics", t_client: t, state_label: "mixed", meta: { synthetic: true } }));
  t += 1000;
  events.push(event(design, { event_type: "checkin", t_client: t, state_label: "mixed", meta: checkinMeta("mixed", "baseline", 1) }));
  t += 5000;
  events.push(event(design, { event_type: "practice_start", t_client: t, state_label: "mixed", meta: { synthetic: true } }));
  t += 1000;

  const failedPracticeMenu = index < 6 ? (["A", "B", "C", "D", "E", "F"][index] as MenuId) : null;
  for (let i = 0; i < design.practiceTrials.length; i++) {
    const p = design.practiceTrials[i] as PracticeTrialSpec;
    const spec = {
      trialId: p.practiceId,
      blockId: "practice",
      menuId: p.menuId,
      taskId: p.taskId,
      targetId: p.targetId,
      stateLabel: "happy" as StateLabel,
      practice: true,
      trialIndex: i
    };
    const result = p.menuId === failedPracticeMenu ? failureTrial(design, spec, t) : successTrial(design, spec, t);
    events.push(...result.events);
    t = result.end + 1500;
  }

  const failedByDifficulty = { Easy: 0, Medium: 0, Hard: 0 };

  for (const block of design.blocks) {
    events.push(
      event(design, {
        event_type: "block_start",
        t_client: t,
        block_id: block.blockId,
        state_label: block.stateLabel,
        meta: { block_index: block.blockIndex, menu_ids: block.menuIds }
      })
    );
    t += 1000;
    events.push(
      event(design, {
        event_type: "induction_start",
        t_client: t,
        block_id: block.blockId,
        state_label: block.stateLabel,
        meta: { script: block.stateLabel, max_seconds: 150 }
      })
    );
    t += 90000;
    events.push(
      event(design, {
        event_type: "induction_end",
        t_client: t,
        block_id: block.blockId,
        state_label: block.stateLabel,
        meta: { completed: true, distress_stop: false }
      })
    );
    t += 2000;
    events.push(
      event(design, {
        event_type: "checkin",
        t_client: t,
        block_id: block.blockId,
        state_label: block.stateLabel,
        meta: checkinMeta(block.stateLabel, "post_induction", 3)
      })
    );
    t += 5000;
    for (const trialId of block.trialIds) {
      const trial = design.trials.find((x) => x.trialId === trialId) as TrialSpec;
      const fail = failedByDifficulty[trial.difficulty] < failurePlan[trial.difficulty];
      if (fail) failedByDifficulty[trial.difficulty]++;
      const spec = {
        trialId: trial.trialId,
        blockId: trial.blockId,
        menuId: trial.menuId,
        taskId: trial.taskId,
        targetId: trial.targetId,
        stateLabel: trial.stateLabel,
        practice: false,
        trialIndex: trial.trialIndex
      };
      const result = fail ? failureTrial(design, spec, t) : successTrial(design, spec, t);
      events.push(...result.events);
      t = result.end + 1500;
    }
    events.push(
      event(design, {
        event_type: "checkin",
        t_client: t,
        block_id: block.blockId,
        state_label: block.stateLabel,
        meta: checkinMeta(block.stateLabel, "post_trials", 4)
      })
    );
    t += 10000;
    events.push(
      event(design, {
        event_type: "block_end",
        t_client: t,
        block_id: block.blockId,
        state_label: block.stateLabel,
        meta: { neutral_reset_seconds: 60 }
      })
    );
    t += 60000;
  }

  const q = questionnaires(design, t + 1000);
  events.push(...q.events);
  t = q.tEnd + 1000;
  events.push(
    event(design, {
      event_type: "session_end",
      t_client: t,
      state_label: "mixed",
      meta: { completed: true, console_errors: [], completion_code: `PILOT-${String(index + 1).padStart(3, "0")}` }
    })
  );

  repo.insertEvents(events);
  repo.insertQuestionnaires(q.rows);
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - t);
  repo.db
    .prepare("UPDATE sessions SET started_at=?, ended_at=?, status='completed', phase='debrief' WHERE session_id=?")
    .run(startedAt.toISOString(), endedAt.toISOString(), sessionId);
  return design;
}

export function seedDatabase(repo: Repository, count = 8): number {
  const existing = repo.listAdminSessions().filter((s) => s.label.startsWith("SEED-"));
  for (const s of existing) repo.withdrawSession(s.session_id);
  const plans = [
    { Easy: 1, Medium: 1, Hard: 1 },
    { Easy: 0, Medium: 1, Hard: 1 },
    { Easy: 0, Medium: 1, Hard: 1 },
    { Easy: 0, Medium: 1, Hard: 1 },
    { Easy: 0, Medium: 0, Hard: 2 },
    { Easy: 0, Medium: 0, Hard: 1 },
    { Easy: 0, Medium: 0, Hard: 0 },
    { Easy: 0, Medium: 0, Hard: 0 }
  ];
  for (let i = 0; i < count; i++) seedSession(repo, i, plans[i % plans.length] ?? { Easy: 0, Medium: 0, Hard: 0 });
  return count;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const repo = new Repository(config.dbPath, config.rawDir, config.seed);
  const count = seedDatabase(repo, 8);
  console.log(`Seeded ${count} synthetic rehearsal sessions (SEED-01..SEED-${String(count).padStart(2, "0")}).`);
  console.log(`Database: ${config.dbPath}`);
  console.log(`Raw events: ${config.rawDir}`);
  repo.close();
}
