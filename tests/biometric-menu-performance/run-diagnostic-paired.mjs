import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Labeled paired diagnostic. Writes diagnostic-paired-run.txt and leaves the
 * existing performance-run.txt / motion-observation.json failure artifacts
 * untouched. The production 50 fps gate remains in
 * biometric-menu-performance.spec.ts and is not invoked here.
 */
const rootDir = process.cwd();
const artifactPath = path.join(rootDir, "tests", "biometric-menu-performance", "diagnostic-paired-run.txt");
const observationPath = path.join(rootDir, "tests", "biometric-menu-performance", "diagnostic-paired-observation.json");

if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath);
if (fs.existsSync(observationPath)) fs.unlinkSync(observationPath);

const startTime = new Date().toISOString();
const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["playwright", "test", "--config", "tests/biometric-menu-performance/playwright.diagnostic.config.ts"];

const child = spawn(cmd, args, { cwd: rootDir, shell: true, env: { ...process.env } });
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
  let observation = null;
  if (fs.existsSync(observationPath)) {
    try {
      observation = JSON.parse(fs.readFileSync(observationPath, "utf-8"));
    } catch (err) {
      stderr += `\nFailed to parse diagnostic observation: ${String(err)}`;
    }
  }

  const summary = observation
    ? [
        "",
        "--- PAIRED MEASUREMENT ---",
        `Phase A (concurrent FaceMesh inference): ${observation.phaseA_concurrentInference.activeFps.toFixed(2)} fps ` +
          `(${observation.phaseA_concurrentInference.activeFrameCount} active frames, ` +
          `${observation.phaseA_concurrentInference.observedDurationMs?.toFixed(1)} ms observed, ` +
          `${observation.phaseA_concurrentInference.inferenceCallsDuringZoom} inference calls, ` +
          `${observation.phaseA_concurrentInference.inferenceOverlapMs} ms inference overlap)`,
        `Phase B (inference paused):            ${observation.phaseB_inferencePaused.activeFps.toFixed(2)} fps ` +
          `(${observation.phaseB_inferencePaused.activeFrameCount} active frames, ` +
          `${observation.phaseB_inferencePaused.observedDurationMs?.toFixed(1)} ms observed)`,
        `Steady-state rAF: inference ${observation.steadyState.inferenceRunning.fps.toFixed(2)} fps; ` +
          `paused ${observation.steadyState.inferencePaused.fps.toFixed(2)} fps`,
        `Inference duration: median ${observation.inferenceRuntime.medianMs?.toFixed(2)} ms, ` +
          `p90 ${observation.inferenceRuntime.p90Ms?.toFixed(2)} ms, max ${observation.inferenceRuntime.maxMs?.toFixed(2)} ms ` +
          `across ${observation.inferenceRuntime.totalCalls} calls`,
        `Diagnostic internally valid: ${observation.valid}`,
        ""
      ].join("\n")
    : "";

  const header = [
    "=================================================================",
    exitCode === 0
      ? "Biometric Menu D Paired Diagnostic - COMPLETED"
      : "Biometric Menu D Paired Diagnostic - FAILED",
    "=================================================================",
    `Start Time: ${startTime}`,
    `End Time:   ${endTime}`,
    `Exit Code:  ${exitCode ?? "null (terminated)"}`,
    `Command:    ${cmd} ${args.join(" ")}`,
    "Label:      diagnostic-paired-2026-10-24 (NOT the 50 fps gate)",
    summary,
    "--- PLAYWRIGHT OUTPUT ---",
    stdout.trim(),
    stderr.trim() ? `\n--- STDERR ---\n${stderr.trim()}` : "",
    "================================================================="
  ].join("\n");

  fs.writeFileSync(artifactPath, header, "utf-8");
  if (exitCode !== 0) {
    console.error(`\nDiagnostic failed. Artifact written to: ${artifactPath}`);
    process.exit(exitCode ?? 1);
  }
  console.log(`\nDiagnostic completed. Report written to: ${artifactPath}`);
});
