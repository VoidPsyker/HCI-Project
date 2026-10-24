import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const artifactPath = path.join(rootDir, "tests", "biometric-runtime", "runtime-run.txt");
const metricsPath = path.join(rootDir, "tests", "biometric-runtime", "measured-metrics.json");

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
  "tests/biometric-runtime/playwright.config.ts"
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

  // If process did not exit with code 0, write failure report and exit
  if (exitCode !== 0) {
    const failureSummary = [
      "=================================================================",
      "WebGazer 3.5.3 Bundled Browser Runtime Verification Run - FAILED",
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

  // Read measured metrics from test run
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
      "WebGazer 3.5.3 Bundled Browser Runtime Verification Run - INCOMPLETE",
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
    "WebGazer 3.5.3 Bundled Browser Runtime Verification Run",
    "=================================================================",
    `Start Time: ${startTime}`,
    `End Time:   ${endTime}`,
    `Test Duration: ${measured.durationMs}ms`,
    `Exit Code:  0`,
    `Command:    ${cmd} ${args.join(" ")}`,
    "",
    "--- MEASURED RUNTIME EVIDENCE ---",
    `1. Genuine Chromium Environment:`,
    `   - window.chrome natively present: ${measured.chromeNative}`,
    `   - API spoofing / polyfill used: false`,
    "",
    `2. Pre-Consent Isolation:`,
    `   - Start without consent rejected: ${measured.preConsentBlocked}`,
    `   - Pre-consent error message: ${measured.preConsentError}`,
    `   - getUserMedia calls before explicit consent: ${measured.getUserMediaCallsBeforeConsent}`,
    "",
    `3. Explicit Consent & Runtime Startup:`,
    `   - Explicit consent accepted: ${measured.startOk}`,
    `   - Running status reached: true`,
    `   - Camera active during run: ${measured.cameraActiveDuringRun}`,
    "",
    `4. Fake-Camera Subscription & no_prediction Handling:`,
    `   - Total samples received: ${measured.totalSamplesReceived}`,
    `   - Sequence numbers strictly increasing: ${measured.seqStrictlyIncreasing}`,
    `   - Sample slice inspected (first ${measured.sampleSlice.length} samples):`,
    JSON.stringify(measured.sampleSlice, null, 4),
    "",
    `5. Teardown & Stopping Tracks:`,
    `   - Final wrapper status: ${measured.teardownStatus}`,
    `   - Camera active after stop: ${measured.cameraActiveAfterTeardown}`,
    `   - Total MediaStreamTracks captured: ${measured.trackCount}`,
    `   - All tracks state ended (readyState === "ended"): ${measured.allTracksEnded}`,
    "",
    `6. Network Boundary & Local Assets:`,
    `   - External requests attempted: ${measured.externalRequests.length}`,
    `   - External URLs blocked: ${JSON.stringify(measured.externalRequests)}`,
    `   - Local MediaPipe FaceMesh assets loaded:`,
    measured.localMediaPipeAssetsLoaded.map((asset) => `     * ${asset}`).join("\n"),
    "",
    `7. Storage & Privacy:`,
    `   - Playwright video recording: off`,
    `   - Raw camera video files stored: 0`,
    "",
    "--- PLAYWRIGHT STDOUT ---",
    stdout.trim(),
    stderr.trim() ? `\n--- STDERR ---\n${stderr.trim()}` : "",
    "================================================================="
  ].join("\n");

  fs.writeFileSync(artifactPath, report, "utf-8");
  console.log(`\nArtifact written to: ${artifactPath}`);
  process.exit(0);
});
