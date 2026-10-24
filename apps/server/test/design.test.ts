import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBalanceReport, designErrors } from "../src/balance";
import {
  balancedLatinSquare,
  generateDesign,
  latinSquare,
  SEQUENCE_BLOCK_SIZE,
  sequenceFactors,
  stratumSequenceIndex
} from "../src/design";
import { Repository } from "../src/repository";

const SEED = "design-test-seed";
const design = (sequenceIndex: number, seed = SEED) =>
  generateDesign({ sessionId: `S${sequenceIndex}`, participantId: `P${sequenceIndex}`, sequenceIndex, stratum: "x", seed, now: "2026-10-24T00:00:00.000Z" });

describe("Latin squares", () => {
  it("builds the plan's cyclic 4 x 4 block orders", () => {
    expect(latinSquare(4)).toEqual([[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2]]);
  });

  it("builds a 6 x 6 Williams square: Latin, and every ordered pair adjacent exactly once", () => {
    const square = balancedLatinSquare(6);
    for (const row of square) expect(new Set(row).size).toBe(6);
    for (let c = 0; c < 6; c++) expect(new Set(square.map((row) => row[c])).size).toBe(6);
    const pairs = new Set(square.flatMap((row) => row.slice(1).map((v, i) => `${row[i]}>${v}`)));
    expect(pairs.size).toBe(30);
  });
});

describe("generateDesign", () => {
  it("is reproducible from the seed and changes with it", () => {
    expect(design(5)).toEqual(design(5));
    expect(design(5, "another-seed").practiceTrials).not.toEqual(design(5).practiceTrials);
  });

  it("satisfies every structural rule for a full sequence block", () => {
    for (let i = 0; i < SEQUENCE_BLOCK_SIZE; i++) expect(designErrors(`S${i}`, design(i))).toEqual([]);
  });

  it("balances every factor within one 24-sequence block", () => {
    const factors = Array.from({ length: SEQUENCE_BLOCK_SIZE }, (_, i) => sequenceFactors(i));
    const tally = (key: keyof (typeof factors)[number]) =>
      Object.values(factors.reduce<Record<number, number>>((acc, f) => ({ ...acc, [f[key]]: (acc[f[key]] ?? 0) + 1 }), {}));
    expect(tally("blockOrderRow")).toEqual([6, 6, 6, 6]);
    expect(tally("menuRow")).toEqual([4, 4, 4, 4, 4, 4]);
    expect(tally("targetSet")).toEqual([4, 4, 4, 4, 4, 4]);
    expect(new Set(factors.map((f) => f.colourRow)).size).toBe(24);
    expect(new Set(factors.map((f) => `${f.targetSet}:${f.blockOrderRow}`)).size).toBe(24);
  });

  it("reports a balanced chi-square audit for a complete block", () => {
    const report = buildBalanceReport(Array.from({ length: SEQUENCE_BLOCK_SIZE }, (_, i) => design(i)));
    expect(report.design_errors).toEqual([]);
    expect(report.balance_ok).toBe(true);
    expect(report.chi_square.find((t) => t.factor === "block_order")?.chi_square).toBe(0);
  });

  it("flags an unbalanced allocation", () => {
    const report = buildBalanceReport(Array.from({ length: 24 }, () => design(0)));
    expect(report.balance_ok).toBe(false);
  });
});

describe("stratified permuted blocks", () => {
  it("walks a seeded permutation of a block, then generates a new block", () => {
    const first = Array.from({ length: SEQUENCE_BLOCK_SIZE }, (_, k) => stratumSequenceIndex(SEED, "woman|weekly", k));
    expect([...first].sort((a, b) => a - b)).toEqual(Array.from({ length: SEQUENCE_BLOCK_SIZE }, (_, i) => i));
    expect(stratumSequenceIndex(SEED, "woman|weekly", SEQUENCE_BLOCK_SIZE)).toBeGreaterThanOrEqual(SEQUENCE_BLOCK_SIZE);
    expect(stratumSequenceIndex(SEED, "woman|weekly", 3)).toBe(first[3]);
  });

  it("does not give every first participant of each stratum the same sequence", () => {
    const strata = ["woman|weekly", "man|weekly", "woman|rarely", "man|rarely", "non-binary|monthly", "man|daily"];
    expect(new Set(strata.map((s) => stratumSequenceIndex(SEED, s, 0))).size).toBeGreaterThan(1);
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

  it("writes sequence, orders, target set, colours and seed hash, reproducibly from the seed", () => {
    const a = assignAll(SEED);
    const b = assignAll(SEED);
    expect(a).toHaveLength(3);
    const fields = ["sequence_index", "sequence_id", "stratum", "block_order", "menu_orders", "target_set", "colour_mapping", "seed_hash"];
    const pick = (row: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f, row[f]]));
    expect(a.map(pick)).toEqual(b.map(pick));
    expect(a[0]?.seed_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a[0]?.seed_hash).not.toContain(SEED);
    expect(a[0]?.sequence_index).not.toBe(a[2]?.sequence_index);
  });
});
