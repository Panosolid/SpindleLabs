"""Tests for changelog.py: python3 -m unittest discover -s .github/scripts"""

import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import changelog  # noqa: E402
from changelog import Fragment, check_pr, number, parse_changelog, parse_fragment, render  # noqa: E402
from check_version import check_changelog  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "changelog.py")

START = """# Changelog

Intro.

## 0.32.21 (2026-10-27)

- Old entry.

## 0.32.20 (2026-10-26)

- Older entry.
"""


def frag(name, bump, date="2026-11-01"):
    return Fragment(name, bump, f"- Entry {name}.", date)


def numbered_text(text, fragments):
    preamble, sections = parse_changelog(text)
    return render(preamble, number(sections, fragments))


class ParseFragment(unittest.TestCase):
    def test_each_bump(self):
        for first, bump in [("fix", "fix"), ("none", "none"), ("step 33", ("step", 33)), ("step 0", ("step", 0))]:
            f, problem = parse_fragment("a.md", f"{first}\n\n- Text.\n")
            self.assertIsNone(problem)
            self.assertEqual((f.bump, f.text), (bump, "- Text."))

    def test_several_lines_kept(self):
        f, _ = parse_fragment("a.md", "fix\n\n- One.\n- Two,\n  more.   \n\n")
        self.assertEqual(f.text, "- One.\n- Two,\n  more.")

    def test_refused(self):
        cases = [
            ("A.md", "fix\n\n- x\n", "name"),
            ("a.txt", "fix\n\n- x\n", "name"),
            ("-a.md", "fix\n\n- x\n", "name"),
            ("a.md", "Fix\n\n- x\n", "first line"),
            ("a.md", "fix:\n\n- x\n", "first line"),
            ("a.md", "step\n\n- x\n", "first line"),
            ("a.md", "step 033\n\n- x\n", "first line"),
            ("a.md", "bugfix\n\n- x\n", "first line"),
            ("a.md", "fix\n- x\n", "blank line"),
            ("a.md", "fix", "blank line"),
            ("a.md", "fix\n\nx\n", "start with '- '"),
            ("a.md", "fix\n\n\n", "start with '- '"),
            ("a.md", "fix\n\n- x\n## 0.40.0 (2026-11-01)\n", "no headings"),
        ]
        for name, content, words in cases:
            f, problem = parse_fragment(name, content)
            self.assertIsNone(f, (name, content))
            self.assertIn(words, problem, (name, content))


class NextVersion(unittest.TestCase):
    def test_hand_worked(self):
        nv = changelog.next_version
        self.assertEqual(nv((0, 32, 21), "fix"), (0, 32, 22))  # bug fix adds one
        self.assertEqual(nv((0, 32, 21), ("step", 33)), (0, 33, 0))  # a new step starts at .0
        self.assertEqual(nv((0, 32, 21), ("step", 35)), (0, 35, 0))  # a jump of steps is allowed
        self.assertIsNone(nv((0, 32, 21), ("step", 32)))  # step 32 already started
        self.assertIsNone(nv((0, 32, 21), ("step", 31)))  # an older step's late piece
        self.assertIsNone(nv((0, 32, 21), "none"))


class Number(unittest.TestCase):
    def test_hand_worked(self):
        # Merged in this order: a none, b fix, c none, d step 33, e fix, f step 33, g step 32.
        # a joins 0.32.21 (on top: newest first); b makes 0.32.22, c joins it;
        # d makes 0.33.0; e makes 0.33.1; f (step 33 already started) and g
        # (an older step) join 0.33.1, f above e and g above f.
        order = [frag("a", "none", "2026-10-28"), frag("b", "fix", "2026-10-28"), frag("c", "none", "2026-10-29"),
                 frag("d", ("step", 33), "2026-10-29"), frag("e", "fix", "2026-10-30"),
                 frag("f", ("step", 33), "2026-10-30"), frag("g", ("step", 32), "2026-10-31")]
        self.assertEqual(numbered_text(START, order), """# Changelog

Intro.

## 0.33.1 (2026-10-30)

- Entry g.
- Entry f.
- Entry e.

## 0.33.0 (2026-10-29)

- Entry d.

## 0.32.22 (2026-10-28)

- Entry c.
- Entry b.

## 0.32.21 (2026-10-27)

- Entry a.
- Old entry.

## 0.32.20 (2026-10-26)

- Older entry.
""")

    def test_order_decides_the_numbers(self):
        # Two fixes: whichever merged first is 0.32.22.
        one = numbered_text(START, [frag("x", "fix"), frag("y", "fix")])
        other = numbered_text(START, [frag("y", "fix"), frag("x", "fix")])
        self.assertIn("## 0.32.23 (2026-11-01)\n\n- Entry y.\n\n## 0.32.22 (2026-11-01)\n\n- Entry x.", one)
        self.assertIn("## 0.32.23 (2026-11-01)\n\n- Entry x.\n\n## 0.32.22 (2026-11-01)\n\n- Entry y.", other)

    def test_nothing_to_number(self):
        self.assertEqual(numbered_text(START, []), START)

    def test_no_heading_to_count_from(self):
        with self.assertRaises(ValueError):
            numbered_text("# Changelog\n", [frag("a", "fix")])

    def test_real_changelog_reads_back_exactly(self):
        # parse then render is the file, byte for byte, so a fold never
        # rewrites an old entry.
        with open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8") as f:
            text = f.read()
        self.assertEqual(numbered_text(text, []), text)


def model(start, bumps):
    """The version after these bumps, worked out independently of number():
    the step is the highest of the start's and every step named; the fix
    count is the start's plus every fix when no step rose past the start,
    otherwise the fixes merged after the last step that set a new highest."""
    big, step, fixes = start
    highest, last_rise = step, None
    for i, b in enumerate(bumps):
        if b != "fix" and b != "none" and b[1] > highest:
            highest, last_rise = b[1], i
    if last_rise is None:
        return (big, step, fixes + bumps.count("fix")), bumps.count("fix")
    rises = sum(1 for i, b in enumerate(bumps)
                if b not in ("fix", "none") and b[1] > max([step] + [c[1] for c in bumps[:i] if c not in ("fix", "none")]))
    return (big, highest, bumps[last_rise + 1:].count("fix")), bumps.count("fix") + rises


class RandomMergeOrders(unittest.TestCase):
    """Seeded: pull requests merging in any order never give two entries one
    number or skip one, every entry appears once, and folding part way
    (fold, then number the rest from the folded file) gives the same file."""

    SEEDS = 500

    def test_random_orders(self):
        for seed in range(self.SEEDS):
            rng = random.Random(seed)
            step, fixes = rng.randint(1, 40), rng.randint(0, 5)
            start = f"# Changelog\n\nIntro.\n\n## 0.{step}.{fixes} (2026-10-01)\n\n- Start.\n"
            fragments = []
            for i in range(rng.randint(0, 14)):
                kind = rng.random()
                bump = "fix" if kind < 0.4 else "none" if kind < 0.75 else ("step", rng.randint(max(0, step - 2), step + 4))
                fragments.append(frag(f"pr{i}", bump, f"2026-10-{2 + i:02d}"))
            rng.shuffle(fragments)  # the order the queue happened to merge them in
            with self.subTest(seed=seed, order=fragments):
                text = numbered_text(start, fragments)
                self.assertEqual(check_changelog(text), [])  # newest first, no repeat, no skip
                for f in fragments:
                    self.assertEqual(text.count(f.text), 1)
                # The pull request folding them all passes check_pr: the order
                # it reads from the entries' places is the one they merged in.
                files = {"CHANGELOG.md": start}
                for f in fragments:
                    first = f.bump if isinstance(f.bump, str) else f"step {f.bump[1]}"
                    files[f"changelog.d/{f.name}.md"] = f"{first}\n\n{f.text}\n"
                diff = [("M", "CHANGELOG.md")] + [("D", f"changelog.d/{f.name}.md") for f in fragments]
                if fragments:
                    self.assertEqual(check_pr(diff, files.get, dict(files, **{"CHANGELOG.md": text}).get), [])
                _, sections = parse_changelog(text)
                expected_version, expected_new = model((0, step, fixes), [f.bump for f in fragments])
                self.assertEqual(sections[0].version, expected_version)
                self.assertEqual(len(sections) - 1, expected_new)
                k = rng.randint(0, len(fragments))
                folded = numbered_text(start, fragments[:k])
                self.assertEqual(numbered_text(folded, fragments[k:]), text)


class LeakGuard(unittest.TestCase):
    def test_a_plain_entry_is_clean(self):
        # A normal user-facing entry names no kernel internals.
        self.assertEqual(changelog.leaks("changelog.d/x.md",
                         "none\n\n- Extrude any flat face of a body, no sketch needed."), [])

    def test_a_rust_file_name_is_a_leak(self):
        # The public app is TypeScript, so any ".rs" file named in an entry is
        # the private kernel's; the guard must catch it and name the rule.
        problems = changelog.leaks("changelog.d/x.md", "fix\n\n- Fixed a crash in gearbox.rs.")
        self.assertEqual(len(problems), 1)
        self.assertIn("gearbox.rs", problems[0])
        self.assertIn("never how the kernel works", problems[0])

    def test_private_paths_and_internal_names_are_leaks(self):
        for text, tell in [
            ("none\n\n- Checked against prototypes/demo/model.py.", "prototypes/"),
            ("none\n\n- A change in kernel/src somewhere.", "kernel/src"),
            ("none\n\n- The facts table is now exact.", "facts table"),
            ("none\n\n- Fixed in the facts_model.", "facts_model"),
            ("none\n\n- The facts-table is now exact.", "facts-table"),
            ("none\n\n- The facts_table is now exact.", "facts_table"),
            ("none\n\n- A bug in spade no longer crashes arcs.", "spade"),
        ]:
            problems = changelog.leaks("changelog.d/x.md", text)
            self.assertTrue(problems, f"{tell!r} should be caught")

    def test_the_guard_catches_a_leaky_added_fragment_in_a_pr(self):
        # Same as a real PR: a clean entry passes, the same entry with a kernel
        # file name added fails with the leak message (a deliberate break).
        clean = check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: "none\n\n- Combine is faster.\n")
        self.assertEqual(clean, [])
        leaky = check_pr([("A", "changelog.d/new.md")], lambda p: "", lambda p: "none\n\n- Combine is faster (widget.rs).\n")
        self.assertEqual(len(leaky), 1)
        self.assertIn("widget.rs", leaky[0])


class CheckPr(unittest.TestCase):
    BASE = {"CHANGELOG.md": START, "changelog.d/old.md": "fix\n\n- Old fix.\n"}

    def run_check(self, diff, head):
        files = dict(self.BASE, **head)
        # An added fragment always has content on the head; default a clean one
        # for the tests that don't care about its text.
        for s, p in diff:
            if s == "A" and p.startswith("changelog.d/") and p.endswith(".md") and p not in files:
                files[p] = "none\n\n- A change.\n"
        return check_pr(diff, lambda p: self.BASE[p], lambda p: files[p])

    def test_one_new_fragment(self):
        self.assertEqual(self.run_check([("A", "changelog.d/new.md"), ("M", "kernel/src/lib.rs")], {}), [])

    def test_no_fragment(self):
        problems = self.run_check([("M", "kernel/src/lib.rs")], {})
        self.assertEqual(len(problems), 1)
        self.assertIn("add exactly one changelog.d/<name>.md", problems[0])

    def test_two_fragments(self):
        problems = self.run_check([("A", "changelog.d/a.md"), ("A", "changelog.d/b.md")], {})
        self.assertIn("not 2", problems[0])

    def test_readme_is_no_fragment(self):
        self.assertEqual(len(self.run_check([("A", "changelog.d/README.txt")], {})), 1)

    def test_merged_fragment_changed(self):
        problems = self.run_check([("A", "changelog.d/new.md"), ("M", "changelog.d/old.md")], {})
        self.assertEqual(problems, ["changelog.d/old.md is already on main, so its entry is fixed; "
                                    "add a new fragment instead of changing it"])

    def test_version_heading_written_by_hand(self):
        head = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Mine.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md")], {"CHANGELOG.md": head})
        self.assertIn("CHANGELOG.md gains the heading 0.32.22 (2026-10-28): don't write version headings", problems[0])
        self.assertEqual(len(problems), 2)  # and no fragment

    def test_old_entry_corrected(self):
        head = START.replace("- Older entry.", "- Older entry, typo fixed.")
        self.assertEqual(self.run_check([("M", "CHANGELOG.md"), ("A", "changelog.d/typo.md")], {"CHANGELOG.md": head}), [])

    def test_version_added_back(self):
        problems = self.run_check([("A", "changelog.d/new.md"), ("A", "VERSION")], {"VERSION": "0.32.22\n"})
        self.assertEqual(len(problems), 1)
        self.assertIn("don't add VERSION back", problems[0])

    def test_fold(self):
        head = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        self.assertEqual(self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": head}), [])

    def test_fold_writing_its_own_heading(self):
        # A fold of the one fix fragment from 0.32.21 can only give 0.32.22;
        # deleting a fragment used to switch the heading check off, so any
        # number passed.
        head = START.replace("## 0.32.21", "## 0.40.0 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": head})
        self.assertEqual(problems, ["CHANGELOG.md isn't what fold writes from main's: it has the heading 0.40.0 (2026-10-28) "
                                    "where fold writes 0.32.22 (2026-10-28); run changelog.py fold on a fresh main"])
        # The right fold with one more heading written by hand on top.
        head = START.replace("## 0.32.21", "## 0.32.23 (2026-10-28)\n\n- Mine.\n\n## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {"CHANGELOG.md": head})
        self.assertEqual(len(problems), 1)
        self.assertIn("it has the heading 0.32.23 (2026-10-28) where fold writes 0.32.22 (2026-10-28)", problems[0])

    def test_fold_of_two_in_their_order(self):
        # Worked by hand from 0.32.21: the entries' places say the order they
        # merged in (the oldest lowest). The fix, then step 33: 0.32.22 for
        # the fix, then 0.33.0 for the step, newest first.
        base = dict(self.BASE, **{"changelog.d/step.md": "step 33\n\n- Step.\n"})
        diff = [("M", "CHANGELOG.md"), ("D", "changelog.d/old.md"), ("D", "changelog.d/step.md")]
        good = START.replace("## 0.32.21", "## 0.33.0 (2026-10-28)\n\n- Step.\n\n## 0.32.22 (2026-10-27)\n\n- Old fix.\n\n## 0.32.21")
        self.assertEqual(check_pr(diff, base.get, dict(base, **{"CHANGELOG.md": good}).get), [])
        # Swapped numbers: with the step below (older), it gives 0.33.0 and
        # the fix after it 0.33.1, so 0.32.22 on top is wrong.
        bad = START.replace("## 0.32.21", "## 0.33.0 (2026-10-28)\n\n- Old fix.\n\n## 0.32.22 (2026-10-27)\n\n- Step.\n\n## 0.32.21")
        problems = check_pr(diff, base.get, dict(base, **{"CHANGELOG.md": bad}).get)
        self.assertEqual(len(problems), 1)
        self.assertIn("it has the heading 0.33.0 (2026-10-28) where fold writes 0.33.1 (2026-10-28)", problems[0])
        # A none entry joins the newest heading, at its top.
        base = dict(self.BASE, **{"changelog.d/old.md": "none\n\n- Old note.\n"})
        good = START.replace("- Old entry.", "- Old note.\n- Old entry.")
        diff = [("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")]
        self.assertEqual(check_pr(diff, base.get, dict(base, **{"CHANGELOG.md": good}).get), [])

    def test_fold_losing_an_entry(self):
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md")], {})
        self.assertEqual(problems, ["changelog.d/old.md is deleted but its entry isn't in CHANGELOG.md: only a fold deletes fragments"])

    def test_fragment_deleted_without_a_fold(self):
        problems = self.run_check([("D", "changelog.d/old.md")], {})
        self.assertIn("CHANGELOG.md isn't changed", problems[0])

    def test_fold_with_a_new_entry(self):
        head = START.replace("## 0.32.21", "## 0.32.22 (2026-10-28)\n\n- Old fix.\n\n## 0.32.21")
        problems = self.run_check([("M", "CHANGELOG.md"), ("D", "changelog.d/old.md"), ("A", "changelog.d/new.md")],
                                  {"CHANGELOG.md": head})
        self.assertEqual(len(problems), 1)
        self.assertIn("a fold only folds", problems[0])


class RealGit(unittest.TestCase):
    """The commands on real repositories: pull requests merged with merge
    commits (as the merge queue does), in an order unlike their names'."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "t")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "commit.gpgsign", "false")
        self.write("CHANGELOG.md", START)
        self.write("changelog.d/README.txt", "Fragments.\n")
        self.commit("start")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def git(self, *args, date="2026-10-28T10:00:00Z"):
        env = dict(os.environ, GIT_COMMITTER_DATE=date, GIT_AUTHOR_DATE=date)
        return subprocess.run(["git", "-C", self.dir, *args], check=True, capture_output=True, text=True, env=env).stdout

    def write(self, path, text):
        full = os.path.join(self.dir, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(text)

    def commit(self, message, date="2026-10-28T10:00:00Z"):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message, date=date)

    def branch(self, name, bump, base="main"):
        self.git("checkout", "-q", "-b", name, base)
        self.write(f"changelog.d/{name}.md", f"{bump}\n\n- Entry {name}.\n")
        self.commit(name)
        self.git("checkout", "-q", "main")

    def merge(self, name, date):
        self.git("merge", "-q", "--no-ff", "-m", f"Merge {name}", name, date=date)

    def run_script(self, *args):
        r = subprocess.run([sys.executable, SCRIPT, *args, self.dir], capture_output=True, text=True)
        return r.returncode, r.stdout

    def test_merge_order_not_name_order(self):
        # Three pull requests branch off the same main; they merge z, a, m.
        # z (fix) merged first: 0.32.22 on the 28th; a (fix) 0.32.23 on the
        # 29th; m (none) joins 0.32.23. By name they would be a, m, z.
        for name, bump in [("a", "fix"), ("m", "none"), ("z", "fix")]:
            self.branch(name, bump)
        self.merge("z", "2026-10-28T23:30:00Z")
        # a merges main in first (as threads do): z's fragment reaches a's
        # branch, but on main it was added by z's merge, not a's.
        self.git("checkout", "-q", "a")
        self.git("merge", "-q", "--no-ff", "-m", "Merge main into a", "main", date="2026-10-29T01:00:00Z")
        self.git("checkout", "-q", "main")
        self.merge("a", "2026-10-29T02:00:00Z")
        self.merge("m", "2026-10-29T03:00:00Z")
        code, out = self.run_script("show")
        self.assertEqual(code, 0, out)
        self.assertIn("""## 0.32.23 (2026-10-29)

- Entry m.
- Entry a.

## 0.32.22 (2026-10-28)

- Entry z.

## 0.32.21 (2026-10-27)""", out)
        self.assertEqual(self.run_script("version"), (0, "0.32.23\n"))

        # Fold, commit it as a pull request would, then one more fix merges:
        # the numbers before the fold stay, the new one follows on.
        code, out = self.run_script("fold")
        self.assertEqual((code, out), (0, "folded 3 fragment(s); the version is 0.32.23\n"))
        self.assertEqual(sorted(os.listdir(os.path.join(self.dir, "changelog.d"))), ["README.txt"])
        self.git("checkout", "-q", "-b", "fold")
        self.commit("fold")
        self.branch("b", "fix", base="main")
        self.merge("b", "2026-10-30T02:00:00Z")
        self.merge("fold", "2026-10-30T03:00:00Z")
        code, after = self.run_script("show")
        self.assertEqual(code, 0, after)
        self.assertTrue(after.startswith(START.split("## ")[0] + "## 0.32.24 (2026-10-30)\n\n- Entry b.\n\n## 0.32.23 (2026-10-29)"), after)
        self.assertEqual(self.run_script("check"), (0, "CHANGELOG.md and changelog.d/ are in order\n"))

    def test_fold_refuses_uncommitted_fragments(self):
        self.write("changelog.d/local.md", "fix\n\n- Not merged.\n")
        code, out = self.run_script("fold")
        self.assertEqual(code, 1)
        self.assertIn("not committed, so not merged yet: local.md", out)
        # show still previews it, last, dated today.
        code, out = self.run_script("show")
        self.assertIn("- Not merged.", out)

    def test_pr_command(self):
        self.branch("old", "fix")
        self.merge("old", "2026-10-28T12:00:00Z")
        self.git("checkout", "-q", "-b", "bad")
        self.write("changelog.d/old.md", "fix\n\n- Rewritten.\n")
        self.commit("rewrite a merged fragment")
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "bad", self.dir], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("changelog.d/old.md is already on main", r.stdout)
        self.git("checkout", "-q", "-b", "good", "main")
        self.branch("new", "none", base="good")
        r = subprocess.run([sys.executable, SCRIPT, "pr", "main", "new", self.dir], capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (0, "this pull request's changelog files are in order\n"))

    def test_check_refuses_a_bad_fragment(self):
        self.write("changelog.d/bad.md", "bugfix\n\n- x\n")
        code, out = self.run_script("check")
        self.assertEqual(code, 1)
        self.assertIn("changelog.d/bad.md: the first line must be 'fix', 'step N' or 'none'", out)


class RepositoryFiles(unittest.TestCase):
    """The real CHANGELOG.md and changelog.d/, on every PR by CI's kernel job."""

    def test_in_order(self):
        self.assertEqual(changelog.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()
