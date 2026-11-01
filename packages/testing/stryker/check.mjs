// Reads the Stryker reports run.sh made and fails on any surviving mutant
// that explained.json does not explain, or that it explains but the tests
// now kill (so the list stays true). A mutant is matched by its file, kind,
// the code it changed and what it changed it to, not by line number.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const dirs = { core: "packages/core", design: "workspaces/design", storage: "packages/storage", model: "packages/core", svg: "packages/core", viewport: "packages/viewport", ai: "packages/ai", naming: "packages/testing", combine: "workspaces/design" };
const key = (m) => `${m.file} | ${m.mutator} | ${m.original} => ${m.replacement}`;

/** The text between two Stryker locations (lines and columns count from 1). */
function slice(source, { start, end }) {
  const lines = source.split("\n").slice(start.line - 1, end.line);
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, start.line === end.line ? end.column - 1 : end.column - 1);
  lines[0] = lines[0].slice(start.column - 1);
  return lines.join("\n").replace(/\s+/g, " ");
}

/** One target's problems, one line each, then its summary line: `report` is Stryker's JSON for the folder `dir`. */
export function compare(explained, report, dir, target) {
  const problems = [];
  // Every survivor under its key: two identical mutants (the same code on
  // two lines) share one, and each needs an entry of its own.
  const surviving = new Map();
  const checkedFiles = new Set();
  for (const [file, { source, mutants }] of Object.entries(report.files)) {
    const path = `${dir}/${file}`;
    checkedFiles.add(path);
    for (const m of mutants) {
      if (m.status !== "Survived" && m.status !== "NoCoverage") continue;
      const s = { file: path, mutator: m.mutatorName, original: slice(source, m.location), replacement: m.replacement.replace(/\s+/g, " ") };
      surviving.set(key(s), [...(surviving.get(key(s)) ?? []), { ...s, line: m.location.start.line }]);
    }
  }
  const known = new Map();
  for (const e of explained) if (checkedFiles.has(e.file)) known.set(key(e), (known.get(key(e)) ?? 0) + 1);
  let total = 0;
  for (const [k, list] of surviving) {
    total += list.length;
    for (const s of list.slice(known.get(k) ?? 0)) problems.push(`UNEXPLAINED survivor at ${s.file}:${s.line}: ${k}`);
  }
  for (const [k, n] of known)
    for (let i = surviving.get(k)?.length ?? 0; i < n; i++) problems.push(`explained.json lists a mutant that no longer survives (remove it): ${k}`);
  const unexplained = problems.some((p) => p.startsWith("UNEXPLAINED"));
  return { problems, summary: `${target}: ${total} survivors, all explained: ${!unexplained}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const explained = JSON.parse(readFileSync(join(here, "explained.json"), "utf8"));
  let bad = 0;
  for (const target of process.argv.slice(2)) {
    const report = JSON.parse(readFileSync(join(root, "node_modules/.cache/stryker", `${target}.json`), "utf8"));
    const { problems, summary } = compare(explained, report, dirs[target], target);
    for (const p of problems) console.log(p);
    bad += problems.length;
    console.log(summary);
  }
  if (bad) {
    console.log(`${bad} problem(s): kill each survivor with a test, or explain in explained.json why no caller can tell`);
    process.exit(1);
  }
}
