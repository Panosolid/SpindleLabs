// Ben's phone project (2026-10-28): reopened, every item that needs the
// kernel was red at once, Extrude 1 too, while the file itself builds. The
// cause, on the real kernel: a call that runs out of WebAssembly memory
// traps, and that kernel then failed every later call, even a 10 mm box.
// Since kernel 0.33.4 a call cut short no longer jams the later ones, but
// the memory it took is never given back, so the app still replaces a
// kernel that trapped (kernel-client.ts) and builds the design again on the
// fresh one (workspace.ts); here, that the trap is recognised, and that the
// project, on a fresh kernel, builds every item where it was drawn. The browser check of the whole recovery is
// apps/fission/e2e/kernel-restart.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { projectFromJson } from "@fission/core";
import { BodyCache, builtBody, designWorkspace, rebuildTimeline, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";

const FILE = new URL("../../../apps/fission/e2e/regressions/phone-project-all-red.spindle", import.meta.url);
const LINEAR = 1e-5;

test("a kernel that runs out of memory traps, the trap is recognised, and a box still builds after it", () => {
  // 400 pages of 64 KiB = 25 MiB: room to start and build a box, not for spheres kept without end.
  const out = execFileSync(process.execPath, ["--wasm-max-mem-pages=400", "--experimental-strip-types", "--no-warnings", new URL("./kernel-trap-child.ts", import.meta.url).pathname], { encoding: "utf8" });
  const got = JSON.parse(out.trim().split("\n").pop()!);
  const { after, ...rest } = got;
  assert.deepEqual(rest, { before: 1, ranOut: true, trap: true });
  // Kernel 0.33.4 on: the box after the trap builds, with a handle past the box and every sphere kept before it (so more than 2).
  const m = /^built (\d+)$/.exec(after);
  assert.ok(m !== null && Number(m[1]) > 2, `after the trap: ${after}`);
});

test("Ben's phone project builds every item on a fresh kernel, where it was drawn", async () => {
  const doc = projectFromJson(readFileSync(FILE, "utf8"), [designWorkspace]).workspaces.design as DesignDocument;
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const ids = doc.timeline.features.map((f) => f.id);
    assert.deepEqual(ids, ["sketch-1", "feature-10", "sketch-11", "sketch-12", "feature-35", "sketch-36", "feature-42", "feature-43"]);
    for (const id of ids) assert.equal(build.results[id]?.status, "built", `${id}: ${JSON.stringify(build.results[id])}`);
    const bounds = async (id: string) => {
      const b = builtBody(build, id);
      assert.ok(b !== undefined, id);
      return (await cache.view(b.handle)).bounds;
    };
    // Extrude 1: Sketch 1's rectangle, x 10.7..40.9 and y −14.7..32.6 on the XY plane, extruded 39 mm up.
    const e1 = await bounds("feature-10");
    [[10.7, -14.7, 0], [40.9, 32.6, 39]].flat().forEach((want, i) => assert.ok(Math.abs(e1.flat()[i] - want) <= LINEAR, `Extrude 1 ${JSON.stringify(e1)}`));
    // Extrude 2: drawn on Extrude 1's face at x = 40.9 (normal +x), extruded 18 mm: x 40.9..58.9.
    const e2 = await bounds("feature-35");
    assert.ok(Math.abs(e2[0][0] - 40.9) <= LINEAR && Math.abs(e2[1][0] - 58.9) <= LINEAR, `Extrude 2 ${JSON.stringify(e2)}`);
    // Move 1 shifts it 5 mm in y: the same item without the Move spans y 5 less.
    const unmoved = { ...doc, timeline: { features: doc.timeline.features.filter((f) => f.id !== "feature-43") } };
    const plain = await rebuildTimeline(unmoved, cache, kernel);
    const p = plain.results["feature-35"];
    assert.ok(p.status === "built" && p.body !== undefined);
    const e2plain = (await cache.view(p.body)).bounds;
    assert.ok(Math.abs(e2[0][1] - e2plain[0][1] - 5) <= LINEAR && Math.abs(e2[1][1] - e2plain[1][1] - 5) <= LINEAR, `moved ${JSON.stringify(e2)} vs ${JSON.stringify(e2plain)}`);
  } finally {
    await cache.close();
  }
});
