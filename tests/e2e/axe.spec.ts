import AxeBuilder from "@axe-core/playwright";
import { MENU_IDS, MENU_NAMES, childrenOf } from "./support/data";
import { expect, test } from "./support/fixtures";
import { gotoLab, menuRoot, nodeLocator } from "./support/menu-actions";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Axe must not scan a menu while a fade is still running: a half-transparent
 * item reports a contrast failure that no settled frame has. This also closes
 * the coverage gap where a delayed D3 zoom is still showing the previous level.
 */
async function waitForSettledVisuals(page: import("@playwright/test").Page, label: string): Promise<void> {
  // Let React commit the new level and let CSS/WAAPI transitions register
  // before deciding that the menu is idle.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const roots = '[data-testid^="menu-"], .a-dropdown, .a-flyout, [data-testid="product-detail"]';
          return document.getAnimations().filter((animation) => {
            const target = animation.effect?.target;
            if (!(target instanceof Element) || !target.closest(roots)) return false;
            if (animation.playState === "finished" || animation.playState === "idle") return false;
            const timing = animation.effect?.getTiming();
            return typeof timing?.duration === "number" && timing.duration > 0 && timing.duration < 5_000;
          }).length;
        }),
      { timeout: 4_000 }
    )
    .toBe(0);
}

async function scan(page: import("@playwright/test").Page, includes: string[], label: string): Promise<void> {
  await waitForSettledVisuals(page, label);
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const include of includes) builder.include(include);
  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical"
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" "))
    })),
    `${label}: serious/critical axe violations`
  ).toEqual([]);
}

/** Axe scans of every menu at root, department, collection and product levels. */
test.describe("axe accessibility", () => {
  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) has no serious axe violations`, async ({ page }) => {
      const department = childrenOf(null)[0]!;
      const subcategory = childrenOf(department.id)[0]!;
      const leaf = childrenOf(subcategory.id)[0]!;
      const rootSelector = `[data-testid="menu-${menuId.toLowerCase()}"]`;

      await gotoLab(page, menuId);
      await scan(page, [rootSelector], `Menu ${menuId} root`);

      await nodeLocator(page, menuId, department.id, 1).click();
      if (menuId === "A") await expect(page.locator(".a-dropdown")).toBeVisible();
      else if (menuId === "C") await expect(menuRoot(page, menuId).getByTestId("c-mega")).toBeVisible();
      else await expect(nodeLocator(page, menuId, subcategory.id, 2)).toBeVisible();
      const departmentIncludes = [rootSelector];
      if (menuId === "A") departmentIncludes.push(".a-dropdown");
      await scan(page, departmentIncludes, `Menu ${menuId} department`);

      if (menuId === "C") {
        await nodeLocator(page, menuId, leaf.id, 3).click();
      } else {
        await nodeLocator(page, menuId, subcategory.id, 2).click();
        if (menuId === "A") {
          await expect(page.locator(".a-dropdown")).toHaveCount(0);
          await expect(page.locator(".a-flyout")).toBeVisible();
        } else {
          await expect(nodeLocator(page, menuId, leaf.id, 3)).toBeVisible();
        }
        await scan(page, [rootSelector], `Menu ${menuId} collection`);
        await nodeLocator(page, menuId, leaf.id, 3).click();
      }

      await expect(page.getByTestId("product-detail")).toBeVisible();
      await scan(page, ['[data-testid="product-detail"]'], `Menu ${menuId} product detail`);
    });
  }
});
