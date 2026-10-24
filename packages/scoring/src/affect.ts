import type { StateLabel } from "./events";

const STATES = ["happy", "frustrated", "confused", "bored"] as const;
export type AffectRatings = Record<(typeof STATES)[number] | "valence" | "arousal", number>;

export function reportedState(ratings: AffectRatings): StateLabel {
  if (!STATES.every((state) => Number.isInteger(ratings[state]) && ratings[state] >= 1 && ratings[state] <= 7)) return "mixed";
  const intensity = Math.max(...STATES.map((state) => ratings[state]));
  const highest = STATES.filter((state) => ratings[state] === intensity);
  return intensity >= 5 && highest.length === 1 ? highest[0]! : "mixed";
}

/** SAM thresholds per induction (plan §3.4); the discrete item must also be the reported state. */
const SAM_CHECKS: Record<(typeof STATES)[number], (valence: number, arousal: number) => boolean> = {
  happy: (valence, arousal) => valence >= 6 && arousal >= 4 && arousal <= 7,
  frustrated: (valence, arousal) => valence <= 4 && arousal >= 5,
  confused: (valence, arousal) => valence <= 5 && arousal >= 4 && arousal <= 6,
  bored: (valence, arousal) => valence <= 5 && arousal <= 4
};

export function manipulationCheckPassed(state: string, ratings: AffectRatings): boolean {
  const reported = reportedState(ratings);
  if (reported === "mixed" || reported !== state) return false;
  const { valence, arousal } = ratings;
  if (![valence, arousal].every((value) => Number.isInteger(value) && value >= 1 && value <= 9)) return false;
  return SAM_CHECKS[reported](valence, arousal);
}
