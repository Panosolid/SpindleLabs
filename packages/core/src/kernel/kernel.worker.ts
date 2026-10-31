// Runs the WASM kernel off the main thread. Every request is a message
// { id, op, args }; every reply is { id, ok: true, value } or { id, ok: false, error },
// the error as plain data (kind, inputs, message), since a thrown Error's own
// fields don't survive the trip between threads.
import init from "./wasm/fission_kernel.js";
import { entry as kernel } from "./entry-points.ts";
import release from "./wasm/kernel.json";
import { startKernel } from "./handshake.ts";
import { isTrap, KERNEL_NOT_DOWNLOADED, kernelFailure, type KernelReady, type KernelRequest, type KernelResponse } from "./kernel-client.ts";
import { calibrate } from "./time-limit.ts";
import type { BodyHandle, BodySpec, BooleanOp, BooleanResult, BuildPlate, Outline, SketchArc, SketchCircle, SketchLine, SupportStyle } from "./kernel-types.ts";

// A .wasm that didn't download or compile fails every call with the app's
// words, not the browser's; a build that doesn't take the app's key keeps
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
/**
 * Started: the calibration boolean timed (step 35d3, time-limit.ts), and
 * from now on the client times each call by it, never the download or the
 * calibration. A calibration that fails says none (the client takes its
 * default); a trap in it fails the first call, which replaces this kernel.
 */
ready.then(
  () => {
    let unitMs: number | undefined;
    try {
      unitMs = calibrate({ build: (spec) => kernel.body_build(spec), boolean: (t, tools, op) => kernel.body_boolean(t, tools, op), free: (b) => kernel.body_free(b), now: () => performance.now() });
    } catch {
      unitMs = undefined;
    }
    self.postMessage({ ready: true, ...(unitMs !== undefined && { unitMs }) } satisfies KernelReady);
  },
  () => {},
);

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
  body_hide: (body: BodyHandle) => kernel.body_hide(body),
  body_boolean: (target: BodyHandle, tools: BodyHandle[], op: BooleanOp): BooleanResult => kernel.body_boolean(target, tools, op),
  body_count: () => kernel.body_count(),
  slice_stl: (stl: Uint8Array<ArrayBuffer>, layerHeight: number, wallCount: number, infillPercent: number, supports: SupportStyle) => kernel.slice_stl(stl, layerHeight, wallCount, infillPercent, supports),
  print_file_stl: (stl: Uint8Array<ArrayBuffer>, layerHeight: number, wallCount: number, infillPercent: number, supports: SupportStyle, plate: BuildPlate) =>
    // The nozzle (kernel 0.33.9's 7th argument) is left out until the app's Nozzle choice: the Standard nozzle.
    kernel.print_file_stl(stl, layerHeight, wallCount, infillPercent, supports, plate, undefined),
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
