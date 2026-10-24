import { MENU_IDS, MENU_NAMES, STATES, smokeLeaf } from "./support/data";
import { expect, test } from "./support/fixtures";
import { gotoLab, navigateToLeaf } from "./support/menu-actions";

/**
 * 24-path smoke suite: six menus × four induced states. Each combination
 * traverses a real 2–3 level path to a distinct product and verifies the
 * product detail that the participant would see.
 */
test.describe("@smoke smoke · six menus × four states", () => {
  for (const menuId of MENU_IDS) {
    for (const state of STATES) {
      const leaf = smokeLeaf(menuId, state);
      test(`Menu ${menuId} (${MENU_NAMES[menuId]}) · ${state} → ${leaf.label}`, async ({ page }) => {
        test.info().annotations.push(
          { type: "menu", description: menuId },
          { type: "state", description: state },
          { type: "product", description: leaf.id }
        );

        await gotoLab(page, menuId, state);
        await expect(page.locator(".lab-badge")).toContainText(`Menu ${menuId}`);
        await expect(page.locator(".lab-badge")).toContainText(state);

        const clicks = await test.step("traverse the semantic path", () => navigateToLeaf(page, menuId, leaf.id));
        expect(clicks, "menu path length must match the plan's minimum-click contract").toBe(menuId === "C" ? 2 : 3);

        await test.step("MenuLab previews the leaf event for this state", async () => {
          await expect(
            page.locator(".lab-event-strip code").filter({ hasText: `leaf_select ${leaf.label}` })
          ).toHaveCount(1);
        });
      });
    }
  }
});
