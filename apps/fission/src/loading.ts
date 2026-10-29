// The skeleton while the app starts (@fission/ui skeleton.ts): index.html's
// skeleton of the whole workspace stays until the project is shown and the
// kernel has answered. It is invisible for its first 200 ms, so a quick
// start shows none. (A project being opened shows one over the 3D view,
// main.ts's whileOpening.)

import { adoptSkeleton } from "@fission/ui";
import type { KernelCalls } from "@fission/core";

/**
 * Takes index.html's skeleton away once `started` (the project shown on screen) has
 * settled and the kernel has answered a call sent a frame after it: the
 * worker answers in order, so that answer comes after the first build's
 * calls sent so far. A kernel that never started still lets it go (its
 * error is said where the part would be).
 */
export function appLoaded(started: Promise<unknown>, kernel: KernelCalls): Promise<void> {
  const el = document.getElementById("app-skeleton");
  if (!el) return Promise.resolve();
  const held = adoptSkeleton(el);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  return started
    .catch(() => {})
    .then(frame)
    .then(() => kernel.call("body_count"))
    .catch(() => {})
    .then(() => held.done());
}
