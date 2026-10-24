import { expect, test } from "@playwright/test";

let sessionId: string;

test.beforeEach(async ({ page, request }) => {
  const response = await request.post("/api/admin/sessions", {
    headers: { "x-admin-password": process.env.ADMIN_PASSWORD ?? "pilot-admin" },
    data: { label: "SYNTHETIC production-flow rehearsal" }
  });
  expect(response.ok()).toBe(true);
  sessionId = (await response.json()).session.session_id;
  await page.addInitScript(() => {
    (window as any).__cameraAttempts = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__cameraAttempts++;
      throw new Error("Camera disabled by production-flow test");
    };
  });
  await page.goto(`/run/${sessionId}`);
  await expect(page.getByTestId("consent-screen")).toBeVisible();
});

test.afterEach(async ({ request }) => {
  if (sessionId) await request.post(`/api/sessions/${sessionId}/withdraw`, { data: { confirm: true } });
});

async function coreConsent(page: import("@playwright/test").Page) {
  await page.getByTestId("consent-screen").getByRole("checkbox").check();
  await page.getByTestId("consent-continue").click();
  await expect(page.getByTestId("gaze-consent-screen")).toBeVisible();
}

test("requires separate consent and refusal ends the session without camera access", async ({ page, request }) => {
  await coreConsent(page);
  await expect(page.getByTestId("gaze-consent-grant")).toBeDisabled();
  await page.getByTestId("gaze-consent-refuse").click();
  await expect.poll(async () => (await (await request.get(`/api/sessions/${sessionId}/status`)).json()).status).toBe("aborted");
  expect(await page.evaluate(() => (window as any).__cameraAttempts)).toBe(0);
  await expect(page.getByTestId("start-trial")).toHaveCount(0);
});

test("keeps camera off through setup and invalidates measurements after resize", async ({ page }) => {
  await coreConsent(page);
  await page.getByTestId("gaze-consent-checkbox").check();
  await page.getByTestId("gaze-consent-grant").click();
  await expect(page.getByTestId("gaze-setup-screen")).toBeVisible();
  await page.getByTestId("gaze-width-mm").fill("530");
  await page.getByTestId("gaze-height-mm").fill("300");
  await page.getByTestId("gaze-distance-mm").fill("600");
  await page.getByTestId("gaze-measured-confirm").check();
  await page.getByTestId("gaze-windowed-confirm").check();
  await expect(page.getByTestId("gaze-setup-continue")).toBeEnabled();
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByTestId("gaze-setup-continue")).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__cameraAttempts)).toBe(0);
});

async function calibrationFixture(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  await coreConsent(page);
  await page.getByTestId("gaze-consent-checkbox").check();
  await page.getByTestId("gaze-consent-grant").click();
  await page.getByTestId("gaze-width-mm").fill("530");
  await page.getByTestId("gaze-height-mm").fill("300");
  await page.getByTestId("gaze-distance-mm").fill("600");
  await page.getByTestId("gaze-measured-confirm").check();
  await page.getByTestId("gaze-windowed-confirm").check();
  await page.getByTestId("gaze-setup-continue").click();
  const response = await request.post(`/api/sessions/${sessionId}/demographics`, { data: {
    age_band: "25-34", gender: "prefer not to say", education: "undergraduate",
    shopping_freq: "monthly", watch_expertise: 4, tech_savvy: 4, colour_vision: "typical"
  } });
  expect(response.ok()).toBe(true);
  // Prime only the calibration entry point; no scored trial or quality gate is bypassed.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("meridian.runner.v2")!);
    saved.state.phase = "calibration";
    localStorage.setItem("meridian.runner.v2", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByTestId("gaze-calibration-retry")).toBeVisible();
}

test("camera denial can retry without requesting replacement consent", async ({ page, request }) => {
  let consents = 0;
  page.on("request", (req) => { if (req.url().endsWith("/consent") && req.url().includes("/api/gaze/")) consents++; });
  await calibrationFixture(page, request);
  await page.getByTestId("gaze-calibration-retry").click();
  await expect.poll(() => page.evaluate(() => (window as any).__cameraAttempts)).toBe(2);
  await expect(page.getByTestId("gaze-calibration-retry")).toBeVisible();
  expect(consents).toBe(1);
  await expect(page.getByTestId("start-trial")).toHaveCount(0);
});

test("reload after gaze consent stops at authorization recovery without camera access", async ({ page, request }) => {
  await calibrationFixture(page, request);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ask for a new session link" })).toBeVisible();
  await expect(page.getByTestId("gaze-calibration-retry")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__cameraAttempts)).toBe(0);
});

test("reload at debrief without a gaze controller cannot mark the session complete", async ({ page, request }) => {
  await calibrationFixture(page, request);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("meridian.runner.v2")!);
    saved.state.phase = "debrief";
    localStorage.setItem("meridian.runner.v2", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByTestId("debrief-screen")).toBeVisible();
  await page.getByTestId("finish-session").click();
  await expect(page.getByText(/could not be finalized/i)).toBeVisible();
  await expect(page.getByTestId("complete-screen")).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(`/api/sessions/${sessionId}/status`)).json()).status)
    .not.toBe("completed");
});
