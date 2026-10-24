import { describe, expect, it } from "vitest";
import { viewportWarning } from "../src/repository";

describe("viewportWarning", () => {
  it("is silent for the specified 1920 x 1080 stage at 1x", () => {
    expect(viewportWarning({ viewport: "1920x1080", device_pixel_ratio: 1 })).toBeNull();
  });
  it("names every deviation for the researcher", () => {
    expect(viewportWarning({ viewport: "1536x864", device_pixel_ratio: 1.25 })).toBe(
      "viewport 1536x864, device pixel ratio 1.25 (expected 1920x1080 at 1x)"
    );
  });
});
