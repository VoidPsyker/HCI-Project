import { expect, type Locator, type Page } from "@playwright/test";
import {
  MIN_CLICKS,
  childrenOf,
  productIdForLeaf,
  semanticPath,
  type MenuId,
  type StateLabel,
  type TaxonomyNode
} from "./data";

/** Non-taxonomy controls that also carry data-node-id in the current app. */
const STRUCTURAL_IDS = new Set(["search", "root", "hub"]);

export function menuRoot(page: Page, menuId: MenuId): Locator {
  return page.getByTestId(`menu-${menuId.toLowerCase()}`);
}

/** The live menu nodes for the current step, excluding search/breadcrumb/hub chrome. */
export function menuNodes(page: Page, menuId: MenuId): Locator {
  return menuRoot(page, menuId).locator(
    '[data-node-id]:not([data-node-id="search"]):not([data-node-id="root"]):not([data-node-id="hub"])'
  );
}

export function nodeLocator(page: Page, menuId: MenuId, nodeId: string, level: 1 | 2 | 3): Locator {
  const menu = menuRoot(page, menuId);
  if (menuId === "A") {
    if (level === 1) return menu.locator(`[data-node-id="${nodeId}"]`);
    if (level === 2) return page.locator(`.a-dropdown [data-node-id="${nodeId}"]`);
    return page.locator(`.a-flyout [data-node-id="${nodeId}"]`);
  }
  return menu.locator(`[data-node-id="${nodeId}"]`);
}

export async function gotoLab(page: Page, menuId: MenuId, state?: StateLabel): Promise<void> {
  await page.goto("/lab");
  const selects = page.locator(".lab-controls select");
  await selects.nth(0).waitFor({ state: "visible" });
  await selects.nth(0).selectOption(menuId);
  if (state) await selects.nth(1).selectOption(state);
  await expect(menuRoot(page, menuId)).toBeVisible();
  await waitForRoot(page, menuId);
}

export async function waitForRoot(page: Page, menuId: MenuId): Promise<void> {
  await expect(menuNodes(page, menuId)).toHaveCount(4);
  await expect(menuNodes(page, menuId).first()).toBeVisible();
}

export async function closeProductIfOpen(page: Page): Promise<void> {
  const detail = page.getByTestId("product-detail");
  if ((await detail.count()) === 0) return;
  await detail.getByRole("button", { name: /Back to menu/i }).click();
  await expect(detail).toHaveCount(0);
}

/**
 * Wait until node geometry has stopped changing. Radix, Framer and D3 all move
 * nodes after a click, so a node-count check alone can observe a transitional
 * frame and then click a tile that is about to be detached.
 */
export async function waitForMenuSettled(page: Page, menuId: MenuId, timeout = 5_000): Promise<void> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const current = await menuNodes(page, menuId).evaluateAll((elements) =>
          JSON.stringify(
            elements.map((element) => {
              const rect = element.getBoundingClientRect();
              return [element.dataset.nodeId, Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
            })
          )
        );
        const stable = current !== "" && current === previous;
        previous = current;
        return stable;
      },
      { timeout, intervals: [50, 75, 100, 100, 100] }
    )
    .toBe(true);
}

/**
 * Return to the root level. The current menus do not all render a breadcrumb
 * at root, so use the visible Home control when it exists and otherwise walk
 * Back. Radix marks the page aria-hidden while its dropdown is open, so close
 * that layer with Escape before clicking the breadcrumb.
 */
export async function resetMenu(page: Page, menuId: MenuId): Promise<void> {
  await closeProductIfOpen(page);
  await waitForMenuSettled(page, menuId);

  const dropdown = page.locator(".a-dropdown");
  if ((await dropdown.count()) > 0 && (await dropdown.first().isVisible())) {
    await page.keyboard.press("Escape");
    await expect(dropdown).toHaveCount(0);
    await waitForMenuSettled(page, menuId);
  }

  const atRoot = async () => {
    if ((await menuNodes(page, menuId).count()) !== 4) return false;
    const flyout = page.locator(".a-flyout");
    return (await flyout.count()) === 0 || !(await flyout.first().isVisible());
  };
  if (await atRoot()) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await atRoot()) break;
    const home = page.locator('[data-node-id="root"]').first();
    if ((await home.count()) > 0 && (await home.isVisible())) {
      await home.click();
      await waitForMenuSettled(page, menuId);
      continue;
    }
    const back = page.locator(".back-link").first();
    if ((await back.count()) > 0 && (await back.isVisible())) {
      await back.click();
      await waitForMenuSettled(page, menuId);
      continue;
    }
    await page.keyboard.press("Escape");
    await waitForMenuSettled(page, menuId);
  }

  await waitForRoot(page, menuId);
}

async function clickNode(page: Page, menuId: MenuId, node: TaxonomyNode): Promise<void> {
  const locator = nodeLocator(page, menuId, node.id, node.level);
  await expect(locator).toBeVisible();
  await locator.click();
}

export async function navigateToLeaf(page: Page, menuId: MenuId, leafId: string): Promise<number> {
  const [dept, sub, leaf] = semanticPath(leafId);
  await waitForRoot(page, menuId);

  if (menuId === "C") {
    await clickNode(page, menuId, dept);
    await expect(menuRoot(page, menuId).getByTestId("c-mega")).toBeVisible();
    await expect(menuRoot(page, menuId).locator(".c-leaf")).toHaveCount(18);
    await clickNode(page, menuId, leaf);
  } else {
    await clickNode(page, menuId, dept);
    await expect(nodeLocator(page, menuId, sub.id, 2)).toBeVisible();
    if (menuId === "A") await expect(page.locator(".a-dropdown")).toBeVisible();

    await clickNode(page, menuId, sub);
    if (menuId === "A") await expect(page.locator(".a-flyout")).toBeVisible();
    await expect(nodeLocator(page, menuId, leaf.id, 3)).toBeVisible();

    await clickNode(page, menuId, leaf);
  }

  const detail = page.getByTestId("product-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute("data-product-id", productIdForLeaf(leaf.id));
  await expect(detail.locator("h2")).toHaveText(leaf.label);
  return MIN_CLICKS[menuId];
}

export async function keyboardToLeaf(page: Page, menuId: MenuId, leafId: string): Promise<number> {
  const [dept, sub, leaf] = semanticPath(leafId);
  await waitForRoot(page, menuId);

  const pressEnter = async (node: TaxonomyNode) => {
    const locator = nodeLocator(page, menuId, node.id, node.level);
    await expect(locator).toBeVisible();
    await locator.focus();
    await page.keyboard.press("Enter");
  };

  await pressEnter(dept);
  if (menuId !== "C") {
    await expect(nodeLocator(page, menuId, sub.id, 2)).toBeVisible();
    await pressEnter(sub);
  }
  await expect(nodeLocator(page, menuId, leaf.id, 3)).toBeVisible();
  await pressEnter(leaf);

  const detail = page.getByTestId("product-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute("data-product-id", productIdForLeaf(leaf.id));
  return MIN_CLICKS[menuId];
}

export function searchControl(page: Page, menuId: MenuId): Locator {
  const menu = menuRoot(page, menuId);
  return menu.getByTestId("menu-search").or(menu.getByRole("button", { name: /search/i })).first();
}

/** Ids and accessible labels currently rendered for one menu. */
export async function visibleNodeEntries(page: Page, menuId: MenuId): Promise<Array<{ id: string; label: string }>> {
  return entriesOf(menuRoot(page, menuId).locator("[data-node-id]"));
}

/** Ids and labels for an arbitrary target collection (e.g. a Radix portal). */
export async function entriesOf(locator: Locator): Promise<Array<{ id: string; label: string }>> {
  const entries = await locator.evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const html = element as HTMLElement;
        return {
          id: html.dataset.nodeId ?? "",
          label: html.getAttribute("aria-label") ?? html.textContent ?? ""
        };
      })
  );
  return entries.filter((entry) => !STRUCTURAL_IDS.has(entry.id));
}

export function nodesAtLevel(entries: Array<{ id: string; label: string }>, level: 1 | 2 | 3): Array<{ id: string; label: string }> {
  return entries.filter((entry) => entry.id.split(".").length === level);
}

export function expectedLabels(nodes: TaxonomyNode[]): string[] {
  return nodes.map((node) => node.label);
}

export function labelMatches(actual: string, expected: string): boolean {
  return actual.trim() === expected || actual.includes(expected);
}

export function subLeaves(subcategoryId: string): TaxonomyNode[] {
  return childrenOf(subcategoryId);
}
