// Stacked face sketches for the nightly fuzzing workflow (.github/workflows/
// fuzz.yml, the "stack" job): rounds of 25 seeded chains
// (src/stack-design.ts `chainOf`, each 5 to 8 prisms on random faces then 6
// edits, checked at every step against the exact model in
// src/stack-model.ts), a new seed each, until FISSION_FUZZ_SECONDS have
// passed. Needs the WASM build. The first seed is FISSION_SEED (decimal) or a
// fresh random one. With FISSION_FUZZ_OUT=<dir>, each round is a line of
// <dir>/log.csv and a failing chain, shrunk to its fewest edits and prisms,
// writes <dir>/seed-<seed>/fuzz-report.txt (file_issues.py's format) and
// chain.json (the shrunk chain: copied into test/regressions/stack/, the
// journey replays it). Exits 1 if anything failed. Replay a chain:
// FISSION_STACK_FIRST=<seed> FISSION_STACK_SEEDS=1 npm run journeys (the
// face-stack journey). FISSION_STACK_FAULT=<one of STACK_FAULTS> plants a bug
// in the harness, for the workflow's self-test (every chain must fail).
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { splitmix64 } from "../src/index.ts";
import { nodeKernel } from "../src/node-kernel.ts";
import { chainOf, runStack, shrinkStack, STACK_FAULTS, type StackFault } from "../src/stack-design.ts";

const CHAINS = 25;
const seconds = Number(process.env.FISSION_FUZZ_SECONDS ?? "60");
const out = process.env.FISSION_FUZZ_OUT;
const first = process.env.FISSION_SEED;
if (first !== undefined && !/^\d+$/.test(first.trim())) throw new Error("FISSION_SEED is a decimal number");
let seed = first !== undefined ? BigInt(first.trim()) : randomBytes(8).readBigUInt64LE();

const fault = process.env.FISSION_STACK_FAULT as StackFault | undefined;
if (fault !== undefined && !STACK_FAULTS.includes(fault)) throw new Error(`FISSION_STACK_FAULT is one of ${STACK_FAULTS.join(", ")}`);
const faults = fault ? [fault] : [];

const kernel = nodeKernel();
if (out) mkdirSync(out, { recursive: true });

const start = Date.now();
let found = 0;
let steps = 0;
do {
  const t = Date.now();
  let failures = 0;
  let s = seed;
  for (let i = 0; i < CHAINS; i++, s = splitmix64(s)[0]) {
    const chain = chainOf(s);
    const r = await runStack(kernel, chain, { faults });
    steps += r.steps;
    if (!r.failure) continue;
    failures++;
    const shrunk = await shrinkStack(kernel, chain, r.failure.check, faults);
    // The format file_issues.py reads: a first line naming the target, then "failure: <kind> | <example>",
    // the kind (the check and what kind of step) with its numbers taken out there.
    const what = r.failure.at.replace(/ \(.*$/, "");
    const report =
      [
        `Stacked face sketches, seed ${s}: ${chain.prisms.length} prisms and ${chain.edits.length} edits, shrunk to ${shrunk.length} and ${shrunk.edits}: 1 kind(s) of failure`,
        `failure: ${r.failure.check} after ${what} | ${r.failure.message.slice(0, 800)} | replay: FISSION_STACK_FIRST=${s} FISSION_STACK_SEEDS=1 npm run journeys`,
      ].join("\n") + "\n";
    process.stdout.write(report);
    if (out) {
      const dir = join(out, `seed-stack-${s}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "fuzz-report.txt"), report);
      const saved = { seed: String(s), check: r.failure.check, failure: r.failure.message.slice(0, 500), prisms: chain.prisms.slice(0, shrunk.length), edits: chain.edits.slice(0, shrunk.edits) };
      writeFileSync(join(dir, "chain.json"), `${JSON.stringify(saved, null, 1)}\n`);
    }
  }
  console.log(`round ${seed}: ${CHAINS} chains, ${failures} failed`);
  if (out) {
    const log = join(out, "log.csv");
    if (!existsSync(log)) writeFileSync(log, "target,seed,cases,failures,seconds\n");
    appendFileSync(log, `stack,${seed},${CHAINS},${failures},${((Date.now() - t) / 1000).toFixed(1)}\n`);
  }
  found += failures;
  seed = s;
} while ((Date.now() - start) / 1000 < seconds);
console.log(`${steps} steps checked, ${found} failing chain(s)`);
process.exitCode = found ? 1 : 0;
