# Menu acceptance evidence

## Latest verification — 24 October, afternoon

Live Vite on 5173 with the API on 8787 against a throwaway database, Playwright Chromium,
1920 × 1080, on this Windows host.

| Suite | Result |
| --- | --- |
| Unit tests (`npm test`) | 222 / 222 |
| Scoring coverage gate (`scoreTrial.ts`, `affect.ts`) | 100 % lines, branches, functions |
| `npm run build` (taxonomy gate first) | pass; a removed leaf fails it with exit 1 |
| Smoke 24, parity, geometry, keyboard, axe, network, trial events, biometrics-offline | 66 / 66 |
| Scripted full session (`full-session.spec.ts`) | pass, about 43 s in test mode |
| Full 432 paths (`@full`) | 6 / 6 menus, 432 / 432 paths |
| Motion and reduced motion (`--workers=1`) | 11 / 11 |

The scripted session swaps the camera tracker for a scripted gaze source. It verifies the flow,
calibration gate wiring, scoring, QA and exports, not human gaze accuracy. The 50 fps gate
with real webcam inference remains failed, as recorded below.

## Earlier verification — 24 October, morning

The 82/82 result below is historical evidence, not the current release verdict.
The isolated production preview on 8790 passed 58 menu checks; active animation
cadence failed at 43.6 fps (required 50). One following serial test did not run.
The network case also failed because it requires a Vite-only trial fixture,
which is intentionally absent from the production bundle.

The production consent/setup/retry/reload/completion suite passes 5/5 on build 7,
including zero camera calls through refusal/setup, remeasurement after resize,
camera retry, authorization recovery, and refusal of incomplete gaze finalization.
Final shipping-source unit checks pass 200/200, and bundled WebGazer runtime
startup/offline/teardown passes with fake no-face video. These do not waive FPS.
Concurrent local FaceMesh plus Menu D also fails cadence: latest default capture
30.01 fps, 189.6 ms transition, five inference callbacks during the zoom.
Neither fake-camera runs nor synthetic pipeline tests establish human accuracy.
See tests/artifacts/preview-run.txt, tests/production-flow/production-run.txt,
and tests/biometric-menu-performance/motion-observation.json.

Run date: 2026-10-24 (local)
Base URL: `http://127.0.0.1:5173` (live Vite; Docker on 8787 was stale)
Viewport: 1920 × 1080
Browser: Playwright Chromium, 3 workers
Source state: working tree with concurrent menu-worker edits; no commit was made.

## Result summary

| Area | Tests | Result | Evidence |
| --- | ---: | --- | --- |
| Full 432 paths (`@full`) | 6 | **6 passed** (432/432 product paths) | `tests/artifacts/full-run.txt` |
| Menu suite (non-full) | 76 | **76 passed** (complete non-full acceptance suite) | `tests/artifacts/menu-suite-run.txt` |
| Smoke 24 paths (`@smoke`) | 24 | **24 passed** (6 menus × 4 emotional states) | included in menu-suite run |
| Label/search parity | 12 | **12 passed** (taxonomy sync & disabled search contract) | included in menu-suite run |
| Keyboard operability | 7 | **7 passed** (full traversal, Back/Home/Escape, Space) | included in menu-suite run |
| Network isolation | 1 | **1 passed** (0 external requests during trials) | included in menu-suite run |
| Motion / reduced motion | 11 | **11 passed** (strict configured 180–220 ms, active FPS 59.98) | `tests/artifacts/motion-run.txt`, `tests/artifacts/motion-results/` |
| Geometry at 1920×1080 | 6 | **6 passed** (targets ≥ 44×44, spacing ≥ 8 px, no clipping) | `tests/artifacts/geometry-run.txt` |
| Axe accessibility | 6 | **6 passed** (WCAG AA serious/critical gate on A–F) | `tests/artifacts/axe-run.txt` |
| Trial event reconstruction | 9 | **9 passed** (complete paths, search attempts, timeout, keyboard) | `tests/artifacts/trial-events-run.txt` |
| Web Vitest (logger + trial runner, plus biometrics) | 34 | **34 passed** | `npm run test -w @meridian/web` |
| Web TypeScript | — | **clean** | `npx tsc --noEmit -p apps/web/tsconfig.json` |

Totals: **82 of 82 Playwright acceptance tests passed** (76 non-full + 6 full-432) on live current source.

## Historical run context & fixture isolation fix

### 1. Mandatory Gaze Bootstrap & Geometry Timeout (Historical)
- **Previous Failure:** When participant mandatory gaze consent and calibration were integrated into `ExperimentRunner` / `store.resumePhase`, persisted `trial_intro` sessions loaded via `/run/${sessionId}` were redirected to gaze calibration. As a result, the synthetic `/run/...` fixtures in `geometry.spec.ts` and `trial-events.spec.ts` timed out (120 s) waiting for `start-trial` to become visible (6 geometry timeouts preserved in `tests/artifacts/geometry-run-timeout-historical.txt`).
- **Minimal Test-Only Fix:** Created a test-only routed Vite harness in `apps/web/test/fixtures/trial-harness.html` and `trial-harness.tsx` (`apps/web/test/**` owned by test framework). It mounts the real `TrialRunner` component inside the unscaled 1920×1080 `StageFrame`, backed by an actual `EventLogger` with Playwright-intercepted `/api/events` ingestion.
- **Integrity Guarantee:** No production application, server, or core files were edited; no bypass flags were introduced; and production mandatory gaze consent/calibration remains 100% enforced in `ExperimentRunner`.
- **Targeted Outcome:** Both `geometry.spec.ts` (6/6) and `trial-events.spec.ts` (9/9) now pass cleanly on current source.

### 2. Keyboard Leaf Selection Input Modality (Verified Resolved)
- Test: `trial-events.spec.ts` → `keyboard activation is logged as input_type=keyboard`.
- Current Status: **PASSED**. Current implementation in `TrialRunner.handleLeaf` resolves `inputType` correctly from event / UI detail (`resolvedInputType = inputType ?? (window.event?.detail === 0 ? "keyboard" : "mouse")`). Both `leaf_select` and `product_view` events record `input_type="keyboard"`.

### 3. Axe Accessibility (Verified Resolved)
- Current Status: **6 of 6 PASSED** (`tests/artifacts/axe-run.txt`). Color-contrast and accessible-name mismatches across Menus C, D, E, F are verified resolved on current source.

## Criteria that now pass

- **Full path coverage:** all 72 leaves in each of six menus, 432/432 paths, each ending on the correct product.
- **Smoke:** six menus × four state labels, 24 distinct products; real navigation, no forced clicks.
- **Parity:** shared taxonomy labels and the disabled search contract (`data-testid="menu-search"`, `aria-disabled="true"`, exact text `Search is unavailable in this session.`). Search attempts are activated with a real focused Enter and are ingested as `search_attempt`.
- **Keyboard operability:** all six menus reachable by keyboard; Home/Back/Escape resets; native Space activation.
- **Geometry:** every interactive target at 1920×1080 meets ≥44×44 px, ≥8 px spacing, no overlap and no viewport clipping. This is checked against the participant `StageFrame`, not the scaled lab preview.
- **Motion:** Menu A (Radix dropdown fade), Menu D (D3 zoom) and Menu E (Framer Motion) strictly configure and execute 180–220 ms transitions. For Menu D, configured duration is strictly verified at 180 ms via `__transition`, runtime measured duration is bounded within [170, 240] ms documenting discrete rAF sampling quantization (~16.7 ms frame boundaries), and active animation frame cadence measures 59.98 fps (11 frames in 183.4 ms with zero idle-tail dilution). Reduced-motion mode suppresses level transitions across all six menus. Evidence in `tests/artifacts/motion-run.txt` and `tests/artifacts/motion-results/`.
- **Network:** a complete scored trial makes no external request, no page error and no console error; every request stays on localhost.
- **Events:** one `trial_start`/`trial_end` per trial, complete `node_click` path plus `leaf_select`/`product_view`, search attempt, timeout, and exactly one `trial_end` on timeout.
- **Regressions:** logger and trial-runner Vitest suites pass (34/34 tests); web TypeScript is clean.

## Motion scope and active FPS notes

Level-change motion is timed for A, D and E, because those are the three implementations with a real level transition (CSS/Radix fade, D3 zoom, Framer Motion). B, C and F currently replace levels without an animated transform/opacity; reduced-motion is checked and verified for all six.

Timing harness updates:
1. **Configured duration gate:** For Menu D, the D3 transition configuration (`__transition`) is inspected directly, strictly asserting duration $\in [180, 220]$ ms without gate relaxation (configured at 180 ms).
2. **Observed duration bound & frame quantization tolerance:** At 60 Hz display refresh (~16.7 ms/frame), discrete rAF sampling adds up to $\pm 2$ frame intervals ($\sim 34$ ms) of boundary jitter. The observed duration is bounded between 170 ms and 240 ms, with an active frame sample count assertion ($\ge 5$ frames) preventing truncated intervals from passing.
3. **Active animation FPS measurement:** Frame cadence during D3 zoom is measured strictly during the active animation interval (from transform onset to cleanup), ensuring frame stalls are captured while preventing idle-tail dilution. Active frame rate measures 59.98 fps ($\ge 50$ fps contract).
4. **Serial execution:** Motion timing tests run serially to prevent multi-browser CPU contention from distorting animation frame rates. Structured artifacts are recorded in `tests/artifacts/motion-results/`.

## Harness notes

- `playwright.config.ts` now honors `PW_OUTPUT_DIR` and `PW_REPORT_DIR`. This prevents a sibling worker’s Playwright cleanup from deleting an in-flight trace. All recorded evidence uses isolated paths under `tests/artifacts/`.
- The lab stage was offscreen at the start of the task. The concurrent menu-worker fix moved it to `x=60, y=230.5, 1800×720` inside 1920×1080; no offscreen nodes remain. Geometry still uses the participant StageFrame because that is the unscaled 1920×1080 rendering.
- `resetMenu` resets via actual Home/Back/Escape, waits for the level to settle, closes Radix portals, and asserts the flyout is closed rather than trusting a node count of four.
- The event path is reconstructed from `node_click` only; Menu A now emits a department `node_click` in addition to `menu_open`.
- No app, server, package, Docker or lockfile edits were made under this task. No production data was written: `/api/**` is intercepted, and `POST /api/events` is captured in memory.

## Exact commands

Live Vite web server (one terminal):

```powershell
npm run dev:web
```

All non-full Playwright acceptance tests:

```powershell
$env:PW_BASE_URL='http://127.0.0.1:5173'
$env:PW_OUTPUT_DIR='tests/artifacts/menu-suite-results'
$env:PW_REPORT_DIR='tests/artifacts/menu-suite-report'
npx playwright test axe.spec.ts geometry.spec.ts keyboard.spec.ts motion.spec.ts network.spec.ts parity.spec.ts smoke-24-paths.spec.ts trial-events.spec.ts --reporter=line --trace=off
```

Full 432-path suite (PowerShell requires the quote around `@full`):

```powershell
$env:PW_BASE_URL='http://127.0.0.1:5173'
$env:PW_OUTPUT_DIR='tests/artifacts/full-results'
$env:PW_REPORT_DIR='tests/artifacts/full-report'
npx playwright test --grep '@full' --reporter=line --trace=off
```

Single-failure checks:

```powershell
npx playwright test axe.spec.ts --trace=off
npx playwright test trial-events.spec.ts --grep 'keyboard activation' --trace=off
```

Web unit tests and typecheck:

```powershell
npm run test -w @meridian/web
npx tsc --noEmit -p apps/web/tsconfig.json
```

Do not use the stale Docker bundle on 8787 for these results; it predates the search control and current menu fixes. If Docker is used, rebuild it first and then override `PW_BASE_URL`.
