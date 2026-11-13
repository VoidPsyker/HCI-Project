# Eye-tracking acquisition and analysis

The current pilot treats gaze as optional, as described in §11.4 of the longer research
plan. Participants can finish the behavioural study if they decline gaze consent, the camera
cannot start. Scored gaze capture requires separate consent and a completed calibration;
the held-out error never blocks capture. Each session's manifest stores `calibration`
(`max_error_deg`, `mean_error_deg`, `cutoff_deg`, `within_cutoff`); sessions within the
10° cutoff are `analysis_ready`, and a different cutoff can be applied at analysis. The trial and event exports record when gaze
became unavailable. See the [researcher guide](researcher-guide.md) for the current flow.

The development notes below include earlier implementation stages and the former mandatory
gaze policy. Those descriptions are historical where they differ from the current pilot.

## Files and ownership

- `packages/analysis/src/**` — device-independent types, consent checks,
  geometry, clock sync, calibration summary, I-VT fixations, AOIs, quality
  gates, restricted export, synthetic replay, and `GazeSession`. Pure
  TypeScript; no DOM, camera, or network access.
- `apps/web/src/biometrics/**` — browser adapters: consent record, WebGazer
  webcam source, generic WebSocket hardware bridge, and the local WebGazer
  loader.
- `apps/web/test/biometrics/**` and `packages/analysis/test/**` — Vitest tests.
- `apps/web/scripts/copy-webgazer-assets.mjs` — copies the MediaPipe face-mesh
  runtime and license/notices from `node_modules/webgazer` into the local
  public asset path before dev/build.

Nothing outside these paths is wired to biometrics yet. The consent and session
screens, `ExperimentRunner`, `TrialRunner`, menus, server, and restricted
storage are coordinator-owned. Existing user-facing copy that says “No webcam /
no biometrics” is now wrong and must be changed by that integration.

## Participant flow

1. **Core study consent**, then a **separate gaze consent**. Gaze consent is
   explicit and versioned; webcam use additionally needs camera consent. There
   is no default grant. Refusal or withdrawal means no eye-tracking data; never
   substitute synthetic data for a refusing participant.
2. **Estimate the display** when the camera starts: `estimateScreenGeometry`
   derives millimetres and viewing distance from the CSS reference pixel
   (96 px per inch at 28 in) for the CSS-pixel viewport used for gaze
   coordinates. Angles are approximate; see `ASSUMPTIONS.md`. `ScreenGeometry.width_px`/`height_px` must equal the capture
   viewport exactly; `GazeSession` and export reject a mismatch.
3. **Start acquisition** only after server consent. `GazeController.start()`
   awaits `api.consent`, then creates the session and starts the camera.
   Cancellation or withdrawal while consent or source startup is pending
   invalidates late continuation via generation guards and preserves terminal
   stopped/withdrawn state without starting the camera or setting ready.
4. **Calibrate and validate**: two-pass procedure. Present and train all nine
   targets first via `trainCalibrationTarget`, then evaluate held-out predictions
   across all nine targets on the final model without retraining
   (`validateCalibrationTarget`, zero training calls during validation). The
   cutoff is compared with the worst per-participant held-out point, not a
   device spec or a population mean. It labels the session; it never stops capture.
5. **Run trials**: `startTrial` / `endTrial` around the exact trial window;
   register stable AOIs before the trial. Samples outside trials are not
   retained for human sources.
6. **Stop or withdraw**. Withdrawal stops acquisition and deletes in-memory
   gaze data. Completed sessions build a restricted export.
7. **Store and analyse** the export under separate access control. Raw video is
   never part of the pipeline or schema.

## Core API (`@meridian/analysis`)

```ts
ninePointTargets(viewport: Viewport, marginFraction = 0.1): CalibrationTarget[]
summarizeCalibration(
  targets: CalibrationTarget[],
  observations: CalibrationObservation[],
  geometry: ScreenGeometry | null,
  criterionDeg = 1.5
): CalibrationReport
```

`CalibrationObservation` has `target_id`, `x_px`, `y_px`, and optional `t_ms`.
`summarizeCalibration` reports per-point and aggregate pixel/degree error.
`passes` is `null` when geometry is missing or no angular error exists; it is
never inferred. The cutoff uses the worst point's maximum error.

```ts
class GazeSession {
  constructor(options: {
    participant_id: string;
    session_id: string;
    source: GazeSource;
    consent: GazeConsent | null;
    viewport: Viewport;
    geometry: ScreenGeometry | null;
    now?: () => number;              // capture clock, default performance.now
    qualityConfig?: GazeQualityConfig;
    max_samples?: number;            // default 500_000
  });
  start(): Promise<void>;
  stop(): Promise<void>;
  withdraw(): Promise<void>;
  setAois(aois: readonly AoiDefinition[]): void;
  addAoi(aoi: AoiDefinition): void;
  setCalibration(report: CalibrationReport): void;
  startTrial(input: {
    trial_id: string; menu_id: string; target_aoi_id?: string | null; start_ms?: number;
  }): TrialWindow;
  endTrial(input: {
    trial_id: string; end_ms?: number; maxGapMs?: number;
  }): TrialGazeMetrics;
  getSamples(): readonly GazeSample[];
  getRejectedSampleCount(): number;
  getDroppedSampleCount(): number;
  getTrials(): readonly TrialWindow[];
  getMetrics(): readonly TrialGazeMetrics[];
  getCalibration(): CalibrationReport | null;
  getQuality(): GazeQualityReport;
  buildExport(createdAt?: string): GazeExportBundle;
}
```

Trust and retention rules in `GazeSession`:

- `seq` must be a positive integer and strictly increasing; `t_ms` must be
  finite. Violations are rejected and counted; any rejection fails quality.
- A sample marked valid with missing/non-finite coordinates is normalized to
  `valid: false` with `invalid_reason` (`no_prediction` or `non_finite`) instead
  of being trusted.
- Human sources retain samples only while a trial is active. Idle/calibration
  samples are not accumulated by `GazeSession`; calibration observations are
  collected by the integration from the source subscription.
- Retained samples are capped by `max_samples`; capacity drops are counted and
  fail quality. Duplicate trial IDs and overlapping trial windows are rejected.
- Synthetic replay retains its full finite recording so the pipeline can be
  exercised, but synthetic data can never be analysis-ready.

`GazeSample` carries `seq`, synchronized `t_ms`, raw `t_source_ms`, `x_px`,
`y_px`, `valid`, optional `invalid_reason`, optional pupil millimetres, and an
optional `trial_id`. It contains no click events, cursor events, images, or
video frames.

`GazeQualityReport` is `pass` / `fail` / `not_evaluable` and includes:

- `missing_pct` — invalid or unlocated samples / all retained samples;
- `median_sample_interval_ms`, `dropout_count`, `dropout_ms`,
  `longest_gap_ms`, `coverage_pct`, where gaps longer than 1.5× the median
  interval count as dropout and coverage is `1 - dropout/span`;
- `effective_sample_rate_hz` — `(valid_samples - 1) / valid_span`, not
  `n / span`, so a single sample cannot claim a rate;
- `rejected_samples`, `dropped_samples`, and per-check `checks`/`exclusions`.

Required checks are nine calibration points, no calibration observation with an
unknown target id, held-out calibration error ≤ the 10° cutoff, missing gaze
≤ 20%, received-sample coverage ≥ 80% (matching the 20% missing gate over
duration), zero trust-boundary rejects/drops, valid separate gaze consent with
`raw_video_retention: false`, and, if configured, a clock residual and
sample-rate floor. `angular_metrics_ready` additionally
requires measured geometry and a calibration angular error. `analysis_ready`
is true only for a non-synthetic `pass`.

The plan's 1.5° gate is below webcam accuracy (WebGazer's published mean
visual-angle error is 4.17°), so it is not used to stop capture. Every
calibrated participant's gaze is kept with its measured error; `analysis_ready`
reflects the 10° cutoff and the analysis may apply a stricter one.

Fixations use I-VT at 30°/s with a 100 ms minimum. Angular values require
measured geometry; without it they are `null`/not evaluable. The geometry
function uses exact eye-to-point rays from a single eye on the screen normal
through the centre. That is a documented centred-eye approximation, not
clinical or binocular accuracy, and equal pixel steps correctly subtend less
angle near the screen edge.

## Browser adapters (`apps/web/src/biometrics`)

### Consent

```ts
grantGazeConsent(request: {
  participant_id: string;
  session_id: string;
  version: string;
  camera_used: boolean;
  granted_at?: string;
}): GazeConsent
assertCameraConsent(consent, participantId, sessionId)
```

`scope` is always `eye_tracking_only`, `raw_video_retention` is always `false`,
and `separate_from_core_consent` is always `true`. The adapter refuses to load
the library, request camera access, or create a hardware socket without valid
consent.

### WebGazer webcam source

```ts
new WebGazerSource({
  participant_id, session_id,
  load: loadBundledWebGazer,          // or an injected fake in tests
  viewport: () => Viewport,
  now?, mediaPipeSolutionPath?, calibrationRepetitions?, repetitionDelayMs?, wait?, onStatus?
})
```

`loadBundledWebGazer()` performs the local `import("webgazer")`. Production
must pass it explicitly so tests never load TensorFlow/WebGazer. The adapter
refuses a non-HTTPS, non-loopback origin before loading the library. WebGazer's
own HTTPS warning wrongly rejects `http://127.0.0.1` (a secure context) and
opens a blocking alert there; the adapter suppresses only that false-positive
alert on loopback and still fails closed on any other insecure origin.
Defaults: `saveDataAcrossSessions=false`, video/overlay/face-feedback/gaze-dot
hidden, Kalman filter on, `storingPoints=false`, `clearData()` before
`begin()`, and `removeMouseEventListeners()` after `begin()`. Calibration is
explicit:
`recordCalibrationTarget()` records five clicks per point by default. Implicit
click/cursor training is disabled. A live preview is opt-in with
`setCalibrationFeedback(true)` and must be turned off after calibration.
`stop()` clears the listener/model, calls `stopVideo()` before `end()`, and
marks the camera inactive. `pause()`/`resume()` control acquisition during a
break.

The source reports `nominal_hz: null`; it does not claim a webcam frame rate.
`clock` is an observed-arrival mapping used to put WebGazer elapsed time on the
capture clock.

### Hardware bridge (future lab tracker)

```ts
new WebSocketGazeSource({
  url, participant_id, session_id, viewport,
  createSocket?, now?, pingIntervalMs?, syncTimeoutMs?, maxBufferedSamples?, onStatus?
})
```

Protocol id: `meridian.gaze.bridge/1` over a local WebSocket. The adapter accepts
only `ws:`/`wss:` URLs on `localhost`, `127.0.0.1`, `[::1]`, or `::1`, and
rejects URL credentials before creating a socket; a remote collector is
impossible by construction. The native process owns the device. Browser→bridge
messages are `{type:"ping", id}` and `{type:"pause"|"resume"|"stop"}`.
Bridge→browser messages:

- `hello`: `type`, `protocol`, `participant_id`, `session_id`, `source`,
  `device`, `nominal_hz` (number|null), `viewport` (`width_px`,`height_px`), and
  optional `device_clock` (`{method, residual_ms}`). The hello must match the
  session's participant/session and the live viewport.
- `pong`: `id`, `t_bridge_recv_ms`, `t_bridge_send_ms`. Three exchanges are
  required before samples are released.
- `sample`: `seq` (positive, strictly increasing), `t_bridge_ms` (finite,
  strictly increasing), optional `t_device_ms`, `x_px`/`y_px` (both numbers or
  both null), optional `valid`, optional non-negative pupil millimetres.

Media fields (`image`, `video`, `frame`, `raw_video`, `face_image`) fail the
connection. Samples arriving before hello/clock sync are buffered up to
`maxBufferedSamples` (default 5,000); overflow is a hard error. This adapter is
generic on purpose: no Tobii or Gazepoint SDK is bundled. A native bridge must be
written and validated before any lab tracker claim.

## Export contract

`buildGazeExport()` (or `GazeSession.buildExport()`) returns:

- `manifest` — `meridian.gaze/1`, participant/session, source info, consent
  metadata, measured geometry/viewport, clock report, quality summary,
  `synthetic`/`human_data`, stream names, `contains_click_events: false`,
  `contains_raw_video: false`, `restricted_access: true`, retention scope/counts,
  and sample/trial counts.
- `samples_jsonl` — one `GazeSample` per line, matching the stream name
  `gaze_samples.jsonl`.
- `aoi_metrics_jsonl` — one `TrialGazeMetrics` per line, `aoi_metrics.jsonl`.
- `quality_json` — calibration report plus full quality report,
  `gaze_quality.json`.

`parseGazeSamplesJsonl()` rejects malformed lines. Human exports require valid
gaze consent. Synthetic exports must have `source.kind === "synthetic"` and are
always marked not analysis-ready. The manifest's retention scope is
`trial_only` for human `GazeSession` data and `synthetic_full` for replay.

The export is data only; it is **not** a storage implementation. The server must
write it to a separate restricted location, restrict access, and keep it out of
normal application logs and click-event storage. That work is not done.

## Offline assets, license, and hardware limitations

WebGazer 3.5.3 is pinned and locally bundled. `npm run assets:webgazer` copies
`node_modules/webgazer/dist/mediapipe` to
`apps/web/public/vendor/webgazer/mediapipe` and copies the upstream license plus
`THIRD_PARTY_NOTICES.md` beside it. `predev`/`prebuild` run this script. The
generated `apps/web/public/vendor/webgazer/` directory is git-ignored and must
not be committed. At runtime the configured MediaPipe path is the local
`/vendor/webgazer/mediapipe/face_mesh`; there is no model CDN.

WebGazer is GPL-3.0-or-later, copyright Brown WebGazer Team, and official
maintenance ended 2026-02-24. Preserve the notices and license. Distribution
outside the research team may create GPL source-availability obligations for
the combined work; the study's legal contact must review that before
distribution. This document is not legal advice.

Hardware status:

- confirmed: integrated webcam only, no dedicated eye tracker attached to the
  current machine;
- unknown: lab tracker model, its SDK/bridge, mounting, sampling rate, and
  device-clock characteristics;
- unknown: ethics approval, consent wording approval, and approved storage
  location/retention period;
- no claim that the webcam or synthetic replay has validated research accuracy.

WebGazer's own published mean error (4.17°) is not a validation result for this
study. Per-participant 9-point held-out validation is mandatory. Synthetic
replay proves plumbing only and never sensor validity. No emotion, clinical, or
diagnostic inference is in scope; only gaze position, timing, and optional pupil
diameter are represented.

Hugging Face model weights were considered as an optional local inference path
but were not adopted: no supported local runtime/weights were installed, no
validated screen calibration exists, and remote inference would violate the
offline/privacy boundary. WebGazer remains the only implemented acquisition
fallback.

## Integration steps (coordinator-owned)

1. Add a gaze/camera consent screen after core consent, with explicit
   grant/refuse and versioning. Wire refusal to “no biometrics” and the study's
   exclusion/stop rule. Remove the old “no webcam / no biometrics” copy.
2. Capture the exact capture viewport and its estimated geometry when the
   camera starts, and persist them with the session.
3. Create the source (`loadBundledWebGazer` for webcam, bound
   `WebSocketGazeSource` for a lab bridge) and a `GazeSession` with the same
   participant/session IDs, viewport, geometry, consent, and explicit
   `qualityConfig`. Call `start()` only after consent.
4. Implement calibration/validation UI from `ninePointTargets(viewport)`.
   Present and train all nine targets first, then collect held-out predictions
   for all targets on the final model with zero training calls during validation.
   Build observations with `target_id` and call `summarizeCalibration()`. Store
   the report with `setCalibration()`. Do not record mouse clicks as calibration
   points.
5. For each trial, call `startTrial()` at the trial's start on the same clock as
   `GazeSample.t_ms`, register the trial's stable AOIs, then `endTrial()`.
   Trial timestamps must not mix `Date.now()` with `performance.now()`.
6. On stop, call `stop()`; on withdrawal/refusal, call `withdraw()`. After a
   completed session, `buildExport()` and send the bundle to restricted storage.
   Do not place gaze rows in click-event tables or logs.
7. Add the server-side restricted store and access checks. There is currently
   no biometrics endpoint, table, or file path.
8. Keep the network-blocked fake-camera test green as the app changes:
   `tests/e2e/biometrics-offline.spec.ts` starts the real bundled WebGazer with
   a fake camera, aborts every non-local request, checks that the face-mesh
   runtime came from `/vendor`, stops the camera, and asserts that no dialog
   blocked startup. The fake video has no face, so this is startup/offline
   evidence only, not accuracy evidence.
9. Root `package.json` test/build scripts do not yet include the analysis
   workspace. The integration owner must add `npm run test -w
   @meridian/analysis` (and the analysis build) to the root scripts; this worker
   did not edit the root manifest.

## Verification evidence

Run from the repository root (Docker is the reliable host for the full build):

```text
docker run --rm -w /app/packages/analysis periwinkle-test:local npx vitest run
docker run --rm -w /app/apps/web periwinkle-test:local npx vitest run test/biometrics
npx playwright test tests/e2e/biometrics-offline.spec.ts --project=chromium
docker build -t periwinkle-test:local .
```

Worker-reported results after two-pass calibration and deferred-consent fixes:
`packages/analysis` 55/55 tests pass; `apps/web/test/biometrics` 26/26 tests
pass (including fake-source regression tests for ordered training then validation,
delayed-consent cancellation, startup pending stop/withdraw, and gate failure). The full Docker image build (TypeScript for web and server
plus Vite production build) also passes. Unit tests use injected sources and the
browser smoke uses a fake camera with no face; none of this proves camera
accuracy, real participant data quality, ethics compliance, or hardware
compatibility.

## Open blockers

- Resizing after capture starts now stops capture and invalidates calibration,
  even if the viewport is restored. The interrupted trial is excluded.
- Camera-start failures can retry in the same page using the existing consent
  token. A reload before any gaze samples are uploaded re-registers consent and
  receives a new token; once samples exist the token is required, so a reload
  during trials still needs a new researcher link.
- No ethics approval or approved consent wording; do not claim either.
- No lab tracker, native bridge, or hardware validation.
- Server-side restricted storage and consent/session/trial UI are implemented;
  isolated synthetic controller-to-HTTP-to-SQLite verification passes 10/10.
- The November 12 isolated fake-camera Menu D check passes the 50 fps gate
  (59.98 fps, original 180 ms transition); earlier host-specific failures are
  documented in `biometric-menu-performance.md`.
- The fake-camera smoke proves offline startup only; real-camera accuracy and
  lab hardware remain unvalidated.
- GPL/legal review for distribution and the end-of-maintenance risk for
  WebGazer remain open.
- Calibration error no longer stops capture (see `ASSUMPTIONS.md`); the 20%
  missing-gaze gate still decides `analysis_ready`.

## Calibration coordinate and retry checks (November 2026)

Calibration targets use capture-viewport **CSS pixels**, just like WebGazer
predictions and `ScreenGeometry.width_px`/`height_px`; device pixel ratio is not
applied. The participant app renders inside a scaled 1920 × 1080 stage. Targets
must be portalled to `document.body`, outside that transformed ancestor:
`position: fixed` inside a transformed stage would scale/offset their viewport
coordinates again and train the model against a different location from the one
shown. Training now waits for the same fixation settling interval as validation
before recording eye features (250 ms by default).

The validation result shows the measured maximum and mean error with an
optional recalibration action. A retry runs all nine training points and all
nine held-out validation points again. Whatever the error, the participant
continues to the trials with gaze recorded. No retry count is specified in the current protocol documents;
the UI leaves this decision to the participant and researcher rather than
inventing a terminal attempt limit.

Protocol discrepancy: `docs/experimental-plan/experimental-plan.tex` currently
says error above 1.5° ends the session before scoring, while the current pilot
policy at the top of this document and the longer plan §11.4 make gaze optional.
The current UI follows the optional-gaze pilot policy. The plan owner must align
the shortened TeX plan before treating the documents as one consistent protocol.

Regression evidence: the calibration UI test asserts that targets are direct
children of `document.body`, exercises React effect replay, and recalibrates after
failure. Controller tests verify settling before training, cancellation during
settling, two-pass ordering, and that trials record gaze beyond the cutoff. These are
coordinate/control-flow checks; a real Safari camera session is still required
to establish participant accuracy and camera behaviour.

### Same-tab debrief recovery

The controller checkpoints the finalization payload after startup, after each
trial, on pagehide, and before completion. The uploader checkpoints its bounded
pending queue and batch ID in `sessionStorage`, under the session's own key.
This permits a debrief reload in the same tab to send pending samples using the
same idempotency key and finish the restricted server export without restarting
the camera. `resumeGazeFinalization(sessionId)` returns the saved completion
receipt on later retries. Upload/recovery errors keep the debrief open; missing
recovery state for an expected gaze session is not treated as a successful save.
Sessions that declined gaze or marked it unavailable do not require this path.

The temporary recovery record contains the session-scoped ingestion credential,
coordinates awaiting upload, and finalization metrics; it contains no video.
Successful finalization removes the credential, raw queue and payload, retaining
only the completion receipt. Withdrawal clears the record, and late upload
acknowledgements cannot recreate it. Closing the tab discards recovery state;
this does not make camera capture resumable after reload. Browser storage must
be available: quota/storage failure blocks gaze completion rather than claiming
that missing data were saved.

The runner also subscribes to tracker error status. During calibration it tears
down the failed acquisition and offers camera setup retry; a restart invalidates
any old calibration. During trials it marks gaze unavailable and tells the
participant they can finish the behavioural study.
