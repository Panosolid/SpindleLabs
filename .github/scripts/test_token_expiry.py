"""token_expiry.py: python3 -m unittest discover -s .github/scripts"""

import datetime
import os
import unittest
from unittest import mock

import token_expiry as t

NOW = datetime.datetime(2027, 9, 1, 12, 0, tzinfo=datetime.timezone.utc)


class DaysLeftTest(unittest.TestCase):
    def test_hand_worked(self):
        # By hand: 1 Sep 12:00 to 14 Oct 00:00 is 30 days (rest of Sep) + 13 days
        # (1-13 Oct) + 12 hours, so 42 whole days.
        self.assertEqual(t.days_left("2027-10-14 00:00:00 UTC", NOW), 42)

    def test_unreadable_is_none(self):
        self.assertIsNone(t.days_left("next year", NOW))
        self.assertIsNone(t.days_left(None, NOW))


class VerdictTest(unittest.TestCase):
    def at(self, days):
        return (NOW + datetime.timedelta(days=days, hours=1)).strftime("%Y-%m-%d %H:%M:%S UTC")

    def test_the_warning_starts_at_warn_days(self):
        # 22 days left: quiet; 21 (WARN_DAYS) and 20: a line naming the key and the date.
        self.assertIsNone(t.verdict("KERNEL_READ", self.at(t.WARN_DAYS + 1), NOW))
        for days in (t.WARN_DAYS, t.WARN_DAYS - 1):
            line = t.verdict("KERNEL_READ", self.at(days), NOW)
            self.assertIn(f"KERNEL_READ runs out on {self.at(days)} ({days} days)", line)

    def test_a_refused_key_or_no_end_date_needs_ben(self):
        self.assertIn("refused (HTTP 401)", t.verdict("RESULTS_WRITE", None, NOW, status=401))
        self.assertIn("no end date", t.verdict("RESULTS_WRITE", None, NOW))
        self.assertIn("could not be read", t.verdict("RESULTS_WRITE", "soon", NOW))


class MainTest(unittest.TestCase):
    def test_only_names_and_dates_are_printed_and_a_missing_key_fails(self):
        env = {"KERNEL_READ": "secret-value-1", "RESULTS_WRITE": ""}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(t, "ask", return_value=(200, "2030-01-01 00:00:00 UTC")), \
                mock.patch("builtins.print") as out:
            self.assertEqual(t.main(["KERNEL_READ", "RESULTS_WRITE"]), 1)
        printed = " ".join(str(c.args[0]) for c in out.call_args_list)
        self.assertNotIn("secret-value-1", printed)
        self.assertIn("RESULTS_WRITE is empty", printed)
        self.assertIn("KERNEL_READ: more than", printed)

    def test_an_issue_is_filed_only_with_a_token(self):
        env = {"KERNEL_READ": "x", "GH_TOKEN": "g", "GITHUB_REPOSITORY": "o/r"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(t, "ask", return_value=(401, None)), \
                mock.patch.object(t, "file_issue") as filed, mock.patch("builtins.print"):
            self.assertEqual(t.main(["KERNEL_READ"]), 1)
        filed.assert_called_once()
        self.assertIn("KERNEL_READ was refused", filed.call_args.args[0][0])

    def test_all_well_exits_0(self):
        with mock.patch.dict(os.environ, {"KERNEL_READ": "x"}, clear=True), mock.patch.object(t, "ask", return_value=(200, "2030-01-01 00:00:00 UTC")), \
                mock.patch("builtins.print"):
            self.assertEqual(t.main(["KERNEL_READ"]), 0)


if __name__ == "__main__":
    unittest.main()
