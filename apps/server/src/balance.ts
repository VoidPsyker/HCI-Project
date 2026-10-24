import { chiSquaredDistributionTable } from "simple-statistics";
import { MENU_IDS } from "@meridian/taxonomy";
import { COLOUR_PERMUTATIONS, sequenceFactors, type StudyDesign } from "./design";

export interface ChiSquareResult {
  factor: string;
  categories: number;
  counts: Record<string, number>;
  chi_square: number;
  df: number;
  critical_05: number | null;
  balanced: boolean;
  note?: string;
}

/** Goodness of fit against a uniform allocation over `categories` levels. */
export function uniformChiSquare(factor: string, categories: string[], observed: string[]): ChiSquareResult {
  const counts = Object.fromEntries(categories.map((c) => [c, 0]));
  for (const value of observed) counts[value] = (counts[value] ?? 0) + 1;
  const expected = observed.length / categories.length;
  const chi = expected === 0 ? 0 : categories.reduce((sum, c) => sum + ((counts[c] ?? 0) - expected) ** 2 / expected, 0);
  const df = categories.length - 1;
  const table = chiSquaredDistributionTable as unknown as Record<number, { "0.05": number } | undefined>;
  const critical = table[df]?.["0.05"] ?? null;
  return {
    factor,
    categories: categories.length,
    counts,
    chi_square: Math.round(chi * 1000) / 1000,
    df,
    critical_05: critical,
    balanced: critical === null ? true : chi <= critical,
    ...(expected < 5 ? { note: `expected count ${expected.toFixed(2)} < 5; chi-square is approximate` } : {})
  };
}

/** Structural design rules that every single assignment must satisfy. */
export function designErrors(sessionId: string, design: StudyDesign): string[] {
  const errors: string[] = [];
  if (design.blocks.length !== 4) errors.push(`${sessionId}: expected 4 blocks`);
  if (design.trials.length !== 12) errors.push(`${sessionId}: expected 12 trials`);
  const flat = design.blocks.flatMap((b) => b.menuIds);
  for (const menu of MENU_IDS) {
    const n = flat.filter((m) => m === menu).length;
    if (n !== 2) errors.push(`${sessionId}: menu ${menu} appears ${n} times`);
  }
  for (const block of design.blocks) {
    if (new Set(block.menuIds).size !== block.menuIds.length) errors.push(`${sessionId}: repeated menu within ${block.blockId}`);
  }
  if (new Set(design.blocks.map((b) => b.stateLabel)).size !== 4) errors.push(`${sessionId}: states not unique`);
  for (const difficulty of ["Easy", "Medium", "Hard"]) {
    const n = design.trials.filter((t) => t.difficulty === difficulty).length;
    if (n !== 4) errors.push(`${sessionId}: ${difficulty} count is ${n}`);
  }
  return errors;
}

export function buildBalanceReport(designs: StudyDesign[]) {
  const factors = designs.map((d) => sequenceFactors(d.sequenceIndex));
  const range = (n: number) => Array.from({ length: n }, (_, i) => String(i));
  const tests = [
    uniformChiSquare("block_order", range(4), factors.map((f) => String(f.blockOrderRow))),
    uniformChiSquare("menu_order_row", range(6), factors.map((f) => String(f.menuRow))),
    uniformChiSquare("target_set", range(6), designs.map((d) => String(d.targetSet))),
    uniformChiSquare("colour_mapping", range(COLOUR_PERMUTATIONS.length), factors.map((f) => String(f.colourRow))),
    uniformChiSquare("first_trial_menu", [...MENU_IDS], designs.map((d) => d.blocks[0]?.menuIds[0] ?? "?"))
  ];
  const errors = designs.flatMap((d) => designErrors(d.sessionId, d));
  return {
    assignments: designs.length,
    alpha: 0.05,
    chi_square: tests,
    design_errors: errors,
    balance_ok: errors.length === 0 && tests.every((t) => t.balanced)
  };
}
