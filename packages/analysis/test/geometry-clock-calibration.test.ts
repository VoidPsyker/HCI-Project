import { describe, expect, it } from "vitest";
import {
  ClockSynchronizer,
  angularDistanceDeg,
  angularVelocityDegS,
  ninePointTargets,
  pingPongEstimate,
  summarizeCalibration
} from "../src/index";
import { GEOMETRY, TARGETS, observationsAtTargets, VIEWPORT } from "./helpers";

describe("screen geometry", () => {
  it("computes angular distance only with measured geometry", () => {
    expect(angularDistanceDeg({ x_px: 0, y_px: 0 }, { x_px: 100, y_px: 0 }, GEOMETRY)).toBeCloseTo(5.7682, 3);
    expect(angularDistanceDeg({ x_px: 0, y_px: 0 }, { x_px: 100, y_px: 0 }, null)).toBeNull();
    expect(angularVelocityDegS({ x_px: 0, y_px: 0 }, { x_px: 100, y_px: 0 }, 500, GEOMETRY)).toBeCloseTo(11.5364, 3);
    expect(angularVelocityDegS({ x_px: 0, y_px: 0 }, { x_px: 100, y_px: 0 }, 0, GEOMETRY)).toBeNull();
  });

  it("uses exact eye-to-point rays, so equal pixel steps shrink toward the edge", () => {
    const centre = angularDistanceDeg({ x_px: 500, y_px: 500 }, { x_px: 600, y_px: 500 }, GEOMETRY);
    const edge = angularDistanceDeg({ x_px: 0, y_px: 500 }, { x_px: 100, y_px: 500 }, GEOMETRY);
    expect(centre).toBeCloseTo(11.3099, 3);
    expect(edge).toBeCloseTo(6.3402, 3);
    expect(edge).toBeLessThan(centre!);
  });

  it("rejects impossible geometry instead of guessing", () => {
    expect(() => angularDistanceDeg({ x_px: 0, y_px: 0 }, { x_px: 1, y_px: 1 }, { ...GEOMETRY, width_mm: 0 })).toThrow(
      "screen_width_mm_invalid"
    );
    expect(() =>
      angularDistanceDeg({ x_px: 0, y_px: 0 }, { x_px: 1, y_px: 1 }, { ...GEOMETRY, viewing_distance_mm: 0 })
    ).toThrow("viewing_distance_mm_invalid");
  });
});

describe("clock synchronization", () => {
  it("maps a perfect source clock", () => {
    const clock = new ClockSynchronizer();
    clock.addPair(1000, 5000);
    clock.addPair(2000, 6000);
    clock.addPair(3000, 7000);
    expect(clock.toLocal(1500)).toBeCloseTo(5500, 6);
    expect(clock.toSource(5500)).toBeCloseTo(1500, 6);
    const report = clock.report();
    expect(report.offset_ms).toBeCloseTo(4000, 6);
    expect(report.drift_ppm).toBeCloseTo(0, 6);
    expect(report.synchronized).toBe(true);
  });

  it("reports drift and residual rather than hiding jitter", () => {
    const clock = new ClockSynchronizer();
    for (let i = 0; i < 10; i += 1) {
      const source = i * 1000;
      const noise = i % 2 === 0 ? 1 : -1;
      clock.addPair(source, source * 1.001 + 100 + noise);
    }
    const report = clock.report();
    expect(report.pairs).toBe(10);
    expect(report.drift_ppm).toBeGreaterThan(900);
    expect(report.drift_ppm).toBeLessThan(1100);
    expect(report.residual_ms).toBeGreaterThan(0);
    expect(report.max_residual_ms).toBeGreaterThanOrEqual(report.residual_ms!);
  });

  it("computes an NTP-style ping/pong offset and RTT", () => {
    const estimate = pingPongEstimate({ t0_local_ms: 1000, t1_source_ms: 5100, t2_source_ms: 5105, t3_local_ms: 1010 });
    expect(estimate.offset_ms).toBeCloseTo(4097.5, 6);
    expect(estimate.rtt_ms).toBeCloseTo(5, 6);
    expect(estimate.source_ms).toBeCloseTo(5102.5, 6);
    expect(estimate.local_ms).toBeCloseTo(1005, 6);
  });

  it("is not synchronized before enough pairs", () => {
    const clock = new ClockSynchronizer("ping_pong");
    expect(clock.report().synchronized).toBe(false);
    clock.addPair(10, 20, 4);
    const report = clock.report();
    expect(report.synchronized).toBe(false);
    expect(report.median_rtt_ms).toBe(4);
  });
});

describe("9-point calibration", () => {
  it("builds a 3x3 grid at 10/50/90 percent", () => {
    const targets = ninePointTargets(VIEWPORT);
    expect(targets).toHaveLength(9);
    expect(targets[0]).toMatchObject({ id: "p1", order: 1, x_px: 100, y_px: 100 });
    expect(targets[4]).toMatchObject({ id: "p5", order: 5, x_px: 500, y_px: 500 });
    expect(targets[8]).toMatchObject({ id: "p9", order: 9, x_px: 900, y_px: 900 });
    expect(new Set(targets.map((target) => target.id)).size).toBe(9);
  });

  it("passes a perfect held-out validation with geometry", () => {
    const report = summarizeCalibration(TARGETS, observationsAtTargets(TARGETS), GEOMETRY);
    expect(report.passes).toBe(true);
    expect(report.target_count).toBe(9);
    expect(report.repetitions_per_target).toBe(5);
    expect(report.max_error_px).toBe(0);
    expect(report.max_error_deg).toBe(0);
    expect(report.angular_available).toBe(true);
  });

  it("applies the 1.5 degree gate per participant", () => {
    const passing = summarizeCalibration(TARGETS, observationsAtTargets(TARGETS, 5, 10), GEOMETRY);
    expect(passing.max_error_deg).toBeCloseTo(1.1458, 3);
    expect(passing.passes).toBe(true);
    const failing = summarizeCalibration(TARGETS, observationsAtTargets(TARGETS, 5, 20), GEOMETRY);
    expect(failing.max_error_deg).toBeCloseTo(2.2904, 3);
    expect(failing.passes).toBe(false);
  });

  it("fails when a point is missing and is not evaluable without geometry", () => {
    const incomplete = summarizeCalibration(TARGETS, observationsAtTargets(TARGETS).filter((o) => o.target_id !== "p9"), GEOMETRY);
    expect(incomplete.passes).toBe(false);
    const noGeometry = summarizeCalibration(TARGETS, observationsAtTargets(TARGETS), null);
    expect(noGeometry.passes).toBeNull();
    expect(noGeometry.max_error_deg).toBeNull();
    expect(noGeometry.angular_available).toBe(false);
    expect(noGeometry.note).toMatch(/not evaluable/i);
  });

  it("counts observations for unknown targets instead of silently accepting them", () => {
    const report = summarizeCalibration(
      TARGETS,
      [...observationsAtTargets(TARGETS), { target_id: "not-a-target", x_px: 1, y_px: 1 }],
      GEOMETRY
    );
    expect(report.unknown_observations).toBe(1);
  });

  it("rejects duplicate target ids and non-finite observations", () => {
    expect(() => summarizeCalibration([...TARGETS, TARGETS[0]!], observationsAtTargets(TARGETS), GEOMETRY)).toThrow(
      "calibration_target_id_duplicate"
    );
    expect(() =>
      summarizeCalibration(TARGETS, [{ target_id: "p1", x_px: Number.NaN, y_px: 100 }], GEOMETRY)
    ).toThrow("calibration_observation_non_finite");
  });
});
