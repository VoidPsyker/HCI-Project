import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location("pilot_report", Path(__file__).parents[1] / "scripts/pilot_report.py")
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class PilotReportTests(unittest.TestCase):
    def test_empty_cells_stay_missing_instead_of_zero(self):
        result = report.summarize([], [], [{"id": "T1", "target_id": "p1", "difficulty": "Hard"}])
        self.assertIsNone(result["manipulation"]["happy"]["threshold_pass_rate"])
        self.assertIsNone(result["task_difficulty"][0]["success_rate"])

    def test_phase_practice_and_success_filtering(self):
        checkin = {"meta": '{"phase":"post_induction"}', "state_label": "happy",
                   "reported_state": "mixed", "manipulation_check_passed": "0", "intensity": "6", "synthetic": "1"}
        trials = [
            {"practice": "0", "success": "1", "task_id": "T1", "completion_time_ms": "2000"},
            {"practice": "0", "success": "0", "task_id": "T1", "completion_time_ms": "", "timed_out": "1"},
            {"practice": "1", "success": "1", "task_id": "T1", "completion_time_ms": "10"},
        ]
        trials = [{**row, "synthetic": "1"} for row in trials]
        result = report.summarize([checkin, {**checkin, "meta": '{"phase":"post_trials"}'}], trials,
                                  [{"id": "T1", "target_id": "p1", "difficulty": "Hard"}], include_synthetic=True)
        self.assertEqual(result["manipulation"]["happy"]["n"], 1)
        self.assertEqual(result["manipulation"]["happy"]["reported_intended_rate"], 0)
        self.assertEqual(result["task_difficulty"][0]["success_rate"], 0.5)
        self.assertEqual(result["task_difficulty"][0]["mean_success_time_seconds"], 2)
        self.assertEqual(result["task_difficulty"][0]["median_success_time_seconds"], 2)
        self.assertEqual(result["task_difficulty"][0]["timeouts"], 1)

    def test_invalid_flags_are_not_silently_counted_as_failures(self):
        with self.assertRaises(ValueError):
            report.summarize([], [{"practice": "0", "success": "", "task_id": "T1", "synthetic": "0"}], [])

    def test_synthetic_rows_are_excluded_by_default_and_unknown_provenance_is_rejected(self):
        row = {"synthetic": "1", "practice": "0", "success": "1", "task_id": "T1", "completion_time_ms": "2000"}
        result = report.summarize([], [row], [{"id": "T1", "target_id": "p1", "difficulty": "Easy"}])
        self.assertEqual(result["task_difficulty"][0]["n"], 0)
        self.assertEqual(result["synthetic_rows"]["trials"], 1)
        with self.assertRaisesRegex(ValueError, "provenance"):
            report.summarize([], [{**row, "synthetic": ""}], [])

    def test_old_export_schema_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "checkins.csv").write_text("state_label\nhappy\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "missing columns"):
                report.read_csv(Path(folder), "checkins.csv", ["reported_state", "manipulation_check_passed"])


if __name__ == "__main__":
    unittest.main()
