"""Summarize restricted pilot exports; pilot data are excluded from confirmatory analysis."""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean, median


def read_csv(folder, name, required):
    with (folder / name).open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = set(required) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{name}: missing columns {sorted(missing)}; regenerate the export")
        return list(reader)


def summarize(checkins, trials, tasks, include_synthetic=False):
    def eligible(rows):
        for row in rows:
            if row.get("synthetic") not in ("0", "1"):
                raise ValueError("synthetic provenance missing or invalid; regenerate a complete export")
        return [row for row in rows if include_synthetic or row["synthetic"] == "0"]

    excluded = {"checkins": sum(row.get("synthetic") == "1" for row in checkins),
                "trials": sum(row.get("synthetic") == "1" for row in trials)}
    checkins, trials = eligible(checkins), eligible(trials)
    induction = defaultdict(list)
    for row in checkins:
        if json.loads(row["meta"]).get("phase") == "post_induction":
            if row["manipulation_check_passed"] not in ("0", "1"):
                raise ValueError("manipulation_check_passed must be 0 or 1")
            induction[row["state_label"]].append(row)
    manipulation = {}
    for state in ("happy", "frustrated", "confused", "bored"):
        rows = induction[state]
        manipulation[state] = {
            "n": len(rows),
            "threshold_pass_rate": mean(int(row["manipulation_check_passed"]) for row in rows) if rows else None,
            "reported_intended_rate": mean(row["reported_state"] == state for row in rows) if rows else None,
            "mean_intensity": mean(float(row["intensity"]) for row in rows) if rows else None,
        }
    by_task = defaultdict(list)
    for row in trials:
        if row["practice"] == "0":
            if row["success"] not in ("0", "1"):
                raise ValueError("success must be 0 or 1 for completed trials")
            by_task[row["task_id"]].append(row)
    difficulty = []
    for task in tasks:
        rows = by_task[task["id"]]
        times = [float(row["completion_time_ms"]) / 1000 for row in rows
                 if row["success"] == "1" and row["completion_time_ms"]]
        difficulty.append({
            "task_id": task["id"], "target_id": task["target_id"], "difficulty": task["difficulty"],
            "n": len(rows), "success_rate": mean(int(row["success"]) for row in rows) if rows else None,
            "mean_success_time_seconds": mean(times) if times else None,
            "median_success_time_seconds": median(times) if times else None,
            "timeouts": sum(row.get("timed_out") == "1" for row in rows),
            "give_ups": sum(row.get("gave_up") == "1" for row in rows),
        })
    return {"scope": "synthetic rehearsal enabled; not research results" if include_synthetic else "pilot_only; excluded from confirmatory analysis",
            "include_synthetic": include_synthetic, "synthetic_rows": excluded,
            "manipulation": manipulation, "task_difficulty": difficulty}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--include-synthetic", action="store_true", help="Rehearsal only; never research results")
    args = parser.parse_args()
    report = summarize(
        read_csv(args.export_dir, "checkins.csv", ["synthetic", "meta", "state_label", "reported_state", "manipulation_check_passed", "intensity"]),
        read_csv(args.export_dir, "trials.csv", ["synthetic", "practice", "success", "task_id", "completion_time_ms"]),
        read_csv(args.export_dir, "tasks.csv", ["id", "target_id", "difficulty"]),
        args.include_synthetic,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "pilot-report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    with (args.output_dir / "task-difficulty.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["task_id", "target_id", "difficulty", "n", "success_rate", "mean_success_time_seconds", "median_success_time_seconds", "timeouts", "give_ups"])
        writer.writeheader()
        writer.writerows(report["task_difficulty"])


if __name__ == "__main__":
    main()
