#!/usr/bin/env Rscript
# Run carobiner::check_terms on golden fixture CSVs (check="nogeo").
# Usage: Rscript run_checker_r.R [fixtures_dir] [output_json]

args <- commandArgs(trailingOnly = TRUE)
initial_options <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", initial_options, value = TRUE)
script_dir <- if (length(file_arg)) {
  dirname(normalizePath(sub("^--file=", "", file_arg[1]), mustWork = FALSE))
} else {
  normalizePath(getwd(), mustWork = FALSE)
}

fixtures_dir <- if (length(args) >= 1) normalizePath(args[[1]], mustWork = TRUE) else script_dir
output_path <- if (length(args) >= 2) args[[2]] else file.path(fixtures_dir, "r_results.json")

terminag_root <- normalizePath(file.path(fixtures_dir, "..", "..", ".."), mustWork = TRUE)
monorepo_root <- normalizePath(file.path(terminag_root, ".."), mustWork = FALSE)

install_local <- function(pkg_path) {
  if (!dir.exists(pkg_path)) return(FALSE)
  if (!requireNamespace("remotes", quietly = TRUE)) {
    install.packages("remotes", repos = "https://cloud.r-project.org")
  }
  remotes::install_local(pkg_path, upgrade = "never", dependencies = FALSE, quiet = TRUE)
  TRUE
}

if (!requireNamespace("carobiner", quietly = TRUE)) {
  yuri_path <- file.path(monorepo_root, "yuri")
  vocal_path <- file.path(monorepo_root, "vocal")
  carobiner_path <- file.path(monorepo_root, "carobiner")
  if (dir.exists(yuri_path)) install_local(yuri_path)
  if (dir.exists(vocal_path)) install_local(vocal_path)
  if (dir.exists(carobiner_path)) {
    install_local(carobiner_path)
  } else if (!requireNamespace("carobiner", quietly = TRUE)) {
  remotes::install_github("carob-data/yuri", upgrade = "never", quiet = TRUE)
  remotes::install_github("controvoc/vocal", upgrade = "never", quiet = TRUE)
  remotes::install_github("carob-data/carobiner", upgrade = "never", quiet = TRUE)
  }
}

suppressPackageStartupMessages(library(carobiner))
suppressPackageStartupMessages(library(jsonlite))

carobiner::carob_vocabulary(reset = TRUE)
suppressMessages(carobiner::carob_vocabulary(terminag_root, add = FALSE, save = FALSE))

read_one_csv <- function(path) {
  df <- utils::read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  if (ncol(df) == 0) return(NULL)
  df
}

read_metadata_row <- function(path) {
  df <- read_one_csv(path)
  if (is.null(df) || nrow(df) == 0) return(NULL)
  df[1, ]
}

cases_path <- file.path(fixtures_dir, "cases.json")
cases <- jsonlite::fromJSON(cases_path, simplifyVector = FALSE)

issues_to_list <- function(df) {
  if (is.null(df) || nrow(df) == 0) return(list())
  lapply(seq_len(nrow(df)), function(i) {
    list(check = as.character(df$check[i]), msg = as.character(df$msg[i]))
  })
}

sort_issues <- function(issues) {
  if (length(issues) == 0) return(issues)
  ord <- order(vapply(issues, function(x) paste(x$check, x$msg, sep = "\t"), character(1)))
  issues[ord]
}

results <- list()
for (case in cases) {
  id <- case$id
  records <- NULL
  metadata <- NULL
  if (!is.null(case$records)) {
    records <- read_one_csv(file.path(fixtures_dir, case$records))
  }
  if (!is.null(case$metadata)) {
    metadata <- read_metadata_row(file.path(fixtures_dir, case$metadata))
  }
  out <- carobiner::check_terms(
    metadata = metadata,
    records = records,
    check = "nogeo"
  )
  results[[id]] <- sort_issues(issues_to_list(out))
}

jsonlite::write_json(results, output_path, auto_unbox = TRUE, pretty = TRUE)
cat(paste0("Wrote ", output_path, "\n"))
