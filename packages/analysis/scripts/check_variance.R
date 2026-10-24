# Synthetic self-check only; never reads participant exports.
set.seed(20261024)
root <- tempfile("variance-check-")
dir.create(root)
d <- expand.grid(participant_id = paste0("p", 1:12), target_id = paste0("t", 1:12),
                 menu_id = LETTERS[1:6], state_label = c("happy", "frustrated", "confused", "bored"))
cell <- interaction(d$menu_id, d$state_label)
d$completion_time_ms <- exp(8 + rnorm(12, 0, 0.3)[as.integer(d$participant_id)] +
  rnorm(12, 0, 0.25)[as.integer(d$target_id)] + rnorm(24, 0, 0.2)[as.integer(cell)] +
  rnorm(nrow(d), 0, 0.15)) - 1
d$practice <- 0
d$success <- 1
d$synthetic <- 1
write.csv(d, file.path(root, "trials.csv"), row.names = FALSE)
run <- function(output, include = TRUE) system2(file.path(R.home("bin"), "Rscript"),
  c("scripts/pilot_variance.R", root, file.path(root, output), if (include) "--include-synthetic" else character()),
  stdout = FALSE, stderr = FALSE)
stopifnot(run("valid") == 0)
components <- read.csv(file.path(root, "valid", "variance-components.csv"))
stopifnot(setequal(components$grp, c("participant_id", "target_id", "menu_state", "Residual")),
          all(is.finite(components$sdcor)), all(components$sdcor > 0))
stopifnot(run("exclude-synthetic", include = FALSE) != 0,
          !file.exists(file.path(root, "exclude-synthetic", "variance-components.csv")))
valid_d <- d
d$participant_id <- "one-level"
write.csv(d, file.path(root, "trials.csv"), row.names = FALSE)
stopifnot(run("invalid") != 0,
          startsWith(readLines(file.path(root, "invalid", "variance-status.txt")), "not_estimable:"),
          !file.exists(file.path(root, "invalid", "variance-components.csv")))
d <- valid_d
noise <- rnorm(nrow(d))
noise <- noise - ave(noise, d$participant_id) - ave(noise, d$target_id) -
  ave(noise, interaction(d$menu_id, d$state_label)) + 2 * mean(noise)
d$completion_time_ms <- exp(8 + 0.15 * noise) - 1
write.csv(d, file.path(root, "trials.csv"), row.names = FALSE)
stopifnot(run("singular") != 0,
          startsWith(readLines(file.path(root, "singular", "variance-status.txt")), "not_estimable:"),
          !file.exists(file.path(root, "singular", "variance-components.csv")))
cat("PASS: synthetic variance components, insufficient-data and singular-fit rejection\n")
