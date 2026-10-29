// Runs the WASM kernel off the main thread. Every request is a message
// { id, op, args }; every reply is { id, ok: true, value } or { id, ok: false, error },
// the error as plain data (kind, inputs, message), since a thrown Error's own
// fields don't survive the trip between threads.
import init, * as kernel from "./wasm/fission_kernel.js";
import release from "./wasm/kernel.json";
import { startKernel } from "./handshake.ts";
import { isTrap, KERNEL_NOT_DOWNLOADED, kernelFailure, type KernelRequest, type KernelResponse } from "./kernel-client.ts";
import type { BodyHandle, BodySpec, Outline, SketchArc, SketchCircle, SketchLine } from "./kernel-types.ts";

// A .wasm that didn't download or compile fails every call with the app's
// words, not the browser's; a build that doesn't match its kernel.json keeps
// its own. Handled here once, so a failed start is never an uncaught error
// before the first call awaits it (app sweep 2026-10-28, finding 7). A
// download that fails is tried again twice, after half a second and two
// seconds, so a phone's network blinking never leaves the kernel out
// (blind spots B2); then the replies say `missing`, and the client tells
// the app (kernel-client.ts, onMissing).
let memory: WebAssembly.Memory | null = null;
let missing = false;
const DOWNLOAD_RETRIES_MS = [500, 2000];
async function download() {
  for (const wait of [...DOWNLOAD_RETRIES_MS, null]) {
    try {
      return await init();
    } catch {
      if (wait === null) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  missing = true;
  throw new Error(KERNEL_NOT_DOWNLOADED);
}
const ready = download().then((exports) => {
  memory = exports.memory;
  return startKernel(kernel.begin, release);
});
ready.catch(() => {});

const ops = {
  kernel_version: () => kernel.kernel_version(),
  make_box: (w: number, d: number, h: number) => kernel.make_box(w, d, h),
  make_cylinder: (r: number, h: number) => kernel.make_cylinder(r, h),
  make_sphere: (r: number) => kernel.make_sphere(r),
  make_extrude: (profile: Outline, distance: number) => kernel.make_extrude(profile, distance),
  export_stl: (spec: BodySpec, name: string) => kernel.export_stl(spec, name),
  snap_to_grid: (x: number, y: number, spacing: number) => kernel.snap_to_grid(x, y, spacing),
  place_freely: (x: number, y: number, pixel: number) => kernel.place_freely(x, y, pixel),
  sketch_outline: (lines: SketchLine[], circles: SketchCircle[], arcs: SketchArc[]) => kernel.sketch_outline(lines, circles, arcs),
  body_build: (spec: BodySpec) => kernel.body_build(spec),
  body_view: (body: BodyHandle) => kernel.body_view(body),
  body_stl: (body: BodyHandle, name: string) => kernel.body_stl(body, name),
  body_step: (body: BodyHandle) => kernel.body_step(body),
  body_free: (body: BodyHandle) => kernel.body_free(body),
  body_count: () => kernel.body_count(),
  wasm_bytes: () => memory?.buffer.byteLength ?? 0,
} satisfies Record<KernelRequest["op"], (...args: never[]) => unknown>;

self.onmessage = async (event: MessageEvent<KernelRequest>) => {
  const { id, op, args } = event.data;
  let reply: KernelResponse;
  try {
    await ready;
    const fn = ops[op] as (...a: unknown[]) => unknown;
    reply = { id, ok: true, value: fn(...args) };
  } catch (e) {
    // A trap leaves this kernel unfit for another call: the client replaces this worker (kernel-client.ts, restart).
    // A kernel that never downloaded says so, so the client can tell the app (kernel-client.ts, onMissing).
    reply = isTrap(e) ? { id, ok: false, error: kernelFailure(e), stopped: true } : { id, ok: false, error: kernelFailure(e), ...(missing && { missing: true as const }) };
  }
  self.postMessage(reply);
};
