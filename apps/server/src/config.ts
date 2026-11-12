import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../..");
dotenv.config({ path: path.join(ROOT, ".env") });

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

export const config = {
  root: ROOT,
  host: process.env.HOST ?? "127.0.0.1",
  port,
  adminPassword: process.env.ADMIN_PASSWORD ?? "pilot-admin",
  seed: process.env.STUDY_SEED ?? "meridian-pilot-2026",
  dbPath: resolveFromRoot(process.env.DATABASE_PATH ?? "data/meridian.sqlite"),
  rawDir: resolveFromRoot(process.env.RAW_DATA_DIR ?? "data/raw"),
  gazeDir: resolveFromRoot(process.env.GAZE_DATA_DIR ?? "data/gaze"),
  exportDir: resolveFromRoot("exports"),
  // Study 2/3 are out of pilot scope; see conditions.ts. Both must stay false for the pilot.
  features: {
    study2: process.env.FEATURE_STUDY2 === "true",
    study3: process.env.FEATURE_STUDY3 === "true"
  },
  webDist: path.join(ROOT, "apps", "web", "dist")
};
