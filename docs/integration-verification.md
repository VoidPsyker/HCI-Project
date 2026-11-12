# Integration verification — November 12, 2026

All checks use synthetic data. No deployment, commits, stash, checkout, dependency,
or lockfile changes were made by this integration worker. Docker and Rscript are
unavailable and their checks were not run. A temporary harness starts Fastify with
an isolated temporary SQLite/raw/gaze directory and Vite with an API proxy; both
ports are allocated dynamically. Commands below use the resulting URLs, not an
existing developer server. Playwright runs have separate output directories.

## Root causes and fixes

- `apps/web/src/menus/MenuD.tsx:75`: the prior patch removed the experimental
  D3 zoom entirely, making configured duration null. Restored HEAD's 180 ms and
  scale 1.35; path changes commit synchronously, subsequent input interrupts the
  prior animation, and disable/unmount cancels transitions without a delayed
  callback overwriting navigation. Keyboard/rapid navigation and cleanup tests
  are preserved in `apps/web/test/menu-lifecycle.test.tsx` (9 tests).
- `apps/web/src/menus/MenuE.tsx:9`: the prior patch removed AnimatePresence and
  hence exit animation. Restored the original presence/transition timing;
  outgoing choices become disabled, hidden to assistive technology, and lose
  their active node identity while their visual exit finishes. Menus A/B/C/F
  have no transition/timing diff from HEAD.
- `tests/e2e/motion.spec.ts:117`: timing began at the first visibly transformed
  frame, undercounting a genuine 180 ms transition as 166.7 ms. Use D3's
  scheduled start, as the biometric harness already does; thresholds stay fixed.
- `tests/e2e/full-session.spec.ts:95`: parallel sessions used the same label,
  producing strict locator ambiguity in the researcher console. Labels now
  distinguish valid/failed calibration; line 137 uses the current failure
  screen's continue control instead of the removed calibration-skip control.
- `tests/e2e/trial-events.spec.ts:7`: the allowed vocabulary omitted the new
  pointer_move/pointer_click and gaze_unavailable events. The assertion now uses the shared EVENT_TYPES constant so it cannot drift;
  real pointer logging remains enabled.
- `tests/production-flow/consent.spec.ts:33`: refusal now deliberately continues
  the core study without camera access, rather than aborting. The debrief test
  at line 103 now expects recovery of the saved camera-denied completion outcome
  without reopening the camera, rather than asserting the old missing-controller
  failure. `playwright.config.ts:6` accepts PW_BASE_URL for allocated ports.
- Initial parallel Playwright invocations shared test-results and deleted each
  other's trace files (four ENOENT failures, including axe F and full paths A/B/C).
  Subsequent invocations use independent output/report directories; focused axe
  F passed 1/1 without product changes.
- `tests/biometric-menu-performance/biometric-menu-performance.spec.ts:48`:
  removed the hard-coded port and arbitrary-server reuse. The harness now owns
  and stops its allocated Vite instance. The isolated actual WebGazer check
  passed 1/1: 180 ms configured, 208.7 ms observed, 59.98 fps, 11 active frame
  intervals, four concurrent gaze callbacks. Earlier October measurements were
  on different hardware; this run uses Apple M3/ANGLE Metal with a 60.01 fps
  pre-inference baseline. No cadence or timing gate was relaxed. This is fake
  camera runtime evidence, not calibrated human accuracy.

## Reload ordering proof

`apps/server/test/persistence.test.ts:132` reproduces a client clock reset
(90000 then 20). General events already use `t_server, rowid`, so those exports
retain receive order. Check-ins instead used `session_id, t_client` and reversed
both events; the new assertion failed before the fix. The query at
`apps/server/src/repository.ts:884` now uses server time and rowid, and both
check-in and general JSONL exports are asserted in receive order (11/11 focused
persistence tests pass).

`apps/web/test/logger.test.ts:117` independently reproduces the page-clock reset
and failed with 40 not greater than 90000. `apps/web/src/logger.ts:150` now emits
`performance.timeOrigin + performance.now()` for t_client so consumers that
sort client times also retain cross-reload chronology. Trial elapsed_ms stays
page-relative and is asserted as 20 ms after the simulated reload (19/19 logger
tests pass). No migration/shim is added to this pre-production study.

## Final commands and outcomes

Final results are recorded below after the stable-source rerun.

## Resume checkpoint (12:57 PKT)

Completed latest gates:

| Step | Command | Result / evidence |
| --- | --- | --- |
| 1 | `npm run build` | PASS, taxonomy validation + analysis/web/server tsc + Vite; `/tmp/integration-stable-build.log` |
| 2 | `npm test` (plain, no NODE_OPTIONS) | PASS 359: taxonomy 12, scoring 31, analysis 64, server 105, web 147; `/tmp/integration-stable-test.log` |
| 3 | `npm run test:deploy` | PASS 3/3; `/tmp/integration-stable-deploy.log` |
| 4 prep | `npx playwright install chromium` | PASS, browser available; `/tmp/integration-browser.log` |
| 4 deployment | `PW_BASE_URL=http://127.0.0.1:64056 PW_OUTPUT_DIR=/tmp/integration-final-assets-results PW_REPORT_DIR=/tmp/integration-final-assets-report npm run test:e2e -- --grep @deployment` | PASS 3/3; old isolated server since stopped; `/tmp/integration-final-assets.log` |
| 5 production | `PW_BASE_URL=http://127.0.0.1:64056 npx playwright test --config tests/production-flow/playwright.config.ts --output /tmp/integration-production-results` | PASS 5/5; `/tmp/integration-production2.log` |
| 5 gaze | `npx vitest run --config tests/gaze-flow/vitest.config.ts` | PASS 11/11; `/tmp/integration-stable-gaze.log` |
| 6 performance | `node tests/biometric-menu-performance/run-check.mjs` | PASS 1/1, 59.98 fps, 180 ms configured/208.7 observed, four concurrent callbacks; `/tmp/integration-performance.log` and committed-path performance-run.txt |
| 7 reload proof | `npm run test -w @meridian/server -- --run test/persistence.test.ts` | Reproduced failure then PASS 11/11; `/tmp/integration-order-before.log`, `/tmp/integration-order-after.log` |
| 7 logger | `npm run test -w @meridian/web -- --run test/logger.test.ts` | Reproduced failure then PASS 19/19; `/tmp/integration-clock-before.log`, `/tmp/integration-clock-after.log` |
| focused flow/motion/events | `PW_BASE_URL=http://127.0.0.1:64057 PW_OUTPUT_DIR=/tmp/integration-focused-results PW_REPORT_DIR=/tmp/integration-focused-report npm run test:e2e -- tests/e2e/motion.spec.ts tests/e2e/trial-events.spec.ts tests/e2e/full-session.spec.ts` | PASS 22/22 before the later timing-recorder fix; `/tmp/integration-focused.log` |
| lifecycle | `npm run test -w @meridian/web -- --run test/menu-lifecycle.test.tsx` | PASS 9/9 including D transition disable/unmount cleanup; `/tmp/integration-menu2.log` |

Current in-progress command (exec session 35077):
`PW_BASE_URL=http://127.0.0.1:53056 PW_OUTPUT_DIR=/tmp/integration-stable-e2e-results PW_REPORT_DIR=/tmp/integration-stable-e2e-report npm run test:e2e -- --grep-invert @deployment`.
Log `/tmp/integration-stable-e2e.log`. It has one known harness error: while fixing
scheduled-start timing I accidentally replaced `state.first = now` in the separate
FPS recorder too, where `transitions` is undefined. That accidental replacement
is already corrected. The focused cadence rerun passes 1/1:
`PW_BASE_URL=http://127.0.0.1:53056 PW_OUTPUT_DIR=/tmp/integration-cadence-results PW_REPORT_DIR=/tmp/integration-cadence-report npm run test:e2e -- tests/e2e/motion.spec.ts --grep 'frame cadence'`
(`/tmp/integration-cadence.log`). D timing itself now passes in the broad run.

Live owned harness: `.integration-server.ts`, exec session 43177, node PID 57072,
Fastify `http://127.0.0.1:53055`, Vite `http://127.0.0.1:53056`. It owns temporary
SQLite/raw/gaze directories and removes them on SIGINT/SIGTERM. Never kill other
servers. Previous harnesses were stopped. `.integration-server.ts` MUST be
removed before finishing. Its source is deliberately temporary, not a new feature.

Exact remaining steps:

1. Finish/read current e2e run; expected only the already-fixed recorder error.
2. Final `npm run build`, `npm test`, then final broad e2e command above using a
   new output/report directory, with no concurrent build/test CPU load and no
   source edits while running. Use fresh logs; update this checkpoint per step.
3. Run `PW_BASE_URL=http://127.0.0.1:53056 PW_OUTPUT_DIR=/tmp/integration-full-results PW_REPORT_DIR=/tmp/integration-full-report npm run test:e2e:full` (six tests, 432 paths), not yet run separately.
4. Re-run deployment assets against 53055 (grep @deployment with distinct output),
   and production-flow against 53055 with its config. Both passed before restart;
   current server includes the ordering fix.
5. Read all final counts, fix/re-run genuine failures, update final results here.
   Rscript/Docker are unavailable; no deployment or dependency/lockfile changes.
6. Stop exec session 43177 / signal PID 57072, verify owned server stopped, remove
   `.integration-server.ts`, run `git diff --check`, and send exactly one worker_done
   with --report-path docs/integration-verification.md. Any final failure means
   outcome failed. Task/Dispatch IDs remain task_3dd40269d2ce / ctx_514591da5bd8.

Checkpoint update: the broad run settled at 83 passed, 1 failed, 1 not run;
the sole failure was the corrected undefined-variable FPS recorder described
above. Final build/unit reruns are in progress in `/tmp/integration-last-build.log`
and `/tmp/integration-last-test.log` (exec sessions 70545/52848).
Checkpoint update: final build PASS and final plain npm test PASS 359/359,
exit 0 for both. Starting last broad e2e with all corrected test source,
no concurrent build/unit run and no more source edits.

Latest final gate commands (source frozen):

- `npm run build`: PASS (exit 0), `/tmp/integration-last-build.log`.
- `npm test`: PASS (exit 0), 359/359 across all five workspaces,
  `/tmp/integration-last-test.log`; no NODE_OPTIONS supplied.
- `PW_BASE_URL=http://127.0.0.1:53056 PW_OUTPUT_DIR=/tmp/integration-last-e2e-results PW_REPORT_DIR=/tmp/integration-last-e2e-report npm run test:e2e -- --grep-invert @deployment`:
  currently running (exec session 31422), `/tmp/integration-last-e2e.log`.
Checkpoint update: last broad e2e PASS 85/85 (3.2 min), exit 0, including D
scheduled-start timing, >=50 fps cadence, both full pilot sessions, and 432 paths.
No failures/skips remain in that run. Starting the separately requested full script.
Current remainder: explicit `test:e2e:full` running (session 81641,
`/tmp/integration-full.log`); deployment assets against 53055 running (50509,
`/tmp/integration-last-assets.log`); production-flow against 53055 running
(62403, `/tmp/integration-last-production.log`). All use distinct output dirs.
After these settle, record counts, stop owned harness 43177/PID 57072, remove
`.integration-server.ts`, verify diff hygiene, and send worker_done.
Checkpoint update: production-flow on the current built server PASS 5/5
(`/tmp/integration-last-production.log`, exit 0).
