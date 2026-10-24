import type { Condition } from "@meridian/scoring";

export interface StudyFeatures {
  study2: boolean;
  study3: boolean;
}

/**
 * The pilot runs every trial in the "static" condition. The event schema and `condition` field already
 * accept matched/mismatched/sham (Study 2) and hybrid (Study 3).
 *
 * TODO(study2): frozen Study 1 mapping, pre-registered mismatch rule and sham switch per plan §9.3,
 *   with a 4 x 4 condition Latin square inside each block (plan §6.3).
 * TODO(study3): estimator, 0.70 confidence threshold, dwell/recent-switch guardrails, keep/revert banner
 *   and adaptation_shown/accepted/reverted logging per plan §10 and §14.4.
 */
export function trialCondition(features: StudyFeatures): Condition {
  if (features.study2 || features.study3) {
    throw new Error("Study 2/3 conditions are not implemented in the pilot build; set FEATURE_STUDY2/FEATURE_STUDY3 to false");
  }
  return "static";
}
