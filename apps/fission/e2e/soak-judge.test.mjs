// The soak verdict (soak-judge.mjs) on made-up readings: a flat run passes,
// each kind of growth is caught, and the heap allowance at 0.9× and 1.1×.
import test from "node:test";
import assert from "node:assert/strict";
import { COUNTS, HEAP_PER_CYCLE, judgeSoak } from "./soak-judge.mjs";

/** Readings every 5 cycles to `cycles`, flat unless `change` alters one. */
function run(cycles = 40, change = () => {}) {
  const out = [];
  for (let c = 0; c <= cycles; c += 5) {
    const r = { cycle: c, heap: 10e6, wasm: 2 ** 22, ...Object.fromEntries(COUNTS.map((k) => [k, 100])), bodies: 0 };
    change(r);
    out.push(r);
  }
  return out;
}

test("a flat run passes, and warm-up growth (cycles 0-10 of 40) is allowed", () => {
  assert.deepEqual(judgeSoak(run()), []);
  assert.deepEqual(judgeSoak(run(40, (r) => r.cycle <= 10 && ((r.heap += r.cycle * 1e6), (r.nodes += r.cycle), (r.wasm *= 2)))), []);
});

test("every count that climbs after the warm-up is named", () => {
  for (const key of COUNTS) {
    const problems = judgeSoak(run(40, (r) => (r[key] += r.cycle >= 30 ? 1 : 0)));
    assert.equal(problems.length, 1, key);
    const base = key === "bodies" ? 0 : 100;
    assert.equal(problems[0], `${key} keeps growing: ${base} by cycle 10, ${base + 1} at cycle 30, ${base + 1} at cycle 40`);
  }
});

test("a body left in the kernel each cycle is caught", () => {
  // One body a cycle: 10 by cycle 10, 15 at cycle 15.
  assert.deepEqual(judgeSoak(run(40, (r) => (r.bodies = r.cycle))), ["bodies keeps growing: 10 by cycle 10, 15 at cycle 15, 40 at cycle 40"]);
});

test("the heap allowance: 0.9× passes, 1.1× fails", () => {
  // Readings after warm-up at cycles 15..40 (6), thirds of 2: means at cycle 17.5 and 37.5, 20 cycles apart.
  // A heap rising g bytes a cycle has means 20·g apart, so g a cycle is measured exactly.
  const at = (g) => judgeSoak(run(40, (r) => (r.heap += g * r.cycle)));
  assert.deepEqual(at(0.9 * HEAP_PER_CYCLE), []);
  assert.deepEqual(at(1.1 * HEAP_PER_CYCLE), ["the JavaScript heap keeps growing: 22,000 bytes a cycle (at most 20,000)"]);
});

test("WebAssembly memory growing in the second half fails; in the first half it may", () => {
  assert.deepEqual(judgeSoak(run(40, (r) => r.cycle >= 15 && (r.wasm *= 2))), []);
  assert.deepEqual(judgeSoak(run(40, (r) => r.cycle >= 35 && (r.wasm += 65536))), ["the kernel's WebAssembly memory keeps growing: 4194304 bytes at cycle 20, 4259840 at cycle 40"]);
});

test("too short a run is refused, not passed", () => {
  assert.deepEqual(judgeSoak(run(5)), ["too few readings after the warm-up to judge (1; at least 3)"]);
});
