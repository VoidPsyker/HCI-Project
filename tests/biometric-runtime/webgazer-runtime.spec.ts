import { test, expect } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";

export interface MeasuredRuntimeReport {
  timestamp: string;
  durationMs: number;
  chromeNative: boolean;
  preConsentBlocked: boolean;
  preConsentError: string;
  getUserMediaCallsBeforeConsent: number;
  startOk: boolean;
  runtimeStatus: string;
  cameraActiveDuringRun: boolean;
  totalSamplesReceived: number;
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
  teardownStatus: string;
  cameraActiveAfterTeardown: boolean;
  trackCount: number;
  allTracksEnded: boolean;
  externalRequests: string[];
  localMediaPipeAssetsLoaded: string[];
}

test.describe("WebGazer 3.5.3 Bundled Browser Runtime Verification", () => {
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

  test("proves genuine Chromium, consent gate, offline local assets, no_prediction subscribe, and track teardown", async () => {
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
        viewport: { width: 1280, height: 720 },
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
        if (url.origin === new URL(baseUrl).origin) {
          localRequests.push(url.pathname);
          void route.continue();
          return;
        }
        externalRequests.push(url.href);
        void route.abort("blockedbyclient");
      });

      const harnessHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Biometric Runtime Verification Harness</title>
</head>
<body>
  <div id="harness-state">initializing</div>
  <script type="module">
    import { WebGazerSource } from "/src/biometrics/webgazer.ts";
    import { loadBundledWebGazer } from "/src/biometrics/webgazerLoader.ts";
    import { grantGazeConsent } from "/src/biometrics/consent.ts";

    window.__harness = {
      getUserMediaCalls: 0,
      activeTracks: [],
      samples: [],
      statuses: [],
      error: null,
      source: null,
      consent: null,
      isChromeNative: Boolean(window.chrome)
    };

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__harness.getUserMediaCalls += 1;
      const stream = await originalGetUserMedia(constraints);
      stream.getTracks().forEach((track) => {
        window.__harness.activeTracks.push(track);
      });
      return stream;
    };

    window.__harness.consent = grantGazeConsent({
      participant_id: "RUNTIME-TEST",
      session_id: "RUNTIME-SESSION-001",
      version: "runtime-verification-v1",
      camera_used: true,
      granted_at: new Date().toISOString()
    });

    const source = new WebGazerSource({
      participant_id: "RUNTIME-TEST",
      session_id: "RUNTIME-SESSION-001",
      load: loadBundledWebGazer,
      viewport: () => ({ width_px: window.innerWidth, height_px: window.innerHeight }),
      calibrationRepetitions: 1,
      repetitionDelayMs: 0,
      onStatus: (status) => {
        window.__harness.statuses.push(status);
      }
    });

    window.__harness.source = source;
    source.subscribe((sample) => {
      window.__harness.samples.push(sample);
    });

    document.getElementById("harness-state").textContent = "ready";
  </script>
</body>
</html>`;

      await context.route(`${baseUrl}/__biometric_runtime_test.html`, (route) => {
        void route.fulfill({
          status: 200,
          contentType: "text/html",
          body: harnessHtml
        });
      });

      page = await context.newPage();
      await page.goto(`${baseUrl}/__biometric_runtime_test.html`);
      await page.waitForSelector("#harness-state:text('ready')", { timeout: 15_000 });

      // Step A: Genuine window.chrome
      const isChromeNative = await page.evaluate(
        () => (window as unknown as { __harness: { isChromeNative: boolean } }).__harness.isChromeNative
      );
      expect(isChromeNative).toBe(true);

      // Step B: Pre-consent isolation
      const preConsent = await page.evaluate(async () => {
        const harness = (window as unknown as { __harness: any }).__harness;
        let rejected = false;
        let errorMsg = "";
        try {
          await harness.source.start(null);
        } catch (err: any) {
          rejected = true;
          errorMsg = err?.message ?? String(err);
        }
        return { rejected, errorMsg, getUserMediaCalls: harness.getUserMediaCalls };
      });
      expect(preConsent.rejected).toBe(true);
      expect(preConsent.errorMsg).toContain("gaze_consent_required");
      expect(preConsent.getUserMediaCalls).toBe(0);

      // Step C: Start with simulated explicit consent
      const startResult = await page.evaluate(async () => {
        const harness = (window as unknown as { __harness: any }).__harness;
        try {
          await harness.source.start(harness.consent);
          return { ok: true, error: null };
        } catch (err: any) {
          return { ok: false, error: err?.message ?? String(err) };
        }
      });
      expect(startResult.ok).toBe(true);
      expect(startResult.error).toBeNull();

      // Step D: Transition to running state
      await expect.poll(
        async () => page!.evaluate(() => {
          const harness = (window as unknown as { __harness: any }).__harness;
          return {
            status: harness.source.status,
            cameraActive: harness.source.cameraActive
          };
        }),
        { timeout: 60_000, intervals: [500], message: "WebGazerSource should reach running state" }
      ).toMatchObject({
        status: "running",
        cameraActive: true
      });

      // Step E: Collect subscription samples under fake camera
      await expect.poll(
        async () => page!.evaluate(() => (window as unknown as { __harness: any }).__harness.samples.length),
        { timeout: 30_000, intervals: [500], message: "Gaze listener should receive samples" }
      ).toBeGreaterThanOrEqual(2);

      const sampleSummary = await page.evaluate(() => {
        const harness = (window as unknown as { __harness: any }).__harness;
        const count = harness.samples.length;
        const samples = harness.samples.slice(0, 10);
        return { count, samples };
      });

      expect(sampleSummary.count).toBeGreaterThanOrEqual(2);
      let previousSeq = 0;
      let seqStrictlyIncreasing = true;
      for (const sample of sampleSummary.samples) {
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

      // Step F: Teardown & verify stopping tracks
      const teardown = await page.evaluate(async () => {
        const harness = (window as unknown as { __harness: any }).__harness;
        await harness.source.stop();
        const tracks = harness.activeTracks as MediaStreamTrack[];
        return {
          status: harness.source.status,
          cameraActive: harness.source.cameraActive,
          trackCount: tracks.length,
          allTracksEnded: tracks.every((t) => t.readyState === "ended")
        };
      });

      expect(teardown.status).toBe("stopped");
      expect(teardown.cameraActive).toBe(false);
      expect(teardown.trackCount).toBeGreaterThan(0);
      expect(teardown.allTracksEnded).toBe(true);

      // Step G: Network and asset assertions
      expect(externalRequests).toEqual([]);

      const mediapipeRequests = localRequests.filter((r) => r.includes("/vendor/webgazer/mediapipe/face_mesh"));
      expect(mediapipeRequests.some((r) => r.endsWith(".wasm"))).toBe(true);
      expect(mediapipeRequests.some((r) => r.endsWith(".data") || r.endsWith(".binarypb"))).toBe(true);
      expect(mediapipeRequests.some((r) => r.endsWith(".js"))).toBe(true);

      // Save measured structured test report
      const measuredReport: MeasuredRuntimeReport = {
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - testStartTime,
        chromeNative: isChromeNative,
        preConsentBlocked: preConsent.rejected,
        preConsentError: preConsent.errorMsg,
        getUserMediaCallsBeforeConsent: preConsent.getUserMediaCalls,
        startOk: startResult.ok,
        runtimeStatus: teardown.status,
        cameraActiveDuringRun: true,
        totalSamplesReceived: sampleSummary.count,
        sampleSlice: sampleSummary.samples,
        seqStrictlyIncreasing,
        teardownStatus: teardown.status,
        cameraActiveAfterTeardown: teardown.cameraActive,
        trackCount: teardown.trackCount,
        allTracksEnded: teardown.allTracksEnded,
        externalRequests,
        localMediaPipeAssetsLoaded: Array.from(new Set(mediapipeRequests))
      };

      const metricsPath = path.resolve(process.cwd(), "tests/biometric-runtime/measured-metrics.json");
      fs.writeFileSync(metricsPath, JSON.stringify(measuredReport, null, 2), "utf-8");
    } finally {
      // Ensure browser and pages are cleaned up even on assertion failure
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
