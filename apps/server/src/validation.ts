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
  colour_vision: z.enum(["typical", "corrected", "atypical", "prefer not to say"])
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
