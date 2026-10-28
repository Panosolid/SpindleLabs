// The kernel build the app ships (from the private kernel repo's Release
// workflow) refuses every call until begin() gets its key. Since 2026-10-29
// the key is in none of the files beside the build (kernel.json holds only
// its sha256, which no build accepts as a key): it comes from the app's own
// code, kernel-key.ts, written by the same Release workflow, so the build's
// files lifted out of the app don't start. A hurdle, not a secret: the app
// is open. A local wasm-pack build has no key and accepts any, so trying an
// unreleased kernel needs nothing here.
import { KERNEL_KEY } from "./kernel-key.ts";

/** The parts of wasm/kernel.json the app reads. */
export interface KernelRelease {
  version: string;
  build: string;
  /** The modelling range, in mm: the kernel's tolerance.rs LINEAR and MAX_SIZE. */
  limits: { LINEAR: number; MAX_SIZE: number };
}

/** Start a freshly loaded kernel with the app's key; throws if the build doesn't take it. */
export function startKernel(begin: (key: string) => boolean, release: Pick<KernelRelease, "build">, key: string = KERNEL_KEY): void {
  if (!begin(key)) {
    throw new Error(`the kernel build does not match the app's key (build ${release.build}): release it again`);
  }
}
