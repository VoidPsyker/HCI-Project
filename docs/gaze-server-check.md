# Server Biometric Acceptance & Trust Boundary Verification Report

## 1. Overview and Scope

This document details the acceptance test suite for the server-side biometric gaze acquisition API (`@meridian/server`), validating data trust boundaries, cryptographic token authentication, payload bounds, and quality gate integrity.

- **Execution Environment**: Isolated Docker container execution using `periwinkle-app:latest` with precompiled Linux `better-sqlite3` native bindings.
- **Database Isolation**: Ephemeral temporary SQLite database and scratch directories per test suite run (`/tmp/gaze-acceptance-*`); zero access or mutation to `./data/meridian.sqlite` or production participant databases.
- **Transport & Harness**: In-memory Fastify server injection via `app.inject()`; no host ports or live network interfaces bound.
- **Ownership Boundary**: Acceptance test suite owned in `apps/server/test/gaze-acceptance.test.ts`, configuration in `apps/server/vitest.config.ts`, and findings reported to integration owner `ctx_19dfd6db3d1c`.

---

## 2. Acceptance Test Matrix and Empirical Results

| Verification Dimension | Specification & Trust Boundary | Test Case Description | Result |
| :--- | :--- | :--- | :---: |
| **Separate Consent** | Core study consent required before gaze consent | POST `/api/gaze/sessions/:id/consent` returns `409 core_consent_required` if participant has not consented; returns `404 session_not_found` for missing session. | **PASS** |
| **Consent Scoping** | Distinct biometric token generation & hashed storage | Gaze consent produces a dedicated ingestion bearer token; token is stored as SHA-256 hash in SQLite, never plaintext. Consent manifest flags `separate_from_core_consent: true`. | **PASS** |
| **Authentication** | Mandatory token on batch ingestion & completion | Ingestion (`/batches`) and completion (`/complete`) reject missing or forged tokens with `401 gaze_token_invalid`. | **PASS** |
| **Re-Consent Security** | Re-consent requires existing token | Unauthorized re-consent attempts without existing valid token return `401 gaze_unauthorized`. | **PASS** |
| **Token Rotation** | Pre-acquisition re-consent rotates token | Re-consenting prior to sample ingestion rotates the bearer token and invalidates earlier tokens immediately. | **PASS** |
| **Immutability** | Capture geometry & provenance locked after ingestion | Re-consent cannot change `synthetic` flag once samples exist (`400 gaze_consent_synthetic_mismatch`); cannot alter viewport/geometry/source once samples exist (`409 gaze_configuration_immutable`). | **PASS** |
| **Terminal State** | Completed sessions refuse re-consent | Completed gaze sessions reject subsequent re-consent with `400 gaze_session_completed`. | **PASS** |
| **Media Exclusion** | Strict prohibition of raw video and image data | Payload validation recursively blocks media fields (`image`, `video`, `raw_video`, `frame`, `face_image`, `webcam_frame`) with `400 gaze_media_forbidden` on consent, batch, and completion endpoints. | **PASS** |
| **Payload Bounds** | Batch sizing and sequence monotonicity | Batch samples array strictly bounded ($1 \le N \le 500$); rejects zero or negative sequence numbers and non-increasing sequence numbers with `400`. | **PASS** |
| **Idempotency** | Transactional duplicate batch handling | Resubmitting identical `batch_id` returns `{ ok: true, accepted: 0, duplicate: true }` without sample duplication or count inflation. | **PASS** |
| **Sequence Integrity** | Atomic rejection of overlapping sequence ranges | Submitting a batch with `first_seq <= last_seq` of a prior batch returns `409 gaze_seq_conflict` with transactional rollback. | **PASS** |
| **Modality Isolation** | Gaze samples decoupled from interaction events | Gaze ingestion inserts exclusively into `gaze_samples`; zero records created in `events` or `trials`. | **PASS** |
| **Withdrawal Purge** | Full data deletion upon participant withdrawal | Calling `/api/sessions/:id/withdraw` purges SQLite records from all gaze tables and deletes filesystem export directory (`data/gaze/:id`); subsequent ingestion returns `401`. | **PASS** |
| **Abort Handling** | Interrupted session ingestion denial | Aborting session via `/stop` blocks subsequent gaze ingestion and rejects re-consent (`400 session_not_active`). | **PASS** |
| **Admin Authorization** | Gaze exports require admin authentication | `/api/admin/gaze/sessions/:id` and `/export/:file` require valid `x-admin-password`; unauthenticated requests return `401`. | **PASS** |
| **Synthetic Provenance** | Synthetic runs clearly labeled and disqualified | Synthetic session manifests record `synthetic: true`, `human_data: false`, and `analysis_ready: false`. | **PASS** |
| **Quality Gate: Criterion** | Fixed study calibration threshold (1.5°) | Client-inflated `criterion_deg` (e.g. 1000° with 10° error) must never yield `analysis_ready: true`. | **DEFECT** |
| **Quality Gate: Missingness**| Raw validity verification vs client claim | Sessions with 100% invalid stored samples must never yield `analysis_ready: true` even if client claims `missing_pct: 0`. | **DEFECT** |
| **Quality Gate: Non-Zero** | Minimum sample threshold for readiness | Sessions with 0 ingested samples must never yield `analysis_ready: true`. | **DEFECT** |

---

## 3. Discovered Defects & Coordination with Implementation Owner

The acceptance suite surfaced three critical trust-boundary defects in `completeGazeSession` within `apps/server/src/repository.ts`. These findings have been dispatched directly to the implementation owner (`ctx_19dfd6db3d1c`):

1. **Client-Inflated Calibration Gate**:
   - *Current Implementation*: Line 995 evaluates `const criterion = calibration && typeof calibration.criterion_deg === "number" ? calibration.criterion_deg : 1.5;`.
   - *Vulnerability*: A malicious or misconfigured client can pass `criterion_deg: 1000.0` with `max_error_deg: 10.0` and bypass the study accuracy threshold.
   - *Required Fix*: Server must enforce fixed study threshold `1.5°` (`Math.min(1.5, clientCriterion)` or invariant `1.5`).

2. **Client Quality / Missingness Trusting**:
   - *Current Implementation*: Lines 997–1000 trust client-reported `quality.missing_pct` and `quality.overall === "pass"`.
   - *Vulnerability*: When raw samples stored in `gaze_samples` are all invalid (`valid: 0`, e.g. no face detected), a client submitting `missing_pct: 0` receives `analysis_ready: true`.
   - *Required Fix*: Server must compute raw valid sample count from `gaze_samples` and require `validSamples > 0` and computed raw missingness $\le 20\%$.

3. **Zero-Sample Session Approval**:
   - *Current Implementation*: A completion request on a session with 0 samples and client-claimed `pass` evaluates to `analysis_ready: true`.
   - *Required Fix*: Server must require `row.sample_count > 0` and `validSamples > 0` to qualify for analysis readiness.

---

## 4. Test Execution Instructions

Execute the acceptance suite inside Docker with native SQLite bindings without starting or restarting the running services:

```bash
docker run --rm \
  -v "${PWD}/apps/server:/app/apps/server" \
  -v "${PWD}/packages:/app/packages" \
  -w /app/apps/server \
  periwinkle-app:latest \
  npx vitest run test/gaze-acceptance.test.ts
```

*Results Summary*: 23 passed, 3 failed (flagging the three server quality-gate vulnerabilities reported above).

## Coordinator verification, 2026-10-24 06:56 PKT

The 23/26 result and three defects above describe the historical first acceptance run. After implementation fixes, an independent coordinator Docker run on current mounted source passed all 37 server tests (the 26 acceptance cases plus 11 biometric tests). The server now uses the fixed 1.5 degree threshold, derives missingness from stored raw samples, and excludes empty/invalid records from analysis readiness. Command: docker run --rm with apps/ and packages/ mounted into periwinkle-test:local, no participant data mount, running npm test at /app. Full command/output is recorded in the coordinator temporary verification log; the web tests require NODE_ENV=test because the runtime image defaults to production. Physical participant accuracy remains unverified.

## Gaze-gate repair — 2026-11-12

Defects and repairs:

- `apps/web/src/screens/GazeCalibration.tsx:200`: rings previously inherited
  the participant stage's CSS transform despite using viewport CSS coordinates.
  The displayed fixation point therefore differed from the training label on
  scaled laptop viewports. Targets now render through a portal to `document.body`.
- `apps/web/src/gaze/GazeController.ts:324`: training previously started immediately
  after a target moved. Training now observes the same 250 ms settling interval
  used by validation, with an interruption check before recording features.
- `apps/web/src/screens/GazeCalibration.tsx:55,229` and `GazeFailure.tsx:3`:
  effect replay could leave calibration permanently cancelled, and validation
  failure had no recalibration action. Effect setup resets cancellation; failed
  validation now shows GazeFailure with recalibration and behavioural continuation.
- `apps/web/src/ExperimentRunner.tsx:198`: tracker error status was ignored.
  Calibration errors now tear down acquisition and show camera retry; runtime
  errors mark gaze unavailable with a participant-facing message. Camera restart
  invalidates the previous passing calibration (`GazeController.ts:194,620`).
- `apps/web/src/ExperimentRunner.tsx:535` and `gaze/gazeClient.ts:140`: reloading
  debrief lost the only finalization handle. The runner now awaits
  `resumeGazeFinalization(sessionId)` when no controller remains. Its same-tab
  sessionStorage journal retains the finalization payload, pending samples and
  original batch ID across reload/retry; acknowledged completion keeps only a
  receipt. Withdrawal clears recovery state, including when an upload resolves
  late. Missing recovery or failed uploads keep the expected-gaze session at
  debrief; unavailable/declined gaze sessions can complete normally.

The 1.5° gate was not relaxed. The shortened TeX plan's session-ending wording
conflicts with the current optional-gaze pilot policy in biometrics.md; the
coordinator has asked for protocol clarification. No finite recalibration attempt
limit appears in the inspected protocol documents, so none was invented.

Verification (host Node, installed lockfile dependencies):

- `npm run test -w @meridian/web`: 20 files, 145 tests passed.
- `npx tsc -p apps/web/tsconfig.json --noEmit`: passed.
- `npx vitest run --config tests/gaze-flow/vitest.config.ts`: 11 passed; only
  Fastify's existing deprecated logging-option warnings.
- Relevant regressions were observed failing before their fixes: target portal,
  training settling, camera-restart calibration invalidation, reload finalization,
  runner recovery/error wiring, and late-acknowledgement withdrawal cleanup.

Safari frame readiness and frame-counter handling belong to the separate
WebGazer adapter owner; the zero-frame counter concern was relayed there. A real
Safari/macOS webcam session and deployed Vercel participant run were not performed,
so this is regression/control-flow evidence rather than measured gaze accuracy.
Docker was unavailable on this host. No further source changes outside the owned
files are requested; protocol wording still requires the coordinator's decision.
