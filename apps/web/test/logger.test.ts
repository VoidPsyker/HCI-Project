import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventLogger } from "../src/logger";

type FetchMock = ReturnType<typeof vi.fn>;

function storedEvents(key: string): unknown[] {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as unknown[]) : [];
}

function bodyOf(call: unknown[] | undefined): { events: Array<Record<string, unknown>> } {
  if (!call) throw new Error("fetch was not called");
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string) as { events: Array<Record<string, unknown>> };
}

describe("EventLogger", () => {
  let fetchMock: FetchMock;
  let now: number;

  beforeEach(() => {
    localStorage.clear();
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, writable: true, value: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("builds a complete event with session context and trial-relative elapsed time", async () => {
    const logger = new EventLogger("P-01", "S-01");
    logger.setState("frustrated");
    logger.beginTrial({
      block_id: "B-1",
      trial_id: "T-1",
      task_id: "task-1",
      target_id: "sport.field.steel",
      menu_id: "B",
      state_label: "frustrated",
      condition: "matched"
    });
    now = 1250;
    logger.log({ event_type: "node_click", level: 2, element_id: "sport.field", element_label: "Field" });
    await logger.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const event = bodyOf(fetchMock.mock.calls[0]).events[0]!;
    expect(event).toMatchObject({
      participant_id: "P-01",
      session_id: "S-01",
      study: "pilot",
      block_id: "B-1",
      trial_id: "T-1",
      task_id: "task-1",
      target_id: "sport.field.steel",
      menu_id: "B",
      state_label: "frustrated",
      condition: "matched",
      event_type: "node_click",
      elapsed_ms: 250,
      level: 2,
      element_id: "sport.field",
      element_label: "Field",
      parent_id: null,
      x: null,
      y: null,
      input_type: "mouse"
    });
    expect(typeof event.event_id).toBe("string");
    expect((event.event_id as string).length).toBeGreaterThan(8);
    expect(typeof event.t_client).toBe("number");
    logger.discard();
  });

  it("uses per-event context overrides and stops timing elapsed time after finishTrial", async () => {
    const logger = new EventLogger("P-01", "S-01");
    logger.setState("bored");
    logger.beginTrial({ menu_id: "A", state_label: "bored", condition: "static" });
    now = 1100;
    logger.log({ event_type: "menu_open", menu_id: "C", level: 0, meta: { visible_options: 4 } });
    logger.finishTrial();
    now = 9999;
    logger.log({ event_type: "node_hover", element_id: "dress" });
    await logger.flush();

    const open = bodyOf(fetchMock.mock.calls[0]).events[0]!;
    const hover = bodyOf(fetchMock.mock.calls[0]).events[1]!;
    expect(open.menu_id).toBe("C");
    expect(open.elapsed_ms).toBe(100);
    expect(open.meta).toEqual({ visible_options: 4 });
    expect(hover.menu_id).toBe("A");
    expect(hover.elapsed_ms).toBeNull();
    logger.discard();
  });

  it("creates unique event ids and monotonically non-decreasing client timestamps", async () => {
    const logger = new EventLogger("P-02", "S-02");
    logger.log({ event_type: "session_start" });
    now += 5;
    logger.log({ event_type: "consent" });
    now += 5;
    logger.log({ event_type: "demographics" });
    await logger.flush();

    const events = bodyOf(fetchMock.mock.calls[0]).events;
    expect(new Set(events.map((event) => event.event_id)).size).toBe(3);
    const times = events.map((event) => event.t_client as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    logger.discard();
  });

  it("flushes the buffer on its 500ms interval", async () => {
    vi.useFakeTimers();
    try {
      const logger = new EventLogger("P-03", "S-03");
      logger.log({ event_type: "session_start" });
      expect(fetchMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(499);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.runOnlyPendingTimersAsync();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bodyOf(fetchMock.mock.calls[0]).events).toHaveLength(1);
      logger.discard();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists a failed batch and resends it once on the next flush", async () => {
    const logger = new EventLogger("P-04", "S-04");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    logger.log({ event_type: "trial_start", trial_id: "T-4" });
    await logger.flush();

    const key = "meridian.events.queue.S-04";
    const queued = storedEvents(key) as Array<Record<string, unknown>>;
    expect(queued).toHaveLength(1);
    expect(queued[0]!.trial_id).toBe("T-4");

    await logger.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const resent = bodyOf(fetchMock.mock.calls[1]).events;
    expect(resent).toHaveLength(1);
    expect(resent[0]!.event_id).toBe(queued[0]!.event_id);
    expect(storedEvents(key)).toHaveLength(0);
    logger.discard();
  });

  it("keeps events that fail with a non-ok response", async () => {
    const logger = new EventLogger("P-05", "S-05");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    logger.log({ event_type: "session_start" });
    await logger.flush();

    expect(storedEvents("meridian.events.queue.S-05")).toHaveLength(1);
    logger.discard();
  });

  it("resumes a persisted queue on construction", async () => {
    const pending = {
      event_id: "persisted-1",
      participant_id: "P-06",
      session_id: "S-06",
      study: "pilot",
      block_id: null,
      trial_id: null,
      task_id: null,
      target_id: null,
      menu_id: null,
      state_label: "mixed",
      condition: "static",
      event_type: "session_start",
      t_client: 12,
      elapsed_ms: null,
      level: null,
      element_id: null,
      element_label: null,
      parent_id: null,
      x: null,
      y: null,
      input_type: "mouse",
      meta: {}
    };
    localStorage.setItem("meridian.events.queue.S-06", JSON.stringify([pending]));

    const logger = new EventLogger("P-06", "S-06");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstBatch = bodyOf(fetchMock.mock.calls[0]).events;
    expect(firstBatch.map((event) => event.event_id)).toContain("persisted-1");
    await vi.waitFor(() => expect(storedEvents("meridian.events.queue.S-06")).toHaveLength(0));
    logger.discard();
  });

  it("interrupts an active trial exactly once and records the reason", async () => {
    const logger = new EventLogger("P-07", "S-07");
    logger.beginTrial({ trial_id: "T-7", menu_id: "B" });
    now = 1600;
    logger.interruptTrial("page_unload");
    logger.interruptTrial("page_unload");
    await logger.flush();

    const ends = bodyOf(fetchMock.mock.calls[0]).events.filter((event) => event.event_type === "trial_end");
    expect(ends).toHaveLength(1);
    expect(ends[0]!).toMatchObject({
      trial_id: "T-7",
      menu_id: "B",
      elapsed_ms: 600,
      meta: { interrupted: true, success: false, reason: "page_unload" }
    });
    expect(logger.isTrialActive()).toBe(false);
    logger.discard();
  });

  it("does not interrupt a trial that already finished", async () => {
    const logger = new EventLogger("P-08", "S-08");
    logger.beginTrial({ trial_id: "T-8" });
    logger.finishTrial();
    logger.interruptTrial();
    await logger.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    logger.discard();
  });

  it("attaches console errors and leaves unmeasured fps missing", async () => {
    const logger = new EventLogger("P-09", "S-09");
    logger.beginTrial({ trial_id: "T-9" });
    logger.addConsoleError("boom");
    logger.log({ event_type: "trial_end", meta: { success: true } });
    await logger.flush();

    const end = bodyOf(fetchMock.mock.calls[0]).events[0]!;
    expect(end.meta).toMatchObject({ success: true, console_errors: ["boom"], fps: null });
    logger.discard();
  });

  it("does not reuse frame measurements from a previous trial", () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const logger = new EventLogger("P-fps", "S-fps");
    expect(logger.currentFps()).toBeNull();
    logger.beginTrial({ trial_id: "first" });
    frame(now + 600);
    expect(logger.currentFps()).toBeGreaterThan(0);
    logger.finishTrial();
    logger.beginTrial({ trial_id: "second" });
    expect(logger.currentFps()).toBeNull();
    logger.discard();
  });

  it("sends pending events with sendBeacon on beacon()", async () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, writable: true, value: beacon });
    const logger = new EventLogger("P-10", "S-10");
    logger.log({ event_type: "session_end" });

    logger.beacon();

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]![0]).toBe("/api/events");
    expect(beacon.mock.calls[0]![1]).toBeInstanceOf(Blob);
    expect(fetchMock).not.toHaveBeenCalled();
    logger.discard();
  });

  it("flushes with a beacon when destroyed", async () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, writable: true, value: beacon });
    const logger = new EventLogger("P-11", "S-11");
    logger.log({ event_type: "session_end" });

    logger.destroy();

    expect(beacon).toHaveBeenCalledTimes(1);
    logger.destroy();
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it("clears buffered and persisted events on discard", async () => {
    const logger = new EventLogger("P-12", "S-12");
    fetchMock.mockResolvedValueOnce({ ok: false });
    logger.log({ event_type: "session_start" });
    await logger.flush();
    expect(storedEvents("meridian.events.queue.S-12")).toHaveLength(1);

    logger.discard();

    expect(storedEvents("meridian.events.queue.S-12")).toHaveLength(0);
    await logger.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
