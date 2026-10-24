import { describe, expect, it } from "vitest";
import {
  attributeSample,
  classifyFixations,
  computeTrialMetrics,
  countAoiTransitions,
  scanpathLength
} from "../src/index";
import type { AoiDefinition, GazeSample } from "../src/index";
import { GEOMETRY, sample } from "./helpers";

function samplesAt(timesMs: number[], x: number, y: number): GazeSample[] {
  return timesMs.map((t, index) => sample(index + 1, t, x, y));
}

describe("I-VT fixation filter", () => {
  it("is not evaluable without measured screen geometry", () => {
    const result = classifyFixations(samplesAt([0, 33, 66, 100], 100, 100), null);
    expect(result.status).toBe("not_evaluable");
    if (result.status === "not_evaluable") expect(result.reason).toBe("screen_geometry_required");
  });

  it("finds a stationary fixation at 30 Hz", () => {
    const result = classifyFixations(samplesAt([0, 33, 66, 100, 133, 166, 200], 100, 100), GEOMETRY);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.fixations).toHaveLength(1);
    expect(result.fixations[0]).toMatchObject({ start_ms: 0, end_ms: 200, duration_ms: 200, sample_count: 7 });
    expect(result.fixations[0]?.mean_velocity_deg_s).toBeCloseTo(0, 6);
    expect(result.threshold_deg_s).toBe(30);
    expect(result.min_fixation_ms).toBe(100);
  });

  it("drops fixations shorter than 100 ms", () => {
    const result = classifyFixations(samplesAt([0, 33], 100, 100), GEOMETRY);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.fixations).toHaveLength(0);
  });

  it("breaks a fixation on a saccade and reports both sides", () => {
    const first = samplesAt([0, 33, 66, 100, 133], 100, 100);
    const second = samplesAt([166, 200, 233, 266, 300], 500, 100).map((sample, index) => ({
      ...sample,
      seq: first.length + index + 1
    }));
    const result = classifyFixations([...first, ...second], GEOMETRY);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.fixations.length).toBeGreaterThanOrEqual(2);
    expect(result.invalid_segments).toBe(0);
  });

  it("breaks runs on invalid samples and computes scanpath", () => {
    const first = samplesAt([0, 33, 66, 100, 133], 100, 100);
    const invalid = { ...sample(6, 166, null, null, false) };
    const second = samplesAt([200, 233, 266, 300, 333], 500, 100).map((sample, index) => ({
      ...sample,
      seq: 7 + index
    }));
    const result = classifyFixations([...first, invalid, ...second], GEOMETRY);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.fixations.length).toBe(2);
    const path = scanpathLength(result.fixations, GEOMETRY);
    expect(path.px).toBeCloseTo(400, 6);
    expect(path.deg).toBeCloseTo(31.9928, 3);
    expect(scanpathLength(result.fixations, null).deg).toBeNull();
  });

  it("counts AOI transitions across nulls", () => {
    expect(countAoiTransitions(["a", null, "b", "b", "c"])).toBe(2);
    expect(countAoiTransitions([null, null])).toBe(0);
    expect(countAoiTransitions(["a", "a"])).toBe(0);
  });
});

const target: AoiDefinition = {
  id: "target",
  label: "Target department",
  role: "target_department",
  rect: { x_px: 0, y_px: 0, width_px: 100, height_px: 100 }
};

const menu: AoiDefinition = {
  id: "menu",
  label: "Menu panel",
  role: "menu_region",
  rect: { x_px: 50, y_px: 50, width_px: 100, height_px: 100 },
  z: 1
};

const fullViewport: AoiDefinition = {
  id: "full",
  label: "Full viewport",
  role: "target_leaf",
  rect: { x_px: 0, y_px: 0, width_px: 1000, height_px: 1000 }
};

describe("AOI attribution", () => {
  it("returns all active matches and resolves overlap deterministically", () => {
    const hit = attributeSample(sample(1, 100, 60, 60), [target, menu]);
    expect(hit?.aoi_ids).toEqual(["menu", "target"]);
    expect(hit?.primary_aoi_id).toBe("menu");
    const targetOnly = attributeSample(sample(2, 100, 10, 10), [target, menu]);
    expect(targetOnly?.aoi_ids).toEqual(["target"]);
    expect(attributeSample(sample(3, 100, 500, 500), [target, menu])).toBeNull();
    expect(attributeSample(sample(4, 100, 60, 60, false), [target, menu])).toBeNull();
  });

  it("honours active windows", () => {
    const timed = { ...target, active_from_ms: 200, active_to_ms: 300 };
    expect(attributeSample(sample(1, 100, 10, 10), [timed])).toBeNull();
    expect(attributeSample(sample(2, 250, 10, 10), [timed])?.primary_aoi_id).toBe("target");
    expect(attributeSample(sample(3, 350, 10, 10), [timed])).toBeNull();
  });

  it("integrates dwell, TTFF and transitions from actual sample intervals", () => {
    const samples = Array.from({ length: 11 }, (_, index) => sample(index + 1, index * 100, 500, 500));
    const metrics = computeTrialMetrics(
      { trial_id: "t1", menu_id: "A", start_ms: 0, end_ms: 1000, target_aoi_id: "full" },
      samples,
      [fullViewport],
      GEOMETRY
    );
    expect(metrics.total_samples).toBe(11);
    expect(metrics.valid_samples).toBe(11);
    expect(metrics.missing_pct).toBe(0);
    expect(metrics.aoi_dwell[0]).toMatchObject({ aoi_id: "full", sample_count: 11, dwell_ms: 1000 });
    expect(metrics.aoi_dwell[0]?.proportion_of_trial).toBeCloseTo(1, 6);
    expect(metrics.time_to_first_fixation_ms).toBe(0);
    expect(metrics.fixation_count).toBe(1);
    expect(metrics.scanpath_px).toBe(0);
    expect(metrics.scanpath_deg).toBe(0);
    expect(metrics.aoi_transitions).toBe(0);
    expect(metrics.quality_notes).toEqual([]);
  });

  it("reports missing gaze and no angular metrics without geometry", () => {
    const samples = Array.from({ length: 10 }, (_, index) =>
      index < 5 ? sample(index + 1, index * 100, 500, 500) : sample(index + 1, index * 100, null, null, false)
    );
    const metrics = computeTrialMetrics(
      { trial_id: "t2", menu_id: "B", start_ms: 0, end_ms: 1000, target_aoi_id: "full" },
      samples,
      [fullViewport],
      null
    );
    expect(metrics.missing_pct).toBe(50);
    expect(metrics.fixation_count).toBeNull();
    expect(metrics.time_to_first_fixation_ms).toBeNull();
    expect(metrics.scanpath_px).toBeNull();
    expect(metrics.aoi_transitions).toBeNull();
    expect(metrics.quality_notes).toContain("screen_geometry_missing_no_angular_metrics");
    expect(metrics.quality_notes).toContain("missing_gaze_over_threshold");
  });

  it("does not credit an interval to an AOI when the next sample left it", () => {
    const samples = [sample(1, 0, 500, 500), sample(2, 100, 2000, 500), sample(3, 200, 500, 500)];
    const metrics = computeTrialMetrics(
      { trial_id: "t4", menu_id: "C", start_ms: 0, end_ms: 200, target_aoi_id: "full" },
      samples,
      [fullViewport],
      GEOMETRY
    );
    expect(metrics.aoi_dwell[0]).toMatchObject({ aoi_id: "full", sample_count: 2, dwell_ms: 100 });
  });

  it("does not credit dwell across a gap above the configured maximum", () => {
    const samples = [sample(1, 0, 500, 500), sample(2, 500, 500, 500)];
    const metrics = computeTrialMetrics(
      { trial_id: "t3", menu_id: "C", start_ms: 0, end_ms: 500 },
      samples,
      [fullViewport],
      GEOMETRY,
      { maxGapMs: 100 }
    );
    expect(metrics.aoi_dwell[0]?.dwell_ms).toBe(0);
    expect(metrics.aoi_dwell[0]?.sample_count).toBe(2);
  });
});
