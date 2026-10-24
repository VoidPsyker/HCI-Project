import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const artifactPath = path.join(rootDir, "tests", "biometric-menu-performance", "performance-run.txt");
const metricsPath = path.join(rootDir, "tests", "biometric-menu-performance", "measured-metrics.json");

// Clean previous run outputs
if (fs.existsSync(metricsPath)) {
  fs.unlinkSync(metricsPath);
}
if (fs.existsSync(artifactPath)) {
  fs.unlinkSync(artifactPath);
}

const startTime = new Date().toISOString();
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "playwright",
  "test",
  "--config",
  "tests/biometric-menu-performance/playwright.config.ts"
];

console.log(`Executing: ${cmd} ${args.join(" ")}`);

const child = spawn(cmd, args, {
  cwd: rootDir,
  shell: true,
  env: { ...process.env }
});

let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  const str = chunk.toString();
  process.stdout.write(str);
  stdout += str;
});

child.stderr.on("data", (chunk) => {
  const str = chunk.toString();
  process.stderr.write(str);
  stderr += str;
});

child.on("close", (exitCode) => {
  const endTime = new Date().toISOString();

  if (exitCode !== 0) {
    const failureSummary = [
      "=================================================================",
      "Biometric Menu D Performance Verification Run - FAILED",
      "=================================================================",
      `Start Time: ${startTime}`,
      `End Time:   ${endTime}`,
      `Exit Code:  ${exitCode ?? "null (terminated)"}`,
      `Command:    ${cmd} ${args.join(" ")}`,
      "",
      "--- TEST EXECUTION ERROR ---",
      stdout.trim(),
      stderr.trim() ? `\n--- STDERR ---\n${stderr.trim()}` : "",
      "================================================================="
    ].join("\n");

    fs.writeFileSync(artifactPath, failureSummary, "utf-8");
    console.error(`\nTest failed. Artifact written to: ${artifactPath}`);
    process.exit(exitCode ?? 1);
  }

  let measured = null;
  if (fs.existsSync(metricsPath)) {
    try {
      measured = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
    } catch (err) {
      console.error("Failed to parse measured metrics:", err);
    }
  }

  if (!measured) {
    const missingMetricsSummary = [
      "=================================================================",
      "Biometric Menu D Performance Verification Run - INCOMPLETE",
      "=================================================================",
      `Start Time: ${startTime}`,
      `End Time:   ${endTime}`,
      "Exit Code:  1 (missing metrics artifact)",
      `Command:    ${cmd} ${args.join(" ")}`,
      "",
      "--- OUTPUT ---",
      stdout.trim(),
      stderr.trim() ? `\n--- STDERR ---\n${stderr.trim()}` : "",
      "================================================================="
    ].join("\n");
    fs.writeFileSync(artifactPath, missingMetricsSummary, "utf-8");
    process.exit(1);
  }

  const report = [
    "=================================================================",
    "Biometric Menu D Performance Verification Run - SUCCEEDED",
    "=================================================================",
    `Start Time: ${startTime}`,
    `End Time:   ${endTime}`,
    `Total Test Duration: ${measured.durationMs}ms`,
    `Exit Code:  0`,
    `Command:    ${cmd} ${args.join(" ")}`,
    "",
    "--- MEASURED PERFORMANCE EVIDENCE ---",
    `1. Genuine Chromium Environment:`,
    `   - window.chrome natively present: ${measured.chromeNative}`,
    `   - Viewport: ${measured.viewport.width}x${measured.viewport.height}`,
    "",
    `2. Menu D Zoom Motion Cadence & Duration:`,
    `   - Configured D3 transition duration: ${measured.configuredDurationMs}ms (spec: 180-220ms)`,
    `   - Observed transition duration: ${measured.observedDurationMs ? measured.observedDurationMs.toFixed(2) : "N/A"}ms (spec bound: 170-240ms)`,
    `   - Active zoom frame count: ${measured.frameCount}`,
    `   - Active zoom measured FPS: ${measured.activeFps.toFixed(2)} fps (study requirement: >=50 fps)`,
    `   - Requirement >= 50 fps met: ${measured.fpsRequirementMet}`,
    `   - Frame deltas (ms): [${measured.frameDeltas.map((d) => d.toFixed(1)).join(", ")}]`,
    "",
    `3. Concurrent FaceMesh Runtime Activity:`,
    `   - FaceMesh active during run: ${measured.gazeRuntimeRunning}`,
    `   - Total gaze samples produced: ${measured.totalGazeSamples}`,
    `   - Gaze samples emitted during zoom window: ${measured.gazeSamplesDuringZoom}`,
    `   - Sequence numbers strictly increasing: ${measured.seqStrictlyIncreasing}`,
    `   - Sample slice inspected (first ${measured.sampleSlice.length} samples):`,
    JSON.stringify(measured.sampleSlice, null, 4),
    "",
    `4. Exact Synthetic & Accuracy Boundary:`,
    `   - Fake video device active: ${measured.syntheticLimits.fakeVideoDevice}`,
    `   - Face detected: ${measured.syntheticLimits.detectedFace} (expected: false with synthetic pacman/color bars)`,
    `   - Calibrated human capture claimed: ${measured.syntheticLimits.calibratedHumanCapture} (do NOT claim human accuracy)`,
    `   - Expected prediction label: ${measured.syntheticLimits.expectedPrediction}`,
    "",
    `5. Hardware Teardown & MediaStream Cleanup:`,
    `   - Final wrapper status: ${measured.teardownStatus}`,
    `   - Camera active after stop: ${measured.cameraActiveAfterTeardown}`,
    `   - Total MediaStreamTracks captured: ${measured.trackCount}`,
    `   - All tracks ended (readyState === "ended"): ${measured.allTracksEnded}`,
    "",
    `6. Offline Isolation & Local Assets:`,
    `   - External requests attempted: ${measured.externalRequests.length}`,
    `   - External URLs blocked: ${JSON.stringify(measured.externalRequests)}`,
    `   - Local MediaPipe FaceMesh assets loaded:`,
    measured.localMediaPipeAssetsLoaded.map((asset) => `     * ${asset}`).join("\n"),
    "",
    "--- PLAYWRIGHT OUTPUT ---",
    stdout.trim(),
    "================================================================="
  ].join("\n");

  fs.writeFileSync(artifactPath, report, "utf-8");
  console.log(`\nVerification completed successfully. Report written to: ${artifactPath}`);
});
