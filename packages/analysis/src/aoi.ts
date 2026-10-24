import { classifyFixations, countAoiTransitions, scanpathLength } from "./fixations";
import type { Fixation } from "./fixations";
import type { GazeSample, ScreenGeometry } from "./types";
import { DEFAULT_MAX_MISSING_PCT } from "./types";

export type AoiRole = "target_department" | "target_leaf" | "menu_region" | "other";

export interface AoiRect {
  x_px: number;
  y_px: number;
  width_px: number;
  height_px: number;
}

export interface AoiDefinition {
  id: string;
  label: string;
  role: AoiRole;
  rect: AoiRect;
  menu_id?: string | null;
  level?: 0 | 1 | 2 | 3 | null;
  active_from_ms?: number | null;
  active_to_ms?: number | null;
  /** Higher z wins overlap; ties go to the smaller area, then lexical id. */
  z?: number;
}

export interface TrialWindow {
  trial_id: string;
  menu_id: string;
  start_ms: number;
  end_ms: number;
  target_aoi_id?: string | null;
}

export interface AoiAttribution {
  sample_seq: number;
  t_ms: number;
  aoi_ids: string[];
  primary_aoi_id: string | null;
}

export interface AoiDwellMetric {
  aoi_id: string;
  label: string;
  role: AoiRole;
  dwell_ms: number;
  sample_count: number;
  proportion_of_trial: number | null;
}

export interface TrialGazeMetrics {
  trial_id: string;
  menu_id: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  total_samples: number;
  valid_samples: number;
  missing_pct: number | null;
  aoi_dwell: AoiDwellMetric[];
  time_to_first_fixation_ms: number | null;
  fixation_count: number | null;
  mean_fixation_duration_ms: number | null;
  scanpath_px: number | null;
  scanpath_deg: number | null;
  aoi_transitions: number | null;
  quality_notes: string[];
}

function assertRect(rect: AoiRect): void {
  if (![rect.x_px, rect.y_px, rect.width_px, rect.height_px].every(Number.isFinite)) throw new Error("aoi_rect_non_finite");
  if (rect.width_px <= 0 || rect.height_px <= 0) throw new Error("aoi_rect_size_invalid");
}

export function assertAoi(aoi: AoiDefinition): void {
  if (!aoi.id.trim()) throw new Error("aoi_id_required");
  if (!aoi.label.trim()) throw new Error("aoi_label_required");
  assertRect(aoi.rect);
  if (aoi.active_from_ms != null && aoi.active_to_ms != null && aoi.active_to_ms < aoi.active_from_ms) {
    throw new Error("aoi_active_window_invalid");
  }
}

function isActive(aoi: AoiDefinition, tMs: number): boolean {
  if (aoi.active_from_ms != null && tMs < aoi.active_from_ms) return false;
  if (aoi.active_to_ms != null && tMs > aoi.active_to_ms) return false;
  return true;
}

function contains(aoi: AoiDefinition, x: number, y: number): boolean {
  return (
    x >= aoi.rect.x_px &&
    y >= aoi.rect.y_px &&
    x <= aoi.rect.x_px + aoi.rect.width_px &&
    y <= aoi.rect.y_px + aoi.rect.height_px
  );
}

function area(aoi: AoiDefinition): number {
  return aoi.rect.width_px * aoi.rect.height_px;
}

/** Attribute one sample to all active AOIs and choose a deterministic primary. */
export function attributeSample(sample: GazeSample, aois: readonly AoiDefinition[]): AoiAttribution | null {
  if (!sample.valid || sample.x_px === null || sample.y_px === null) return null;
  const x = sample.x_px;
  const y = sample.y_px;
  const matches = aois.filter((aoi) => isActive(aoi, sample.t_ms) && contains(aoi, x, y));
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => {
    const z = (b.z ?? 0) - (a.z ?? 0);
    if (z !== 0) return z;
    const areaDiff = area(a) - area(b);
    if (areaDiff !== 0) return areaDiff;
    return a.id.localeCompare(b.id);
  });
  return {
    sample_seq: sample.seq,
    t_ms: sample.t_ms,
    aoi_ids: matches.map((aoi) => aoi.id).sort((a, b) => a.localeCompare(b)),
    primary_aoi_id: sorted[0]?.id ?? null
  };
}

function fixationTargetTime(
  trial: TrialWindow,
  fixations: readonly Fixation[],
  aoisById: Map<string, AoiDefinition>
): number | null {
  const targetId = trial.target_aoi_id ?? null;
  if (!targetId) return null;
  const target = aoisById.get(targetId);
  if (!target) return null;
  for (const fixation of fixations) {
    if (isActive(target, fixation.start_ms) && contains(target, fixation.centroid_x_px, fixation.centroid_y_px)) {
      return fixation.start_ms - trial.start_ms;
    }
  }
  return null;
}

/**
 * Computes trial-level AOI/gaze metrics. Dwell is integrated from actual
 * sample intervals (the AOI at the interval start is credited); gaps larger
 * than `maxGapMs`, when supplied, are not credited. No angular metric is
 * produced without geometry.
 */
export function computeTrialMetrics(
  trial: TrialWindow,
  samples: readonly GazeSample[],
  aois: readonly AoiDefinition[],
  geometry: ScreenGeometry | null,
  options: { maxGapMs?: number; maxMissingPct?: number } = {}
): TrialGazeMetrics {
  if (!Number.isFinite(trial.start_ms) || !Number.isFinite(trial.end_ms) || trial.end_ms < trial.start_ms) {
    throw new Error("trial_window_invalid");
  }
  const maxMissing = options.maxMissingPct ?? DEFAULT_MAX_MISSING_PCT;
  const inWindow = samples
    .filter((sample) => sample.t_ms >= trial.start_ms && sample.t_ms <= trial.end_ms)
    .sort((a, b) => a.t_ms - b.t_ms);
  const valid = inWindow.filter(
    (sample) => sample.valid && sample.x_px !== null && sample.y_px !== null && Number.isFinite(sample.x_px) && Number.isFinite(sample.y_px)
  );
  const missingPct = inWindow.length === 0 ? null : ((inWindow.length - valid.length) / inWindow.length) * 100;
  const aoisById = new Map(aois.map((aoi) => [aoi.id, aoi]));
  // Keep one attribution per valid sample, including nulls, so the interval
  // loop cannot skip a sample that left every AOI and over-credit dwell time.
  const attributions = valid.map((sample) => attributeSample(sample, aois));

  const dwell = new Map<string, { dwellMs: number; sampleCount: number }>();
  for (const attribution of attributions) {
    const id = attribution?.primary_aoi_id;
    if (!id) continue;
    const current = dwell.get(id) ?? { dwellMs: 0, sampleCount: 0 };
    current.sampleCount += 1;
    dwell.set(id, current);
  }
  for (let i = 0; i < attributions.length - 1; i += 1) {
    const id = attributions[i]?.primary_aoi_id;
    if (!id) continue;
    const dt = valid[i + 1]!.t_ms - valid[i]!.t_ms;
    if (dt <= 0) continue;
    if (options.maxGapMs !== undefined && dt > options.maxGapMs) continue;
    const currentDwell = dwell.get(id);
    if (currentDwell) currentDwell.dwellMs += dt;
  }

  const duration = trial.end_ms - trial.start_ms;
  const aoiDwell: AoiDwellMetric[] = [...dwell.entries()]
    .map(([id, value]) => {
      const aoi = aoisById.get(id);
      return {
        aoi_id: id,
        label: aoi?.label ?? id,
        role: aoi?.role ?? "other",
        dwell_ms: value.dwellMs,
        sample_count: value.sampleCount,
        proportion_of_trial: duration > 0 ? value.dwellMs / duration : null
      };
    })
    .sort((a, b) => b.dwell_ms - a.dwell_ms || a.aoi_id.localeCompare(b.aoi_id));

  const ivt = classifyFixations(valid, geometry);
  const fixations = ivt.status === "ok" ? ivt.fixations : null;
  const scanpath = fixations ? scanpathLength(fixations, geometry) : null;
  const fixationPrimaries = fixations
    ? fixations.map((fixation) => attributeSample({
        seq: -1,
        t_ms: fixation.start_ms,
        t_source_ms: null,
        x_px: fixation.centroid_x_px,
        y_px: fixation.centroid_y_px,
        valid: true
      }, aois)?.primary_aoi_id ?? null)
    : null;
  const notes: string[] = [];
  if (geometry === null) notes.push("screen_geometry_missing_no_angular_metrics");
  if (missingPct !== null && missingPct > maxMissing) notes.push("missing_gaze_over_threshold");
  if (valid.length === 0) notes.push("no_valid_gaze_samples");
  if (fixations && fixations.length === 0) notes.push("no_fixations_detected");

  return {
    trial_id: trial.trial_id,
    menu_id: trial.menu_id,
    start_ms: trial.start_ms,
    end_ms: trial.end_ms,
    duration_ms: duration,
    total_samples: inWindow.length,
    valid_samples: valid.length,
    missing_pct: missingPct,
    aoi_dwell: aoiDwell,
    time_to_first_fixation_ms: fixations ? fixationTargetTime(trial, fixations, aoisById) : null,
    fixation_count: fixations ? fixations.length : null,
    mean_fixation_duration_ms:
      fixations && fixations.length > 0
        ? fixations.reduce((sum, fixation) => sum + fixation.duration_ms, 0) / fixations.length
        : fixations
          ? 0
          : null,
    scanpath_px: scanpath ? scanpath.px : null,
    scanpath_deg: scanpath ? scanpath.deg : null,
    aoi_transitions: fixationPrimaries ? countAoiTransitions(fixationPrimaries) : null,
    quality_notes: notes
  };
}
