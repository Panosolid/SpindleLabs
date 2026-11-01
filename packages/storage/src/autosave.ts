// Autosave (19c): saves the project once things have been quiet for a
// moment after each change.
//   - Each change restarts the quiet timer, so a burst of edits is one save.
//   - One save in flight at a time; the timer firing during a save asks for
//     one more save straight after it, of whatever the project is then
//     (the latest state wins; states in between are never written).
//   - A save of text identical to the last one written is skipped.
//   - A failure is reported with its message and nothing retries on its
//     own; the next change tries again.
//   - Given the stored project's save time (`storedAt`), each save expects
//     the store still to hold that or this autosave's own last save; when
//     another tab saved since, the save is refused and reported ("This
//     project was changed in another tab…"), and nothing of this tab's is
//     journalled to be put back over that tab's work (app sweep, finding 2).
//   - When the page may be going (hidden, reloaded, closed), `leaving()`
//     writes the latest state to the unsaved-changes journal at once
//     (unsaved.ts; localStorage, which is written before the call returns,
//     where a store's save may never finish) and starts the store's save
//     without waiting for the quiet moment. A save that stores a state at
//     least as new as the journal's removes the journal entry; one that
//     stores an older state leaves it. Each entry and each save carries the
//     time its state was read, so a save also removes another tab's entry
//     older than it (two tabs, app sweep 2026-10-28, finding 1).
//   - Given the undo history to follow, every change to it is a change to
//     the project too (hunt 26h): above all an amend, a change no one
//     records (a face sketch settled, a pinned point followed once the
//     kernel answers), which can come after the edit was stored.
//   - Each autosave names itself (`writer`, a random id) in every save and
//     journal entry it makes, so the next visit knows a save of its own
//     that the browser finished after the page had gone from another tab's
//     (unsaved.ts, own-save.test.ts).

import { projectToJson, type Project } from "@fission/core";
import { ProjectChangedError, type ProjectStore } from "./store.ts";
import { journalEntry, readJournalEntry, unsavedKey, type JournalStorage } from "./unsaved.ts";

export type AutosaveStatus =
  /** Changes are waiting for the quiet moment, or being written now. */
  | { state: "saving" }
  /** Everything up to the last change is stored. */
  | { state: "saved" }
  /** The last save failed; the next change tries again. */
  | { state: "error"; message: string };

/** The clock autosave waits on; tests hand in a fake one. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
  /** How long things must be quiet after a change before saving, in ms. */
  quietMs?: number;
  timers?: Timers;
  /** Where `leaving()` keeps changes the store doesn't hold yet (the browser's localStorage); null keeps none. */
  journal?: JournalStorage | null;
  /**
   * The undo history (core history.ts): each change to it is taken as
   * `changed()`, until `stop()`, unless it leaves the project as the store
   * holds it (a fresh history, a mount's amend that fills in nothing).
   */
  follows?: { onChange(listener: () => void): () => void } | null;
  /** The store already holds `project()` as it is now (it was just opened from there). */
  stored?: boolean;
  /**
   * The stored project's save time when it was opened (ProjectSummary's
   * `modified`): each save expects the store to hold that, or this
   * autosave's own last save, and is refused when another tab saved since.
   * Left out, the first save checks nothing.
   */
  storedAt?: Date | null;
  /**
   * The project was opened from its kept journal entry (`keptEntry`, unsaved.ts: recovery couldn't store it, storage
   * full): this autosave owns that entry, saving over the older stored state, and keeps each state it journals
   * marked kept until the store has taken one (real-use hunt B1).
   */
  fromKept?: boolean;
  /** The clock journal entries are timed on (the store's, so the two compare); tests hand in a fake one. */
  now?: () => Date;
  /** This autosave's name in its saves and journal entries (store.ts `writerId`); a fresh random one by default. */
  writer?: string;
}

export interface Autosave {
  /** Call after every change to the project. */
  changed(): void;
  /**
   * Call when the page may be going (hidden, reloaded or closed): writes
   * every change the store doesn't hold yet to the journal before
   * returning, and starts the store's save now. True when every change is
   * kept (in the store or the journal); false when one would be lost (the
   * journal can't be written: storage off or full), so the page should ask
   * before going.
   */
  leaving(): boolean;
  /** Stops for good: a waiting save is dropped, one in flight finishes. */
  stop(): void;
  /**
   * Stops for good, keeping every change: the project as it is now, when the
   * store doesn't hold it yet, goes to the journal at once and is stored
   * after any save in flight. For a project being replaced (another opened,
   * a new one started) within the quiet moment of its last change, which
   * `stop()` would drop (timeline hunt follow-up).
   */
  finish(): void;
}

/** One second: long enough that typing a number is one save. A page going sooner keeps its changes through `leaving()`. */
export const QUIET_MS = 1000;

/**
 * How long a save may go unanswered before the status says storage isn't
 * answering: fifteen seconds (a phone's real saves take well under one).
 * Blind spots B2b: IndexedDB that never answered left "Saving…" for good.
 */
export const STORAGE_ANSWER_MS = 15_000;
/** The words for a save storage hasn't answered (the status line puts "Not saved: " before them). */
export const STORAGE_NOT_ANSWERING = "browser storage isn't answering, so your latest changes aren't stored yet (use Save to keep your work as a file)";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const freshWriter = () => globalThis.crypto?.randomUUID?.() ?? `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Saves `project()` to `store` under `id` a moment after each `changed()`,
 * reporting each status change to `onStatus`.
 */
export function startAutosave(
  store: ProjectStore,
  id: string,
  project: () => Project,
  onStatus: (status: AutosaveStatus) => void = () => {},
  { quietMs = QUIET_MS, timers = globalThis, journal = null, follows = null, stored: opened = false, storedAt = null, now = () => new Date(), fromKept = false, writer = freshWriter() }: AutosaveOptions = {},
): Autosave {
  let timer: unknown = null;
  let inFlight = false;
  /** The save in flight went unanswered past STORAGE_ANSWER_MS: said, and kept said until it settles. */
  let overdue = false;
  /** Settles when the save in flight (if any) has finished, either way. */
  let flight: Promise<void> = Promise.resolve();
  let again = false;
  let stopped = false;
  /** The save time of the stored project as this autosave last read or wrote it: a save expects the store to hold it still. */
  let base: Date | undefined = storedAt ?? undefined;
  /** Another tab stored the project since: this one's changes can't be stored, nor kept to be put back over that. */
  let conflicted = false;
  /** When the text last written was read (null: not written by this autosave), for the journal's times. */
  let writtenAt: Date | null = null;
  /** When the state of the last save started was read: an entry is never stamped before it, so a save of an older state that lands unheard is older than the entry (own-save.test.ts). */
  let startedAt: Date | null = null;
  /** The text last written, so an unchanged project is not written again. */
  let written: string | null = (() => {
    try {
      return opened ? projectToJson(project()) : null;
    } catch {
      return null;
    }
  })();
  // Changes are counted, so the store and the journal can be compared:
  // `version` is the number of changes so far, `storedVersion` the count
  // the store holds the project as of (the project opened counts as 0), and
  // `journalVersion` the count the journal entry holds it as of (null: no
  // entry). An entry already there when autosave starts is from a page that
  // went before its change was stored, so it counts as 0: older than
  // anything this one stores, and kept until then.
  let version = 0;
  let storedVersion = 0;
  const key = unsavedKey(id);
  let journalVersion: number | null = (() => {
    try {
      return journal?.getItem(key) != null ? 0 : null;
    } catch {
      return null;
    }
  })();

  /** A journal entry's time: now, but never before this tab's last known stored state (a clock set back must not make its own entry look older than its own save). */
  const stamp = () => new Date(Math.max(now().getTime(), base?.getTime() ?? -Infinity, writtenAt?.getTime() ?? -Infinity, startedAt?.getTime() ?? -Infinity));
  /**
   * This autosave's project was opened from the kept entry (`fromKept`): until it has stored once, the entry is its
   * own (no refusal to save), and each state it journals stays marked kept, so no other tab saves over it.
   */
  let owner = fromKept;
  /** The last visit's unsaved changes, which recovery couldn't store, are still here: nothing may be saved over them. */
  const keptFromLastVisit = () => {
    if (owner) return false;
    try {
      const entry = journal?.getItem(key);
      return entry != null && readJournalEntry(entry).kept;
    } catch {
      return false;
    }
  };
  const report = (s: AutosaveStatus) => {
    if (!stopped) onStatus(s);
  };
  /**
   * The store now holds the project as of change `v`, read at `at` (null:
   * not known): a journal entry no newer than that is not needed. That is
   * this page's entry up to change `v`, or another tab's written before
   * `at` (two tabs, app sweep finding 1), which the next visit would skip.
   */
  const stored = (v: number, at: Date | null) => {
    storedVersion = Math.max(storedVersion, v);
    try {
      if (journalVersion !== null) {
        if (journalVersion > v) return;
      } else {
        const entry = at === null ? null : journal?.getItem(key);
        const read = entry == null ? null : readJournalEntry(entry);
        // One that names the state it was made from is a change this tab never saw: the next visit keeps it (unsaved.ts).
        if (read === null || read.written === null || read.base !== null || read.written.getTime() >= at!.getTime()) return;
      }
      journal?.removeItem(key);
      journalVersion = null;
    } catch {
      // left in place: recovered over the same state next visit, or skipped there as older, which changes nothing
    }
  };

  /**
   * This tab's own entry, journalled while a save was in flight, holds a newer state made from what that save has
   * now stored (save time `at`): it names `at` as the state it goes over, so the next visit puts it back there.
   */
  const rebase = (at: Date) => {
    if (journalVersion === null) return;
    try {
      const entry = journal?.getItem(key);
      if (entry == null) return;
      const read = readJournalEntry(entry);
      if (read.written !== null) journal?.setItem(key, journalEntry(read.text, read.written, read.kept, at, read.writer ?? null));
    } catch {
      // left naming the older state: the next visit keeps it as a separate project, so nothing is lost
    }
  };

  async function save() {
    timer = null;
    if (stopped) return;
    if (inFlight) {
      again = true;
      return;
    }
    const v = version; // the project read next holds every change counted so far
    // A clock set back since the last save: just after it instead, so this save is never older than the state it
    // replaces, and a journal entry another tab stamped with that state's time is not put back over it (B5).
    const clock = now();
    const at = base !== undefined && clock.getTime() < base.getTime() ? new Date(base.getTime() + 1) : clock;
    let text: string;
    try {
      text = projectToJson(project()); // refuses NaN and the like before anything is written
    } catch (e) {
      report({ state: "error", message: message(e) });
      return;
    }
    if (keptFromLastVisit()) {
      report({ state: "error", message: "unsaved changes from your last visit couldn't be stored yet, so this tab won't save over them. Reload the page to see them." });
      return;
    }
    if (text === written) {
      stored(v, writtenAt);
      report({ state: "saved" });
      return;
    }
    inFlight = true;
    let failure: string | null = null;
    const watch = timers.setTimeout(() => {
      overdue = true;
      report({ state: "error", message: STORAGE_NOT_ANSWERING });
    }, STORAGE_ANSWER_MS);
    try {
      startedAt = at;
      const saving = store.save(id, JSON.parse(text) as Project, at, base, false, writer); // exactly the state checked above
      flight = saving.then(
        () => {},
        () => {},
      );
      await saving;
      written = text;
      writtenAt = at;
      base = at;
      owner = false; // the store holds this tab's state now: the entry, if still here, is an ordinary one
      stored(v, at);
      rebase(at);
    } catch (e) {
      if (e instanceof ProjectChangedError) conflicted = true;
      failure = message(e);
    }
    timers.clearTimeout(watch);
    overdue = false;
    inFlight = false;
    if (again) {
      again = false;
      return save();
    }
    if (failure !== null) report({ state: "error", message: failure });
    else if (timer === null) report({ state: "saved" });
  }

  function changed() {
    if (stopped) return;
    version++;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => void save(), quietMs);
    report(overdue ? { state: "error", message: STORAGE_NOT_ANSWERING } : { state: "saving" });
  }
  /** A history change: a change unless the project is what the store holds, with no save waiting or running. */
  function followed() {
    if (timer === null && !inFlight && storedVersion === version) {
      try {
        if (projectToJson(project()) === written) return;
      } catch {
        // can't be written: changed() reports it when it saves
      }
    }
    changed();
  }
  const unfollow = follows?.onChange(followed) ?? (() => {});
  function stop() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    stopped = true;
    unfollow();
  }

  return {
    changed,
    leaving() {
      if (stopped || storedVersion === version) return true;
      // Kept in the journal, it would be put back over the other tab's work on the next visit: the page asks instead.
      if (conflicted || keptFromLastVisit()) return false;
      let kept = journalVersion === version;
      if (!kept && journal) {
        try {
          journal.setItem(key, journalEntry(projectToJson(project()), stamp(), owner, base, writer));
          journalVersion = version;
          kept = true;
        } catch {
          // storage off or full, or a project that can't be written: the page should ask before going
        }
      }
      // Don't wait for the quiet moment: the page may live long enough for the store's save too.
      if (timer !== null) {
        timers.clearTimeout(timer);
        void save();
      } else if (!inFlight) void save(); // the last save failed: try once more
      return kept;
    },
    stop,
    finish() {
      if (stopped) return;
      const v = version;
      const at = stamp();
      let text: string | null = null;
      if (storedVersion !== v) {
        try {
          text = projectToJson(project()); // now: the project read later is the one replacing it
        } catch {
          // can't be written: nothing to keep that the store could hold
        }
      }
      stop();
      if (text === null || conflicted || keptFromLastVisit()) return; // after another tab's save: nothing of this one's can be stored
      // The store holds it already, unless a save of another state is running: that one lands after, so this
      // state is stored again behind it (app sweep 2026-10-28, finding 14).
      if (text === written && !inFlight) return stored(v, writtenAt);
      if (journal) {
        try {
          journal.setItem(key, journalEntry(text, at, owner, base, writer)); // kept now, should the page go before the store's save
          journalVersion = v;
        } catch {
          // storage full: the store's save below is all there is
        }
      }
      const last = text;
      void flight.then(async () => {
        try {
          startedAt = at;
          await store.save(id, JSON.parse(last) as Project, at, base, false, writer);
          written = last;
          writtenAt = at;
          owner = false;
          stored(v, at);
          rebase(at);
        } catch (e) {
          // Kept in the journal (when it could be written), put back on the next visit; unless another tab saved
          // since, when putting it back would overwrite that tab's work.
          if (e instanceof ProjectChangedError && journalVersion === v) {
            try {
              journal?.removeItem(key);
              journalVersion = null;
            } catch {
              // left in place: storage off, so it can't be read back either
            }
          }
        }
      });
    },
  };
}
