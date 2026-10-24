import { buildBalanceReport } from "./balance";
import { config } from "./config";
import type { StudyDesign } from "./design";
import { Repository } from "./repository";

const repo = new Repository(config.dbPath, config.rawDir, config.seed);
const designs: StudyDesign[] = [];
const unreadable: string[] = [];
for (const row of repo.allAssignments()) {
  try {
    designs.push(JSON.parse(String(row.design_json)) as StudyDesign);
  } catch {
    unreadable.push(`invalid design_json for ${String(row.session_id)}`);
  }
}
repo.close();

const report = buildBalanceReport(designs);
report.design_errors.unshift(...unreadable);
report.balance_ok &&= unreadable.length === 0;
console.log(JSON.stringify(report, null, 2));
if (!report.balance_ok) process.exitCode = 1;
