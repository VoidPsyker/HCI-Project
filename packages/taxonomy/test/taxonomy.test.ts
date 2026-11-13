import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS,
  LEAVES,
  MENU_IDS,
  PRACTICE_TASKS,
  SCORED_TASKS,
  SUBCATEGORIES,
  allSemanticPaths,
  products,
  resolveTask,
  semanticPath,
  tasks,
  validateTaxonomy
} from "../src/index";

describe("taxonomy and task bank", () => {
  it("validates the complete 4 x 3 x 6 structure", () => {
    const report = validateTaxonomy();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.departments).toBe(4);
    expect(report.subcategories).toBe(12);
    expect(report.leaves).toBe(72);
    expect(report.products).toBe(72);
    expect(report.tasks).toBe(72);
    expect(report.uniqueVectors).toBe(72);
    expect(report.paths).toBe(432);
    expect(report.difficultyCounts).toEqual({ Easy: 24, Medium: 24, Hard: 24 });
  });

  it("has one unique product per leaf", () => {
    expect(new Set(LEAVES.map((l) => l.productId)).size).toBe(72);
    expect(new Set(products.map((p) => JSON.stringify(p.attributes))).size).toBe(72);
  });

  it("resolves every task to exactly its target", () => {
    for (const task of tasks) {
      const matches = resolveTask(task);
      expect(matches, task.id).toHaveLength(1);
      expect(matches[0]?.id, task.id).toBe(task.targetId);
    }
  });

  it("has a three-node semantic path for every product", () => {
    for (const leaf of LEAVES) {
      const path = semanticPath(leaf.id);
      expect(path.map((n) => n.level)).toEqual([1, 2, 3]);
    }
  });

  it("has 432 menu paths (6 menus x 72 products)", () => {
    expect(allSemanticPaths()).toHaveLength(432);
    for (const menu of MENU_IDS) {
      expect(allSemanticPaths().filter((p) => p.menuId === menu)).toHaveLength(72);
    }
  });

  it("keeps the plan wording, except four tasks reworded so they name no neighbouring watch", () => {
    const expected: Record<string, string> = {
      T01: "Titanium dive watch, 300 m, deep blue dial",
      T02: "Lightweight titanium dive watch, 300 m, black dial",
      T03: "42 mm automatic trail watch, green dial, fabric strap",
      T04: "Classic dress watch, ivory dial, leather strap",
      T05: "Evening dress watch, deep navy dial, 40 mm",
      T06: "Moonphase complication, celestial blue dial",
      T07: "38 mm field watch, khaki canvas strap, automatic",
      T08: "Minimalist watch, matte white dial, mesh strap",
      T09: "Weekend watch, sunset clay dial, rubber strap",
      T10: "Graphite smartwatch, 44 mm case",
      T11: "Hybrid sport watch, orange accent, rubber strap",
      T12: "Connected classic, burgundy leather strap, 42 mm"
    };
    for (const [id, description] of Object.entries(expected)) {
      expect(tasks.find((t) => t.id === id)?.description).toBe(description);
    }
  });

  it("has no orphan nodes", () => {
    const ids = new Set([...DEPARTMENTS, ...SUBCATEGORIES, ...LEAVES].map((n) => n.id));
    for (const node of [...SUBCATEGORIES, ...LEAVES]) {
      expect(ids.has(node.parentId ?? "")).toBe(true);
    }
  });
});

describe("scored and practice tasks", () => {
  const phrase = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const namesAnotherWatchInItsCollection = (task: { targetId: string; description: string }) => {
    const target = LEAVES.find((leaf) => leaf.id === task.targetId)!;
    return LEAVES.filter((leaf) => leaf.parentId === target.parentId && leaf.id !== target.id)
      .filter((leaf) => phrase(task.description).includes(phrase(leaf.label)))
      .map((leaf) => leaf.label);
  };

  it("scores the plan's 12 tasks plus 12 added ones: 8 easy, 8 medium, 8 hard, 6 per department", () => {
    expect(SCORED_TASKS.map((task) => task.id)).toEqual([
      "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12",
      "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12"
    ]);
    const count = (key: (task: (typeof SCORED_TASKS)[number]) => string) =>
      SCORED_TASKS.reduce<Record<string, number>>((acc, task) => ({ ...acc, [key(task)]: (acc[key(task)] ?? 0) + 1 }), {});
    expect(count((task) => task.difficulty)).toEqual({ Easy: 8, Medium: 8, Hard: 8 });
    expect(count((task) => task.criteria.departmentId ?? "")).toEqual({ sport: 6, dress: 6, everyday: 6, smart: 6 });
  });

  it("resolves every scored task to its own target, never shared with another study task", () => {
    const study = [...SCORED_TASKS, ...PRACTICE_TASKS];
    for (const task of study) expect(resolveTask(task).map((product) => product.id), task.id).toEqual([task.targetId]);
    expect(new Set(study.map((task) => task.targetId)).size).toBe(study.length);
  });

  it("never names a different watch from the target's own collection", () => {
    for (const task of [...SCORED_TASKS, ...PRACTICE_TASKS]) expect(namesAnotherWatchInItsCollection(task), task.id).toEqual([]);
  });

  it("has six practice tasks that each resolve to their own target, away from the scored targets", () => {
    expect(PRACTICE_TASKS).toHaveLength(6);
    const scoredTargets = new Set(SCORED_TASKS.map((task) => task.targetId));
    for (const task of PRACTICE_TASKS) {
      expect(resolveTask(task).map((product) => product.id), task.id).toEqual([task.targetId]);
      expect(scoredTargets.has(task.targetId), task.id).toBe(false);
    }
    expect(new Set(PRACTICE_TASKS.map((task) => task.targetId)).size).toBe(6);
  });
});
