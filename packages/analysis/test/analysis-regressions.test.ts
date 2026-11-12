import { expect, it } from "vitest";
import { classifyFixations, computeTrialMetrics } from "../src/index";
import { GEOMETRY, consent, sample } from "./helpers";

const trial = { trial_id: "t1", menu_id: "A", start_ms: 0, end_ms: 300 };
const aoi = { id: "a", label: "A", role: "other" as const, rect: { x_px: 0, y_px: 0, width_px: 100, height_px: 100 } };

it("does not bridge invalid observations for dwell or fixations", () => {
  const samples = [sample(1, 0, 50, 50), sample(2, 100, null, null, false), sample(3, 200, 50, 50)];
  const metrics = computeTrialMetrics(trial, samples, [aoi], GEOMETRY);
  expect(metrics.aoi_dwell[0]?.dwell_ms).toBe(100);
  expect(metrics.fixation_count).toBe(0);
});
it("clips dwell to an AOI's active interval", () => {
  const metrics = computeTrialMetrics(trial, [sample(1, 0, 50, 50), sample(2, 300, 50, 50)],
    [{ ...aoi, active_to_ms: 50 }], GEOMETRY);
  expect(metrics.aoi_dwell[0]?.dwell_ms).toBe(50);
});
it("honors explicit trial attribution at adjacent trial boundaries", () => {
  const metrics = computeTrialMetrics(trial, [
    { ...sample(1, 0, 50, 50), trial_id: "previous" },
    { ...sample(2, 100, 50, 50), trial_id: "t1" }
  ], [aoi], GEOMETRY);
  expect(metrics.total_samples).toBe(1);
});
it("keeps the final stationary endpoint before a saccade", () => {
  const result = classifyFixations([sample(1, 0, 50, 50), sample(2, 50, 50, 50),
    sample(3, 100, 50, 50), sample(4, 110, 900, 900)], GEOMETRY);
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.fixations).toMatchObject([{ start_ms: 0, end_ms: 100, duration_ms: 100, sample_count: 3, mean_velocity_deg_s: 0 }]);
});
it("keeps empty metrics explicitly missing", () => {
  const metrics = computeTrialMetrics(trial, [], [], GEOMETRY);
  expect(metrics.missing_pct).toBeNull();
  expect(metrics.fixation_count).toBeNull();
  expect(metrics.aoi_dwell).toEqual([]);
});

it("measures acquisition rate within trials rather than counting breaks between trials", async () => {
  const { auditGazeQuality, ClockSynchronizer } = await import("../src/index");
  const { calibration, sourceInfo, VIEWPORT } = await import("./helpers");
  const trials = [{ trial_id: "one", menu_id: "A", start_ms: 0, end_ms: 100 },
    { trial_id: "two", menu_id: "A", start_ms: 10000, end_ms: 10100 }];
  const samples = trials.flatMap(t => [0, 50, 100].map((dt, i) => ({ ...sample(i + 1, t.start_ms + dt, 50, 50), trial_id: t.trial_id })));
  const report = auditGazeQuality({ participant_id: "P001", session_id: "S001", source: sourceInfo(),
    consent: consent(), geometry: GEOMETRY, viewport: VIEWPORT, calibration: calibration(),
    clock: ClockSynchronizer.sameClock().report(), samples, trials }, { minimum_sample_rate_hz: 15 });
  expect(report.effective_sample_rate_hz).toBe(20);
  expect(report.analysis_ready).toBe(true);
});

it("does not classify a fixation across an explicitly disallowed gap", () => {
  const metrics = computeTrialMetrics(trial, [sample(1, 0, 50, 50), sample(2, 300, 50, 50)], [aoi], GEOMETRY, { maxGapMs: 100 });
  expect(metrics.fixation_count).toBe(0);
});
