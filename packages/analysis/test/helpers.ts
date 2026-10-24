import type {
  CalibrationObservation,
  CalibrationReport,
  CalibrationTarget,
  GazeConsent,
  GazeSample,
  GazeSourceInfo,
  ScreenGeometry,
  Viewport
} from "../src/index";
import { ninePointTargets, summarizeCalibration } from "../src/index";

export const VIEWPORT: Viewport = { width_px: 1000, height_px: 1000 };

export const GEOMETRY: ScreenGeometry = {
  width_px: 1000,
  height_px: 1000,
  width_mm: 1000,
  height_mm: 1000,
  viewing_distance_mm: 500
};

export const TARGETS = ninePointTargets(VIEWPORT);

export function observationsAtTargets(targets: CalibrationTarget[], repetitions = 5, offsetPx = 0): CalibrationObservation[] {
  return targets.flatMap((target) =>
    Array.from({ length: repetitions }, (_, index) => ({
      target_id: target.id,
      x_px: target.x_px + offsetPx,
      y_px: target.y_px,
      t_ms: target.order * 1000 + index * 100
    }))
  );
}

export function calibration(
  options: { targets?: CalibrationTarget[]; repetitions?: number; offsetPx?: number; geometry?: ScreenGeometry | null } = {}
): CalibrationReport {
  const targets = options.targets ?? TARGETS;
  return summarizeCalibration(
    targets,
    observationsAtTargets(targets, options.repetitions ?? 5, options.offsetPx ?? 0),
    options.geometry === undefined ? GEOMETRY : options.geometry
  );
}

export function sample(seq: number, t: number, x: number | null, y: number | null, valid = true): GazeSample {
  return { seq, t_ms: t, t_source_ms: t, x_px: x, y_px: y, valid };
}

export function sourceInfo(overrides: Partial<GazeSourceInfo> = {}): GazeSourceInfo {
  return {
    kind: "hardware",
    adapter: "test",
    device: "test tracker",
    nominal_hz: 120,
    hardware_backed: true,
    synthetic: false,
    capabilities: ["gaze"],
    ...overrides
  };
}

export function consent(overrides: Partial<GazeConsent> = {}): GazeConsent {
  return {
    participant_id: "P001",
    session_id: "S001",
    version: "eye-1",
    granted_at: "2026-10-24T10:00:00.000Z",
    scope: "eye_tracking_only",
    camera_used: false,
    raw_video_retention: false,
    separate_from_core_consent: true,
    ...overrides
  };
}
