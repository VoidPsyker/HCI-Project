/**
 * Shared, device-independent types for gaze acquisition and analysis.
 *
 * All timestamps in `GazeSample.t_ms` are on one capture clock, normally the
 * browser's `performance.now()` domain. Device clocks are retained separately
 * in `t_source_ms`; the clock sync report says how they were mapped.
 */

export const GAZE_SCHEMA_VERSION = "meridian.gaze/1" as const;
export const BRIDGE_PROTOCOL_VERSION = "meridian.gaze.bridge/1" as const;

export const DEFAULT_CALIBRATION_POINTS = 9;
export const DEFAULT_CALIBRATION_ERROR_DEG = 1.5;
export const DEFAULT_MAX_MISSING_PCT = 20;
export const DEFAULT_IVT_VELOCITY_DEG_S = 30;
export const DEFAULT_MIN_FIXATION_MS = 100;
export const DEFAULT_MAX_SESSION_SAMPLES = 500_000;

import type { ClockSyncReport } from "./clock";

export type GazeSourceKind = "webcam" | "hardware" | "synthetic";
export type GazeSourceStatus = "idle" | "starting" | "running" | "paused" | "stopping" | "stopped" | "error";
export type GazeCapability = "gaze" | "pupil" | "device_clock" | "screen_geometry";

export interface Viewport {
  width_px: number;
  height_px: number;
}

/** Measured physical screen geometry. Never infer millimetres from pixels. */
export interface ScreenGeometry extends Viewport {
  width_mm: number;
  height_mm: number;
  viewing_distance_mm: number;
}

export interface GazeSourceInfo {
  /** `synthetic` is test/replay data and must never be treated as human data. */
  kind: GazeSourceKind;
  adapter: string;
  device: string;
  nominal_hz: number | null;
  hardware_backed: boolean;
  synthetic: boolean;
  capabilities: readonly GazeCapability[];
  notes?: string;
}

export interface GazeSample {
  seq: number;
  /** Synchronized capture-clock time in milliseconds. */
  t_ms: number;
  /** Raw source/device clock time in milliseconds when available. */
  t_source_ms: number | null;
  x_px: number | null;
  y_px: number | null;
  valid: boolean;
  invalid_reason?: "no_prediction" | "out_of_bounds" | "non_finite" | "viewport_mismatch" | "bridge_error";
  pupil_left_mm?: number | null;
  pupil_right_mm?: number | null;
  /** Optional link to a trial. Never contains click coordinates or click events. */
  trial_id?: string | null;
}

/**
 * Separate consent for gaze. The core study consent is not enough: plan §11.4
 * requires separate ethics approval and separate storage/access.
 */
export interface GazeConsent {
  participant_id: string;
  session_id: string;
  version: string;
  granted_at: string;
  scope: "eye_tracking_only";
  camera_used: boolean;
  raw_video_retention: false;
  separate_from_core_consent: true;
}

export type GazeSampleListener = (sample: GazeSample) => void;

export interface GazeSource {
  readonly info: GazeSourceInfo;
  readonly status: GazeSourceStatus;
  readonly clock: ClockSyncReport;
  start(consent: GazeConsent | null): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  subscribe(listener: GazeSampleListener): () => void;
}
