import { angularDistanceDeg, angularVelocityDegS } from "./geometry";
import type { PointPx } from "./geometry";
import type { GazeSample, ScreenGeometry } from "./types";
import { DEFAULT_IVT_VELOCITY_DEG_S, DEFAULT_MIN_FIXATION_MS } from "./types";

export interface Fixation {
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  centroid_x_px: number;
  centroid_y_px: number;
  sample_count: number;
  mean_velocity_deg_s: number;
}

export type IvtResult =
  | {
      status: "ok";
      threshold_deg_s: number;
      min_fixation_ms: number;
      fixations: Fixation[];
      invalid_segments: number;
    }
  | {
      status: "not_evaluable";
      reason: "screen_geometry_required" | "insufficient_samples";
      threshold_deg_s: number;
      min_fixation_ms: number;
    };

export interface Scanpath {
  px: number;
  deg: number | null;
}

function isUsable(sample: GazeSample): sample is GazeSample & PointPx {
  return sample.valid && sample.x_px !== null && sample.y_px !== null && Number.isFinite(sample.x_px) && Number.isFinite(sample.y_px);
}

/**
 * I-VT with the plan's pre-registered defaults (30°/s, 100 ms minimum).
 * Angular velocity requires measured screen geometry; without it the filter is
 * explicitly not evaluable rather than falling back to pixels.
 */
export function classifyFixations(
  samples: readonly GazeSample[],
  geometry: ScreenGeometry | null,
  options: { velocity_threshold_deg_s?: number; min_fixation_ms?: number } = {}
): IvtResult {
  const threshold = options.velocity_threshold_deg_s ?? DEFAULT_IVT_VELOCITY_DEG_S;
  const minDuration = options.min_fixation_ms ?? DEFAULT_MIN_FIXATION_MS;
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error("ivt_threshold_invalid");
  if (!Number.isFinite(minDuration) || minDuration <= 0) throw new Error("ivt_min_fixation_invalid");
  if (!geometry) return { status: "not_evaluable", reason: "screen_geometry_required", threshold_deg_s: threshold, min_fixation_ms: minDuration };
  if (samples.length < 2) {
    return { status: "not_evaluable", reason: "insufficient_samples", threshold_deg_s: threshold, min_fixation_ms: minDuration };
  }

  const sorted = [...samples].sort((a, b) => a.t_ms - b.t_ms);
  const velocities: Array<number | null> = new Array(sorted.length).fill(null);
  let invalidSegments = 0;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    const dt = next.t_ms - current.t_ms;
    if (!isUsable(current) || !isUsable(next) || dt <= 0) {
      invalidSegments += 1;
      continue;
    }
    const velocity = angularVelocityDegS(current, next, dt, geometry);
    velocities[i] = velocity;
    if (i === sorted.length - 2) velocities[i + 1] = velocity;
  }

  const fixations: Fixation[] = [];
  let runStart = -1;
  const flush = (endExclusive: number): void => {
    if (runStart < 0) return;
    const startIndex = runStart;
    const run = sorted.slice(startIndex, endExclusive);
    runStart = -1;
    if (run.length < 2) return;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const duration = last.t_ms - first.t_ms;
    if (duration < minDuration) return;
    const usable = run.filter(isUsable);
    if (usable.length < 2) return;
    const meanX = usable.reduce((sum, sample) => sum + sample.x_px, 0) / usable.length;
    const meanY = usable.reduce((sum, sample) => sum + sample.y_px, 0) / usable.length;
    const runVelocities = run
      .map((_sample, index) => velocities[startIndex + index] ?? null)
      .filter((velocity): velocity is number => velocity !== null);
    const meanVelocity =
      runVelocities.length > 0 ? runVelocities.reduce((sum, velocity) => sum + velocity, 0) / runVelocities.length : 0;
    fixations.push({
      start_ms: first.t_ms,
      end_ms: last.t_ms,
      duration_ms: duration,
      centroid_x_px: meanX,
      centroid_y_px: meanY,
      sample_count: run.length,
      mean_velocity_deg_s: meanVelocity
    });
  };

  for (let i = 0; i < sorted.length; i += 1) {
    const velocity = velocities[i] ?? null;
    const below = isUsable(sorted[i]!) && velocity !== null && velocity < threshold;
    if (below && runStart < 0) runStart = i;
    if (!below) flush(i);
  }
  flush(sorted.length);

  return { status: "ok", threshold_deg_s: threshold, min_fixation_ms: minDuration, fixations, invalid_segments: invalidSegments };
}

/** Sum of saccade amplitudes between consecutive fixation centroids. */
export function scanpathLength(fixations: readonly Fixation[], geometry: ScreenGeometry | null): Scanpath {
  let px = 0;
  let deg = 0;
  let angularComplete = geometry !== null;
  for (let i = 0; i < fixations.length - 1; i += 1) {
    const a = fixations[i]!;
    const b = fixations[i + 1]!;
    px += Math.hypot(b.centroid_x_px - a.centroid_x_px, b.centroid_y_px - a.centroid_y_px);
    const angle = angularDistanceDeg(
      { x_px: a.centroid_x_px, y_px: a.centroid_y_px },
      { x_px: b.centroid_x_px, y_px: b.centroid_y_px },
      geometry
    );
    if (angle === null) angularComplete = false;
    else deg += angle;
  }
  return { px, deg: angularComplete && geometry !== null ? deg : null };
}

/** Counts adjacent changes between non-null AOI ids; a null gap breaks a run. */
export function countAoiTransitions(sequence: readonly (string | null)[]): number {
  let transitions = 0;
  let previous: string | null = null;
  for (const current of sequence) {
    if (current === null) continue;
    if (previous !== null && current !== previous) transitions += 1;
    previous = current;
  }
  return transitions;
}
