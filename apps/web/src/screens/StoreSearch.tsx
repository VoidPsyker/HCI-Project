import { useEffect, useRef, useState } from "react";
import { NODE_BY_ID, SCENARIO_TASKS, childrenOf, type TaxonomyNode } from "@meridian/taxonomy";
import { ProductDetail } from "../components/MenuChrome";
import type { EventLogger } from "../logger";
import type { InductionState } from "../content";

export interface StoreSearchTask {
  id: string;
  description: string;
  /** null for a watch the shop does not stock. */
  targetId: string | null;
}

type Outcome = "found" | "timeout" | "gave_up";

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Distinct script-written tasks, chosen from the block id so a reload shows the same ones. */
export function frustrationTasks(blockId: string, count: number): StoreSearchTask[] {
  const step = Math.floor(SCENARIO_TASKS.length / count);
  const start = hash(blockId) % SCENARIO_TASKS.length;
  return Array.from({ length: count }, (_, i) => {
    const task = SCENARIO_TASKS[(start + i * step) % SCENARIO_TASKS.length]!;
    return { id: task.id, description: task.description, targetId: task.targetId };
  });
}

function trailTo(nodeId: string | null): TaxonomyNode[] {
  const trail: TaxonomyNode[] = [];
  for (let node = nodeId ? NODE_BY_ID.get(nodeId) : undefined; node; node = node.parentId ? NODE_BY_ID.get(node.parentId) : undefined) {
    trail.unshift(node);
  }
  return trail;
}

/**
 * A plain shop list (not one of the six study menus) with the study's real catalogue names.
 * Each search has its own countdown; opening a watch shows the trials' product page.
 */
export function StoreSearches({
  state,
  blockId,
  tasks,
  searchMs,
  logger,
  onFinished
}: {
  state: InductionState;
  blockId: string;
  tasks: StoreSearchTask[];
  searchMs: number;
  logger: EventLogger;
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [parentId, setParentId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(searchMs);
  const [finished, setFinished] = useState(false);
  const startedRef = useRef(performance.now());
  const openedRef = useRef(0);
  const endedRef = useRef(-1);
  const task = tasks[index]!;

  const end = (outcome: Outcome) => {
    if (finished || endedRef.current >= index) return;
    endedRef.current = index;
    logger.log({
      event_type: "search_attempt",
      block_id: blockId,
      state_label: state,
      element_id: `induction:${state}:search-${index + 1}`,
      meta: {
        induction: state,
        search: index + 1,
        task_id: task.id,
        target_id: task.targetId,
        outcome,
        duration_ms: Math.round(performance.now() - startedRef.current),
        products_opened: openedRef.current
      }
    });
    if (index + 1 >= tasks.length) {
      setFinished(true);
      onFinished();
      return;
    }
    startedRef.current = performance.now();
    openedRef.current = 0;
    setIndex(index + 1);
    setParentId(null);
    setProductId(null);
    setRemaining(searchMs);
  };
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    if (finished) return;
    const interval = setInterval(() => {
      const left = Math.max(0, searchMs - (performance.now() - startedRef.current));
      setRemaining(left);
      if (left <= 0) endRef.current("timeout");
    }, 200);
    return () => clearInterval(interval);
  }, [index, finished, searchMs]);

  const open = (node: TaxonomyNode) => {
    logger.log({
      event_type: "node_click",
      block_id: blockId,
      state_label: state,
      level: node.level,
      element_id: `induction:${state}:${node.id}`,
      element_label: node.label,
      meta: { induction: state, search: index + 1 }
    });
    if (node.level === 3) {
      openedRef.current += 1;
      setProductId(node.productId ?? node.id);
    } else {
      setParentId(node.id);
    }
  };

  if (finished) {
    return (
      <div className="store-search store-done" data-testid="store-search">
        The searches are over. Continue when you are ready.
      </div>
    );
  }

  const last = index + 1 >= tasks.length;
  return (
    <div className="store-search" data-testid="store-search" data-task-id={task.id}>
      <div className="store-head">
        <span className="store-count">Search {index + 1} of {tasks.length}</span>
        <span className="store-timer" aria-live="polite">{Math.ceil(remaining / 1000)} s left</span>
      </div>
      <div className="task-banner">{task.description}</div>
      {productId ? (
        <ProductDetail
          productId={productId}
          correct={productId === task.targetId}
          onBack={() => setProductId(null)}
          {...(productId === task.targetId ? { onNext: () => end("found"), nextLabel: last ? "Finish" : "Next search" } : {})}
        />
      ) : (
        <>
          <nav className="store-crumbs" aria-label="Shop location">
            <button type="button" onClick={() => setParentId(null)}>All watches</button>
            {trailTo(parentId).map((node) => (
              <span key={node.id}>
                {" › "}
                <button type="button" onClick={() => setParentId(node.id)}>{node.label}</button>
              </span>
            ))}
          </nav>
          <ul className="store-list">
            {childrenOf(parentId).map((node) => (
              <li key={node.id}>
                <button type="button" onClick={() => open(node)}>{node.label}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="store-actions">
        <button type="button" className="button quiet" onClick={() => end("gave_up")}>
          I can’t find it
        </button>
      </div>
    </div>
  );
}
