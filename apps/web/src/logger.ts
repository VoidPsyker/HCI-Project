import type { EventInput, EventType, InputType, MenuId, StateLabel } from "@meridian/scoring";

interface LoggerContext {
  block_id: string | null;
  trial_id: string | null;
  task_id: string | null;
  target_id: string | null;
  menu_id: MenuId | null;
  state_label: StateLabel;
  condition: EventInput["condition"];
}

interface PartialEvent {
  event_type: EventType;
  block_id?: string | null;
  trial_id?: string | null;
  task_id?: string | null;
  target_id?: string | null;
  menu_id?: MenuId | null;
  state_label?: StateLabel;
  condition?: EventInput["condition"];
  elapsed_ms?: number | null;
  level?: 0 | 1 | 2 | 3 | null;
  element_id?: string | null;
  element_label?: string | null;
  parent_id?: string | null;
  x?: number | null;
  y?: number | null;
  input_type?: InputType;
  meta?: Record<string, unknown>;
}

const QUEUE_LIMIT = 5000;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export class EventLogger {
  readonly participantId: string;
  readonly sessionId: string;
  private buffer: EventInput[] = [];
  private queue: EventInput[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private context: LoggerContext = {
    block_id: null,
    trial_id: null,
    task_id: null,
    target_id: null,
    menu_id: null,
    state_label: "mixed",
    condition: "static"
  };
  private trialStart: number | null = null;
  private activeTrial = false;
  private frameStart = 0;
  private frameCount = 0;
  private lastFps: number | null = null;
  private rafId: number | null = null;
  private consoleErrors: string[] = [];
  private queueKey: string;

  constructor(participantId: string, sessionId: string) {
    this.participantId = participantId;
    this.sessionId = sessionId;
    this.queueKey = `meridian.events.queue.${sessionId}`;
    this.loadQueue();
    this.timer = setInterval(() => void this.flush(), 500);
    void this.flush();
  }

  private loadQueue(): void {
    try {
      const raw = localStorage.getItem(this.queueKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as EventInput[];
      if (Array.isArray(parsed)) this.queue = parsed.slice(-QUEUE_LIMIT);
    } catch {
      // A corrupt queue is ignored; the current buffer is still sent.
    }
  }

  private saveQueue(): void {
    try {
      if (this.queue.length === 0) localStorage.removeItem(this.queueKey);
      else localStorage.setItem(this.queueKey, JSON.stringify(this.queue.slice(-QUEUE_LIMIT)));
    } catch {
      // Storage may be unavailable in private mode; keep the in-memory queue.
    }
  }

  setContext(patch: Partial<LoggerContext>): void {
    this.context = { ...this.context, ...patch };
  }

  setState(state: StateLabel): void {
    this.context.state_label = state;
  }

  beginTrial(context: Partial<LoggerContext>): void {
    this.context = {
      ...this.context,
      ...context,
      state_label: context.state_label ?? this.context.state_label
    };
    this.trialStart = performance.now();
    this.lastFps = null;
    this.activeTrial = true;
    this.startFrames();
  }

  finishTrial(): void {
    this.stopFrames();
    this.activeTrial = false;
    this.trialStart = null;
  }

  isTrialActive(): boolean {
    return this.activeTrial;
  }

  currentFps(): number | null {
    return this.lastFps;
  }

  addConsoleError(message: string): void {
    this.consoleErrors.push(message.slice(0, 500));
    if (this.consoleErrors.length > 20) this.consoleErrors.shift();
  }

  log(event: PartialEvent): void {
    const now = performance.now();
    const elapsed =
      event.elapsed_ms !== undefined ? event.elapsed_ms : this.trialStart !== null ? Math.round(now - this.trialStart) : null;
    const payload: EventInput = {
      event_id: uuid(),
      participant_id: this.participantId,
      session_id: this.sessionId,
      study: "pilot",
      block_id: event.block_id ?? this.context.block_id,
      trial_id: event.trial_id ?? this.context.trial_id,
      task_id: event.task_id ?? this.context.task_id,
      target_id: event.target_id ?? this.context.target_id,
      menu_id: event.menu_id ?? this.context.menu_id,
      state_label: event.state_label ?? this.context.state_label,
      condition: event.condition ?? this.context.condition,
      event_type: event.event_type,
      t_client: now,
      elapsed_ms: elapsed,
      level: event.level ?? null,
      element_id: event.element_id ?? null,
      element_label: event.element_label ?? null,
      parent_id: event.parent_id ?? null,
      x: event.x ?? null,
      y: event.y ?? null,
      input_type: event.input_type ?? "mouse",
      meta: {
        ...(event.meta ?? {}),
        ...(event.event_type === "trial_end" || event.event_type === "session_end"
          ? { console_errors: [...this.consoleErrors], fps: this.lastFps }
          : {})
      }
    };
    this.buffer.push(payload);
    if (this.buffer.length > 100) void this.flush();
  }

  private startFrames(): void {
    if (this.rafId !== null) return;
    this.frameStart = performance.now();
    this.frameCount = 0;
    const tick = (time: number) => {
      this.frameCount++;
      const elapsed = (time - this.frameStart) / 1000;
      if (elapsed >= 0.5) {
        this.lastFps = Math.round(this.frameCount / elapsed);
        this.frameStart = time;
        this.frameCount = 0;
      }
      if (this.activeTrial) this.rafId = requestAnimationFrame(tick);
      else this.rafId = null;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopFrames(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private async send(events: EventInput[], beacon = false): Promise<boolean> {
    if (events.length === 0) return true;
    if (beacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([JSON.stringify({ events })], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/events", blob);
      if (ok) return true;
    }
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: beacon
    });
    return response.ok;
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.buffer.length === 0 && this.queue.length === 0) return;
    this.flushing = true;
    const pending = [...this.queue, ...this.buffer];
    this.buffer = [];
    this.queue = [];
    try {
      const ok = await this.send(pending);
      if (!ok) {
        this.queue = [...pending, ...this.queue].slice(-QUEUE_LIMIT);
        this.saveQueue();
      } else {
        this.saveQueue();
      }
    } catch {
      this.queue = [...pending, ...this.queue].slice(-QUEUE_LIMIT);
      this.saveQueue();
    } finally {
      this.flushing = false;
    }
  }

  beacon(): void {
    const pending = [...this.queue, ...this.buffer];
    this.buffer = [];
    this.queue = [];
    try {
      const blob = new Blob([JSON.stringify({ events: pending })], { type: "application/json" });
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) navigator.sendBeacon("/api/events", blob);
      else void this.send(pending, true);
    } catch {
      this.queue = pending.slice(-QUEUE_LIMIT);
      this.saveQueue();
    }
  }

  interruptTrial(reason = "page_unload"): void {
    if (!this.activeTrial) return;
    this.log({
      event_type: "trial_end",
      elapsed_ms: this.trialStart !== null ? Math.round(performance.now() - this.trialStart) : null,
      meta: { interrupted: true, success: false, reason }
    });
    this.finishTrial();
  }

  discard(): void {
    this.buffer = [];
    this.queue = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopFrames();
    try {
      localStorage.removeItem(this.queueKey);
    } catch {
      // Storage may be unavailable; the in-memory queues are already cleared.
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopFrames();
    this.beacon();
  }
}
