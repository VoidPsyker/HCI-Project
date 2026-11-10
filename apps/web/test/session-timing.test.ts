import { describe, expect, it } from "vitest";
import { INDUCTIONS, SESSION_TIMING } from "../src/content";

describe("short pilot time budget", () => {
  it("retains all four mood activities and leaves time for setup and responses", () => {
    expect(Object.keys(INDUCTIONS).sort()).toEqual(["bored", "confused", "frustrated", "happy"]);
    const timedSeconds = Object.values(INDUCTIONS).reduce((total, induction) => total + induction.durationSeconds, 0)
      + 12 * SESSION_TIMING.scoredTrialSeconds
      + 6 * SESSION_TIMING.practiceTrialSeconds
      + 4 * SESSION_TIMING.neutralResetSeconds;
    expect(timedSeconds).toBe(585);
    expect(SESSION_TIMING.targetSeconds - timedSeconds).toBeGreaterThanOrEqual(315);
  });
});
