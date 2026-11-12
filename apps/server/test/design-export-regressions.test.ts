import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { designErrors, uniformChiSquare } from "../src/balance";
import { generateDesign } from "../src/design";
import { buildExportBundle, toCsv } from "../src/exports";
import { buildGoNoGo, buildQaReport } from "../src/qa";
import { seedDatabase } from "../src/seed";
import { Repository } from "../src/repository";

const design = () => generateDesign({ sessionId: "s", participantId: "p", seed: "test", stratum: "x", sequenceIndex: 0 });
function repository(overrides: Record<string, unknown> = {}) {
  return { listAdminSessions: () => [], allEvents: () => [], allTrials: () => [], allCheckins: () => [],
    allQuestionnaires: () => [], allAssignments: () => [], allDemographics: () => [], getMeta: () => null, ...overrides } as unknown as Repository;
}
it("escapes CSV headers as well as values", () => {
  expect(toCsv([{ 'a,"b': 'line\r\n"two"' }], ['a,"b'])).toBe('"a,""b"\r\n"line\r\n""two"""\r\n');
});
it("includes assignments and tasks in both export formats", () => {
  const files = buildExportBundle(repository({ allAssignments: () => [{ session_id: "s", design_json: '{}' }] }));
  for (const kind of ["assignments", "tasks"]) {
    const csv = files.find((f) => f.name === `${kind}.csv`)!;
    const json = files.find((f) => f.name === `${kind}.jsonl`);
    expect(json).toBeDefined();
    expect(json?.rows).toBe(csv.rows);
    expect(Object.keys(JSON.parse(json!.content.split("\n")[0]!))).toEqual(csv.content.split("\r\n")[0]!.split(","));
  }
});
it("rejects unknown balance categories instead of passing them as balanced", () => {
  expect(uniformChiSquare("menu", ["A", "B"], ["unknown"]).balanced).toBe(false);
});
it("detects trial/block assignments that disagree even when marginal counts balance", () => {
  const d = design();
  d.trials[0]!.menuId = d.trials[1]!.menuId;
  expect(designErrors("s", d).length).toBeGreaterThan(0);
});
it("does not mark a trial without its start reconstructable", () => {
  const repo = repository({ allTrials: () => [{ practice: false, success: false, event_count: 1, trial_end_count: 1, path_json: "[]", missing_trial_start: 1 }] });
  expect(buildGoNoGo(repo).find((c) => c.id === "reconstructable")?.status).toBe("fail");
});
it("does not pass practice success with five untested menus", () => {
  const repo = repository({ allTrials: () => [{ practice: true, menu_id: "A", success: true }] });
  expect(buildGoNoGo(repo).find((c) => c.id === "practice_success")?.status).toBe("fail");
});
it("counts missing trials per completed session without borrowing in-progress trials", () => {
  const repo = repository({ listAdminSessions: () => [{ session_id: "done", status: "completed" }],
    allTrials: () => Array.from({ length: 18 }, (_, i) => ({ session_id: "other", trial_id: `${i}`, practice: false, success: false })) });
  expect(buildQaReport(repo).data_quality.missing_trial_ends).toBe(18);
});
it("rejects invalid seed counts before removing existing sessions", () => {
  let read = false;
  const repo = repository({ listAdminSessions: () => { read = true; return []; } });
  expect(() => seedDatabase(repo, -1)).toThrow();
  expect(read).toBe(false);
});
it("uses the short protocol questionnaire denominator consistently in report and criterion", () => {
  const answers = [
    ...Array.from({ length: 10 }, (_, i) => ({ session_id: "s", instrument: "SUS", menu_id: "A", item_id: `Q${i + 1}` })),
    ...["mental_demand", "physical_demand", "temporal_demand", "performance", "effort", "frustration"].map((item_id) => ({ session_id: "s", instrument: "NASA_TLX", item_id })),
    ...["confusing", "fast", "frustrating"].map((item_id) => ({ session_id: "s", instrument: "OPEN", item_id })),
    ...["happy", "frustrated", "confused", "bored"].map((state) => ({ session_id: "s", instrument: "CREDIBILITY", item_id: `credible_${state}` })),
    { session_id: "s", instrument: "PREFERENCE", item_id: "preferred_menu" }
  ];
  const repo = repository({ listAdminSessions: () => [{ session_id: "s", status: "completed" }],
    allEvents: () => [{ session_id: "s", event_type: "session_start", meta_json: '{"protocol_version":"short-pilot-v3"}' }],
    allQuestionnaires: () => [...answers, ...answers, { session_id: "in-progress", item_id: "extra" }] });
  expect(buildQaReport(repo).data_quality.questionnaire_completeness_pct).toBe(100);
});

it("excludes withdrawn records and keeps gaze artifacts out of behavioural exports", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "design-export-"));
  const repo = new Repository(":memory:", path.join(directory, "raw"), "test", path.join(directory, "gaze"));
  try {
    seedDatabase(repo, 2);
    const session = repo.listAdminSessions()[0]!;
    const before = buildExportBundle(repo);
    expect(before.find((file) => file.name === "trials.jsonl")!.rows).toBe(36);
    expect(before.every((file) => !file.name.includes("gaze"))).toBe(true);
    const trials = before.find((file) => file.name === "trials.jsonl")!.content.trim().split("\n").map((line) => JSON.parse(line));
    expect(trials.every((trial) => trial.synthetic === true)).toBe(true);
    expect(trials.every((trial) => !("gaze_x" in trial) && !("affect_prediction" in trial))).toBe(true);
    repo.withdrawSession(session.session_id);
    const after = buildExportBundle(repo);
    for (const file of after) {
      expect(file.content).not.toContain(session.session_id);
      expect(file.content).not.toContain(session.participant_id);
    }
    expect(after.find((file) => file.name === "trials.jsonl")!.rows).toBe(18);
  } finally {
    repo.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
