import { config } from "./config";
import { trialCondition } from "./conditions";
import { Repository } from "./repository";
import { createServer } from "./server";

// Refuse to start rather than silently run Study 2/3 sessions as "static".
trialCondition(config.features);

const repo = new Repository(config.dbPath, config.rawDir, config.seed, config.gazeDir);
const app = await createServer(repo, { logger: false });
if (!process.env.ADMIN_PASSWORD) {
  console.warn("ADMIN_PASSWORD is not set; using the local development default. Set it in .env before real use.");
}
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Meridian pilot server: http://127.0.0.1:${config.port}`);
  console.log(`Admin dashboard:       http://127.0.0.1:${config.port}/admin`);
  console.log(`Database:              ${config.dbPath}`);
  console.log("Pilot build, ethics approval required before real participants.");
} catch (error) {
  console.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  repo.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
