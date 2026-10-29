// Run by kernel-restart.journey.ts in a Node of its own, its WebAssembly
// memory capped (--wasm-max-mem-pages), so the real kernel runs out of
// memory as a phone's does. Prints one JSON line: whether the call that ran
// out trapped (isTrap), and what a 10 mm box asked of the same kernel
// after it gets.
import { isTrap } from "@fission/core";
import { entry as wasm } from "../../core/src/kernel/entry-points.ts";
import { loadKernel } from "../src/node-kernel.ts";

loadKernel();
const box = { box: { width: 10, depth: 10, height: 10 } };
const before = wasm.body_build(box);
let trapped: unknown = null;
// Ever bigger spheres, all kept, until the capped memory runs out.
for (let r = 1; trapped === null && r < 100_000; r++) {
  try {
    wasm.body_build({ sphere: { radius: r } });
  } catch (e) {
    trapped = e;
  }
}
let after: string;
try {
  after = `built ${wasm.body_build(box)}`;
} catch (e) {
  after = `failed, trap ${isTrap(e)}`;
}
console.log(JSON.stringify({ before, ranOut: trapped !== null, trap: isTrap(trapped), after }));
