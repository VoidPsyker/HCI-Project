import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Run against the built Fastify service, not Vite (CI sets PW_BASE_URL explicitly).
test("@deployment serves every local model asset intact with its real MIME type", async ({ request }) => {
  const root = resolve("node_modules/webgazer/dist/mediapipe/face_mesh");
  for (const name of readdirSync(root)) {
    if (!/\.(wasm|js|data|binarypb)$/.test(name)) continue;
    const response = await request.get(`/vendor/webgazer/mediapipe/face_mesh/${name}`);
    expect(response.status(), name).toBe(200);
    expect(await response.body(), name).toEqual(readFileSync(resolve(root, name)));
    const type = response.headers()["content-type"];
    if (name.endsWith(".wasm")) expect(type, name).toBe("application/wasm");
    else if (name.endsWith(".js")) expect(type, name).toMatch(/(?:application|text)\/javascript/);
    else expect(type, name).toBe("application/octet-stream");
    // These URLs are not content hashed: an updated model must be revalidated.
    const cache = response.headers()["cache-control"];
    expect(cache, name).not.toMatch(/immutable/);
    expect(cache, name).toMatch(/(?:no-cache|no-store|max-age=0(?:,|$))/);
  }
});

test("@deployment keeps missing model and bundle assets out of the SPA fallback", async ({ request }) => {
  for (const path of ["/vendor/webgazer/mediapipe/face_mesh/missing.wasm", "/assets/missing.js", "/missing.data"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()["content-type"], path).not.toContain("text/html");
  }
  const route = await request.get("/run/deployment-route-check");
  expect(route.status()).toBe(200);
  expect(route.headers()["content-type"]).toContain("text/html");
});

// A header regex cannot prove the model runs: load the real face model under the served policy.
test("@deployment initializes the local face model under the served security policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto("/");
  await page.addScriptTag({ url: "/vendor/webgazer/mediapipe/face_mesh/face_mesh.js" });
  const outcome = await page.evaluate(async () => {
    type FaceMeshSolution = { initialize(): Promise<void>; close(): Promise<void> };
    const FaceMesh = (window as unknown as { FaceMesh: new (config: { locateFile: (file: string) => string }) => FaceMeshSolution }).FaceMesh;
    const mesh = new FaceMesh({ locateFile: (file) => `/vendor/webgazer/mediapipe/face_mesh/${file}` });
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 30_000));
    try {
      return await Promise.race([mesh.initialize().then(() => "initialized"), timeout]);
    } catch (error) {
      return String(error);
    } finally {
      await mesh.close().catch(() => undefined);
    }
  });
  expect(outcome).toBe("initialized");
  expect(violations).toEqual([]);
});

test("@deployment permits same-origin camera and local WebAssembly on participant pages", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["permissions-policy"]).toMatch(/camera=\(self\)/);
  const csp = response.headers()["content-security-policy"];
  expect(csp).toBeTruthy();
  expect(csp).toMatch(/script-src[^;]*'self'/);
  expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
  expect(csp).toMatch(/connect-src[^;]*'self'/);
  expect(csp).toMatch(/worker-src[^;]*blob:/);
  const health = await request.get("/api/health");
  expect(health.headers()["cache-control"]).toContain("no-store");
});
