import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { DEPARTMENTS, semanticPath, type MenuId, type StateLabel } from "./support/data";
import { navigateToLeaf, nodeLocator, resetMenu } from "./support/menu-actions";

/**
 * Scripted participant: one complete pilot session through the real UI and API, in test mode
 * (?fast=1 shortens timers only). Needs the API server and live Vite (PW_BASE_URL=http://127.0.0.1:5173).
 *
 * A stand-in replaces the bundled WebGazer module and "looks at" the active calibration target, so the
 * real nine-point calibration, held-out validation and 1.5° gate run unchanged. It never touches a
 * camera, so this proves the flow and data pipeline, not human gaze accuracy.
 */
const SCRIPTED_GAZE = `
let listener = null; let timer = null; let paused = false; const t0 = performance.now();
function lookAt() {
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

test("@session a scripted participant completes the whole pilot session", async ({ page, request, net }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000);
  const created = await request.post("/api/admin/sessions", { headers: ADMIN, data: { label: "SYNTHETIC scripted participant" } });
  expect(created.ok()).toBe(true);
  sessionId = (await created.json()).session.session_id as string;
  await page.route("**/node_modules/.vite/deps/webgazer.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: SCRIPTED_GAZE })
  );

  await page.goto(`/run/${sessionId}?fast=1`);
  await page.getByTestId("consent-screen").getByRole("checkbox").check();
  await page.getByTestId("consent-continue").click();
  await page.getByTestId("gaze-consent-checkbox").check();
  await page.getByTestId("gaze-consent-grant").click();
  await page.getByTestId("gaze-width-mm").fill("530");
  await page.getByTestId("gaze-height-mm").fill("300");
  await page.getByTestId("gaze-distance-mm").fill("600");
  await page.getByTestId("gaze-measured-confirm").check();
  await page.getByTestId("gaze-windowed-confirm").check();
  await page.getByTestId("gaze-setup-continue").click();

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

  let mainIndex = 0;
  for (const block of design.blocks) {
    await page.getByTestId("start-induction").click();
    await expect(page.getByTestId("induction-screen")).toHaveAttribute("data-state", block.stateLabel);
    if (block.stateLabel === "frustrated") {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.getByTestId("induction-filter").selectOption("42 mm");
        await page.getByTestId("induction-search").click();
        await expect(page.getByTestId("induction-filter")).toHaveValue("Any");
      }
      await expect(page.getByTestId("induction-search-result")).toContainText("No results.");
      await expect(page.getByTestId("induction-search")).toBeDisabled();
    }
    if (block.stateLabel === "bored") {
      await page.getByTestId("induction-early-exit").click();
    } else {
      await page.getByTestId("induction-continue").click();
    }
    await checkIn(page, block.stateLabel);

    if (mainIndex === 0) {
      await page.getByTestId("gaze-calibration-start").click();
      await page.getByTestId("gaze-calibration-continue").click({ timeout: 60_000 });
    }
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

  await page.getByTestId("fill-neutral").click();
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

  const qa = await (await request.get("/api/admin/qa", { headers: ADMIN })).json();
  expect(qa.data_quality.missing_trial_starts).toBe(0);
  expect(qa.data_quality.duplicate_trial_ends).toBe(0);
  expect(qa.criteria.find((c: { id: string }) => c.id === "practice_reconstructable").status).toBe("pass");
  expect(qa.criteria.find((c: { id: string }) => c.id === "reconstructable").status).toBe("pass");
});
