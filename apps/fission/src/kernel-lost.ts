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
// Before the user has touched the page (it has just opened, on a build a
// deploy replaced), the first answer is no notice at all: the page reloads
// into the new build by itself, once (fresh-open.ts). `openLatest` looks
// for that at open too, so an old build whose kernel still loads is
// replaced as well.
import type { KernelCalls } from "@fission/core";
import { hideNotice, showNotice } from "./app-notice.ts";
import { reloadFor, watchStarted, type TabStore } from "./fresh-open.ts";

export const UPDATED = "SpindleLabs was updated while this page was open. Reload to get the new version; your design is kept.";
export const UNREACHABLE = "The geometry engine couldn't download, so parts can't be built. Check the connection; your design is kept.";

/** The paths of `doc`'s scripts (its built entry: assets/index-<hash>.js), against `base`. */
const scripts = (doc: Document, base: string) =>
  [...doc.querySelectorAll("script[src]")].map((s) => new URL(s.getAttribute("src") ?? "", base).pathname).sort();

/** Whether the user has touched this page yet (fresh-open.ts). */
const started = watchStarted(window);

/** This tab's sessionStorage, or null where it is blocked. */
function tabStore(): TabStore | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The build the site now serves, when it is another than this page's: its
 * page, fetched past every cache, names other scripts (returned, one path
 * a line). Null when it names the same, and when unknown (no answer: the
 * network).
 */
export async function liveBuild(): Promise<string | null> {
  const here = location.href.split("#")[0];
  try {
    const response = await fetch(here, { cache: "no-store" });
    if (!response.ok) return null;
    const live = new DOMParser().parseFromString(await response.text(), "text/html");
    const mine = scripts(document, here).join("\n");
    const theirs = scripts(live, here).join("\n");
    return mine !== "" && theirs !== "" && mine !== theirs ? theirs : null;
  } catch {
    return null;
  }
}

let reloading = false;
/** Reloads into the build `live` when the user hasn't started yet (and hasn't been reloaded there before); says whether it did (or already is). */
function reloadedInto(live: string | null): boolean {
  // openLatest and a missing kernel can both find the new build as the page opens: one reload, and no notice while it goes.
  if (reloading) return true;
  if (!reloadFor(live, started(), tabStore())) return false;
  reloading = true;
  location.reload();
  return true;
}

/**
 * At open: when the site already serves a newer build than the one the
 * browser handed over (kept from before a deploy), opens it, before the
 * user has touched anything. Not under offline mode's service worker,
 * which keeps a build on purpose and offers its own Reload (offline.ts).
 */
export function openLatest(live: () => Promise<string | null> = liveBuild) {
  if (navigator.serviceWorker?.controller) return;
  void live().then(reloadedInto);
}

/** Watches `kernel` for missing files and says which of the two it is (above). */
export function watchKernel(kernel: KernelCalls, live: () => Promise<string | null> = liveBuild) {
  if (!kernel.onMissing || !kernel.retry) return;
  const retry = () => {
    hideNotice("unreachable");
    kernel.retry!();
  };
  let missing = false;
  kernel.onMissing(async () => {
    missing = true;
    const build = await live();
    if (reloadedInto(build)) return;
    if (build !== null) {
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
