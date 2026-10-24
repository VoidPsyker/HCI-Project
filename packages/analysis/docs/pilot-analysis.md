# Pilot evaluation exports

Regenerate the restricted admin export after the affect-rule update. Keep its
manifest with the inputs. Pilot observations are excluded from confirmatory analysis.

```
python packages/analysis/scripts/pilot_report.py EXPORT_DIR OUTPUT_DIR
Rscript packages/analysis/scripts/pilot_variance.R EXPORT_DIR OUTPUT_DIR
python -m unittest discover -s packages/analysis/test-python
```

Python uses only the standard library. It reads checkins.csv, trials.csv and
tasks.csv, reports post-induction manipulation checks and observed task difficulty,
and excludes practice trials. Missing cells remain null. Manipulation results use
the exported shared scoring rule; the script does not duplicate its thresholds.
Assigned state_label and observed reported_state remain distinct. Do not mix
synthetic seed sessions with human pilot exports.
Both scripts exclude synthetic sessions by default and reject missing provenance.
CSV provenance is carried from the raw session_start event; a missing start
remains unknown rather than being called human data. `--include-synthetic` is
available only for explicitly labeled rehearsal reports and model self-checks.
Regenerate older exports that lack the synthetic column.

The R scaffold requires lme4. It estimates participant, target, menu-by-assigned-state
and residual SDs with REML on log1p(successful completion time in milliseconds).
Inspect variance-status.txt before using variance-components.csv. Sparse data
can be not_estimable; singular fits and convergence messages need review.
This is a starting-values scaffold, not a confirmatory model or a treatment-effect test.
The variance scaffold preserves randomized assignment even when the self-report
is mixed; it does not claim the intended emotion was induced. Practice and failed
trials are excluded from this small successful-time fit, so failure/censoring
needs separate analysis. Python reports timeouts/give-ups and successful-time
medians. Trial reported_state comes from the same session/block's post-induction
check-in; missing checks stay missing. Keep mixed reports identifiable for the
plan's separate self-report analysis.
R is available in the isolated Docker image `periwinkle-analysis:local`:

```
docker build -f packages/analysis/Dockerfile -t periwinkle-analysis:local packages/analysis
docker run --rm --mount type=bind,source=ABSOLUTE_ANALYSIS_PATH,target=/analysis,readonly --workdir /analysis periwinkle-analysis:local scripts/check_variance.R
```

Verified runtime: R 4.6.1, lme4 2.1.0. The synthetic self-check passes valid
component estimation, insufficient-level rejection and singular-fit rejection.
The actual eight-session synthetic export fit returned not_estimable/singular;
no variance CSV was fabricated. Bind the export input and output directory when
running scripts/pilot_variance.R in the same image. No host R install is required.

Gaze quality/provenance exports stay separate. Synthetic gaze is never analysis-ready.
Webcam accuracy and dedicated tracker hardware still require human lab validation.
