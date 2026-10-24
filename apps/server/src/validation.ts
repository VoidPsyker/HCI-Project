import { z } from "zod";
import { EVENT_TYPES } from "@meridian/scoring";

export const eventSchema = z.object({
  event_id: z.string().uuid(),
  participant_id: z.string().min(1).max(100),
  session_id: z.string().min(1).max(100),
  study: z.enum(["pilot", "s1", "s2", "s3"]),
  block_id: z.string().max(100).nullable().default(null),
  trial_id: z.string().max(120).nullable().default(null),
  task_id: z.string().max(20).nullable().default(null),
  target_id: z.string().max(120).nullable().default(null),
  menu_id: z.enum(["A", "B", "C", "D", "E", "F"]).nullable().default(null),
  state_label: z.enum(["happy", "frustrated", "confused", "bored", "mixed"]),
  condition: z.enum(["static", "matched", "mismatched", "sham", "hybrid"]),
  event_type: z.enum(EVENT_TYPES),
  t_client: z.number().finite().nonnegative(),
  t_server: z.string().datetime().optional(),
  elapsed_ms: z.number().finite().nonnegative().nullable().default(null),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable().default(null),
  element_id: z.string().max(160).nullable().default(null),
  element_label: z.string().max(240).nullable().default(null),
  parent_id: z.string().max(160).nullable().default(null),
  x: z.number().finite().nullable().default(null),
  y: z.number().finite().nullable().default(null),
  input_type: z.enum(["mouse", "trackpad", "keyboard", "touch"]),
  meta: z.record(z.unknown()).default({})
});

export const eventBatchSchema = z.object({
  events: z.array(eventSchema).min(1).max(500)
});

export const demographicsSchema = z.object({
  age_band: z.enum(["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]),
  gender: z.enum(["woman", "man", "non-binary", "prefer not to say", "self-describe"]),
  gender_self_describe: z.string().max(80).optional().default(""),
  education: z.enum(["secondary", "vocational", "undergraduate", "postgraduate", "doctorate", "prefer not to say"]),
  shopping_freq: z.enum(["never", "rarely", "monthly", "weekly", "daily"]),
  watch_expertise: z.number().int().min(1).max(7),
  tech_savvy: z.number().int().min(1).max(7),
  colour_vision: z.enum(["typical", "corrected", "atypical", "prefer not to say"]),
  prior_menu_experience: z.array(z.enum(["horizontal", "sidebar", "mega", "tiles", "icon_grid", "radial"])).max(6).optional().default([])
});

export const questionnaireSchema = z.object({
  response_id: z.string().uuid(),
  session_id: z.string().min(1).max(100),
  block_id: z.string().max(100).nullable().optional().default(null),
  menu_id: z.enum(["A", "B", "C", "D", "E", "F"]).nullable().optional().default(null),
  instrument: z.enum(["SUS", "NASA_TLX", "OPEN", "CREDIBILITY"]),
  item_id: z.string().min(1).max(80),
  value: z.number().finite().nullable().optional().default(null),
  text_value: z.string().max(4000).nullable().optional().default(null),
  answered_at: z.string().datetime()
});

export const questionnaireBatchSchema = z.object({
  responses: z.array(questionnaireSchema).min(1).max(500)
});

export const createSessionSchema = z.object({
  label: z.string().min(1).max(80).optional()
});

export const updateSessionSchema = z.object({
  status: z.enum(["created", "consented", "in_progress", "paused", "completed", "aborted", "withdrawn"]).optional(),
  phase: z.string().min(1).max(80).optional(),
  abort_reason: z.string().max(500).optional()
});

export const noteSchema = z.object({
  note: z.string().min(1).max(2000)
});

const gazeSourceSchema = z
  .object({
    kind: z.enum(["webcam", "hardware", "synthetic"]),
    adapter: z.string().min(1).max(120),
    device: z.string().min(1).max(200),
    nominal_hz: z.number().finite().positive().nullable(),
    hardware_backed: z.boolean(),
    synthetic: z.boolean(),
    capabilities: z.array(z.enum(["gaze", "pupil", "device_clock", "screen_geometry"])).max(8),
    notes: z.string().max(500).optional()
  })
  .strict();

const gazeViewportSchema = z
  .object({
    width_px: z.number().int().positive(),
    height_px: z.number().int().positive()
  })
  .strict();

const gazeGeometrySchema = z
  .object({
    width_px: z.number().int().positive(),
    height_px: z.number().int().positive(),
    width_mm: z.number().finite().positive(),
    height_mm: z.number().finite().positive(),
    viewing_distance_mm: z.number().finite().positive()
  })
  .strict();

export const gazeConsentSchema = z
  .object({
    version: z.string().min(1).max(80),
    camera_used: z.boolean(),
    synthetic: z.boolean().default(false),
    viewport: gazeViewportSchema,
    geometry: gazeGeometrySchema,
    source: gazeSourceSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.geometry.width_px !== value.viewport.width_px || value.geometry.height_px !== value.viewport.height_px) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["geometry"], message: "geometry must match the capture viewport" });
    }
    if (value.source.synthetic !== value.synthetic || (value.source.kind === "synthetic") !== value.synthetic) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "source and synthetic flag disagree" });
    }
    if (value.synthetic && value.camera_used) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["camera_used"], message: "synthetic data cannot claim camera use" });
    }
    if (!value.synthetic && value.source.kind === "webcam" && !value.camera_used) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["camera_used"], message: "webcam acquisition requires camera consent" });
    }
    if (value.source.kind === "hardware" && value.camera_used) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["camera_used"], message: "hardware bridge does not use the browser camera" });
    }
  });

const gazeSampleSchema = z
  .object({
    seq: z.number().int().positive(),
    t_ms: z.number().finite(),
    t_source_ms: z.number().finite().nullable().default(null),
    x_px: z.number().finite().nullable().default(null),
    y_px: z.number().finite().nullable().default(null),
    valid: z.boolean(),
    invalid_reason: z
      .enum(["no_prediction", "out_of_bounds", "non_finite", "viewport_mismatch", "bridge_error"])
      .optional(),
    pupil_left_mm: z.number().finite().nonnegative().nullable().optional(),
    pupil_right_mm: z.number().finite().nonnegative().nullable().optional(),
    trial_id: z.string().max(120).nullable().optional().default(null)
  })
  .strict();

export const gazeBatchSchema = z
  .object({
    batch_id: z.string().min(1).max(120),
    samples: z.array(gazeSampleSchema).min(1).max(500)
  })
  .strict();

const gazeCalibrationSchema = z
  .object({
    target_count: z.number().int().nonnegative(),
    expected_target_count: z.number().int().positive(),
    max_error_deg: z.number().finite().nullable(),
    criterion_deg: z.number().finite().positive(),
    passes: z.boolean().nullable(),
    angular_available: z.boolean(),
    unknown_observations: z.number().int().nonnegative(),
    points: z
      .array(z.object({ observation_count: z.number().int().nonnegative() }).passthrough())
      .max(50)
  })
  .passthrough()
  .nullable();

const gazeQualitySchema = z
  .object({
    overall: z.enum(["pass", "fail", "not_evaluable"]),
    analysis_ready: z.boolean(),
    angular_metrics_ready: z.boolean(),
    missing_pct: z.number().finite().nullable(),
    sample_count: z.number().int().nonnegative(),
    valid_sample_count: z.number().int().nonnegative(),
    rejected_samples: z.number().int().nonnegative(),
    dropped_samples: z.number().int().nonnegative()
  })
  .passthrough();

export const gazeCompleteSchema = z
  .object({
    calibration: gazeCalibrationSchema,
    quality: gazeQualitySchema,
    metrics: z.array(z.record(z.unknown())).max(500),
    clock: z.record(z.unknown()),
    max_samples: z.number().int().positive().max(500_000),
    rejected_samples: z.number().int().nonnegative(),
    dropped_samples: z.number().int().nonnegative()
  })
  .strict();

const FORBIDDEN_MEDIA_KEYS = new Set([
  "image",
  "video",
  "frame",
  "video_frame",
  "raw_video",
  "face_image",
  "faceimage",
  "webcam_frame"
]);

/** Recursively refuse any media field in a gaze payload. */
export function findForbiddenMediaKey(value: unknown, prefix = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenMediaKey(value[index], `${prefix}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_MEDIA_KEYS.has(key.toLowerCase())) return path;
    const found = findForbiddenMediaKey(child, path);
    if (found) return found;
  }
  return null;
}
