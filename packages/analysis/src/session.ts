import { assertAoi, computeTrialMetrics } from "./aoi";
import type { AoiDefinition, TrialGazeMetrics, TrialWindow } from "./aoi";
import type { CalibrationReport } from "./calibration";
import { assertConsentMatches } from "./consent";
import { buildGazeExport } from "./export";
import type { GazeExportBundle } from "./export";
import { assertGeometryMatchesViewport, assertViewport } from "./geometry";
import { auditGazeQuality } from "./quality";
import type { GazeQualityConfig, GazeQualityReport } from "./quality";
import { DEFAULT_MAX_SESSION_SAMPLES } from "./types";
import type { GazeConsent, GazeSample, GazeSource, ScreenGeometry, Viewport } from "./types";

export interface GazeSessionOptions {
  participant_id: string;
  session_id: string;
  source: GazeSource;
  consent: GazeConsent | null;
  viewport: Viewport;
  geometry: ScreenGeometry | null;
  now?: () => number;
  qualityConfig?: GazeQualityConfig;
  /** Hard cap on retained samples. Defaults to 500,000. */
  max_samples?: number;
  /** Called exactly when a sample is retained, so ingestion mirrors the buffer. */
  on_retained_sample?: (sample: GazeSample) => void;
}

/**
 * Ties an acquisition source to calibration, trial windows, AOIs and export.
 * Starting a non-synthetic source without separate gaze consent is refused.
 * Withdrawal stops the source and destroys the in-memory gaze data.
 */
export class GazeSession {
  readonly participant_id: string;
  readonly session_id: string;
  readonly source: GazeSource;
  readonly consent: GazeConsent | null;
  readonly viewport: Viewport;
  readonly geometry: ScreenGeometry | null;
  private readonly now: () => number;
  private readonly qualityConfig: GazeQualityConfig;
  private readonly maxSamples: number;
  private readonly retainIdleSamples: boolean;
  private readonly onRetainedSample: ((sample: GazeSample) => void) | undefined;
  private readonly samples: GazeSample[] = [];
  private lastSampleSeq = 0;
  private rejectedSamples = 0;
  private droppedSamples = 0;
  private aois: AoiDefinition[] = [];
  private trials: TrialWindow[] = [];
  private metrics = new Map<string, TrialGazeMetrics>();
  private calibration: CalibrationReport | null = null;
  private activeTrial: TrialWindow | null = null;
  private unsubscribe: (() => void) | null = null;
  private starting = false;
  private started = false;
  private stopped = false;
  private withdrawn = false;
  private startGeneration = 0;

  constructor(options: GazeSessionOptions) {
    assertViewport(options.viewport);
    if (options.geometry) assertGeometryMatchesViewport(options.geometry, options.viewport);
    this.participant_id = options.participant_id;
    this.session_id = options.session_id;
    this.source = options.source;
    this.consent = options.consent;
    this.viewport = options.viewport;
    this.geometry = options.geometry;
    this.now = options.now ?? (() => performance.now());
    this.qualityConfig = options.qualityConfig ?? {};
    this.maxSamples = options.max_samples ?? DEFAULT_MAX_SESSION_SAMPLES;
    if (!Number.isInteger(this.maxSamples) || this.maxSamples <= 0) throw new Error("gaze_max_samples_invalid");
    this.retainIdleSamples = options.source.info.synthetic;
    this.onRetainedSample = options.on_retained_sample;
  }

  async start(): Promise<void> {
    if (this.withdrawn) throw new Error("gaze_session_withdrawn");
    if (this.started || this.starting) throw new Error("gaze_session_already_started");
    if (!this.source.info.synthetic) {
      assertConsentMatches(this.consent, this.participant_id, this.session_id);
    }
    this.starting = true;
    const gen = ++this.startGeneration;
    this.unsubscribe = this.source.subscribe((sample) => this.onSample(sample));
    try {
      await this.source.start(this.consent);
      if (this.withdrawn || this.stopped || gen !== this.startGeneration) {
        await this.source.stop().catch(() => undefined);
        this.unsubscribe?.();
        this.unsubscribe = null;
        return;
      }
      this.started = true;
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private onSample(sample: GazeSample): void {
    if (!Number.isInteger(sample.seq) || sample.seq <= 0 || sample.seq <= this.lastSampleSeq || !Number.isFinite(sample.t_ms)) {
      this.rejectedSamples += 1;
      return;
    }
    this.lastSampleSeq = sample.seq;
    if (!this.retainIdleSamples && !this.activeTrial) return;

    let x = sample.x_px;
    let y = sample.y_px;
    let valid = sample.valid;
    let invalidReason = sample.invalid_reason;
    if (valid) {
      const finiteX = x !== null && Number.isFinite(x);
      const finiteY = y !== null && Number.isFinite(y);
      if (!finiteX || !finiteY) {
        valid = false;
        invalidReason = x === null || y === null ? "no_prediction" : "non_finite";
      }
    }
    if (this.samples.length >= this.maxSamples) {
      this.droppedSamples += 1;
      return;
    }
    const retained: GazeSample = {
      seq: sample.seq,
      t_ms: sample.t_ms,
      t_source_ms: sample.t_source_ms,
      x_px: x,
      y_px: y,
      valid,
      ...(invalidReason ? { invalid_reason: invalidReason } : {}),
      ...(sample.pupil_left_mm === undefined ? {} : { pupil_left_mm: sample.pupil_left_mm }),
      ...(sample.pupil_right_mm === undefined ? {} : { pupil_right_mm: sample.pupil_right_mm }),
      trial_id: this.activeTrial?.trial_id ?? null
    };
    this.samples.push(retained);
    this.onRetainedSample?.(retained);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.startGeneration++;
    try {
      await this.source.stop();
    } finally {
      this.started = false;
      this.starting = false;
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  /** Participant refusal/withdrawal: stop acquisition and delete in-memory data. */
  async withdraw(): Promise<void> {
    this.withdrawn = true;
    this.startGeneration++;
    try {
      await this.stop();
    } finally {
      this.samples.length = 0;
      this.lastSampleSeq = 0;
      this.rejectedSamples = 0;
      this.droppedSamples = 0;
      this.aois = [];
      this.trials = [];
      this.metrics.clear();
      this.calibration = null;
      this.activeTrial = null;
    }
  }

  setAois(aois: readonly AoiDefinition[]): void {
    for (const aoi of aois) assertAoi(aoi);
    this.aois = [...aois];
  }

  addAoi(aoi: AoiDefinition): void {
    assertAoi(aoi);
    this.aois.push(aoi);
  }

  setCalibration(report: CalibrationReport): void {
    this.calibration = report;
  }

  startTrial(input: { trial_id: string; menu_id: string; target_aoi_id?: string | null; start_ms?: number }): TrialWindow {
    if (this.withdrawn) throw new Error("gaze_session_withdrawn");
    if (this.activeTrial) throw new Error("gaze_trial_already_active");
    if (this.trials.some((trial) => trial.trial_id === input.trial_id)) throw new Error("gaze_trial_id_duplicate");
    const startMs = input.start_ms ?? this.now();
    if (!Number.isFinite(startMs)) throw new Error("gaze_trial_start_invalid");
    const previous = this.trials[this.trials.length - 1];
    if (previous && startMs < previous.end_ms) throw new Error("gaze_trial_overlap");
    const trial: TrialWindow = {
      trial_id: input.trial_id,
      menu_id: input.menu_id,
      start_ms: startMs,
      end_ms: startMs,
      target_aoi_id: input.target_aoi_id ?? null
    };
    this.trials.push(trial);
    this.activeTrial = trial;
    return trial;
  }

  /**
   * Late-binds the target AOI when a menu expansion reveals the target after
   * the trial began. Only the active trial may be updated; metrics are computed
   * at endTrial, so the final target is used.
   */
  setTrialTargetAoi(trialId: string, aoiId: string | null): void {
    if (!this.activeTrial || this.activeTrial.trial_id !== trialId) throw new Error("gaze_trial_not_active");
    if (aoiId !== null && !aoiId.trim()) throw new Error("gaze_target_aoi_id_required");
    this.activeTrial.target_aoi_id = aoiId;
  }

  endTrial(input: { trial_id: string; end_ms?: number; maxGapMs?: number }): TrialGazeMetrics {
    const active = this.activeTrial;
    if (!active || active.trial_id !== input.trial_id) throw new Error("gaze_trial_not_active");
    const endMs = input.end_ms ?? this.now();
    if (!Number.isFinite(endMs) || endMs < active.start_ms) throw new Error("gaze_trial_end_invalid");
    const closed: TrialWindow = { ...active, end_ms: endMs };
    const index = this.trials.findIndex((trial) => trial.trial_id === active.trial_id);
    if (index >= 0) this.trials[index] = closed;
    const metrics = computeTrialMetrics(closed, this.samples, this.aois, this.geometry, {
      ...(input.maxGapMs === undefined ? {} : { maxGapMs: input.maxGapMs }),
      maxMissingPct: this.qualityConfig.max_missing_pct
    });
    this.metrics.set(closed.trial_id, metrics);
    this.activeTrial = null;
    return metrics;
  }

  getSamples(): readonly GazeSample[] {
    return this.samples;
  }

  getRejectedSampleCount(): number {
    return this.rejectedSamples;
  }

  getDroppedSampleCount(): number {
    return this.droppedSamples;
  }

  getTrials(): readonly TrialWindow[] {
    return this.trials;
  }

  getMetrics(): readonly TrialGazeMetrics[] {
    return [...this.metrics.values()];
  }

  getCalibration(): CalibrationReport | null {
    return this.calibration;
  }

  getQuality(): GazeQualityReport {
    if (this.withdrawn) throw new Error("gaze_session_withdrawn");
    return auditGazeQuality(
      {
        source: this.source.info,
        consent: this.consent,
        participant_id: this.participant_id,
        session_id: this.session_id,
        samples: this.samples,
        calibration: this.calibration,
        geometry: this.geometry,
        viewport: this.viewport,
        clock: this.source.clock,
        rejected_samples: this.rejectedSamples,
        dropped_samples: this.droppedSamples,
        trials: this.trials
      },
      this.qualityConfig
    );
  }

  buildExport(createdAt?: string): GazeExportBundle {
    if (this.withdrawn) throw new Error("gaze_session_withdrawn");
    if (this.activeTrial) throw new Error("gaze_trial_active");
    const quality = this.getQuality();
    return buildGazeExport({
      participant_id: this.participant_id,
      session_id: this.session_id,
      ...(createdAt === undefined ? {} : { created_at: createdAt }),
      source: this.source.info,
      consent: this.consent,
      samples: this.samples,
      calibration: this.calibration,
      geometry: this.geometry,
      viewport: this.viewport,
      clock: this.source.clock,
      metrics: [...this.metrics.values()],
      quality,
      rejected_samples: this.rejectedSamples,
      dropped_samples: this.droppedSamples,
      max_samples: this.maxSamples
    });
  }
}
