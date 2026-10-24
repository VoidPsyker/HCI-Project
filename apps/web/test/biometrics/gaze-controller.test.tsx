import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type {
  CalibrationTarget,
  ClockSyncReport,
  GazeConsent,
  GazeSample,
  GazeSampleListener,
  GazeSourceInfo,
  GazeSourceStatus,
  ScreenGeometry,
  Viewport
} from "@meridian/analysis";
import { GazeController, type CalibrationCapableSource, type GazeControllerOptions } from "../../src/gaze/GazeController";
import type {
  GazeApi,
  GazeBatch,
  GazeBatchResponse,
  GazeCompleteResponse,
  GazeCompletionPayload,
  GazeConsentResponse
} from "../../src/gaze/gazeClient";
import { GazeCalibrationScreen } from "../../src/screens/GazeCalibration";

const TEST_VIEWPORT: Viewport = { width_px: 1920, height_px: 1080 };
const TEST_GEOMETRY: ScreenGeometry = {
  width_px: 1920,
  height_px: 1080,
  width_mm: 531.36,
  height_mm: 298.89,
  viewing_distance_mm: 600
};

const TEST_CONSENT: GazeConsent = {
  participant_id: "test-p1",
  session_id: "test-s1",
  granted_at: new Date().toISOString(),
  version: "1.0",
  scope: "eye_tracking_only",
  camera_used: true,
  raw_video_retention: false,
  separate_from_core_consent: true
};

class FakeGazeSource implements CalibrationCapableSource {
  readonly info: GazeSourceInfo = {
    kind: "webcam",
    adapter: "fake-adapter",
    device: "test-camera",
    nominal_hz: 60,
    hardware_backed: false,
    synthetic: false,
    capabilities: ["gaze"],
    notes: "unit test fake"
  };

  status: GazeSourceStatus = "idle";
  clock: ClockSyncReport = {
    method: "same_clock",
    offset_ms: 0,
    drift_ppm: null,
    residual_ms: 0,
    max_residual_ms: 0,
    median_rtt_ms: null,
    uncertainty_ms: null,
    pairs: 1,
    synchronized: true,
    note: "test"
  };

  listeners = new Set<GazeSampleListener>();
  startCalls = 0;
  stopCalls = 0;
  trainCalls: CalibrationTarget[] = [];
  startDeferred: { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } | null = null;
  sampleSeq = 0;

  async start(_consent: GazeConsent | null): Promise<void> {
    this.startCalls += 1;
    this.status = "starting";
    if (this.startDeferred) {
      await this.startDeferred.promise;
    }
    this.status = "running";
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.status = "stopped";
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

  async recordCalibrationTarget(target: CalibrationTarget): Promise<void> {
    this.trainCalls.push(target);
  }

  emit(sample: Partial<GazeSample>): void {
    this.sampleSeq += 1;
    const fullSample: GazeSample = {
      seq: this.sampleSeq,
      t_ms: sample.t_ms ?? performance.now(),
      t_source_ms: sample.t_source_ms ?? performance.now(),
      x_px: sample.x_px ?? 0,
      y_px: sample.y_px ?? 0,
      valid: sample.valid ?? true,
      ...(sample.invalid_reason ? { invalid_reason: sample.invalid_reason } : {}),
      trial_id: sample.trial_id ?? null
    };
    for (const listener of this.listeners) {
      listener(fullSample);
    }
  }
}

class FakeGazeApi implements GazeApi {
  consentDeferred: {
    promise: Promise<GazeConsentResponse>;
    resolve: (res: GazeConsentResponse) => void;
    reject: (err: Error) => void;
  } | null = null;

  async consent(input: {
    session_id: string;
    version: string;
    camera_used: boolean;
    synthetic: boolean;
    viewport: Viewport;
    geometry: ScreenGeometry;
    source: GazeSourceInfo;
  }): Promise<GazeConsentResponse> {
    if (this.consentDeferred) {
      return this.consentDeferred.promise;
    }
    return {
      ok: true,
      session_id: input.session_id,
      synthetic: false,
      token: "test-token-123",
      consent: {
        version: input.version,
        granted_at: new Date().toISOString(),
        scope: "eye_tracking_only",
        camera_used: input.camera_used,
        raw_video_retention: false,
        separate_from_core_consent: true
      }
    };
  }

  async batch(_sessionId: string, _token: string, batch: GazeBatch): Promise<GazeBatchResponse> {
    return {
      ok: true,
      accepted: batch.samples.length,
      duplicate: false,
      last_seq: batch.samples[batch.samples.length - 1]?.seq ?? 0
    };
  }

  async complete(_sessionId: string, _token: string, _payload: GazeCompletionPayload): Promise<GazeCompleteResponse> {
    return {
      ok: true,
      manifest: {},
      sample_count: 0,
      files: []
    };
  }
}

describe("GazeController regression tests", () => {
  let source: FakeGazeSource;
  let api: FakeGazeApi;
  let controllers: GazeController[];

  beforeEach(() => {
    source = new FakeGazeSource();
    api = new FakeGazeApi();
    controllers = [];
  });

  afterEach(async () => {
    await Promise.all(controllers.map((controller) => controller.stop()));
    cleanup();
  });

  function createController(options: Partial<GazeControllerOptions> = {}) {
    const controller = new GazeController({
      participant_id: "test-p1",
      session_id: "test-s1",
      consent: TEST_CONSENT,
      viewport: TEST_VIEWPORT,
      geometry: TEST_GEOMETRY,
      source,
      api,
      settleMs: 5,
      dwellMs: 25,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      viewportNow: () => TEST_VIEWPORT,
      ...options
    });
    controllers.push(controller);
    return controller;
  }

  async function calibratedController(options: Partial<GazeControllerOptions> = {}) {
    let point: CalibrationTarget | null = null;
    const controller = createController({
      wait: async (ms) => {
        if (ms === 25 && point) source.emit({ x_px: point.x_px, y_px: point.y_px, valid: true });
      },
      ...options
    });
    await controller.start();
    const targets = controller.beginCalibration();
    for (const target of targets) await controller.trainCalibrationTarget(target);
    for (const target of targets) {
      point = target;
      await controller.validateCalibrationTarget(target);
    }
    expect(controller.finishCalibration().passes).toBe(true);
    return controller;
  }

  it("invalidates calibration and stops capture after a mid-trial viewport change", async () => {
    let viewport = TEST_VIEWPORT;
    const onError = vi.fn();
    const controller = await calibratedController({ viewportNow: () => viewport, onError });
    await controller.beginTrial({ trial_id: "viewport-trial", menu_id: "A", target_product_id: "prod-1" });
    viewport = { ...TEST_VIEWPORT, width_px: TEST_VIEWPORT.width_px - 100 };
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(source.status).toBe("stopped"));
    expect(controller.calibrationGatePassed).toBe(false);
    expect(controller.report?.passes).toBe(false);
    expect(controller.report?.note).toBe("gaze_viewport_changed");
    expect(onError).toHaveBeenCalledWith("gaze_viewport_changed");
    viewport = TEST_VIEWPORT;
    await expect(controller.beginTrial({ trial_id: "after-restore", menu_id: "A", target_product_id: "prod-1" }))
      .rejects.toThrow("gaze_calibration_gate_not_passed");
    expect(controller.getQuality()?.analysis_ready).toBe(false);
  });

  it("latches a viewport change during asynchronous source startup and refuses calibration after restoration", async () => {
    let viewport = TEST_VIEWPORT;
    const onError = vi.fn();
    let resolveSourceStart!: () => void;
    source.startDeferred = {
      promise: new Promise<void>((resolve) => {
        resolveSourceStart = resolve;
      }),
      resolve: () => resolveSourceStart(),
      reject: vi.fn()
    };

    const controller = createController({ viewportNow: () => viewport, onError });
    const startPromise = controller.start();
    await waitFor(() => expect(source.startCalls).toBe(1));

    // Restore the geometry before the queued resize handler runs: the startup
    // event itself must latch because the source may already have initialized.
    viewport = { ...TEST_VIEWPORT, width_px: TEST_VIEWPORT.width_px - 100 };
    viewport = TEST_VIEWPORT;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(controller.status).toBe("stopped"));
    expect(onError).toHaveBeenCalledWith("gaze_viewport_changed");

    resolveSourceStart();
    await startPromise;

    expect(controller.status).toBe("stopped");
    expect(source.stopCalls).toBeGreaterThanOrEqual(1);
    expect(() => controller.beginCalibration()).toThrow("gaze_controller_not_ready");
    await expect(
      controller.beginTrial({ trial_id: "after-startup-resize", menu_id: "A", target_product_id: "prod-1" })
    ).rejects.toThrow("gaze_calibration_gate_not_passed");
  });

  it("cannot start another trial after stopping a calibrated controller", async () => {
    const controller = await calibratedController();
    await controller.stop();
    expect(controller.calibrationGatePassed).toBe(false);
    await expect(controller.beginTrial({ trial_id: "after-stop", menu_id: "A", target_product_id: "prod-1" }))
      .rejects.toThrow("gaze_calibration_gate_not_passed");
  });

  it("retries failed camera startup with its existing consent token", async () => {
    const originalConsent = api.consent.bind(api);
    const consent = vi.spyOn(api, "consent").mockImplementationOnce(originalConsent)
      .mockRejectedValue(new Error("gaze_unauthorized"));
    const originalStart = source.start.bind(source);
    const start = vi.spyOn(source, "start").mockRejectedValueOnce(new Error("permission_denied"))
      .mockImplementation(originalStart);
    const controller = createController();
    await expect(controller.start()).rejects.toThrow("permission_denied");
    await expect(controller.start()).resolves.toBeUndefined();
    expect(controller.status).toBe("ready");
    expect(consent).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  describe("Deferred-consent cancellation and startup guard", () => {
    it("invalidates late continuation on stop during delayed api.consent", async () => {
      let resolveConsent!: (res: GazeConsentResponse) => void;
      api.consentDeferred = {
        promise: new Promise<GazeConsentResponse>((res, rej) => {
          resolveConsent = res;
        }),
        resolve: (res) => resolveConsent(res),
        reject: vi.fn()
      };

      const controller = createController();
      expect(controller.status).toBe("idle");

      const startPromise = controller.start();
      expect(controller.status).toBe("starting");

      // User stops while awaiting server consent
      await controller.stop();
      expect(controller.status).toBe("stopped");

      // Delayed consent finally resolves
      resolveConsent({
        ok: true,
        session_id: "test-s1",
        synthetic: false,
        token: "late-token",
        consent: {
          version: "1.0",
          granted_at: new Date().toISOString(),
          scope: "eye_tracking_only",
          camera_used: true,
          raw_video_retention: false,
          separate_from_core_consent: true
        }
      });

      await startPromise;

      // Camera was NEVER started and status was NOT set to ready
      expect(source.startCalls).toBe(0);
      expect(controller.status).toBe("stopped");
      expect(controller.pendingUploads).toBe(0);
    });

    it("invalidates late continuation on withdraw during delayed api.consent", async () => {
      let resolveConsent!: (res: GazeConsentResponse) => void;
      api.consentDeferred = {
        promise: new Promise<GazeConsentResponse>((res, rej) => {
          resolveConsent = res;
        }),
        resolve: (res) => resolveConsent(res),
        reject: vi.fn()
      };

      const controller = createController();
      const startPromise = controller.start();
      expect(controller.status).toBe("starting");

      // Participant withdraws during delayed consent
      await controller.withdraw();
      expect(controller.status).toBe("withdrawn");

      // Delayed consent finishes
      resolveConsent({
        ok: true,
        session_id: "test-s1",
        synthetic: false,
        token: "late-token",
        consent: {
          version: "1.0",
          granted_at: new Date().toISOString(),
          scope: "eye_tracking_only",
          camera_used: true,
          raw_video_retention: false,
          separate_from_core_consent: true
        }
      });

      await startPromise;

      expect(source.startCalls).toBe(0);
      expect(controller.status).toBe("withdrawn");
    });

    it("preserves stopped terminal state when stop occurs while source startup is pending", async () => {
      let resolveSourceStart!: () => void;
      source.startDeferred = {
        promise: new Promise<void>((res) => {
          resolveSourceStart = res;
        }),
        resolve: () => resolveSourceStart(),
        reject: vi.fn()
      };

      const controller = createController();
      const startPromise = controller.start();

      // Give event loop tick to pass api.consent and reach source.start
      await new Promise((r) => setTimeout(r, 10));
      expect(source.startCalls).toBe(1);

      // Stop controller while source.start is pending
      const stopPromise = controller.stop();
      expect(controller.status).toBe("stopping");

      // Source finish startup
      resolveSourceStart();
      await stopPromise;
      await startPromise;

      // Terminal stopped status preserved, not overwritten to ready or failed
      expect(controller.status).toBe("stopped");
      expect(source.stopCalls).toBeGreaterThanOrEqual(1);
    });

    it("preserves withdrawn terminal state when withdraw occurs while source startup is pending", async () => {
      let resolveSourceStart!: () => void;
      source.startDeferred = {
        promise: new Promise<void>((res) => {
          resolveSourceStart = res;
        }),
        resolve: () => resolveSourceStart(),
        reject: vi.fn()
      };

      const controller = createController();
      const startPromise = controller.start();

      await new Promise((r) => setTimeout(r, 10));
      expect(source.startCalls).toBe(1);

      const withdrawPromise = controller.withdraw();
      expect(controller.status).toBe("withdrawn");

      resolveSourceStart();
      await withdrawPromise;
      await startPromise;

      expect(controller.status).toBe("withdrawn");
    });
  });

  describe("Two-pass calibration and 1.5° validation gate", () => {
    it("requires all known training targets before validation and freezes training afterward", async () => {
      const controller = createController();
      await controller.start();
      const targets = controller.beginCalibration();
      await expect(controller.validateCalibrationTarget(targets[0]!)).rejects.toThrow("gaze_training_incomplete");
      await expect(controller.trainCalibrationTarget({ ...targets[0]!, x_px: -1 })).rejects.toThrow("gaze_calibration_target_invalid");
      for (const target of targets) await controller.trainCalibrationTarget(target);
      await controller.validateCalibrationTarget(targets[0]!);
      await expect(controller.trainCalibrationTarget(targets[0]!)).rejects.toThrow("gaze_training_closed");
      await controller.stop();
    });

    it("trains ALL 9 points first then performs held-out validation with ZERO training calls", async () => {
      const controller = createController();
      await controller.start();
      expect(controller.status).toBe("ready");

      const targets = controller.beginCalibration();
      expect(targets.length).toBe(9);
      expect(controller.status).toBe("calibrating");

      // Pass 1: Train all 9 points
      for (const target of targets) {
        await controller.trainCalibrationTarget(target);
      }

      // Verify all 9 targets were trained in sequence
      expect(source.trainCalls.length).toBe(9);
      expect(source.trainCalls.map((t) => t.id)).toEqual(targets.map((t) => t.id));

      // Reset record of training calls
      source.trainCalls = [];

      // Pass 2: Held-out validation of final model
      for (const target of targets) {
        // Emit predictions matching the target during dwell
        const emitInterval = setInterval(() => {
          source.emit({ x_px: target.x_px, y_px: target.y_px, valid: true });
        }, 2);

        const count = await controller.validateCalibrationTarget(target);
        clearInterval(emitInterval);
        expect(count).toBeGreaterThan(0);
      }

      // Crucial requirement: ZERO training calls during validation pass
      expect(source.trainCalls.length).toBe(0);

      const report = controller.finishCalibration();
      expect(report.passes).toBe(true);
      expect(report.angular_available).toBe(true);
      expect(report.target_count).toBe(9);
      expect(report.max_error_deg).not.toBeNull();
      expect(report.max_error_deg!).toBeLessThan(1.5);
      expect(controller.status).toBe("calibrated");
      expect(controller.calibrationGatePassed).toBe(true);
    });

    it("fails calibration gate and blocks trials when held-out error exceeds 1.5 degrees", async () => {
      const controller = createController();
      await controller.start();

      const targets = controller.beginCalibration();
      for (const target of targets) {
        await controller.trainCalibrationTarget(target);
      }

      // Validate with predictions that are wildly off (500 px error)
      for (const target of targets) {
        const emitInterval = setInterval(() => {
          source.emit({ x_px: target.x_px + 500, y_px: target.y_px + 500, valid: true });
        }, 2);

        await controller.validateCalibrationTarget(target);
        clearInterval(emitInterval);
      }

      const report = controller.finishCalibration();
      expect(report.passes).toBe(false);
      expect(report.max_error_deg!).toBeGreaterThan(1.5);
      expect(controller.status).toBe("failed");
      expect(controller.calibrationGatePassed).toBe(false);

      // Trials must be prevented
      await expect(
        controller.beginTrial({ trial_id: "trial-1", menu_id: "menu-a", target_product_id: "prod-1" })
      ).rejects.toThrow("gaze_calibration_gate_not_passed");
    });

    it("prevents trials when controller is stopped or withdrawn", async () => {
      const controller = createController();
      await controller.start();
      await controller.stop();

      await expect(
        controller.beginTrial({ trial_id: "trial-1", menu_id: "menu-a", target_product_id: "prod-1" })
      ).rejects.toThrow("gaze_calibration_gate_not_passed");
    });
  });

  describe("GazeCalibrationScreen UI component", () => {
    it("does not offer a retry loop when gaze authorization was lost", () => {
      render(<GazeCalibrationScreen controller={null} starting={false} startError="gaze_unauthorized"
        onRetry={vi.fn()} onCalibrated={vi.fn()} />);
      expect(screen.getByRole("heading", { name: "Ask for a new session link" })).toBeInTheDocument();
      expect(screen.queryByTestId("gaze-calibration-retry")).not.toBeInTheDocument();
    });

    it("does not offer a retry loop after a viewport change", () => {
      render(<GazeCalibrationScreen controller={null} starting={false} startError="gaze_viewport_changed"
        onRetry={vi.fn()} onCalibrated={vi.fn()} />);
      expect(screen.getByRole("heading", { name: "Ask for a new session link" })).toBeInTheDocument();
      expect(screen.getByText(/screen size changed while the camera was starting/i)).toBeInTheDocument();
      expect(screen.queryByTestId("gaze-calibration-retry")).not.toBeInTheDocument();
    });

    it("drives training pass then validation pass and continues on passed gate", async () => {
      const controller = createController();
      await controller.start();

      // Emit accurate predictions whenever samples are requested
      const interval = setInterval(() => {
        source.emit({ x_px: 500, y_px: 500, valid: true });
      }, 5);

      const onCalibrated = vi.fn();
      render(
        <GazeCalibrationScreen
          controller={controller}
          starting={false}
          startError={null}
          onRetry={vi.fn()}
          onCalibrated={onCalibrated}
        />
      );

      // Initial intro screen
      expect(screen.getByTestId("gaze-calibration-screen")).toBeInTheDocument();
      const startButton = screen.getByTestId("gaze-calibration-start");
      fireEvent.click(startButton);

      // Wait for two-pass completion to reach results
      await waitFor(
        () => {
          expect(screen.getByTestId("gaze-calibration-result")).toBeInTheDocument();
        },
        { timeout: 8000 }
      );

      clearInterval(interval);
      expect(source.trainCalls.length).toBe(9);
    });
  });
});
