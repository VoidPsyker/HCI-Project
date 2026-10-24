import { MENU_IDS, MENU_NAMES, leavesInStableOrder, productIdForLeaf } from "./support/data";
import { expect, test } from "./support/fixtures";
import { closeProductIfOpen, gotoLab, navigateToLeaf, resetMenu } from "./support/menu-actions";

/**
 * 432-path full suite: every one of the 72 products in every menu.
 * The paths are generated from the taxonomy JSON, so a renamed or removed
 * leaf fails here rather than being quietly dropped.
 */
test.describe("@full full · 432 product paths", () => {
  test.describe.configure({ timeout: 900_000 });

  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) reaches all 72 products`, async ({ page }) => {
      const leaves = leavesInStableOrder();
      const seen = new Set<string>();

      await gotoLab(page, menuId);

      for (const [index, leaf] of leaves.entries()) {
        await test.step(`${String(index + 1).padStart(2, "0")}/72 · ${leaf.id}`, async () => {
          if (index > 0) await resetMenu(page, menuId);
          const clicks = await navigateToLeaf(page, menuId, leaf.id);
          expect(clicks).toBe(menuId === "C" ? 2 : 3);
          seen.add(productIdForLeaf(leaf.id));
          await closeProductIfOpen(page);
        });
      }

      expect(seen.size, "all 72 products must be reached").toBe(72);
      test.info().annotations.push(
        { type: "menu", description: menuId },
        { type: "paths", description: "72" }
      );
    });
  }
});
