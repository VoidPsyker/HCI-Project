import type { MenuId, ResearchEvent } from "./events";

export interface TrialScore {
  success: boolean;
  completionTimeMs: number | null;
  elapsedMs: number | null;
  clicks: number;
  wrongDepartment: boolean;
  wrongSubcategory: boolean;
  wrongLeaf: boolean;
  backtracks: number;
  categorySwitches: number;
  pathEfficiency: number | null;
  firstClickCorrect: boolean | null;
  firstClickElementId: string | null;
  searchAttempts: number;
  timedOut: boolean;
  gaveUp: boolean;
  trialEndCount: number;
  missingTrialStart: boolean;
  missingTrialEnd: boolean;
  eventCount: number;
  path: string[];
  correctViewAtMs: number | null;
}

const MIN_CLICKS: Record<MenuId, number> = { A: 3, B: 3, C: 2, D: 3, E: 3, F: 3 };
const TIMEOUT_MS = 120_000;

function isProductView(event: ResearchEvent): boolean {
  return event.event_type === "product_view";
}

function isClick(event: ResearchEvent): boolean {
  return event.event_type === "node_click" || event.event_type === "leaf_select";
}

/**
 * Scores one trial from its event log only. The caller is responsible for
 * passing events belonging to a single trial_id. Events are sorted by t_client.
 */
export function scoreTrial(events: ResearchEvent[], targetId: string, menuId: MenuId): TrialScore {
  const sorted = [...events].sort((a, b) => a.t_client - b.t_client);
  const startEvent = sorted.find((e) => e.event_type === "trial_start");
  const correctView = sorted.find(
    (e) => isProductView(e) && (e.element_id === targetId || e.meta?.product_id === targetId || e.meta?.correct === true)
  );
  const endEvents = sorted.filter((e) => e.event_type === "trial_end");
  const endEvent = endEvents[0];
  const cutoff = correctView?.t_client ?? Number.POSITIVE_INFINITY;

  const beforeSuccess = sorted.filter((e) => e.t_client <= cutoff);
  const clicks = beforeSuccess.filter(isClick);
  const firstDepartment = clicks.find((e) => e.level === 1);
  const targetDept = targetId.split(".")[0];
  const targetSub = targetId.split(".").slice(0, 2).join(".");

  const wrongDepartment = Boolean(
    firstDepartment?.element_id && firstDepartment.element_id.split(".")[0] !== targetDept
  );

  const wrongSubcategory = clicks.some((e) => {
    if (e.level !== 2 || !e.element_id) return false;
    return e.element_id.split(".")[0] === targetDept && e.element_id !== targetSub;
  });

  const wrongLeaf = clicks.some(
    (e) => e.event_type === "leaf_select" && e.element_id !== null && e.element_id !== targetId
  );

  const backtracks = beforeSuccess.filter((e) => e.event_type === "back").length;

  let categorySwitches = 0;
  let lastDepartment: string | null = null;
  let lastSubcategory: string | null = null;
  for (const click of clicks) {
    if (click.level === 1 && click.element_id) {
      if (lastDepartment !== null && lastDepartment !== click.element_id) categorySwitches++;
      if (lastDepartment !== click.element_id) lastSubcategory = null;
      lastDepartment = click.element_id;
    }
    if (click.level === 2 && click.element_id) {
      if (lastSubcategory !== null && lastSubcategory !== click.element_id) categorySwitches++;
      lastSubcategory = click.element_id;
    }
  }

  const clickCount = clicks.length;
  const success = Boolean(correctView);
  let pathEfficiency: number | null = null;
  if (success && clickCount > 0) {
    pathEfficiency = Math.min(1, MIN_CLICKS[menuId] / clickCount);
  }

  const timedOut = sorted.some((e) => e.event_type === "timeout");
  const gaveUp = sorted.some((e) => e.event_type === "give_up");
  const completionTimeMs = correctView
    ? correctView.elapsed_ms ?? (startEvent ? correctView.t_client - startEvent.t_client : null)
    : null;
  const elapsedMs = success
    ? completionTimeMs
    : timedOut
      ? TIMEOUT_MS
      : endEvent
        ? endEvent.elapsed_ms ?? (startEvent ? endEvent.t_client - startEvent.t_client : null)
        : null;

  return {
    success,
    completionTimeMs,
    elapsedMs,
    clicks: clickCount,
    wrongDepartment,
    wrongSubcategory,
    wrongLeaf,
    backtracks,
    categorySwitches,
    pathEfficiency,
    firstClickCorrect: firstDepartment?.element_id ? firstDepartment.element_id === targetDept : null,
    firstClickElementId: firstDepartment?.element_id ?? null,
    searchAttempts: beforeSuccess.filter((e) => e.event_type === "search_attempt").length,
    timedOut,
    gaveUp,
    trialEndCount: endEvents.length,
    missingTrialStart: !startEvent,
    missingTrialEnd: endEvents.length !== 1,
    eventCount: sorted.length,
    path: clicks.map((e) => e.element_id).filter((id): id is string => Boolean(id)),
    correctViewAtMs: correctView?.t_client ?? null
  };
}
