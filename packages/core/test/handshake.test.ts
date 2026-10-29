// startKernel: the shipped kernel starts with the app's own key (kernel-key.ts),
// which is in none of the files shipped beside the build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { startKernel } from "../src/kernel/handshake.ts";
import { KERNEL_KEY } from "../src/kernel/kernel-key.ts";

/** A stand-in for the kernel's begin(): opens only with `key`, and records what it was given. */
function kernelWithKey(key: string | null) {
  const given: string[] = [];
  return { given, begin: (k: string) => (given.push(k), key === null || k === key) };
}

test("the app's key opens the kernel, given exactly once", () => {
  const k = kernelWithKey("75c4");
  startKernel(k.begin, { build: "b1" }, "75c4");
  assert.deepEqual(k.given, ["75c4"]);
});

test("a build that doesn't take the app's key stops the app with the build named", () => {
  const k = kernelWithKey("75c4");
  assert.throws(() => startKernel(k.begin, { build: "b1" }, "0000"), /does not match the app's key \(build b1\)/);
});

test("by default the key is kernel-key.ts's (a plain build takes any)", () => {
  const k = kernelWithKey(null);
  startKernel(k.begin, { build: "dev" });
  assert.deepEqual(k.given, [KERNEL_KEY]);
});

const wasm = new URL("../src/kernel/wasm/", import.meta.url);
const release = JSON.parse(readFileSync(new URL("kernel.json", wasm), "utf8"));

test("the committed kernel.json has the key's sha256 (never the key), a build and the modelling range", () => {
  assert.match(KERNEL_KEY, /^[0-9a-f]{32}$/);
  assert.equal("handshake" in release, false);
  // The same hash `printf %s KEY | sha256sum` gives.
  assert.equal(release.handshake_sha256, createHash("sha256").update(KERNEL_KEY).digest("hex"));
  assert.match(release.build, /^[0-9a-f]{16}$/);
  // 10 nm and 1 km in mm: the range the app promises (1 um to 1 km features, 10 nm tolerance).
  assert.deepEqual(release.limits, { LINEAR: 1e-5, MAX_SIZE: 1e6 });
});

test("no file shipped beside the build holds the key", () => {
  const files = readdirSync(wasm);
  assert.ok(files.includes("fission_kernel_bg.wasm"));
  for (const f of files) {
    const bytes = readFileSync(new URL(f, wasm));
    assert.equal(bytes.includes(KERNEL_KEY), false, f);
    assert.equal(bytes.includes(Buffer.from(KERNEL_KEY, "hex")), false, f);
  }
});
