// Regenerates the questionnaire's menu glimpses from the running app's menu lab.
// Usage: npm run dev, then `node apps/web/scripts/capture-menu-glimpses.mjs [baseUrl]`.
// Set PW_CHROMIUM_PATH to use a preinstalled Chromium binary.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "menus");
await mkdir(out, { recursive: true });

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 0.5 });
for (const menu of ["A", "B", "C", "D", "E", "F"]) {
  await page.goto(`${base}/lab`);
  const select = page.locator(".lab-controls select").first();
  await select.waitFor();
  await select.selectOption(menu);
  const root = page.getByTestId(`menu-${menu.toLowerCase()}`);
  // Open the first department so the glimpse shows how the menu unfolds.
  await root.locator('[data-node-id="sport"]').first().click();
  await page.waitForTimeout(900);
  await page.mouse.move(0, 0);
  await root.screenshot({ path: join(out, `menu-${menu.toLowerCase()}.jpg`), type: "jpeg", quality: 80 });
}
await browser.close();
console.log(`menu glimpses written to ${out}`);
