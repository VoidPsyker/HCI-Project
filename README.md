# HCI Project

# Emotion-Contingent Navigation instrument

Pilot instrument for the fictional watch store Meridian Timepieces: six experiment menus over
one 72-product taxonomy, four mild emotion inductions with check-ins, scored finding tasks,
mandatory eye tracking, server-side randomisation, a researcher console and versioned exports.
No checkout or accounts.

## Run it

Local (Node 20+):

```text
npm install && npm run dev
```

App: http://127.0.0.1:5173 · Menus: /lab · Researcher console: /admin. The API runs on 8787.
Set `ADMIN_PASSWORD` in a git-ignored `.env` (see `.env.example`); the local development
default is `pilot-admin`.

Docker (production build on one port):

```text
docker compose up -d --build
```

App: http://127.0.0.1:8787. SQLite and restricted gaze files persist under `data/`; exports go
to `exports/`.

| Command | What it does |
| --- | --- |
| `npm run build` | Validates the taxonomy (fails the build on any error), then builds all packages |
| `npm test` | Unit tests for taxonomy, scoring, analysis, server and web |
| `npm run test:coverage` | Scoring rules with a 100 % coverage gate |
| `npm run test:e2e` | Playwright suites (needs `npm run dev`; set `PW_BASE_URL=http://127.0.0.1:5173`) |
| `npm run test:e2e:full` | The 432-path suite only |
| `npm run seed` | Adds 8 labelled synthetic rehearsal sessions |
| `npm run export` | Writes CSV + JSONL exports with a checksum manifest to `exports/<timestamp>/` |
| `npm run audit:balance` | Chi-square balance report for the randomisation |

`full-session.spec.ts` drives a scripted participant through a whole session in test mode
(`?fast=1`). It replaces the camera tracker with a scripted gaze source, so it proves the flow
and data pipeline, not human gaze accuracy.

## Eye tracking

Eye tracking requires separate consent, measured screen dimensions and viewing distance, nine
training points followed by held-out validation, and the fixed 1.5° calibration gate. Refusal
or failed validation blocks scored trials. Raw video is not retained. Synthetic gaze is never
analysis-ready. Pilot analysis scripts exclude seeded/synthetic sessions by default. Resizing
after capture starts excludes the session. Camera startup can retry within the page; reloading
after gaze consent requires a new researcher link.

## Status

Not participant-ready. Open items:

- Ethics approval, approved consent wording and validated induction clips
  (`apps/web/content/`, see the researcher guide).
- Webcam plus menu frame rate has failed the 50 fps gate on this machine; human calibration
  accuracy and dedicated tracker hardware are unverified.

## Documentation

- [Researcher guide](docs/researcher-guide.md): running a session, swapping clips, exporting.
- [Assumptions and departures from the plan](ASSUMPTIONS.md).
- [Task difficulty rule](docs/difficulty.md).
- [Menu acceptance evidence](tests/ACCEPTANCE-REPORT.md).
- [Biometrics and quality gates](docs/biometrics.md) and the
  [WebGazer runtime check](docs/biometric-runtime-check.md).
- [Pilot analysis scripts](packages/analysis/docs/pilot-analysis.md); R/lme4 runs in the
  `periwinkle-analysis:local` Docker image.
- [Overnight run record](docs/night-iteration.md).
