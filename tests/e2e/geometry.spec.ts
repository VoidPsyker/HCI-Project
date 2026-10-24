import { MENU_IDS, MENU_NAMES, childrenOf } from "./support/data";
import { expect, test } from "./support/fixtures";
import { nodeLocator, waitForMenuSettled } from "./support/menu-actions";
import { installSyntheticSession, startTrial } from "./support/session";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Target extends Box {
  id: string;
  tag: string;
}

function intersectionArea(a: Box, b: Box): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function shortestGap(a: Box, b: Box): number {
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  if (gapX > 0 && gapY > 0) return Math.hypot(gapX, gapY);
  return Math.max(gapX, gapY);
}

/**
 * Collect the actual hit boxes of all visible controls inside the scan roots.
 * Nested wrappers (an SVG <g role=button> around its hit <rect>) are collapsed
 * to one target so the same control is not compared with itself.
 */
async function collectTargets(page: import("@playwright/test").Page, scopes: string[]): Promise<Target[]> {
  return page.evaluate((scopeSelectors) => {
    const roots = scopeSelectors
      .map((selector) => document.querySelector(selector))
      .filter((root): root is Element => Boolean(root));
    if (!roots.length) return [];

    const selector = '[data-hit-target], button, a[href], [role="button"], [role="menuitem"]';
    const all = roots.flatMap((root) => [...root.querySelectorAll(selector)]);
    const unique = [...new Set(all)].filter((element) => {
      if (element.closest('[aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    });

    const outerMost = unique.filter(
      (element) => !unique.some((other) => other !== element && element.contains(other))
    );

    return outerMost.map((element) => {
      const rect = element.getBoundingClientRect();
      const html = element as HTMLElement;
      return {
        id: html.dataset.nodeId ?? html.getAttribute("aria-label") ?? html.textContent?.trim().slice(0, 40) ?? element.tagName,
        tag: element.tagName.toLowerCase(),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    });
  }, scopes);
}

async function clippingIssues(page: import("@playwright/test").Page, scopes: string[]): Promise<string[]> {
  return page.evaluate((scopeSelectors) => {
    const issues: string[] = [];
    const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

    for (const scopeSelector of scopeSelectors) {
      const scope = document.querySelector(scopeSelector);
      if (!scope) continue;
      const targets = scope.querySelectorAll('[data-hit-target], button, a[href], [role="button"], [role="menuitem"]');
      for (const element of targets) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const html = element as HTMLElement;
        const id = html.dataset.nodeId ?? html.getAttribute("aria-label") ?? html.textContent?.trim().slice(0, 40) ?? element.tagName;
        if (rect.left < viewport.x - 0.5 || rect.top < viewport.y - 0.5 || rect.right > viewport.x + viewport.width + 0.5 || rect.bottom > viewport.y + viewport.height + 0.5) {
          issues.push(`${id}: outside 1920×1080 viewport (${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.width.toFixed(1)}×${rect.height.toFixed(1)})`);
        }

        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.documentElement) {
          const style = getComputedStyle(ancestor);
          if (["hidden", "auto", "scroll", "clip"].includes(style.overflowX) || ["hidden", "auto", "scroll", "clip"].includes(style.overflowY)) {
            const clip = ancestor.getBoundingClientRect();
            if (rect.left < clip.left - 0.5 || rect.top < clip.top - 0.5 || rect.right > clip.right + 0.5 || rect.bottom > clip.bottom + 0.5) {
              issues.push(`${id}: clipped by ${ancestor.tagName.toLowerCase()}.${ancestor.className}`);
              break;
            }
          }
          ancestor = ancestor.parentElement;
        }
      }
    }
    return issues;
  }, scopes);
}

async function assertGeometry(page: import("@playwright/test").Page, scopes: string[], label: string): Promise<void> {
  const targets = await collectTargets(page, scopes);
  expect(targets.length, `${label}: expected interactive targets`).toBeGreaterThan(0);

  const undersized = targets
    .filter((target) => target.width < 44 || target.height < 44)
    .map((target) => `${target.id} (${target.tag}) ${target.width.toFixed(1)}×${target.height.toFixed(1)}`);
  expect(undersized, `${label}: every target must be ≥44×44 at 1920×1080`).toEqual([]);

  const overlaps: string[] = [];
  const crowding: string[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i]!;
      const b = targets[j]!;
      if (intersectionArea(a, b) > 0.5) {
        overlaps.push(`${a.id} ↔ ${b.id}`);
        continue;
      }
      const gap = shortestGap(a, b);
      if (gap < 8) crowding.push(`${a.id} ↔ ${b.id}: ${gap.toFixed(1)}px`);
    }
  }
  const clipped = await clippingIssues(page, scopes);
  expect(overlaps, `${label}: interactive targets must not overlap`).toEqual([]);
  expect(clipped, `${label}: targets must not be clipped`).toEqual([]);
  expect(crowding, `${label}: interactive targets need ≥8px spacing`).toEqual([]);
}

/**
 * Geometry gate at 1920×1080: minimum hit size, no overlap, no clipping and
 * at least 8 px between targets, at every semantic level.
 */
test.describe("geometry at 1920×1080", () => {
  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) meets target and spacing sizes`, async ({ page }) => {
      const department = childrenOf(null)[0]!;
      const subcategory = childrenOf(department.id)[0]!;
      const leaf = childrenOf(subcategory.id)[0]!;
      const rootSelector = `[data-testid="menu-${menuId.toLowerCase()}"]`;

      expect(page.viewportSize()).toEqual({ width: 1920, height: 1080 });
      await installSyntheticSession(page, { menuId, leafId: leaf.id });
      await startTrial(page);
      await waitForMenuSettled(page, menuId);
      await assertGeometry(page, [rootSelector], `Menu ${menuId} root`);

      await nodeLocator(page, menuId, department.id, 1).click();
      if (menuId === "C") await expect(nodeLocator(page, menuId, leaf.id, 3)).toBeVisible();
      else await expect(nodeLocator(page, menuId, subcategory.id, 2)).toBeVisible();
      await waitForMenuSettled(page, menuId);
      await assertGeometry(
        page,
        menuId === "A" ? [rootSelector, ".a-dropdown"] : [rootSelector],
        `Menu ${menuId} department`
      );

      if (menuId !== "C") {
        await nodeLocator(page, menuId, subcategory.id, 2).click();
        await expect(nodeLocator(page, menuId, leaf.id, 3)).toBeVisible();
        await waitForMenuSettled(page, menuId);
        await assertGeometry(page, [rootSelector], `Menu ${menuId} collection`);
      }

      await nodeLocator(page, menuId, leaf.id, 3).click();
      await expect(page.getByTestId("product-detail")).toBeVisible();
      await assertGeometry(page, ['[data-testid="product-detail"]'], `Menu ${menuId} product detail`);
    });
  }
});
