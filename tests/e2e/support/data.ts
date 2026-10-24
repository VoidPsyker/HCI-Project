import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type MenuId = "A" | "B" | "C" | "D" | "E" | "F";
export type StateLabel = "happy" | "frustrated" | "confused" | "bored";
export type Level = 1 | 2 | 3;

export interface TaxonomyNode {
  id: string;
  label: string;
  level: Level;
  parentId: string | null;
  productId?: string;
}

export interface Product {
  id: string;
  leafId: string;
  departmentId: string;
  subcategoryId: string;
  description: string;
  attributes: {
    caseSize: number;
    strap: string;
    movement: string;
    water: number;
    dial: string;
    priceBand: string;
  };
}

export interface Task {
  id: string;
  targetId: string;
  description: string;
  difficulty: string;
}

const root = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as T;
}

export const taxonomy = readJson<{ version: string; nodes: TaxonomyNode[] }>("packages/taxonomy/taxonomy.json");
export const products = readJson<{ version: string; products: Product[] }>("packages/taxonomy/products.json").products;
export const tasks = readJson<{ version: string; tasks: Task[] }>("packages/taxonomy/tasks.json").tasks;

export const MENU_IDS: MenuId[] = ["A", "B", "C", "D", "E", "F"];
export const STATES: StateLabel[] = ["happy", "frustrated", "confused", "bored"];

export const MENU_NAMES: Record<MenuId, string> = {
  A: "Horizontal bar",
  B: "Vertical sidebar",
  C: "Mega menu",
  D: "Fractal tiles",
  E: "Icon grid",
  F: "Radial lattice"
};

export const MIN_CLICKS: Record<MenuId, number> = { A: 3, B: 3, C: 2, D: 3, E: 3, F: 3 };

export const DEPARTMENTS = taxonomy.nodes.filter((node) => node.level === 1);
export const SUBCATEGORIES = taxonomy.nodes.filter((node) => node.level === 2);
export const LEAVES = taxonomy.nodes.filter((node) => node.level === 3);
export const PRODUCT_BY_ID = new Map(products.map((product) => [product.id, product]));

/** The plan's four induced states each map to one department for smoke coverage. */
export const STATE_DEPARTMENT: Record<StateLabel, string> = {
  happy: "sport",
  frustrated: "dress",
  confused: "everyday",
  bored: "smart"
};

export function childrenOf(parentId: string | null): TaxonomyNode[] {
  return taxonomy.nodes.filter((node) => node.parentId === parentId);
}

export function semanticPath(leafId: string): [TaxonomyNode, TaxonomyNode, TaxonomyNode] {
  const leaf = taxonomy.nodes.find((node) => node.id === leafId);
  if (!leaf || leaf.level !== 3) throw new Error(`Not a leaf: ${leafId}`);
  const sub = taxonomy.nodes.find((node) => node.id === leaf.parentId);
  const dept = sub ? taxonomy.nodes.find((node) => node.id === sub.parentId) : undefined;
  if (!sub || !dept) throw new Error(`Incomplete path for ${leafId}`);
  return [dept, sub, leaf];
}

export function productIdForLeaf(leafId: string): string {
  return taxonomy.nodes.find((node) => node.id === leafId)?.productId ?? leafId;
}

export function taskForTarget(targetId: string): Task | undefined {
  return tasks.find((task) => task.targetId === targetId);
}

/**
 * 24 distinct products: for each induced state, its department supplies six
 * leaves and menus A–F each take one.
 */
export function smokeLeaf(menuId: MenuId, state: StateLabel): TaxonomyNode {
  const departmentLeaves = childrenOf(STATE_DEPARTMENT[state]).flatMap((subcategory) => childrenOf(subcategory.id));
  const menuIndex = MENU_IDS.indexOf(menuId);
  const leaf = departmentLeaves[menuIndex];
  if (!leaf) throw new Error(`No smoke leaf for ${menuId}/${state}`);
  return leaf;
}

export function leavesInStableOrder(): TaxonomyNode[] {
  return [...LEAVES].sort((a, b) => {
    const pathA = semanticPath(a.id).map((node) => node.id).join("/");
    const pathB = semanticPath(b.id).map((node) => node.id).join("/");
    return pathA.localeCompare(pathB);
  });
}
