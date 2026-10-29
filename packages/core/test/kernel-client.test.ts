// Unit tests for the main-thread kernel client helpers.
// Run with `npm test` (Node's built-in test runner).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrap, KERNEL_NOT_ANSWERING, KERNEL_NOT_DOWNLOADED, KERNEL_RESTARTED, KernelClient, KernelError, kernelFailure, latestOnly, type KernelResponse } from "../src/kernel/kernel-client.ts";

/** A promise we resolve by hand, to force replies out of order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("latestOnly marks only the most recent call as current, even when replies arrive out of order", async () => {
  const replies = [deferred<string>(), deferred<string>(), deferred<string>()];
  let call = 0;
  const wrapped = latestOnly(() => replies[call++].promise);

  const first = wrapped();
  const second = wrapped();
  const third = wrapped();
  // Answer the newest first, then the older ones late.
  replies[2].resolve("third");
  replies[0].resolve("first");
  replies[1].resolve("second");

  assert.deepEqual(await third, { current: true, value: "third" });
  assert.deepEqual(await first, { current: false, value: "first" });
  assert.deepEqual(await second, { current: false, value: "second" });
});

test("latestOnly with a single call is current", async () => {
  const wrapped = latestOnly(async (x: number) => x * 2);
  assert.deepEqual(await wrapped(21), { current: true, value: 42 });
});

test("latestOnly passes errors through", async () => {
  const wrapped = latestOnly(async () => {
    throw new Error("width must be positive");
  });
  await assert.rejects(wrapped(), /width must be positive/);
});

test("kernelFailure keeps the kernel's kind, inputs and message", () => {
  // What the WASM kernel throws: an Error with kind and inputs beside the message.
  const thrown = Object.assign(new Error("width must be between 0.001 and 1000000 mm, got -1"), {
    kind: "invalid-input",
    inputs: [{ input: "param", name: "width" }],
  });
  const failure = kernelFailure(thrown);
  assert.deepEqual(failure, { kind: "invalid-input", inputs: [{ input: "param", name: "width" }], message: "width must be between 0.001 and 1000000 mm, got -1" });
  // Rebuilt on the main thread it is still an Error with the same message,
  // so code that shows e.message keeps working.
  const e = new KernelError(failure);
  assert.ok(e instanceof Error);
  assert.equal(e.message, failure.message);
  assert.equal(e.kind, "invalid-input");
  assert.deepEqual(e.inputs, failure.inputs);
  // Printed as any Error was, which tests matching /^Error: …/ rely on.
  assert.equal(String(e), "Error: width must be between 0.001 and 1000000 mm, got -1");
});

test("anything else thrown is an internal failure with no inputs", () => {
  // A WASM crash: a plain Error with no kind.
  assert.deepEqual(kernelFailure(new Error("unreachable")), { kind: "internal", inputs: [], message: "unreachable" });
  // A kind the kernel never gives is not trusted, and neither are its inputs.
  const odd = Object.assign(new Error("x"), { kind: "made-up", inputs: [{ input: "line", index: 0 }] });
  assert.deepEqual(kernelFailure(odd), { kind: "internal", inputs: [], message: "x" });
  // A known kind with inputs that aren't a list keeps the kind, no inputs.
  const bare = Object.assign(new Error("y"), { kind: "unknown-body", inputs: "body" });
  assert.deepEqual(kernelFailure(bare), { kind: "unknown-body", inputs: [], message: "y" });
  // Not an Error at all.
  assert.deepEqual(kernelFailure("text"), { kind: "internal", inputs: [], message: "text" });
  assert.deepEqual(kernelFailure(null), { kind: "internal", inputs: [], message: "null" });
});

/**
 * A stand-in for the browser's Worker: records what is posted and lets a test
 * fire the worker's error event, as a browser does when the worker's script
 * can't be fetched (the page left while it loaded, a dropped connection) or
 * throws while it starts. Daily bug hunt 3e: WebKit's smoke test found a page
 * whose worker load was cancelled reporting "kernel worker crashed: undefined"
 * as an uncaught error, and every call made after that waited forever.
 */
class FakeWorker {
  static last: FakeWorker;
  static made = 0;
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string; preventDefault(): void }) => void) | null = null;
  posted: unknown[] = [];
  constructor() {
    FakeWorker.last = this;
    FakeWorker.made++;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: KernelResponse) {
    this.onmessage?.({ data });
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  /** Fires the error event; true if the client took it (preventDefault), so the browser doesn't also report it. */
  fail(message?: string) {
    let prevented = false;
    this.onerror?.({ message, preventDefault: () => (prevented = true) });
    return prevented;
  }
  answer(id: number, value: unknown) {
    this.onmessage?.({ data: { id, ok: true, value } });
  }
  /** The kernel downloaded and started (kernel.worker.ts): from now on its calls are timed. */
  ready() {
    this.onmessage?.({ data: { ready: true } });
  }
}

async function withFakeWorker(fn: (client: KernelClient, worker: FakeWorker) => Promise<void>, options?: ConstructorParameters<typeof KernelClient>[0]) {
  const real = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  try {
    await fn(new KernelClient(options), FakeWorker.last);
  } finally {
    (globalThis as { Worker?: unknown }).Worker = real;
  }
}

test("calls are answered by id through the worker", () =>
  withFakeWorker(async (client, worker) => {
    const v = client.call("kernel_version");
    assert.deepEqual(worker.posted, [{ id: 1, op: "kernel_version", args: [] }]);
    worker.answer(1, "0.30.1");
    assert.equal(await v, "0.30.1");
  }));

test("a worker that didn't load fails the call waiting on it and every later one, in words, and is taken as handled", () =>
  withFakeWorker(async (client, worker) => {
    const waiting = client.call("kernel_version");
    // A script that can't be fetched fires an error event with no message.
    assert.equal(worker.fail(undefined), true);
    const words = /The geometry kernel didn't start \(its worker didn't load\)\. Reload the page to try again\.$/;
    await assert.rejects(waiting, (e: KernelError) => e instanceof KernelError && e.kind === "internal" && words.test(e.message));
    // Nothing answers a worker that never loaded: a later call fails at once instead of waiting forever.
    const later = client.call("body_count");
    assert.equal(worker.posted.length, 1, "nothing more is posted to the dead worker");
    await assert.rejects(later, words);
  }));

test("a worker that throws while it starts says what it threw, for this call and every later one", () =>
  withFakeWorker(async (client, worker) => {
    const waiting = client.call("kernel_version");
    assert.equal(worker.fail("SyntaxError: unexpected token"), true);
    const words = /The geometry kernel stopped \(kernel worker crashed: SyntaxError: unexpected token\)\. Reload the page to try again\.$/;
    await assert.rejects(waiting, words);
    await assert.rejects(client.call("body_count"), words);
    // An empty message is no message: the same words as a worker that didn't load.
    await withFakeWorker(async (c2, w2) => {
      const p = c2.call("kernel_version");
      w2.fail("");
      await assert.rejects(p, /didn't load/);
    });
  }));

/** `(module (func (export "f") unreachable))`, by hand: calling f traps, as a kernel call that runs out of memory does. */
const TRAPS = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // "\0asm", version 1
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // types: one, () -> ()
  0x03, 0x02, 0x01, 0x00, // functions: one, of type 0
  0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00, // exports: "f", function 0
  0x0a, 0x05, 0x01, 0x03, 0x00, 0x00, 0x0b, // code: no locals, unreachable, end
]);

test("a trap is told apart from a refusal", () => {
  const f = new WebAssembly.Instance(new WebAssembly.Module(TRAPS)).exports.f as () => void;
  let trapped: unknown;
  try {
    f();
  } catch (e) {
    trapped = e;
  }
  assert.ok(trapped !== undefined, "f trapped");
  assert.equal(isTrap(trapped), true);
  // The kernel's own refusals are plain Errors with a kind: never a trap.
  assert.equal(isTrap(Object.assign(new Error("width must be positive"), { kind: "invalid-input", inputs: [] })), false);
  assert.equal(isTrap(new Error("unreachable")), false, "the word alone is not a trap");
  assert.equal(isTrap("unreachable"), false);
  assert.equal(isTrap(undefined), false);
});

const stoppedReply = (id: number): KernelResponse => ({ id, ok: false, error: { kind: "internal", inputs: [], message: "unreachable" }, stopped: true });

test("a call that stops the kernel starts a fresh one: every call sent to the old one fails, later ones go to the new one", () =>
  withFakeWorker(async (client, old) => {
    let heard = 0;
    client.onRestart(() => heard++);
    const made = FakeWorker.made;
    const first = client.call("body_build", { box: { width: 1, depth: 1, height: 1 } });
    const second = client.call("body_count");
    old.reply(stoppedReply(1));
    // Both calls the old kernel had fail with the same words; it is let go, and one new worker is made.
    await assert.rejects(first, (e: KernelError) => e instanceof KernelError && e.kind === "internal" && e.message === KERNEL_RESTARTED);
    await assert.rejects(second, (e: KernelError) => e.message === KERNEL_RESTARTED);
    assert.equal(old.terminated, true);
    assert.equal(FakeWorker.made, made + 1);
    assert.equal(heard, 1, "the listener hears of it once");
    const fresh = FakeWorker.last;
    assert.notEqual(fresh, old);
    // The next call goes to the new kernel (ids go on counting) and its answer is used.
    const third = client.call("body_count");
    assert.deepEqual(fresh.posted, [{ id: 3, op: "body_count", args: [] }]);
    // A late word from the old kernel is never taken, even for an id the new one is waiting on.
    old.answer(3, 99);
    fresh.answer(3, 0);
    assert.equal(await third, 0);
    // An error event from the old worker no longer counts either: the new one keeps working.
    old.fail("gone");
    const fourth = client.call("kernel_version");
    fresh.answer(4, "0.32.30");
    assert.equal(await fourth, "0.32.30");
  }));

test("a refusal is only a refusal: the kernel is kept, and a listener that stopped listening hears nothing", () =>
  withFakeWorker(async (client, worker) => {
    let heard = 0;
    const stop = client.onRestart(() => heard++);
    const made = FakeWorker.made;
    const refused = client.call("make_box", -1, 1, 1);
    worker.reply({ id: 1, ok: false, error: { kind: "invalid-input", inputs: [], message: "width must be positive" } });
    await assert.rejects(refused, /width must be positive/);
    assert.equal(FakeWorker.made, made, "no new worker");
    assert.equal(worker.terminated, false);
    assert.equal(heard, 0);
    stop();
    client.call("body_count").catch(() => {});
    worker.reply(stoppedReply(2));
    assert.equal(heard, 0, "stopped listening");
    assert.equal(FakeWorker.made, made + 1, "the kernel is still replaced");
  }));

const missingReply = (id: number): KernelResponse => ({ id, ok: false, error: { kind: "internal", inputs: [], message: KERNEL_NOT_DOWNLOADED }, missing: true });

test("a kernel whose .wasm didn't download is told once; retry starts a fresh one, and the design's listeners hear of it", () =>
  withFakeWorker(async (client, old) => {
    let missing = 0;
    let restarted = 0;
    client.onMissing(() => missing++);
    client.onRestart(() => restarted++);
    // A working kernel is never replaced by retry.
    const made = FakeWorker.made;
    client.retry();
    assert.equal(FakeWorker.made, made, "retry leaves a working kernel alone");
    const a = client.call("body_count");
    const b = client.call("kernel_version");
    old.reply(missingReply(1));
    old.reply(missingReply(2));
    await assert.rejects(a, (e: KernelError) => e.message === KERNEL_NOT_DOWNLOADED);
    await assert.rejects(b, (e: KernelError) => e.message === KERNEL_NOT_DOWNLOADED);
    assert.equal(missing, 1, "told once, however many calls fail");
    assert.equal(restarted, 0, "nothing rebuilds on a kernel that isn't there");
    // A plain failure is not a missing kernel.
    const c = client.call("make_box", -1, 1, 1);
    old.reply({ id: 3, ok: false, error: { kind: "invalid-input", inputs: [], message: "width must be positive" } });
    await assert.rejects(c, /width must be positive/);
    assert.equal(missing, 1);

    client.retry();
    assert.equal(old.terminated, true, "the old worker is let go");
    assert.equal(FakeWorker.made, made + 1, "one fresh worker");
    assert.equal(restarted, 1, "the design is built again on it");
    const fresh = FakeWorker.last;
    const d = client.call("body_count");
    fresh.answer(4, 0);
    assert.equal(await d, 0);
    // The fresh worker failing too is told again.
    const e = client.call("body_count");
    fresh.reply(missingReply(5));
    await assert.rejects(e);
    assert.equal(missing, 2);
  }));

test("a worker script that didn't load (a deploy took it away) is a missing kernel: retry clears the failure", () =>
  withFakeWorker(async (client, old) => {
    let missing = 0;
    client.onMissing(() => missing++);
    old.fail(undefined);
    assert.equal(missing, 1);
    await assert.rejects(client.call("body_count"), /didn't load/);
    // A worker that crashed with a message did load: it is not a missing file.
    await withFakeWorker(async (c2, w2) => {
      let m2 = 0;
      c2.onMissing(() => m2++);
      w2.fail("SyntaxError: unexpected token");
      assert.equal(m2, 0);
    });
    client.retry();
    const fresh = FakeWorker.last;
    const p = client.call("body_count");
    assert.equal(fresh.posted.length, 1, "calls go to the fresh worker, the old failure forgotten");
    fresh.answer((fresh.posted[0] as { id: number }).id, 2);
    assert.equal(await p, 2);
  }));

// Blind spots B2b (2026-10-29): the worker lost in the middle of a call. Seen
// in a real browser first (e2e/kernel-lost.mjs): a worker that stopped
// answering (a kernel stuck in a loop, or a worker the browser closed, which
// fires no event at all) left the design "rebuilding" for good, every later
// edit queued behind it and nothing said; one that crashed with an uncaught
// error said "Reload the page" for good, though a fresh kernel works.
// Timers here are Node's mock timers, so each wait is exact.
const DEADLINE = 1000;

test("a kernel silent past its deadline is let go: every call waiting fails in words, a fresh one is started, the design hears once", (t) =>
  withFakeWorker(
    async (client, old) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let heard = 0;
      client.onRestart(() => heard++);
      const made = FakeWorker.made;
      old.ready();
      const stuck = client.call("body_build", { box: { width: 1, depth: 1, height: 1 } });
      const queued = client.call("body_count");
      // 1.1 × the deadline with no answer at all: the kernel is lost.
      t.mock.timers.tick(DEADLINE * 1.1);
      await assert.rejects(stuck, (e: KernelError) => e instanceof KernelError && e.kind === "internal" && e.message === KERNEL_NOT_ANSWERING);
      await assert.rejects(queued, (e: KernelError) => e.message === KERNEL_NOT_ANSWERING);
      assert.equal(old.terminated, true, "the silent worker is let go");
      assert.equal(FakeWorker.made, made + 1, "one fresh worker");
      assert.equal(heard, 1, "the design is built again, once");
      const fresh = FakeWorker.last;
      const next = client.call("body_count");
      assert.equal(fresh.posted.length, 1, "the next call goes to the fresh kernel");
      fresh.answer((fresh.posted[0] as { id: number }).id, 0);
      assert.equal(await next, 0);
      // The old kernel's late answer is never taken.
      old.answer(1, 7);
    },
    { answerWithinMs: DEADLINE },
  ));

test("a kernel answering each call within its deadline is kept, however long the calls take together (0.9 × each)", (t) =>
  withFakeWorker(
    async (client, worker) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let heard = 0;
      client.onRestart(() => heard++);
      worker.ready();
      const calls = [client.call("body_count"), client.call("body_count"), client.call("body_count")];
      // Each answer comes 0.9 × the deadline after the one before: 2.7 × in all, never cut.
      for (let id = 1; id <= 3; id++) {
        t.mock.timers.tick(DEADLINE * 0.9);
        worker.answer(id, id);
      }
      assert.deepEqual(await Promise.all(calls), [1, 2, 3]);
      assert.equal(worker.terminated, false);
      assert.equal(heard, 0);
      // Nothing waiting: a kernel left idle for any time is never let go.
      t.mock.timers.tick(DEADLINE * 100);
      assert.equal(worker.terminated, false, "idle is not lost");
    },
    { answerWithinMs: DEADLINE },
  ));

test("more calls sent to a silent kernel never push its deadline back", (t) =>
  withFakeWorker(
    async (client, worker) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      worker.ready();
      const waiting = [client.call("body_count")];
      t.mock.timers.tick(DEADLINE * 0.6);
      waiting.push(client.call("body_count"));
      t.mock.timers.tick(DEADLINE * 0.5); // 1.1 × since the first call, 0.5 × since the second
      assert.equal(worker.terminated, true, "timed from the first call left waiting");
      for (const w of waiting) await assert.rejects(w, (e: KernelError) => e.message === KERNEL_NOT_ANSWERING);
    },
    { answerWithinMs: DEADLINE },
  ));

test("the kernel's download is never timed: calls wait for it however long it takes, then each is timed", (t) =>
  withFakeWorker(
    async (client, worker) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const first = client.call("kernel_version");
      // A slow phone network: the .wasm takes 50 × the deadline to arrive.
      t.mock.timers.tick(DEADLINE * 50);
      assert.equal(worker.terminated, false, "still downloading, not lost");
      worker.ready();
      // From the moment it started, the call waiting is timed: 0.9 × is fine, then it answers.
      t.mock.timers.tick(DEADLINE * 0.9);
      worker.answer(1, "0.32.30");
      assert.equal(await first, "0.32.30");
      assert.equal(worker.terminated, false);
    },
    { answerWithinMs: DEADLINE },
  ));

test("a started kernel that crashes in the middle of a call is started again, never left failing for good", () =>
  withFakeWorker(async (client, old) => {
    let heard = 0;
    client.onRestart(() => heard++);
    old.ready();
    const waiting = client.call("body_build", { box: { width: 1, depth: 1, height: 1 } });
    assert.equal(old.fail("Uncaught Error: planted crash"), true, "taken as handled");
    await assert.rejects(waiting, (e: KernelError) => e.message === KERNEL_RESTARTED);
    assert.equal(old.terminated, true);
    assert.equal(heard, 1);
    const fresh = FakeWorker.last;
    assert.notEqual(fresh, old);
    const next = client.call("body_count");
    fresh.answer((fresh.posted[0] as { id: number }).id, 0);
    assert.equal(await next, 0, "later calls work on the fresh kernel");
  }));

test("the default deadline is a minute: a long call on a slow phone is never cut short at 54 s", (t) =>
  withFakeWorker(async (client, worker) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    worker.ready();
    const call = client.call("body_count");
    // 0.9 × 60 s: kept.
    t.mock.timers.tick(54_000);
    assert.equal(worker.terminated, false);
    // 1.1 × 60 s: lost.
    t.mock.timers.tick(12_000);
    assert.equal(worker.terminated, true);
    await assert.rejects(call);
  }));
