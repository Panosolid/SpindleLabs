"""Tests for file_issues.py: python3 -m unittest discover -s .github/scripts"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from file_issues import MARK, MAX_NEW, OVERFLOW, cap, check_kinds, devious_kinds, fuzz_kinds, gather, golden_kinds, harness_kinds, key, kinds_of, oracle_kinds, plan, read_folders, texts, MAX_EXAMPLE  # noqa: E402

# Lines copied from real reports on the test-results branch.
ROTATE_A = ("  seed 0x12849982fbf1: step 3 (Rotate { target: 1, pivot: [0.0, 0.0, 0.0], axis: [1.0, 0.0, 0.0], "
            "angle: -1.1000000000000001e-9 }): a vertex's distance to the pivot changed 0.7070990051357552 "
            "→ 0.7070990047468506 (minimal chain: 3 ops)")
ROTATE_B = ("  seed 0xf5514195a283: step 3 (Rotate { target: 1, pivot: [0.0, 0.0, -14.500011], axis: [1.0, 0.0, 0.0], "
            "angle: 3.9269908169872414 }): a vertex's distance to the pivot changed 14.577390679865436 "
            "→ 14.577390683031327 (minimal chain: 3 ops)")
ADD = ("  seed 0x74ed8ceb85a8: step 1 (Add { shape: Extrude { outer: Path { pts: [[0.0, 0.0], [0.5, 0.0]], "
       "bulges: [0.0, 1100000.0] }, holes: [], dist: 0.5, expect: Some(false) }, axis: [1.0, 0.0, 0.0], angle: 0.0, "
       "at: [0.0, 0.0, 0.0] }): sizes valid = false but kernel accepted (minimal chain: 1 ops)")
STL = ("  seed 0xea1bdc4749b2: step 1 (STL round trip of shape 0): STL mesh not closed after reading back: "
       "2 problems (minimal chain: 1 ops)")

DISAGREE = """line 276: {"Extrude": {"dist": "66.0", "expect": null, "holes": [], "outer": {"Path": {"bulges": [], "pts": [["0", "0"], ["1", "0"], ["1", "1"]]}}}}
  exact volume: fission 31.876169934868813, occ 31.87618745235322, allowed 1.56e-07
  bounds x: fission 1.0, occ 1.1
line 300: {"Extrude": {"dist": "1.0", "expect": null, "holes": [], "outer": {"Path": {"bulges": ["0.0", "1.0", "0.0"], "pts": [["0", "0"], ["1", "0"], ["1", "1"]]}}}}
  bounds highest y: fission 1.0, occ 1.1
occ-rounding, line 301: {"Box": {"w": "1.0", "d": "1.0", "h": "1.0"}}
  exact volume: fission 1.0, occ 1.1, exact 1.0, allowed 1e-09
"""


class Kinds(unittest.TestCase):
    def test_harness_kind_is_the_operation_and_the_message_without_numbers(self):
        # Worked by hand from the line: the op is "Rotate", the message after
        # "): " with each number replaced by # and the chain length dropped.
        want = "harness, Rotate: a vertex's distance to the pivot changed # → #"
        self.assertEqual([k for k, _ in harness_kinds(ROTATE_A)], [want])
        # A different angle and pivot is the same kind; the example is the line.
        self.assertEqual(harness_kinds(ROTATE_B)[0], (want, ROTATE_B.strip()))
        self.assertEqual(harness_kinds(ADD)[0][0], "harness, Add Extrude: sizes valid = false but kernel accepted")
        self.assertEqual(harness_kinds(STL)[0][0],
                         "harness, STL round trip of shape: STL mesh not closed after reading back: # problems")
        self.assertEqual(harness_kinds("Failures: 0\nPer operation ...\n"), [])

    def test_oracle_kinds(self):
        kinds = [k for k, _ in oracle_kinds(DISAGREE)]
        # bounds x and bounds highest y are one check; the second profile has an
        # arc; the occ-rounding block (only OpenCascade off) is no kind.
        self.assertEqual(kinds, ["OpenCascade disagrees, Extrude: exact volume",
                                 "OpenCascade disagrees, Extrude: bounds",
                                 "OpenCascade disagrees, Extrude with arcs: bounds"])
        self.assertEqual(oracle_kinds("oracle crashed\n")[0][0], "OpenCascade oracle crashed")
        # An unreadable shape is still reported.
        self.assertEqual(oracle_kinds("line 1: {nonsense\n  faces: fission 6, occ 5\n")[0][0],
                         "OpenCascade disagrees, ?: faces")

    def test_step_file_kinds(self):
        # Step 29b2's checks of each body's STEP file are kinds of their own
        # (the copy in brackets is part of the details, not the kind); a
        # body under OpenCascade's small-feature limit, listed in an
        # occ-rounding block, is none.
        text = ('line 7: {"Box": {"w": "1.0", "d": "1.0", "h": "1.0"}}\n'
                "  step validity: BRepCheck: invalid (faces [0], counted in file order) (as written)\n"
                "  step write refused: only a valid body can be written to STEP: face 0 (as written)\n"
                'occ-rounding, line 8: {"Cylinder": {"r": "0.001", "h": "3.0"}}\n'
                "  OpenCascade's small-feature limit: step validity: BRepCheck: invalid (blown up 1024 times)\n")
        self.assertEqual([k for k, _ in oracle_kinds(text)], ["OpenCascade disagrees, Box: step validity",
                                                             "OpenCascade disagrees, Box: step write refused"])

    def test_devious_kinds(self):
        # Issue #315: devious_random's failures (devious-output.txt, beside
        # a harness report that passed) were filed as a harness crash. A
        # failing case is a kind of its own, numbers and the part's name
        # taken out, so the same wrong verdict on another seed is one kind.
        line_a = ("case 882 (FISSION_SEED=249373476819941 FISSION_DEVIOUS_CASE=882), case-882-from-random-16: refused: "
                  "line 1 must be between 0.001 and 1000000 mm long, got 1007141.2976170945; expected Builds")
        line_b = ("case 2873 (FISSION_SEED=69405559697056 FISSION_DEVIOUS_CASE=2873), case-2873-from-bens-part-huge-0.999: "
                  "refused: line 2 must be between 0.001 and 1000000 mm long, got 1000953.2184887282; expected Builds")
        out = ("running 1 test\nthread 'devious_random' panicked at tests/widget.rs:272:5:\n1 of 3000 devious cases failed:\n"
               + line_a + "\n  made by: scaled ×2.4e2\n  part: Part { .. }\ndevious_random --- FAILED\n")
        got = devious_kinds(out)
        self.assertEqual([k for k, _ in got], ["devious part refused: line # must be between # and # mm long, got #; expected Builds"])
        self.assertIn("FISSION_DEVIOUS_CASE=882", got[0][1])
        self.assertEqual(devious_kinds(line_b)[0][0], got[0][0])
        # Beside a report with no failures, it is the folder's only kind.
        folder = kinds_of({"report.txt": "Stateful kernel test: 2016 cases\nFailures: 0\n", "harness-output.txt": "ok\n",
                           "devious-output.txt": out})
        self.assertEqual(list(folder), [got[0][0]])
        # A starting part the model and the kernel measure differently is a kind too.
        dis = "bens-part-x2: the kernel refuses it below a thinnest feature of 1e-3 mm, the model measures 1.2e-3 mm\n"
        self.assertEqual([k for k, _ in devious_kinds("1 of 300 devious cases failed:\n" + dis)],
                         ["devious generator: the kernel and the model measure a starting part's thinnest feature differently"])
        # A devious run that died without naming a case still says so.
        self.assertEqual([k for k, _ in devious_kinds("thread 'devious_random' panicked at tests/widget.rs:244:5:\nonly 3 bases built\n")],
                         ["devious generator crashed"])
        # Its issue says how to replay a devious case, not a stateful chain.
        title, body = texts("create", got[0][0], [("249373476819941", got[0][1])], "https://run", "abc", "main")
        self.assertTrue(title.startswith("Devious parts: refused: line #"), title)
        self.assertIn("--test devious devious_random", body)
        # A passing run is no kind.
        self.assertEqual(devious_kinds("devious generator, seed 1, 48 bases: {}\ntest result: ok. 1 passed\n"), [])

    def test_a_crash_without_a_report_is_a_kind(self):
        got = kinds_of({"harness-output.txt": "running 1 test\nthread panicked at src/x.rs:1\nerror: test failed\n"})
        self.assertEqual(list(got), ["harness crashed without a report"])
        self.assertIn("panicked", got["harness crashed without a report"])

    def test_one_kind_per_folder_once(self):
        got = kinds_of({"report.txt": ROTATE_A + "\n" + ROTATE_B + "\n", "oracle-disagreements.txt": DISAGREE})
        self.assertEqual(len(got), 4)


def issue(number, kind, state="OPEN", reason=None):
    return dict(number=number, state=state, stateReason=reason, body=f"{MARK.format(key(kind))}\ntext")


class Plan(unittest.TestCase):
    K = "harness, Rotate: a vertex's distance to the pivot changed # → #"
    FOUND = {K: [("1", "e")]}

    def test_each_state(self):
        self.assertEqual(plan(self.FOUND, [], "main"), [("create", self.K, None)])
        self.assertEqual(plan(self.FOUND, [issue(7, self.K)], "main"), [("comment", self.K, 7)])
        fixed = issue(7, self.K, "CLOSED", "COMPLETED")
        self.assertEqual(plan(self.FOUND, [fixed], "main"), [("reopen", self.K, 7)])
        # A branch may predate the fix: comment, don't reopen.
        self.assertEqual(plan(self.FOUND, [fixed], "claude/x"), [("comment", self.K, 7)])
        self.assertEqual(plan(self.FOUND, [issue(7, self.K, "CLOSED", "NOT_PLANNED")], "main"), [])

    def test_matches_by_marker_not_title(self):
        other = issue(3, "something else")
        self.assertEqual(plan(self.FOUND, [other], "main"), [("create", self.K, None)])
        # Two issues of one kind: the newer one is used.
        self.assertEqual(plan(self.FOUND, [issue(4, self.K, "CLOSED", "COMPLETED"), issue(9, self.K)], "main"),
                         [("comment", self.K, 9)])

    def test_texts(self):
        hits = [(str(s), "example line") for s in range(12)]
        title, body = texts("create", self.K, hits, "RUN", "abc1234", "main")
        self.assertEqual(title, "Random testing: " + self.K)
        self.assertIn(MARK.format(key(self.K)), body)
        self.assertIn("and 2 more", body)  # 12 seeds, 10 listed
        self.assertIn("FISSION_SEED=", body)
        self.assertIsNone(texts("comment", self.K, hits, "RUN", "abc1234", "main")[0])

    def test_an_example_cant_break_out_of_its_code_block(self):
        # Output of the code under test closes a ``` block and adds a heading
        # and a mention. The fence must be longer than its longest backtick
        # run (3), so 4 backticks, and the example stays inside unchanged.
        hostile = "x\n```\n# Pwned\n@benpy28 run this\n```"
        _, body = texts("create", self.K, [("1", hostile)], "RUN", "abc1234", "main")
        self.assertIn("````\n" + hostile + "\n````", body)

    def test_a_long_example_is_cut(self):
        _, body = texts("create", self.K, [("1", "y" * (MAX_EXAMPLE + 500))], "RUN", "abc1234", "main")
        self.assertIn("y" * MAX_EXAMPLE + "\n(cut;", body)
        self.assertNotIn("y" * (MAX_EXAMPLE + 1), body)


# Reports as the fuzzers write them (the kernel's STL fuzzer, packages/testing/src/project-fuzz.ts).
FUZZ_STL_A = """STL reader fuzzing, seed 11, 2000 inputs: 2 kind(s) of failure
failure: panic in stl::read: range end index 84 out of range for slice of length 83 at src/widget.rs:94 | case 315 | shrunk input: input-315.stl (83 bytes)
failure: accepted a malformed file | case 3 (model refuses it: WrongLength) | shrunk input: input-3.stl (85 bytes)
"""
FUZZ_STL_B = """STL reader fuzzing, seed 12, 2000 inputs: 1 kind(s) of failure
failure: panic in stl::read: range end index 84 out of range for slice of length 80 at src/widget.rs:95 | case 9 | shrunk input: input-9.stl (80 bytes)
"""
FUZZ_KERNEL = """Kernel extrude fuzzing, seed 14, 52000 inputs: 1 failure(s)
failure: volume 80.07 want 80.56 (slack 3.4e-6) | input input-1-crash-85ef (31 bytes)
"""
FUZZ_PROJECT = """Project loader fuzzing, seed 13, 2000 inputs: 1 kind(s) of failure
failure: saving lost or changed something the file had | case 34 | shrunk input: input-34.json (307 characters)
"""
FUZZ_SESSIONS = """Sketch-extrude sessions, seed 1000003, 40 steps: 1 kind(s) of failure
failure: volume 406830.71135582257, model 406830.7105421612 | seed 1000003, step 8 (extrude sketch-2 by 141): volume 406830.71135582257, model 406830.7105421612 | replay: FISSION_SEED=1000003 FISSION_SESSIONS=1 FISSION_SESSION_STEPS=40 npm run journeys
steps:
  0. draw 5 sides (2 arcs)
"""

FUZZ_TIMELINE = """Timeline sessions, seed 3000003, 500 steps: 1 kind(s) of failure
failure: the rebuild differs from the model | step 41 {"op":"reorder","item":"feature-12","to":0}: the rebuild differs from the model: feature-12 status built, model failed | replay: cd packages/testing && FISSION_SEED=3000003 FISSION_TIMELINE_STEPS=500 node --experimental-strip-types --no-warnings --test journeys/timeline.journey.ts
shrunk to 3 step(s) (1-minimal):
  0. {"op":"add-sketch"}
"""

# The shape packages/testing/fuzz/face-stack.ts writes.
FUZZ_STACK = """Stacked face sketches, seed 7: 6 prisms and 6 edits, shrunk to 1 and 0: 1 kind(s) of failure
failure: volume after prism 0 | volume after prism 0 (on XY, polygon, 4.591 mm): feature-8: 108.9109355897038, the model's 108.9109379621717 | replay: FISSION_STACK_FIRST=7 FISSION_STACK_SEEDS=1 npm run journeys
"""


class Fuzz(unittest.TestCase):
    def test_one_kind_per_failure_line_named_by_target(self):
        # Worked by hand: the target comes from the first line, the kind is
        # the text after "failure: " up to " | ", with numbers as #.
        self.assertEqual([k for k, _ in fuzz_kinds(FUZZ_STL_A)], [
            "fuzzing the STL reader: panic in stl::read: range end index # out of range for slice of length # at src/widget.rs:#",
            "fuzzing the STL reader: accepted a malformed file",
        ])
        # Another round's panic at other numbers is the same kind.
        self.assertEqual(fuzz_kinds(FUZZ_STL_B)[0][0], fuzz_kinds(FUZZ_STL_A)[0][0])
        self.assertEqual([k for k, _ in fuzz_kinds(FUZZ_PROJECT)], ["fuzzing the project loader: saving lost or changed something the file had"])
        # A session's kind is its problem with the numbers out; the steps after it are not kinds.
        self.assertEqual([k for k, _ in fuzz_kinds(FUZZ_SESSIONS)], ["fuzzing the sketch-extrude sessions: volume #, model #"])
        # A timeline session's kind is its check (25b3); the step and the shrunk steps are not part of it.
        self.assertEqual([k for k, _ in fuzz_kinds(FUZZ_TIMELINE)], ["fuzzing the timeline sessions: the rebuild differs from the model"])
        # A stacked chain's kind is its check and the kind of step (a prism or an edit), numbers out; the message is the example.
        self.assertEqual([k for k, _ in fuzz_kinds(FUZZ_STACK)], ["fuzzing the stacked face sketches: volume after prism #"])
        # kernel/fuzz/run.sh's reports name the coverage-guided target.
        self.assertEqual([k for k, _ in fuzz_kinds(FUZZ_KERNEL)], ["fuzzing the kernel's extrude: volume # want # (slack #)"])
        # A report with no failure lines has no kinds; an unknown first line still files, as "?".
        self.assertEqual(fuzz_kinds("STL reader fuzzing, seed 1, 2000 inputs: 0 kind(s) of failure\n"), [])
        self.assertEqual(fuzz_kinds("something else\nfailure: x | y")[0][0], "fuzzing the ?: x")

    def test_texts_say_how_to_replay_a_fuzzing_round(self):
        kind = fuzz_kinds(FUZZ_PROJECT)[0][0]
        title, body = texts("create", kind, [("13", "line")], "RUN", "abc1234", "main")
        self.assertEqual(title, "Fuzzing: project loader: saving lost or changed something the file had")
        self.assertIn(MARK.format(key(kind)), body)
        self.assertIn("npm run fuzz -w @fission/testing", body)
        self.assertIn("(fuzz/failures/seed-13/)", body)
        self.assertIn("fuzz/failures/seed-13/", texts("comment", kind, [("13", "line")], "RUN", "abc1234", "main")[1])

    def test_fuzz_folders_are_read_alongside_random_rounds(self):
        with tempfile.TemporaryDirectory() as d:
            for job, seed, name, text in (("fuzz-stl", "11", "fuzz-report.txt", FUZZ_STL_A), ("fuzz-stl", "12", "fuzz-report.txt", FUZZ_STL_B),
                                          ("fuzz-project", "13", "fuzz-report.txt", FUZZ_PROJECT), ("endless-a-0", "22", "report.txt", ROTATE_A)):
                os.makedirs(os.path.join(d, job, f"seed-{seed}"))
                with open(os.path.join(d, job, f"seed-{seed}", name), "w") as f:
                    f.write(text)
            found = gather(read_folders(d))
        self.assertEqual(sorted((k.split(":")[0], [s for s, _ in v]) for k, v in found.items()), [
            ("fuzzing the STL reader", ["11"]),
            ("fuzzing the STL reader", ["11", "12"]),
            ("fuzzing the project loader", ["13"]),
            ("harness, Rotate", ["22"]),
        ])


class Folders(unittest.TestCase):
    def test_reads_every_seed_folder_and_groups_kinds(self):
        with tempfile.TemporaryDirectory() as d:
            for job, seed, text in (("endless-a-0", "11", ROTATE_A), ("endless-b-3", "22", ROTATE_B),
                                    ("mutants-0", "33", ROTATE_A)):
                os.makedirs(os.path.join(d, job, f"seed-{seed}"))
                with open(os.path.join(d, job, f"seed-{seed}", "report.txt"), "w") as f:
                    f.write(text)
            found = gather(read_folders(d))
        # Two rounds, one kind; the mutants folder is not a random round.
        self.assertEqual(list(found.values()), [[("11", ROTATE_A.strip()), ("22", ROTATE_B.strip())]])


# The shape packages/testing/golden/night.ts writes (step 28b);
# journeys/golden-night.journey.ts feeds a real one through this script.
GOLDEN_A = """Golden models, seed 7: 20 rounds of 6 models (tests/golden), 2 failed
failure: l-bracket: Body 1 (feature-15): volume 48000.048 is not 48000 (40*30*40 ...) | first in round 3 (order: gear, l-bracket); replay: FISSION_SEED=7 FISSION_GOLDEN_ROUNDS=20 npm run golden -w @fission/testing
failure: gear: rebuilt differently in round 2 than in round 1: bodies[0].volume: 1 then 2 | also: x; first in round 2 (order: l-bracket, gear); replay: FISSION_SEED=7
"""
GOLDEN_B = """Golden models, seed 99: 20 rounds of 6 models (tests/golden), 1 failed
failure: l-bracket: Body 1 (feature-15): volume 48000.096 is not 48000 (40*30*40 ...) | first in round 1 (order: l-bracket); replay: FISSION_SEED=99
"""


class Golden(unittest.TestCase):
    def test_one_kind_per_failing_model_with_the_numbers_out(self):
        # Worked by hand from the report above: the text before " | ", with
        # "golden model " in front and every number a # (a number takes the
        # sign before it, so "feature-15" is "feature#", as the harness's are).
        self.assertEqual([k for k, _ in golden_kinds(GOLDEN_A)], [
            "golden model l-bracket: Body # (feature#): volume # is not # (#*#*# ...)",
            "golden model gear: rebuilt differently in round # than in round #: bodies[#].volume: # then #",
        ])
        # Another night's wrong volume by another amount is the same kind.
        self.assertEqual(golden_kinds(GOLDEN_B)[0][0], golden_kinds(GOLDEN_A)[0][0])
        # The first line names the run; it is never a kind, nor is a line that isn't a failure.
        self.assertEqual(golden_kinds("Golden models, seed 1: failure: not at the start\nanother line\n"), [])

    def test_golden_folders_are_read_and_filed_as_their_own_issues(self):
        with tempfile.TemporaryDirectory() as d:
            for seed, text in (("golden-7", GOLDEN_A), ("golden-99", GOLDEN_B)):
                os.makedirs(os.path.join(d, "golden", f"seed-{seed}"))
                with open(os.path.join(d, "golden", f"seed-{seed}", "golden-report.txt"), "w") as f:
                    f.write(text)
            # report.txt next to the seed folders is the night's summary, not a failure.
            with open(os.path.join(d, "golden", "report.txt"), "w") as f:
                f.write("seed 7, ...\n")
            found = gather(read_folders(d))
        self.assertEqual(sorted((k, [s for s, _ in v]) for k, v in found.items()), [
            ("golden model gear: rebuilt differently in round # than in round #: bodies[#].volume: # then #", ["golden-7"]),
            ("golden model l-bracket: Body # (feature#): volume # is not # (#*#*# ...)", ["golden-7", "golden-99"]),
        ])
        kind = "golden model l-bracket: Body # (feature#): volume # is not # (#*#*# ...)"
        self.assertEqual(plan(found, [], "main"), [("create", k, None) for k in sorted(found)])
        title, body = texts("create", kind, found[kind], "RUN", "abc1234", "main")
        self.assertEqual(title, "Golden models: l-bracket: Body # (feature#): volume # is not # (#*#*# ...)")
        self.assertIn(MARK.format(key(kind)), body)
        self.assertIn("tests/golden/<model>.panosolid.json", body)
        self.assertIn("(failures/seed-golden-7/)", body)
        self.assertIn("FISSION_SEED=7 FISSION_GOLDEN_ROUNDS=20 npm run golden", body)



class Checks(unittest.TestCase):
    """Failures that leave no failure folder (test-the-tests hunt,
    2026-10-28: before this they filed nothing)."""

    def test_a_journey_fail_is_a_kind_and_a_flag_is_not(self):
        report = "PASS sketch a box: 4 clicks, 1.2 s\nFLAG extrude: 5 clicks, limit 4\nFAIL export: 7 clicks, limit 4\n  the walk stopped at Save\n"
        kinds = check_kinds({"journeys/report.txt": report}, {}, set())
        # By hand: one FAIL line, its numbers out ("7 clicks, limit 4" -> "# clicks, limit #"),
        # its indented detail kept in the example; the FLAG line is a warning only.
        self.assertEqual(kinds, [("check journeys: export: # clicks, limit #", "FAIL export: 7 clicks, limit 4\n  the walk stopped at Save")])

    def test_an_unexplained_ts_mutant_is_a_kind(self):
        text = "design: 4 survivors\nUNEXPLAINED survivor at src/workspace.ts:1618: ConditionalExpression\n1 problem(s): kill each survivor\n"
        self.assertEqual(check_kinds({"ts-mutants-design/design.txt": text}, {}, set()),
                         [("check TypeScript mutants: survivors no test kills in src/workspace.ts",
                           "UNEXPLAINED survivor at src/workspace.ts:1618: ConditionalExpression")])
        self.assertEqual(check_kinds({"ts-mutants-design/design.txt": "design: 4 survivors, all explained: true\n"}, {}, set()), [])

    def test_ts_mutant_survivors_are_one_kind_per_file(self):
        # Lines copied from the 2026-10-30 night, which filed one issue per survivor (100 of them).
        text = (
            "storage: 86 survivors, all explained: false\n"
            "UNEXPLAINED survivor at packages/storage/src/unsaved.ts:41: packages/storage/src/unsaved.ts | OptionalChaining | journal?.getItem => journal.getItem\n"
            "UNEXPLAINED survivor at packages/storage/src/store.ts:88: packages/storage/src/store.ts | EqualityOperator | v > 0 => v >= 0\n"
            "UNEXPLAINED survivor at packages/storage/src/unsaved.ts:57: packages/storage/src/unsaved.ts | ConditionalExpression | entry == null => false\n"
            "explained.json lists a mutant that no longer survives (remove it): packages/storage/src/autosave.ts | ConditionalExpression | journalVersion === null => false\n"
            "62 problem(s): kill each survivor with a test, or explain in explained.json why no caller can tell\n"
        )
        lines = text.splitlines()
        # By hand: three survivor lines in two files give two kinds, each listing its file's lines in order; the
        # stale explained.json line is a third kind, named by its file (the text before the first " | ").
        self.assertEqual(check_kinds({"ts-mutants-storage/storage.txt": text}, {}, set()), [
            ("check TypeScript mutants: survivors no test kills in packages/storage/src/unsaved.ts", "\n".join([lines[1], lines[3]])),
            ("check TypeScript mutants: survivors no test kills in packages/storage/src/store.ts", lines[2]),
            ("check TypeScript mutants: explained.json lists mutants that no longer survive in packages/storage/src/autosave.ts", lines[4]),
        ])
        # A survivor more or fewer, or on another line, is the same kind: the issue gets a comment, not a sibling.
        fewer = check_kinds({"ts-mutants-storage/storage.txt": lines[1].replace(":41:", ":40:")}, {}, set())
        self.assertEqual(fewer[0][0], "check TypeScript mutants: survivors no test kills in packages/storage/src/unsaved.ts")

    def test_a_mutants_shard_that_stopped_is_a_kind(self):
        # 0 all caught, 2 missed (filed as new survivors), 3 timed out, 124/130 cut off at the deadline: fine.
        for code in ("0", "2", "3", "124", "130"):
            self.assertEqual(check_kinds({"mutants-1/exit-code.txt": code + "\n"}, {}, set()), [], code)
        self.assertEqual(check_kinds({"mutants-1/exit-code.txt": "4\n"}, {}, set()),
                         [("check whole-kernel mutants: the unmutated tests failed", "mutants-1: exit code 4")])
        self.assertEqual(check_kinds({"mutants-0/exit-code.txt": "1"}, {}, set()),
                         [("check whole-kernel mutants: cargo mutants stopped with exit code 1", "mutants-0: exit code 1")])

    def test_a_red_job_with_nothing_more_specific_is_a_kind(self):
        red = "check the sessions job failed with nothing more specific reported"
        # A fuzzer that crashed or ran out of time: red, and no folder gave a kind.
        self.assertEqual([k for k, _ in check_kinds({}, {"sessions": "failure", "project": "success", "stack": "cancelled"}, set())], [red])
        # Its own folder gave a kind already: not filed twice.
        self.assertEqual(check_kinds({}, {"sessions": "failure"}, {"fuzz-sessions"}), [])
        # Another job's folder doesn't explain it.
        self.assertEqual([k for k, _ in check_kinds({}, {"sessions": "failure"}, {"fuzz-project"})], [red])
        # A journey FAIL explains the red journeys job; a job not in JOB_DIRS is always filed.
        self.assertEqual([k for k, _ in check_kinds({"journeys/report.txt": "FAIL a: 5 clicks\n"}, {"journeys": "failure", "new-job": "failure"}, set())],
                         ["check journeys: a: # clicks", "check the new-job job failed with nothing more specific reported"])

    def test_weak_spot_hunt_10_29_red_jobs_are_not_hidden(self):
        red = lambda job: f"check the {job} job failed with nothing more specific reported"
        kinds = lambda *a: [k for k, _ in check_kinds(*a)]
        # A matrix leg that crashed (its folder came in with no kind) beside a leg that found something: filed.
        self.assertEqual(kinds({}, {"test": "failure"}, {"endless-a-1"}, ["endless-a-1", "endless-a-2"]), [red("test")])
        _, example = check_kinds({}, {"test": "failure"}, {"endless-a-1"}, ["endless-a-1", "endless-a-2"])[0]
        self.assertEqual(example, "job test: failure (no kind from endless-a-2)")
        # Every leg that came in gave a kind: explained, not filed twice.
        self.assertEqual(kinds({}, {"test": "failure"}, {"endless-a-1", "endless-a-2"}, ["endless-a-1", "endless-a-2"]), [])
        # "fuzz-sessions" is its folder exactly: the oracle's folder doesn't explain a red sessions job...
        self.assertEqual(kinds({}, {"sessions": "failure"}, {"fuzz-sessions-oracle"}, ["fuzz-sessions-oracle"]), [red("sessions")])
        # ...and explains its own job (it was missing from JOB_DIRS, so a second, misleading issue was filed), as golden/ does golden-step's.
        self.assertEqual(kinds({}, {"sessions-oracle": "failure"}, {"fuzz-sessions-oracle"}, ["fuzz-sessions-oracle"]), [])
        self.assertEqual(kinds({}, {"golden-step": "failure"}, {"golden"}, ["golden"]), [])
        # The soak's problems are kinds of their own, beside a journey FAIL, numbers out.
        soak = json.dumps({"seed": 7, "problems": ["heap grew 12 MB over 60 cycles"]})
        self.assertEqual(kinds({"journeys/report.txt": "FAIL a: 5 clicks\n", "journeys/soak.json": soak}, {"journeys": "failure"}, set()),
                         ["check journeys: a: # clicks", "check soak: heap grew # MB over # cycles"])
        # A soak file that isn't JSON (cut off) is no kind and no crash: the red job is filed as before.
        self.assertEqual(kinds({"journeys/soak.json": "{"}, {"journeys": "failure"}, set()), [red("journeys")])

    def test_issue_199_legs_that_passed_are_not_silent(self):
        # The 2026-10-30 night (run 41118705351): the design and viewport legs found survivors, the six others
        # finished clean and still uploaded their folders. Issue #199 was reopened, calling the clean legs silent.
        clean = {f"ts-mutants-{t}/{t}.txt": f"{t}: 10 survivors, all explained: true\n" for t in ["ai", "core", "model", "naming", "storage", "svg"]}
        reports = {**clean,
                   "ts-mutants-design/design.txt": "design: 48 survivors, all explained: false\n"
                   "UNEXPLAINED survivor at workspaces/design/src/document.ts:518: ArrayDeclaration\n1 problem(s): kill each survivor\n",
                   "ts-mutants-viewport/viewport.txt": "viewport: 36 survivors, all explained: false\n"
                   "UNEXPLAINED survivor at packages/viewport/src/pane.ts:52: ArrowFunction\n1 problem(s): kill each survivor\n"}
        present = sorted({p.split("/")[0] for p in reports})
        kinds = [k for k, _ in check_kinds(reports, {"ts-mutants": "failure"}, set(), present)]
        # By hand: one kind per file with survivors (document.ts, pane.ts), and the red job is explained by them,
        # since every other leg's own summary line says it finished with nothing unexplained.
        self.assertEqual(kinds, ["check TypeScript mutants: survivors no test kills in workspaces/design/src/document.ts",
                                 "check TypeScript mutants: survivors no test kills in packages/viewport/src/pane.ts"])
        red = "check the ts-mutants job failed with nothing more specific reported"
        # A leg that crashed before its summary (an empty report, or none at all) is still silent and filed.
        for crashed in [{"ts-mutants-core/core.txt": ""}, {}]:
            got = check_kinds({**reports, **crashed} if crashed else {k: v for k, v in reports.items() if "core" not in k},
                              {"ts-mutants": "failure"}, set(), present)
            self.assertEqual(got[-1], (red, "job ts-mutants: failure (no kind from ts-mutants-core)"))
        # A clean summary must be the leg's own: "all explained: false" with no survivor lines is not clean.
        odd = {**reports, "ts-mutants-core/core.txt": "core: 10 survivors, all explained: false\n"}
        self.assertEqual(check_kinds(odd, {"ts-mutants": "failure"}, set(), present)[-1][0], red)
        # Whole-kernel mutants: a shard whose exit code is fine is clean too, beside a shard that found something.
        shards = {"mutants-0/exit-code.txt": "0\n", "mutants-1/exit-code.txt": "4\n"}
        self.assertEqual([k for k, _ in check_kinds(shards, {"mutants": "failure"}, set(), ["mutants-0", "mutants-1"])],
                         ["check whole-kernel mutants: the unmutated tests failed"])

    def test_check_texts_and_the_whole_run(self):
        kind = "check the golden job failed with nothing more specific reported"
        title, body = texts("create", kind, [("run", "job golden: failure")], "u", "c", "main")
        self.assertEqual(title, "Nightly check: the golden job failed with nothing more specific reported")
        self.assertIn(MARK.format(key(kind)), body)
        self.assertNotIn("failures/seed-", body)
        _, again = texts("comment", kind, [("run", "job golden: failure")], "u", "c", "main")
        self.assertIn("job golden: failure", again)
        import file_issues
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "golden"))
            with open(os.path.join(d, "golden", "report.txt"), "w") as f:
                f.write("no report\n")
            saved = dict(os.environ)
            os.environ.update(RUN_URL="u", COMMIT="c", BRANCH="main", JOBS=json.dumps({"golden": {"result": "failure", "outputs": {}}}))
            os.environ.pop("GH_TOKEN", None)
            try:
                actions = file_issues.run(d, log=lambda line: None)
            finally:
                os.environ.clear()
                os.environ.update(saved)
        self.assertEqual(actions, [("create", kind, None)])


class Locking(unittest.TestCase):
    """Every issue the script files or updates is locked, so strangers can't
    comment on issues Claude sessions read (audit 2026-10-22, M2)."""
    K = Plan.K

    def run_with(self, issues, lock_fails=False):
        import subprocess
        import file_issues
        calls = []

        def fake_gh(*args, stdin=None):
            calls.append(args)
            if args[:2] == ("issue", "list"):
                return json.dumps(issues)
            if args[:2] == ("issue", "create"):
                return "https://github.com/Panosolid/fission/issues/42\n"
            if args[:2] == ("issue", "lock") and lock_fails:
                raise subprocess.CalledProcessError(1, "gh", stderr="already locked")
            return ""
        saved = file_issues.gh, file_issues.gather, file_issues.read_folders, dict(os.environ)
        file_issues.gh, file_issues.gather = fake_gh, lambda folders, checks=(): {self.K: [("1", "e")]}
        file_issues.read_folders = lambda incoming: []
        os.environ.update(RUN_URL="u", COMMIT="c", BRANCH="main", GH_TOKEN="t")
        logs = []
        try:
            file_issues.run("unused", log=logs.append)
        finally:
            file_issues.gh, file_issues.gather, file_issues.read_folders = saved[:3]
            os.environ.clear()
            os.environ.update(saved[3])
        return calls, logs

    def test_a_new_issue_is_locked(self):
        calls, _ = self.run_with([])
        # The number comes from the URL gh prints: .../issues/42.
        self.assertEqual(calls[-1], ("issue", "lock", "42"))

    def test_an_issue_it_comments_on_or_reopens_is_locked(self):
        calls, _ = self.run_with([issue(7, self.K)])
        self.assertEqual([c[:2] for c in calls[-2:]], [("issue", "comment"), ("issue", "lock")])
        self.assertEqual(calls[-1], ("issue", "lock", "7"))
        calls, _ = self.run_with([issue(7, self.K, "CLOSED", "COMPLETED")])
        self.assertEqual([c[:2] for c in calls[-3:]], [("issue", "reopen"), ("issue", "comment"), ("issue", "lock")])

    def test_one_refused_gh_call_skips_only_its_kind_and_the_run_ends_red(self):
        # Weak-spot hunt 10-29: the first refused `gh issue create` stopped the whole night's filing, and the job stayed
        # green. Three kinds, the first create refused: all three are tried, then FilingFailed names the one.
        import subprocess
        import file_issues
        calls = []

        def fake_gh(*args, stdin=None):
            calls.append(args)
            if args[:2] == ("issue", "list"):
                return "[]"
            if args[:2] == ("issue", "create") and sum(c[:2] == ("issue", "create") for c in calls) == 1:
                raise subprocess.CalledProcessError(1, "gh", stderr="rate limited")
            return "https://github.com/Panosolid/fission/issues/9\n"
        kinds = {"kind one": [("1", "e")], "kind two": [("2", "e")], "kind three": [("3", "e")]}
        saved = file_issues.gh, file_issues.gather, file_issues.read_folders, dict(os.environ)
        file_issues.gh, file_issues.gather = fake_gh, lambda folders, checks=(): kinds
        file_issues.read_folders = lambda incoming: []
        os.environ.update(RUN_URL="u", COMMIT="c", BRANCH="main", GH_TOKEN="t")
        logs = []
        try:
            with self.assertRaises(file_issues.FilingFailed) as caught:
                file_issues.run("unused", log=logs.append)
        finally:
            file_issues.gh, file_issues.gather, file_issues.read_folders = saved[:3]
            os.environ.clear()
            os.environ.update(saved[3])
        self.assertEqual(sum(c[:2] == ("issue", "create") for c in calls), 3, "every kind tried")
        self.assertEqual(len(caught.exception.kinds), 1)
        self.assertTrue(any("rate limited" in line for line in logs))

    def test_no_incoming_folder_is_nothing_to_read(self):
        import file_issues
        self.assertEqual(file_issues.read_folders("/nonexistent-incoming"), {})

    def test_an_already_locked_issue_only_logs(self):
        calls, logs = self.run_with([issue(7, self.K)], lock_fails=True)
        self.assertEqual(calls[-1], ("issue", "lock", "7"))
        self.assertTrue(any("Could not lock #7" in line for line in logs))

class Cap(unittest.TestCase):
    """One run opens at most MAX_NEW issues (2026-10-30: one night opened 104)."""

    def creates(self, n, prefix="monkey kind"):
        return {f"{prefix} {i:03}": [("s", "e")] for i in range(n)}

    def test_up_to_max_new_new_kinds_each_get_an_issue(self):
        found = self.creates(MAX_NEW)
        actions, after = cap(plan(found, [], "main"), found, [], "main")
        self.assertEqual(len([a for a in actions if a[0] == "create"]), MAX_NEW)
        self.assertNotIn(OVERFLOW, after)

    def test_past_max_new_the_rest_wait_in_one_issue(self):
        found = {**self.creates(MAX_NEW + 1, "check TypeScript mutants: survivors no test kills in"), **self.creates(3)}
        actions, after = cap(plan(found, [], "main"), found, [], "main")
        made = [k for a, k, _ in actions if a == "create"]
        # By hand: 14 new kinds; MAX_NEW - 1 = 9 are filed plus the overflow issue, so 10 issues open. The 3 app kinds
        # go first, then the first 6 mutant kinds; the other 5 mutant kinds are listed in the overflow issue.
        self.assertEqual(len(made), MAX_NEW)
        self.assertEqual(made[-1], OVERFLOW)
        self.assertTrue(all(f"monkey kind {i:03}" in made for i in range(3)))
        waiting = [k for k in found if k not in made]
        self.assertEqual(len(waiting), MAX_NEW + 1 + 3 - (MAX_NEW - 1))
        self.assertTrue(all(k.startswith("check TypeScript mutants") for k in waiting))
        example = after[OVERFLOW][0][1]
        self.assertTrue(all(f"- {k}" in example for k in waiting), example)

    def test_an_open_overflow_issue_gets_a_comment(self):
        found = self.creates(MAX_NEW + 1)
        issues = [{"number": 7, "state": "OPEN", "body": MARK.format(key(OVERFLOW))}]
        actions, _ = cap(plan(found, issues, "main"), found, issues, "main")
        self.assertIn(("comment", OVERFLOW, 7), actions)
        self.assertEqual(len([a for a in actions if a[0] == "create"]), MAX_NEW - 1)

    def test_comments_and_reopens_are_never_held_back(self):
        found = self.creates(MAX_NEW + 5)
        issues = [{"number": i, "state": "OPEN", "body": MARK.format(key(k))} for i, k in enumerate(sorted(found)[:5], 1)]
        actions, after = cap(plan(found, issues, "main"), found, issues, "main")
        # 5 kinds already have issues (comments), 10 are new: exactly MAX_NEW new, so nothing waits.
        self.assertEqual(len([a for a in actions if a[0] == "comment"]), 5)
        self.assertNotIn(OVERFLOW, after)


if __name__ == "__main__":
    unittest.main()
