# HCI Project

# Emotion-Contingent Navigation instrument

Six experiment menus over one 72-product watch taxonomy, with scored finding
tasks, mandatory eye tracking, self-report checks, event reconstruction and
restricted gaze exports. No checkout or accounts.

Run locally with Docker:

```text
docker compose up -d --build
```

App: http://127.0.0.1:8787 · Menus: /lab · Researcher console: /admin.
Set `ADMIN_PASSWORD` in a git-ignored `.env` (see `.env.example`). The local
development default is `pilot-admin`. SQLite and restricted gaze files persist
under `data/`; exported files use `exports/`. On this Windows host, use Docker
for native SQLite rather than the currently broken host installation.

The overnight rehearsal is separate: http://127.0.0.1:8790, container
`periwinkle-pilot-preview`, volume `periwinkle-pilot-preview-data`. It contains
synthetic rehearsal data and does not use the original host database.

Eye tracking requires separate consent, measured screen dimensions/viewing
distance, nine training points followed by held-out validation, and the fixed
1.5° calibration gate. Refusal or failed validation blocks scored trials.
Raw video is not retained. Synthetic gaze is never analysis-ready.
Pilot analysis scripts exclude seeded/synthetic sessions by default; explicit
rehearsal runs remain labeled as synthetic results.
Resizing after capture starts excludes the session. Camera startup can retry
within the page; reloading after gaze consent requires a new researcher link.

Current release blockers: webcam/menu concurrent frame rate fails the 50 fps
gate on this machine; human calibration accuracy and dedicated tracker hardware
are unverified. Consent wording and validated induction media still await the
research team's approved assets. Do not treat this as participant-ready.

Verification and researcher details:

- [Menu acceptance evidence](tests/ACCEPTANCE-REPORT.md) distinguishes historical runs.
- [Biometrics and quality gates](docs/biometrics.md).
- [Actual local WebGazer runtime check](docs/biometric-runtime-check.md).
- [Pilot analysis scripts](packages/analysis/docs/pilot-analysis.md).
- [Overnight run record and latest checks](docs/night-iteration.md).

```text
npm test
npm run test:e2e
python -m unittest discover -s packages/analysis/test-python
npx playwright test --config tests/production-flow/playwright.config.ts
```

`npm test` needs a working native SQLite build; use the Docker build environment
on this host with `NODE_ENV=test`. The general Playwright suite uses live Vite
for its trial fixtures; set `PW_BASE_URL=http://127.0.0.1:5173`. The production
consent check targets only the isolated rehearsal on port 8790. R/lme4 are
installed and checked in the separate `periwinkle-analysis:local` Docker image;
see the pilot-analysis guide for its commands and sparse-data limitations.
