// startKernel: the shipped kernel starts with the key from its kernel.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { startKernel, type KernelRelease } from "../src/kernel/handshake.ts";

/** A stand-in for the kernel's begin(): opens only with `key`, and records what it was given. */
function kernelWithKey(key: string | null) {
  const given: string[] = [];
  return { given, begin: (k: string) => (given.push(k), key === null || k === key) };
}

test("the release's key opens the kernel, given exactly once", () => {
  const k = kernelWithKey("75c4");
  startKernel(k.begin, { handshake: "75c4", build: "b1" });
  assert.deepEqual(k.given, ["75c4"]);
});

test("a kernel.json whose key doesn't open the build stops the app with the build named", () => {
  const k = kernelWithKey("75c4");
  assert.throws(() => startKernel(k.begin, { handshake: "0000", build: "b1" }), /does not match its kernel.json \(build b1\)/);
});

test("no key (a plain build's kernel.json): begin is never called", () => {
  const k = kernelWithKey("75c4");
  startKernel(k.begin, { handshake: null, build: "dev" });
  assert.deepEqual(k.given, []);
});

test("the committed kernel.json has a key, a build and the modelling range", () => {
  const release: KernelRelease = JSON.parse(readFileSync(new URL("../src/kernel/wasm/kernel.json", import.meta.url), "utf8"));
  assert.match(release.handshake ?? "", /^[0-9a-f]{32}$/);
  assert.match(release.build, /^[0-9a-f]{16}$/);
  // 10 nm and 1 km in mm: the range the app promises (1 um to 1 km features, 10 nm tolerance).
  assert.deepEqual(release.limits, { LINEAR: 1e-5, MAX_SIZE: 1e6 });
});
