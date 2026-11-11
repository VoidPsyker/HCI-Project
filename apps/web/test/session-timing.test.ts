import { describe, expect, it } from "vitest";
import { INDUCTIONS, SESSION_TIMING } from "../src/content";

describe("short pilot time budget", () => {
  it("keeps four mood activities and gives searches more than 15 seconds", () => {
    expect(Object.keys(INDUCTIONS).sort()).toEqual(["bored", "confused", "frustrated", "happy"]);
    expect(SESSION_TIMING.practiceTrialSeconds).toBeGreaterThan(15);
    expect(SESSION_TIMING.scoredTrialSeconds).toBeGreaterThan(SESSION_TIMING.practiceTrialSeconds);
  });
});
