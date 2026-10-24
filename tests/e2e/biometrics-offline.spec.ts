import { expect, test, chromium } from "@playwright/test";
import type { Browser, BrowserContext } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import path from "node:path";

/**
 * Network-blocked WebGazer startup. The browser gets a fake camera device and
 * every non-local HTTP request is aborted. This proves the MediaPipe runtime is
 * served from the local vendor copy rather than a CDN; it does not claim gaze
 * accuracy (the fake video contains no face).
 */
let vite: ViteDevServer;
let browser: Browser;
let context: BrowserContext;
let baseUrl: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  vite = await createServer({
    root: path.resolve(process.cwd(), "apps/web"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false }
  });
  await vite.listen();
  const resolved = vite.resolvedUrls?.local?.[0];
  if (!resolved) throw new Error("vite_url_unavailable");
  baseUrl = resolved;

  browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.grantPermissions(["camera"], { origin: new URL(baseUrl).origin });
});

test.afterAll(async () => {
  await context?.close();
  await browser?.close();
  await vite?.close();
});

test("starts WebGazer with the fake camera while all non-local requests are blocked", async () => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  const external: string[] = [];
  const local: string[] = [];
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") {
      void route.continue();
      return;
    }
    if (url.origin === new URL(baseUrl).origin) {
      local.push(url.pathname);
      void route.continue();
      return;
    }
    external.push(url.href);
    void route.abort();
  });

  await page.goto(`${baseUrl}test/biometrics/fixtures/smoke.html`);
  await expect
    .poll(
      async () => page.evaluate(() => (window as unknown as { __gazeSmoke?: { status: string; error: string | null } }).__gazeSmoke?.status),
      { timeout: 120_000, message: "WebGazer should leave the starting state" }
    )
    .toMatch(/running|error/);

  const started = await page.evaluate(
    () => (window as unknown as { __gazeSmoke: { status: string; error: string | null; cameraActive: boolean } }).__gazeSmoke
  );
  expect(started.error).toBeNull();
  expect(started.status).toBe("running");
  expect(started.cameraActive).toBe(true);

  const stopped = await page.evaluate(
    () => (window as unknown as { __stopGazeSmoke: () => Promise<{ status: string; cameraActive: boolean }> }).__stopGazeSmoke()
  );
  expect(stopped.status).toBe("stopped");
  expect(stopped.cameraActive).toBe(false);

  expect(local.some((requestPath) => requestPath.includes("/vendor/webgazer/mediapipe/face_mesh"))).toBe(true);
  expect(external).toEqual([]);
  expect(dialogs).toEqual([]);
  await page.close();
});
