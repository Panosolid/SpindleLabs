// Keeps stryker/design.json honest (as planted.test.ts keeps the planted
// bugs'): its mutate range is a pair of line numbers in Design's
// document.ts, which every edit above it moves. It must still run from
// shapeOf's first line to readDesignDocument's closing brace, the reading
// and upgrading of Design's data, and every test file its command names
// must exist. Until 24f4 the range had drifted to the middle of shapeOf and
// of readDesignDocument, and the kept shapes' checks were mutated with
// their tests (test/kept.test.ts) left out of the run: 23 survivors no one
// had explained.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const config = JSON.parse(readFileSync(join(root, "packages/testing/stryker/design.json"), "utf8")) as { mutate: string[]; commandRunner: { command: string } };

const FIRST = "export function shapeOf(";
const LAST_OF = "export function readDesignDocument(";

/** What is wrong with mutate entry `entry` ("src/document.ts:a-b") against `source`, or null: line a must open shapeOf, line b close readDesignDocument. */
function rangeProblem(source: string, entry: string): string | null {
  const m = /^src\/document\.ts:(\d+)-(\d+)$/.exec(entry);
  if (!m) return `"${entry}" is not src/document.ts:first-last`;
  const lines = source.split("\n");
  const [first, last] = [Number(m[1]), Number(m[2])];
  const start = lines.findIndex((l) => l.startsWith(FIRST)) + 1;
  const read = lines.findIndex((l) => l.startsWith(LAST_OF));
  const end = lines.findIndex((l, i) => i > read && l === "}") + 1;
  if (start === 0 || read < 0 || end === 0) return "document.ts no longer has shapeOf and readDesignDocument";
  if (first !== start) return `the range starts at line ${first}, but shapeOf starts at line ${start}`;
  if (last !== end) return `the range ends at line ${last}, but readDesignDocument ends at line ${end}`;
  return null;
}

test("design.json mutates from shapeOf's first line to readDesignDocument's last, and its tests exist", () => {
  const source = readFileSync(join(root, "workspaces/design/src/document.ts"), "utf8");
  assert.equal(config.mutate.length, 1);
  assert.equal(rangeProblem(source, config.mutate[0]), null);
  const files = config.commandRunner.command.split(" ").filter((w) => w.startsWith("test/"));
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(existsSync(join(root, "workspaces/design", f)), `${f} is not in workspaces/design`);
  // The kept shapes' checks are in the range, so their tests must run.
  assert.ok(files.includes("test/kept.test.ts"));
  // So are a face sketch's pins' checks (26f).
  assert.ok(files.includes("test/face-edges.test.ts"));
  // So is withShortNames (U0e1), whose tests were left out until the nightly found 22 survivors in it.
  assert.ok(files.includes("test/short-names.test.ts"));
});

test("a range one line off at either end is caught, with which end and where it should be", () => {
  // A made-up file, worked by hand: shapeOf on line 2, readDesignDocument on 4 to 6 (its "}" on 6).
  const source = ["// x", "export function shapeOf() {", "}", "export function readDesignDocument() {", "  if (x) {", "}", "export function builds() {", "}"].join("\n");
  assert.equal(rangeProblem(source, "src/document.ts:2-6"), null);
  assert.equal(rangeProblem(source, "src/document.ts:1-6"), "the range starts at line 1, but shapeOf starts at line 2");
  assert.equal(rangeProblem(source, "src/document.ts:3-6"), "the range starts at line 3, but shapeOf starts at line 2");
  assert.equal(rangeProblem(source, "src/document.ts:2-5"), "the range ends at line 5, but readDesignDocument ends at line 6");
  assert.equal(rangeProblem(source, "src/document.ts:2-7"), "the range ends at line 7, but readDesignDocument ends at line 6");
  assert.equal(rangeProblem(source, "src/document.ts"), '"src/document.ts" is not src/document.ts:first-last');
  assert.equal(rangeProblem("nothing", "src/document.ts:2-6"), "document.ts no longer has shapeOf and readDesignDocument");
});

type Read = (path: string) => string | null;
const readReal: Read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** What is wrong with the Stryker targets in `dir`: run.sh and check.mjs must name the same targets and folders, run.sh must run all of them by default, and each needs a config whose mutated files and tests exist. */
function targetProblems(dir: string, read: Read): string[] {
  const runSh = read(join(dir, "run.sh")) ?? "";
  const checkMjs = read(join(dir, "check.mjs")) ?? "";
  const pairs = (text: string, re: RegExp) => Object.fromEntries([...text.matchAll(re)].map((m) => [m[1], m[2]]));
  const shDirs = pairs(/declare -A dirs=\((.*)\)/.exec(runSh)?.[1] ?? "", /\[(\w+)\]=([\w/]+)/g);
  const jsDirs = pairs(/const dirs = \{(.*)\};/.exec(checkMjs)?.[1] ?? "", /(\w+): "([\w/]+)"/g);
  const defaults = /targets=\(([\w ]+)\)$/m.exec(runSh)?.[1] ?? "";
  const problems: string[] = [];
  if (JSON.stringify(shDirs) !== JSON.stringify(jsDirs)) problems.push(`run.sh's targets ${JSON.stringify(shDirs)} differ from check.mjs's ${JSON.stringify(jsDirs)}`);
  if (defaults !== Object.keys(shDirs).join(" ")) problems.push(`run.sh runs "${defaults}" by default, not every target`);
  for (const [target, folder] of Object.entries(shDirs)) {
    const text = read(join(dir, `${target}.json`));
    if (text === null) {
      problems.push(`${target}.json is missing`);
      continue;
    }
    const c = JSON.parse(text) as { mutate: string[]; commandRunner: { command: string }; jsonReporter: { fileName: string } };
    if (!c.jsonReporter.fileName.endsWith(`/stryker/${target}.json`)) problems.push(`${target}.json reports to ${c.jsonReporter.fileName}, where check.mjs won't look`);
    for (const m of c.mutate) if (read(join(root, folder, m.replace(/:\d+-\d+$/, ""))) === null) problems.push(`${target}.json mutates ${m}, which is not in ${folder}`);
    const tests = c.commandRunner.command.split(" ").filter((w) => w.startsWith("test/"));
    if (tests.length === 0) problems.push(`${target}.json runs no tests`);
    for (const t of tests) if (!t.includes("*") && read(join(root, folder, t)) === null) problems.push(`${target}.json runs ${t}, which is not in ${folder}`);
  }
  return problems;
}

const stryker = join(root, "packages/testing/stryker");

test("every Stryker target named in run.sh has a config whose mutated files and tests exist, and check.mjs reads the same ones", () => {
  assert.deepEqual(targetProblems(stryker, readReal), []);
});

test("a missing config, a renamed source file or test, a target check.mjs doesn't know and one left out of the default run are each caught", () => {
  const without = (bad: string): Read => (p) => (p.endsWith(bad) ? null : readReal(p));
  const edited = (file: string, from: string, to: string): Read => (p) => {
    const text = readReal(p);
    if (!p.endsWith(file) || text === null) return text;
    assert.ok(text.includes(from), `${file} no longer has ${from}`);
    return text.replace(from, to);
  };
  assert.deepEqual(targetProblems(stryker, without("stryker/storage.json")), ["storage.json is missing"]);
  assert.deepEqual(targetProblems(stryker, without("packages/storage/src/reopen.ts")), ["storage.json mutates src/reopen.ts, which is not in packages/storage"]);
  assert.deepEqual(targetProblems(stryker, without("packages/core/test/links.test.ts")), ["model.json runs test/links.test.ts, which is not in packages/core"]);
  const [problem] = targetProblems(stryker, edited("check.mjs", ', svg: "packages/core"', ""));
  assert.match(problem, /^run\.sh's targets .* differ from check\.mjs's /);
  assert.deepEqual(targetProblems(stryker, edited("run.sh", "targets=(core design storage model svg viewport ai naming combine)", "targets=(core design)")), ['run.sh runs "core design" by default, not every target']);
});

test("the nightly ts-mutants job runs every target run.sh knows, one job each, and collect-results.sh reports each", () => {
  const runSh = readFileSync(join(stryker, "run.sh"), "utf8");
  const targets = /targets=\(([\w ]+)\)$/m.exec(runSh)![1];
  const nightly = readFileSync(join(root, ".github/workflows/nightly.yml"), "utf8");
  const job = nightly.slice(nightly.indexOf("\n  ts-mutants:\n"), nightly.indexOf("\n  collect:\n"));
  assert.equal(/target: \[([\w, ]+)\]/.exec(job)?.[1].split(", ").join(" "), targets);
  const collect = readFileSync(join(root, ".github/scripts/collect-results.sh"), "utf8");
  assert.equal(/for t in ([\w ]+); do/.exec(collect)?.[1], targets);
  assert.ok(/needs: \[.*\bts-mutants\b.*\]/.test(nightly.slice(nightly.indexOf("\n  collect:\n"))), "collect waits for ts-mutants");
});

test("each killing test file (test/*-survivors.test.ts) runs in the targets for its folder", () => {
  // model.json once named its tests one by one and left out model-survivors.test.ts, so a rerun
  // could not see the tests written to kill its survivors.
  const runSh = readFileSync(join(stryker, "run.sh"), "utf8");
  const dirs = Object.fromEntries([...(/declare -A dirs=\((.*)\)/.exec(runSh)![1]).matchAll(/\[(\w+)\]=([\w/]+)/g)].map((m) => [m[1], m[2]]));
  for (const folder of new Set(Object.values(dirs))) {
    const killers = readdirSync(join(root, folder, "test")).filter((f) => f.endsWith("survivors.test.ts"));
    for (const k of killers) {
      const running = Object.entries(dirs)
        .filter(([, f]) => f === folder)
        .filter(([t]) => {
          const command = (JSON.parse(readFileSync(join(stryker, `${t}.json`), "utf8")) as { commandRunner: { command: string } }).commandRunner.command;
          return command.includes(`test/${k}`) || command.includes("test/*.test.ts");
        });
      assert.ok(running.length > 0, `${folder}/test/${k} runs in none of ${folder}'s targets`);
    }
  }
});

/** The test files in `folder`/test that import, by name, something `target`'s config mutates (an `export function`, `const`, `let` or `class` in a mutated file, inside its line range when it has one) but which the target doesn't run, as "<target>.json leaves out test/x.test.ts, which imports a, b". A target that runs test/*.test.ts runs them all. */
function unrunImporters(dir: string, target: string, folder: string, read: Read): string[] {
  const c = JSON.parse(read(join(dir, `${target}.json`)) ?? "{}") as { mutate: string[]; commandRunner: { command: string } };
  const command = c.commandRunner.command;
  if (command.includes("test/*.test.ts")) return [];
  const mutated = new Map<string, Set<string>>();
  for (const m of c.mutate) {
    const [, file, a, b] = /^(.*?)(?::(\d+)-(\d+))?$/.exec(m)!;
    let lines = (read(join(root, folder, file)) ?? "").split("\n");
    if (a) lines = lines.slice(Number(a) - 1, Number(b));
    mutated.set(file, new Set([...lines.join("\n").matchAll(/^export (?:async )?(?:function\*?|const|let|class) (\w+)/gm)].map((x) => x[1])));
  }
  const problems: string[] = [];
  for (const f of readdirSync(join(root, folder, "test")).filter((f) => f.endsWith(".test.ts")).sort()) {
    if (command.split(" ").includes(`test/${f}`)) continue;
    const used = new Set<string>();
    for (const [, names, from] of (read(join(root, folder, "test", f)) ?? "").matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*"\.\.\/(src\/[^"]+)"/g)) {
      const exported = mutated.get(from);
      if (!exported) continue;
      for (const n of names.split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])) if (exported.has(n)) used.add(n);
    }
    if (used.size > 0) problems.push(`${target}.json leaves out test/${f}, which imports ${[...used].sort().join(", ")}`);
  }
  return problems;
}

test("every test file that imports something a target mutates runs in that target", () => {
  // design.json left out short-names.test.ts, so withShortNames's 22 mutants survived though its tests would have killed them.
  const runSh = readFileSync(join(stryker, "run.sh"), "utf8");
  const dirs = Object.fromEntries([...(/declare -A dirs=\((.*)\)/.exec(runSh)![1]).matchAll(/\[(\w+)\]=([\w/]+)/g)].map((m) => [m[1], m[2]]));
  for (const [target, folder] of Object.entries(dirs)) assert.deepEqual(unrunImporters(stryker, target, folder, readReal), [], target);
});

test("a test file dropped from a target's run is caught, naming what it imports; one importing nothing mutated is not", () => {
  const dropped = (config: string, file: string): Read => (p) => {
    const text = readReal(p);
    if (!p.endsWith(`stryker/${config}`) || text === null) return text;
    assert.ok(text.includes(` test/${file}`), `${config} no longer runs ${file}`);
    return text.replace(` test/${file}`, "");
  };
  // The bug itself: short-names.test.ts imports oldPresetName, readDesignDocument and withShortNames, all inside document.ts's range.
  assert.deepEqual(unrunImporters(stryker, "design", "workspaces/design", dropped("design.json", "short-names.test.ts")), [
    "design.json leaves out test/short-names.test.ts, which imports oldPresetName, readDesignDocument, withShortNames",
  ]);
  // ownership.test.ts imports createHistory from history.ts, which core.json mutates whole, and only a type from project.ts.
  assert.deepEqual(unrunImporters(stryker, "core", "packages/core", dropped("core.json", "ownership.test.ts")), ["core.json leaves out test/ownership.test.ts, which imports createHistory"]);
  // insert.test.ts imports from document.ts too, but only names outside the range (partDocument, partFeature), so leaving it out is right.
  assert.match(readReal(join(root, "workspaces/design/test/insert.test.ts")) ?? "", /import \{[^}]*\bpartDocument\b[^}]*\} from "\.\.\/src\/document\.ts"/);
  assert.ok(!readFileSync(join(stryker, "design.json"), "utf8").includes("test/insert.test.ts"));
});
