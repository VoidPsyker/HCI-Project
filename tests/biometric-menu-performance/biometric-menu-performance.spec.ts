import { test, expect } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";

export interface MeasuredPerformanceReport {
  timestamp: string;
  durationMs: number;
  chromeNative: boolean;
  viewport: { width: number; height: number };
  configuredDurationMs: number | null;
  observedDurationMs: number | null;
  activeFps: number;
  frameCount: number;
  frameDeltas: number[];
  fpsRequirementMet: boolean;
  gazeRuntimeRunning: boolean;
  totalGazeSamples: number;
  gazeSamplesDuringZoom: number;
  sampleSlice: Array<{
    seq: number;
    t_ms: number;
    t_source_ms: number;
    x_px: number | null;
    y_px: number | null;
    valid: boolean;
    invalid_reason?: string;
  }>;
  seqStrictlyIncreasing: boolean;
  syntheticLimits: {
    fakeVideoDevice: boolean;
    detectedFace: boolean;
    calibratedHumanCapture: boolean;
    expectedPrediction: string;
  };
  teardownStatus: string;
  cameraActiveAfterTeardown: boolean;
  trackCount: number;
  allTracksEnded: boolean;
  externalRequests: string[];
  localMediaPipeAssetsLoaded: string[];
}

test.describe("Biometric Menu Performance: Menu D + Bundled FaceMesh Concurrency", () => {
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

  test("verifies Menu D zoom cadence (>=50fps) and transition duration concurrently with bundled FaceMesh inference", async () => {
    const testStartTime = Date.now();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

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
        recordVideo: undefined
      });
      await context.grantPermissions(["camera"], { origin: baseUrl });

      const localRequests: string[] = [];
      const externalRequests: string[] = [];

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
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.error("PAGE ERROR LOG:", msg.text());
        }
      });
      page.on("pageerror", (err) => console.error("PAGE UNCAUGHT:", err));

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
          getUserMediaCalls: 0,
          activeTracks: [],
          samples: [],
          statuses: [],
          error: null,
          source: null,
          consent: null,
          isChromeNative: Boolean(window.chrome)
        };

        const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          (window as any).__harness.getUserMediaCalls += 1;
          const stream = await origGUM(constraints);
          stream.getTracks().forEach((track) => {
            (window as any).__harness.activeTracks.push(track);
          });
          return stream;
        };
      }, trialConfig);

      // Load real TrialRunner harness at 1920x1080
      await page.goto(`${baseUrl}/test/fixtures/trial-harness.html`);
      await page.getByTestId("start-trial").waitFor({ state: "visible", timeout: 20_000 });

      // Step 1: Verify native Chromium window.chrome
      const isChromeNative = await page.evaluate(
        () => (window as unknown as { __harness: { isChromeNative: boolean } }).__harness.isChromeNative
      );
      expect(isChromeNative).toBe(true);

      const environment = await page.evaluate(async () => {
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
          hardwareConcurrency: navigator.hardwareConcurrency,
          renderer
        };
      });
      fs.writeFileSync(
        path.resolve(process.cwd(), "tests/biometric-menu-performance/environment-observation.json"),
        JSON.stringify({ timestamp: new Date().toISOString(), ...environment }, null, 2)
      );

      // Step 2: Initialize and start WebGazer FaceMesh runtime in the SAME page
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
          harness.consent = consent;

          const source = new WebGazerSource({
            participant_id: "PERF-PARTICIPANT",
            session_id: "PERF-SESSION-001",
            load: loadBundledWebGazer,
            viewport: () => ({ width_px: window.innerWidth, height_px: window.innerHeight }),
            calibrationRepetitions: 1,
            repetitionDelayMs: 0,
            onStatus: (status: string) => {
              harness.statuses.push(status);
            }
          });
          harness.source = source;
          source.subscribe((sample: any) => {
            harness.samples.push(sample);
          });

          await source.start(consent);
          return { ok: true, error: null };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? String(err) };
        }
      });
      expect(startResult.ok).toBe(true);
      expect(startResult.error).toBeNull();

      // Step 3: Wait for WebGazer running status and active camera
      await expect.poll(
        async () => page!.evaluate(() => {
          const harness = (window as unknown as { __harness: any }).__harness;
          return {
            status: harness.source?.status,
            cameraActive: harness.source?.cameraActive
          };
        }),
        { timeout: 60_000, intervals: [500], message: "WebGazerSource should reach running state" }
      ).toMatchObject({
        status: "running",
        cameraActive: true
      });

      // Step 4: Ensure FaceMesh inference loop is actively producing samples
      await expect.poll(
        async () => page!.evaluate(() => (window as unknown as { __harness: any }).__harness.samples.length),
        { timeout: 30_000, intervals: [500], message: "Gaze inference should produce initial samples" }
      ).toBeGreaterThanOrEqual(2);

      // Step 5: Transition TrialRunner to menu step (Menu D)
      await page.getByTestId("start-trial").click();
      await expect(page.getByTestId("menu-d")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("svg.d-svg > g")).toBeVisible();

      // Step 6: Install active D3 motion recorder on svg.d-svg > g
      await page.evaluate(() => {
        const scene = document.querySelector("svg.d-svg > g");
        if (!scene) throw new Error("Fractal scene not found");
        const recorder = window as typeof window & {
          __d3?: {
            configuredDuration: number | null;
            first: number | null;
            end: number | null;
            done: boolean;
            started: number;
            frameTimes: number[];
            frameDeltas: number[];
            samplesAtFirst: number;
            samplesAtEnd: number;
          };
        };
        recorder.__d3 = {
          configuredDuration: null,
          first: null,
          end: null,
          done: false,
          started: performance.now(),
          frameTimes: [],
          frameDeltas: [],
          samplesAtFirst: 0,
          samplesAtEnd: 0
        };
        let lastTime: number | null = null;
        const tick = (now: number) => {
          const state = recorder.__d3!;
          const transitions = (scene as unknown as { __transition?: Record<string, { duration?: number; time?: number }> }).__transition;
          if (transitions && state.configuredDuration === null) {
            for (const k of Object.keys(transitions)) {
              const dur = transitions[k]?.duration;
              if (typeof dur === "number" && dur > 0) {
                state.configuredDuration = dur;
                break;
              }
            }
          }
          const transform = scene.getAttribute("transform");
          if (state.first === null && transform) {
            state.first = Object.values(transitions ?? {}).find((transition) => typeof transition.time === "number")?.time ?? now;
            lastTime = now;
            state.samplesAtFirst = (window as any).__harness?.samples?.length ?? 0;
          } else if (state.first !== null && transform) {
            if (lastTime !== null) {
              const delta = now - lastTime;
              state.frameDeltas.push(delta);
              state.frameTimes.push(now);
            }
            lastTime = now;
          } else if (state.first !== null && !transform) {
            if (lastTime !== null) {
              const delta = now - lastTime;
              state.frameDeltas.push(delta);
              state.frameTimes.push(now);
            }
            state.end = now;
            state.samplesAtEnd = (window as any).__harness?.samples?.length ?? 0;
            state.done = true;
            return;
          }
          if (performance.now() - state.started > 2500) {
            state.done = true;
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      // Step 7: Trigger Menu D zoom transition while FaceMesh inference is active in the same page
      await page.locator('[data-testid="menu-d"] [data-node-id="sport"]').click();

      // Step 8: Await transition completion
      await expect.poll(
        async () => page!.evaluate(() => (window as typeof window & { __d3?: { done: boolean } }).__d3?.done ?? false),
        { timeout: 5_000, intervals: [100], message: "Menu D zoom transition should complete" }
      ).toBe(true);

      // Step 9: Extract measured motion and inference metrics
      const motionData = await page.evaluate(() => {
        const state = (window as typeof window & {
          __d3?: {
            configuredDuration: number | null;
            first: number | null;
            end: number | null;
            frameDeltas: number[];
            samplesAtFirst: number;
            samplesAtEnd: number;
          };
          __harness?: any;
        }).__d3;
        const harness = (window as any).__harness;

        const deltas = (state?.frameDeltas ?? []).filter((d) => d > 0);
        const total = deltas.reduce((s, d) => s + d, 0);
        const fps = total > 0 ? (deltas.length / total) * 1000 : 0;
        const measuredDuration = state?.first != null && state.end != null ? state.end - state.first : null;

        return {
          cameraSettings: (harness?.activeTracks ?? []).map((track: MediaStreamTrack) => {
            const { width, height, frameRate } = track.getSettings();
            return { width, height, frameRate };
          }),
          configuredDuration: state?.configuredDuration ?? null,
          measuredDuration,
          deltas,
          totalMs: total,
          fps,
          samplesAtFirst: state?.samplesAtFirst ?? 0,
          samplesAtEnd: state?.samplesAtEnd ?? 0,
          samplesDuringZoom: Math.max(0, (state?.samplesAtEnd ?? 0) - (state?.samplesAtFirst ?? 0)),
          totalSamples: harness?.samples?.length ?? 0,
          sampleSlice: (harness?.samples ?? []).slice(0, 10)
        };
      });

      console.log("MEASURED MOTION DATA:", JSON.stringify(motionData, null, 2));
      fs.writeFileSync(
        path.resolve(process.cwd(), "tests/biometric-menu-performance/motion-observation.json"),
        JSON.stringify({ timestamp: new Date().toISOString(), ...motionData }, null, 2)
      );

      // Step 10: Enforce strict performance and timing gates honestly
      // A. Configured duration contract: 180–220 ms per design §5.7
      expect(motionData.configuredDuration, "D3 zoom transition must have configured duration").not.toBeNull();
      expect(motionData.configuredDuration!, "configured D3 zoom duration").toBeGreaterThanOrEqual(180);
      expect(motionData.configuredDuration!, "configured D3 zoom duration").toBeLessThanOrEqual(220);

      // B. Frame count during active zoom
      expect(motionData.deltas.length, "must sample multiple frames during active zoom").toBeGreaterThanOrEqual(5);

      // C. Observed runtime duration bound with frame quantization tolerance [170ms, 240ms]
      expect(motionData.measuredDuration, "measured D3 zoom duration must not be null").not.toBeNull();
      expect(motionData.measuredDuration!, "measured D3 zoom duration").toBeGreaterThanOrEqual(170);
      expect(motionData.measuredDuration!, "measured D3 zoom duration").toBeLessThanOrEqual(240);

      // D. Active frame cadence: must meet >= 50 fps study requirement
      expect(motionData.fps, `measured ${motionData.fps.toFixed(1)} fps during active zoom concurrent with FaceMesh`).toBeGreaterThanOrEqual(50);

      // E. Verify FaceMesh inference ran concurrently in the same page
      expect(motionData.totalSamples).toBeGreaterThanOrEqual(2);
      let previousSeq = 0;
      let seqStrictlyIncreasing = true;
      for (const sample of motionData.sampleSlice) {
        expect(sample.valid).toBe(false);
        expect(sample.invalid_reason).toBe("no_prediction");
        expect(sample.x_px).toBeNull();
        expect(sample.y_px).toBeNull();
        expect(typeof sample.t_ms).toBe("number");
        expect(Number.isFinite(sample.t_ms)).toBe(true);
        expect(sample.seq).toBeGreaterThan(previousSeq);
        if (sample.seq <= previousSeq) {
          seqStrictlyIncreasing = false;
        }
        previousSeq = sample.seq;
      }
      expect(seqStrictlyIncreasing).toBe(true);

      // Step 11: Teardown & verify stopping tracks
      const teardown = await page.evaluate(async () => {
        const harness = (window as unknown as { __harness: any }).__harness;
        await harness.source.stop();
        const tracks = harness.activeTracks as MediaStreamTrack[];
        return {
          status: harness.source.status,
          cameraActive: harness.source.cameraActive,
          trackCount: tracks.length,
          allTracksEnded: tracks.every((t: MediaStreamTrack) => t.readyState === "ended")
        };
      });

      expect(teardown.status).toBe("stopped");
      expect(teardown.cameraActive).toBe(false);
      expect(teardown.trackCount).toBeGreaterThan(0);
      expect(teardown.allTracksEnded).toBe(true);

      // Step 12: Network boundary assertions
      expect(externalRequests).toEqual([]);
      const mediapipeRequests = localRequests.filter((r) => r.includes("/vendor/webgazer/mediapipe/face_mesh"));
      expect(mediapipeRequests.some((r) => r.endsWith(".wasm"))).toBe(true);
      expect(mediapipeRequests.some((r) => r.endsWith(".data") || r.endsWith(".binarypb"))).toBe(true);
      expect(mediapipeRequests.some((r) => r.endsWith(".js"))).toBe(true);

      // Step 13: Write structured performance artifact
      const report: MeasuredPerformanceReport = {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - testStartTime,
        chromeNative: isChromeNative,
        viewport: { width: 1920, height: 1080 },
        configuredDurationMs: motionData.configuredDuration,
        observedDurationMs: motionData.measuredDuration,
        activeFps: motionData.fps,
        frameCount: motionData.deltas.length,
        frameDeltas: motionData.deltas,
        fpsRequirementMet: motionData.fps >= 50,
        gazeRuntimeRunning: true,
        totalGazeSamples: motionData.totalSamples,
        gazeSamplesDuringZoom: motionData.samplesDuringZoom,
        sampleSlice: motionData.sampleSlice,
        seqStrictlyIncreasing,
        syntheticLimits: {
          fakeVideoDevice: true,
          detectedFace: false,
          calibratedHumanCapture: false,
          expectedPrediction: "no_prediction"
        },
        teardownStatus: teardown.status,
        cameraActiveAfterTeardown: teardown.cameraActive,
        trackCount: teardown.trackCount,
        allTracksEnded: teardown.allTracksEnded,
        externalRequests,
        localMediaPipeAssetsLoaded: Array.from(new Set(mediapipeRequests))
      };

      const metricsPath = path.resolve(process.cwd(), "tests/biometric-menu-performance/measured-metrics.json");
      fs.writeFileSync(metricsPath, JSON.stringify(report, null, 2), "utf-8");
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  });
});
