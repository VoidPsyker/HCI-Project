import type { Page } from "@playwright/test";
import { MENU_IDS, childrenOf, semanticPath, taskForTarget, type MenuId, type StateLabel } from "./data";

interface CapturedEvent {
  event_id: string;
  event_type: string;
  trial_id: string | null;
  menu_id: string | null;
  target_id: string | null;
  t_client: number;
  elapsed_ms: number | null;
  level: number | null;
  element_id: string | null;
  element_label: string | null;
  input_type: string;
  meta: Record<string, unknown>;
}

export interface SyntheticSession {
  sessionId: string;
  events: CapturedEvent[];
  targetId: string;
  taskText: string;
}

/**
 * Runs the real ExperimentRunner/TrialRunner against intercepted API calls.
 * No database row is created and no study data leaves the browser, while the
 * event payloads are the same objects the logger would POST.
 */
export async function installSyntheticSession(
  page: Page,
  options: { menuId: MenuId; stateLabel?: StateLabel; leafId?: string; fastMode?: boolean }
): Promise<SyntheticSession> {
  const { menuId, stateLabel = "happy" } = options;
  const leafId = options.leafId ?? childrenOf(childrenOf(childrenOf(null)[0]!.id)[0]!.id)[0]!.id;
  const [, , leaf] = semanticPath(leafId);
  const task = taskForTarget(leaf.id);
  const sessionId = `synthetic-${menuId}-${Math.random().toString(36).slice(2, 8)}`;
  const taskId = task?.id ?? "T01";
  const taskText = task?.description ?? `Find the ${leaf.label} watch.`;

  const now = new Date().toISOString();
  const session = {
    session_id: sessionId,
    participant_id: "synthetic-participant",
    study: "pilot",
    status: "in_progress",
    phase: "trials",
    created_at: now,
    started_at: now,
    ended_at: null,
    abort_reason: null,
    sequence_id: "synthetic-sequence",
    target_set: 1,
    colour_mapping: { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" }
  };
  const participant = { label: "Synthetic participant", consent_version: "pilot-1", consented_at: now };
  const design = {
    sessionId,
    participantId: "synthetic-participant",
    sequenceIndex: 0,
    sequenceId: "synthetic-sequence",
    stratum: "test",
    seedHash: "synthetic",
    taxonomyHash: "synthetic",
    targetSet: 1,
    colourMapping: { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" },
    blockOrder: [stateLabel],
    menuOrder: [...MENU_IDS],
    blocks: [
      {
        blockId: `block-${stateLabel}`,
        blockIndex: 0,
        stateLabel,
        menuIds: [menuId],
        trialIds: ["trial-1"]
      }
    ],
    practiceTrials: [],
    trials: [
      {
        trialId: "trial-1",
        blockId: `block-${stateLabel}`,
        blockIndex: 0,
        trialIndex: 0,
        menuId,
        taskId,
        targetId: leaf.id,
        taskDescription: taskText,
        difficulty: task?.difficulty ?? "Medium",
        stateLabel,
        condition: "static"
      }
    ],
    createdAt: now
  };
  const bundle = { session, participant, design };
  const events: CapturedEvent[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "GET" && url.pathname === `/api/sessions/${sessionId}`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bundle) });
      return;
    }
    if (method === "GET" && url.pathname === `/api/sessions/${sessionId}/status`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "in_progress", phase: "trials", abort_reason: null })
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/events") {
      const body = request.postDataJSON() as { events?: CapturedEvent[] };
      if (Array.isArray(body.events)) events.push(...body.events);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, accepted: body.events?.length ?? 0 })
      });
      return;
    }
    if (method === "PATCH" && url.pathname.endsWith("/state")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, session, design }) });
  });

  const spec = {
    trialId: "trial-1",
    blockId: `block-${stateLabel}`,
    menuId,
    taskId,
    targetId: leaf.id,
    taskDescription: taskText,
    stateLabel,
    practice: false,
    trialIndex: 0
  };

  const colourMapping = { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" } as const;

  await page.addInitScript(
    (cfg) => {
      (window as unknown as { __trialConfig: unknown }).__trialConfig = cfg;
    },
    {
      spec,
      colourMapping,
      fastMode: Boolean(options.fastMode),
      participantId: "synthetic-participant",
      sessionId
    }
  );

  await page.goto(`/test/fixtures/trial-harness.html`);
  await page.getByTestId("start-trial").waitFor({ state: "visible" });

  return { sessionId, events, targetId: leaf.id, taskText };
}

export async function startTrial(page: Page): Promise<void> {
  await page.getByTestId("start-trial").click();
  await page.getByTestId("trial-stage").waitFor({ state: "visible" });
}

export async function waitForTrialEnd(events: CapturedEvent[], timeout = 10_000): Promise<void> {
  const { expect } = await import("@playwright/test");
  await expect
    .poll(() => events.filter((event) => event.event_type === "trial_end").length, { timeout })
    .toBeGreaterThanOrEqual(1);
}

export function trialEvents(events: CapturedEvent[]): CapturedEvent[] {
  return events.filter((event) => event.trial_id === "trial-1" || event.event_type === "trial_start" || event.event_type === "trial_end");
}

export function pathIds(events: CapturedEvent[]): string[] {
  const clicks = events.filter((event) => event.event_type === "node_click");
  const leaf = events.find((event) => event.event_type === "leaf_select");
  if (!leaf?.element_id) return [];
  return [...clicks.map((event) => event.element_id).filter((id): id is string => Boolean(id)), leaf.element_id];
}

export function semanticIds(leafId: string): string[] {
  return semanticPath(leafId).map((node) => node.id);
}
