import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "..", "..", "node_modules", "webgazer");
const mediapipeSource = join(packageRoot, "dist", "mediapipe");
const vendorRoot = join(here, "..", "public", "vendor", "webgazer");
const mediapipeTarget = join(vendorRoot, "mediapipe");

// Overwrite in place: no recursive delete, so an unrelated or hand-placed file
// in the generated directory is never removed by this script.
await mkdir(mediapipeTarget, { recursive: true });
for (const entry of await readdir(mediapipeSource, { withFileTypes: true })) {
  await cp(join(mediapipeSource, entry.name), join(mediapipeTarget, entry.name), { recursive: true, force: true });
}
await cp(join(packageRoot, "LICENSE.md"), join(vendorRoot, "LICENSE-webgazer.md"), { force: true });
await cp(join(here, "..", "src", "biometrics", "THIRD_PARTY_NOTICES.md"), join(vendorRoot, "NOTICE.md"), { force: true });
console.log(`copied WebGazer MediaPipe assets and notices to ${vendorRoot}`);
