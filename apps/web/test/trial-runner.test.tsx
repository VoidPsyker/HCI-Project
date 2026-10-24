import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COLOUR_MAPPING, LEAVES, NODE_BY_ID, type TaxonomyNode } from "@meridian/taxonomy";
import type { EventLogger } from "../src/logger";
import { TrialRunner, type TrialInstruction } from "../src/components/TrialRunner";

function fakeLogger() {
  const log = vi.fn();
  const beginTrial = vi.fn();
  const finishTrial = vi.fn();
  return {
    logger: { log, beginTrial, finishTrial } as unknown as EventLogger,
    log,
    beginTrial,
    finishTrial
  };
}

function pathFor(leaf: TaxonomyNode): [TaxonomyNode, TaxonomyNode] {
  const sub = NODE_BY_ID.get(leaf.parentId ?? "");
  const dept = sub ? NODE_BY_ID.get(sub.parentId ?? "") : undefined;
  if (!sub || !dept) throw new Error(`Leaf ${leaf.id} has no department path`);
  return [dept, sub];
}

function baseSpec(targetId: string): TrialInstruction {
  return {
    trialId: "trial-unit-1",
    blockId: "block-unit-1",
    menuId: "B",
    taskId: "task-unit-1",
    targetId,
    taskDescription: "A steel watch for everyday wear",
    stateLabel: "mixed",
    practice: false,
    trialIndex: 0
  };
}

function clickNode(id: string) {
  const element = document.querySelector(`[data-node-id="${id}"]`);
  if (!element) throw new Error(`No node ${id}`);
  fireEvent.click(element);
}

function eventTypes(log: ReturnType<typeof vi.fn>): string[] {
  return log.mock.calls.map(([event]) => (event as { event_type: string }).event_type);
}

function eventOf(log: ReturnType<typeof vi.fn>, type: string) {
  const call = log.mock.calls.find(([event]) => (event as { event_type: string }).event_type === type);
  return call?.[0] as Record<string, unknown> | undefined;
}

function renderTrial(targetId: string) {
  const fake = fakeLogger();
  const onComplete = vi.fn();
  render(
    <TrialRunner
      spec={baseSpec(targetId)}
      colourMapping={DEFAULT_COLOUR_MAPPING}
      logger={fake.logger}
      fastMode={false}
      onComplete={onComplete}
    />
  );
  return { ...fake, onComplete };
}

describe("TrialRunner", () => {
  it("returns from a wrong product on browser Back without ending the trial", () => {
    const target = LEAVES.find((leaf) => leaf.productId) as TaxonomyNode;
    const wrong = LEAVES.find((leaf) => leaf.productId && leaf.productId !== target.productId) as TaxonomyNode;
    const [dept, sub] = pathFor(wrong);
    const { log, finishTrial } = renderTrial(target.productId as string);
    fireEvent.click(screen.getByTestId("start-trial"));
    clickNode(dept.id);
    clickNode(sub.id);
    clickNode(wrong.id);
    expect(screen.getByRole("dialog", { name: "Wrong product" })).toBeInTheDocument();
    fireEvent.popState(window);
    expect(screen.queryByRole("dialog", { name: "Wrong product" })).not.toBeInTheDocument();
    const backs = log.mock.calls.map(([event]) => event).filter((event) => event.event_type === "back");
    expect(backs).toEqual([expect.objectContaining({ meta: { from: "product", correct: false, source: "browser" } })]);
    expect(finishTrial).not.toHaveBeenCalled();
  });

  it("completes a correct path with one trial_end and one finishTrial", () => {
    const targetLeaf = LEAVES.find((leaf) => leaf.productId) as TaxonomyNode;
    const [dept, sub] = pathFor(targetLeaf);
    const { log, beginTrial, finishTrial, onComplete } = renderTrial(targetLeaf.productId as string);

    fireEvent.click(screen.getByTestId("start-trial"));
    expect(beginTrial).toHaveBeenCalledTimes(1);
    expect(eventTypes(log)).toContain("trial_start");

    clickNode(dept.id);
    clickNode(sub.id);
    clickNode(targetLeaf.id);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "leaf_select",
        element_id: targetLeaf.id,
        parent_id: targetLeaf.parentId,
        meta: { correct: true }
      })
    );
    const end = eventOf(log, "trial_end");
    expect(end).toMatchObject({
      menu_id: "B",
      block_id: "block-unit-1",
      trial_id: "trial-unit-1",
      task_id: "task-unit-1",
      target_id: targetLeaf.productId,
      state_label: "mixed",
      meta: expect.objectContaining({ success: true, terminal: "product", menu_label: expect.any(String) })
    });
    expect(eventTypes(log).filter((type) => type === "trial_end")).toHaveLength(1);
    expect(finishTrial).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("product-detail")).toHaveAttribute("data-product-id", targetLeaf.productId);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next trial" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ success: true });
  });

  it("shows a wrong product, logs the back event, and still permits a later correct choice", () => {
    const targetLeaf = LEAVES.find((leaf) => leaf.productId) as TaxonomyNode;
    const [targetDept, targetSub] = pathFor(targetLeaf);
    const wrongLeaf = LEAVES.find(
      (leaf) =>
        leaf.productId &&
        leaf.productId !== targetLeaf.productId &&
        NODE_BY_ID.get(leaf.parentId ?? "")?.parentId !== targetDept.id
    ) as TaxonomyNode;
    const [wrongDept, wrongSub] = pathFor(wrongLeaf);
    const { log, finishTrial, onComplete } = renderTrial(targetLeaf.productId as string);

    fireEvent.click(screen.getByTestId("start-trial"));
    clickNode(wrongDept.id);
    clickNode(wrongSub.id);
    clickNode(wrongLeaf.id);

    expect(screen.getByRole("dialog", { name: "Wrong product" })).toBeInTheDocument();
    expect(screen.getByTestId("product-detail")).toHaveAttribute("data-product-id", wrongLeaf.productId);
    expect(eventOf(log, "leaf_select")).toMatchObject({ meta: { correct: false } });
    expect(finishTrial).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /back to menu/i }));
    expect(screen.queryByRole("dialog", { name: "Wrong product" })).not.toBeInTheDocument();
    expect(eventOf(log, "back")).toMatchObject({ meta: { from: "product", correct: false } });

    clickNode(targetDept.id);
    clickNode(targetSub.id);
    clickNode(targetLeaf.id);

    expect(finishTrial).toHaveBeenCalledTimes(1);
    expect(eventTypes(log).filter((type) => type === "trial_end")).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next trial" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ success: true });
  });

  it("records a give-up as a failed terminal event exactly once", () => {
    const targetLeaf = LEAVES.find((leaf) => leaf.productId) as TaxonomyNode;
    const { log, finishTrial, onComplete } = renderTrial(targetLeaf.productId as string);

    fireEvent.click(screen.getByTestId("start-trial"));
    fireEvent.click(screen.getByTestId("give-up"));

    expect(eventOf(log, "give_up")).toMatchObject({
      meta: { practice: false, stuck_60s: false }
    });
    expect(eventOf(log, "trial_end")).toMatchObject({
      meta: expect.objectContaining({ success: false, terminal: "give_up" })
    });
    expect(eventTypes(log).filter((type) => type === "trial_end")).toHaveLength(1);
    expect(finishTrial).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("dialog", { name: "Trial ended" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next trial" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ success: false });
  });
});
