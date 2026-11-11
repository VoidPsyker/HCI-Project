import { config } from "./config";
import { trialCondition } from "./conditions";
import { Repository } from "./repository";
import { createServer } from "./server";
import { createVercelProxy, studyBackendOrigin } from "./vercel-proxy";

// Refuse to start rather than silently run Study 2/3 sessions as "static".
trialCondition(config.features);

const vercelProxy = process.env.MERIDIAN_VERCEL_PROXY === "true" || process.env.VERCEL === "1";
if (!vercelProxy && process.env.NODE_ENV === "production" && !process.env.ADMIN_PASSWORD?.trim()) {
  throw new Error("Set ADMIN_PASSWORD before starting the production study server.");
}

const repo = vercelProxy ? null : new Repository(config.dbPath, config.rawDir, config.seed, config.gazeDir);
const app = repo
  ? await createServer(repo)
  : await createVercelProxy(studyBackendOrigin(process.env.STUDY_BACKEND_ORIGIN));
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Meridian pilot server: http://127.0.0.1:${config.port}`);
  console.log(`Admin dashboard:       http://127.0.0.1:${config.port}/admin`);
  if (repo) console.log(`Database:              ${config.dbPath}`);
  console.log("Pilot build, ethics approval required before real participants.");
} catch (error) {
  console.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  repo?.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
