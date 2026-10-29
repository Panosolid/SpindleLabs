// The kernel's files didn't download (blind spots B2; Ben's phone project,
// 2026-10-28: every item that needs the kernel red, and nothing said why).
// Two causes, two answers, and the design is kept either way:
// - a new build went live since this page loaded (a deploy while a phone's
//   tab slept): the old build's kernel files are gone for good, so the
//   notice says SpindleLabs was updated and offers Reload, which opens the
//   new build with the design (autosave and its journal keep it);
// - the network: the notice says the engine couldn't download and offers
//   Try again, which starts a fresh kernel in this page and builds the
//   design on it; coming back online or to the tab tries again by itself.
// The worker has already tried the .wasm three times (kernel.worker.ts).
import type { KernelCalls } from "@fission/core";
import { hideNotice, showNotice } from "./app-notice.ts";

export const UPDATED = "SpindleLabs was updated while this page was open. Reload to get the new version; your design is kept.";
export const UNREACHABLE = "The geometry engine couldn't download, so parts can't be built. Check the connection; your design is kept.";

/** The paths of `doc`'s scripts (its built entry: assets/index-<hash>.js), against `base`. */
const scripts = (doc: Document, base: string) =>
  [...doc.querySelectorAll("script[src]")].map((s) => new URL(s.getAttribute("src") ?? "", base).pathname).sort();

/**
 * Whether the site now serves another build than this page's: its page,
 * fetched past every cache, names other scripts. Unknown (no answer: the
 * network) counts as not updated.
 */
export async function siteUpdated(): Promise<boolean> {
  const here = location.href.split("#")[0];
  try {
    const response = await fetch(here, { cache: "no-store" });
    if (!response.ok) return false;
    const live = new DOMParser().parseFromString(await response.text(), "text/html");
    const mine = scripts(document, here);
    const theirs = scripts(live, here);
    return mine.length > 0 && theirs.length > 0 && mine.join("\n") !== theirs.join("\n");
  } catch {
    return false;
  }
}

/** Watches `kernel` for missing files and says which of the two it is (above). */
export function watchKernel(kernel: KernelCalls, updated: () => Promise<boolean> = siteUpdated) {
  if (!kernel.onMissing || !kernel.retry) return;
  const retry = () => {
    hideNotice("unreachable");
    kernel.retry!();
  };
  let missing = false;
  kernel.onMissing(async () => {
    missing = true;
    if (await updated()) {
      showNotice("updated", UPDATED, { label: "Reload", title: "Reload to use the new version; your design is kept", press: () => location.reload() });
    } else if (missing) {
      showNotice("unreachable", UNREACHABLE, { label: "Try again", title: "Download the geometry engine again; your design is kept", press: retry });
    }
  });
  kernel.onRestart?.(() => (missing = false));
  const again = () => {
    if (missing && document.getElementById("app-update")?.dataset.kind === "unreachable") retry();
  };
  window.addEventListener("online", again);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") again();
  });
}
