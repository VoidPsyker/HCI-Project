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
`.env`; see `.env.example`). The browser stays signed in for 3 days; it stores a signed token,
never the password, and changing `ADMIN_PASSWORD` signs every researcher out. Use Chrome or Edge in full screen on a 1920 × 1080 display at
100 % zoom. The admin row shows a warning if a session reports any other viewport or device
pixel ratio; that warning is never shown to the participant.

## 2. Before each participant

1. In **New participant**, enter a pseudonymous label (e.g. `P03`) and press **Create session
   link**. Never enter a name or email.
2. Open the link on the participant machine. The server assigns the sequence (block order,
   menu order, task rotation, colour mapping) from a fixed schedule in arrival order after demographics and writes it to
   `assignments_audit`; the participant's browser never chooses a condition.
3. Ask the participant to keep the browser window the same size from calibration onwards;
   screen geometry is estimated automatically when the camera starts.

## 3. During the session

The participant works through: consent → eye-tracking consent →
demographics → baseline check-in → instructions (think aloud) → six practice trials → calibration → four
blocks (scenario → check-in → six searches, one per menu → check-in with fatigue → 15-s neutral reset) →
questionnaires → debrief. Eye-tracking calibration runs before the first induction;
gaze is recorded whatever the calibration error, and the session manifest stores that error
for choosing a cutoff at analysis. Participants can continue the full study without gaze if
the camera fails or they decline. The event export records the reason as a gaze_unavailable event.

On the admin dashboard, the session row shows the phase, latest menu and trial, and flags:

- **stuck Ns**: the current trial has reached the short-pilot help threshold. Keep any assistance neutral.
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

- **Exports** in the admin console provides events, trials, mood check-ins, demographics,
  questionnaires, and assignment files. Downloads carry SHA-256 checksums.
- In the events export, use `pointer_move` and `pointer_click` for cursor position in
  browser viewport pixels. Movement is sampled at most ten times per second during active
  searches, including practice. The trial-start event records viewport width and height.
  Mouse and trackpad motion both arrive as mouse-pointer input in the browser. Keyboard
  activations do not have cursor coordinates.
- The demographics export includes the saved age band, gender category, education,
  shopping frequency, watch expertise, technical confidence, colour vision and prior menu
  experience. Free-text gender self-descriptions are omitted from this export.
  Join to trials by `session_id`.
- The questionnaire export contains `SUS` for usability ratings for the final menu. The
  `PREFERENCE` row records a menu ID (A–F) or `none` in `text_value`. These rows appear
  after the participant submits the final questionnaire.
- Select the session in the admin console for its eye-tracking downloads. Gaze starts
  after calibration and is collected during scored trials. The CSV includes samples already
  saved for incomplete runs and marks them as unfinalized. Use the session and trial IDs
  to join gaze samples and area-of-interest metrics to trial results. Keep gaze exports
  with the restricted study data.
- `npm run export` writes the general exports to a timestamped folder with row counts
  and checksums. Gaze files are downloaded separately per session.
- `npm run audit:balance` prints the chi-square randomisation balance report.
- Pilot analysis scripts and their limits: `packages/analysis/docs/pilot-analysis.md`.
  Pilot data are excluded from confirmatory analysis.

See [short pilot protocol](short-pilot.md) for the 15-minute timing estimate and revised
pilot acceptance checks. The dashboard reports the average from completed short pilot sessions
with regular timing, from consent to the end of debrief.

## 7. Go/no-go

The **Pilot go/no-go** panel computes plan §7.1 from the collected data. Criteria marked
"verified by Playwright suite" come from `npm run test:e2e`, not from session data.

## Dashboard recovery and stop records

Use the participant label button to open details with a keyboard, or click its row.
Details follow the latest session list, show the saved stop reason and researcher notes,
and close when the session is deleted or withdrawn. **Abort & debrief** is available only
before a session ends; it retains study data. **Delete** permanently removes the session
and its data after confirmation. A failed stop keeps the reason open for retry.

Refresh and background polling failures appear in the dashboard error banner. An expired or
rejected sign-in returns to sign-in and clears the dashboard; signing out also clears its
participant links, selection and draft notes. If clipboard access fails, copy the displayed
participant link manually.

### Event clocks across reloads

Click-event `t_client` is `performance.timeOrigin + performance.now()` in
milliseconds, so a reload does not restart its ordering clock. Trial
`elapsed_ms` and gaze capture times retain their existing trial/page-relative
clocks. Event and check-in exports use server receive time with insertion order
as a tie-breaker; do not treat raw page-relative gaze times as epoch timestamps.
