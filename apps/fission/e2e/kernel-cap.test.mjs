// Unit tests for kernel-cap.mjs: the memory cap written into a .wasm.
// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { capWasmMemory, PAGE } from "./kernel-cap.mjs";

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
// An export section (id 7) giving the memory out as "m": 1 export, name of
// length 1 "m" (0x6d), kind 2 (memory), index 0: 5 bytes.
const EXPORT_M = [7, 5, 1, 1, 0x6d, 2, 0];
/** A module with one memory of `min` pages, no maximum, given out as "m". */
const module = (min) => Uint8Array.from([...HEADER, 5, 3, 1, 0, min, ...EXPORT_M]);
const memoryOf = (bytes) => new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.m;

test("hand-worked: a 17-page memory capped at 400 pages", () => {
  // The memory section was [5, 3, 1, 0, 17]: id 5, 3 bytes, 1 memory,
  // flags 0 (no maximum), minimum 17. With a maximum, flags become 1 and
  // 400 follows the minimum as LEB128: 400 = 0b1_1001_0000, the low seven
  // bits 001_0000 (0x10) with the "more" bit set (0x90), then 400 >> 7 = 3.
  // The section's body is now 1, 1, 17, 0x90, 0x03: 5 bytes.
  const capped = capWasmMemory(module(17), 400);
  assert.deepEqual([...capped], [...HEADER, 5, 5, 1, 1, 17, 0x90, 0x03, ...EXPORT_M]);
});

test("the capped memory grows to the cap and no further", () => {
  const free = memoryOf(module(1));
  assert.equal(free.grow(9), 1, "uncapped, 9 more pages");
  const m = memoryOf(capWasmMemory(module(1), 10));
  assert.equal(m.grow(9), 1, "9 more pages reach the cap of 10");
  assert.equal(m.buffer.byteLength, 10 * PAGE);
  assert.throws(() => m.grow(1), RangeError, "one page past the cap is refused");
});

test("a maximum already there is replaced", () => {
  // [5, 4, 1, 1, 2, 50]: flags 1, minimum 2, maximum 50.
  const withMax = Uint8Array.from([...HEADER, 5, 4, 1, 1, 2, 50, ...EXPORT_M]);
  assert.deepEqual([...capWasmMemory(withMax, 3)], [...HEADER, 5, 4, 1, 1, 2, 3, ...EXPORT_M]);
  const m = memoryOf(capWasmMemory(withMax, 3));
  assert.equal(m.grow(1), 2);
  assert.throws(() => m.grow(1), RangeError);
});

test("refused: a minimum above the cap, no memory section, a shared memory, not a .wasm", () => {
  assert.throws(() => capWasmMemory(module(17), 16), /starts at 17 pages, above the cap of 16/);
  assert.equal(capWasmMemory(module(17), 17).length, module(17).length + 1, "a cap equal to the minimum is fine");
  assert.throws(() => capWasmMemory(Uint8Array.from([...HEADER, ...EXPORT_M]), 10), /no memory section/);
  assert.throws(() => capWasmMemory(Uint8Array.from([...HEADER, 5, 4, 1, 3, 1, 2]), 10), /shared or 64-bit/);
  assert.throws(() => capWasmMemory(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 10), /not a .wasm/);
});

test("the app's own kernel: capped, it is still a valid module, two bytes longer", () => {
  const dir = new URL("../../../packages/core/src/kernel/wasm/", import.meta.url);
  const wasm = readFileSync(new URL(readdirSync(dir).find((f) => f.endsWith(".wasm")), dir));
  const capped = capWasmMemory(wasm, 400);
  assert.ok(WebAssembly.validate(capped), "still a valid module");
  // Its memory section is [5, 3, 1, 0, 17] (no maximum): capped, the
  // maximum's two LEB128 bytes (0x90, 0x03) are added and the section's
  // size, now 5, still fits one byte.
  assert.equal(capped.length, wasm.length + 2);
  assert.ok(WebAssembly.Module.exports(new WebAssembly.Module(capped)).some((e) => e.kind === "memory"), "the kernel still gives out its memory");
});
