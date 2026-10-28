// Unit tests for the main-thread kernel client helpers.
// Run with `npm test` (Node's built-in test runner).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrap, KERNEL_RESTARTED, KernelClient, KernelError, kernelFailure, latestOnly, type KernelResponse } from "../src/kernel/kernel-client.ts";

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
}

async function withFakeWorker(fn: (client: KernelClient, worker: FakeWorker) => Promise<void>) {
  const real = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  try {
    await fn(new KernelClient(), FakeWorker.last);
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
