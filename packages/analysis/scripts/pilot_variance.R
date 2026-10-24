# Pilot starting values only. Exclude pilot observations from confirmatory analysis.
args <- commandArgs(trailingOnly = TRUE)
if (!(length(args) %in% c(2, 3)) || (length(args) == 3 && args[3] != "--include-synthetic"))
  stop("Usage: Rscript pilot_variance.R export_dir output_dir [--include-synthetic]")
include_synthetic <- length(args) == 3
dir.create(args[2], recursive = TRUE, showWarnings = FALSE)
status_path <- file.path(args[2], "variance-status.txt")
components_path <- file.path(args[2], "variance-components.csv")
if (file.exists(components_path)) unlink(components_path)
result <- tryCatch({
  if (!requireNamespace("lme4", quietly = TRUE)) stop("Install the R package lme4 first")
  trials <- read.csv(file.path(args[1], "trials.csv"), stringsAsFactors = FALSE)
  required <- c("synthetic", "participant_id", "target_id", "menu_id", "state_label", "practice", "success", "completion_time_ms")
  if (!all(required %in% names(trials))) stop("Missing required trial export columns")
  if (any(!trials$synthetic %in% c(0, 1))) stop("Missing or invalid synthetic provenance")
  d <- subset(trials, practice == 0 & success == 1 & is.finite(completion_time_ms) & completion_time_ms >= 0 &
              state_label %in% c("happy", "frustrated", "confused", "bored") & (include_synthetic | synthetic == 0))
  if (nrow(d) == 0) stop("no_eligible_trials_after_practice_success_provenance_filters")
  if (anyNA(d[required])) stop("Missing model identifiers or outcomes")
  d$log_time <- log1p(d$completion_time_ms)
  d$menu_state <- interaction(d$menu_id, d$state_label, drop = TRUE)
  groups <- c("participant_id", "target_id", "menu_state")
  if (any(vapply(d[groups], function(x) length(unique(x)) < 2, logical(1)))) stop("Too few grouping levels")
  fit <- lme4::lmer(log_time ~ 1 + (1 | participant_id) + (1 | target_id) + (1 | menu_state), data = d, REML = TRUE)
  if (lme4::isSingular(fit)) stop("singular_fit; starting values are not estimable")
  if (length(fit@optinfo$conv$lme4$messages)) stop("model_did_not_converge")
  components <- as.data.frame(lme4::VarCorr(fit))
  write.csv(components[c("grp", "sdcor")], components_path, row.names = FALSE)
  paste(if (include_synthetic) "synthetic rehearsal; not research results; n =" else "pilot_only; excluded from confirmatory analysis; n =", nrow(d),
        "; randomized assigned state; log1p(milliseconds); singular =", lme4::isSingular(fit),
        "; convergence =", paste(fit@optinfo$conv$lme4$messages, collapse = ";"))
}, error = function(e) paste("not_estimable:", conditionMessage(e)))
writeLines(result, status_path)
if (startsWith(result, "not_estimable:")) quit(status = 1)
