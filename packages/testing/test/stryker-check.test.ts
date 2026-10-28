// stryker/check.mjs's matching of survivors to explained.json: a survivor is
// keyed by its file, kind, code and replacement, so two identical ones (the
// same `1 + 2` on two lines) share a key, and each needs its own entry.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error: a plain .mjs script with no types
import { compare } from "../stryker/check.mjs";

const source = "const a = 1 + 2;\nconst b = 1 + 2;\n";
/** A surviving `1 + 2` -> `1 - 2` on `line`: "1" is the 11th character, the end column is one past the "2" (16). */
const plus = (line: number) => ({
  status: "Survived",
  mutatorName: "ArithmeticOperator",
  replacement: "1 - 2",
  location: { start: { line, column: 11 }, end: { line, column: 16 } },
});
const report = (lines: number[]) => ({ files: { "src/a.ts": { source, mutants: lines.map(plus) } } });
const entry = { file: "packages/x/src/a.ts", mutator: "ArithmeticOperator", original: "1 + 2", replacement: "1 - 2", why: "Never read." };
const KEY = "packages/x/src/a.ts | ArithmeticOperator | 1 + 2 => 1 - 2";

test("hand-checked: one survivor, one entry, nothing to say", () => {
  assert.deepEqual(compare([entry], report([1]), "packages/x", "x"), { problems: [], summary: "x: 1 survivors, all explained: true" });
});

test("two identical survivors and one entry: the second is unexplained", () => {
  // By hand: both lines' `1 + 2` survive, one entry explains one of them.
  const { problems, summary } = compare([entry], report([1, 2]), "packages/x", "x");
  assert.deepEqual(problems, [`UNEXPLAINED survivor at packages/x/src/a.ts:2: ${KEY}`]);
  assert.equal(summary, "x: 2 survivors, all explained: false");
  // Each with its own entry: explained.
  assert.deepEqual(compare([entry, entry], report([1, 2]), "packages/x", "x").problems, []);
});

test("two entries and one survivor left: the extra entry must go", () => {
  assert.deepEqual(compare([entry, entry], report([2]), "packages/x", "x").problems,
    [`explained.json lists a mutant that no longer survives (remove it): ${KEY}`]);
  // Killed mutants and other folders' entries count for nothing.
  const killed = { files: { "src/a.ts": { source, mutants: [{ ...plus(1), status: "Killed" }] } } };
  assert.deepEqual(compare([{ ...entry, file: "packages/y/src/a.ts" }], killed, "packages/x", "x").problems, []);
});
