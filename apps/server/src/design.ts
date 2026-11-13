import crypto from "node:crypto";
import {
  MENU_IDS,
  PRACTICE_TASKS,
  SCORED_TASKS,
  type ColourMapping,
  type Difficulty,
  type MenuId,
  type Task,
  type DepartmentColour,
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

/** Williams balanced Latin square for even n: every item also precedes every other item exactly once. */
export function balancedLatinSquare(n: number): number[][] {
  const first = Array.from({ length: n }, (_, c) => (c % 2 === 0 ? c / 2 : n - (c + 1) / 2));
  return Array.from({ length: n }, (_, r) => first.map((v) => (v + r) % n));
}

/**
 * Confusion always comes before frustration, so lingering frustration cannot colour the
 * confusion block. Happy and bored still take every position once; confusion is never last
 * and frustration never first, so their position is only partly balanced.
 */
export const BLOCK_ORDERS: StateLabel[][] = [
  ["confused", "frustrated", "happy", "bored"],
  ["happy", "confused", "bored", "frustrated"],
  ["bored", "happy", "confused", "frustrated"],
  ["confused", "bored", "frustrated", "happy"]
];
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

/**
 * Everyone searches for the plan's 12 tasks (3 easy, 5 medium, 4 hard), grouped into four blocks of
 * three that each mix difficulty: easy+medium+hard three times, then medium+medium+hard.
 */
function scoredTaskGroups(seed: string): Task[][] {
  const tier = (difficulty: Difficulty) =>
    shuffle(SCORED_TASKS.filter((t) => t.difficulty === difficulty), mulberry32(Number.parseInt(sha256(`${seed}:scored:${difficulty}`).slice(0, 8), 16)));
  const [easy, medium, hard] = [tier("Easy"), tier("Medium"), tier("Hard")];
  const groups = [[easy[0], medium[0], hard[0]], [easy[1], medium[1], hard[1]], [easy[2], medium[2], hard[2]], [medium[3], medium[4], hard[3]]];
  if (groups.some((group) => group.some((task) => !task))) throw new Error("scored tasks must be 3 easy, 5 medium and 4 hard");
  return groups as Task[][];
}

/** Rotation r moves group g to block (g + r) % 4 and rotates the order inside it. */
function scoredTasksForBlock(groups: Task[][], rotation: number, block: number): Task[] {
  const group = groups[(block + 4 - rotation) % 4] ?? [];
  const shift = (block + rotation) % 3;
  return [...group.slice(shift), ...group.slice(0, shift)];
}

/**
 * Which row of each counterbalancing factor a sequence uses. Over every 24 consecutive sequences each
 * block order appears 6 times, each menu row 4 times, each colour mapping once, and each of the four
 * task rotations ("target set") 6 times, meeting every block order; later sequences start a fresh 24-block.
 */
export function sequenceFactors(sequenceIndex: number) {
  return {
    blockOrderRow: sequenceIndex % BLOCK_ORDERS.length,
    menuRow: Math.floor(sequenceIndex / BLOCK_ORDERS.length) % MENU_ROWS.length,
    targetSet: (sequenceIndex + Math.floor(sequenceIndex / 4)) % 4,
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

function practiceTrialsFor(sessionId: string, seed: string, sequenceIndex: number): PracticeTrialSpec[] {
  const rng = mulberry32(Number.parseInt(sha256(`${seed}:practice:${sequenceIndex}`).slice(0, 8), 16));
  const candidates = shuffle(PRACTICE_TASKS, rng);
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
  const groups = scoredTaskGroups(seed);
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
    const blockTasks = scoredTasksForBlock(groups, factors.targetSet, b);
    for (let t = 0; t < 3; t++) {
      const task = blockTasks[t];
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

  const practiceTrials = practiceTrialsFor(sessionId, seed, sequenceIndex);

  return {
    sessionId,
    participantId,
    sequenceIndex,
    sequenceId: sha256(`${seed}:sequence:${sequenceIndex}`).slice(0, 20),
    stratum,
    seed,
    seedHash: sha256(seed),
    taxonomyHash: sha256(JSON.stringify(taxonomy.nodes.map((n) => [n.id, n.label, n.parentId, n.level, n.productId ?? null]))),
    targetSet: factors.targetSet,
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
