# Assumptions and recorded disagreements

Source of truth: *Emotion-Contingent Navigation — Experimental Plan v1.0* (`docs/`). Where the
build prompt and the plan disagree, the plan wins; each case is listed here.

## Deliberate departures (decided by the project owner)

- **Webcam eye tracking is kept and required for scored trials.** The build prompt says "no
  webcam or biometrics", and plan §3.3 calls eye tracking an *optional* extension with a
  screen-based tracker (§11.4). This build uses WebGazer with separate consent, estimated screen
  geometry and a 9-point calibration plus held-out validation. Refusing it or a camera failure
  continues the study without gaze.
- **Calibration error is recorded, not a gate.** The plan's 1.5° gate is far below webcam
  accuracy (WebGazer reports ~4° on average), so it would exclude nearly everyone. Gaze is
  recorded for every participant who completes calibration and each session stores its
  held-out error; a 10° cutoff marks sessions analysis-ready for now, and the final cutoff is
  chosen at analysis time from the stored errors. Emotion is still never inferred from
  face or gaze. The plan requires separate ethics approval for gaze (§11.4). See
  `docs/biometrics.md`.

## Prompt vs plan

- **Trials per block.** Plan §3.4 says six trials per block (Study 1); the pilot follows plan
  §7.2 and the prompt: 3 trials × 4 blocks = 12 main trials.
- **Measures per block.** Plan §11.2 puts NASA-TLX, UMUX-Lite and disorientation after every
  block in Study 1. The pilot follows plan §7.3: SUS per menu and NASA-TLX once at the end,
  plus a check-in and fatigue rating after each block.
- **NASA-TLX.** All six subscales are collected for comparability, each asked with NASA's own
  question wording and labelled slider ends, because the bare subscale names confused pilot
  participants. Plan §11.1 requires any workload composite to exclude the frustration
  subscale; no composite is computed yet.
- **Database.** SQLite (better-sqlite3) behind `Repository`, not PostgreSQL: Docker is optional
  on the lab machine. Event metadata is JSON text; raw events are also appended to
  `data/raw/<session_id>.jsonl`.

## Design choices

- **Counterbalancing.** Block orders depart from the plan's cyclic 4 × 4 square: confusion
  always precedes frustration so lingering frustration cannot colour the confusion block.
  The four orders keep happy and bored in every position once; confusion is never last and
  frustration never first. Every block searches all six menus once (24 scored searches), in a
  row of a 6 × 6 Williams square: block b takes row r + b.
- **Fixed schedule, no randomness.** Participants take a 24-sequence cycle in arrival order
  (participant n gets sequence n mod 24). The block order changes every person and the menu row
  r every four people, so per 24 people every block order meets every menu row once, and in every
  emotion each menu sits in each position after the scenario equally often. Colour mappings
  cycle too. Gender × shopping frequency is still recorded as the stratum but no longer steers
  allocation. A withdrawn participant's position is not reused. `npm run audit:balance` reports
  balance.
- **Task bank.** 72 tasks, one per product. T01–T12 are the plan's Table 5.1 tasks on their
  listed products; the other 60 are generated. "Matched variants" are not generated.
- **Scored searches: the plan's 12 plus 12 added, for everyone** (8 easy / 8 medium / 8 hard,
  six per department). The 60 generated tasks describe hidden details (size, price) that the menu
  names cannot lead to, so pilot participants could not find them; S01–S12 in `added-tasks.json`
  are written in the plan's style instead. The 24 form four groups of six (two per tier); the
  task rotation ("target set", equal to the block-order row) gives each emotion every group
  equally often. Within a block, the watch for menu m is task (m + r) of the group, so each
  task meets each menu equally often. No 6 × 6 design can also give each task every position
  (six has no orthogonal Latin squares), so tasks spread unevenly over positions. T04, T05, T08 and T10
  are reworded so no task names a different watch in its own collection (e.g. "Rose-gold" when
  "Rose Gold" sits beside the answer). Practice uses six plan-style tasks in `practice.json`,
  on watches that are never scored.
- **Difficulty weights** (0.35 position / 0.40 semantic / 0.25 distractors) are my choice; see
  `docs/difficulty.md`. Rewording the generated tasks renumbered six task ids within their
  tier; no task changed tier, target or attributes.
- **Colour vision** is self-reported, not an Ishihara-style plate test, which cannot be
  reproduced faithfully on screen without licensed plates.
- **Prior menu experience** (plan §7.3) is stored in the `demographics` event metadata rather
  than a new participant column.
- **Inductions.** Frustrated and confused run real searches in a plain shop list (not one of
  the six study menus) with the catalogue's real names, because pilot participants found the
  searches themselves frustrating and confusing. Frustrated: three 15-second searches for
  script-written watches whose details the menus hide (chosen from the block id). Confused: one
  45-second search for a watch the shop does not stock ("44 mm automatic dress watch with a
  green dial"); the debrief says so. Outcomes are `search_attempt` events with no trial id.
  Bored: an early-exit button, logged as `induction_end` with
  `early_exit: true`. Each block's neutral reset opens with that induction's debrief line.
  Credibility is one 7-point item per induction.
- **Session order.** Gaze consent comes straight after core consent.
- **Screen geometry is estimated, not measured.** Participants cannot measure their screen and
  browsers do not report its physical size. When the camera starts, millimetres are derived from
  the CSS reference pixel (96 px per inch, viewed at 28 in), so 1 px ≈ 0.0213°. Real displays
  can differ by roughly a third, which scales every reported angle by the same factor.
  Calibration runs after the first post-induction check-in, immediately before the first
  scored trial.
- **Abort & debrief** asks for a reason before it stops the session, to prevent accidental
  aborts.
- **Test mode.** `?fast=1` shortens timers for rehearsal and automated tests only, and shows a
  visible notice.
- **QA.** "Reconstructable" counts a trial ended without any clicks (an immediate give-up) as
  reconstructable; only a successful trial must have a non-empty path. Frame rate is the
  median of per-trial `requestAnimationFrame` samples; very short scripted trials under-read it.
- **Analysis scaffold.** Python produces the manipulation-check report and difficulty table;
  R produces the variance components with lme4 (no Python equivalent of lme4 is assumed).
- **Study 2/3** are stubbed in `apps/server/src/conditions.ts` behind `FEATURE_STUDY2` and
  `FEATURE_STUDY3` (default off); the server refuses to start if either is on.
- **Project status.** `AGENTS.md` §0 is not filled in. As ethics approval is pending and there
  are no real participants, the build is treated as pre-production.
