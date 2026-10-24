import { describe, expect, it } from "vitest";
import {
  ClockSynchronizer,
  GazeSession,
  SyntheticGazeSource,
  isSyntheticReplayRecording,
  replaySyntheticRecording
} from "../src/index";
import type {
  ClockSyncReport,
  GazeConsent,
  GazeSample,
  GazeSampleListener,
  GazeSource,
  GazeSourceInfo,
  GazeSourceStatus,
  SyntheticReplayRecording
} from "../src/index";
import { GEOMETRY, VIEWPORT, calibration, consent, sample, sourceInfo } from "./helpers";

class ManualSource implements GazeSource {
  readonly info: GazeSourceInfo = sourceInfo();
  status: GazeSourceStatus = "idle";
  startCalls = 0;
  stopCalls = 0;
  stopShouldFail = false;
  private listeners = new Set<GazeSampleListener>();

  get clock(): ClockSyncReport {
    return ClockSynchronizer.sameClock().report();
  }

  async start(_consent: GazeConsent | null): Promise<void> {
    this.startCalls += 1;
    this.status = "running";
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.status = "stopped";
    if (this.stopShouldFail) throw new Error("stop_failed");
  }

  async pause(): Promise<void> {
    this.status = "paused";
  }

  async resume(): Promise<void> {
    this.status = "running";
  }

  subscribe(listener: GazeSampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(samples: readonly GazeSample[]): void {
    for (const item of samples) for (const listener of this.listeners) listener(item);
  }
}

const fullViewport = {
  id: "full",
  label: "Full viewport",
  role: "menu_region" as const,
  rect: { x_px: 0, y_px: 0, width_px: 1000, height_px: 1000 }
};

function session(source: GazeSource, gazeConsent: GazeConsent | null): GazeSession {
  return new GazeSession({
    participant_id: "P001",
    session_id: "S001",
    source,
    consent: gazeConsent,
    viewport: VIEWPORT,
    geometry: GEOMETRY,
    now: () => 0
  });
}

describe("GazeSession", () => {
  it("links samples to a trial, computes metrics, and exports restricted streams", async () => {
    const source = new ManualSource();
    const gaze = session(source, consent());
    await gaze.start();
    gaze.setAois([fullViewport]);
    gaze.setCalibration(calibration());
    gaze.startTrial({ trial_id: "t1", menu_id: "A", target_aoi_id: "full", start_ms: 0 });
    source.emit(Array.from({ length: 11 }, (_, index) => sample(index + 1, index * 100, 500, 500)));
    const metrics = gaze.endTrial({ trial_id: "t1", end_ms: 1000 });
    expect(metrics.valid_samples).toBe(11);
    expect(metrics.aoi_dwell[0]?.dwell_ms).toBe(1000);
    expect(gaze.getSamples().every((item) => item.trial_id === "t1")).toBe(true);

    const bundle = gaze.buildExport("2026-10-24T12:00:00.000Z");
    expect(bundle.manifest.counts).toEqual({ samples: 11, valid_samples: 11, trials: 1 });
    expect(bundle.manifest.quality_overall).toBe("pass");
    expect(bundle.manifest.analysis_ready).toBe(true);
    expect(bundle.manifest.contains_click_events).toBe(false);
    await gaze.stop();
    expect(source.stopCalls).toBe(1);
  });

  it("refuses to start a human source without separate gaze consent", async () => {
    const source = new ManualSource();
    const gaze = session(source, null);
    await expect(gaze.start()).rejects.toThrow("gaze_consent_required");
    expect(source.startCalls).toBe(0);
  });

  it("still clears in-memory gaze data when source shutdown fails on withdrawal", async () => {
    const source = new ManualSource();
    source.stopShouldFail = true;
    const gaze = session(source, consent());
    await gaze.start();
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 0 });
    source.emit([sample(1, 10, 500, 500)]);
    await expect(gaze.withdraw()).rejects.toThrow("stop_failed");
    expect(gaze.getSamples()).toHaveLength(0);
    expect(() => gaze.getQuality()).toThrow("gaze_session_withdrawn");
  });

  it("retains only active-trial samples for human sources", async () => {
    const source = new ManualSource();
    const gaze = session(source, consent());
    await gaze.start();
    source.emit([sample(1, 0, 500, 500)]);
    expect(gaze.getSamples()).toHaveLength(0);
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 10 });
    source.emit([sample(2, 20, 500, 500)]);
    expect(gaze.getSamples()).toHaveLength(1);
    gaze.endTrial({ trial_id: "t1", end_ms: 30 });
    source.emit([sample(3, 40, 500, 500)]);
    expect(gaze.getSamples()).toHaveLength(1);
  });

  it("rejects non-monotonic or malformed samples and fails quality", async () => {
    const source = new ManualSource();
    const gaze = session(source, consent());
    await gaze.start();
    gaze.setCalibration(calibration());
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 0 });
    source.emit([
      sample(2, 10, 500, 500),
      sample(1, 20, 500, 500),
      { ...sample(3, 30, 500, 500), t_ms: Number.NaN }
    ]);
    expect(gaze.getSamples()).toHaveLength(1);
    expect(gaze.getRejectedSampleCount()).toBe(2);
    const report = gaze.getQuality();
    expect(report.overall).toBe("fail");
    expect(report.exclusions).toContain("sample_trust_boundary_rejected");
  });

  it("bounds retained samples and reports capacity drops", async () => {
    const source = new ManualSource();
    const gaze = new GazeSession({
      participant_id: "P001",
      session_id: "S001",
      source,
      consent: consent(),
      viewport: VIEWPORT,
      geometry: GEOMETRY,
      now: () => 0,
      max_samples: 1
    });
    await gaze.start();
    gaze.setCalibration(calibration());
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 0 });
    source.emit([sample(1, 10, 500, 500), sample(2, 20, 500, 500)]);
    expect(gaze.getSamples()).toHaveLength(1);
    expect(gaze.getDroppedSampleCount()).toBe(1);
    expect(gaze.getQuality().exclusions).toContain("sample_retention_overflow");
  });

  it("refuses overlapping trial windows", async () => {
    const source = new ManualSource();
    const gaze = session(source, consent());
    await gaze.start();
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 0 });
    gaze.endTrial({ trial_id: "t1", end_ms: 100 });
    expect(() => gaze.startTrial({ trial_id: "t2", menu_id: "A", start_ms: 99 })).toThrow("gaze_trial_overlap");
    expect(() => gaze.startTrial({ trial_id: "t2", menu_id: "A", start_ms: 100 })).not.toThrow();
  });

  it("refuses to export while a trial is open", async () => {
    const source = new ManualSource();
    const gaze = session(source, consent());
    await gaze.start();
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 0 });
    expect(() => gaze.buildExport()).toThrow("gaze_trial_active");
  });

  it("stops acquisition and destroys in-memory data on withdrawal", async () => {
    const source = new ManualSource();
    const gaze = session(source, consent());
    await gaze.start();
    gaze.startTrial({ trial_id: "t1", menu_id: "A", start_ms: 0 });
    source.emit([sample(1, 0, 500, 500)]);
    expect(gaze.getSamples()).toHaveLength(1);
    await gaze.withdraw();
    expect(gaze.getSamples()).toHaveLength(0);
    expect(source.stopCalls).toBe(1);
    expect(() => gaze.buildExport()).toThrow("gaze_session_withdrawn");
    await expect(gaze.start()).rejects.toThrow("gaze_session_withdrawn");
  });
});

describe("synthetic replay", () => {
  const recording: SyntheticReplayRecording = {
    kind: "synthetic_replay",
    synthetic: true,
    provenance: "synthetic",
    description: "Unit-test fixture only; not participant data.",
    source: {
      kind: "synthetic",
      adapter: "synthetic-replay",
      device: "synthetic fixture",
      nominal_hz: 10,
      hardware_backed: false,
      synthetic: true,
      capabilities: ["gaze"]
    },
    viewport: VIEWPORT,
    geometry: GEOMETRY,
    samples: Array.from({ length: 11 }, (_, index) => ({
      t_source_ms: index * 100,
      x_px: 500,
      y_px: 500
    }))
  };

  it("requires the explicit synthetic marker and replays on a same-clock timeline", () => {
    expect(isSyntheticReplayRecording(recording)).toBe(true);
    expect(isSyntheticReplayRecording({ ...recording, synthetic: false })).toBe(false);
    const samples = replaySyntheticRecording(recording);
    expect(samples).toHaveLength(11);
    expect(samples[0]).toMatchObject({ seq: 1, t_ms: 0, t_source_ms: 0, valid: true });
    expect(() =>
      replaySyntheticRecording({ ...recording, source: { ...recording.source, synthetic: false } } as unknown as SyntheticReplayRecording)
    ).toThrow(/synthetic/i);
  });

  it("emits through GazeSession but never becomes analysis-ready", async () => {
    const source = new SyntheticGazeSource(recording);
    const gaze = session(source, null);
    await gaze.start();
    gaze.setAois([fullViewport]);
    gaze.setCalibration(calibration());
    gaze.startTrial({ trial_id: "synthetic-1", menu_id: "A", start_ms: 0 });
    // The synthetic source emits synchronously during start; trial attribution is
    // still tested by the explicit window metric rather than sample linkage.
    const metrics = gaze.endTrial({ trial_id: "synthetic-1", end_ms: 1000 });
    expect(metrics.valid_samples).toBe(11);
    const bundle = gaze.buildExport("2026-10-24T12:00:00.000Z");
    expect(bundle.manifest.synthetic).toBe(true);
    expect(bundle.manifest.human_data).toBe(false);
    expect(bundle.manifest.analysis_ready).toBe(false);
    expect(bundle.manifest.quality_overall).toBe("not_evaluable");
  });
});
