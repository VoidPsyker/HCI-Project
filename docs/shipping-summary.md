# Experiment instrument handover — 24 October 2026

Completed:

- Six-menu parity: unavailable Search logging, visible options, browser Back,
  root breadcrumbs, Menu F icons, accessible targets and stable gaze AOIs.
- Mandatory gaze flow: separate consent, measured screen geometry, nine-point
  training and held-out validation, 1.5-degree gate, interruption handling,
  startup retry, and fail-closed reload/completion behavior.
- Local WebGazer assets and decoded-frame deduplication; loopback hardware
  bridge transport. The bridge has not been validated with physical hardware.
- Separate gaze ingestion/storage, token authorization, idempotent batches,
  withdrawal purge, restricted exports, synthetic provenance and quality gates.
- Fixation/AOI/clock analysis, Python pilot reports and R variance scripts;
  R/lme4 Docker environment. Synthetic sessions are excluded by default and
  singular fits produce no invented estimates.
- Docker app quickstart, unit and browser suites, 24/432-path acceptance
  coverage, production consent/reload checks and diagnostic evidence.

Latest verification: 200/200 root unit tests and production build pass; actual
bundled WebGazer runtime startup/offline/teardown passes using fake no-face
video. Controller/HTTP/SQLite pipeline: 11/11. Production flow: 5/5.
Python report checks: 5/5; R/lme4 model self-checks pass. The earlier 432-path
and 82-check menu runs are historical, not a fresh all-pass release verdict.

The 50 fps gate remains failed. Paired diagnosis measured 47.99 fps with warmed
inference versus 59.95 with inference paused. Frame deduplication is not a proven
FPS fix; subsequent source-change runs failed and the final precedence tweak
has unit/runtime coverage without a fresh performance-gate run.

Participant use remains blocked by frame performance, human gaze accuracy and
device validation, approved consent wording, and validated induction assets.
WebGazer's GPL license and maintenance status require consideration before
redistribution beyond this research repository. No real participant camera or
original participant database was used during verification.

The current rehearsal preview is http://127.0.0.1:8790 with its own Docker
volume. Original port 8787 and host data remain untouched. The overnight
reminder was stopped on handover; settled worker resources were released where
owned. Orca retained the final worker terminal because it was user-taken-over.

See [acceptance evidence](../tests/ACCEPTANCE-REPORT.md),
[performance limits](biometric-menu-performance.md), and
[night record](night-iteration.md) for detailed evidence and historical failures.
