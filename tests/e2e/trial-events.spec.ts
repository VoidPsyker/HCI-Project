import { MENU_IDS, MENU_NAMES, semanticPath } from "./support/data";
import { expect, test } from "./support/fixtures";
import { navigateToLeaf } from "./support/menu-actions";
import { installSyntheticSession, pathIds, semanticIds, startTrial, waitForTrialEnd } from "./support/session";

const ALLOWED_EVENT_TYPES = new Set([
  "session_start",
  "consent",
  "demographics",
  "practice_start",
  "block_start",
  "induction_start",
  "induction_end",
  "checkin",
  "trial_start",
  "menu_open",
  "menu_close",
  "node_hover",
  "node_click",
  "leaf_select",
  "product_view",
  "back",
  "search_attempt",
  "timeout",
  "give_up",
  "trial_end",
  "block_end",
  "adaptation_shown",
  "adaptation_accepted",
  "adaptation_reverted",
  "questionnaire",
  "session_end"
]);

/**
 * Event reconstruction through the real runner, with the API intercepted.
 * Each trial must yield one trial_start, the semantic click path, one product
 * view and exactly one trial_end.
 */
test.describe("trial event reconstruction", () => {
  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) logs a complete reconstructable path`, async ({ page }) => {
      const leaf = semanticPath("sport.prodiver.steel-blue")[2];
      const session = await installSyntheticSession(page, { menuId, leafId: leaf.id });

      await startTrial(page);
      const clicks = await navigateToLeaf(page, menuId, leaf.id);
      expect(clicks).toBe(menuId === "C" ? 2 : 3);
      await waitForTrialEnd(session.events);

      const events = [...session.events].sort((a, b) => a.t_client - b.t_client);
      const trial = events.filter((event) => event.trial_id === "trial-1");
      expect(trial.filter((event) => event.event_type === "trial_start")).toHaveLength(1);
      expect(trial.filter((event) => event.event_type === "trial_end")).toHaveLength(1);
      expect(trial.filter((event) => event.event_type === "leaf_select")).toHaveLength(1);
      expect(trial.filter((event) => event.event_type === "product_view")).toHaveLength(1);

      const path = pathIds(trial);
      const expected = semanticIds(leaf.id);
      const reconstructable = path.length === 2 ? [path[0], expected[1], path[1]] : path;
      expect(reconstructable, "event path must reconstruct the semantic levels").toEqual(expected);

      const trialEnd = trial.find((event) => event.event_type === "trial_end")!;
      expect(trialEnd.meta.success).toBe(true);
      expect(trialEnd.meta.terminal).toBe("product");

      expect(new Set(events.map((event) => event.event_id)).size, "event ids must be unique").toBe(events.length);
      for (const event of events) {
        expect(ALLOWED_EVENT_TYPES.has(event.event_type), `${event.event_type} must be in the event vocabulary`).toBe(true);
      }
      for (const event of trial) {
        expect(event.menu_id, `${event.event_type} menu id`).toBe(menuId);
        expect(event.target_id, `${event.event_type} target id`).toBe(leaf.id);
      }

      const clientTimes = events.map((event) => event.t_client);
      expect(clientTimes, "performance.now timestamps must be monotonic").toEqual([...clientTimes].sort((a, b) => a - b));

      const elapsed = trial.map((event) => event.elapsed_ms).filter((value): value is number => value !== null);
      expect(elapsed, "trial elapsed times must be monotonic").toEqual([...elapsed].sort((a, b) => a - b));
      expect(elapsed[elapsed.length - 1]).toBeGreaterThanOrEqual(0);
    });
  }

  test("search attempts are ingested as search_attempt with the unavailable message", async ({ page }) => {
    const session = await installSyntheticSession(page, { menuId: "B" });
    await startTrial(page);
    await page.getByTestId("menu-search").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Search is unavailable in this session.").first()).toBeVisible();
    await page.getByTestId("trial-stage").getByTestId("give-up").click();
    await waitForTrialEnd(session.events);

    const attempt = session.events.find((event) => event.event_type === "search_attempt");
    expect(attempt, "search_attempt must be logged in the study event stream").toBeDefined();
    expect(attempt!.element_id).toBe("search");
    expect(attempt!.meta.message).toBe("Search is unavailable in this session.");
  });

  test("keyboard activation is logged as input_type=keyboard", async ({ page }) => {
    const leaf = semanticPath("dress.heritage.ivory-dial")[2];
    const session = await installSyntheticSession(page, { menuId: "B", leafId: leaf.id });
    await startTrial(page);

    const department = semanticPath(leaf.id)[0];
    const subcategory = semanticPath(leaf.id)[1];
    for (const node of [department, subcategory, leaf]) {
      const locator = page.getByTestId("menu-b").locator(`[data-node-id="${node.id}"]`);
      await locator.focus();
      await page.keyboard.press("Enter");
    }
    await waitForTrialEnd(session.events);

    const activation = session.events.filter(
      (event) => event.event_type === "node_click" || event.event_type === "leaf_select"
    );
    expect(activation.length).toBeGreaterThan(0);
    for (const event of activation) {
      expect(event.input_type, `${event.event_type} ${event.element_id} must record keyboard input`).toBe("keyboard");
    }
  });

  test("a timeout still ends with exactly one trial_end", async ({ page }) => {
    await page.clock.install();
    const session = await installSyntheticSession(page, { menuId: "A", fastMode: true });
    await startTrial(page);
    await page.clock.fastForward(31_000);
    await page.getByRole("dialog", { name: "Trial timed out" }).waitFor({ state: "visible" });
    await waitForTrialEnd(session.events);

    const events = session.events.filter((event) => event.trial_id === "trial-1");
    expect(events.filter((event) => event.event_type === "timeout")).toHaveLength(1);
    expect(events.filter((event) => event.event_type === "trial_end")).toHaveLength(1);
    const trialEnd = events.find((event) => event.event_type === "trial_end")!;
    expect(trialEnd.meta.success).toBe(false);
    expect(trialEnd.meta.terminal).toBe("timeout");
  });
});
