import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS,
  LEAVES,
  MENU_IDS,
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

  it("keeps canonical descriptions exactly as specified", () => {
    const expected: Record<string, string> = {
      T01: "Titanium dive watch, 300 m, deep blue dial",
      T02: "Lightweight titanium dive watch, 300 m, black dial",
      T03: "42 mm automatic trail watch, green dial, fabric strap",
      T04: "Rose-gold dress watch, ivory dial, leather strap",
      T05: "Black-tie watch, deep navy dial, 40 mm",
      T06: "Moonphase complication, celestial blue dial",
      T07: "38 mm field watch, khaki canvas strap, automatic",
      T08: "Minimalist watch, matte white dial, steel mesh strap",
      T09: "Weekend watch, sunset clay dial, rubber strap",
      T10: "Graphite smartwatch, titanium case, 44 mm",
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
