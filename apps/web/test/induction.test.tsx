import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NODE_BY_ID, SCENARIO_TASKS, products, semanticPath } from "@meridian/taxonomy";
import type { EventLogger } from "../src/logger";
import { INDUCTIONS } from "../src/content";
import { InductionScreen } from "../src/screens/Induction";

afterEach(() => vi.useRealTimers());

const outcomes = (log: ReturnType<typeof vi.fn>) =>
  log.mock.calls.map(([event]) => event).filter((event) => event.event_type === "search_attempt").map((event) => event.meta);

function setup(state: "frustrated" | "confused" | "bored") {
  const log = vi.fn();
  const onComplete = vi.fn();
  const onDistressStop = vi.fn();
  render(
    <InductionScreen
      state={state}
      blockId="block-1"
      fastMode={false}
      logger={{ log } as unknown as EventLogger}
      onComplete={onComplete}
      onDistressStop={onDistressStop}
    />
  );
  const ends = () => log.mock.calls.filter(([event]) => event.event_type === "induction_end");
  return { log, onComplete, onDistressStop, ends };
}

describe("InductionScreen", () => {
  it("leaves the induction_end of a stop to the runner, so it is logged once", () => {
    const { onDistressStop, ends } = setup("frustrated");
    fireEvent.click(screen.getByTestId("induction-stop"));
    expect(onDistressStop).toHaveBeenCalledTimes(1);
    expect(ends()).toHaveLength(0);
  });

  it("frustrates with three 15-second searches for script-written watches, then unlocks the check-in", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "Date"] });
    const { log, ends } = setup("frustrated");
    const store = () => screen.getByTestId("store-search");
    const seen = new Set<string>();
    for (let search = 1; search <= 3; search++) {
      expect(store()).toHaveTextContent(`Search ${search} of 3`);
      const taskId = store().getAttribute("data-task-id")!;
      expect(SCENARIO_TASKS.some((task) => task.id === taskId)).toBe(true);
      seen.add(taskId);
      expect(screen.getByTestId("induction-continue")).toBeDisabled();
      act(() => vi.advanceTimersByTime(15_200));
    }
    expect(seen.size).toBe(3);
    expect(outcomes(log).map((meta) => meta.outcome)).toEqual(["timeout", "timeout", "timeout"]);
    expect(screen.getByTestId("induction-continue")).toBeEnabled();
    expect(ends()).toHaveLength(1);
  });

  it("ends a frustration search early when the shopper finds the watch", () => {
    const { log } = setup("frustrated");
    const store = within(screen.getByTestId("store-search"));
    const task = SCENARIO_TASKS.find((candidate) => candidate.id === screen.getByTestId("store-search").getAttribute("data-task-id"))!;
    for (const node of semanticPath(task.targetId)) fireEvent.click(store.getByRole("button", { name: node.label }));
    fireEvent.click(screen.getByRole("button", { name: "Next search" }));
    expect(screen.getByTestId("store-search")).toHaveTextContent("Search 2 of 3");
    expect(outcomes(log)[0]).toMatchObject({ induction: "frustrated", search: 1, task_id: task.id, outcome: "found" });
  });

  it("confuses with one search for a watch the shop does not stock", () => {
    const criteria = INDUCTIONS.confused.criteria;
    expect(products.filter((p) => p.departmentId === criteria.departmentId && p.attributes.caseSize === criteria.caseSize &&
      p.attributes.movement === criteria.movement && p.attributes.dial === criteria.dial)).toEqual([]);
    const { log } = setup("confused");
    expect(screen.getByTestId("store-search")).toHaveTextContent(INDUCTIONS.confused.task);
    const store = within(screen.getByTestId("store-search"));
    const dress = NODE_BY_ID.get("dress")!;
    fireEvent.click(store.getByRole("button", { name: dress.label }));
    fireEvent.click(store.getByRole("button", { name: "Midnight Dress" }));
    fireEvent.click(store.getByRole("button", { name: "Pearl White" }));
    expect(screen.getByTestId("product-detail")).toHaveTextContent("This is not the target product");
    expect(screen.getByTestId("induction-continue")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "I can’t find it" }));
    expect(outcomes(log)).toEqual([expect.objectContaining({ induction: "confused", outcome: "gave_up", products_opened: 1 })]);
    expect(screen.getByTestId("induction-continue")).toBeEnabled();
  });

  it("uses a plain shop list, not one of the six study menus", () => {
    setup("frustrated");
    expect(screen.queryByTestId(/^menu-[a-f]$/)).toBeNull();
    expect(within(screen.getByTestId("store-search")).getAllByRole("button", { name: /Sport & Dive|Dress & Formal|Everyday & Casual|Smart & Hybrid/ })).toHaveLength(4);
  });

  it("lets the bored participant leave early and logs it once", () => {
    const { onComplete, ends } = setup("bored");
    fireEvent.click(screen.getByTestId("induction-early-exit"));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(ends()).toHaveLength(1);
    expect(ends()[0]![0].meta).toMatchObject({ completed: false, early_exit: true });
  });
});
