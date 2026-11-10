# Short pilot: approximately 15 minutes of activities

This revision supersedes timing in the supplied planning PDFs for the executable pilot only.
It is a feasibility pilot, not the full 6 menus x 4 states mapping study. Twelve scored trials
sample three menus per state and each menu twice; they do not cover all 24 cells per person.

## Budget

| Activity | Maximum timed duration |
| --- | ---: |
| Six practice trials at 15 seconds | 90 seconds |
| Happy, frustrated, confused inductions at 45 seconds | 135 seconds |
| Bored induction | 60 seconds |
| Twelve scored trials at 20 seconds | 240 seconds |
| Four neutral resets at 15 seconds | 60 seconds |
| Total timed activities | 585 seconds (9:45) |
| Setup, calibration, reading, check-ins, questionnaires, transitions | 315 seconds (5:15) |

There is no automatic session cutoff. The 15-minute target describes the activity workload,
not a deadline that aborts the participant. Allow camera setup, calibration and consent
additional time. Participants can finish all tasks and questionnaires even if they take longer.
Individual search timeouts remain 15 seconds for practice and 20 seconds for scored trials;
these end only that search and let the participant proceed to the next activity.
Human rehearsal must establish the actual activity duration, especially the six full SUS
questionnaires. Do not hurry answers or claim a guaranteed duration before measuring it.

## Preserve the emotional study

Calibrate before the first induction so setup does not consume the induced mood. Keep baseline,
post-induction and post-block self-reports, continuous valence/arousal and fatigue ratings,
neutral resets, distress stops, counterbalancing, and neutral trial feedback. Use reported state
and manipulation-check results, not intended state, for labels. No emotion is inferred from faces.

The shorter inductions and resets are unvalidated protocol changes. The bored activity remains
longer because repetition is its mechanism; this is a design choice, not proof it induces boredom.
The happy media slot is currently empty: the sunrise placeholder cannot establish a successful
positive induction. Supply and rehearse an approved local clip before collecting real data.

Twenty-second deadlines can themselves induce frustration and alter success rates and menu
rankings. Compare only runs using this timing protocol; do not pool with the 120-second protocol.
Review practice success and timeouts before recruitment. If most people cannot finish, reduce
scope or split visits rather than inventing ratings, skipping calibration or labelling failures success.

## Feasibility checks

Rehearse with 6-8 people. Measure consent-to-debrief duration, completion of all four states,
per-state induction success, per-menu practice and scored success, total activity duration, and missing
records. Retain the existing intended-state success target of at least 60% for every state,
practice success of at least 80% for every menu and less than 5% missing expected records.
Also report incomplete-run rate and how many completed activity sequences exceed 15 minutes.
These are pilot decision criteria, not guaranteed outcomes or a power analysis.

## Storage and verification

Use the persistent Node/SQLite server or Docker deployment. The Vercel demo explicitly has no
persistent data and must not collect research sessions. Keep the data directory on a persistent
volume; back up the database and restricted gaze store together. Never retain webcam video.

After a rehearsal, export CSV/JSONL with the checksum manifest. Verify six practice results,
twelve main trials, four induction pairs, nine check-ins (baseline plus two per block), all
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

## Verification (10 November 2026)

The previous revision passed 238 automated tests across taxonomy, scoring, analysis, server and web. Web production build and server TypeScript build passed. The full scripted participant browser test passed, including 18 trial records and server-side completion checks. It uses accelerated timers and scripted gaze: it verifies flow and storage, not human completion time, calibration accuracy or emotional induction effectiveness.
