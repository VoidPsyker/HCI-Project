# Concurrent menu and gaze performance

Run from the root with the local Vite app available on port 5173:

```
node tests/biometric-menu-performance/run-check.mjs
```

The browser runs actual bundled WebGazer/MediaPipe inference and the real
TrialRunner/Menu D in one page. Non-local requests are blocked. The fake video
contains no face; callbacks are expected to be invalid/no_prediction. This
tests runtime contention, not calibrated human gaze quality.

Current gate: **fail**. Latest default-capture raw observation: 180 ms configured,
189.6 ms observed transition, 30.01 fps during active motion, five concurrent inference
callbacks. Earlier observations ranged from 24 to 33 fps. The required 50 fps has not been
waived. Even a separate production menu-only rerun measured 43.6 fps, so hardware
and host load must be controlled before interpreting the inference overhead.

The diagnostic measured 57.14 fps before inference with Intel Iris Xe/D3D11
hardware acceleration. A test-only 320×240 capture experiment achieved 32.72 fps
and still failed. The override was reverted; production capture defaults are
unchanged. camera320-* artifacts and the latest performance-run.txt describe
that labeled experiment; motion-observation.json retains the default-capture run.

motion-observation.json is written before assertions, preserving failures.
measured-metrics.json is generated only if every check and teardown passes.
performance-run.txt propagates the actual failing exit code.

Timing uses D3's scheduled start; starting at the first visible transformed
frame underestimated duration when frames dropped. FPS uses only active frame
intervals, without an idle tail. Do not rerun until a concrete source, harness,
or controlled-environment change justifies a new measurement. Human calibration
and a device-specific dedicated-tracker validation remain separate requirements.

## Paired diagnostic (2026-10-24, labeled, not the gate)

Command: `node tests/biometric-menu-performance/run-diagnostic-paired.mjs`.
Artifacts: `diagnostic-paired-observation.json`, `diagnostic-paired-run.txt`.
The production gate above and its failure artifacts are untouched.

Environment: Windows 11 26200, i7-1165G7 (4C/8T), Intel Iris Xe via ANGLE
D3D11, Chromium 156.0.8078.4 headless, 1920×1080 at DPR 1, fake camera
640×480@20, no other builds/tests running. Baseline rAF before inference:
59.99 fps. One page, one Menu D instance, one camera track; all 120 FaceMesh
calls returned `no_face`. No external requests; track ended after teardown.

| Same-page phase (root→sport, 180 ms configured) | Active fps | Frames | Observed | Inference during window |
| --- | ---: | ---: | ---: | --- |
| Warm-up, first transition after inference start | 32.72 | 6 | 202.1 ms | steady inference |
| A: identical transition, inference active | 47.99 | 8 | 182.5 ms | 9 calls, 145.9 ms overlap (80%) |
| B: identical transition, inference paused | 59.95 | 11 | 203.3 ms | 0 calls |

Inference wall time across the run: median 12.2 ms, p90 18.4 ms, max 178.7 ms.
The active window is dominated by main-thread `estimateFaces` work, one call
per WebGazer rAF; the paused run produced 11 active frames versus 8 with
inference. The gate still fails in the warmed state at 48.0 fps, and the
preserved 30.01 fps artifact remains the recorded release result. The
first-transition value of 32.72 fps matches the earlier 320×240 experiment
numerically, which merely suggests a shared cold-start/warm-up factor; equality
alone does not prove that experiment was confounded, so no capture-resolution
conclusion is warranted. The 640×480 fake capture and the model's fixed input
size make resolution an implausible lever regardless.

Steady-state windows in the generated artifact were both sampled after phase B
paused inference (harness order bug, annotated in the JSON and excluded). The
spec now samples inference cadence before the pause for future runs.

## Frame-gate implementation and gate result (2026-10-24, for review)

`WebGazerApi` now exposes `getTracker()`. `WebGazerSource` wraps
`tracker.getEyePatches` and prefers `getVideoPlaybackQuality().totalVideoFrames`
as frame identity, falling back to `requestVideoFrameCallback` presented-frame
metadata only when the decoded count is unavailable. Decoded-first precedence
avoids a one-frame double inference when rVFC metadata first arrives. A
duplicate frame returns `null` (no cached eye patches, so regression and
Kalman never run on them) and its gaze callback is suppressed. A new frame
that yields no face still emits a genuine `no_prediction` sample; a new frame
with a prediction is delivered normally. Calibration recording temporarily
disables the gate so `recordScreenPosition` sees fresh `latestEyeFeatures`.
Stop restores the original tracker method and cancels the frame callback. If
neither frame-identity source exists the gate fails open and every call
infers.

Focused tests: 17 pass (`test/biometrics/webgazer.test.ts`), full web Vitest
run completed without reported failures, and TypeScript is clean. Red-green
evidence: forcing `installFrameGate` to return early made 5 of the 17 tests
fail (duplicate call returned real patches, duplicate sample was emitted,
restoration/fallback expectations broke); restoring the gate returned 17/17.
The unchanged 50 fps gate was run after the source change and still fails:

| Source revision | Active fps | Active frames | Raw frame deltas (ms) | Samples during zoom | Total samples | Failure |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| Run 1, rVFC-only key | 43.72 | 8 | 33, 16.7, 17, 16.4, 33.2, 16.7, 33.4, 16.6 | 0 | 3 | fps < 50 |
| Run 2, rVFC + decoded key | 13.32 | 2 | 83.4, 66.7 | 2 | 31 | frame count < 5 |

Run 1 exposed a real hidden-video limitation: a `display:none` container
stalls rVFC after a few presented frames while decoded frames continue, so the
rVFC-only key froze and genuine samples were skipped. Run 2 restored sample
delivery (31 emitted samples implies 31 new-frame inference results under
`no_face`; the tracker does not expose a separate `estimateFaces` counter) but
the transition saw only two frames. Once duplicate inference is removed, the
remaining per-new-frame FaceMesh work can still block the transition for
66–83 ms; the 43.7 vs 13.3 fps spread also shows the headless fake-camera path
is not stable enough to characterize the residual cost. Neither run passes,
and this hook alone is not a scientifically acceptable 50 fps fix.

The final decoded-first precedence change was made after gate run 2 and is
unit-tested only; it was not gate-run because the freeze point was reached.
The next step is off-main-thread FaceMesh (worker-backed tracker or dedicated
tracker bridge) with the same new-frame identity and sample semantics; that is
a larger change, not a vendor fork.

Artifacts: pre-change failure in `performance-run-pre-frame-gate.txt` and
`motion-observation-pre-frame-gate.json`; run 1 in
`performance-run-frame-gate-run1-rvfc-only.txt` and
`motion-observation-frame-gate-run1-rvfc-only.json`; run 2 in
`performance-run-frame-gate-run2-combined.txt` and
`motion-observation-frame-gate-run2-combined.json` (the run-2 filename records
the then-current combined key; final source is decoded-first). No
capture-resolution, human-accuracy, or gate-pass claim is made.

Camera/sample implications: emitted samples now follow unique decoded frames,
duplicate callbacks are dropped rather than re-emitted, and sample counts can
fall; AOI-entry resolution may therefore change in analysis. Calibration
recording temporarily restores full-rate inference so training clicks see
fresh features. No human-accuracy claim is made.

Explicitly rejected: pausing gaze for 180–220 ms during menu motion, and
thinning inference to a fixed 30 Hz while the camera supplies new frames.
Both reduce measured gaze (AOI-entry samples, or unique samples) without a
revised analysis or quality argument; phase B's 59.95 fps only proves the
ceiling, not an acceptable measurement policy. The gate also conflates
first-transition warm-up with inference cost: an untimed warm-up before
measurement would better represent sustained interaction, but that is a
methodology decision for the coordinator and does not by itself pass the gate
(47.99 < 50).

The paired spec is deliberately separate so the gate and its artifacts remain
byte-for-byte untouched; its recorder/inference instrumentation duplicates
part of the gate harness and should be factored into a shared helper in a
later, separately reviewed change.
