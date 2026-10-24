import type { StateLabel } from "./events";

const STATES = ["happy", "frustrated", "confused", "bored"] as const;
export type AffectRatings = Record<(typeof STATES)[number] | "valence" | "arousal", number>;

export function reportedState(ratings: AffectRatings): StateLabel {
  if (!STATES.every((state) => Number.isInteger(ratings[state]) && ratings[state] >= 1 && ratings[state] <= 7)) return "mixed";
  const intensity = Math.max(...STATES.map((state) => ratings[state]));
  const highest = STATES.filter((state) => ratings[state] === intensity);
  return intensity >= 5 && highest.length === 1 ? highest[0]! : "mixed";
}

export function manipulationCheckPassed(state: string, ratings: AffectRatings): boolean {
  if (state === "mixed" || reportedState(ratings) !== state) return false;
  const { valence, arousal } = ratings;
  if (![valence, arousal].every((value) => Number.isInteger(value) && value >= 1 && value <= 9)) return false;
  switch (state) {
    case "happy": return valence >= 6 && arousal >= 4 && arousal <= 7;
    case "frustrated": return valence <= 4 && arousal >= 5;
    case "confused": return valence <= 5 && arousal >= 4 && arousal <= 6;
    case "bored": return valence <= 5 && arousal <= 4;
  }
  return false;
}
