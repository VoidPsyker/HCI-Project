import { describe, expect, it } from "vitest";
import { scoreTrial } from "../src/scoreTrial";
import type { EventType, ResearchEvent } from "../src/events";

let seq = 0;
function ev(partial: Partial<ResearchEvent> & { event_type: EventType; t_client: number }): ResearchEvent {
  seq++;
  return {
    event_id: `e${seq}`,
    participant_id: "p1",
    session_id: "s1",
    study: "pilot",
    block_id: "block_happy",
    trial_id: "tr1",
    task_id: "T01",
    target_id: "sport.prodiver.steel-blue",
    menu_id: "A",
    state_label: "happy",
    condition: "static",
    elapsed_ms: null,
    level: null,
    element_id: null,
    element_label: null,
    parent_id: null,
    x: null,
    y: null,
    input_type: "mouse",
    meta: {},
    ...partial
  };
}

describe("scoreTrial", () => {
  it("scores a perfect A path", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 1000, elapsed_ms: 0 }),
        ev({ event_type: "node_click", t_client: 1100, elapsed_ms: 100, level: 1, element_id: "sport" }),
        ev({ event_type: "node_click", t_client: 1300, elapsed_ms: 300, level: 2, element_id: "sport.prodiver" }),
        ev({ event_type: "leaf_select", t_client: 1500, elapsed_ms: 500, level: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "product_view", t_client: 1800, elapsed_ms: 800, level: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "trial_end", t_client: 1900, elapsed_ms: 900 })
      ],
      "sport.prodiver.steel-blue",
      "A"
    );
    expect(score.success).toBe(true);
    expect(score.completionTimeMs).toBe(800);
    expect(score.clicks).toBe(3);
    expect(score.pathEfficiency).toBe(1);
    expect(score.firstClickCorrect).toBe(true);
    expect(score.wrongDepartment).toBe(false);
    expect(score.wrongSubcategory).toBe(false);
    expect(score.wrongLeaf).toBe(false);
    expect(score.trialEndCount).toBe(1);
    expect(score.missingTrialStart).toBe(false);
    expect(score.missingTrialEnd).toBe(false);
    expect(score.path).toEqual(["sport", "sport.prodiver", "sport.prodiver.steel-blue"]);
  });

  it("scores the two-click mega menu path", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0, elapsed_ms: 0 }),
        ev({ event_type: "node_click", t_client: 50, level: 1, element_id: "sport" }),
        ev({ event_type: "leaf_select", t_client: 90, level: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "product_view", t_client: 120, elapsed_ms: 120, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "trial_end", t_client: 130, elapsed_ms: 130 })
      ],
      "sport.prodiver.steel-blue",
      "C"
    );
    expect(score.success).toBe(true);
    expect(score.pathEfficiency).toBe(1);
    expect(score.clicks).toBe(2);
  });

  it("flags wrong department, subcategory, leaf, backtrack, switch and search", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0, elapsed_ms: 0 }),
        ev({ event_type: "search_attempt", t_client: 10, elapsed_ms: 10, element_id: "search" }),
        ev({ event_type: "node_click", t_client: 20, level: 1, element_id: "dress" }),
        ev({ event_type: "node_click", t_client: 30, level: 1, element_id: "sport" }),
        ev({ event_type: "node_click", t_client: 40, level: 2, element_id: "sport.aqua" }),
        ev({ event_type: "back", t_client: 50, elapsed_ms: 50 }),
        ev({ event_type: "node_click", t_client: 60, level: 2, element_id: "sport.prodiver" }),
        ev({ event_type: "leaf_select", t_client: 70, level: 3, element_id: "sport.prodiver.carbon-black" }),
        ev({ event_type: "leaf_select", t_client: 80, level: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "product_view", t_client: 90, elapsed_ms: 90, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "trial_end", t_client: 100, elapsed_ms: 100 })
      ],
      "sport.prodiver.steel-blue",
      "A"
    );
    expect(score.success).toBe(true);
    expect(score.wrongDepartment).toBe(true);
    expect(score.wrongSubcategory).toBe(true);
    expect(score.wrongLeaf).toBe(true);
    expect(score.backtracks).toBe(1);
    expect(score.categorySwitches).toBe(2);
    expect(score.searchAttempts).toBe(1);
    expect(score.clicks).toBe(6);
    expect(score.pathEfficiency).toBe(0.5);
  });

  it("scores a timeout as a 120 s failure", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 500, elapsed_ms: 0 }),
        ev({ event_type: "timeout", t_client: 120500, elapsed_ms: 120000 }),
        ev({ event_type: "trial_end", t_client: 120600, elapsed_ms: 120100 })
      ],
      "sport.prodiver.steel-blue",
      "B"
    );
    expect(score.success).toBe(false);
    expect(score.timedOut).toBe(true);
    expect(score.elapsedMs).toBe(120000);
    expect(score.pathEfficiency).toBeNull();
  });

  it("scores a give-up using the trial_end timestamp", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 1000, elapsed_ms: 0 }),
        ev({ event_type: "give_up", t_client: 4000, elapsed_ms: 3000 }),
        ev({ event_type: "trial_end", t_client: 4100, elapsed_ms: 3100 })
      ],
      "sport.prodiver.steel-blue",
      "D"
    );
    expect(score.gaveUp).toBe(true);
    expect(score.elapsedMs).toBe(3100);
    expect(score.missingTrialEnd).toBe(false);
  });

  it("handles a missing trial start and missing trial end", () => {
    const score = scoreTrial(
      [ev({ event_type: "product_view", t_client: 20, element_id: "sport.prodiver.steel-blue", meta: { product_id: "sport.prodiver.steel-blue" } })],
      "sport.prodiver.steel-blue",
      "E"
    );
    expect(score.success).toBe(true);
    expect(score.completionTimeMs).toBeNull();
    expect(score.missingTrialStart).toBe(true);
    expect(score.missingTrialEnd).toBe(true);
    expect(score.trialEndCount).toBe(0);
  });

  it("accepts meta.correct product views", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0 }),
        ev({ event_type: "product_view", t_client: 10, element_id: "other", meta: { correct: true } }),
        ev({ event_type: "trial_end", t_client: 20 })
      ],
      "sport.prodiver.steel-blue",
      "F"
    );
    expect(score.success).toBe(true);
    expect(score.completionTimeMs).toBe(10);
  });

  it("handles a successful trial with no clicks", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0 }),
        ev({ event_type: "product_view", t_client: 10, elapsed_ms: 5, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "trial_end", t_client: 20 })
      ],
      "sport.prodiver.steel-blue",
      "A"
    );
    expect(score.success).toBe(true);
    expect(score.clicks).toBe(0);
    expect(score.pathEfficiency).toBeNull();
    expect(score.firstClickCorrect).toBeNull();
  });

  it("uses trial_end client time when elapsed_ms is absent", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 100 }),
        ev({ event_type: "trial_end", t_client: 900 })
      ],
      "sport.prodiver.steel-blue",
      "B"
    );
    expect(score.elapsedMs).toBe(800);
  });

  it("handles a failure with no timeout and no end event", () => {
    const score = scoreTrial([ev({ event_type: "trial_start", t_client: 100 })], "sport.prodiver.steel-blue", "A");
    expect(score.success).toBe(false);
    expect(score.elapsedMs).toBeNull();
    expect(score.missingTrialEnd).toBe(true);
  });

  it("handles an end event with elapsed_ms but no start", () => {
    const score = scoreTrial([ev({ event_type: "trial_end", t_client: 100, elapsed_ms: 50 })], "sport.prodiver.steel-blue", "A");
    expect(score.elapsedMs).toBe(50);
  });

  it("handles an end event with neither elapsed_ms nor start", () => {
    const score = scoreTrial([ev({ event_type: "trial_end", t_client: 100 })], "sport.prodiver.steel-blue", "A");
    expect(score.elapsedMs).toBeNull();
  });

  it("ignores incomplete level-2 clicks and null leaf ids", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0 }),
        ev({ event_type: "node_click", t_client: 10, level: 2, element_id: null }),
        ev({ event_type: "node_click", t_client: 20, level: 1, element_id: null }),
        ev({ event_type: "leaf_select", t_client: 30, level: 3, element_id: null }),
        ev({ event_type: "trial_end", t_client: 40 })
      ],
      "sport.prodiver.steel-blue",
      "A"
    );
    expect(score.wrongSubcategory).toBe(false);
    expect(score.firstClickCorrect).toBeNull();
    expect(score.wrongLeaf).toBe(false);
  });

  it("does not count a same-department reselect as a switch", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0 }),
        ev({ event_type: "node_click", t_client: 10, level: 1, element_id: "sport" }),
        ev({ event_type: "node_click", t_client: 20, level: 1, element_id: "sport" }),
        ev({ event_type: "node_click", t_client: 30, level: 2, element_id: "sport.prodiver" }),
        ev({ event_type: "node_click", t_client: 40, level: 2, element_id: "sport.prodiver" }),
        ev({ event_type: "leaf_select", t_client: 50, level: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "product_view", t_client: 60, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "trial_end", t_client: 70 })
      ],
      "sport.prodiver.steel-blue",
      "A"
    );
    expect(score.categorySwitches).toBe(0);
  });

  it("caps path efficiency at 1", () => {
    const score = scoreTrial(
      [
        ev({ event_type: "trial_start", t_client: 0 }),
        ev({ event_type: "node_click", t_client: 1, level: 1, element_id: "sport" }),
        ev({ event_type: "leaf_select", t_client: 2, level: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "product_view", t_client: 3, element_id: "sport.prodiver.steel-blue" }),
        ev({ event_type: "trial_end", t_client: 4 })
      ],
      "sport.prodiver.steel-blue",
      "C"
    );
    expect(score.pathEfficiency).toBe(1);
  });
});
