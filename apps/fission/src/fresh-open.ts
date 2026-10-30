// Opening the app on an old build (Ben's phone, 2026-10-30: the body from
// last session red, and "SpindleLabs was updated while this page was
// open", the moment the app opened). The live site (GitHub Pages) lets
// browsers keep its page for up to 10 minutes, and Safari reopening a tab
// keeps it longer, so a phone can open the page and scripts of a build
// that a deploy has since replaced; that build's kernel file is gone from
// the site, so every feature turns red. While the user hasn't touched the
// page yet there is nothing to interrupt: the app opens the new build by
// itself (the design is in autosave), and the notice with Reload is only
// for an update found once the user has started working. kernel-lost.ts
// does the reloading; this file holds its rules, with no page to need, so
// e2e/fresh-open.test.mjs checks them in plain Node.

/** Where the build last reloaded into is kept for the tab (sessionStorage), so a reload that still opens the old build never reloads again. */
export const RELOADED_TO = "spindlelabs.reloaded-to";

/** What counts as the user starting to work: a press, a key, a scroll, or a value typed or a file chosen (they bubble from the field). */
export const STARTED_BY = ["pointerdown", "keydown", "wheel", "input", "change"] as const;

export type TabStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/**
 * Whether to reload now to open the build `live` (its scripts, as
 * kernel-lost.ts names them; null when the site serves this page's own
 * build or couldn't be asked). Never once the user has `started`, never
 * twice for one build in a tab (a browser still handing over the old
 * build would otherwise reload for ever), and never without a `store` to
 * remember that in (blocked storage: no reload is safer than a loop).
 * Saying yes records `live` in the store.
 */
export function reloadFor(live: string | null, started: boolean, store: TabStore | null): boolean {
  if (live === null || started || store === null) return false;
  try {
    if (store.getItem(RELOADED_TO) === live) return false;
    store.setItem(RELOADED_TO, live);
    return true;
  } catch {
    return false;
  }
}

/** Starts listening for the user's first touch on `target`; the result says whether it has come. */
export function watchStarted(target: Pick<EventTarget, "addEventListener" | "removeEventListener">): () => boolean {
  let started = false;
  const mark = () => {
    started = true;
    for (const type of STARTED_BY) target.removeEventListener(type, mark, true);
  };
  for (const type of STARTED_BY) target.addEventListener(type, mark, true);
  return () => started;
}
