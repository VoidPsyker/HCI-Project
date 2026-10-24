# Task difficulty rule

Plan §5.2 defines difficulty by three properties. `packages/taxonomy/scripts/generate-data.ts`
computes them for every generated target and writes the tier into `tasks.json`. This file
describes that code; it does not replace it.

## The 12 canonical tasks

T01–T12 keep the tier printed in plan Table 5.1 (4 easy, 4 medium, 4 hard). Their wording is
the plan's wording.

## The 60 generated tasks

Each target gets a score in [0, 1]. Higher means harder:

```
score = 0.35 × position + 0.40 × semantic + 0.25 × distractors

position    = (departmentIndex / 3 + subcategoryIndex / 2) / 2
semantic    = 1 − |L ∩ T| / |L ∪ T|
distractors = min(1, n / 24)
```

- **Serial position.** `departmentIndex` is the 0–3 position of the department in the shared
  menu order (Sport & Dive first, Smart & Hybrid last). `subcategoryIndex` is the 0–2
  position inside its department. Targets deeper in the scan order score higher.
- **Semantic distance.** `L` is the set of leaf-label words and `T` the set of task-wording
  words, each lower-cased, split on non-alphanumerics, keeping words longer than two
  characters. The score is the Jaccard distance: wording that repeats the label (for example
  "steel" for *Steel Mesh*) is easier.
- **Distractors.** `n` is the number of other products sharing the target's dial colour or
  strap material, capped at 24.

The 60 targets are sorted by score (ties broken by product id). The lowest are labelled easy
and the highest hard, filling each tier to exactly 24 tasks overall. `validateTaxonomy()`
fails the build unless every tier holds 24.

## Notes

- The weights (0.35 / 0.40 / 0.25) are a design choice, not taken from the plan. They are
  recorded in `ASSUMPTIONS.md` and should be re-calibrated from the pilot's task calibration
  table (admin dashboard, and `task-difficulty.csv` from `pilot_report.py`).
- The go/no-go criterion "easy > medium > hard" checks this rule against observed success.
