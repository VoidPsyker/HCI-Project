import { test, expect } from "./support/fixtures";
import { navigateToLeaf } from "./support/menu-actions";
import { installSyntheticSession, startTrial, waitForTrialEnd } from "./support/session";
import { semanticPath } from "./support/data";

/**
 * The whole suite blocks non-localhost requests. This test additionally proves
 * that a complete scored trial makes no such request and emits no console
 * errors while the trial is live.
 */
test("a complete trial makes no external request and logs no console errors", async ({ page, net }) => {
  const leaf = semanticPath("sport.prodiver.steel-blue")[2];
  const session = await installSyntheticSession(page, { menuId: "A", leafId: leaf.id });

  const errorsBefore = net.consoleErrors.length;
  await startTrial(page);
  await navigateToLeaf(page, "A", leaf.id);
  await waitForTrialEnd(session.events);

  expect(net.external, "no external URL may be requested during a trial").toEqual([]);
  expect(net.pageErrors, "no uncaught errors during a trial").toEqual([]);
  expect(net.consoleErrors.slice(errorsBefore), "no console errors during a trial").toEqual([]);

  for (const url of net.requests) {
    const hostname = new URL(url).hostname;
    expect(["127.0.0.1", "localhost", "::1", "0.0.0.0"], `${url} must be local`).toContain(hostname);
  }
});
