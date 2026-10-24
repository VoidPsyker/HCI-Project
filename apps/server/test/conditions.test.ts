import { describe, expect, it } from "vitest";
import { trialCondition } from "../src/conditions";

describe("Study 2/3 feature flags", () => {
  it("assigns the static condition while both flags are off", () => {
    expect(trialCondition({ study2: false, study3: false })).toBe("static");
  });
  it("refuses unimplemented Study 2/3 conditions", () => {
    expect(() => trialCondition({ study2: true, study3: false })).toThrow(/not implemented/);
    expect(() => trialCondition({ study2: false, study3: true })).toThrow(/not implemented/);
  });
});
