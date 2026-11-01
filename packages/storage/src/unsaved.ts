// The unsaved-changes journal (timeline bug hunt, finding 1). Autosave
// waits for a quiet moment before saving, and the store's save is
// asynchronous, so a page reloaded or closed soon after a change would
// lose it: nothing runs once the page has gone. So when the page may be
// going, autosave writes the latest state here (`leaving()` in
// autosave.ts), in the browser's localStorage, which is written before the
// call returns. Each kept project has its own entry, the exact text of its
// .spindlelabs.json file. An entry is removed once the store holds that state
// or a newer one; one still here on the next visit holds the newest state
// of its project, and `recoverUnsaved` puts it in the store before the app
// lists or opens anything.
//
// Two tabs share the journal and the store (app sweep 2026-10-28, finding
// 1): an entry left by a tab closed before its save finished could be put
// back over newer work another tab stored since. So each entry starts with
// the time it was written ("@<ms>" and a newline), the store's save time is
// when the state it holds was read (store.ts), and an entry older than the
// stored project is skipped. An entry from before entries had a time is the
// file text alone, and is put back as it always was.
//
// A stale tab's entry (real-use hunt S1): a tab hidden before its save found
// that another tab had stored newer work journals a state newer than the
// store's, yet made from an older one. So an entry also names the save time
// of the stored state it was made from ("~<ms>" after the time), and is put
// back only over that state; over any other, it is kept as a separate
// project ("<name> (from another tab)"), so neither tab's work is lost.

import { NewerFormatError, projectFromJson, type DataReader } from "@fission/core";
import type { MarkStorage } from "./reopen.ts";
import { ProjectChangedError, type ProjectStore } from "./store.ts";

/** Every entry's key starts with this, followed by the project's stored id. */
export const UNSAVED_PREFIX = "panoshape.unsaved/";

export const unsavedKey = (id: string) => UNSAVED_PREFIX + id;

/**
 * An entry written by a newer SpindleLabs (a file format this build doesn't read) is moved here, out of the way of
 * this build's autosave (which removes the entry under UNSAVED_PREFIX once it stores the project), and kept for a
 * build that reads it; every visit's recovery tries it again (real-use hunt S2).
 */
export const NEWER_PREFIX = "panoshape.unsaved-newer/";

/** The part of localStorage the journal uses (any of it may throw: storage off, private mode, full). */
export interface JournalStorage extends MarkStorage {
  readonly length: number;
  key(index: number): string | null;
}

/** A time an entry's head can hold: 0 to 15 digits of milliseconds (every time a Date can hold until the year 33658). */
const headTime = (d: Date | null | undefined) => (d != null && Number.isSafeInteger(d.getTime()) && d.getTime() >= 0 && d.getTime() < 1e15 ? d.getTime() : null);

/**
 * The journal entry holding `text`, the file text of the project as it was at `written`. `kept` marks one the last
 * visit's recovery couldn't store ("@<ms>!"): it is put back whatever the store holds, and no tab saves over it.
 * `base` is the save time of the stored state the change was made from ("~<ms>"; left out when the tab knew none):
 * the entry is put back only over that state, and kept as a separate project otherwise.
 */
export function journalEntry(text: string, written: Date, kept = false, base: Date | null = null): string {
  const from = headTime(base);
  return `@${written.getTime()}${kept ? "!" : ""}${from === null ? "" : `~${from}`}\n${text}`;
}

/** An entry's file text, the time it was written and the save time it was made from (null for an entry without one). */
export function readJournalEntry(entry: string): { text: string; written: Date | null; kept: boolean; base: Date | null } {
  const head = /^@(\d{1,15})(!?)(?:~(\d{1,15}))?\n/.exec(entry); // 15 digits: every time a Date can hold until the year 33658
  return head
    ? { text: entry.slice(head[0].length), written: new Date(Number(head[1])), kept: head[2] === "!", base: head[3] === undefined ? null : new Date(Number(head[3])) }
    : { text: entry, written: null, kept: false, base: null };
}

/** What a stale tab's change is called when it is kept beside the newer work (real-use hunt S1). */
export const fromAnotherTab = (name: string) => `${name || "Untitled"} (from another tab)`;

const freshId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Puts every journal entry in `store`, through `projectFromJson` as an
 * opened file would be, and removes each one stored. An entry older than
 * the project the store holds (another tab stored newer work after it was
 * written) is removed without being put back. Never throws: returns
 * a message for each entry that couldn't be put back. An entry that doesn't
 * read as a project is removed (the store keeps its project as it was); one
 * the store refuses is kept, so the next visit tries again. An entry that
 * names the stored state it was made from is put back only over that state;
 * over another (a stale tab's change) it is stored as a new project, under
 * an id from `newId`, named `fromAnotherTab`, and says so.
 */
export async function recoverUnsaved(store: ProjectStore, journal: JournalStorage | null, readers: readonly DataReader[], newId: () => string = freshId): Promise<string[]> {
  const problems: string[] = [];
  const keys: string[] = [];
  if (!journal) return problems;
  try {
    for (let i = 0; i < journal.length; i++) {
      const k = journal.key(i);
      if (k !== null && ((k.startsWith(UNSAVED_PREFIX) && k.length > UNSAVED_PREFIX.length) || (k.startsWith(NEWER_PREFIX) && k.length > NEWER_PREFIX.length))) keys.push(k);
    }
  } catch {
    return problems; // storage off: there is no journal to read
  }
  if (keys.length === 0) return problems;
  const modified = new Map<string, Date>();
  try {
    for (const s of await store.list()) if (!s.problem) modified.set(s.id, s.modified);
  } catch {
    // the store can't list: every entry is put back, as one it doesn't hold would be
  }
  for (const k of keys) {
    const held = k.startsWith(NEWER_PREFIX);
    const id = k.slice((held ? NEWER_PREFIX : UNSAVED_PREFIX).length);
    let text: string | null;
    try {
      text = journal.getItem(k);
    } catch (e) {
      problems.push(`unsaved changes from your last visit couldn't be read (${message(e)})`);
      continue;
    }
    if (text === null) continue; // another tab put it back meanwhile
    const raw = text;
    const entry = readJournalEntry(text);
    const holds = modified.get(id);
    // Strictly older only: written the same millisecond, no one can tell which came first, and keeping a change beats losing one.
    if (!entry.kept && entry.base === null && entry.written !== null && holds !== undefined && entry.written.getTime() < holds.getTime()) {
      remove(journal, k);
      continue;
    }
    text = entry.text;
    let project;
    try {
      project = projectFromJson(text, readers);
    } catch (e) {
      if (e instanceof NewerFormatError) {
        if (held) continue; // said when it was moved here: still kept, silently
        try {
          journal.setItem(NEWER_PREFIX + id, raw);
          journal.removeItem(k);
        } catch {
          // storage full or off: left where it is, which keeps it too
        }
        problems.push(`unsaved changes from your last visit were made by a newer SpindleLabs, so this one opens the project as it was last saved here; those changes are kept in this browser for the newer one (${message(e)})`);
        continue;
      }
      problems.push(`unsaved changes from your last visit couldn't be read, so the project is as it was last saved (${message(e)})`);
      remove(journal, k);
      continue;
    }
    try {
      // The state as of when the entry was written; over the state it was made from only, when it names one.
      await store.save(id, project, entry.written ?? undefined, entry.kept ? undefined : (entry.base ?? undefined));
    } catch (e) {
      if (e instanceof ProjectChangedError) {
        const name = fromAnotherTab(project.name);
        try {
          await store.save(newId(), { ...project, name }, entry.written ?? undefined, undefined, true); // behind: the newer work still opens
        } catch (copyFailed) {
          problems.push(`changes made to "${project.name}" in another tab couldn't be kept as a separate project (${message(copyFailed)}); they stay in this browser, and the next visit tries again`);
          continue;
        }
        problems.push(`changes made to "${project.name}" in another tab weren't stored before it closed, and newer work was saved since, so they're kept as a separate project, "${name}", and the newer work as it was`);
        remove(journal, k);
        continue;
      }
      problems.push(`unsaved changes from your last visit couldn't be stored (${message(e)}); they are shown, and kept in this browser until it has room: Save keeps them as a file`);
      try {
        journal.setItem(unsavedKey(id), journalEntry(entry.text, entry.written ?? new Date(0), true)); // so no tab saves over them meanwhile
        if (held) journal.removeItem(k); // where keptEntry and the tabs look for it
      } catch {
        // storage off or full: kept as it was
      }
      continue;
    }
    remove(journal, k);
  }
  return problems;
}

/**
 * The file text of `id`'s entry when recovery couldn't store it (marked kept): the project's newest state, which the
 * app opens in place of the older one the store holds (real-use hunt B1), with an autosave that owns the entry
 * (`fromKept`). Null when there is no such entry, or no journal to read.
 */
export function keptEntry(journal: JournalStorage | null, id: string): string | null {
  try {
    const entry = journal?.getItem(unsavedKey(id));
    if (entry == null) return null;
    const read = readJournalEntry(entry);
    return read.kept ? read.text : null;
  } catch {
    return null;
  }
}

function remove(journal: JournalStorage, key: string) {
  try {
    journal.removeItem(key);
  } catch {
    // left in place: put back again next visit, which writes the same state
  }
}
