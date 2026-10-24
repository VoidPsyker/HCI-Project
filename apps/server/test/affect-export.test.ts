import { expect, it } from "vitest";
import { buildExportBundle } from "../src/exports";
import type { Repository } from "../src/repository";

function trialRow(checkins: Array<{ session_id: string; block_id: string; meta: Record<string, unknown> }>,
  events: Array<{ session_id: string; event_type: string; meta_json: string }> = []) {
  const repo = {
    allEvents: () => events, allCheckins: () => checkins,
    allTrials: () => [{ session_id: "session-1", block_id: "block-1", state_label: "happy", path_json: "[]", first_click_ok: null }],
    allQuestionnaires: () => [], allAssignments: () => []
  } as unknown as Repository;
  const csv = buildExportBundle(repo).find((file) => file.name === "trials.csv")!.content;
  const [header, row] = csv.trim().split("\r\n");
  return Object.fromEntries(header!.split(",").map((key, index) => [key, row!.split(",")[index]]));
}

const checkin = {
  session_id: "session-1", block_id: "block-1",
  meta: { phase: "post_induction", happy: 6, frustrated: 6, confused: 2, bored: 2, valence: 7, arousal: 5 }
};

it("keeps assigned and reported state separate for a tied report", () => {
  expect(trialRow([checkin])).toMatchObject({ state_label: "happy", reported_state: "mixed", manipulation_check_passed: "0" });
});

it("carries synthetic provenance and leaves missing starts unknown", () => {
  expect(trialRow([]).synthetic).toBe("");
  expect(trialRow([], [{ session_id: "session-1", event_type: "session_start", meta_json: '{"synthetic":true}' }]).synthetic).toBe("1");
  expect(trialRow([], [{ session_id: "session-1", event_type: "session_start", meta_json: '{}' }]).synthetic).toBe("0");
});

it("does not link another session or a post-trial check to the trial", () => {
  expect(trialRow([
    { ...checkin, session_id: "other-session" },
    { ...checkin, meta: { ...checkin.meta, phase: "post_trials" } }
  ])).toMatchObject({ reported_state: "", manipulation_check_passed: "" });
});

it("links a qualifying post-induction report to its session and block", () => {
  expect(trialRow([{ ...checkin, meta: { ...checkin.meta, frustrated: 2 } }]))
    .toMatchObject({ state_label: "happy", reported_state: "happy", manipulation_check_passed: "1" });
});
