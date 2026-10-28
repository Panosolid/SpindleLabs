// Reopening the last project only when it opened fine last time (security
// audit S2). The app reopens the newest kept project on every visit, so one
// that freezes or crashes the tab while it opens would do it again on every
// visit, and the only way out would be clearing the site's data, which
// deletes every kept project. So a mark naming the project is written just
// before it opens and cleared once the tab has kept running for SETTLED_MS
// after showing it, or opening failed with a message, or the page was
// closed normally (which a frozen tab can't do). A visit that finds the
// mark still naming the project it would reopen skips it once: the mark is
// cleared, so the visit after tries again.
//
// The mark is shared by every tab, so a tab that finds it first asks the
// others (a BroadcastChannel) whether one of them is opening that project
// right now (two tabs started together, real-use hunt A3). A tab still
// opening it answers; one that froze or crashed can't, so only a mark no tab
// answers for within ASK_MS counts as a freeze. A tab clears the mark only
// while it names the project that tab was opening.

import type { Timers } from "./autosave.ts";

/** The mark's key in the browser's localStorage. */
export const OPENING_KEY = "panoshape.opening";

/** How long the tab must keep running after showing a project before it counts as opened, in ms. */
export const SETTLED_MS = 3000;

/** How long a tab that finds the mark waits for another tab to say it is opening that project, in ms. */
export const ASK_MS = 1000;

/** The part of a BroadcastChannel the guard uses: a message posted reaches every other tab's `onmessage`. */
export interface OpeningChannel {
  postMessage(data: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** The part of localStorage the guard uses (any of it may throw: storage off, private mode). */
export interface MarkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ReopenGuard {
  /**
   * True when the last visit started opening `id` and never finished, so
   * this visit should not reopen it. Clears the mark either way, so the
   * visit after this one tries again.
   */
  stuck(id: string): boolean;
  /** As `stuck`, but a mark another live tab answers for (it is opening `id` now) is no freeze, and is left alone. */
  check(id: string): Promise<boolean>;
  /** Call just before opening `id`; replaces any earlier mark. */
  opening(id: string): void;
  /** Call once `id` is shown: the mark is cleared after SETTLED_MS, unless another opening has replaced it. */
  shown(id: string): void;
  /** Call when opening ended without freezing the tab: it failed with a message, or the page was closed normally. Clears the mark only if it names what this tab was opening. */
  finished(): void;
}

/**
 * The guard over `storage`, or one that never skips when storage is null
 * or throws (a browser that can't keep the mark still opens its projects,
 * as it did before the guard).
 */
export function reopenGuard(
  storage: MarkStorage | null,
  { timers = globalThis as Timers, settledMs = SETTLED_MS, channel = null as OpeningChannel | null, askMs = ASK_MS } = {},
): ReopenGuard {
  const read = () => {
    try {
      return storage?.getItem(OPENING_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const write = (id: string | null) => {
    try {
      if (id === null) storage?.removeItem(OPENING_KEY);
      else storage?.setItem(OPENING_KEY, id);
    } catch {
      // nothing to do: without the mark the app behaves as before the guard
    }
  };
  let pending: unknown = null;
  /** The project this tab is opening, until it settles or opening ends: what it answers for. */
  let mine: string | null = null;
  /** The question this tab is waiting on: the project asked about, and what to call once a tab answers for it. */
  let waiting: { id: string; answer: () => void } | null = null;
  if (channel)
    channel.onmessage = ({ data }) => {
      const message = data as { asking?: unknown; opening?: unknown } | null;
      if (typeof message?.asking === "string" && message.asking === mine) send({ opening: mine });
      else if (typeof message?.opening === "string" && message.opening === waiting?.id) waiting.answer();
    };
  const send = (data: unknown) => {
    try {
      channel?.postMessage(data);
    } catch {
      // a closed channel: this tab can't answer, as if it froze, which only costs the other tab one skip
    }
  };
  const stuck = (id: string) => {
    const was = read();
    write(null);
    return was === id;
  };
  return {
    stuck,
    async check(id) {
      if (!channel || read() !== id) return stuck(id);
      const answered = await new Promise<boolean>((done) => {
        const timer = timers.setTimeout(() => done(false), askMs);
        waiting = {
          id,
          answer: () => {
            timers.clearTimeout(timer);
            done(true);
          },
        };
        send({ asking: id });
      });
      waiting = null;
      return answered ? false : stuck(id);
    },
    opening(id) {
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
      mine = id;
      write(id);
    },
    shown(id) {
      if (pending !== null) timers.clearTimeout(pending);
      pending = timers.setTimeout(() => {
        pending = null;
        if (mine === id) mine = null;
        if (read() === id) write(null);
      }, settledMs);
    },
    finished() {
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
      if (mine !== null && read() === mine) write(null);
      mine = null;
    },
  };
}
