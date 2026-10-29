// A body handle from a kernel that was replaced never reaches the fresh one
// (real-use hunt E1, 2026-10-28). A fresh kernel numbers its bodies from 1
// again, so before the fix an old handle freed on the new kernel removed
// whichever body now had that number: the healed design lost its part and
// the panel showed "body 1 is not in the kernel". Here the app's own
// KernelClient runs over a stand-in worker whose kernel is a body store
// numbering from 1 per worker, as the real one does, and a call can be
// made to trap (the worker answers `stopped`), so each order is exact.
// Regressions from the hunt's E1a (Extrude preview's release after a trap)
// and E1b (a free on its way when the kernel traps).
import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelClient, type BodyHandle, type BodySpec, type KernelRequest, type KernelResponse } from "@fission/core";
import { BodyCache } from "../src/rebuild.ts";

/** One worker: a kernel whose bodies count 1, 2, 3… and are refused once freed; `hold` keeps the frees' answers back. */
class StandInWorker {
  static all: StandInWorker[] = [];
  static now = () => StandInWorker.all[StandInWorker.all.length - 1];
  onmessage: ((e: { data: KernelResponse }) => void) | null = null;
  onerror: unknown = null;
  live = new Set<number>();
  next = 1;
  /** Frees asked and not answered yet, while `hold` is set. */
  held: (() => void)[] = [];
  hold = false;
  /** The next call of this op traps. */
  trapOn: string | null = null;
  constructor() {
    StandInWorker.all.push(this);
  }
  terminate() {}
  postMessage({ id, op, args }: KernelRequest) {
    const answer = () => {
      const reply = (value: unknown): KernelResponse => ({ id, ok: true, value });
      const refuse = (message: string): KernelResponse => ({ id, ok: false, error: { kind: "unknown-body", inputs: [], message } });
      if (this.trapOn === op) {
        this.trapOn = null;
        return this.onmessage?.({ data: { id, ok: false, error: { kind: "internal", inputs: [], message: "unreachable" }, stopped: true } });
      }
      const body = args[0] as number;
      if (op === "body_build") {
        this.live.add(this.next);
        return this.onmessage?.({ data: reply(this.next++) });
      }
      if (op === "body_view") return this.onmessage?.({ data: this.live.has(body) ? reply({ body }) : refuse(`body ${body} is not in the kernel`) });
      if (op === "body_free") return this.onmessage?.({ data: this.live.delete(body) ? reply(undefined) : refuse(`body ${body} is not in the kernel`) });
      this.onmessage?.({ data: reply(null) });
    };
    if (this.hold && op === "body_free") this.held.push(answer);
    else queueMicrotask(answer);
  }
}

function client() {
  (globalThis as { Worker?: unknown }).Worker = StandInWorker;
  const kernel = new KernelClient();
  const cache = new BodyCache(kernel);
  kernel.onRestart(() => cache.forget()); // as workspace.ts does
  return { kernel, cache };
}
const box = (h: number): BodySpec => ({ box: { width: 40, depth: 30, height: h } });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("E1a: Extrude's preview body released after its view trapped never frees a body of the fresh kernel", async () => {
  const { kernel, cache } = client();
  // Old kernel: the design holds two bodies; the preview builds a third (workspace.ts, Extrude preview) and its view traps.
  await cache.keepOnly([await cache.body(box(10)), await cache.body(box(20))]);
  const preview = await kernel.call("body_build", box(99));
  StandInWorker.now().trapOn = "body_view";
  await assert.rejects(kernel.call("body_view", preview), /started again/);
  const fresh = StandInWorker.now();
  // The preview's release (its .finally) after the restart: the body went with the old kernel, so it is done, and nothing is sent.
  await cache.release(preview);
  // The heal and an edit on the fresh kernel: its own numbers 1, 2, 3, the third where the preview's old number was.
  const kept = [await cache.body(box(10)), await cache.body(box(20)), await cache.body(box(30))];
  await cache.keepOnly(kept);
  // Worked by hand: the fresh kernel built three bodies (1, 2, 3) and freed none, so it holds all three.
  assert.deepEqual([...fresh.live].sort(), [1, 2, 3]);
  for (const h of kept) assert.ok(await cache.view(h), `body ${h} still drawn`);
});

test("E1b: a free on its way when the kernel traps never lands on the fresh kernel's bodies", async () => {
  const { kernel, cache } = client();
  const a = await cache.body(box(10));
  const b = await cache.body(box(20));
  await cache.keepOnly([a, b]);
  // An edit: b is no longer kept, and its free waits in the worker when another call traps.
  const old = StandInWorker.now();
  old.hold = true;
  const freeing = cache.keepOnly([a]);
  await tick();
  assert.equal(old.held.length, 1, "b's free is on its way");
  old.trapOn = "body_build";
  await assert.rejects(kernel.call("body_build", { sphere: { radius: 1e6 } }), /started again/);
  await freeing;
  const fresh = StandInWorker.now();
  assert.notEqual(fresh, old);
  // Fresh kernel: the heal builds the 10 box (its 1), an edit builds a 25 box (its 2); the next rebuild keeps both.
  const a2 = await cache.body(box(10));
  const b2 = await cache.body(box(25));
  await cache.keepOnly([a2, b2]);
  await cache.keepOnly([a2, b2]); // and again: nothing left over to retry
  assert.deepEqual([...fresh.live].sort(), [1, 2], "both kept bodies are still held");
  // The app's handles never repeat across kernels, so an old one can't be mistaken for a new body.
  assert.equal(new Set([a, b, a2, b2]).size, 4);
});

test("an old kernel's handle is refused for anything but a free, in the kernel's words; a free of it is done once", async () => {
  const { kernel } = client();
  const h = await kernel.call("body_build", box(10));
  StandInWorker.now().trapOn = "body_count";
  await assert.rejects(kernel.call("body_count"), /started again/);
  const fresh = StandInWorker.now();
  const fresh1 = await kernel.call("body_build", box(10)); // the fresh kernel's own 1
  await assert.rejects(kernel.call("body_view", h), /not in the kernel/);
  await kernel.call("body_free", h); // gone with its kernel: done
  await assert.rejects(kernel.call("body_free", h), /not in the kernel/, "freed twice is refused, as the kernel refuses it");
  assert.deepEqual([...fresh.live], [1], "the fresh kernel's body 1 was never touched");
  assert.ok(await kernel.call("body_view", fresh1));
  // A handle never given out is refused without asking the kernel.
  await assert.rejects(kernel.call("body_view", 999 as BodyHandle), /body 999 is not in the kernel/);
});
