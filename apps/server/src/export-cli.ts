import { config } from "./config";
import { Repository } from "./repository";
import { writeExportBundle } from "./exports";

const repo = new Repository(config.dbPath, config.rawDir, config.seed);
const { directory, manifest } = writeExportBundle(repo, config.exportDir);
console.log(`Exported to ${directory}`);
for (const file of JSON.parse(manifest.content).files as Array<{ name: string; rows: number; sha256: string }>) {
  console.log(`${file.name}\t${file.rows} rows\tsha256=${file.sha256}`);
}
repo.close();
