import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FOOD = Path(__file__).resolve().parent.parent / "skills/food/food-tracking/scripts/food.py"


class FoodCli(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.env = {**os.environ, "NANO_DATA_DIR": self.dir.name, "TZ": "America/New_York"}
        self.env.pop("FOOD_DB", None)
        self.env.pop("FOOD_TZ_URL", None)

    def tearDown(self):
        self.dir.cleanup()

    def food(self, *args, ok=True):
        result = subprocess.run([sys.executable, "-I", str(FOOD), *args], env=self.env, capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_log_writes_offset_timestamp_and_totals(self):
        out = self.food("log", "Oatmeal", "--cal", "300", "--protein", "10", "--fiber", "8", "--at", "2026-07-04 08:15").stdout
        self.assertIn("Logged #1: Oatmeal at 2026-07-04T08:15:00-04:00", out)  # summer offset from the zone, not hard-coded
        out = self.food("log", "Eggs", "--cal", "140", "--protein", "12", "--fiber", "0", "--at", "2026-07-04 08:20").stdout
        self.assertIn("Total: 440 cal, 22g protein, 8g fiber", out)
        self.assertIn("Target: none set", out)

    def test_winter_offset(self):
        out = self.food("log", "Soup", "--cal", "200", "--protein", "9", "--fiber", "4", "--at", "2026-12-01 19:00").stdout
        self.assertIn("2026-12-01T19:00:00-05:00", out)

    def test_late_evening_entry_stays_on_its_local_day(self):
        self.food("log", "Late snack", "--cal", "100", "--protein", "2", "--fiber", "1", "--at", "2026-12-01 23:30")
        self.assertIn("1 entries", self.food("day", "2026-12-01").stdout)
        self.assertIn("0 entries", self.food("day", "2026-12-02").stdout)

    def test_duplicate_needs_force(self):
        args = ["log", "Granola bar", "--cal", "200", "--protein", "5", "--fiber", "3", "--at", "2026-12-01 10:00"]
        self.food(*args)
        again = self.food(*args, ok=False)
        self.assertEqual(again.returncode, 2)
        self.assertIn("already logged", again.stderr)
        self.food(*args, "--force")
        self.assertIn("2 entries", self.food("day", "2026-12-01").stdout)

    def test_future_clock_time_is_rejected(self):
        result = self.food("log", "Dinner", "--cal", "1", "--protein", "1", "--fiber", "1", "--at", "23:59", ok=False)
        # Passes only in the last minutes of the day; otherwise the command must refuse.
        if result.returncode != 0:
            self.assertIn("still in the future", result.stderr)

    def test_prior_edit_delete(self):
        self.food("log", "Greek yogurt", "--cal", "150", "--protein", "20", "--fiber", "0", "--at", "2026-12-01 09:00")
        self.assertIn("Greek yogurt | 150 cal, 20g protein, 0g fiber | logged 1x, last 2026-12-01", self.food("prior", "yogurt").stdout)
        self.assertIn("Total: 180 cal", self.food("edit", "1", "--cal", "180").stdout)
        self.assertIn("0 entries", self.food("delete", "1").stdout)
        self.assertEqual(self.food("delete", "1", ok=False).returncode, 2)

    def test_targets_show_remaining(self):
        import sqlite3
        self.food("day", "2026-12-01")  # creates the schema
        db = sqlite3.connect(Path(self.dir.name) / "food" / "food.db")
        db.execute("INSERT INTO targets VALUES ('2026-12-01', 2000, 150, 30)")
        db.commit()
        db.close()
        out = self.food("log", "Rice bowl", "--cal", "600", "--protein", "30", "--fiber", "6", "--at", "2026-12-01 12:00").stdout
        self.assertIn("Left: 1400 cal, 120g protein, 24g fiber", out)

    def test_weight(self):
        self.assertIn("Logged weight 185.5 lb", self.food("weight", "185.5").stdout)


if __name__ == "__main__":
    unittest.main()
