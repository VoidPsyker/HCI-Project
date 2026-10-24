import { DEPARTMENTS, MENU_IDS, MENU_NAMES, childrenOf, type TaxonomyNode } from "./support/data";
import { expect, test } from "./support/fixtures";
import {
  entriesOf,
  gotoLab,
  labelMatches,
  menuRoot,
  nodeLocator,
  nodesAtLevel,
  resetMenu,
  searchControl,
  visibleNodeEntries
} from "./support/menu-actions";

function assertNodes(actual: Array<{ id: string; label: string }>, expected: TaxonomyNode[], context: string): void {
  expect(actual.map((entry) => entry.id).sort(), `${context}: node ids`).toEqual(expected.map((node) => node.id).sort());
  for (const node of expected) {
    const entry = actual.find((candidate) => candidate.id === node.id);
    expect(entry, `${context}: missing ${node.id}`).toBeDefined();
    expect(labelMatches(entry!.label, node.label), `${context}: label for ${node.id} was "${entry!.label}"`).toBe(true);
  }
}

/**
 * Label parity: all six menus must expose exactly the same department,
 * collection and leaf labels from the one taxonomy JSON.
 */
test.describe("label parity", () => {
  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} (${MENU_NAMES[menuId]}) uses the shared taxonomy labels`, async ({ page }) => {
      await gotoLab(page, menuId);

      await test.step("root · 4 departments", async () => {
        const entries = nodesAtLevel(await visibleNodeEntries(page, menuId), 1);
        expect(entries).toHaveLength(4);
        assertNodes(entries, DEPARTMENTS, `Menu ${menuId} root`);
      });

      for (const department of DEPARTMENTS) {
        await test.step(`department · ${department.label}`, async () => {
          await resetMenu(page, menuId);
          await nodeLocator(page, menuId, department.id, 1).click();
          const subcategories = childrenOf(department.id);
          await expect
            .poll(async () => {
              const entries = await visibleNodeEntries(page, menuId);
              return entries.filter((entry) => subcategories.some((node) => node.id === entry.id)).length;
            })
            .toBe(3);

          if (menuId === "C") {
            await expect(menuRoot(page, menuId).getByTestId("c-mega")).toBeVisible();
            const headings = await menuRoot(page, menuId).locator(".c-column-head").allTextContents();
            for (const subcategory of subcategories) {
              expect(headings.some((heading) => heading.includes(subcategory.label))).toBe(true);
            }
            const leaves = subcategories.flatMap((subcategory) => childrenOf(subcategory.id));
            const entries = nodesAtLevel(await visibleNodeEntries(page, menuId), 3);
            expect(entries).toHaveLength(18);
            assertNodes(entries, leaves, `Menu ${menuId} mega panel`);
            return;
          }

          const subEntries = nodesAtLevel(
            menuId === "A"
              ? await entriesOf(page.locator(".a-dropdown [data-node-id]"))
              : await visibleNodeEntries(page, menuId),
            2
          );
          expect(subEntries).toHaveLength(3);
          assertNodes(subEntries, subcategories, `Menu ${menuId} ${department.id}`);

          for (const subcategory of subcategories) {
            const leaves = childrenOf(subcategory.id);
            await nodeLocator(page, menuId, subcategory.id, 2).click();
            await expect
              .poll(async () => {
                const entries = await visibleNodeEntries(page, menuId);
                return entries.filter((entry) => leaves.some((node) => node.id === entry.id)).length;
              })
              .toBe(6);
            const leafEntries = nodesAtLevel(await visibleNodeEntries(page, menuId), 3);
            expect(leafEntries).toHaveLength(6);
            assertNodes(leafEntries, leaves, `Menu ${menuId} ${subcategory.id}`);
            await resetMenu(page, menuId);
            await nodeLocator(page, menuId, department.id, 1).click();
          }
        });
      }
    });
  }
});

/**
 * Plan §4 parity contract: search is visibly present in every menu, disabled,
 * and explains itself when activated. aria-disabled (not native disabled) is
 * required so the activation can still be logged as search_attempt.
 */
test.describe("search parity", () => {
  for (const menuId of MENU_IDS) {
    test(`Menu ${menuId} shows the disabled search control`, async ({ page }) => {
      await gotoLab(page, menuId);
      const search = searchControl(page, menuId);
      await expect(search, `Menu ${menuId} must expose a visible search control`).toHaveCount(1);
      await expect(search).toBeVisible();
      expect(await search.getAttribute("aria-disabled"), "search must be aria-disabled so attempts remain loggable").toBe("true");
      await search.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Search is unavailable in this session.").first()).toBeVisible();
      await expect(
        page.locator(".lab-event-strip code").filter({ hasText: "search_attempt Search" })
      ).toHaveCount(1);
    });
  }
});
