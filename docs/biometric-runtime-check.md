# WebGazer 3.5.3 Bundled Browser Runtime Verification Report

Latest shipping-source rerun (2026-10-24 06:58 UTC): 1/1 passed. The frame-gated
source delivered two genuine no-prediction callbacks in the observed window,
loaded all assets locally, attempted no external requests, and ended the camera
track on stop. The three-sample slice below is historical, before frame gating.
Neither run establishes human accuracy or the 50 fps performance gate.

## 1. Overview and Scope
This document records the empirical verification of the bundled browser runtime of `webgazer@3.5.3` integrated via `WebGazerSource` under strict offline execution conditions:
- **Browser Channel**: Playwright full Chromium channel (`channel: "chromium"`, version 156.0.8078.4) with genuine `window.chrome` (no API spoofing or mock objects).
- **Camera Capture**: Fake media stream device (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--autoplay-policy=no-user-gesture-required`).
- **Network Boundary**: 100% offline isolation. All external HTTP/HTTPS network requests intercepted and aborted (`route.abort('blockedbyclient')`).
- **Consent Discipline**: Simulated explicit participant consent required prior to any camera device access.
- **Accuracy Scope**: Synthetic frames contain no face and do not establish participant accuracy or gaze validity; this test verifies runtime startup, local asset loading, subscription event dispatch, and clean teardown.

---

## 2. Empirical Verification Evidence

| Verification Dimension | Measured Criterion | Observed Evidence | Status |
| :--- | :--- | :--- | :---: |
| **Browser Environment** | Full Chromium channel (`channel: "chromium"`); no spoofing of `window.chrome` | `window.chrome` natively present (`type: "object"`); no property definition or mocks applied | **PASS** |
| **Pre-Consent Protection** | Zero camera device requests prior to explicit consent | `source.start(null)` throws `gaze_consent_required`; `navigator.mediaDevices.getUserMedia` calls = 0 | **PASS** |
| **Simulated Consent** | Valid simulated consent via `grantGazeConsent` | `grantGazeConsent` accepted; `source.start(consent)` succeeds cleanly | **PASS** |
| **Startup Transition** | Lifecycle status transitions cleanly | Transitions `idle` &rarr; `starting` &rarr; `running`; `cameraActive` becomes `true` | **PASS** |
| **Model & WASM Assets** | All MediaPipe FaceMesh assets served from local `/vendor/webgazer/mediapipe/face_mesh/` | Loaded locally: `face_mesh_solution_packed_assets_loader.js`, `face_mesh_solution_simd_wasm_bin.js`, `face_mesh.binarypb`, `face_mesh_solution_packed_assets.data`, `face_mesh_solution_simd_wasm_bin.wasm` | **PASS** |
| **Offline Isolation** | All external HTTP/HTTPS traffic blocked | External requests attempted = 0; Blocked URLs list = `[]` | **PASS** |
| **Subscription Handling** | Subscribe receives synthetic frames; handles no face | Total samples received &ge; 3; sequence numbers strictly increasing; all samples have `valid: false`, `invalid_reason: "no_prediction"`, `x_px: null`, `y_px: null`, finite `t_ms` | **PASS** |
| **Teardown & Tracks** | Stopping runtime and releasing hardware tracks | `source.stop()` transitions to `stopped`, `cameraActive: false`, all MediaStreamTracks reach `readyState: "ended"` | **PASS** |
| **Privacy & Storage** | No raw camera videos saved to disk | Playwright video recording disabled (`video: "off"`); 0 video files generated | **PASS** |

---

## 3. Measured Sample Dispatch Evidence
Sample slice captured from fake-camera frames during runtime execution:
```json
[
  {
    "seq": 1,
    "t_ms": 4478.80,
    "t_source_ms": 3635.80,
    "x_px": null,
    "y_px": null,
    "valid": false,
    "invalid_reason": "no_prediction",
    "trial_id": null
  },
  {
    "seq": 2,
    "t_ms": 4510.10,
    "t_source_ms": 3652.40,
    "x_px": null,
    "y_px": null,
    "valid": false,
    "invalid_reason": "no_prediction",
    "trial_id": null
  },
  {
    "seq": 3,
    "t_ms": 4535.00,
    "t_source_ms": 3681.00,
    "x_px": null,
    "y_px": null,
    "valid": false,
    "invalid_reason": "no_prediction",
    "trial_id": null
  }
]
```

---

## 4. Local Model and Asset Loading Breakdown
All runtime dependencies for WebGazer 3.5.3 and MediaPipe FaceMesh resolved locally via Vite (host port 5173) from `apps/web/public/vendor/webgazer/mediapipe/face_mesh/`:
- `/vendor/webgazer/mediapipe/face_mesh/face_mesh_solution_packed_assets_loader.js`
- `/vendor/webgazer/mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.js`
- `/vendor/webgazer/mediapipe/face_mesh/face_mesh.binarypb`
- `/vendor/webgazer/mediapipe/face_mesh/face_mesh_solution_packed_assets.data`
- `/vendor/webgazer/mediapipe/face_mesh/face_mesh_solution_simd_wasm_bin.wasm`

Zero CDN or external endpoint calls were made (`externalRequests.length === 0`).

---

## 5. Teardown and Resource Cleanup
- `source.stop()` transitioned wrapper state to `stopped`.
- Underlying `MediaStreamTrack` verified: `readyState === "ended"`.
- Playwright page, context, and browser cleanup enforced in `finally` blocks across all paths.

---

## 6. Repeatable Commands and Artifacts

### Test Suite Execution
Direct Playwright invocation:
```bash
npx playwright test --config tests/biometric-runtime/playwright.config.ts
```

Automated runner with structured artifact generation:
```bash
node tests/biometric-runtime/run-check.mjs
```

### Artifact Reference
- Output log artifact: `tests/biometric-runtime/runtime-run.txt`
- Measured structured metrics: `tests/biometric-runtime/measured-metrics.json`
- Playwright spec: `tests/biometric-runtime/webgazer-runtime.spec.ts`
- Playwright config: `tests/biometric-runtime/playwright.config.ts`
- Suite runner: `tests/biometric-runtime/run-check.mjs`

## Integration audit (2026-11-12)

The wrapper now rejects a second start while paused/stopping, ignores gaze
callbacks outside the running session, guards late resume and calibration
completion by session generation, releases all tracks attached to the video
before upstream teardown, and stops acquisition on tracker inference failure.
Runtime failures remain inspectable through `WebGazerSource.errorReason` and
`status`; the participant controller must propagate source status changes to
its UI (the source's optional `onStatus` callback is the existing hook).

A zero `getVideoPlaybackQuality().totalVideoFrames` no longer becomes a
permanent duplicate key. When decoded counters are unavailable/zero, advancing
video `currentTime` is used before presented-frame metadata, because hidden
video can stop rVFC delivery. This fallback indicates advancing media time,
not a guarantee of exactly one inference per decoded frame. The zero-counter
freeze is reproduced by a unit test; it is a plausible Safari low-sample-rate
cause, not a confirmed diagnosis of the participant's failure.

WebGazer 3.5.3's installed source confirms `begin()` already awaits loaded video
data and the first inference, and permission errors reject its promise. No
extra readiness sleep or coordinate scaling is appropriate: explicit training
uses viewport CSS pixels (`clientX/clientY` upstream), matching the wrapper's
viewport and calibration coordinates. The asset-copy command succeeds against
the installed package's `dist/mediapipe`; no asset-path change was needed.

Regression command: `npm run test -w @meridian/web --
test/biometrics/webgazer.test.ts test/biometrics/webgazer-lifecycle.test.ts
test/biometrics/bridge.test.ts` (35 passing). The added cases were observed
failing before their fixes. Real-camera Safari/Firefox accuracy and the menu
50 fps gate require separate measured runs; these unit tests do not establish
those outcomes.

The Chromium bundled-runtime check was rerun on 2026-11-12:
`npx playwright test --config tests/biometric-runtime/playwright.config.ts`
passed (1/1, 19.2 seconds), including local model assets, no external requests,
callback dispatch and all-track teardown. `npx tsc -p apps/web/tsconfig.json
--noEmit` passed. The broader `test/biometrics` run encountered unrelated
runner storage errors (`storage.setItem is not a function`); the focused
source tests above all pass. Historical measured-metrics.json is preserved.

Remaining integration follow-up outside this worker's ownership: connect
`WebGazerSource`'s `onStatus("error")` in `ExperimentRunner` to the controller /
participant error path so a mid-session model failure gets an immediate
message instead of only eventual missing-sample quality failure. Upstream
`src/index.mjs` also calls `localforage.clear()` without awaiting its promise
inside `clearData`; IndexedDB rejection can escape the upstream promise.
Correcting that storage promise requires an upstream dependency fix, beyond
this wrapper's owned files; no claim is made that upstream storage internals
are error-free.
