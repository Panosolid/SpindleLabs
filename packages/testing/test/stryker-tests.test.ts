// stryker/tests.mjs and bail.mjs, which run a mutation target's tests in
// one process and stop at the first test that throws. The verdict must be
// node --test's: exit 1 when any test fails (thrown, a failing subtest, a
// file that can't load), 0 only when all pass, todo failures not counting.
// Each case is a made-up folder of test files, run as a target's command is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testFiles } from "../stryker/tests.mjs";

const runner = join(dirname(fileURLToPath(import.meta.url)), "../stryker/tests.mjs");

/** Runs `files` (name → source) as a target: the names in `order`, from a fresh folder; returns the exit code, stderr and the folder. */
function runTarget(files: Record<string, string>, order: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "stryker-tests-"));
  mkdirSync(join(dir, "test"));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, "test", name), source);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "-e", `import(${JSON.stringify(runner)}).then((m) => m.default(process.argv.slice(1)))`, ...order], { cwd: dir, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr, ran: (marker: string) => existsSync(join(dir, marker)), done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A test file whose one test leaves a marker file named `marker` in the folder, then does `body`. */
const marking = (marker: string, body = "") => `import { test } from "node:test";\nimport { writeFileSync } from "node:fs";\ntest("${marker}", () => { writeFileSync("${marker}", ""); ${body} });\n`;

test("hand-worked: the files run in the order named, and the quoted glob adds every other test file, sorted", () => {
  const dir = mkdtempSync(join(tmpdir(), "stryker-files-"));
  for (const f of ["c.test.ts", "a.test.ts", "b.test.ts", "helper.ts"]) writeFileSync(join(dir, f), "");
  // Named: b first, then the glob, then a last. The glob is a, b, c sorted, less the named b and a: just c. helper.ts isn't a test file.
  assert.deepEqual(testFiles([`${dir}/b.test.ts`, `${dir}/*.test.ts`, `${dir}/a.test.ts`]), [`${dir}/b.test.ts`, `${dir}/c.test.ts`, `${dir}/a.test.ts`]);
  rmSync(dir, { recursive: true, force: true });
});

test("every test passing exits 0, after running every file", () => {
  const t = runTarget({ "one.test.ts": marking("one"), "two.test.ts": marking("two") }, ["test/one.test.ts", "test/two.test.ts"]);
  assert.equal(t.code, 0, t.stderr);
  assert.ok(t.ran("one") && t.ran("two"));
  t.done();
});

test("a test that throws ends the run at once with exit 1, naming it: the next file's test never runs", () => {
  const t = runTarget({ "one.test.ts": marking("one", 'throw new Error("noticed the mutant");'), "two.test.ts": marking("two") }, ["test/one.test.ts", "test/two.test.ts"]);
  assert.equal(t.code, 1);
  assert.match(t.stderr, /failed: one\n.*noticed the mutant/);
  assert.ok(t.ran("one") && !t.ran("two"));
  t.done();
});

test("a failure that throws nothing into the test (a failing subtest) still exits 1, at the end", () => {
  const sub = `import { test } from "node:test";\ntest("outer", async (t) => { await t.test("inner", () => { throw new Error("inner fails"); }); });\n`;
  const t = runTarget({ "sub.test.ts": sub, "two.test.ts": marking("two") }, ["test/sub.test.ts", "test/two.test.ts"]);
  assert.equal(t.code, 1);
  assert.ok(t.ran("two"), "no early stop: the subtest's failure reaches node:test, not bail");
  t.done();
});

test("a file that can't load exits 1; a failing todo test does not count, as under node --test", () => {
  const broken = runTarget({ "broken.test.ts": 'import { nothing } from "./missing.ts";\n' }, ["test/broken.test.ts"]);
  assert.equal(broken.code, 1);
  broken.done();
  const todo = runTarget({ "todo.test.ts": `import { test } from "node:test";\ntest("not yet", { todo: true }, () => { throw new Error("expected"); });\n` }, ["test/todo.test.ts"]);
  assert.equal(todo.code, 0, todo.stderr);
  todo.done();
});
