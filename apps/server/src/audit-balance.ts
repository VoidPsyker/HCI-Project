import { config } from "./config";
import { Repository } from "./repository";

const repo = new Repository(config.dbPath, config.rawDir, config.seed);
const assignments = repo.allAssignments();
const errors: string[] = [];
const targetSetCounts = new Map<number, number>();
const menuCounts = new Map<string, number>();
const statePositionCounts = new Map<string, number>();
const colourCounts = new Map<string, number>();

for (const row of assignments) {
  let design: {
    targetSet: number;
    blocks: Array<{ stateLabel: string; menuIds: string[] }>;
    trials: Array<{ menuId: string; difficulty: string }>;
    colourMapping: Record<string, string>;
  };
  try {
    design = JSON.parse(String(row.design_json));
  } catch {
    errors.push(`invalid design_json for ${row.session_id}`);
    continue;
  }
  targetSetCounts.set(design.targetSet, (targetSetCounts.get(design.targetSet) ?? 0) + 1);
  const flatMenus = design.blocks.flatMap((b) => b.menuIds);
  for (const menu of flatMenus) menuCounts.set(menu, (menuCounts.get(menu) ?? 0) + 1);
  for (const block of design.blocks) statePositionCounts.set(block.stateLabel, (statePositionCounts.get(block.stateLabel) ?? 0) + 1);
  for (const colour of Object.values(design.colourMapping)) colourCounts.set(colour, (colourCounts.get(colour) ?? 0) + 1);

  if (design.blocks.length !== 4) errors.push(`${row.session_id}: expected 4 blocks`);
  if (design.trials.length !== 12) errors.push(`${row.session_id}: expected 12 trials`);
  const counts = new Map<string, number>();
  for (const menu of flatMenus) counts.set(menu, (counts.get(menu) ?? 0) + 1);
  for (const menu of ["A", "B", "C", "D", "E", "F"]) {
    if ((counts.get(menu) ?? 0) !== 2) errors.push(`${row.session_id}: menu ${menu} appears ${counts.get(menu) ?? 0} times`);
  }
  for (const block of design.blocks) {
    if (new Set(block.menuIds).size !== 3) errors.push(`${row.session_id}: repeated menu within a block`);
  }
  if (new Set(design.blocks.map((b) => b.stateLabel)).size !== 4) errors.push(`${row.session_id}: states not unique`);
  const difficulties = design.trials.reduce<Record<string, number>>((acc, t) => {
    acc[t.difficulty] = (acc[t.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  for (const difficulty of ["Easy", "Medium", "Hard"]) {
    if ((difficulties[difficulty] ?? 0) !== 4) errors.push(`${row.session_id}: ${difficulty} count is ${difficulties[difficulty] ?? 0}`);
  }
}

const n = assignments.length;
const tolerance = Math.max(1, Math.ceil(n / 6));
const spread = (counts: Map<number | string, number>) => {
  if (counts.size === 0) return 0;
  const values = [...counts.values()];
  return Math.max(...values) - Math.min(...values);
};
const targetSpread = spread(targetSetCounts);
const menuSpread = spread(menuCounts);
const stateSpread = spread(statePositionCounts);
const balanceOk = targetSpread <= tolerance && menuSpread <= Math.max(1, n * 2 - n * 2) + 0 && stateSpread <= Math.max(1, Math.ceil(n / 4));
// Menu counts should be exactly 2n in total and each menu should have close to n/3; with every design
// containing each menu twice, any complete design is perfectly balanced, so menuSpread is expected 0.

const report = {
  assignments: n,
  target_set_counts: Object.fromEntries([...targetSetCounts.entries()].sort((a, b) => a[0] - b[0])),
  menu_counts: Object.fromEntries([...menuCounts.entries()].sort()),
  state_counts: Object.fromEntries([...statePositionCounts.entries()].sort()),
  colour_counts: Object.fromEntries([...colourCounts.entries()].sort()),
  target_set_spread: targetSpread,
  menu_spread: menuSpread,
  state_spread: stateSpread,
  tolerance,
  design_errors: errors,
  balance_ok: balanceOk && errors.length === 0
};
console.log(JSON.stringify(report, null, 2));
repo.close();
if (!report.balance_ok) process.exitCode = 1;
