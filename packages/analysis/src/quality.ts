import type { TrialWindow } from "./aoi";
import type { CalibrationReport } from "./calibration";
import type { ClockSyncReport } from "./clock";
import { assertConsentMatches } from "./consent";
import { assertGeometryMatchesViewport } from "./geometry";
import type { GazeConsent, GazeSample, GazeSourceInfo, ScreenGeometry, Viewport } from "./types";
import {
  DEFAULT_CALIBRATION_ERROR_DEG,
  DEFAULT_CALIBRATION_POINTS,
  DEFAULT_MAX_MISSING_PCT
} from "./types";

export type QualityStatus = "pass" | "fail" | "not_evaluable" | "info";

export interface QualityCheck {
  id: string;
  label: string;
  status: QualityStatus;
  value: string;
  threshold: string;
  note?: string;
}

export interface GazeQualityConfig {
  max_missing_pct?: number;
  max_calibration_error_deg?: number;
  expected_sample_rate_hz?: number | null;
  minimum_sample_rate_hz?: number | null;
  max_clock_residual_ms?: number | null;
}

export interface GazeQualityReport {
  overall: "pass" | "fail" | "not_evaluable";
  analysis_ready: boolean;
  angular_metrics_ready: boolean;
  sample_count: number;
  valid_sample_count: number;
  missing_pct: number | null;
  effective_sample_rate_hz: number | null;
  median_sample_interval_ms: number | null;
  dropout_count: number;
  dropout_ms: number | null;
  longest_gap_ms: number | null;
  coverage_pct: number | null;
  rejected_samples: number;
  dropped_samples: number;
  thresholds: {
    calibration_points: number;
    calibration_error_deg: number;
    missing_pct: number;
    minimum_sample_rate_hz: number | null;
    max_clock_residual_ms: number | null;
  };
  checks: QualityCheck[];
  exclusions: string[];
}

function numberText(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function countValid(samples: readonly GazeSample[]): number {
  return samples.filter(
    (sample) => sample.valid && sample.x_px !== null && sample.y_px !== null && Number.isFinite(sample.x_px) && Number.isFinite(sample.y_px)
  ).length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? null);
}

/**
 * Applies the plan's pre-registered gates to measured data. The 1.5° gate is
 * evaluated on each participant's held-out calibration error; it is never
 * waived because a device is webcam-based and never inferred from a population
 * mean. Synthetic data can never be analysis-ready.
 */
export function auditGazeQuality(input: {
  source: GazeSourceInfo;
  consent: GazeConsent | null;
  participant_id: string;
  session_id: string;
  samples: readonly GazeSample[];
  calibration: CalibrationReport | null;
  geometry: ScreenGeometry | null;
  viewport: Viewport;
  clock: ClockSyncReport;
  /** Samples refused at the trust boundary; any value above zero fails quality. */
  rejected_samples?: number;
  /** Samples discarded because the bounded session buffer was full. */
  dropped_samples?: number;
  /** Declared trial windows. When provided, coverage is evaluated within trials. */
  trials?: readonly TrialWindow[];
}, config: GazeQualityConfig = {}): GazeQualityReport {
  if (input.geometry) assertGeometryMatchesViewport(input.geometry, input.viewport);
  const maxMissing = config.max_missing_pct ?? DEFAULT_MAX_MISSING_PCT;
  const maxCalibration = config.max_calibration_error_deg ?? DEFAULT_CALIBRATION_ERROR_DEG;
  const expectedPoints = DEFAULT_CALIBRATION_POINTS;
  const samples = input.samples;
  const valid = countValid(samples);
  const missingPct = samples.length === 0 ? null : ((samples.length - valid) / samples.length) * 100;
  const sorted = [...samples].sort((a, b) => a.t_ms - b.t_ms);
  const validSorted = sorted.filter(
    (sample) => sample.valid && sample.x_px !== null && sample.y_px !== null && Number.isFinite(sample.x_px) && Number.isFinite(sample.y_px)
  );
  const validFirst = validSorted[0];
  const validLast = validSorted[validSorted.length - 1];
  const validSpanMs = validFirst && validLast ? validLast.t_ms - validFirst.t_ms : 0;
  const effectiveRate = valid >= 2 && validSpanMs > 0 ? ((valid - 1) / validSpanMs) * 1000 : null;

  const hasTrials = Boolean(input.trials && input.trials.length > 0);
  let spanMs = 0;
  let dropoutCount = 0;
  let dropoutMs = 0;
  let longestGapMs: number | null = null;
  const intervals: number[] = [];

  if (hasTrials) {
    const declaredTrials = input.trials!;
    for (const trial of declaredTrials) {
      const trialSamples = sorted.filter(
        (s) => (s.trial_id ? s.trial_id === trial.trial_id : s.t_ms >= trial.start_ms && s.t_ms <= trial.end_ms)
      );
      for (let index = 1; index < trialSamples.length; index += 1) {
        const dt = trialSamples[index]!.t_ms - trialSamples[index - 1]!.t_ms;
        if (dt > 0) intervals.push(dt);
      }
    }
    const medianInterval = median(intervals);
    let totalSpan = 0;
    for (const trial of declaredTrials) {
      const trialDuration = Math.max(0, trial.end_ms - trial.start_ms);
      totalSpan += trialDuration;
      const trialSamples = sorted.filter(
        (s) => (s.trial_id ? s.trial_id === trial.trial_id : s.t_ms >= trial.start_ms && s.t_ms <= trial.end_ms)
      );
      if (trialSamples.length === 0) {
        if (trialDuration > 0) {
          dropoutCount += 1;
          dropoutMs += trialDuration;
          longestGapMs = longestGapMs === null ? trialDuration : Math.max(longestGapMs, trialDuration);
        }
        continue;
      }
      const leadingGap = trialSamples[0]!.t_ms - trial.start_ms;
      if (leadingGap > 0) {
        longestGapMs = longestGapMs === null ? leadingGap : Math.max(longestGapMs, leadingGap);
        if (medianInterval !== null && leadingGap > medianInterval * 1.5) {
          dropoutCount += 1;
          dropoutMs += leadingGap - medianInterval;
        }
      }
      for (let index = 1; index < trialSamples.length; index += 1) {
        const dt = trialSamples[index]!.t_ms - trialSamples[index - 1]!.t_ms;
        longestGapMs = longestGapMs === null ? dt : Math.max(longestGapMs, dt);
        if (medianInterval !== null && dt > medianInterval * 1.5) {
          dropoutCount += 1;
          dropoutMs += dt - medianInterval;
        }
      }
      const trailingGap = trial.end_ms - trialSamples[trialSamples.length - 1]!.t_ms;
      if (trailingGap > 0) {
        longestGapMs = longestGapMs === null ? trailingGap : Math.max(longestGapMs, trailingGap);
        if (medianInterval !== null && trailingGap > medianInterval * 1.5) {
          dropoutCount += 1;
          dropoutMs += trailingGap - medianInterval;
        }
      }
    }
    spanMs = totalSpan;
  } else {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    spanMs = first && last ? last.t_ms - first.t_ms : 0;
    for (let index = 1; index < sorted.length; index += 1) {
      const dt = sorted[index]!.t_ms - sorted[index - 1]!.t_ms;
      if (dt > 0) intervals.push(dt);
    }
    const medianInterval = median(intervals);
    if (medianInterval !== null) {
      for (const dt of intervals) {
        longestGapMs = longestGapMs === null ? dt : Math.max(longestGapMs, dt);
        if (dt > medianInterval * 1.5) {
          dropoutCount += 1;
          dropoutMs += dt - medianInterval;
        }
      }
    }
  }

  const medianInterval = median(intervals);
  const coveragePct =
    medianInterval !== null && spanMs > 0
      ? Math.max(0, 100 * (1 - dropoutMs / spanMs))
      : null;
  const checks: QualityCheck[] = [];
  const exclusions: string[] = [];

  const calibrationPoints = input.calibration?.target_count ?? 0;
  const allCalibrationPointsObserved = input.calibration
    ? input.calibration.points.length === expectedPoints && input.calibration.points.every((point) => point.observation_count > 0)
    : false;
  checks.push({
    id: "calibration_points",
    label: "9-point calibration completed",
    status: allCalibrationPointsObserved ? "pass" : "fail",
    value: `${calibrationPoints} points`,
    threshold: `${expectedPoints} points with at least one observation`,
    ...(allCalibrationPointsObserved ? {} : { note: "A missing calibration point fails the plan's calibration procedure." })
  });
  if (!allCalibrationPointsObserved) exclusions.push("calibration_points_incomplete");

  const calibrationError = input.calibration?.max_error_deg ?? null;
  const calibrationStatus: QualityStatus =
    calibrationError === null ? "not_evaluable" : calibrationError <= maxCalibration ? "pass" : "fail";
  checks.push({
    id: "calibration_error_deg",
    label: "Held-out calibration error",
    status: calibrationStatus,
    value: `${numberText(calibrationError, 2)}° max`,
    threshold: `≤ ${maxCalibration.toFixed(2)}°`,
    ...(calibrationStatus === "not_evaluable"
      ? { note: "Angular error needs measured screen width/height and viewing distance." }
      : {})
  });
  if (calibrationStatus === "fail") exclusions.push(`calibration_error_gt_${maxCalibration}`);
  if (calibrationStatus === "not_evaluable") exclusions.push("calibration_error_not_evaluable");

  const unknownObservations = input.calibration?.unknown_observations ?? 0;
  const unknownStatus: QualityStatus =
    input.calibration === null ? "not_evaluable" : unknownObservations === 0 ? "pass" : "fail";
  checks.push({
    id: "calibration_unknown_observations",
    label: "Calibration observations matched to targets",
    status: unknownStatus,
    value: `${unknownObservations}`,
    threshold: "0 observations with an unknown target_id",
    ...(unknownStatus === "fail"
      ? { note: "An unknown target id means validation samples were not attributable and cannot be trusted." }
      : {})
  });
  if (unknownStatus === "fail") exclusions.push("calibration_unknown_observations");
  if (unknownStatus === "not_evaluable") exclusions.push("calibration_unknown_observations_not_evaluable");

  const missingStatus: QualityStatus =
    missingPct === null ? "not_evaluable" : missingPct <= maxMissing ? "pass" : "fail";
  checks.push({
    id: "missing_gaze_pct",
    label: "Missing gaze samples",
    status: missingStatus,
    value: `${numberText(missingPct, 1)}%`,
    threshold: `≤ ${maxMissing.toFixed(1)}%`
  });
  if (missingStatus === "fail") exclusions.push(`missing_gaze_gt_${maxMissing}`);

  const minimumCoverage = 100 - maxMissing;
  const coverageStatus: QualityStatus =
    coveragePct === null ? "not_evaluable" : coveragePct >= minimumCoverage ? "pass" : "fail";
  checks.push({
    id: "sample_coverage_pct",
    label: "Received-sample coverage",
    status: coverageStatus,
    value: `${numberText(coveragePct, 1)}%`,
    threshold: `≥ ${minimumCoverage.toFixed(1)}% of the received time span`,
    note:
      "Coverage subtracts gaps longer than 1.5× the median interval, so a source that stops delivering callbacks cannot pass as zero missing."
  });
  if (coverageStatus === "fail") exclusions.push(`sample_coverage_lt_${minimumCoverage}`);
  if (coverageStatus === "not_evaluable") exclusions.push("sample_coverage_not_evaluable");

  const rateThreshold = config.minimum_sample_rate_hz ?? null;
  const rateStatus: QualityStatus =
    effectiveRate === null
      ? rateThreshold === null
        ? "info"
        : "not_evaluable"
      : rateThreshold === null
        ? "info"
        : effectiveRate >= rateThreshold
          ? "pass"
          : "fail";
  checks.push({
    id: "effective_sample_rate_hz",
    label: "Effective sample rate",
    status: rateStatus,
    value: `${numberText(effectiveRate, 1)} Hz`,
    threshold: rateThreshold === null ? "reported, no threshold configured" : `≥ ${rateThreshold.toFixed(1)} Hz`,
    note:
      rateThreshold === null
        ? "The plan's 120 Hz figure describes a dedicated tracker; a webcam rate is reported as measured, not claimed."
        : undefined
  });
  if (rateStatus === "fail") exclusions.push(`sample_rate_lt_${rateThreshold}`);

  let duplicateTimestamps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]?.t_ms === sorted[i - 1]?.t_ms) duplicateTimestamps += 1;
  }
  checks.push({
    id: "duplicate_timestamps",
    label: "Duplicate capture timestamps",
    status: duplicateTimestamps === 0 ? "pass" : "fail",
    value: `${duplicateTimestamps}`,
    threshold: "0"
  });
  if (duplicateTimestamps > 0) exclusions.push("duplicate_timestamps");

  let outOfBounds = 0;
  for (const sample of samples) {
    if (!sample.valid || sample.x_px === null || sample.y_px === null) continue;
    if (
      sample.x_px < 0 ||
      sample.y_px < 0 ||
      sample.x_px > input.viewport.width_px ||
      sample.y_px > input.viewport.height_px
    ) {
      outOfBounds += 1;
    }
  }
  checks.push({
    id: "out_of_bounds_samples",
    label: "Samples outside the viewport",
    status: outOfBounds === 0 ? "pass" : "fail",
    value: `${outOfBounds}`,
    threshold: "0"
  });
  if (outOfBounds > 0) exclusions.push("out_of_bounds_samples");

  const rejectedSamples = input.rejected_samples ?? 0;
  const droppedSamples = input.dropped_samples ?? 0;
  const trustStatus: QualityStatus = rejectedSamples > 0 || droppedSamples > 0 ? "fail" : "pass";
  checks.push({
    id: "sample_trust_boundary",
    label: "Sample trust boundary",
    status: trustStatus,
    value: `${rejectedSamples} rejected, ${droppedSamples} dropped`,
    threshold: "0 rejected or capacity-dropped samples",
    note: "Samples with non-monotonic sequence/time or malformed coordinates are rejected at the session boundary."
  });
  if (rejectedSamples > 0) exclusions.push("sample_trust_boundary_rejected");
  if (droppedSamples > 0) exclusions.push("sample_retention_overflow");

  checks.push({
    id: "longest_gap_ms",
    label: "Longest gap between received samples",
    status: "info",
    value: `${numberText(longestGapMs, 0)} ms`,
    threshold: "reported with dropout estimate and coverage",
    note: `Median interval ${numberText(medianInterval, 1)} ms; ${dropoutCount} gap(s) above 1.5× median.`
  });

  const pupilAvailable = samples.some((sample) => sample.pupil_left_mm != null || sample.pupil_right_mm != null);
  checks.push({
    id: "pupil_available",
    label: "Pupil signal",
    status: "info",
    value: pupilAvailable ? "present" : "not collected",
    threshold: "optional in plan §11.4"
  });

  const clockThreshold = config.max_clock_residual_ms ?? null;
  const clockStatus: QualityStatus =
    !input.clock.synchronized || input.clock.residual_ms === null
      ? "not_evaluable"
      : clockThreshold !== null && input.clock.residual_ms > clockThreshold
        ? "fail"
        : "pass";
  checks.push({
    id: "clock_sync_residual_ms",
    label: "Clock synchronization residual",
    status: clockStatus,
    value: `${numberText(input.clock.residual_ms, 1)} ms RMS (${input.clock.method}, ${input.clock.pairs} pairs)`,
    threshold: clockThreshold === null ? "device clock mapped; no residual threshold configured" : `≤ ${clockThreshold.toFixed(1)} ms`,
    note: input.clock.note
  });
  if (clockStatus === "fail") exclusions.push("clock_sync_residual");
  if (clockStatus === "not_evaluable") exclusions.push("clock_sync_not_evaluable");

  let consentStatus: QualityStatus;
  let consentValue: string;
  if (input.source.synthetic) {
    consentStatus = "info";
    consentValue = "not applicable (synthetic)";
  } else {
    try {
      assertConsentMatches(input.consent, input.participant_id, input.session_id);
      consentStatus = "pass";
      consentValue = `v${input.consent.version}`;
    } catch {
      consentStatus = "fail";
      consentValue = "missing or invalid";
    }
  }
  checks.push({
    id: "separate_gaze_consent",
    label: "Separate gaze consent",
    status: consentStatus,
    value: consentValue,
    threshold: "separate consent, eye-tracking scope, raw video retention false"
  });
  if (consentStatus === "fail") exclusions.push("gaze_consent_invalid");

  checks.push({
    id: "raw_video_retention",
    label: "Raw video retention",
    status: input.source.synthetic ? "info" : input.consent?.raw_video_retention === false ? "pass" : "fail",
    value: input.source.synthetic ? "synthetic" : input.consent?.raw_video_retention === false ? "false" : "unknown",
    threshold: "false"
  });
  if (!input.source.synthetic && input.consent?.raw_video_retention !== false) exclusions.push("raw_video_retention_not_false");

  checks.push({
    id: "synthetic_provenance",
    label: "Data provenance",
    status: input.source.synthetic ? "not_evaluable" : "pass",
    value: input.source.synthetic ? "synthetic replay" : "human participant",
    threshold: "synthetic data is test-only and never analysed as human data",
    note: input.source.synthetic ? "This recording is synthetic; do not report it as participant data." : undefined
  });
  if (input.source.synthetic) exclusions.push("synthetic_source_test_only");

  const requiredIds = new Set([
    "calibration_points",
    "calibration_error_deg",
    "calibration_unknown_observations",
    "missing_gaze_pct",
    "sample_coverage_pct",
    "sample_trust_boundary",
    "separate_gaze_consent",
    "raw_video_retention",
    "clock_sync_residual_ms",
    "effective_sample_rate_hz",
    "duplicate_timestamps",
    "out_of_bounds_samples"
  ]);
  const required = checks.filter((check) => requiredIds.has(check.id));
  const requiredOverall: GazeQualityReport["overall"] = required.some((check) => check.status === "fail")
    ? "fail"
    : required.some((check) => check.status === "not_evaluable")
      ? "not_evaluable"
      : "pass";
  const overall: GazeQualityReport["overall"] = input.source.synthetic && requiredOverall !== "fail" ? "not_evaluable" : requiredOverall;

  return {
    overall,
    analysis_ready: overall === "pass" && !input.source.synthetic,
    angular_metrics_ready:
      !input.source.synthetic &&
      input.geometry !== null &&
      input.calibration !== null &&
      input.calibration.max_error_deg !== null,
    sample_count: samples.length,
    valid_sample_count: valid,
    missing_pct: missingPct,
    effective_sample_rate_hz: effectiveRate,
    median_sample_interval_ms: medianInterval,
    dropout_count: dropoutCount,
    dropout_ms: medianInterval === null ? null : dropoutMs,
    longest_gap_ms: longestGapMs,
    coverage_pct: coveragePct,
    rejected_samples: rejectedSamples,
    dropped_samples: droppedSamples,
    thresholds: {
      calibration_points: expectedPoints,
      calibration_error_deg: maxCalibration,
      missing_pct: maxMissing,
      minimum_sample_rate_hz: config.minimum_sample_rate_hz ?? null,
      max_clock_residual_ms: config.max_clock_residual_ms ?? null
    },
    checks,
    exclusions
  };
}
