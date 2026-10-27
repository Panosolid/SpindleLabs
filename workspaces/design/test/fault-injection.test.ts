// Frontier testing T6b (docs/progress/frontier-testing.md): the kernel
// failing once, at any call, must leave nothing behind in BodyCache that
// breaks the next call. Regression tests for the leftovers found while
// building the fault-injection journey (packages/testing/journeys/fault-injection.journey.ts):
// a failed view was remembered, so the body's view failed for as long as
// the body was kept; a failed free threw out of the use (losing a rebuild
// that had built everything) and forgot the body, which the kernel then
// held for ever. On a stand-in kernel as in body-cache.test.ts, its nth
// call failing as an internal kernel error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelError, type BodyHandle, type BodySpec, type KernelCalls } from "@fission/core";
import { BodyCache } from "../src/rebuild.ts";

/** A kernel that builds handles 1, 2, 3… and keeps them until freed; `fail(op)` makes the next call of `op` fail once. */
function standIn() {
  const live = new Set<BodyHandle>();
  let next = 1;
  const failing = new Set<string>();
  const asked: string[] = [];
  const kernel: KernelCalls = {
    call: (async (op: string, arg: unknown) => {
      asked.push(op);
      if (failing.delete(op)) throw new KernelError({ kind: "internal", inputs: [], message: `injected: ${op}` });
      if (op === "body_build") {
        const h = next++ as BodyHandle;
        live.add(h);
        return h;
      }
      if (op === "body_view") {
        if (!live.has(arg as BodyHandle)) throw new Error(`body ${arg} is not held`);
        return { handle: arg };
      }
      if (op === "body_free") {
        if (!live.delete(arg as BodyHandle)) throw new Error(`body ${arg} freed twice`);
        return;
      }
      throw new Error(`no ${op}`);
    }) as KernelCalls["call"],
  };
  return { kernel, live: () => [...live].sort((a, b) => a - b), fail: (op: string) => void failing.add(op), asked };
}

const box = (h: number): BodySpec => ({ box: { width: 40, depth: 30, height: h } }) as unknown as BodySpec;

test("a view that failed once is asked again, not remembered as failed", async () => {
  const k = standIn();
  const cache = new BodyCache(k.kernel);
  const h = await cache.body(box(20));
  k.fail("body_view");
  await assert.rejects(cache.view(h), /injected: body_view/);
  // The kernel answers now: the same body's view is asked again and given.
  assert.deepEqual(await cache.view(h), { handle: h });
  // And kept once given: a third look asks nothing.
  const views = k.asked.filter((op) => op === "body_view").length;
  await cache.view(h);
  assert.equal(k.asked.filter((op) => op === "body_view").length, views);
});

test("a free that failed doesn't fail the use, and the body is freed at the next chance", async () => {
  const k = standIn();
  const cache = new BodyCache(k.kernel);
  // A use builds 1 and 2 and keeps 2; ending, it frees 1, and that free fails.
  k.fail("body_free");
  const kept = await cache.using(async () => {
    await cache.body(box(20));
    const h = await cache.body(box(25));
    await cache.keepOnly([h]);
    return h;
  });
  assert.equal(kept, 2, "the use's own answer, not the free's failure");
  assert.deepEqual(k.live(), [1, 2], "1 is still held: its free failed");
  // Tried again when the next use ends, once.
  await cache.using(async () => void (await cache.body(box(25))));
  assert.deepEqual(k.live(), [2]);
  await cache.clear();
  assert.deepEqual(k.live(), []);
});

test("a failed free during keepOnly with no use running is tried again too", async () => {
  // Worked by hand: 1, 2, 3 built; keepOnly([3]) frees 1 (fails) and 2; the next keepOnly frees 1.
  const k = standIn();
  const cache = new BodyCache(k.kernel);
  await cache.body(box(20));
  await cache.body(box(21));
  const three = await cache.body(box(22));
  k.fail("body_free");
  await cache.keepOnly([three]);
  assert.deepEqual(k.live(), [1, 3]);
  await cache.keepOnly([three]);
  assert.deepEqual(k.live(), [3]);
  assert.equal(cache.size, 1);
});

test("a closed cache tries a failed free once more at once: there is no next chance", async () => {
  // Worked by hand: 1 built; close frees it, that free fails, and the second try (the kernel well again) frees it.
  const k = standIn();
  const cache = new BodyCache(k.kernel);
  await cache.body(box(20));
  k.fail("body_free");
  await cache.close();
  assert.deepEqual(k.live(), []);
  assert.equal(k.asked.filter((op) => op === "body_free").length, 2);
});

test("a body released (Extrude's preview) whose free fails is freed at the next chance", async () => {
  const k = standIn();
  const cache = new BodyCache(k.kernel);
  // The preview's body is built outside the cache: handle 1.
  const preview = (await k.kernel.call("body_build", box(20) as never)) as BodyHandle;
  k.fail("body_free");
  await cache.release(preview);
  assert.deepEqual(k.live(), [1], "its free failed");
  await cache.keepOnly([]);
  assert.deepEqual(k.live(), []);
});
