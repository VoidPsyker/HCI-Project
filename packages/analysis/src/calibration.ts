import { angularDistanceDeg } from "./geometry";
import type { PointPx } from "./geometry";
import type { ScreenGeometry, Viewport } from "./types";
import { DEFAULT_CALIBRATION_ERROR_DEG, DEFAULT_CALIBRATION_POINTS } from "./types";

export interface CalibrationTarget {
  id: string;
  order: number;
  x_px: number;
  y_px: number;
}

export interface CalibrationObservation extends PointPx {
  target_id: string;
  t_ms?: number;
}

export interface CalibrationPointReport {
  target: CalibrationTarget;
  observation_count: number;
  mean_x_px: number | null;
  mean_y_px: number | null;
  mean_error_px: number | null;
  max_error_px: number | null;
  mean_error_deg: number | null;
  max_error_deg: number | null;
}

export interface CalibrationReport {
  target_count: number;
  expected_target_count: number;
  repetitions_per_target: number | null;
  unknown_observations: number;
  points: CalibrationPointReport[];
  mean_error_px: number | null;
  max_error_px: number | null;
  mean_error_deg: number | null;
  max_error_deg: number | null;
  angular_available: boolean;
  criterion_deg: number;
  passes: boolean | null;
  note: string;
}

/** Standard 9-point grid at 10%, 50% and 90% of each axis. */
export function ninePointTargets(viewport: Viewport, marginFraction = 0.1): CalibrationTarget[] {
  if (!Number.isFinite(viewport.width_px) || viewport.width_px <= 0) throw new Error("viewport_width_invalid");
  if (!Number.isFinite(viewport.height_px) || viewport.height_px <= 0) throw new Error("viewport_height_invalid");
  if (!Number.isFinite(marginFraction) || marginFraction < 0 || marginFraction >= 0.5) {
    throw new Error("calibration_margin_invalid");
  }
  const xs = [marginFraction, 0.5, 1 - marginFraction].map((fraction) => fraction * viewport.width_px);
  const ys = [marginFraction, 0.5, 1 - marginFraction].map((fraction) => fraction * viewport.height_px);
  const targets: CalibrationTarget[] = [];
  let order = 0;
  for (const y of ys) {
    for (const x of xs) {
      order += 1;
      targets.push({ id: `p${order}`, order, x_px: x, y_px: y });
    }
  }
  return targets;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Summarises held-out calibration observations against a 9-point target grid.
 *
 * `passes` is `null` (not evaluable) when screen geometry is missing, because
 * the plan's 1.5° gate is angular. It is never inferred from device model or
 * from a population mean. A measured per-participant held-out error decides.
 */
export function summarizeCalibration(
  targets: CalibrationTarget[],
  observations: CalibrationObservation[],
  geometry: ScreenGeometry | null,
  criterionDeg = DEFAULT_CALIBRATION_ERROR_DEG
): CalibrationReport {
  if (!Number.isFinite(criterionDeg) || criterionDeg <= 0) throw new Error("calibration_criterion_invalid");
  const targetIds = new Set<string>();
  for (const target of targets) {
    if (!target.id.trim()) throw new Error("calibration_target_id_required");
    if (targetIds.has(target.id)) throw new Error("calibration_target_id_duplicate");
    if (!Number.isFinite(target.x_px) || !Number.isFinite(target.y_px)) {
      throw new Error("calibration_target_non_finite");
    }
    targetIds.add(target.id);
  }
  for (const observation of observations) {
    if (!Number.isFinite(observation.x_px) || !Number.isFinite(observation.y_px)) {
      throw new Error("calibration_observation_non_finite");
    }
  }
  const unknown = observations.filter((observation) => !targetIds.has(observation.target_id)).length;
  const points: CalibrationPointReport[] = targets.map((target) => {
    const samples = observations.filter((observation) => observation.target_id === target.id);
    const errorsPx = samples.map((sample) => Math.hypot(sample.x_px - target.x_px, sample.y_px - target.y_px));
    const errorsDeg = samples.map((sample) => angularDistanceDeg(sample, target, geometry));
    const angular = errorsDeg.filter((value): value is number => value !== null);
    return {
      target,
      observation_count: samples.length,
      mean_x_px: mean(samples.map((sample) => sample.x_px)),
      mean_y_px: mean(samples.map((sample) => sample.y_px)),
      mean_error_px: mean(errorsPx),
      max_error_px: max(errorsPx),
      mean_error_deg: mean(angular),
      max_error_deg: max(angular)
    };
  });
  const allPx = points.flatMap((point) => (point.max_error_px === null ? [] : [point.max_error_px]));
  const allDeg = points.flatMap((point) => (point.max_error_deg === null ? [] : [point.max_error_deg]));
  const repetitions = points.map((point) => point.observation_count);
  const equalRepetitions =
    repetitions.length > 0 && repetitions.every((count) => count === repetitions[0]) ? (repetitions[0] ?? null) : null;
  const missingTargets = points.filter((point) => point.observation_count === 0).length;
  const targetCount = targets.length;
  const maxErrorDeg = max(allDeg);
  const passes =
    targetCount !== DEFAULT_CALIBRATION_POINTS || missingTargets > 0
      ? false
      : geometry === null || maxErrorDeg === null
        ? null
        : maxErrorDeg <= criterionDeg;
  return {
    target_count: targetCount,
    expected_target_count: DEFAULT_CALIBRATION_POINTS,
    repetitions_per_target: equalRepetitions,
    unknown_observations: unknown,
    points,
    mean_error_px: mean(points.flatMap((point) => (point.mean_error_px === null ? [] : [point.mean_error_px]))),
    max_error_px: max(allPx),
    mean_error_deg: mean(points.flatMap((point) => (point.mean_error_deg === null ? [] : [point.mean_error_deg]))),
    max_error_deg: maxErrorDeg,
    angular_available: geometry !== null && allDeg.length === targetCount,
    criterion_deg: criterionDeg,
    passes,
    note:
      geometry === null
        ? "Angular calibration error is not evaluable without measured screen size and viewing distance."
        : "Held-out calibration error compared with the pre-registered 1.5° gate per participant."
  };
}
