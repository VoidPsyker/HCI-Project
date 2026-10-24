import crypto from "node:crypto";
import {
  MENU_IDS,
  type ColourMapping,
  type Difficulty,
  type MenuId,
  type Task,
  type DepartmentColour,
  tasks,
  taxonomy,
  DEFAULT_COLOUR_MAPPING
} from "@meridian/taxonomy";

export type StateLabel = "happy" | "frustrated" | "confused" | "bored";

export const STATE_LABELS: StateLabel[] = ["happy", "frustrated", "confused", "bored"];

export interface PracticeTrialSpec {
  practiceId: string;
  menuId: MenuId;
  taskId: string;
  targetId: string;
  taskDescription: string;
  difficulty: Difficulty;
}

export interface TrialSpec {
  trialId: string;
  blockId: string;
  blockIndex: number;
  trialIndex: number;
  menuId: MenuId;
  taskId: string;
  targetId: string;
  taskDescription: string;
  difficulty: Difficulty;
  stateLabel: StateLabel;
  condition: "static";
}

export interface BlockSpec {
  blockId: string;
  blockIndex: number;
  stateLabel: StateLabel;
  menuIds: MenuId[];
  trialIds: string[];
}

export interface StudyDesign {
  sessionId: string;
  participantId: string;
  sequenceIndex: number;
  sequenceId: string;
  stratum: string;
  seed: string;
  seedHash: string;
  taxonomyHash: string;
  targetSet: number;
  colourMapping: ColourMapping;
  blockOrder: StateLabel[];
  menuOrder: MenuId[];
  blocks: BlockSpec[];
  practiceTrials: PracticeTrialSpec[];
  trials: TrialSpec[];
  createdAt: string;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Cyclic Latin square: row r is the base order rotated left by r (plan §6.3: ABCD, BCDA, CDAB, DABC). */
export function latinSquare(n: number): number[][] {
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r + c) % n));
}

/** Williams balanced Latin square for even n: every item also precedes every other item exactly once. */
export function balancedLatinSquare(n: number): number[][] {
  const first = Array.from({ length: n }, (_, c) => (c % 2 === 0 ? c / 2 : n - (c + 1) / 2));
  return Array.from({ length: n }, (_, r) => first.map((v) => (v + r) % n));
}

const BLOCK_ORDERS: StateLabel[][] = latinSquare(4).map((row) => row.map((i) => STATE_LABELS[i] as StateLabel));
const MENU_ROWS = balancedLatinSquare(6);

const COLOURS: DepartmentColour[] = ["teal", "amber", "olive", "indigo"];

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i];
    if (head === undefined) continue;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([head, ...tail]);
  }
  return out;
}

export const COLOUR_PERMUTATIONS = permutations(COLOURS).map(
  ([sport, dress, everyday, smart]) =>
    ({ sport, dress, everyday, smart }) as ColourMapping
);

function tasksByDifficulty(): Record<Difficulty, Task[]> {
  return {
    Easy: tasks.filter((t) => t.difficulty === "Easy"),
    Medium: tasks.filter((t) => t.difficulty === "Medium"),
    Hard: tasks.filter((t) => t.difficulty === "Hard")
  };
}

/** Six non-overlapping target sets, each with four easy, four medium and four hard tasks. */
export function getTargetSets(seed: string): Task[][] {
  const grouped = tasksByDifficulty();
  const shuffled: Record<Difficulty, Task[]> = {
    Easy: shuffle(grouped.Easy, mulberry32(Number.parseInt(sha256(`${seed}:sets:easy`).slice(0, 8), 16))),
    Medium: shuffle(grouped.Medium, mulberry32(Number.parseInt(sha256(`${seed}:sets:medium`).slice(0, 8), 16))),
    Hard: shuffle(grouped.Hard, mulberry32(Number.parseInt(sha256(`${seed}:sets:hard`).slice(0, 8), 16)))
  };
  const sets: Task[][] = [];
  for (let s = 0; s < 6; s++) {
    const set = [
      ...shuffled.Easy.slice(s * 4, (s + 1) * 4),
      ...shuffled.Medium.slice(s * 4, (s + 1) * 4),
      ...shuffled.Hard.slice(s * 4, (s + 1) * 4)
    ];
    sets.push(shuffle(set, mulberry32(Number.parseInt(sha256(`${seed}:set:${s}`).slice(0, 8), 16))));
  }
  return sets;
}

/**
 * Which row of each counterbalancing factor a sequence uses. Over every 24 consecutive sequences each
 * block order appears 6 times, each menu row 4 times, each colour mapping once, and every
 * (target set, block order) pair exactly once; later sequences start a fresh 24-block.
 */
export function sequenceFactors(sequenceIndex: number) {
  return {
    blockOrderRow: sequenceIndex % BLOCK_ORDERS.length,
    menuRow: Math.floor(sequenceIndex / BLOCK_ORDERS.length) % MENU_ROWS.length,
    targetSet: (sequenceIndex + Math.floor(sequenceIndex / 12)) % 6,
    colourRow: sequenceIndex % COLOUR_PERMUTATIONS.length
  };
}

export const SEQUENCE_BLOCK_SIZE = 24;

/**
 * Stratified permuted blocks: the k-th participant of a stratum takes the k-th entry of that stratum's
 * seeded shuffle of one 24-sequence block; an exhausted block is followed by a newly generated one.
 */
export function stratumSequenceIndex(seed: string, stratum: string, k: number): number {
  const block = Math.floor(k / SEQUENCE_BLOCK_SIZE);
  const rng = mulberry32(Number.parseInt(sha256(`${seed}:stratum:${stratum}:block:${block}`).slice(0, 8), 16));
  const order = shuffle(
    Array.from({ length: SEQUENCE_BLOCK_SIZE }, (_, i) => i),
    rng
  );
  return block * SEQUENCE_BLOCK_SIZE + (order[k % SEQUENCE_BLOCK_SIZE] ?? 0);
}

/**
 * Twelve trial menus: blocks 1-2 take one balanced Latin-square row, blocks 3-4 the row three steps on,
 * so each menu appears twice and never twice in a block. The seed only relabels square symbols.
 */
function menuSchedule(seed: string, menuRow: number): MenuId[] {
  const symbols = shuffle(MENU_IDS, mulberry32(Number.parseInt(sha256(`${seed}:menu-symbols`).slice(0, 8), 16)));
  const row = (r: number) => (MENU_ROWS[r % MENU_ROWS.length] ?? []).map((i) => symbols[i] as MenuId);
  return [...row(menuRow), ...row(menuRow + 3)];
}

function practiceTrialsFor(
  sessionId: string,
  mainTargetIds: Set<string>,
  seed: string,
  sequenceIndex: number
): PracticeTrialSpec[] {
  const easy = tasks.filter((t) => t.difficulty === "Easy" && !mainTargetIds.has(t.targetId));
  const rng = mulberry32(Number.parseInt(sha256(`${seed}:practice:${sequenceIndex}`).slice(0, 8), 16));
  const candidates = shuffle(easy, rng).slice(0, 6);
  const menus = shuffle(MENU_IDS, mulberry32(Number.parseInt(sha256(`${seed}:practice-menus:${sequenceIndex}`).slice(0, 8), 16)));
  return candidates.map((task, i) => ({
    practiceId: `${sessionId}-P${i + 1}`,
    menuId: menus[i] ?? "A",
    taskId: task.id,
    targetId: task.targetId,
    taskDescription: task.description,
    difficulty: task.difficulty
  }));
}

export function generateDesign(input: {
  sessionId: string;
  participantId: string;
  sequenceIndex: number;
  stratum: string;
  seed: string;
  now?: string;
}): StudyDesign {
  const { sessionId, participantId, sequenceIndex, stratum, seed } = input;
  const factors = sequenceFactors(sequenceIndex);
  const targetSets = getTargetSets(seed);
  const targetSetIndex = factors.targetSet;
  const targetSet = targetSets[targetSetIndex];
  if (!targetSet) throw new Error("target set missing");
  const stateRow = BLOCK_ORDERS[factors.blockOrderRow];
  if (!stateRow) throw new Error("latin square row missing");
  const menus = menuSchedule(seed, factors.menuRow);
  const colour = COLOUR_PERMUTATIONS[factors.colourRow] ?? DEFAULT_COLOUR_MAPPING;

  const blocks: BlockSpec[] = [];
  const trialSpecs: TrialSpec[] = [];
  for (let b = 0; b < 4; b++) {
    const blockId = `${sessionId}-B${b + 1}`;
    const stateLabel = stateRow[b] ?? "happy";
    const menuIds = [menus[b * 3], menus[b * 3 + 1], menus[b * 3 + 2]] as MenuId[];
    const trialIds: string[] = [];
    for (let t = 0; t < 3; t++) {
      const task = targetSet[b * 3 + t];
      const menuId = menuIds[t];
      if (!task || !menuId) throw new Error("trial design missing");
      const trialId = `${sessionId}-B${b + 1}-T${t + 1}`;
      trialIds.push(trialId);
      trialSpecs.push({
        trialId,
        blockId,
        blockIndex: b,
        trialIndex: t,
        menuId,
        taskId: task.id,
        targetId: task.targetId,
        taskDescription: task.description,
        difficulty: task.difficulty,
        stateLabel,
        condition: "static"
      });
    }
    blocks.push({ blockId, blockIndex: b, stateLabel, menuIds, trialIds });
  }

  const practiceTrials = practiceTrialsFor(sessionId, new Set(trialSpecs.map((t) => t.targetId)), seed, sequenceIndex);

  return {
    sessionId,
    participantId,
    sequenceIndex,
    sequenceId: sha256(`${seed}:sequence:${sequenceIndex}`).slice(0, 20),
    stratum,
    seed,
    seedHash: sha256(seed),
    taxonomyHash: sha256(JSON.stringify(taxonomy.nodes.map((n) => [n.id, n.label, n.parentId, n.level, n.productId ?? null]))),
    targetSet: targetSetIndex,
    colourMapping: colour,
    blockOrder: [...stateRow],
    menuOrder: menus,
    blocks,
    practiceTrials,
    trials: trialSpecs,
    createdAt: input.now ?? new Date().toISOString()
  };
}

export function designSummary(design: StudyDesign) {
  return {
    sessionId: design.sessionId,
    sequenceId: design.sequenceId,
    sequenceIndex: design.sequenceIndex,
    targetSet: design.targetSet,
    colourMapping: design.colourMapping,
    blockOrder: design.blockOrder,
    menuOrder: design.menuOrder,
    seedHash: design.seedHash,
    taxonomyHash: design.taxonomyHash
  };
}
