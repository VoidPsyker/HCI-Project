# Session timing: approximately 20 minutes of activities

This revision supersedes timing in the supplied planning PDFs for the executable pilot only.
Each participant searches all six menus in every state: 24 scored searches covering all
24 menu × state cells.

## Timing estimate

| Activity | Planning allowance |
| --- | ---: |
| Consent, setup, calibration and debrief | 2:00 |
| Six practice searches, averaging 10 seconds | 1:00 |
| Four mood activities | 3:15 |
| 24 scored searches, averaging 25 seconds | 10:00 |
| Four neutral resets | 1:00 |
| Check-ins, instructions and transitions | 1:30 |
| End questionnaires | 1:15 |
| Total | 20:00 |

The estimates assume the participant
finishes most searches well before the individual limit. The longer plan expects a typical
scored search of 25–45 seconds. At 35 seconds per scored search, this estimate becomes 24 minutes.
Measure the full session in a rehearsal and allow people enough time to read consent, calibrate,
and answer. A 45-second practice or 60-second scored timeout ends that search only. The app
records it separately from voluntary give-up and successful completion.

Each participant answers all ten SUS items for the final trial menu. The assigned menu order
rotates which menu is last. This reduces repeated SUS items from 60 to 10 while preserving
the scale and its menu ID. SUS is now a between-participant comparison, with fewer ratings
per layout. Keep NASA-TLX, credibility ratings and optional comments. The primary menu
comparison still uses search performance in each emotional context.

## Preserve the emotional study

Calibrate before the first induction so setup does not consume the induced mood. If gaze is declined,
unavailable or fails validation, the participant can still finish the behavioural study. The
original short experimental plan ended such runs. This pilot follows the longer plan’s
optional eye-tracking extension. Gaze is recorded whatever the calibration error; the cutoff
is chosen at analysis (10° marks sessions analysis-ready for now). Keep baseline,
post-induction and post-block self-reports, continuous valence/arousal and fatigue ratings,
neutral resets, distress stops, counterbalancing, and neutral trial feedback. Use reported state
and manipulation-check results, not intended state, for labels. No emotion is inferred from faces.

The shorter inductions and resets are unvalidated protocol changes. The bored activity remains
longer because repetition is its mechanism; this is a design choice, not proof it induces boredom.
The pilot uses a playful puppy clip for positive affect and running water for neutral resets.
Verify the new clips with the existing mood checks before pooling results with earlier runs.

The scored timeout changed from 20 seconds in the first short pilot and 120 seconds in
the longer plan. Report timeout rates by menu, state and difficulty. Compare runs with
the same protocol version, which is recorded in session-start and trial-start events.

## Feasibility checks

Rehearse with 6-8 people. Measure consent-to-debrief duration, completion of all four states,
per-state induction success, per-menu practice and scored success, total activity duration, and missing
records. Retain the existing intended-state success target of at least 60% for every state,
practice success of at least 80% for every menu and less than 5% missing expected records.
Also report incomplete-run rate and how many completed activity sequences exceed 20 minutes.
These are pilot decision criteria, not guaranteed outcomes or a power analysis.

## Storage and verification

Use the persistent Node/SQLite server or Docker deployment. The Vercel demo explicitly has no
persistent data and must not collect research sessions. Keep the data directory on a persistent
volume; back up the database and restricted gaze store together. Never retain webcam video.

After a rehearsal, export CSV/JSONL with the checksum manifest. Verify six practice results,
24 main trials, four induction pairs, nine check-ins (baseline plus two per block), one complete 10-item SUS and the other
questionnaire answers, assignment metadata and gaze quality records for a completed run.
For a participant-stopped run, verify its stop reason and only the records actually collected; do not fill
missing observations. Reopen the server and export again to check persistence across restart.
Exercise offline/reconnect and archive-write failure tests before using real participants.
Browser event queues are recovery buffers, not a substitute for server acknowledgement.

## Reading the supplied PDFs

- The refined protocol centres brief self-reports, mild inductions and empirical menu comparisons;
it explicitly allows simplifying the factorial design after piloting.
- The longer navigation plan and two-page experimental plan describe the earlier timing and
larger studies. Their timing and acceptance thresholds are historical for this short pilot.
- The fractal-menu paper motivates menu geometry; it does not validate these emotional inductions.
- The eye-tracking paper discusses controlled product-finding and fatigue; it does not prove a
15-minute emotional experiment works.
- The human-feedback/RL paper concerns personalised interface adaptation. Training or evaluating
an RL policy inside each participant's 15-minute pilot is outside this pilot's scope.

The Shopify PDF was excluded. Original PDFs remain unchanged as reference documents.

Gaze upload recovery: unsent gaze samples remain in memory. A failed stop now reports the upload error and allows retry before closing the debrief. Reloading or closing while offline can still lose these unsent samples. Keep the page open until saving succeeds; persistent gaze recovery across browser crashes is not implemented.

## Verification

The scripted browser session completed all 18 searches and exported ten SUS answers for
the final menu. It uses accelerated scenario timers and scripted gaze. Measure actual
duration, mood induction and calibration with people before drawing conclusions.
