import { assertConsentMatches } from "@meridian/analysis";
import type { GazeConsent } from "@meridian/analysis";

export interface GazeConsentRequest {
  participant_id: string;
  session_id: string;
  version: string;
  camera_used: boolean;
  granted_at?: string;
}

/**
 * Records a gaze-specific consent. There is deliberately no default or silent
 * grant: the caller must supply a version and the camera flag. Raw video
 * retention is always false.
 */
export function grantGazeConsent(request: GazeConsentRequest): GazeConsent {
  const grantedAt = request.granted_at ?? new Date().toISOString();
  const consent: GazeConsent = {
    participant_id: request.participant_id,
    session_id: request.session_id,
    version: request.version,
    granted_at: grantedAt,
    scope: "eye_tracking_only",
    camera_used: request.camera_used,
    raw_video_retention: false,
    separate_from_core_consent: true
  };
  assertConsentMatches(consent, request.participant_id, request.session_id);
  return consent;
}

/** Webcam acquisition additionally requires explicit camera permission. */
export function assertCameraConsent(
  consent: GazeConsent | null,
  participantId: string,
  sessionId: string
): asserts consent is GazeConsent {
  assertConsentMatches(consent, participantId, sessionId);
  if (!consent.camera_used) throw new Error("gaze_consent_camera_not_granted");
}
