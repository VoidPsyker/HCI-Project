import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRACTICE_TASKS, SCORED_TASKS } from "@meridian/taxonomy";
import { buildBalanceReport, designErrors } from "../src/balance";
import {
  balancedLatinSquare,
  BLOCK_ORDERS,
  generateDesign,
  SEQUENCE_CYCLE,
  sequenceFactors,
  type StateLabel
} from "../src/design";
import { Repository } from "../src/repository";

const SEED = "design-test-seed";
const design = (sequenceIndex: number, seed = SEED) =>
  generateDesign({ sessionId: `S${sequenceIndex}`, participantId: `P${sequenceIndex}`, sequenceIndex, stratum: "x", seed, now: "2026-10-24T00:00:00.000Z" });

describe("Block orders", () => {
  it("always puts confusion before frustration", () => {
    for (const order of BLOCK_ORDERS) expect(order.indexOf("confused")).toBeLessThan(order.indexOf("frustrated"));
  });

  it("uses every state once per order and puts happy and bored in every position once", () => {
    for (const order of BLOCK_ORDERS) expect(new Set(order).size).toBe(4);
    for (const state of ["happy", "bored"] as const) {
      expect(BLOCK_ORDERS.map((order) => order.indexOf(state)).sort()).toEqual([0, 1, 2, 3]);
    }
  });
});

describe("Latin squares", () => {
  it("builds a 6 x 6 Williams square: Latin, and every ordered pair adjacent exactly once", () => {
    const square = balancedLatinSquare(6);
    for (const row of square) expect(new Set(row).size).toBe(6);
    for (let c = 0; c < 6; c++) expect(new Set(square.map((row) => row[c])).size).toBe(6);
    const pairs = new Set(square.flatMap((row) => row.slice(1).map((v, i) => `${row[i]}>${v}`)));
    expect(pairs.size).toBe(30);
  });
});

describe("generateDesign", () => {
  const cycle = Array.from({ length: SEQUENCE_CYCLE }, (_, i) => design(i));
  const tally = (keys: string[]) => Object.values(keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {}));

  it("is a fixed schedule: the same sequence gives the same searches whatever the seed", () => {
    expect(design(5)).toEqual(design(5));
    expect(design(5, "another-seed").trials).toEqual(design(5).trials);
    expect(design(5, "another-seed").practiceTrials).toEqual(design(5).practiceTrials);
  });

  it("satisfies every structural rule for a full cycle", () => {
    for (const [i, d] of cycle.entries()) expect(designErrors(`S${i}`, d)).toEqual([]);
  });

  it("meets every block order with every menu row once per 24 people", () => {
    const factors = cycle.map((d) => sequenceFactors(d.sequenceIndex));
    expect(tally(factors.map((f) => String(f.blockOrderRow)))).toEqual([6, 6, 6, 6]);
    expect(tally(factors.map((f) => String(f.menuRow)))).toEqual([4, 4, 4, 4, 4, 4]);
    expect(new Set(factors.map((f) => `${f.blockOrderRow}:${f.menuRow}`)).size).toBe(24);
    expect(new Set(factors.map((f) => f.colourRow)).size).toBe(24);
  });

  it("gives every participant all 24 tasks once, two of each difficulty in every block", () => {
    for (const d of cycle) {
      expect(d.trials.map((t) => t.taskId).sort()).toEqual(SCORED_TASKS.map((t) => t.id).sort());
      for (const block of d.blocks) {
        expect(tally(d.trials.filter((t) => t.blockId === block.blockId).map((t) => t.difficulty))).toEqual([2, 2, 2]);
      }
    }
  });

  it("puts each menu in each position after every emotion's scenario equally often", () => {
    const trials = cycle.flatMap((d) => d.trials);
    const counts = tally(trials.map((t) => `${t.stateLabel}:${t.menuId}:${t.trialIndex}`));
    expect(counts).toHaveLength(4 * 6 * 6);
    expect(new Set(counts)).toEqual(new Set([4]));
  });

  it("pairs every task with every menu equally often and every emotion with every task group", () => {
    const trials = cycle.flatMap((d) => d.trials);
    const taskMenu = tally(trials.map((t) => `${t.taskId}:${t.menuId}`));
    expect(taskMenu).toHaveLength(24 * 6);
    expect(new Set(taskMenu)).toEqual(new Set([4]));
    const stateTask = tally(trials.map((t) => `${t.stateLabel}:${t.taskId}`));
    expect(stateTask).toHaveLength(4 * 24);
    expect(new Set(stateTask)).toEqual(new Set([6]));
  });

  it("practises the six practice tasks, one per menu, in an order no scored block uses", () => {
    for (const d of cycle) {
      const practice = d.practiceTrials;
      expect(practice.map((p) => p.taskId)).toEqual(PRACTICE_TASKS.map((t) => t.id));
      expect(new Set(practice.map((p) => p.menuId)).size).toBe(6);
      for (const block of d.blocks) expect(block.menuIds).not.toEqual(practice.map((p) => p.menuId));
    }
  });

  it("reports a balanced chi-square audit for a complete block", () => {
    const report = buildBalanceReport(cycle);
    expect(report.design_errors).toEqual([]);
    expect(report.balance_ok).toBe(true);
    expect(report.chi_square.find((t) => t.factor === "block_order")?.chi_square).toBe(0);
  });

  it("flags an assignment that puts frustration before confusion", () => {
    const base = design(0);
    const states = base.blocks.map((b) => b.stateLabel);
    const swap = (state: StateLabel): StateLabel => (state === "confused" ? "frustrated" : state === "frustrated" ? "confused" : state);
    const swapped = base.blocks.map((b) => ({ ...b, stateLabel: swap(b.stateLabel) }));
    expect(states.indexOf("confused")).toBeLessThan(states.indexOf("frustrated"));
    const trials = base.trials.map((t) => ({ ...t, stateLabel: swapped[t.blockIndex]!.stateLabel }));
    expect(designErrors("S0", { ...base, blocks: swapped, trials })).toContain("S0: frustration before confusion");
  });

  it("flags an unbalanced allocation", () => {
    const report = buildBalanceReport(Array.from({ length: 24 }, () => design(0)));
    expect(report.balance_ok).toBe(false);
  });
});

describe("server-side assignment audit", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function assignAll(seed: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-audit-"));
    dirs.push(dir);
    const repo = new Repository(":memory:", path.join(dir, "raw"), seed, path.join(dir, "gaze"));
    const demographics = [
      { gender: "woman", shopping_freq: "weekly" },
      { gender: "man", shopping_freq: "weekly" },
      { gender: "woman", shopping_freq: "weekly" }
    ];
    for (const [i, demo] of demographics.entries()) {
      const { session } = repo.createSession(`P${i}`);
      repo.recordConsent(session.session_id, "v1");
      repo.assignDesign(session.session_id, demo);
    }
    const rows = repo.allAssignments();
    repo.close();
    return rows;
  }

  it("writes sequence, orders, target set, colours and seed hash, in arrival order", () => {
    const a = assignAll(SEED);
    const b = assignAll(SEED);
    expect(a).toHaveLength(3);
    const fields = ["sequence_index", "sequence_id", "stratum", "block_order", "menu_orders", "target_set", "colour_mapping", "seed_hash"];
    const pick = (row: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f, row[f]]));
    expect(a.map(pick)).toEqual(b.map(pick));
    expect(a[0]?.seed_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a[0]?.seed_hash).not.toContain(SEED);
    expect(a.map((row) => row.sequence_index)).toEqual([0, 1, 2]);
  });
});
