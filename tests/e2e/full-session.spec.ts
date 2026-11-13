import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { DEPARTMENTS, semanticPath, type MenuId, type StateLabel } from "./support/data";
import { navigateToLeaf, nodeLocator, resetMenu } from "./support/menu-actions";

/**
 * Scripted participant: one complete pilot session through the real UI and API, in test mode
 * (?fast=1 shortens timers only). Needs the API server and live Vite (PW_BASE_URL=http://127.0.0.1:5173).
 *
 * A stand-in replaces the bundled WebGazer module and "looks at" the active calibration target, so the
 * real nine-point calibration and held-out validation run unchanged. It never touches a
 * camera, so this proves the flow and data pipeline, not human gaze accuracy.
 */
const scriptedGaze = (failCalibration: boolean) => `
let listener = null; let timer = null; let paused = false; const t0 = performance.now();
function lookAt() {
  if (${failCalibration}) return { x: innerWidth / 2, y: innerHeight / 2 };
  const el = document.querySelector('[data-testid="gaze-calibration-target"]');
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const api = {
  params: {},
  begin() { timer = setInterval(() => { if (!paused && listener) listener(lookAt(), performance.now() - t0); }, 33); return api; },
  end() { clearInterval(timer); timer = null; return api; },
  stopVideo() { return api; },
  pause() { paused = true; return api; },
  resume() { paused = false; return api; },
  setGazeListener(fn) { listener = fn; return api; },
  clearGazeListener() { listener = null; return api; },
  clearData() {},
  removeMouseEventListeners() {},
  recordScreenPosition() {},
  detectCompatibility() { return true; }
};
export default api;
`;

const ADMIN = { "x-admin-password": process.env.ADMIN_PASSWORD ?? "pilot-admin" };

/** Ratings that satisfy each induction's manipulation check (plan §3.4). */
const REPORT: Record<StateLabel, { valence: number; arousal: number }> = {
  happy: { valence: 7, arousal: 5 },
  frustrated: { valence: 3, arousal: 6 },
  confused: { valence: 4, arousal: 5 },
  bored: { valence: 4, arousal: 3 }
};

interface DesignTrial {
  trialId: string;
  menuId: MenuId;
  targetId: string;
}

async function checkIn(page: Page, state?: StateLabel) {
  await expect(page.getByTestId("checkin-screen")).toBeVisible();
  if (state) {
    await page.getByTestId(`valence-${REPORT[state].valence}`).click();
    await page.getByTestId(`arousal-${REPORT[state].arousal}`).click();
    await page.getByTestId(`state-${state}-6`).click();
  }
  await page.getByTestId("checkin-continue").click();
}

async function runTrial(page: Page, trial: DesignTrial, behaviour: "direct" | "detour" | "give_up") {
  await page.getByTestId("start-trial").click();
  await expect(page.getByTestId("trial-stage")).toHaveAttribute("data-trial-id", trial.trialId);
  if (behaviour === "give_up") {
    await page.getByTestId("give-up").click();
    await page.getByRole("button", { name: /Next (trial|practice)/ }).click();
    return;
  }
  if (behaviour === "detour") {
    const [targetDept] = semanticPath(trial.targetId);
    const wrong = DEPARTMENTS.find((dept) => dept.id !== targetDept.id)!;
    await nodeLocator(page, trial.menuId, wrong.id, 1).click();
    await resetMenu(page, trial.menuId);
  }
  await navigateToLeaf(page, trial.menuId, trial.targetId);
  await page.getByTestId("product-detail").getByRole("button", { name: /Next (trial|practice)/ }).click();
}

let sessionId: string | null = null;

// The scripted session passes through the real UI, so its provenance reads as human; never leave it in a dataset.
test.afterEach(async ({ request }) => {
  if (sessionId) await request.delete(`/api/admin/sessions/${sessionId}`, { headers: ADMIN });
  sessionId = null;
});

for (const failCalibration of [false, true]) test("@session completes the pilot with " + (failCalibration ? "gaze recorded beyond the calibration cutoff" : "valid gaze"), async ({ page, request, net }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000);
  const created = await request.post("/api/admin/sessions", { headers: ADMIN, data: { label: `SYNTHETIC scripted participant ${failCalibration ? "failed" : "valid"}` } });
  expect(created.ok()).toBe(true);
  sessionId = (await created.json()).session.session_id as string;
  await page.route("**/node_modules/.vite/deps/webgazer.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: scriptedGaze(failCalibration) })
  );

  await page.goto(`/run/${sessionId}?fast=1`);
  await page.getByTestId("consent-screen").getByRole("checkbox").check();
  await page.getByTestId("consent-continue").click();
  await page.getByTestId("gaze-consent-checkbox").check();
  await page.getByTestId("gaze-consent-grant").click();

  const field = (label: string) =>
    page.locator("label.field", { has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).locator("select");
  await field("Age band").selectOption("25-34");
  await field("Gender").selectOption("woman");
  await field("Highest education").selectOption("undergraduate");
  await field("Watch shopping frequency").selectOption("monthly");
  await field("Colour vision").selectOption("typical");
  await page.getByTestId("menu-experience").getByRole("checkbox").first().check();
  await page.getByTestId("demographics-continue").click();
  await checkIn(page);

  const design = (await (await request.get(`/api/sessions/${sessionId}`)).json()).design as {
    practiceTrials: Array<{ practiceId: string; menuId: MenuId; targetId: string }>;
    blocks: Array<{ stateLabel: StateLabel; trialIds: string[] }>;
    trials: DesignTrial[];
  };

  await page.getByTestId("start-practice").click();
  for (const practice of design.practiceTrials) {
    await runTrial(page, { trialId: practice.practiceId, menuId: practice.menuId, targetId: practice.targetId }, "direct");
  }

  await page.getByTestId("gaze-calibration-start").click();
  // Gaze continues whatever the calibration error; the cutoff is applied at analysis.
  await page.getByTestId("gaze-calibration-continue").click({ timeout: 60_000 });

  let mainIndex = 0;
  for (const block of design.blocks) {
    await page.getByTestId("start-induction").click();
    await expect(page.getByTestId("induction-screen")).toHaveAttribute("data-state", block.stateLabel);
    if (block.stateLabel === "frustrated" || block.stateLabel === "confused") {
      // Shop searches time out on their own (1 s each in test mode), then unlock the check-in.
      await expect(page.getByTestId("store-search")).toBeVisible();
      await expect(page.getByTestId("store-search")).toContainText("The searches are over");
    }
    if (block.stateLabel === "bored") {
      await page.getByTestId("induction-early-exit").click();
    } else {
      await page.getByTestId("induction-continue").click();
    }
    await checkIn(page, block.stateLabel);

    for (const trialId of block.trialIds) {
      const trial = design.trials.find((t) => t.trialId === trialId)!;
      await runTrial(page, trial, mainIndex === 1 ? "give_up" : mainIndex === 4 ? "detour" : "direct");
      mainIndex++;
    }
    await checkIn(page);
    await expect(page.getByTestId("neutral-reset")).toBeVisible();
    await expect(page.getByTestId("block-debrief")).not.toBeEmpty();
    await page.getByTestId("reset-continue").click();
  }

  const finalMenu = design.trials.at(-1)!.menuId;
  await expect(page.getByTestId("sus-" + finalMenu)).toBeVisible();
  await expect(page.getByTestId("sus-" + finalMenu).getByRole("radiogroup")).toHaveCount(10);
  await page.getByTestId("fill-neutral").click();
  await page.getByRole("button", { name: "Menu usability", exact: true }).click();
  await page.getByTestId("preferred-menu-B").click();
  await page.getByRole("button", { name: "Credibility", exact: true }).click();
  await page.getByTestId("submit-questionnaires").click();
  await page.getByTestId("finish-session").click();
  await expect(page.getByTestId("complete-screen")).toBeVisible();
  expect(net.consoleErrors).toEqual([]);

  // Scoring and QA, read back only through the researcher API.
  await expect
    .poll(async () => (await (await request.get(`/api/sessions/${sessionId}/status`)).json()).status)
    .toBe("completed");
  const trials = await request.get("/api/admin/export/trials.jsonl", { headers: ADMIN });
  const mine = (await trials.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => row.session_id === sessionId);
  expect(mine).toHaveLength(18);
  const main = mine.filter((row) => !row.practice);
  expect(main).toHaveLength(12);
  expect(main.filter((row) => row.success)).toHaveLength(11);
  expect(main.filter((row) => row.gave_up)).toHaveLength(1);
  expect(main.some((row) => Number(row.wrong_department) > 0 && row.success)).toBe(true);
  expect(main.every((row) => row.condition === "static")).toBe(true);

  const events = await request.get("/api/admin/export/events.jsonl", { headers: ADMIN });
  expect(events.ok()).toBe(true);
  const trialEvents = (await events.text()).trim().split("\n")
    .map((line) => JSON.parse(line))
    .filter((row) => row.session_id === sessionId && row.trial_id === design.trials[0]!.trialId);
  for (const type of ["pointer_move", "pointer_click"]) {
    expect(trialEvents.some((row) => row.event_type === type && Number.isFinite(row.x) && Number.isFinite(row.y))).toBe(true);
  }

  const questionnaires = await request.get("/api/admin/export/questionnaires.jsonl", { headers: ADMIN });
  expect(questionnaires.ok()).toBe(true);
  const responses = (await questionnaires.text()).trim().split("\n")
    .map((line) => JSON.parse(line))
    .filter((row) => row.session_id === sessionId);
  const usability = responses.filter((row) => row.instrument === "SUS");
  expect(usability).toHaveLength(10);
  expect(usability.every((row) => row.menu_id === finalMenu)).toBe(true);
  expect(responses.filter((row) => row.instrument === "PREFERENCE")).toEqual([
    expect.objectContaining({ item_id: "preferred_menu", text_value: "B" })
  ]);

  const demographics = await request.get("/api/admin/export/demographics.jsonl", { headers: ADMIN });
  expect(demographics.ok()).toBe(true);
  const demographicRows = (await demographics.text()).trim().split("\n").map((line) => JSON.parse(line));
  expect(demographicRows.find((row) => row.session_id === sessionId)).toMatchObject({
    age_band: "25-34",
    education: "undergraduate",
    shopping_freq: "monthly",
    colour_vision: "typical",
    prior_menu_experience: ["horizontal"]
  });

  const gazeCsvPath = "/api/admin/gaze/sessions/" + sessionId + "/export/gaze_samples.csv";
  expect((await request.get(gazeCsvPath)).status()).toBe(401);
  const manifest = await (await request.get(`/api/admin/gaze/sessions/${sessionId}/export/manifest.json`, { headers: ADMIN })).json();
  expect(manifest.calibration.cutoff_deg).toBe(10);
  expect(manifest.calibration.within_cutoff).toBe(!failCalibration);
  if (failCalibration) {
    expect(manifest.calibration.max_error_deg).toBeGreaterThan(10);
    expect(manifest.analysis_ready).toBe(false);
  }
  const gazeCsv = await request.get(gazeCsvPath, { headers: ADMIN });
  expect(gazeCsv.ok()).toBe(true);
  expect(gazeCsv.headers()["content-type"]).toContain("text/csv");
  expect(await gazeCsv.text()).toContain("session_id,participant_id,trial_id,seq,t_ms");

  const gaze = await request.get("/api/admin/gaze/sessions/" + sessionId + "/export/gaze_samples.jsonl", { headers: ADMIN });
  expect(gaze.ok()).toBe(true);
  const gazeRows = (await gaze.text()).trim().split("\n").map((line) => JSON.parse(line));
  const scoredIds = new Set(design.trials.map((trial) => trial.trialId));
  expect(gazeRows.some((row) => row.valid && scoredIds.has(row.trial_id) && Number.isFinite(row.x_px) && Number.isFinite(row.y_px))).toBe(true);

  const qa = await (await request.get("/api/admin/qa", { headers: ADMIN })).json();
  expect(qa.data_quality.missing_trial_starts).toBe(0);
  expect(qa.data_quality.duplicate_trial_ends).toBe(0);
  expect(qa.criteria.find((c: { id: string }) => c.id === "practice_reconstructable").status).toBe("pass");

  await page.goto("/admin");
  await page.getByLabel("Admin password").fill(ADMIN["x-admin-password"]);
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.getByRole("button", { name: "demographics.csv", exact: false })).toBeVisible();
  await page.getByText(`SYNTHETIC scripted participant ${failCalibration ? "failed" : "valid"}`, { exact: true }).click();
  const gazeExports = page.getByTestId("gaze-exports");
  await expect(gazeExports.getByRole("button", { name: "gaze_quality.json" })).toBeVisible();
  const download = page.waitForEvent("download");
  await gazeExports.getByRole("button", { name: "gaze_samples.csv" }).click();
  expect((await download).suggestedFilename()).toBe(sessionId + "-gaze_samples.csv");
  expect(qa.criteria.find((c: { id: string }) => c.id === "reconstructable").status).toBe("pass");
});
