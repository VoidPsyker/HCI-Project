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
 * The 12 scored searches form four groups of three, each with two easy and one medium search
 * (tiers in task-id order), so every emotion gets the same mix of difficulty.
 */
function scoredTaskGroups(): Task[][] {
  const tier = (difficulty: Difficulty) => SCORED_TASKS.filter((t) => t.difficulty === difficulty);
  const [easy, medium] = [tier("Easy"), tier("Medium")];
  const groups = [0, 1, 2, 3].map((g) => [easy[2 * g], easy[2 * g + 1], medium[g]]);
  if (groups.some((group) => group.some((task) => !task))) throw new Error("scored tasks must be 8 easy and 4 medium");
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
 * Blocks 1-2 split Williams row menuRow and blocks 3-4 split row menuRow + 3, so each menu is searched
 * twice, never twice in a block, and across 24 people each menu meets each emotion and each task
 * equally often. Slot t of block b takes task (t + b) of the emotion's group.
 */
function blockSearches(group: Task[], row: number, block: number): Array<{ menuId: MenuId; task: Task }> {
  const half = block % 2;
  return menuRow(row + 3 * Math.floor(block / 2))
    .slice(3 * half, 3 * half + 3)
    .map((menuId, t) => ({ menuId, task: group[(t + block) % 3]! }));
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

/** The menu x emotion pairs a design searches, one entry per scored search ("frustrated:C"). */
export function designCells(design: Pick<StudyDesign, "trials">): string[] {
  return design.trials.map((trial) => `${trial.stateLabel}:${trial.menuId}`);
}

/** Whether a design uses the current scored searches (earlier designs used other task sets). */
export function usesCurrentSearches(design: Pick<StudyDesign, "trials">): boolean {
  const ids = (list: string[]) => [...list].sort().join();
  return ids(design.trials.map((t) => t.taskId)) === ids(SCORED_TASKS.map((t) => t.id));
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
