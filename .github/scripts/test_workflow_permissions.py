"""What each workflow may start on and may write: python3 -m unittest discover -s .github/scripts

A workflow's token and secrets are only as safe as what starts it. Ben chose
no required approvals on main (10-29), so this test is the guard instead: a
pull request that gives a workflow more power fails CI until the lists below
are changed in the same diff, where a reader sees it. It checks:
- every workflow sets `permissions:` at the top (a missing one means the
  repository's default, which can be write-all);
- each workflow's triggers are exactly the ones listed (a new
  pull_request_target or workflow_run is a token handed to outside code);
- every write permission is one listed for that job (less is always fine);
- every job's environment is the one listed, and no workflow a pull request's
  own code runs in (pull_request, merge_group) uses an environment, since the
  environments hold the engine's keys;
- a workflow started for someone else's pull request (pull_request_target,
  workflow_run) never checks out the pull request's code;
- no one-line `run:` holds ": " outside quotes, which YAML reads as a new
  key and GitHub refuses the whole file (this reader would not notice);
- every `pip install` takes exact files by hash (oracle-requirements.txt), so
  a package changed on PyPI never runs in a job that holds the engine's keys.

The workflows are read with a small indentation reader (the runner's Python
has no YAML library); its own tests are in ReaderTest."""

import glob
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WORKFLOWS = os.path.join(os.path.dirname(HERE), "workflows")

TRIGGERS = {
    "ai-eval.yml": {"pull_request", "workflow_dispatch"},
    "auto-merge.yml": {"pull_request_target", "schedule", "workflow_dispatch", "workflow_run"},
    "ci.yml": {"merge_group", "pull_request", "push", "schedule", "workflow_dispatch"},
    "fuzz.yml": {"schedule", "workflow_dispatch"},
    "kernel-ci.yml": {"workflow_dispatch"},
    "kernel-fuzz.yml": {"schedule", "workflow_dispatch"},
    "kernel-nightly.yml": {"schedule", "workflow_dispatch"},
    "nightly.yml": {"schedule", "workflow_dispatch"},
    "pages.yml": {"push", "workflow_dispatch"},
    "stop-testing.yml": {"pull_request_target"},
}

# (workflow, job) -> the scopes it may write; job "" is the workflow's own
# `permissions:`, which every job without its own inherits.
WRITES = {
    ("auto-merge.yml", ""): {"contents", "pull-requests", "issues", "actions"},
    ("fuzz.yml", "collect"): {"contents", "issues"},
    ("nightly.yml", "collect"): {"contents", "issues"},
    ("kernel-nightly.yml", "keys"): {"issues"},
    ("pages.yml", "deploy"): {"pages", "id-token"},
    ("stop-testing.yml", "cancel"): {"actions"},
}

ENVIRONMENTS = {
    ("auto-merge.yml", "merge"): "merge",
    ("fuzz.yml", "sessions-oracle"): "kernel",
    ("kernel-ci.yml", "checks"): "kernel",
    ("kernel-ci.yml", "coverage"): "kernel",
    ("kernel-ci.yml", "mutants-plan"): "kernel",
    ("kernel-ci.yml", "mutants-shard"): "kernel",
    ("kernel-ci.yml", "mutants"): "kernel",
    ("kernel-fuzz.yml", "plan"): "kernel",
    ("kernel-fuzz.yml", "stl"): "kernel",
    ("kernel-fuzz.yml", "kernel"): "kernel",
    ("kernel-fuzz.yml", "collect"): "kernel",
    ("kernel-nightly.yml", "plan"): "kernel",
    ("kernel-nightly.yml", "test"): "kernel",
    ("kernel-nightly.yml", "test-second-leg"): "kernel",
    ("kernel-nightly.yml", "mutants"): "kernel",
    ("kernel-nightly.yml", "collect"): "kernel",
    ("kernel-nightly.yml", "keys"): "kernel",
    ("nightly.yml", "golden-step"): "kernel",
    ("pages.yml", "deploy"): "github-pages",
}

PR_CODE = {"pull_request", "merge_group"}
FOR_OTHERS = {"pull_request_target", "workflow_run"}

KEY = re.compile(r"^( *)([A-Za-z0-9_-]+):(?:\s+(.*?))?\s*$")


def _value(raw):
    """A plain inline value without its comment or quotes, '' for none."""
    if raw is None:
        return ""
    raw = re.sub(r"\s+#.*$", "", raw).strip()
    return raw[1:-1] if len(raw) > 1 and raw[0] == raw[-1] and raw[0] in "'\"" else raw


def _inline_map(text):
    """`{}` or `{a: b, c: d}` as a dict; `read-all` and the like stay a string."""
    if not text.startswith("{"):
        return text
    body = text.strip("{} ")
    return dict((k.strip(), v.strip()) for k, v in (p.split(":", 1) for p in body.split(",") if p.strip()))


def read(text):
    """{'on': set of triggers, 'permissions': dict or str or None,
    'jobs': {job: {'permissions': ..., 'environment': str or None}}} from a workflow's text."""
    out = {"on": set(), "permissions": None, "jobs": {}}
    section = job = None
    sub = None  # the job key whose block is being read: 'permissions' or 'environment'
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        found = KEY.match(line)
        if not found:
            continue
        indent, key, raw = len(found.group(1)), found.group(2), found.group(3)
        value = _value(raw)
        if indent == 0:
            section, job, sub = key, None, None
            if key == "on" and value:
                out["on"] = {t.strip() for t in value.strip("[]").split(",") if t.strip()}
            elif key == "permissions":
                out["permissions"] = _inline_map(value) if value else {}
        elif section == "on" and indent == 2:
            out["on"].add(key)
        elif section == "permissions" and indent == 2:
            out["permissions"][key] = value
        elif section == "jobs" and indent == 2:
            job, sub = key, None
            out["jobs"][job] = {"permissions": None, "environment": None}
        elif section == "jobs" and job and indent == 4:
            sub = None
            if key == "permissions":
                out["jobs"][job]["permissions"] = _inline_map(value) if value else {}
                sub = None if value else "permissions"
            elif key == "environment":
                out["jobs"][job]["environment"] = value or None
                sub = None if value else "environment"
        elif section == "jobs" and job and indent == 6 and sub == "permissions":
            out["jobs"][job]["permissions"][key] = value
        elif section == "jobs" and job and indent == 6 and sub == "environment" and key == "name":
            out["jobs"][job]["environment"] = value
    return out


def writes(permissions):
    """The scopes a `permissions:` value writes; 'write-all' is every scope, shown as '*'."""
    if permissions is None:
        return set()
    if isinstance(permissions, str):
        return {"*"} if permissions == "write-all" else set()
    return {k for k, v in permissions.items() if v == "write"}


def problems(name, text):
    """Every way the workflow `name` with this text does more than the lists allow."""
    found = []
    flow = read(text)
    if flow["permissions"] is None:
        found.append(f"{name} has no top-level permissions: (the repository's default may be write-all)")
    if flow["on"] != TRIGGERS.get(name):
        found.append(f"{name} starts on {sorted(flow['on'])}, listed {sorted(TRIGGERS.get(name, set()))}")
    top = writes(flow["permissions"])
    extra = top - WRITES.get((name, ""), set())
    if extra:
        found.append(f"{name} writes {sorted(extra)} for every job")
    for job, spec in flow["jobs"].items():
        mine = writes(spec["permissions"]) if spec["permissions"] is not None else set()
        extra = mine - WRITES.get((name, job), set()) - WRITES.get((name, ""), set())
        if extra:
            found.append(f"{name} job {job} writes {sorted(extra)}")
        if spec["environment"] != ENVIRONMENTS.get((name, job)):
            found.append(f"{name} job {job} uses environment {spec['environment']}, listed {ENVIRONMENTS.get((name, job))}")
        if spec["environment"] and flow["on"] & PR_CODE:
            found.append(f"{name} job {job} uses environment {spec['environment']} in a workflow a pull request's code runs in")
    if flow["on"] & FOR_OTHERS:
        for ref in re.findall(r"^\s+ref:\s*(.+)$", text, re.M):
            if "github.event" in ref or "head" in ref:
                found.append(f"{name} checks out {ref.strip()} in a workflow started for someone else's pull request")
    for number, line in enumerate(text.splitlines(), 1):
        plain = re.match(r"^\s*(?:-\s+)?run:\s+([^|>'\"\s].*)$", line)
        if plain and re.search(r":(\s|$)", re.sub(r"\s+#.*$", "", plain.group(1))):
            found.append(f"{name}:{number} has a one-line run: with ': ' in it, which isn't valid YAML (use run: |)")
        if re.search(r"\bpip3? install\b", line) and "--require-hashes" not in line:
            found.append(f"{name}:{number} installs Python packages without --require-hashes")
    return found


class ReaderTest(unittest.TestCase):
    """The reader and the checker, on small workflows worked out by hand."""

    SAFE = "\n".join(
        [
            "name: x",
            "on:",
            "  pull_request:",
            "    types: [opened]",
            "  workflow_dispatch:",
            "permissions:",
            "  contents: read  # only reads",
            "jobs:",
            "  a:",
            "    runs-on: ubuntu-latest",
            "    steps:",
            "      - run: |",
            "          echo permissions:",
            "  b:",
            "    permissions: {contents: write}",
            "    environment:",
            "      name: kernel",
        ]
    )

    def test_the_reader_finds_triggers_permissions_and_environments(self):
        # By hand: two keys under on:, one read under the top permissions:,
        # job a has neither (its run text is deeper than a job key), job b
        # has an inline map and an environment in block form.
        flow = read(self.SAFE)
        self.assertEqual(flow["on"], {"pull_request", "workflow_dispatch"})
        self.assertEqual(flow["permissions"], {"contents": "read"})
        self.assertEqual(flow["jobs"]["a"], {"permissions": None, "environment": None})
        self.assertEqual(flow["jobs"]["b"], {"permissions": {"contents": "write"}, "environment": "kernel"})

    def test_inline_forms(self):
        self.assertEqual(read("on: [push, pull_request]\npermissions: {}\n")["on"], {"push", "pull_request"})
        self.assertEqual(read("on: push\npermissions: {}\n")["permissions"], {})
        self.assertEqual(writes(read("on: push\npermissions: write-all\n")["permissions"]), {"*"})

    def _only(self, text, name="stop-testing.yml"):
        return problems(name, text)

    def test_a_listed_workflow_passes(self):
        text = "on:\n  pull_request_target:\npermissions: {}\njobs:\n  cancel:\n    permissions:\n      actions: write\n"
        self.assertEqual(self._only(text), [])

    def test_each_kind_of_extra_power_is_caught(self):
        base = "on:\n  pull_request_target:\npermissions: {}\njobs:\n  cancel:\n    permissions:\n      actions: write\n"
        cases = {
            "no top-level permissions": base.replace("permissions: {}\n", ""),
            "starts on": base.replace("  pull_request_target:\n", "  pull_request_target:\n  workflow_run:\n"),
            "for every job": base.replace("permissions: {}", "permissions: write-all"),
            "job cancel writes ['contents']": base + "      contents: write\n",
            "uses environment kernel, listed None": base + "    environment: kernel\n",
            "isn't valid YAML": base + "    steps:\n      - run: pip install --require-hashes --only-binary=:all: -r r.txt\n",
            "without --require-hashes": base + "    steps:\n      - run: pip install -q mpmath\n",
            "checks out": base + "    steps:\n      - uses: actions/checkout\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n",
        }
        for why, text in cases.items():
            with self.subTest(why):
                self.assertTrue(any(why in p for p in self._only(text)), self._only(text))

    def test_an_environment_in_a_pull_requests_own_run_is_caught(self):
        # ci.yml runs the pull request's code: even a listed environment there would hand it the keys.
        text = "on:\n  pull_request:\n  push:\n  merge_group:\n  schedule:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  app:\n    environment: kernel\n"
        self.assertTrue(any("a pull request's code runs in" in p for p in problems("ci.yml", text)))

    def test_less_power_is_fine(self):
        text = "on:\n  pull_request_target:\npermissions: {}\njobs:\n  cancel:\n    permissions:\n      actions: read\n"
        self.assertEqual(self._only(text), [])


class WorkflowsTest(unittest.TestCase):
    def test_every_workflow_is_listed_and_within_its_lists(self):
        paths = sorted(glob.glob(os.path.join(WORKFLOWS, "*.yml")))
        names = {os.path.basename(p) for p in paths}
        self.assertEqual(names, set(TRIGGERS), "a workflow was added or removed: list its triggers here")
        found = []
        for path in paths:
            with open(path) as f:
                found += problems(os.path.basename(path), f.read())
        self.assertEqual(found, [])

    def test_the_live_site_is_built_from_main_alone_without_a_cache(self):
        # Pages publishes what its build job builds: a run started by hand on
        # another branch must build nothing, and npm must not restore a cache
        # some other run saved.
        with open(os.path.join(WORKFLOWS, "pages.yml")) as f:
            text = f.read()
        build = text.split("\n  build:\n", 1)[1].split("\n  deploy:\n", 1)[0]
        self.assertIn("    if: github.ref == 'refs/heads/main'\n", build)
        self.assertNotRegex(build, r"\bcache\b")
        self.assertIn("group: pages-${{ github.ref }}", text, "another branch's run would cancel main's deploy")


if __name__ == "__main__":
    unittest.main()
