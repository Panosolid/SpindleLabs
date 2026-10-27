// The kernel build the app ships (from the private kernel repo's Release
// workflow) refuses every call until begin() gets the key written in the
// kernel.json beside it: a hurdle against lifting the .wasm out of the app,
// not a secret (kernel.json is served with it). A local wasm-pack build has
// no key and accepts any, so trying an unreleased kernel needs nothing here.

/** The parts of wasm/kernel.json the app reads. */
export interface KernelRelease {
  version: string;
  build: string;
  handshake: string | null;
  /** The modelling range, in mm: the kernel's tolerance.rs LINEAR and MAX_SIZE. */
  limits: { LINEAR: number; MAX_SIZE: number };
}

/** Start a freshly loaded kernel; throws if the build doesn't match its kernel.json. */
export function startKernel(begin: (key: string) => boolean, release: Pick<KernelRelease, "handshake" | "build">): void {
  if (release.handshake !== null && !begin(release.handshake)) {
    throw new Error(`the kernel build does not match its kernel.json (build ${release.build}): release it again`);
  }
}
