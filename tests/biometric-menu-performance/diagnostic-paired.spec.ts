import { test, expect } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";

/**
 * Labeled diagnostic, not the release gate. The production gate remains
 * biometric-menu-performance.spec.ts. This file measures one same-page pair:
 * Menu D zoom while FaceMesh inference is running, then the identical zoom
 * after WebGazer is paused. Active intervals start at D3's scheduled start and
 * end when the scene transform is removed; idle time is excluded.
 */

interface TransitionRecord {
  configuredDuration: number | null;
  scheduledStart: number | null;
  end: number | null;
  frameDeltas: number[];
  fps: number;
  measuredDuration: number | null;
  samplesBefore: number;
  samplesAfter: number;
  done: boolean;
  error: string | null;
}

interface InferenceCall {
  start: number;
  end: number;
  durationMs: number;
  result: "face" | "no_face" | "null" | "error";
}

interface BrowserEnvironment {
  baselineFpsBeforeInference: number;
  renderer: string | null;
  hardwareConcurrency: number;
  devicePixelRatio: number;
  userAgent: string;
  viewport: { width: number; height: number };
}

const ARTIFACT_DIR = path.resolve(process.cwd(), "tests/biometric-menu-performance");
const OBSERVATION_PATH = path.join(ARTIFACT_DIR, "diagnostic-paired-observation.json");

test.describe("Diagnostic: paired Menu D cadence with and without concurrent FaceMesh", () => {
  let vite: ViteDevServer | null = null;
  const baseUrl = "http://127.0.0.1:5173";

  test.beforeAll(async () => {
    const isRunning = await new Promise<boolean>((resolve) => {
      const req = http.get(baseUrl, () => resolve(true));
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (!isRunning) {
      vite = await createServer({
        root: path.resolve(process.cwd(), "apps/web"),
        configFile: path.resolve(process.cwd(), "apps/web/vite.config.ts"),
        server: { host: "127.0.0.1", port: 5173, strictPort: true }
      });
      await vite.listen();
    }
  });

  test.afterAll(async () => {
    if (vite) {
      await vite.close();
      vite = null;
    }
  });

  test("one same-page pair: Menu D zoom during FaceMesh and while paused", async () => {
    test.setTimeout(150_000);
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    const cpus = os.cpus();
    const host = {
      platform: process.platform,
      release: os.release(),
      cpuModel: cpus[0]?.model ?? null,
      logicalCpus: cpus.length,
      totalMemoryBytes: os.totalmem()
    };

    try {
      browser = await chromium.launch({
        channel: "chromium",
        args: [
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          "--autoplay-policy=no-user-gesture-required"
        ]
      });

      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        recordVideo: undefined
      });
      await context.grantPermissions(["camera"], { origin: baseUrl });

      const externalRequests: string[] = [];
      const localRequests: string[] = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === "data:" || url.protocol === "blob:") {
          void route.continue();
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          void route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, accepted: 1 })
          });
          return;
        }
        if (url.origin === new URL(baseUrl).origin) {
          localRequests.push(url.pathname);
          void route.continue();
          return;
        }
        externalRequests.push(url.href);
        void route.abort("blockedbyclient");
      });

      page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      const trialConfig = {
        spec: {
          trialId: "trial-1",
          blockId: "block-happy",
          menuId: "D",
          taskId: "T01",
          targetId: "sport.prodiver.steel-blue",
          taskDescription: "Find the ProDiver Automatic watch.",
          stateLabel: "happy",
          practice: false,
          trialIndex: 0
        },
        colourMapping: { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" },
        fastMode: false,
        participantId: "PERF-PARTICIPANT",
        sessionId: "PERF-SESSION-001"
      };

      await page.addInitScript((cfg) => {
        (window as unknown as { __trialConfig: unknown }).__trialConfig = cfg;
        (window as unknown as { __harness: unknown }).__harness = {
          samples: [],
          statuses: [],
          activeTracks: [],
          inferenceCalls: [] as unknown[],
          source: null,
          isChromeNative: Boolean(window.chrome)
        };
        const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await origGUM(constraints);
          stream.getTracks().forEach((track) => {
            (window as any).__harness.activeTracks.push(track);
          });
          return stream;
        };
      }, trialConfig);

      await page.goto(`${baseUrl}/test/fixtures/trial-harness.html`);
      await page.getByTestId("start-trial").waitFor({ state: "visible", timeout: 20_000 });

      const environment: BrowserEnvironment = await page.evaluate(async () => {
        const frames: number[] = [];
        await new Promise<void>((resolve) => {
          const tick = (time: number) => {
            frames.push(time);
            if (frames.length === 61) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const gl = document.createElement("canvas").getContext("webgl");
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        const renderer = debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
        return {
          baselineFpsBeforeInference: 60000 / (frames[60]! - frames[0]!),
          renderer,
          hardwareConcurrency: navigator.hardwareConcurrency,
          devicePixelRatio: window.devicePixelRatio,
          userAgent: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        };
      });

      // Start the real bundled WebGazer/FaceMesh source in this page.
      const startResult = await page.evaluate(async () => {
        const harness = (window as unknown as { __harness: any }).__harness;
        try {
          const { WebGazerSource } = await import("/src/biometrics/webgazer.ts");
          const { loadBundledWebGazer } = await import("/src/biometrics/webgazerLoader.ts");
          const { grantGazeConsent } = await import("/src/biometrics/consent.ts");

          const consent = grantGazeConsent({
            participant_id: "PERF-PARTICIPANT",
            session_id: "PERF-SESSION-001",
            version: "biometric-performance-v1",
            camera_used: true,
            granted_at: new Date().toISOString()
          });
          const source = new WebGazerSource({
            participant_id: "PERF-PARTICIPANT",
            session_id: "PERF-SESSION-001",
            load: loadBundledWebGazer,
            viewport: () => ({ width_px: window.innerWidth, height_px: window.innerHeight }),
            calibrationRepetitions: 1,
            repetitionDelayMs: 0
          });
          harness.source = source;
          source.subscribe((sample: any) => harness.samples.push(sample));
          await source.start(consent);

          // The same module singleton WebGazerSource loaded; wrap the active
          // tracker so each inference attempt records its wall-clock duration.
          const { loadBundledWebGazer: loadAgain } = await import("/src/biometrics/webgazerLoader.ts");
          const api: any = await loadAgain();
          const tracker = api.getTracker();
          const original = tracker.getEyePatches;
          tracker.getEyePatches = async function (...args: unknown[]) {
            const start = performance.now();
            try {
              const out = await original.apply(this, args);
              (window as any).__harness.inferenceCalls.push({
                start,
                end: performance.now(),
                result: out === false ? "no_face" : out ? "face" : "null"
              });
              return out;
            } catch (err) {
              (window as any).__harness.inferenceCalls.push({
                start,
                end: performance.now(),
                result: "error"
              });
              throw err;
            }
          };
          return { ok: true, error: null };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? String(err) };
        }
      });
      expect(startResult.ok, `source start failed: ${startResult.error}`).toBe(true);

      await expect.poll(
        async () => page!.evaluate(() => {
          const harness = (window as unknown as { __harness: any }).__harness;
          return { status: harness.source?.status, cameraActive: harness.source?.cameraActive };
        }),
        { timeout: 60_000, intervals: [500], message: "WebGazerSource should reach running state" }
      ).toMatchObject({ status: "running", cameraActive: true });

      await expect.poll(
        async () => page!.evaluate(() => (window as any).__harness.samples.length),
        { timeout: 30_000, intervals: [200], message: "FaceMesh inference should produce samples" }
      ).toBeGreaterThanOrEqual(2);

      const cameraSettings = await page.evaluate(() => {
        const harness = (window as unknown as { __harness: any }).__harness;
        return (harness.activeTracks as MediaStreamTrack[]).map((track) => {
          const { width, height, frameRate } = track.getSettings();
          return { width, height, frameRate, label: track.label };
        });
      });

      await page.getByTestId("start-trial").click();
      await expect(page.getByTestId("menu-d")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("svg.d-svg > g")).toBeVisible();

      // Steady-state cadence while inference is still running, before any
      // transition. Must be sampled before phase B pauses inference.
      const steadyInferenceFps = await page.evaluate(async () => {
        const harness = (window as any).__harness;
        const callsBefore = harness.inferenceCalls.length;
        const samplesBefore = harness.samples.length;
        const times: number[] = [];
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const tick = (t: number) => {
            times.push(t);
            if (t - start >= 500) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const deltas = times.slice(1).map((t, i) => t - times[i]);
        const span = times[times.length - 1]! - times[0]!;
        return {
          fps: deltas.length / span * 1000,
          frameDeltasMs: deltas,
          inferenceCallsDuringWindow: harness.inferenceCalls.length - callsBefore,
          samplesDuringWindow: harness.samples.length - samplesBefore
        };
      });

      // D3 transition recorder, identical math to the gate harness.
      const installRecorder = () =>
        page!.evaluate(() => {
          const scene = document.querySelector("svg.d-svg > g");
          if (!scene) throw new Error("Fractal scene not found");
          const harness = (window as any).__harness;
          const recorder = window as any;
          recorder.__rec = {
            configuredDuration: null,
            scheduledStart: null,
            end: null,
            done: false,
            error: null,
            frameDeltas: [] as number[],
            samplesBefore: harness.samples.length,
            samplesAfter: 0,
            started: performance.now()
          };
          let lastTime: number | null = null;
          const tick = (now: number) => {
            const state = recorder.__rec;
            if (!state || state.done) return;
            const transitions = (scene as any).__transition as
              | Record<string, { duration?: number; time?: number }>
              | undefined;
            if (transitions && state.configuredDuration === null) {
              for (const key of Object.keys(transitions)) {
                const duration = transitions[key]?.duration;
                if (typeof duration === "number" && duration > 0) {
                  state.configuredDuration = duration;
                  break;
                }
              }
            }
            const transform = scene.getAttribute("transform");
            if (state.scheduledStart === null && transform) {
              state.scheduledStart =
                Object.values(transitions ?? {}).find((t) => typeof t.time === "number")?.time ?? now;
              lastTime = now;
            } else if (state.scheduledStart !== null && transform) {
              if (lastTime !== null) state.frameDeltas.push(now - lastTime);
              lastTime = now;
            } else if (state.scheduledStart !== null && !transform) {
              if (lastTime !== null) state.frameDeltas.push(now - lastTime);
              state.end = now;
              state.samplesAfter = harness.samples.length;
              state.done = true;
              return;
            }
            if (now - state.started > 3_000) {
              state.error = "transition_not_observed";
              state.done = true;
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

      const readTransition = (): Promise<TransitionRecord> =>
        page!.evaluate(() => {
          const state = (window as any).__rec;
          const deltas = (state.frameDeltas as number[]).filter((d) => d > 0);
          const total = deltas.reduce((sum, d) => sum + d, 0);
          return {
            configuredDuration: state.configuredDuration,
            scheduledStart: state.scheduledStart,
            end: state.end,
            frameDeltas: deltas,
            fps: total > 0 ? (deltas.length / total) * 1000 : 0,
            measuredDuration:
              state.scheduledStart != null && state.end != null ? state.end - state.scheduledStart : null,
            samplesBefore: state.samplesBefore,
            samplesAfter: state.samplesAfter,
            done: state.done,
            error: state.error
          };
        });

      const runTransition = async (): Promise<TransitionRecord> => {
        await installRecorder();
        await page!.locator('[data-testid="menu-d"] [data-node-id="sport"]').click();
        await expect
          .poll(async () => page!.evaluate(() => (window as any).__rec?.done ?? false), {
            timeout: 6_000,
            intervals: [100]
          })
          .toBe(true);
        return readTransition();
      };

      const home = async () => {
        await page!.locator('.crumb-root').click();
        await expect(page!.locator('[data-testid="menu-d"] [data-node-id="sport"]')).toBeVisible();
        await page!.waitForTimeout(400);
      };

      // Warm-up: one full zoom under inference so shaders/layout are warm for both phases.
      const warmup = await runTransition();
      await home();

      // Phase A: concurrent inference. Identical root -> sport zoom.
      const phaseA = await runTransition();
      await home();

      // Phase B: same page, same camera tracks, inference paused.
      const pauseState = await page.evaluate(async () => {
        const harness = (window as any).__harness;
        const before = harness.samples.length;
        await harness.source.pause();
        await new Promise((resolve) => setTimeout(resolve, 600));
        return {
          status: harness.source.status,
          cameraActive: harness.source.cameraActive,
          samplesBefore: before,
          samplesAfter: harness.samples.length
        };
      });
      expect(pauseState.status).toBe("paused");
      expect(pauseState.cameraActive).toBe(true);
      expect(pauseState.samplesAfter, "inference must stop while paused").toBe(pauseState.samplesBefore);

      const phaseB = await runTransition();

      const inferenceCalls: InferenceCall[] = await page.evaluate(() => {
        const calls = (window as any).__harness.inferenceCalls as Array<{
          start: number;
          end: number;
          result: InferenceCall["result"];
        }>;
        return calls.map((c) => ({ ...c, durationMs: c.end - c.start }));
      });

      const summarize = (record: TransitionRecord) => {
        const start = record.scheduledStart ?? 0;
        const end = record.end ?? 0;
        const overlapping = inferenceCalls
          .map((call) => ({
            ...call,
            overlapMs: Math.max(0, Math.min(call.end, end) - Math.max(call.start, start))
          }))
          .filter((call) => call.overlapMs > 0);
        const occupancy = overlapping.reduce((sum, call) => sum + call.overlapMs, 0);
        const observed = record.measuredDuration ?? 0;
        return {
          configuredDurationMs: record.configuredDuration,
          scheduledStart: record.scheduledStart,
          observedDurationMs: record.measuredDuration,
          activeFrameCount: record.frameDeltas.length,
          activeFps: record.fps,
          frameDeltasMs: record.frameDeltas,
          samplesBefore: record.samplesBefore,
          samplesAfter: record.samplesAfter,
          samplesDuringZoom: Math.max(0, record.samplesAfter - record.samplesBefore),
          inferenceCallsDuringZoom: overlapping.length,
          inferenceDurationsDuringZoomMs: overlapping.map((c) => Number(c.durationMs.toFixed(2))),
          inferenceOverlapMs: Number(occupancy.toFixed(2)),
          inferenceShareOfObservedDuration:
            observed > 0 ? Number((occupancy / observed).toFixed(3)) : null,
          fps50GateMet: record.fps >= 50
        };
      };

      const steadyMenuOnlyFps = await page.evaluate(async () => {
        const times: number[] = [];
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const tick = (t: number) => {
            times.push(t);
            if (t - start >= 500) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const deltas = times.slice(1).map((t, i) => t - times[i]);
        const span = times[times.length - 1]! - times[0]!;
        return { fps: deltas.length / span * 1000, frameDeltasMs: deltas };
      });

      const teardown = await page.evaluate(async () => {
        const harness = (window as any).__harness;
        await harness.source.stop();
        const tracks = harness.activeTracks as MediaStreamTrack[];
        return {
          status: harness.source.status,
          cameraActive: harness.source.cameraActive,
          trackCount: tracks.length,
          allTracksEnded: tracks.every((track) => track.readyState === "ended")
        };
      });

      const durations = inferenceCalls.map((c) => c.durationMs).sort((a, b) => a - b);
      const percentile = (p: number) =>
        durations.length === 0 ? null : durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))];

      const phaseASummary = summarize(phaseA);
      const phaseBSummary = summarize(phaseB);
      const validity = {
        phaseAInferenceObserved: phaseASummary.inferenceCallsDuringZoom > 0,
        phaseBInferenceAbsent: phaseBSummary.inferenceCallsDuringZoom === 0,
        configuredDurationSame:
          phaseA.configuredDuration === phaseB.configuredDuration &&
          phaseA.configuredDuration !== null,
        activeIntervalsPresent:
          phaseA.frameDeltas.length > 0 && phaseB.frameDeltas.length > 0,
        noExternalRequests: externalRequests.length === 0
      };

      const report = {
        label: "diagnostic-paired-2026-10-24",
        note:
          "Labeled diagnostic, not the production gate. Fake video device has no face. " +
          "Measures runtime contention only; no human accuracy or calibration claim.",
        timestamp: new Date().toISOString(),
        host,
        browser: {
          version: browser.version(),
          userAgent: environment.userAgent,
          chromeNative: await page.evaluate(() => Boolean((window as any).chrome)),
          viewport: environment.viewport,
          devicePixelRatio: environment.devicePixelRatio,
          hardwareConcurrency: environment.hardwareConcurrency,
          renderer: environment.renderer,
          baselineFpsBeforeInference: environment.baselineFpsBeforeInference
        },
        camera: {
          fakeDevice: true,
          settings: cameraSettings,
          note: "Chromium fake capture device; no face present, so every prediction is no_prediction by construction."
        },
        measurementMethod: {
          transition: "Menu D root -> sport zoom, D3 .duration(180)",
          activeInterval: "D3 scheduled transition.time to first frame observing transform removal",
          fps: "count(active frame deltas) / sum(active frame deltas) * 1000; no idle tail",
          pairing: "same page, same Menu D instance, same camera tracks; inference then paused for the second phase",
          order: "warm-up zoom under inference, phase A concurrent inference, phase B paused"
        },
        phaseA_concurrentInference: phaseASummary,
        phaseB_inferencePaused: phaseBSummary,
        warmup: {
          configuredDurationMs: warmup.configuredDuration,
          observedDurationMs: warmup.measuredDuration,
          activeFps: warmup.fps,
          error: warmup.error
        },
        steadyState: {
          inferenceRunning: steadyInferenceFps,
          inferencePaused: steadyMenuOnlyFps
        },
        inferenceRuntime: {
          totalCalls: inferenceCalls.length,
          medianMs: percentile(50),
          p90Ms: percentile(90),
          maxMs: percentile(100),
          results: inferenceCalls.reduce<Record<string, number>>((acc, call) => {
            acc[call.result] = (acc[call.result] ?? 0) + 1;
            return acc;
          }, {})
        },
        pauseState,
        teardown,
        externalRequests,
        mediaPipeAssetsLoaded: Array.from(
          new Set(localRequests.filter((request) => request.includes("/vendor/webgazer/mediapipe/face_mesh")))
        ),
        pageErrors,
        validity,
        valid: Object.values(validity).every(Boolean)
      };

      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      fs.writeFileSync(OBSERVATION_PATH, JSON.stringify(report, null, 2), "utf-8");
      // eslint-disable-next-line no-console
      console.log("DIAGNOSTIC PAIRED OBSERVATION:", JSON.stringify({
        phaseA: phaseASummary,
        phaseB: phaseBSummary,
        steadyInferenceFps: steadyInferenceFps.fps,
        steadyMenuOnlyFps: steadyMenuOnlyFps.fps,
        inferenceRuntime: report.inferenceRuntime,
        validity
      }, null, 2));

      expect(report.valid, "diagnostic measurement must be internally valid").toBe(true);
      expect(phaseA.configuredDuration, "configured D3 duration recorded").not.toBeNull();
      expect(phaseB.configuredDuration, "configured D3 duration recorded").not.toBeNull();
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  });
});
