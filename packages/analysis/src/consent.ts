import type { GazeConsent } from "./types";

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`gaze_consent_${field}_required`);
  return trimmed;
}

/** Validates and copies a gaze consent record. Throws on any missing gate. */
export function assertGazeConsent(consent: GazeConsent | null): asserts consent is GazeConsent {
  if (!consent) throw new Error("gaze_consent_required");
  required(consent.participant_id, "participant_id");
  required(consent.session_id, "session_id");
  required(consent.version, "version");
  required(consent.granted_at, "granted_at");
  if (consent.scope !== "eye_tracking_only") throw new Error("gaze_consent_scope_invalid");
  if (consent.raw_video_retention !== false) throw new Error("gaze_consent_raw_video_forbidden");
  if (consent.separate_from_core_consent !== true) throw new Error("gaze_consent_must_be_separate");
  if (!Number.isFinite(Date.parse(consent.granted_at))) throw new Error("gaze_consent_granted_at_invalid");
}

export function assertConsentMatches(
  consent: GazeConsent | null,
  participantId: string,
  sessionId: string
): asserts consent is GazeConsent {
  assertGazeConsent(consent);
  if (consent.participant_id !== participantId) throw new Error("gaze_consent_participant_mismatch");
  if (consent.session_id !== sessionId) throw new Error("gaze_consent_session_mismatch");
}
