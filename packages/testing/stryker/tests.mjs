// Runs one mutation target's test files for Stryker, all in this one
// process, in the order given, ending at the first test that throws (exit
// code 1, through bail.mjs). A killed mutant then costs only the tests up
// to the first one that notices it, and no run pays Node's start-up once
// per file (half of a Design run). The verdict is the same as
// `node --test` on the same files: killed when any test fails (or a file
// can't load), survived only when every test passes, which still runs them
// all. A mutant that leaves something running keeps the process alive
// until Stryker's timeout, as before: nothing here forces an exit. So a
// target lists its quick tests of the mutated code first, its slow ones last.
//
// A target's command (packages/testing/stryker/*.json) runs it from its folder:
//   node --experimental-strip-types --no-warnings -e "import(require('path').join(require.resolve('@fission/testing'), '../../stryker/tests.mjs')).then((m) => m.default(process.argv.slice(1)))" test/a.test.ts test/b.test.ts
// It is found through @fission/testing because Stryker runs the command in
// a copy of the folder. 'test/*.test.ts', quoted so the shell leaves it,
// stands for every such file there. The files stay plain words of the
// command, which test/stryker-config.test.ts reads.
import { register } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The files to run, in order: each name as given, and "dir/*.test.ts" as
 * every other file in dir ending in .test.ts (sorted; the ones named in the
 * list keep their own place, so a slow file can be named after it to run last).
 */
export function testFiles(names) {
  const named = new Set(names);
  return names.flatMap((n) => {
    const all = /^(.*)\/\*\.test\.ts$/.exec(n);
    if (!all) return [n];
    return readdirSync(all[1]).filter((f) => f.endsWith(".test.ts")).sort().map((f) => `${all[1]}/${f}`).filter((f) => !named.has(f));
  });
}

export default async function runTests(names) {
  register(new URL("./bail.mjs", import.meta.url));
  // Each file's tests join node:test's one queue as it loads and run in that order.
  for (const f of testFiles(names)) await import(pathToFileURL(resolve(f)).href);
}
