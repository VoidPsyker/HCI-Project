import type { CalibrationReport } from "./calibration";
import type { ClockSyncReport } from "./clock";
import { assertConsentMatches } from "./consent";
import { assertGeometryMatchesViewport, assertViewport } from "./geometry";
import type { TrialGazeMetrics } from "./aoi";
import type { GazeQualityReport } from "./quality";
import type { GazeConsent, GazeSample, GazeSourceInfo, ScreenGeometry, Viewport } from "./types";
import { DEFAULT_MAX_SESSION_SAMPLES, GAZE_SCHEMA_VERSION } from "./types";

export interface GazeExportInput {
  participant_id: string;
  session_id: string;
  created_at?: string;
  source: GazeSourceInfo;
  consent: GazeConsent | null;
  samples: readonly GazeSample[];
  calibration: CalibrationReport | null;
  geometry: ScreenGeometry | null;
  viewport: Viewport;
  clock: ClockSyncReport;
  metrics: readonly TrialGazeMetrics[];
  quality: GazeQualityReport;
  rejected_samples?: number;
  dropped_samples?: number;
  max_samples?: number;
}

export interface GazeExportManifest {
  schema_version: typeof GAZE_SCHEMA_VERSION;
  created_at: string;
  participant_id: string;
  session_id: string;
  source: GazeSourceInfo;
  synthetic: boolean;
  human_data: boolean;
  consent: {
    version: string;
    granted_at: string;
    scope: GazeConsent["scope"];
    camera_used: boolean;
    raw_video_retention: false;
    separate_from_core_consent: true;
  } | null;
  geometry: ScreenGeometry | null;
  viewport: Viewport;
  clock: ClockSyncReport;
  quality_overall: GazeQualityReport["overall"];
  analysis_ready: boolean;
  angular_metrics_ready: boolean;
  streams: {
    samples: "gaze_samples.jsonl";
    aoi_metrics: "aoi_metrics.jsonl";
    quality: "gaze_quality.json";
  };
  contains_click_events: false;
  contains_raw_video: false;
  restricted_access: true;
  retention: {
    samples_scope: "trial_only" | "synthetic_full";
    max_samples: number;
    rejected_samples: number;
    dropped_samples: number;
  };
  counts: { samples: number; valid_samples: number; trials: number };
}

export interface GazeExportBundle {
  manifest: GazeExportManifest;
  samples_jsonl: string;
  aoi_metrics_jsonl: string;
  quality_json: string;
}

function assertNoMediaFields(sample: GazeSample): void {
  const forbidden = ["video", "video_frame", "image", "raw_video", "face_image", "frame"];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(sample, key)) throw new Error(`gaze_export_forbidden_field_${key}`);
  }
}

function jsonl(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * Builds a restricted export with gaze separated from click events. Raw video
 * is never part of the schema; non-synthetic exports require separate gaze
 * consent with `raw_video_retention: false`.
 */
export function buildGazeExport(input: GazeExportInput): GazeExportBundle {
  assertViewport(input.viewport);
  if (input.geometry) assertGeometryMatchesViewport(input.geometry, input.viewport);
  if (!input.source.synthetic) assertConsentMatches(input.consent, input.participant_id, input.session_id);
  if (input.source.synthetic && input.source.kind !== "synthetic") throw new Error("gaze_synthetic_source_kind_invalid");
  for (const sample of input.samples) {
    if (!Number.isFinite(sample.t_ms)) throw new Error("gaze_sample_time_invalid");
    if (!Number.isFinite(sample.seq)) throw new Error("gaze_sample_seq_invalid");
    assertNoMediaFields(sample);
  }
  const createdAt = input.created_at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("gaze_export_created_at_invalid");
  const validSamples = input.samples.filter(
    (sample) =>
      sample.valid &&
      sample.x_px !== null &&
      sample.y_px !== null &&
      Number.isFinite(sample.x_px) &&
      Number.isFinite(sample.y_px)
  ).length;
  const manifest: GazeExportManifest = {
    schema_version: GAZE_SCHEMA_VERSION,
    created_at: createdAt,
    participant_id: input.participant_id,
    session_id: input.session_id,
    source: input.source,
    synthetic: input.source.synthetic,
    human_data: !input.source.synthetic,
    consent: input.consent
      ? {
          version: input.consent.version,
          granted_at: input.consent.granted_at,
          scope: input.consent.scope,
          camera_used: input.consent.camera_used,
          raw_video_retention: false,
          separate_from_core_consent: true
        }
      : null,
    geometry: input.geometry,
    viewport: input.viewport,
    clock: input.clock,
    quality_overall: input.quality.overall,
    analysis_ready: input.quality.analysis_ready,
    angular_metrics_ready: input.quality.angular_metrics_ready,
    streams: {
      samples: "gaze_samples.jsonl",
      aoi_metrics: "aoi_metrics.jsonl",
      quality: "gaze_quality.json"
    },
    contains_click_events: false,
    contains_raw_video: false,
    restricted_access: true,
    retention: {
      samples_scope: input.source.synthetic ? "synthetic_full" : "trial_only",
      max_samples: input.max_samples ?? DEFAULT_MAX_SESSION_SAMPLES,
      rejected_samples: input.rejected_samples ?? 0,
      dropped_samples: input.dropped_samples ?? 0
    },
    counts: { samples: input.samples.length, valid_samples: validSamples, trials: input.metrics.length }
  };
  return {
    manifest,
    samples_jsonl: jsonl(input.samples),
    aoi_metrics_jsonl: jsonl(input.metrics),
    quality_json: `${JSON.stringify({ calibration: input.calibration, quality: input.quality }, null, 2)}\n`
  };
}

/** Minimal parser for the exported sample stream; rejects non-gaze lines. */
export function parseGazeSamplesJsonl(text: string): GazeSample[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const value = JSON.parse(line) as Partial<GazeSample>;
      if (typeof value.t_ms !== "number" || typeof value.seq !== "number" || typeof value.valid !== "boolean") {
        throw new Error(`gaze_samples_jsonl_invalid_line_${index + 1}`);
      }
      if (!("x_px" in value) || !("y_px" in value)) throw new Error(`gaze_samples_jsonl_missing_xy_${index + 1}`);
      return value as GazeSample;
    });
}
