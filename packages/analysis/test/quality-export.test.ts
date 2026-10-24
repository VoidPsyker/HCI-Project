import { describe, expect, it } from "vitest";
import {
  ClockSynchronizer,
  auditGazeQuality,
  buildGazeExport,
  computeTrialMetrics,
  parseGazeSamplesJsonl,
  summarizeCalibration
} from "../src/index";
import type { GazeConsent, GazeSample, GazeQualityReport } from "../src/index";
import { GEOMETRY, TARGETS, VIEWPORT, calibration, consent, observationsAtTargets, sample, sourceInfo } from "./helpers";

function regularSamples(count = 100, missingEvery = 0): GazeSample[] {
  return Array.from({ length: count }, (_, index) =>
    missingEvery > 0 && index % missingEvery === 0
      ? sample(index + 1, index * 10, null, null, false)
      : sample(index + 1, index * 10, 500, 500)
  );
}

function quality(
  overrides: {
    source?: ReturnType<typeof sourceInfo>;
    consent?: GazeConsent | null;
    samples?: GazeSample[];
    calibration?: ReturnType<typeof calibration> | null;
    geometry?: typeof GEOMETRY | null;
    clock?: ReturnType<ClockSynchronizer["report"]>;
    config?: Parameters<typeof auditGazeQuality>[1];
  } = {}
): GazeQualityReport {
  return auditGazeQuality(
    {
      source: overrides.source ?? sourceInfo(),
      consent: overrides.consent === undefined ? consent() : overrides.consent,
      participant_id: "P001",
      session_id: "S001",
      samples: overrides.samples ?? regularSamples(),
      calibration: overrides.calibration === undefined ? calibration() : overrides.calibration,
      geometry: overrides.geometry === undefined ? GEOMETRY : overrides.geometry,
      viewport: VIEWPORT,
      clock: overrides.clock ?? ClockSynchronizer.sameClock().report()
    },
    overrides.config
  );
}

describe("gaze quality", () => {
  it("passes the plan gates only when calibration, geometry and missingness pass", () => {
    const report = quality();
    expect(report.overall).toBe("pass");
    expect(report.analysis_ready).toBe(true);
    expect(report.angular_metrics_ready).toBe(true);
    expect(report.missing_pct).toBe(0);
    expect(report.effective_sample_rate_hz).toBeCloseTo(100, 6);
    expect(report.thresholds).toMatchObject({ calibration_points: 9, calibration_error_deg: 1.5, missing_pct: 20 });
  });

  it("fails when more than 20 percent of gaze is missing", () => {
    const report = quality({ samples: regularSamples(100, 4) });
    expect(report.missing_pct).toBe(25);
    expect(report.overall).toBe("fail");
    expect(report.analysis_ready).toBe(false);
    expect(report.exclusions).toContain("missing_gaze_gt_20");
  });

  it("fails when callbacks stop even though every received sample is valid", () => {
    const samples = [...regularSamples(10), sample(11, 1000, 500, 500)];
    const report = quality({ samples });
    expect(report.missing_pct).toBe(0);
    expect(report.dropout_count).toBe(1);
    expect(report.coverage_pct).toBeCloseTo(10, 6);
    expect(report.overall).toBe("fail");
    expect(report.exclusions).toContain("sample_coverage_lt_80");
  });

  it("uses n-1 valid intervals for the effective rate", () => {
    const report = quality({ samples: regularSamples(100) });
    expect(report.effective_sample_rate_hz).toBeCloseTo(100, 6);
    expect(report.coverage_pct).toBeCloseTo(100, 6);
  });

  it("fails calibration observations that do not match a target", () => {
    const withUnknown = summarizeCalibration(
      TARGETS,
      [...observationsAtTargets(TARGETS), { target_id: "typo", x_px: 500, y_px: 500 }],
      GEOMETRY
    );
    const report = quality({ calibration: withUnknown });
    expect(report.overall).toBe("fail");
    expect(report.exclusions).toContain("calibration_unknown_observations");
  });

  it("fails when a calibration point is missing", () => {
    const report = quality({ calibration: calibration({ targets: TARGETS.slice(0, 8) }) });
    expect(report.overall).toBe("fail");
    expect(report.exclusions).toContain("calibration_points_incomplete");
  });

  it("fails the 1.5 degree gate on measured held-out error, regardless of device model", () => {
    const report = quality({ calibration: calibration({ offsetPx: 20 }) });
    const check = report.checks.find((item) => item.id === "calibration_error_deg");
    expect(check?.status).toBe("fail");
    expect(check?.value).toContain("2.29");
    expect(report.overall).toBe("fail");
  });

  it("is not evaluable without measured geometry rather than fabricating degrees", () => {
    const report = quality({ calibration: calibration({ geometry: null }), geometry: null });
    expect(report.overall).toBe("not_evaluable");
    expect(report.analysis_ready).toBe(false);
    expect(report.angular_metrics_ready).toBe(false);
    expect(report.checks.find((item) => item.id === "calibration_error_deg")?.status).toBe("not_evaluable");
    expect(report.exclusions).toContain("calibration_error_not_evaluable");
  });

  it("allows a configured sample-rate floor without inventing a 120 Hz webcam claim", () => {
    const slowSamples = Array.from({ length: 10 }, (_, index) => sample(index + 1, index * 100, 500, 500));
    const low = quality({ samples: slowSamples, config: { minimum_sample_rate_hz: 30 } });
    expect(low.checks.find((item) => item.id === "effective_sample_rate_hz")?.status).toBe("fail");
    expect(low.overall).toBe("fail");
    expect(low.exclusions).toContain("sample_rate_lt_30");
    const info = quality({ samples: regularSamples(10) });
    expect(info.checks.find((item) => item.id === "effective_sample_rate_hz")?.status).toBe("info");
  });

  it("fails invalid consent and missing raw-video guarantees", () => {
    const missing = quality({ consent: null });
    expect(missing.overall).toBe("fail");
    expect(missing.exclusions).toContain("gaze_consent_invalid");
    const unsafe = quality({ consent: { ...consent(), raw_video_retention: true } as unknown as GazeConsent });
    expect(unsafe.overall).toBe("fail");
    expect(unsafe.exclusions).toContain("raw_video_retention_not_false");
  });

  it("fails clock sync below the configured residual", () => {
    const clock = new ClockSynchronizer();
    for (let index = 0; index < 10; index += 1) clock.addPair(index * 1000, index * 1000 + (index % 2 === 0 ? 5 : -5), 10);
    const report = quality({ clock: clock.report(), config: { max_clock_residual_ms: 1 } });
    expect(report.checks.find((item) => item.id === "clock_sync_residual_ms")?.status).toBe("fail");
    expect(report.overall).toBe("fail");
  });

  it("marks synthetic data as never analysis-ready", () => {
    const report = quality({
      source: sourceInfo({ kind: "synthetic", synthetic: true, hardware_backed: false, device: "synthetic replay" }),
      consent: null
    });
    expect(report.overall).toBe("not_evaluable");
    expect(report.analysis_ready).toBe(false);
    expect(report.exclusions).toContain("synthetic_source_test_only");
  });
});

describe("restricted gaze export", () => {
  const metrics = computeTrialMetrics(
    { trial_id: "t1", menu_id: "A", start_ms: 0, end_ms: 990, target_aoi_id: "full" },
    regularSamples(100),
    [{ id: "full", label: "Full", role: "menu_region", rect: { x_px: 0, y_px: 0, width_px: 1000, height_px: 1000 } }],
    GEOMETRY
  );

  it("separates gaze from clicks and marks the export restricted", () => {
    const bundle = buildGazeExport({
      participant_id: "P001",
      session_id: "S001",
      created_at: "2026-10-24T12:00:00.000Z",
      source: sourceInfo(),
      consent: consent(),
      samples: regularSamples(100),
      calibration: calibration(),
      geometry: GEOMETRY,
      viewport: VIEWPORT,
      clock: ClockSynchronizer.sameClock().report(),
      metrics: [metrics],
      quality: quality()
    });
    expect(bundle.manifest.schema_version).toBe("meridian.gaze/1");
    expect(bundle.manifest.synthetic).toBe(false);
    expect(bundle.manifest.human_data).toBe(true);
    expect(bundle.manifest.contains_click_events).toBe(false);
    expect(bundle.manifest.contains_raw_video).toBe(false);
    expect(bundle.manifest.restricted_access).toBe(true);
    expect(bundle.manifest.streams).toEqual({
      samples: "gaze_samples.jsonl",
      aoi_metrics: "aoi_metrics.jsonl",
      quality: "gaze_quality.json"
    });
    expect(bundle.samples_jsonl.split("\n").filter(Boolean)).toHaveLength(100);
    expect(bundle.samples_jsonl).not.toMatch(/click|element_id|event_type/i);
    expect(parseGazeSamplesJsonl(bundle.samples_jsonl)).toHaveLength(100);
    expect(JSON.parse(bundle.aoi_metrics_jsonl)).toMatchObject({ trial_id: "t1" });
  });

  it("refuses a human export without separate gaze consent", () => {
    expect(() =>
      buildGazeExport({
        participant_id: "P001",
        session_id: "S001",
        source: sourceInfo(),
        consent: null,
        samples: [],
        calibration: null,
        geometry: null,
        viewport: VIEWPORT,
        clock: ClockSynchronizer.sameClock().report(),
        metrics: [],
        quality: quality()
      })
    ).toThrow("gaze_consent_required");
  });

  it("refuses a media payload even if a caller smuggles one in", () => {
    const smuggled = { ...sample(1, 0, 1, 1), video: "frame" } as unknown as GazeSample;
    expect(() =>
      buildGazeExport({
        participant_id: "P001",
        session_id: "S001",
        source: sourceInfo(),
        consent: consent(),
        samples: [smuggled],
        calibration: calibration(),
        geometry: GEOMETRY,
        viewport: VIEWPORT,
        clock: ClockSynchronizer.sameClock().report(),
        metrics: [],
        quality: quality()
      })
    ).toThrow("gaze_export_forbidden_field_video");
  });

  it("flags a synthetic export explicitly", () => {
    const syntheticSource = sourceInfo({ kind: "synthetic", synthetic: true, hardware_backed: false, device: "synthetic replay" });
    const bundle = buildGazeExport({
      participant_id: "SYNTHETIC",
      session_id: "SYNTHETIC-1",
      source: syntheticSource,
      consent: null,
      samples: regularSamples(2),
      calibration: null,
      geometry: null,
      viewport: VIEWPORT,
      clock: ClockSynchronizer.sameClock().report(),
      metrics: [],
      quality: quality({ source: syntheticSource, consent: null, calibration: null, geometry: null })
    });
    expect(bundle.manifest.synthetic).toBe(true);
    expect(bundle.manifest.human_data).toBe(false);
    expect(bundle.manifest.analysis_ready).toBe(false);
    expect(bundle.manifest.consent).toBeNull();
  });

  it("excludes intertrial rest gaps from dropouts when trials are provided", () => {
    // Trial 1: 0..1000 ms (samples every 10 ms)
    const trial1Samples = Array.from({ length: 101 }, (_, i) => sample(i + 1, i * 10, 500, 500, true));
    // Rest gap from 1000 to 30000 ms (29 seconds of rest)
    // Trial 2: 30000..31000 ms (samples every 10 ms)
    const trial2Samples = Array.from({ length: 101 }, (_, i) => sample(102 + i, 30000 + i * 10, 500, 500, true));
    const samples = [...trial1Samples, ...trial2Samples];
    const trials = [
      { trial_id: "trial-1", menu_id: "A", start_ms: 0, end_ms: 1000, target_aoi_id: null },
      { trial_id: "trial-2", menu_id: "B", start_ms: 30000, end_ms: 31000, target_aoi_id: null }
    ];

    const report = auditGazeQuality({
      source: sourceInfo(),
      consent: consent(),
      participant_id: "P001",
      session_id: "S001",
      samples,
      calibration: calibration(),
      geometry: GEOMETRY,
      viewport: VIEWPORT,
      clock: ClockSynchronizer.sameClock().report(),
      trials
    });

    expect(report.dropout_count).toBe(0);
    expect(report.coverage_pct).toBe(100);
    expect(report.overall).toBe("pass");
  });

  it("fails quality when a terminal sensor stall occurs before the trial window ends", () => {
    // Trial duration 2000 ms (0..2000), but samples stop arriving at 500 ms (1500 ms terminal stall)
    const samples = Array.from({ length: 51 }, (_, i) => sample(i + 1, i * 10, 500, 500, true));
    const trials = [
      { trial_id: "trial-stall", menu_id: "A", start_ms: 0, end_ms: 2000, target_aoi_id: null }
    ];

    const report = auditGazeQuality({
      source: sourceInfo(),
      consent: consent(),
      participant_id: "P001",
      session_id: "S001",
      samples,
      calibration: calibration(),
      geometry: GEOMETRY,
      viewport: VIEWPORT,
      clock: ClockSynchronizer.sameClock().report(),
      trials
    });

    expect(report.dropout_count).toBeGreaterThanOrEqual(1);
    expect(report.longest_gap_ms).toBeGreaterThanOrEqual(1500);
    expect(report.coverage_pct).toBeLessThan(80);
    expect(report.overall).toBe("fail");
    expect(report.exclusions).toContain("sample_coverage_lt_80");
  });

  it("fails quality when an empty trial has no delivered samples", () => {
    // Trial 1 has samples; Trial 2 has zero samples across 2000 ms
    const samples = Array.from({ length: 101 }, (_, i) => sample(i + 1, i * 10, 500, 500, true));
    const trials = [
      { trial_id: "trial-1", menu_id: "A", start_ms: 0, end_ms: 1000, target_aoi_id: null },
      { trial_id: "trial-empty", menu_id: "B", start_ms: 2000, end_ms: 4000, target_aoi_id: null }
    ];

    const report = auditGazeQuality({
      source: sourceInfo(),
      consent: consent(),
      participant_id: "P001",
      session_id: "S001",
      samples,
      calibration: calibration(),
      geometry: GEOMETRY,
      viewport: VIEWPORT,
      clock: ClockSynchronizer.sameClock().report(),
      trials
    });

    expect(report.dropout_count).toBeGreaterThanOrEqual(1);
    expect(report.coverage_pct).toBeLessThan(80);
    expect(report.overall).toBe("fail");
  });
});
