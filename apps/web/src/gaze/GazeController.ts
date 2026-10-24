import {
  GazeSession,
  ninePointTargets,
  summarizeCalibration,
  type AoiDefinition,
  type CalibrationObservation,
  type CalibrationReport,
  type CalibrationTarget,
  type GazeConsent,
  type GazeQualityReport,
  type GazeSample,
  type GazeSource,
  type ScreenGeometry,
  type TrialGazeMetrics,
  type Viewport
} from "@meridian/analysis";
import { NODE_BY_ID } from "@meridian/taxonomy";
import type { GazeApi, GazeCompleteResponse } from "./gazeClient";
import { GazeUploader as Uploader } from "./gazeClient";

export interface CalibrationCapableSource extends GazeSource {
  recordCalibrationTarget?(target: CalibrationTarget): Promise<void>;
  setCalibrationFeedback?(enabled: boolean): void;
}

export interface GazeTrialStart {
  trial_id: string;
  menu_id: string;
  target_product_id: string;
}

export interface GazeTrialHandle {
  beginTrial(input: GazeTrialStart): Promise<{ start_ms: number }>;
  endTrial(input: { trial_id: string; end_ms: number }): void;
  endActiveTrial?(): void;
  captureAois(root: HTMLElement, at_ms: number): void;
}

export type GazeControllerStatus =
  | "idle"
  | "starting"
  | "ready"
  | "calibrating"
  | "calibrated"
  | "failed"
  | "trials"
  | "paused"
  | "stopping"
  | "stopped"
  | "completed"
  | "withdrawn";

export interface GazeControllerOptions {
  participant_id: string;
  session_id: string;
  consent: GazeConsent;
  viewport: Viewport;
  geometry: ScreenGeometry;
  source: CalibrationCapableSource;
  api: GazeApi;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  viewportNow?: () => Viewport;
  criterionDeg?: number;
  settleMs?: number;
  dwellMs?: number;
  batchSize?: number;
  maxQueue?: number;
  maxSamples?: number;
  autoFlushMs?: number | null;
  onStatus?: (status: GazeControllerStatus) => void;
  onError?: (message: string | null) => void;
}

interface ActiveTrial {
  trialId: string;
  menuId: string;
  targetProductId: string;
}

interface CandidateAoi {
  key: string;
  label: string;
  role: AoiDefinition["role"];
  rect: AoiDefinition["rect"];
  menu_id: string | null;
  level: 0 | 1 | 2 | 3 | null;
  z: number;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null);
}

function visible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.closest('[data-testid="session-bar"], [role="dialog"], [data-testid="trial-intro"]')) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 && Number.isFinite(rect.x) && Number.isFinite(rect.y);
}

/**
 * Participant-side gaze orchestration: server consent first, then camera,
 * calibration/held-out validation, trial windows and AOI snapshots, bounded
 * ingestion, and a restricted completion bundle. The calibration gate is
 * checked here and again on the server; a failed gate never reaches trials.
 */
export class GazeController implements GazeTrialHandle {
  readonly targets: CalibrationTarget[];
  private readonly options: GazeControllerOptions;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly viewportNow: () => Viewport;
  private readonly source: CalibrationCapableSource;
  private readonly api: GazeApi;
  private readonly targetsForViewport: CalibrationTarget[];
  private session: GazeSession | null = null;
  private uploader: Uploader | null = null;
  private token: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private observations: CalibrationObservation[] = [];
  private calibrationReport: CalibrationReport | null = null;
  private collecting: { targetId: string; samples: Array<{ x_px: number; y_px: number }> } | null = null;
  private active: ActiveTrial | null = null;
  private aois: AoiDefinition[] = [];
  private snapshotIndex = 0;
  private lastSignature: string | null = null;
  private completion: GazeCompleteResponse | null = null;
  private state: GazeControllerStatus = "idle";
  private generation = 0;
  private trainedTargets = new Set<string>();
  private validationStarted = false;
  private viewportInvalidated = false;
  private unwatchViewport: (() => void) | null = null;

  constructor(options: GazeControllerOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.wait = options.wait ?? defaultWait;
    this.viewportNow =
      options.viewportNow ??
      (() => ({ width_px: window.innerWidth, height_px: window.innerHeight }));
    this.source = options.source;
    this.api = options.api;
    this.targetsForViewport = ninePointTargets(options.viewport);
    this.targets = this.targetsForViewport;
  }

  get status(): GazeControllerStatus {
    return this.state;
  }

  get sourceInfo() {
    return this.source.info;
  }

  get clock() {
    return this.source.clock;
  }

  get report(): CalibrationReport | null {
    return this.calibrationReport;
  }

  get calibrationGatePassed(): boolean {
    return ["calibrated", "ready", "trials", "paused"].includes(this.state) &&
      this.calibrationReport?.passes === true && this.calibrationReport.angular_available === true;
  }

  get pendingUploads(): number {
    return this.uploader?.pendingCount ?? 0;
  }

  get uploadError(): string | null {
    return this.uploader?.error ?? null;
  }

  private setStatus(status: GazeControllerStatus): void {
    this.state = status;
    this.options.onStatus?.(status);
  }

  private isInterrupted(gen: number): boolean {
    return (
      this.generation !== gen ||
      this.state === "stopping" ||
      this.state === "stopped" ||
      this.state === "withdrawn"
    );
  }

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "failed") throw new Error("gaze_controller_already_started");
    this.setStatus("starting");
    this.watchViewport();
    const currentGen = ++this.generation;
    try {
      this.assertViewport();
      const token = this.token ?? (await this.api.consent({
        session_id: this.options.session_id,
        version: this.options.consent.version,
        camera_used: this.options.consent.camera_used,
        synthetic: this.source.info.synthetic,
        viewport: this.options.viewport,
        geometry: this.options.geometry,
        source: this.source.info
      })).token;
      if (this.isInterrupted(currentGen)) {
        return;
      }
      this.token = token;
      this.uploader = new Uploader({
        sessionId: this.options.session_id,
        token,
        postBatch: (sessionId, token, batch) => this.api.batch(sessionId, token, batch),
        ...(this.options.batchSize === undefined ? {} : { batchSize: this.options.batchSize }),
        ...(this.options.maxQueue === undefined ? {} : { maxQueue: this.options.maxQueue }),
        ...(this.options.autoFlushMs === undefined ? {} : { autoFlushMs: this.options.autoFlushMs }),
        wait: this.wait,
        onError: this.options.onError
      });
      this.session = new GazeSession({
        participant_id: this.options.participant_id,
        session_id: this.options.session_id,
        source: this.source,
        consent: this.options.consent,
        viewport: this.options.viewport,
        geometry: this.options.geometry,
        now: this.now,
        ...(this.options.maxSamples === undefined ? {} : { max_samples: this.options.maxSamples }),
        on_retained_sample: (sample) => {
          this.uploader?.push(sample);
        }
      });
      this.unsubscribe = this.source.subscribe((sample) => this.onSample(sample));
      if (this.isInterrupted(currentGen)) {
        this.unsubscribe();
        this.unsubscribe = null;
        this.uploader.stop();
        return;
      }
      await this.session.start();
      if (this.isInterrupted(currentGen)) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.uploader?.stop();
        try {
          if (this.status === "withdrawn") {
            await this.session.withdraw();
          } else {
            await this.session.stop();
          }
        } catch {
          // Camera teardown is best effort.
        }
        return;
      }
      try {
        this.assertViewport();
      } catch (viewportError) {
        this.viewportInvalidated = true;
        throw viewportError;
      }
      this.setStatus("ready");
    } catch (error) {
      this.unwatchViewport?.();
      this.unwatchViewport = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.uploader?.stop();
      try {
        await this.session?.stop();
      } catch {
        // Camera teardown is best effort when startup already failed.
      }
      if (this.isInterrupted(currentGen)) {
        return;
      }
      this.setStatus("failed");
      throw error;
    }
  }

  private onSample(sample: GazeSample): void {
    if (!this.collecting) return;
    if (!sample.valid || sample.x_px === null || sample.y_px === null) return;
    if (!Number.isFinite(sample.x_px) || !Number.isFinite(sample.y_px)) return;
    this.collecting.samples.push({ x_px: sample.x_px, y_px: sample.y_px });
  }

  beginCalibration(): CalibrationTarget[] {
    if (!this.session) throw new Error("gaze_controller_not_started");
    if (this.isInterrupted(this.generation) || this.source.status !== "running") throw new Error("gaze_controller_not_ready");
    this.observations = [];
    this.calibrationReport = null;
    this.trainedTargets.clear();
    this.validationStarted = false;
    this.setStatus("calibrating");
    return this.targetsForViewport;
  }

  /**
   * Pass 1: Trains one target point when the source supports explicit training.
   * Does NOT collect validation observations.
   */
  async trainCalibrationTarget(target: CalibrationTarget): Promise<void> {
    if (!this.session) throw new Error("gaze_controller_not_started");
    if (this.state !== "calibrating" || this.validationStarted) throw new Error("gaze_training_closed");
    this.assertCalibrationTarget(target);
    const gen = this.generation;
    if (this.source.recordCalibrationTarget) await this.source.recordCalibrationTarget(target);
    if (this.isInterrupted(gen)) throw new Error("gaze_calibration_interrupted");
    this.trainedTargets.add(target.id);
  }

  private assertCalibrationTarget(target: CalibrationTarget): void {
    const known = this.targetsForViewport.find((point) => point.id === target.id);
    if (!known || known.x_px !== target.x_px || known.y_px !== target.y_px || known.order !== target.order) {
      throw new Error("gaze_calibration_target_invalid");
    }
  }

  /**
   * Pass 2: Held-out validation of the final model for one target point.
   * ZERO training calls are made during validation. Collects predictions during
   * dwellMs after settleMs and uses the median prediction as the observation.
   */
  async validateCalibrationTarget(target: CalibrationTarget): Promise<number> {
    if (!this.session) throw new Error("gaze_controller_not_started");
    if (this.state !== "calibrating") throw new Error("gaze_calibration_not_active");
    if (this.trainedTargets.size !== this.targetsForViewport.length) throw new Error("gaze_training_incomplete");
    this.assertCalibrationTarget(target);
    this.validationStarted = true;
    const gen = this.generation;
    await this.wait(this.options.settleMs ?? 250);
    if (this.isInterrupted(gen)) return 0;
    const collected = { targetId: target.id, samples: [] as Array<{ x_px: number; y_px: number }> };
    this.collecting = collected;
    try {
      await this.wait(this.options.dwellMs ?? 600);
    } finally {
      if (this.collecting === collected) this.collecting = null;
    }
    if (this.isInterrupted(gen)) return 0;
    const x = median(collected.samples.map((sample) => sample.x_px));
    const y = median(collected.samples.map((sample) => sample.y_px));
    if (x !== null && y !== null) {
      this.observations.push({ target_id: target.id, x_px: x, y_px: y, t_ms: this.now() });
    }
    return collected.samples.length;
  }

  finishCalibration(): CalibrationReport {
    if (!this.session) throw new Error("gaze_controller_not_started");
    if (this.state !== "calibrating" || !this.validationStarted) throw new Error("gaze_validation_not_started");
    const report = summarizeCalibration(
      this.targetsForViewport,
      this.observations,
      this.options.geometry,
      this.options.criterionDeg ?? 1.5
    );
    this.calibrationReport = report;
    this.session.setCalibration(report);
    this.setStatus(report.passes === true && report.angular_available ? "calibrated" : "failed");
    return report;
  }

  private assertViewport(): void {
    const current = this.viewportNow();
    if (
      this.viewportInvalidated || current.width_px !== this.options.viewport.width_px ||
      current.height_px !== this.options.viewport.height_px
    ) {
      throw new Error("gaze_viewport_changed");
    }
  }

  private watchViewport(): void {
    if (this.unwatchViewport || typeof window === "undefined") return;
    const target = window;
    target.addEventListener("resize", this.onViewportChange);
    target.document.addEventListener("fullscreenchange", this.onViewportChange);
    this.unwatchViewport = () => {
      target.removeEventListener("resize", this.onViewportChange);
      target.document.removeEventListener("fullscreenchange", this.onViewportChange);
    };
  }

  private onViewportChange = (): void => {
    if (this.viewportInvalidated) return;
    let mismatch = false;
    try {
      this.assertViewport();
    } catch {
      mismatch = true;
    }
    // During startup the source may already have initialized at the old size,
    // so any viewport event is terminal even if the geometry has since returned.
    if (!mismatch && this.state !== "starting") return;
    this.viewportInvalidated = true;
    if (this.calibrationReport) {
      this.calibrationReport = { ...this.calibrationReport, passes: false, angular_available: false, note: "gaze_viewport_changed" };
      this.session?.setCalibration(this.calibrationReport);
    }
    void this.stop().catch(() => undefined);
    this.options.onError?.("gaze_viewport_changed");
  };

  async beginTrial(input: GazeTrialStart): Promise<{ start_ms: number }> {
    if (!this.session || !this.calibrationGatePassed) throw new Error("gaze_calibration_gate_not_passed");
    if (this.active) throw new Error("gaze_trial_already_active");
    this.assertViewport();
    if (this.source.status === "paused") await this.source.resume();
    if (!this.calibrationGatePassed || this.source.status !== "running") throw new Error("gaze_calibration_gate_not_passed");
    const startMs = this.now();
    this.session.startTrial({
      trial_id: input.trial_id,
      menu_id: input.menu_id,
      start_ms: startMs
    });
    this.active = {
      trialId: input.trial_id,
      menuId: input.menu_id,
      targetProductId: input.target_product_id
    };
    this.aois = [];
    this.snapshotIndex = 0;
    this.lastSignature = null;
    this.session.setAois([]);
    this.setStatus("trials");
    return { start_ms: startMs };
  }

  endTrial(input: { trial_id: string; end_ms: number }): void {
    if (!this.session || !this.active || this.active.trialId !== input.trial_id) {
      throw new Error("gaze_trial_not_active");
    }
    const endMs = input.end_ms;
    if (!Number.isFinite(endMs)) throw new Error("gaze_trial_end_invalid");
    this.closeSnapshot(endMs);
    this.session.endTrial({ trial_id: input.trial_id, end_ms: endMs });
    this.active = null;
    this.setStatus("ready");
    void this.uploader?.flush().catch(() => undefined);
  }

  endActiveTrial(): void {
    if (!this.active) return;
    const endMs = this.now();
    try {
      this.closeSnapshot(endMs);
      this.session?.endTrial({ trial_id: this.active.trialId, end_ms: endMs });
    } finally {
      this.active = null;
    }
  }

  private targetAncestors(targetProductId: string): Set<string> {
    const ancestors = new Set<string>();
    let cursor = NODE_BY_ID.get(targetProductId);
    while (cursor) {
      ancestors.add(cursor.id);
      cursor = cursor.parentId ? NODE_BY_ID.get(cursor.parentId) : undefined;
    }
    return ancestors;
  }

  private candidates(targetProductId: string): CandidateAoi[] {
    const ancestors = this.targetAncestors(targetProductId);
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-aoi], [data-node-id]"));
    const result: CandidateAoi[] = [];
    for (const element of elements) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const nodeId = element.dataset.nodeId;
      if (nodeId) {
        const node = NODE_BY_ID.get(nodeId);
        if (!node) continue;
        const level = node.level as 1 | 2 | 3;
        const role: AoiDefinition["role"] =
          level === 3
            ? node.productId === targetProductId
              ? "target_leaf"
              : "other"
            : level === 1 && ancestors.has(node.id)
              ? "target_department"
              : "other";
        result.push({
          key: `node:${node.id}`,
          label: node.label,
          role,
          rect: { x_px: rect.x, y_px: rect.y, width_px: rect.width, height_px: rect.height },
          menu_id: this.active?.menuId ?? null,
          level,
          z: level * 10
        });
        continue;
      }
      const region = element.dataset.aoi;
      if (!region) continue;
      result.push({
        key: `aoi:${region}`,
        label: region === "menu" ? "Menu region" : region,
        role: region === "menu" ? "menu_region" : "other",
        rect: { x_px: rect.x, y_px: rect.y, width_px: rect.width, height_px: rect.height },
        menu_id: this.active?.menuId ?? null,
        level: null,
        z: region === "menu" ? 1 : 2
      });
    }
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }

  private closeSnapshot(atMs: number): void {
    for (const aoi of this.aois) {
      if (aoi.active_to_ms == null) {
        aoi.active_to_ms = Math.max(aoi.active_from_ms ?? 0, atMs - 0.001);
      }
    }
  }

  captureAois(_root: HTMLElement, atMs: number): void {
    if (!this.session || !this.active) return;
    const candidates = this.candidates(this.active.targetProductId);
    if (candidates.length === 0) return;
    const signature = JSON.stringify(
      candidates.map((candidate) => [
        candidate.key,
        Math.round(candidate.rect.x_px * 2) / 2,
        Math.round(candidate.rect.y_px * 2) / 2,
        Math.round(candidate.rect.width_px * 2) / 2,
        Math.round(candidate.rect.height_px * 2) / 2
      ])
    );
    if (signature === this.lastSignature) return;
    this.closeSnapshot(atMs);
    this.snapshotIndex += 1;
    const snapshot = `s${this.snapshotIndex}`;
    const created: AoiDefinition[] = candidates.map((candidate) => ({
      id: `${this.active!.trialId}:${snapshot}:${candidate.key}`,
      label: candidate.label,
      role: candidate.role,
      rect: candidate.rect,
      menu_id: candidate.menu_id,
      level: candidate.level,
      z: candidate.z,
      active_from_ms: atMs + 0.001,
      active_to_ms: null
    }));
    this.aois.push(...created);
    this.session.setAois(this.aois);
    const target = created.find((aoi) => aoi.role === "target_leaf");
    if (target) this.session.setTrialTargetAoi(this.active.trialId, target.id);
    this.lastSignature = signature;
  }

  async pause(): Promise<void> {
    if (!this.active && this.source.status === "running") {
      await this.source.pause();
      this.setStatus("paused");
    }
  }

  async resume(): Promise<void> {
    if (this.source.status === "paused") {
      await this.source.resume();
      this.setStatus("ready");
    }
  }

  getMetrics(): readonly TrialGazeMetrics[] {
    return this.session?.getMetrics() ?? [];
  }

  getQuality(): GazeQualityReport | null {
    return this.session?.getQuality() ?? null;
  }

  async stop(): Promise<void> {
    this.generation++;
    this.unwatchViewport?.();
    this.unwatchViewport = null;
    if (this.state === "stopped" || this.state === "completed" || this.state === "withdrawn") return;
    this.setStatus("stopping");
    this.endActiveTrial();
    try {
      await this.session?.stop();
    } finally {
      try {
        await this.uploader?.flushAll(1, 200);
      } catch {
        // A stopped session may still have unsent data; the debrief reports it.
      }
      this.uploader?.stop();
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.setStatus("stopped");
    }
  }

  async withdraw(): Promise<void> {
    this.generation++;
    this.unwatchViewport?.();
    this.unwatchViewport = null;
    if (this.state === "withdrawn") return;
    this.setStatus("withdrawn");
    this.endActiveTrial();
    try {
      await this.session?.withdraw();
    } finally {
      this.uploader?.clear();
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  flushBeacon(): void {
    this.uploader?.flushKeepalive();
  }

  /**
   * Stops acquisition, drains all pending samples and posts the completion
   * bundle. Refuses to complete if the uploader overflowed or any sample could
   * not be delivered.
   */
  async complete(): Promise<GazeCompleteResponse> {
    if (this.completion) return this.completion;
    if (!this.session || !this.uploader || !this.token) throw new Error("gaze_controller_not_started");
    this.onViewportChange();
    if (this.viewportInvalidated) throw new Error("gaze_viewport_changed");
    this.endActiveTrial();
    await this.session.stop();
    this.unwatchViewport?.();
    this.unwatchViewport = null;
    if (this.uploader.overflowed) throw new Error("gaze_upload_queue_overflow");
    await this.uploader.flushAll(3, 500);
    const quality = this.session.getQuality();
    const response = await this.api.complete(this.options.session_id, this.token, {
      calibration: this.session.getCalibration(),
      quality,
      metrics: this.session.getMetrics(),
      clock: this.source.clock,
      max_samples: this.options.maxSamples ?? 500_000,
      rejected_samples: this.session.getRejectedSampleCount(),
      dropped_samples: this.session.getDroppedSampleCount()
    });
    this.uploader.stop();
    this.completion = response;
    this.setStatus("completed");
    return response;
  }
}
