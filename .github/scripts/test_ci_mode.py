"""Tests for ci_mode.py and the rules ci.yml's jobs keep: python3 -m unittest discover -s .github/scripts"""

import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ci_mode  # noqa: E402
from ci_mode import decide, docs_only, is_docs, read_group_files, touches_ui  # noqa: E402

WORKFLOWS = os.path.join(os.path.dirname(HERE), "workflows")
ROOT = os.path.dirname(os.path.dirname(HERE))
CODE = (".ts", ".tsx", ".mjs", ".cjs", ".js", ".py", ".sh", ".yml", ".yaml", ".json", ".toml", ".html")
# ci_mode itself and these tests name docs paths without reading them.
NOT_READERS = {".github/scripts/ci_mode.py", ".github/scripts/test_ci_mode.py"}
SKIP_DIRS = {".git", "node_modules", "target", "dist", "docs", "changelog.d"}


def docs_paths_in_code(root):
    """(file, path) for every docs/ path in quotes (or after ../) in a code
    file under root, and (file, "docs") for a "docs" folder in quotes."""
    found = []
    for top, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(names):
            where = os.path.relpath(os.path.join(top, name), root).replace(os.sep, "/")
            if not name.endswith(CODE) or where in NOT_READERS:
                continue
            try:
                text = open(os.path.join(top, name), encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            found += [(where, m) for m in re.findall(r"""[\"'`](?:\.\.?/)*(docs/[A-Za-z0-9_./-]+)""", text)]
            found += [(where, "docs") for _ in re.findall(r"""[\"'](?:\.\.?/)*docs/?[\"']""", text)]
    return found
QUEUE = [dict(type="deletion"), dict(type="required_status_checks"), dict(type="merge_queue")]
NO_QUEUE = QUEUE[:-1]


class Mode(unittest.TestCase):
    def test_worked_by_hand(self):
        # A pull request while main requires the queue, changing a sketch file:
        # quick (the queue runs it in full before merging), with Firefox and WebKit.
        self.assertEqual(decide("pull_request", QUEUE, ["workspaces/design/src/sketch.ts"]), (False, True, False))
        # The same without the queue rule: its own run is the last test before main, so full.
        self.assertEqual(decide("pull_request", NO_QUEUE, ["workspaces/design/src/sketch.ts"]), (True, True, False))
        # A kernel-only pull request: no Firefox and WebKit. The progress file
        # is docs, but boolean.rs isn't, so not docs only.
        self.assertEqual(decide("pull_request", QUEUE, ["kernel/src/boolean.rs", "docs/progress/cad.md"]), (False, False, False))
        # The queue's own run, main's daily run and a run by hand: always full.
        for event in ("merge_group", "schedule", "push", "workflow_dispatch"):
            self.assertEqual(decide(event, None, None), (True, True, False), event)
            self.assertEqual(decide(event, QUEUE, ["kernel/src/a.rs"]), (True, True, False), event)

    def test_doubt_means_more_testing(self):
        # Rules unreadable: full. Files unreadable: browsers run, and not docs only.
        self.assertEqual(decide("pull_request", None, ["kernel/src/a.rs"]), (True, False, False))
        self.assertEqual(decide("pull_request", QUEUE, None), (False, True, False))
        self.assertEqual(decide("merge_group", None, None), (True, True, False))

    def test_ui_files(self):
        for f in ("apps/fission/src/main.ts", "packages/ui/src/styles/x.css", "workspaces/image/src/a.ts",
                  "package.json", "package-lock.json", ".github/workflows/ci.yml", ".github/scripts/install-browser.sh"):
            self.assertTrue(touches_ui([f]), f)
        for f in ("kernel/src/a.rs", "docs/roadmap.md", "prototypes/x.py", ".github/scripts/automerge.py",
                  "tests/baseline.json", "CLAUDE.md", "apps", "xapps/a.ts", ".github/workflows/nightly.yml"):
            self.assertFalse(touches_ui([f]), f)
        self.assertTrue(touches_ui(["kernel/src/a.rs", "apps/fission/index.html"]))
        self.assertFalse(touches_ui([]))


class Docs(unittest.TestCase):
    def test_worked_by_hand(self):
        # A notes edit with its changelog: every file is writing no code
        # reads, so docs only, in the pull request's run and the queue's.
        roadmap = ["docs/integration.md", "docs/progress/booleans.md", "changelog.d/x1-roadmap.md"]
        self.assertEqual(decide("pull_request", QUEUE, roadmap), (False, False, True))
        self.assertEqual(decide("merge_group", None, roadmap), (True, True, True))
        # A package's CLAUDE.md starts with packages/ (so `ui` says yes) but is
        # still only notes: docs only.
        self.assertEqual(decide("pull_request", QUEUE, ["packages/core/CLAUDE.md"]), (False, True, True))
        # The same roadmap edit queued behind a kernel change: the group's
        # files hold both, so the group is tested in full.
        self.assertEqual(decide("merge_group", None, roadmap + ["kernel/src/boolean.rs"]), (True, True, False))
        # Main's daily run and pushes are never docs only, whatever changed.
        for event in ("schedule", "push", "workflow_dispatch"):
            self.assertEqual(decide(event, QUEUE, roadmap)[2], False, event)

    def test_docs_files(self):
        for f in ("docs/integration.md", "docs/progress/booleans.md", "docs/a/b/picture.png", "CHANGELOG.md", "README.md",
                  "VERSION", "changelog.d/ev4faw-version-bot.md", "changelog.d/README.txt", "CLAUDE.md",
                  "kernel/CLAUDE.md", "workspaces/image/CLAUDE.md", "training/CLAUDE.md"):
            self.assertTrue(is_docs(f), f)
        # Near misses: the wrong case, no slash after docs, a lookalike name or
        # folder, a README or changelog that isn't the root one, anything a
        # build or test reads (baseline.json, package.json, the workflows,
        # an e2e helper), and paths that climb out of docs/.
        for f in ("Docs/roadmap.md", "docs", "docs.md", "xdocs/a.md", "kernel/docs/a.rs", "apps/docs/x.ts",
                  "NOTCLAUDE.md", "CLAUDE.md.bak", "claude.md", "kernel/fuzz/README.md", "packages/CHANGELOG.md",
                  "VERSION.txt", "kernel/VERSION", "changelog.d", "kernel/changelog.d/a.md",
                  "changelog.d/../kernel/a.rs", "tests/baseline.json", "package.json", "package-lock.json",
                  ".github/workflows/ci.yml", ".github/scripts/ci_mode.py", "apps/fission/e2e/helpers.mjs",
                  "kernel/src/boolean.rs", "docs/../kernel/src/a.rs", "../docs/a.md", "/docs/a.md", "",
                  # Read by a test (coming-soon.test.ts), so the app job must run.
                  "docs/roadmap.md", "docs/progress/cad.md"):
            self.assertFalse(is_docs(f), f)

    def test_a_docs_file_a_test_reads_is_code(self):
        # By hand: coming-soon.test.ts fails once a Coming soon tool's step is
        # ticked in docs/progress/cad.md (or vanishes from docs/roadmap.md), so
        # a pull request that only ticks a step there must still run npm test,
        # or main breaks on the next code change.
        self.assertEqual(decide("pull_request", QUEUE, ["docs/progress/cad.md", "changelog.d/x.md"]), (False, False, False))
        self.assertEqual(decide("merge_group", None, ["docs/roadmap.md"]), (True, True, False))

    def test_every_docs_path_the_code_reads_is_code(self):
        # Kept from going stale: every quoted docs/ path in the repo's code,
        # tests, scripts and workflows (not its writing) must not count as
        # docs, and a "docs" folder joined in pieces needs a look by hand.
        found = docs_paths_in_code(ROOT)
        self.assertIn(("workspaces/design/test/coming-soon.test.ts", "docs/roadmap.md"), found)
        for where, path in found:
            with self.subTest(file=where, path=path):
                self.assertNotEqual(path, "docs", f"{where} joins the docs folder in pieces: list what it reads in ci_mode.READ_BY_CODE")
                self.assertFalse(is_docs(path), f"{where} reads {path}: add it to ci_mode.READ_BY_CODE")

    def test_the_docs_path_scan_can_fail(self):
        # A planted reader in a scratch repo: each form is found.
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "apps/x"))
            os.makedirs(os.path.join(tmp, "docs"))
            with open(os.path.join(tmp, "apps/x/a.test.ts"), "w") as f:
                f.write('readFileSync(new URL("../../docs/integration.md", repo));\njoin(root, "docs", "ai.md");\n// see docs/x.md\n')
            with open(os.path.join(tmp, "docs/notes.md"), "w") as f:
                f.write('`docs/roadmap.md`\n')
            found = docs_paths_in_code(tmp)
        # The comment without quotes and the writing under docs/ are not readers.
        self.assertEqual(found, [("apps/x/a.test.ts", "docs/integration.md"), ("apps/x/a.test.ts", "docs")])
        self.assertTrue(is_docs("docs/integration.md"))

    def test_any_other_file_or_doubt_means_no(self):
        self.assertTrue(ci_mode.docs_only(["docs/integration.md"]))
        self.assertFalse(ci_mode.docs_only(["docs/integration.md", "tests/baseline.json"]))
        self.assertFalse(ci_mode.docs_only(["package.json", "docs/integration.md"]))
        # No files (an empty diff) and unlisted files: test in full.
        self.assertFalse(ci_mode.docs_only([]))
        self.assertFalse(ci_mode.docs_only(None))

    def test_a_rename_out_of_code_is_code(self):
        # GitHub lists a rename once, with its old path as previous_filename;
        # read_files keeps both, so moving kernel code into docs/ is not docs only.
        page = [dict(filename="docs/old.rs", previous_filename="kernel/src/old.rs"), dict(filename="docs/roadmap.md")]
        with mock.patch.object(ci_mode, "get", return_value=page):
            files = ci_mode.read_files(1)
        self.assertEqual(files, ["docs/old.rs", "kernel/src/old.rs", "docs/roadmap.md"])
        self.assertFalse(docs_only(files))

    def test_the_docs_tests_can_fail(self):
        # Planted breaks, each the mistake a near-miss case above is there to
        # catch: the slash after docs dropped, any .md taken as docs, the
        # emptiness check dropped, the files a test reads forgotten. Each must make test_docs_files or
        # test_any_other_file_or_doubt_means_no fail.
        plants = [
            ("DOCS_PREFIXES", ("docs",)),
            ("DOCS_NAME", ".md"),
            ("READ_BY_CODE", ()),
        ]
        for name, value in plants:
            with self.subTest(plant=name), mock.patch.object(ci_mode, name, value):
                with self.assertRaises(AssertionError):
                    self.test_docs_files()
        with mock.patch.object(ci_mode, "docs_only", lambda files: all(ci_mode.is_docs(f) for f in files or [])):
            with self.assertRaises(AssertionError):
                self.test_any_other_file_or_doubt_means_no()
        # And unplanted, both pass.
        self.test_docs_files()
        self.test_any_other_file_or_doubt_means_no()


class GroupFiles(unittest.TestCase):
    def git(self, cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

    def test_a_group_lists_every_change_against_main(self):
        # A real repository as origin: main, then a queue group of a docs edit
        # and a renamed kernel file. The clone, like ci.yml's sparse checkout,
        # has neither commit until read_group_files fetches them.
        with tempfile.TemporaryDirectory() as tmp:
            origin, clone = os.path.join(tmp, "origin"), os.path.join(tmp, "clone")
            os.makedirs(os.path.join(origin, "kernel/src"))
            self.git(tmp, "init", "-q", "-b", "main", origin)
            for k, v in (("user.name", "t"), ("user.email", "t@t"), ("uploadpack.allowFilter", "true"),
                         ("uploadpack.allowAnySHA1InWant", "true")):
                self.git(origin, "config", k, v)
            open(os.path.join(origin, "kernel/src/a.rs"), "w").write("fn a() {}\n")
            os.makedirs(os.path.join(origin, "docs"))
            open(os.path.join(origin, "docs/roadmap.md"), "w").write("old\n")
            self.git(origin, "add", ".")
            self.git(origin, "commit", "-qm", "main")
            base = self.git(origin, "rev-parse", "HEAD")
            self.git(origin, "checkout", "-qb", "group")
            open(os.path.join(origin, "docs/roadmap.md"), "w").write("new\n")
            self.git(origin, "mv", "kernel/src/a.rs", "docs/a.rs")
            self.git(origin, "commit", "-qam", "group")
            head = self.git(origin, "rev-parse", "HEAD")
            self.git(origin, "checkout", "-q", "main")
            self.git(tmp, "init", "-q", clone)
            self.git(clone, "remote", "add", "origin", "file://" + origin)
            cwd = os.getcwd()
            os.chdir(clone)
            try:
                files = read_group_files(base, head)
                # A commit that doesn't exist: doubt, so None (full CI).
                missing = read_group_files(base, "0" * 40)
            finally:
                os.chdir(cwd)
        # By hand: roadmap.md changed; a.rs moved, which --no-renames lists as
        # its deletion and its addition. Sorted by path, as git diff lists them.
        self.assertEqual(files, ["docs/a.rs", "docs/roadmap.md", "kernel/src/a.rs"])
        self.assertFalse(docs_only(files))
        self.assertIsNone(missing)


def jobs(path):
    """Each top-level job's name and its block of lines, read without a YAML library."""
    text = open(path).read()
    body = text.split("\njobs:\n", 1)[1]
    found = re.split(r"^  ([A-Za-z0-9_-]+):\n", body, flags=re.M)
    return dict(zip(found[1::2], found[2::2]))


class Workflows(unittest.TestCase):
    def test_every_job_has_a_timeout(self):
        # A hung job holds a runner for GitHub's six hours; every job says its own limit.
        names = sorted(f for f in os.listdir(WORKFLOWS) if f.endswith(".yml"))
        self.assertIn("ci.yml", names)
        for name in names:
            for job, block in jobs(os.path.join(WORKFLOWS, name)).items():
                with self.subTest(workflow=name, job=job):
                    self.assertRegex(block, r"(?m)^    timeout-minutes: \d+$")

    def test_the_timeout_check_can_fail(self):
        planted = "name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n  b:\n    runs-on: ubuntu-latest\n"
        path = os.path.join(os.environ.get("TMPDIR", "/tmp"), "planted-workflow.yml")
        with open(path, "w") as f:
            f.write(planted)
        found = jobs(path)
        self.assertRegex(found["a"], r"(?m)^    timeout-minutes: \d+$")
        self.assertNotRegex(found["b"], r"(?m)^    timeout-minutes: \d+$")

    def test_required_checks_never_skip_on_a_failed_mode(self):
        # A skipped job counts as passed for main's ruleset, so a required job
        # that needs `mode` must still run when `mode` fails, and the steps it
        # drops in a quick run only drop on an explicit 'false'.
        ci = jobs(os.path.join(WORKFLOWS, "ci.yml"))
        self.assertIn("if: ${{ !cancelled() }}", ci["kernel"])
        self.assertNotIn("full == 'true'", ci["kernel"])
        self.assertIn("if: always()", ci["e2e"])
        self.assertIn('if [ "$FULL" = false ]', ci["e2e"])
        self.assertIn("needs.mode.outputs.full != 'false'", ci["e2e-shard"])
        self.assertIn("merge_group:", open(os.path.join(WORKFLOWS, "ci.yml")).read())

    def test_docs_only_skips_only_on_an_explicit_true(self):
        # Every job that drops work for docs only drops it on docs == 'true',
        # never on a missing answer (a failed mode job), and the jobs main's
        # ruleset requires still report: kernel runs the CI scripts' tests
        # and the kernel build check unconditionally, e2e passes on docs only,
        # and mutants-in-diff always passes (the kernel's mutation testing is
        # in its own repo since 2026-10-27).
        text = open(os.path.join(WORKFLOWS, "ci.yml")).read()
        ci = jobs(os.path.join(WORKFLOWS, "ci.yml"))
        self.assertNotIn("docs == 'true'", text)
        self.assertNotIn("docs != 'false'", text)
        self.assertIn("docs: ${{ steps.mode.outputs.docs }}", ci["mode"])
        self.assertIn("GROUP_BASE: ${{ github.event.merge_group.base_sha }}", ci["mode"])
        self.assertIn("GROUP_HEAD: ${{ github.event.merge_group.head_sha }}", ci["mode"])
        self.assertNotIn("docs", ci["kernel"])
        self.assertRegex(ci["kernel"], r"- run: python3 -m unittest discover -s \.github/scripts\n      - ")
        self.assertIn("run: python3 .github/scripts/check_kernel_build.py", ci["kernel"])
        for job in ("app", "baseline", "e2e-shard", "e2e-quick", "browsers", "phone"):
            self.assertIn("needs.mode.outputs.docs != 'true'", ci[job], job)
            self.assertIn("mode", re.search(r"needs: (.*)", ci[job]).group(1), job)
        for job in ("app", "baseline", "e2e-shard", "browsers", "phone"):
            self.assertIn("!cancelled()", ci[job], job)
        self.assertIn('if [ "$DOCS" = true ]; then', ci["e2e"])
        self.assertIn("if: always()", ci["mutants-in-diff"])
        self.assertEqual(re.search(r"needs: (.*)", ci["mutants-in-diff"]).group(1), "mode")

    def test_a_draft_skips_only_reported_checks_and_never_looks_ready(self):
        # A draft's run skips phone and browsers, and marks itself with the
        # check automerge.py waits out (DRAFT); marking it ready must start a
        # new run (ready_for_review), or the head would wait forever. Moving
        # it back to draft cancels its run (same group) and the heavy jobs
        # skip only on that explicit action, never on a missing answer.
        sys.path.insert(0, HERE)
        import automerge  # noqa: E402
        text = open(os.path.join(WORKFLOWS, "ci.yml")).read()
        ci = jobs(os.path.join(WORKFLOWS, "ci.yml"))
        types = re.search(r"(?m)^  pull_request:\n    types: \[(.*)\]$", text).group(1).split(", ")
        for t in ("opened", "synchronize", "reopened", "ready_for_review", "converted_to_draft"):
            self.assertIn(t, types)
        self.assertIn(f"name: {automerge.DRAFT}\n", ci["draft"])
        self.assertIn("if: github.event_name == 'pull_request' && github.event.pull_request.draft\n", ci["draft"])
        self.assertNotIn("needs:", ci["draft"])
        for job in ("browsers", "phone"):
            self.assertIn("&& !github.event.pull_request.draft }}", ci[job], job)
        for job in ("app", "baseline", "e2e-shard", "e2e-quick"):
            self.assertIn("github.event.action != 'converted_to_draft'", ci[job], job)
            self.assertNotIn("pull_request.draft", ci[job], job)
        self.assertNotIn("draft", ci["kernel"] + ci["mutants-in-diff"])
        self.assertIn("DRAFTED: ${{ github.event.action == 'converted_to_draft' }}", ci["e2e"])
        self.assertNotIn("push:", text.split("\njobs:\n")[0])

    def test_random_testing_and_fuzzing_wait_for_idle_ci(self):
        # Every job of these workflows starts after `idle` (directly or through
        # a job that needs it), which waits for no CI job queued and no merge
        # queue run (branch_testing.py wait-idle); the kernel's coverage
        # report runs only for main's runs.
        for name in ("nightly.yml", "kernel-nightly.yml", "fuzz.yml", "kernel-fuzz.yml"):
            found = jobs(os.path.join(WORKFLOWS, name))
            self.assertRegex(found["idle"], r"run: python3 \.github/scripts/branch_testing\.py wait-idle \S+", name)
            self.assertNotIn("needs:", found["idle"], name)
            for job, block in found.items():
                if job != "idle":
                    with self.subTest(workflow=name, job=job):
                        self.assertRegex(block, r"(?m)^    needs: ")
        kernel = jobs(os.path.join(WORKFLOWS, "kernel-ci.yml"))
        self.assertIn("    if: inputs.label == 'main'\n", kernel["coverage"])
        self.assertIn("run-name: Kernel CI ${{ inputs.label }}\n", open(os.path.join(WORKFLOWS, "kernel-ci.yml")).read())


if __name__ == "__main__":
    unittest.main()
