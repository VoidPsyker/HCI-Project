# Researcher guide: running a pilot session

> Pilot build. Ethics approval is required before real participants. The consent text and
> induction media are placeholders until the approved versions are supplied.

## 1. Start the instrument

Docker (recommended on the lab machine):

```text
docker compose up -d --build
```

Without Docker (Node 20+):

```text
npm install
npm run build
npm start
```

Open `http://127.0.0.1:8787/admin` and sign in with `ADMIN_PASSWORD` (set it in a git-ignored
`.env`; see `.env.example`). Use Chrome or Edge in full screen on a 1920 × 1080 display at
100 % zoom. The admin row shows a warning if a session reports any other viewport or device
pixel ratio; that warning is never shown to the participant.

## 2. Before each participant

1. In **New participant**, enter a pseudonymous label (e.g. `P03`) and press **Create session
   link**. Never enter a name or email.
2. Open the link on the participant machine. The server assigns the sequence (block order,
   menu order, target set, colour mapping) after demographics and writes it to
   `assignments_audit`; the participant's browser never chooses a condition.
3. Have a measuring tape ready: the eye-tracking setup asks for the visible screen width and
   height in millimetres and the eye-to-screen distance.

## 3. During the session

The participant works through: consent → eye-tracking consent and screen measurement →
demographics → baseline check-in → instructions (think aloud) → six practice trials → four
blocks (scenario → check-in → three trials → check-in with fatigue → 60-s neutral reset) →
questionnaires → debrief. Eye-tracking calibration runs before the first scored trial;
failing the 1.5° gate ends the session before any scored trial.

On the admin dashboard, the session row shows the phase, latest menu and trial, and flags:

- **stuck Ns**: the current trial has run for 60 s or more. Offer help only from this point.
- **distress N/10**: a check-in reported distress above 6. The session has already stopped
  and gone to the debrief; stay with the participant (plan §15.3).
- **viewport warning**: the browser is not at 1920 × 1080 at 1×.

Click a row to add observation notes (confusion during practice, think-aloud remarks) or use
**Abort & debrief**. The participant can also stop at any time with the visible Stop control.

## 4. After the session

The debrief offers withdrawal, which deletes the session, its events and its gaze files.
A researcher can also delete a session from the admin console on request.

## 5. Swap in the validated video clips

1. Copy the approved files into `apps/web/public/media/` (e.g. `happy-clip.mp4`,
   `neutral-reset.mp4`). Use local files only; the instrument blocks no requests itself, but the
   acceptance tests require that none leave the machine.
2. Edit `apps/web/content/media.json` and set `"src": "/media/happy-clip.mp4"` (and the
   neutral-reset entry). With `src: null` the bundled placeholder image is shown.
3. Rebuild (`npm run build`, or `docker compose up -d --build`).

All other participant wording (consent, scripts, items, debrief) is in `apps/web/content/`.

## 6. Export and analyse

- Admin console **Exports**: download any file; each response carries its SHA-256 checksum.
- Command line: `npm run export` writes a timestamped folder under `exports/` with
  `events`, `trials`, `checkins` and `questionnaires` as both CSV and JSONL, plus
  `assignments.csv`, `tasks.csv` and a `manifest.json` of row counts and checksums.
- `npm run audit:balance` prints the chi-square randomisation balance report.
- Pilot analysis scripts and their limits: `packages/analysis/docs/pilot-analysis.md`.
  Pilot data are excluded from confirmatory analysis.

## 7. Go/no-go

The **Pilot go/no-go** panel computes plan §7.1 from the collected data. Criteria marked
"verified by Playwright suite" come from `npm run test:e2e`, not from session data.
