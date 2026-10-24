import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../..");
dotenv.config({ path: path.join(ROOT, ".env") });

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

export const config = {
  root: ROOT,
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  adminPassword: process.env.ADMIN_PASSWORD ?? "pilot-admin",
  seed: process.env.STUDY_SEED ?? "meridian-pilot-2026",
  dbPath: resolveFromRoot(process.env.DATABASE_PATH ?? "data/meridian.sqlite"),
  rawDir: resolveFromRoot(process.env.RAW_DATA_DIR ?? "data/raw"),
  gazeDir: resolveFromRoot(process.env.GAZE_DATA_DIR ?? "data/gaze"),
  exportDir: resolveFromRoot("exports"),
  webDist: path.join(ROOT, "apps", "web", "dist")
};
