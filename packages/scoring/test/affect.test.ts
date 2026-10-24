import { describe, expect, it } from "vitest";
import { manipulationCheckPassed, reportedState, type AffectRatings } from "../src/affect";

const base: AffectRatings = { happy: 2, frustrated: 2, confused: 2, bored: 2, valence: 5, arousal: 5 };

describe("preregistered affect rules", () => {
  it("labels weak and tied ratings mixed", () => {
    expect(reportedState({ ...base, happy: 4 })).toBe("mixed");
    expect(reportedState({ ...base, happy: 6, frustrated: 6 })).toBe("mixed");
    expect(reportedState({ ...base, happy: 5 })).toBe("happy");
  });
  it.each([
    ["happy", 6, 4, true], ["happy", 5, 4, false], ["happy", 6, 8, false],
    ["frustrated", 4, 5, true], ["frustrated", 5, 5, false], ["frustrated", 4, 4, false],
    ["confused", 5, 4, true], ["confused", 5, 7, false],
    ["bored", 5, 4, true], ["bored", 5, 5, false]
  ] as const)("checks %s at valence %s/arousal %s", (state, valence, arousal, passed) => {
    expect(manipulationCheckPassed(state, { ...base, [state]: 6, valence, arousal })).toBe(passed);
  });
  it("rejects a competing or mixed self-report", () => {
    expect(manipulationCheckPassed("happy", { ...base, happy: 6, bored: 7, valence: 7 })).toBe(false);
    expect(manipulationCheckPassed("mixed", base)).toBe(false);
    expect(manipulationCheckPassed("happy", { ...base, happy: 8, valence: 7 })).toBe(false);
    expect(manipulationCheckPassed("frustrated", { ...base, frustrated: 6, valence: 0 })).toBe(false);
    expect(reportedState({ ...base, happy: NaN })).toBe("mixed");
  });
});
