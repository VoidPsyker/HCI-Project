import { MENU_IDS, MENU_NAMES, childrenOf } from "./support/data";
import { expect, test } from "./support/fixtures";
import { gotoLab, keyboardToLeaf, nodeLocator } from "./support/menu-actions";

/**
 * Keyboard-only walkthrough for each menu: focus a node, Enter to open the
 * next level, repeat to the leaf. No pointer events are used.
 */
test.describe("keyboard routes", () => {
  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) is operable with the keyboard`, async ({ page }) => {
      const department = childrenOf(null)[0]!;
      const subcategory = childrenOf(department.id)[0]!;
      const leaf = childrenOf(subcategory.id)[0]!;

      await gotoLab(page, menuId);
      const clicks = await keyboardToLeaf(page, menuId, leaf.id);
      expect(clicks).toBe(menuId === "C" ? 2 : 3);
      await expect(page.getByTestId("product-detail")).toHaveAttribute("data-product-id", leaf.id);
    });
  }

  test("Space also activates a native menu control", async ({ page }) => {
    await gotoLab(page, "B");
    const department = childrenOf(null)[0]!;
    await resetFocus(page, "B", department.id, 1);
    await page.keyboard.press("Space");
    await expect(nodeLocator(page, "B", childrenOf(department.id)[0]!.id, 2)).toBeVisible();
  });
});

async function resetFocus(
  page: import("@playwright/test").Page,
  menuId: import("./support/data").MenuId,
  nodeId: string,
  level: 1 | 2 | 3
): Promise<void> {
  const locator = nodeLocator(page, menuId, nodeId, level);
  await expect(locator).toBeVisible();
  await locator.focus();
  await expect(locator).toBeFocused();
}
