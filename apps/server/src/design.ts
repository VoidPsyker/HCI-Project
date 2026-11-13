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
 * The 24 scored searches form four groups of six, each with two easy, two medium and two hard
 * searches (tiers in task-id order), so every emotion gets the same mix of difficulty.
 */
function scoredTaskGroups(): Task[][] {
  const tier = (difficulty: Difficulty) => SCORED_TASKS.filter((t) => t.difficulty === difficulty);
  const [easy, medium, hard] = [tier("Easy"), tier("Medium"), tier("Hard")];
  const groups = [0, 1, 2, 3].map((g) => [easy[2 * g], easy[2 * g + 1], medium[2 * g], medium[2 * g + 1], hard[2 * g], hard[2 * g + 1]]);
  if (groups.some((group) => group.some((task) => !task))) throw new Error("scored tasks must be 8 easy, 8 medium and 8 hard");
  return groups as Task[][];
}

/**
 * Participant n takes sequence n of a fixed 24-sequence cycle; nothing is drawn at random.
 * blockOrderRow cycles every person; menuRow advances every four people, so within 24 people each
 * emotion order meets every menu row once. The task rotation follows the block order, so each emotion
 * meets each task group equally often.
 */
export function sequenceFactors(sequenceIndex: number) {
  const blockOrderRow = sequenceIndex % BLOCK_ORDERS.length;
  return {
    blockOrderRow,
    menuRow: Math.floor(sequenceIndex / BLOCK_ORDERS.length) % MENU_ROWS.length,
    targetSet: blockOrderRow,
    colourRow: sequenceIndex % COLOUR_PERMUTATIONS.length
  };
}

export const SEQUENCE_CYCLE = 24;

const menuRow = (row: number): MenuId[] => (MENU_ROWS[row % MENU_ROWS.length] ?? []).map((i) => MENU_IDS[i] as MenuId);

/**
 * Block b searches all six menus in Williams row menuRow + b, so across people each menu takes every
 * position after the scenario equally often in every emotion. The watch searched on menu m is task
 * (m + menuRow) of the emotion's group: over six rows each task meets each menu once. (No 6 x 6 design
 * can also give each task every position once; six has no orthogonal Latin squares.)
 */
function blockSearches(group: Task[], row: number, block: number): Array<{ menuId: MenuId; task: Task }> {
  return menuRow(row + block).map((menuId) => ({ menuId, task: group[(MENU_IDS.indexOf(menuId) + row) % 6]! }));
}

/** Practice uses a menu row the scored blocks skip, so it never previews block 1's order. */
function practiceTrialsFor(sessionId: string, row: number): PracticeTrialSpec[] {
  return menuRow(row + 4).map((menuId, i) => {
    const task = PRACTICE_TASKS[i]!;
    return {
      practiceId: `${sessionId}-P${i + 1}`,
      menuId,
      taskId: task.id,
      targetId: task.targetId,
      taskDescription: task.description,
      difficulty: task.difficulty
    };
  });
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
  const groups = scoredTaskGroups();
  const stateRow = BLOCK_ORDERS[factors.blockOrderRow];
  if (!stateRow) throw new Error("block order row missing");
  const colour = COLOUR_PERMUTATIONS[factors.colourRow] ?? DEFAULT_COLOUR_MAPPING;

  const blocks: BlockSpec[] = [];
  const trialSpecs: TrialSpec[] = [];
  for (let b = 0; b < 4; b++) {
    const blockId = `${sessionId}-B${b + 1}`;
    const stateLabel = stateRow[b] ?? "happy";
    const group = groups[(STATE_LABELS.indexOf(stateLabel) + factors.targetSet) % 4] ?? [];
    const searches = blockSearches(group, factors.menuRow, b);
    const trialIds = searches.map((_, t) => `${sessionId}-B${b + 1}-T${t + 1}`);
    searches.forEach(({ menuId, task }, t) => {
      trialSpecs.push({
        trialId: trialIds[t]!,
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
    });
    blocks.push({ blockId, blockIndex: b, stateLabel, menuIds: searches.map((s) => s.menuId), trialIds });
  }

  const practiceTrials = practiceTrialsFor(sessionId, factors.menuRow);

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
    menuOrder: blocks.flatMap((b) => b.menuIds),
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
