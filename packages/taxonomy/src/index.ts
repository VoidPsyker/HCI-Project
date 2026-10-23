import taxonomyJson from "../taxonomy.json";
import productsJson from "../products.json";
import tasksJson from "../tasks.json";

export type Level = 1 | 2 | 3;
export type MenuId = "A" | "B" | "C" | "D" | "E" | "F";
export type DepartmentColour = "teal" | "amber" | "olive" | "indigo";
export type Difficulty = "Easy" | "Medium" | "Hard";
export type Movement = "automatic" | "quartz" | "solar" | "hybrid";
export type Strap = "steel" | "titanium" | "leather" | "rubber" | "mesh" | "fabric";
export type DialColour = "blue" | "black" | "green" | "white" | "grey" | "brown" | "silver" | "champagne" | "orange";
export type PriceBand = "£180–£240" | "£240–£420" | "£420–£900" | "£900+";

export interface TaxonomyNode {
  id: string;
  label: string;
  level: Level;
  parentId: string | null;
  productId?: string;
  colour?: DepartmentColour;
  icon?: string;
}

export interface ProductAttributes {
  caseSize: 38 | 40 | 42 | 44;
  strap: Strap;
  movement: Movement;
  water: 50 | 100 | 200 | 300;
  dial: DialColour;
  priceBand: PriceBand;
}

export interface Product {
  id: string;
  leafId: string;
  departmentId: string;
  subcategoryId: string;
  attributes: ProductAttributes;
  price: number;
  priceBand: PriceBand;
  description: string;
}

export interface TaskCriteria {
  departmentId?: string;
  subcategoryId?: string;
  caseSize?: number;
  strap?: string;
  movement?: string;
  water?: number;
  dial?: string;
  priceBand?: string;
}

export interface Task {
  id: string;
  targetId: string;
  description: string;
  difficulty: Difficulty;
  canonical: boolean;
  criteria: TaskCriteria;
}

export interface TaxonomyData {
  version: string;
  nodes: TaxonomyNode[];
}

export interface ProductsData {
  version: string;
  products: Product[];
}

export interface TasksData {
  version: string;
  tasks: Task[];
}

export interface ColourMapping {
  sport: DepartmentColour;
  dress: DepartmentColour;
  everyday: DepartmentColour;
  smart: DepartmentColour;
}

export const taxonomy = taxonomyJson as TaxonomyData;
export const productsData = productsJson as ProductsData;
export const tasksData = tasksJson as TasksData;

export const nodes: TaxonomyNode[] = taxonomy.nodes;
export const products: Product[] = productsData.products;
export const tasks: Task[] = tasksData.tasks;

export const MENU_IDS: MenuId[] = ["A", "B", "C", "D", "E", "F"];
export const DEPARTMENTS = nodes.filter((n) => n.level === 1);
export const SUBCATEGORIES = nodes.filter((n) => n.level === 2);
export const LEAVES = nodes.filter((n) => n.level === 3);
export const PRODUCT_BY_ID = new Map(products.map((p) => [p.id, p]));
export const NODE_BY_ID = new Map(nodes.map((n) => [n.id, n]));
export const TASK_BY_ID = new Map(tasks.map((t) => [t.id, t]));

export const PALETTE: Record<DepartmentColour, { bg: string; fg: string; soft: string; border: string }> = {
  teal: { bg: "#0f766e", fg: "#ffffff", soft: "#ccfbf1", border: "#0f766e" },
  amber: { bg: "#b45309", fg: "#ffffff", soft: "#fef3c7", border: "#b45309" },
  olive: { bg: "#4d7c0f", fg: "#ffffff", soft: "#ecfccb", border: "#4d7c0f" },
  indigo: { bg: "#4338ca", fg: "#ffffff", soft: "#e0e7ff", border: "#4338ca" }
};

export const DEFAULT_COLOUR_MAPPING: ColourMapping = {
  sport: "teal",
  dress: "amber",
  everyday: "olive",
  smart: "indigo"
};

export const MIN_CLICKS: Record<MenuId, number> = { A: 3, B: 3, C: 2, D: 3, E: 3, F: 3 };

export function childrenOf(id: string | null): TaxonomyNode[] {
  return nodes.filter((n) => n.parentId === id);
}

export function departmentOf(id: string): TaxonomyNode | undefined {
  const node = NODE_BY_ID.get(id);
  if (!node) return undefined;
  if (node.level === 1) return node;
  if (node.level === 2) return NODE_BY_ID.get(node.parentId ?? "");
  return NODE_BY_ID.get(NODE_BY_ID.get(node.parentId ?? "")?.parentId ?? "");
}

export function subcategoryOf(id: string): TaxonomyNode | undefined {
  const node = NODE_BY_ID.get(id);
  if (!node) return undefined;
  if (node.level === 2) return node;
  if (node.level === 3) return NODE_BY_ID.get(node.parentId ?? "");
  return undefined;
}

export function semanticPath(productId: string): TaxonomyNode[] {
  const leaf = NODE_BY_ID.get(productId);
  if (!leaf || leaf.level !== 3) return [];
  const sub = NODE_BY_ID.get(leaf.parentId ?? "");
  const dept = sub ? NODE_BY_ID.get(sub.parentId ?? "") : undefined;
  return [dept, sub, leaf].filter(Boolean) as TaxonomyNode[];
}

export function departmentColour(nodeOrId: string | TaxonomyNode, mapping: ColourMapping = DEFAULT_COLOUR_MAPPING): DepartmentColour {
  const dept = typeof nodeOrId === "string" ? departmentOf(nodeOrId) : departmentOf(nodeOrId.id);
  const key = (dept?.id ?? "sport") as keyof ColourMapping;
  return mapping[key] ?? "teal";
}

export function productForLeaf(leafId: string): Product | undefined {
  return PRODUCT_BY_ID.get(leafId);
}

export function taskForTarget(targetId: string): Task | undefined {
  return tasks.find((t) => t.targetId === targetId);
}

export function satisfiesCriteria(product: Product, criteria: TaskCriteria): boolean {
  if (criteria.departmentId && product.departmentId !== criteria.departmentId) return false;
  if (criteria.subcategoryId && product.subcategoryId !== criteria.subcategoryId) return false;
  for (const key of ["caseSize", "strap", "movement", "water", "dial", "priceBand"] as const) {
    if (criteria[key] !== undefined && product.attributes[key] !== criteria[key]) return false;
  }
  return true;
}

export function resolveTask(task: Task): Product[] {
  return products.filter((p) => satisfiesCriteria(p, task.criteria));
}

export function allSemanticPaths(): Array<{ menuId: MenuId; productId: string; nodeIds: string[]; clicks: number }> {
  return MENU_IDS.flatMap((menuId) =>
    LEAVES.map((leaf) => ({
      menuId,
      productId: leaf.productId ?? leaf.id,
      nodeIds: semanticPath(leaf.id).map((n) => n.id),
      clicks: MIN_CLICKS[menuId]
    }))
  );
}

export interface ValidationReport {
  departments: number;
  subcategories: number;
  leaves: number;
  products: number;
  tasks: number;
  uniqueVectors: number;
  difficultyCounts: Record<Difficulty, number>;
  paths: number;
  errors: string[];
  ok: boolean;
}

export function validateTaxonomy(): ValidationReport {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  for (const n of nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    nodeIds.add(n.id);
    if (n.level === 1 && n.parentId !== null) errors.push(`L1 ${n.id} has parent`);
    if (n.level > 1 && (!n.parentId || !nodeIds.has(n.parentId))) errors.push(`orphan ${n.id}`);
  }
  if (DEPARTMENTS.length !== 4) errors.push(`expected 4 departments, got ${DEPARTMENTS.length}`);
  for (const dept of DEPARTMENTS) {
    const subs = SUBCATEGORIES.filter((s) => s.parentId === dept.id);
    if (subs.length !== 3) errors.push(`department ${dept.id} has ${subs.length} subcategories`);
    for (const sub of subs) {
      const leaves = LEAVES.filter((l) => l.parentId === sub.id);
      if (leaves.length !== 6) errors.push(`subcategory ${sub.id} has ${leaves.length} leaves`);
    }
  }
  if (SUBCATEGORIES.length !== 12) errors.push(`expected 12 subcategories, got ${SUBCATEGORIES.length}`);
  if (LEAVES.length !== 72) errors.push(`expected 72 leaves, got ${LEAVES.length}`);

  const leafIds = new Set(LEAVES.map((l) => l.id));
  const productIds = new Set<string>();
  const vectorKeys = new Set<string>();
  for (const p of products) {
    if (productIds.has(p.id)) errors.push(`duplicate product id ${p.id}`);
    productIds.add(p.id);
    if (!leafIds.has(p.leafId)) errors.push(`product ${p.id} points at missing leaf`);
    if (p.id !== p.leafId) errors.push(`product ${p.id} id differs from leaf`);
    const dept = departmentOf(p.leafId);
    const sub = subcategoryOf(p.leafId);
    if (!dept || dept.id !== p.departmentId) errors.push(`product ${p.id} department mismatch`);
    if (!sub || sub.id !== p.subcategoryId) errors.push(`product ${p.id} subcategory mismatch`);
    const key = JSON.stringify(p.attributes);
    if (vectorKeys.has(key)) errors.push(`duplicate attribute vector ${p.id}`);
    vectorKeys.add(key);
    const bandIndex = ["£180–£240", "£240–£420", "£420–£900", "£900+"].indexOf(p.attributes.priceBand);
    const ranges = [[180, 240], [240, 420], [420, 900], [900, 100000]];
    const range = ranges[bandIndex];
    if (!range || p.price < (range[0] ?? 0) || p.price > (range[1] ?? 0)) errors.push(`price ${p.price} outside band for ${p.id}`);
    if (p.priceBand !== p.attributes.priceBand) errors.push(`priceBand mismatch for ${p.id}`);
  }
  if (products.length !== 72) errors.push(`expected 72 products, got ${products.length}`);
  for (const leaf of LEAVES) {
    if (!leaf.productId) errors.push(`leaf ${leaf.id} has no productId`);
    if (!products.some((p) => p.leafId === leaf.id)) errors.push(`leaf ${leaf.id} has no product record`);
  }

  const taskIds = new Set<string>();
  const targetIds = new Set<string>();
  const descriptions = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id)) errors.push(`duplicate task id ${task.id}`);
    taskIds.add(task.id);
    if (targetIds.has(task.targetId)) errors.push(`multiple tasks for target ${task.targetId}`);
    targetIds.add(task.targetId);
    if (descriptions.has(task.description)) errors.push(`duplicate task description ${task.id}`);
    descriptions.add(task.description);
    if (!leafIds.has(task.targetId)) errors.push(`task ${task.id} targets missing leaf`);
    const matches = resolveTask(task);
    if (matches.length !== 1) errors.push(`task ${task.id} resolves to ${matches.length} products`);
    else if (matches[0]?.id !== task.targetId) errors.push(`task ${task.id} resolves to wrong product`);
  }
  if (tasks.length !== 72) errors.push(`expected 72 tasks, got ${tasks.length}`);
  for (const leaf of LEAVES) if (!targetIds.has(leaf.id)) errors.push(`no task for leaf ${leaf.id}`);
  for (const id of ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12"]) {
    if (!taskIds.has(id)) errors.push(`missing canonical task ${id}`);
  }

  const difficultyCounts: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  for (const t of tasks) difficultyCounts[t.difficulty]++;
  for (const d of ["Easy", "Medium", "Hard"] as Difficulty[]) {
    if (difficultyCounts[d] !== 24) errors.push(`expected 24 ${d} tasks, got ${difficultyCounts[d]}`);
  }
  const paths = allSemanticPaths();
  if (paths.length !== 432) errors.push(`expected 432 menu paths, got ${paths.length}`);

  return {
    departments: DEPARTMENTS.length,
    subcategories: SUBCATEGORIES.length,
    leaves: LEAVES.length,
    products: products.length,
    tasks: tasks.length,
    uniqueVectors: vectorKeys.size,
    difficultyCounts,
    paths: paths.length,
    errors,
    ok: errors.length === 0
  };
}
