import { describe, expect, it } from "vitest";
import { buildCalibration, buildGoNoGo } from "../src/qa";
import type { Repository } from "../src/repository";

const states = ["happy", "frustrated", "confused", "bored"] as const;
const checkins = states.map((state) => ({
  state_label: state,
  meta: {
    phase: "post_induction", happy: 2, frustrated: 2, confused: 2, bored: 2,
    [state]: 6, valence: state === "happy" ? 7 : 4,
    arousal: state === "bored" ? 3 : 5, distress: 0
  }
}));

function criterion(rows: typeof checkins) {
  const repo = {
    listAdminSessions: () => [], allTrials: () => [], allCheckins: () => rows,
    allEvents: () => [], allQuestionnaires: () => []
  } as unknown as Repository;
  return buildGoNoGo(repo).find((item) => item.id === "manipulation");
}

describe("trial reconstruction QA", () => {
  const trial = (practice: boolean, path_json: string) => ({ practice, path_json, event_count: 5, trial_end_count: 1, menu_id: "A", success: true });
  function reconstruction(trials: unknown[]) {
    const repo = {
      listAdminSessions: () => [], allTrials: () => trials, allCheckins: () => [],
      allEvents: () => [], allQuestionnaires: () => []
    } as unknown as Repository;
    const criteria = buildGoNoGo(repo);
    return { practice: criteria.find((c) => c.id === "practice_reconstructable"), main: criteria.find((c) => c.id === "reconstructable") };
  }
  it("checks practice trials separately from main trials", () => {
    const result = reconstruction([trial(true, "[]"), trial(true, '["sport"]'), trial(false, '["sport"]')]);
    expect(result.practice?.status).toBe("fail");
    expect(result.practice?.value).toBe("50%");
    expect(result.main?.status).toBe("pass");
  });
  it("accepts an empty path for a trial that ended without navigation", () => {
    const giveUp = { ...trial(false, "[]"), success: false };
    expect(reconstruction([giveUp, trial(false, '["sport"]')]).main?.status).toBe("pass");
    expect(reconstruction([{ ...giveUp, trial_end_count: 0 }]).main?.status).toBe("fail");
  });
});

describe("induction QA", () => {
  it("passes all four qualifying inductions from raw ratings", () => {
    expect(criterion(checkins)?.status).toBe("pass");
  });
  it("fails when a high happy rating has incompatible valence", () => {
    expect(criterion(checkins.map((row) => row.state_label === "happy"
      ? { ...row, meta: { ...row.meta, valence: 4 } } : row))?.status).toBe("fail");
  });
  it("fails when the dominant rate passes but mean intended intensity is below 5/7", () => {
    const happy = checkins.find((row) => row.state_label === "happy")!;
    const weak = { ...happy, meta: { ...happy.meta, happy: 1, frustrated: 6, valence: 4 } };
    const atFive = { ...happy, meta: { ...happy.meta, happy: 5 } };
    const rows = [...checkins.filter((row) => row !== happy), atFive, atFive, atFive, weak, weak];
    const result = criterion(rows);
    expect(result?.value).toContain("happy: 60%, intensity 3.4");
    expect(result?.status).toBe("fail");
  });
  it("does not pass an incomplete set of inductions", () => {
    expect(criterion(checkins.slice(0, 1))?.status).toBe("fail");
    expect(criterion(checkins.map((row) => ({ ...row, meta: { ...row.meta, phase: "post_trials" } })))?.status).toBe("na");
  });
});

describe("task calibration table", () => {
  it("summarises main-trial success and median successful time by task and by menu", () => {
    const row = (task_id: string, menu_id: string, success: boolean, ms: number | null, practice = false) => ({
      task_id, menu_id, success, completion_time_ms: ms, practice, difficulty: task_id === "T01" ? "Easy" : "Hard"
    });
    const table = buildCalibration([
      row("T01", "A", true, 10_000), row("T01", "B", true, 20_000), row("T02", "A", false, null),
      row("T02", "A", true, 4_000, true)
    ]);
    expect(table.by_task).toEqual([
      { key: "T01", difficulty: "Easy", n: 2, success_pct: 100, median_success_s: 15 },
      { key: "T02", difficulty: "Hard", n: 1, success_pct: 0, median_success_s: null }
    ]);
    expect(table.by_menu.find((m) => m.key === "A")).toEqual({ key: "A", n: 2, success_pct: 50, median_success_s: 10 });
  });
});
