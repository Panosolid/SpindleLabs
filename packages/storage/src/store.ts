// Projects kept in this browser (19b): list, open, save, remove, written
// over a KeyValue. Each project is two entries:
//   project/<id>  the exact text of its .spindlelabs.json file (projectToJson)
//   summary/<id>  {"name", "modified", "order", "writer"} for the list, so listing never reads whole projects
//                 ("writer": the autosave that made the save, when it named itself, own-save.test.ts)
// and one entry for them all:
//   order         the number of the last save, counted up by each one: the summary's "order" puts the list in the
//                 order the saves happened, whatever the device's clock said (real-use hunt B5)
// Opening goes through projectFromJson, so an old project migrates exactly
// as an opened file would, and a corrupt one is refused with a message.

import { projectFromJson, projectToJson, type DataReader, type Project } from "@fission/core";
import type { KeyValue } from "./key-value.ts";

export interface ProjectSummary {
  id: string;
  name: string;
  modified: Date;
  /** The save's number, counted up across every project (0 for one saved before saves were counted). */
  order: number;
  /**
   * The autosave that made the last save, when it named itself (`save`'s `writer`): recovery knows a journal entry by
   * that same writer has no other tab's work under it (unsaved.ts, own-save.test.ts). Left out otherwise.
   */
  writer?: string;
  /** Set when this entry's summary can't be read; the project may still open. */
  problem?: string;
}

export interface ProjectStore {
  /** Every stored project, most recently saved first: by the saves' order, then (for projects saved before saves were counted) by save time. */
  list(): Promise<ProjectSummary[]>;
  /** Reads and upgrades a stored project; refuses a missing or corrupt one with a message. */
  open(id: string): Promise<Project>;
  /**
   * Stores the project under `id`, replacing what was there. `read` is when
   * the project was in that state (autosave reads it, a journal entry was
   * written), kept as its save time: the next visit compares it with a
   * journal entry's time (unsaved.ts). Left out, it is now. Given
   * `unchangedSince`, the save time of the stored project as this tab last
   * read or wrote it, the save is refused with a ProjectChangedError when
   * the store's is another (another tab saved since), so a stale tab never
   * overwrites newer work. `behind` lists it after every project saved
   * in order (save number 0, the count left as it was): a stale tab's change
   * kept as a separate project (unsaved.ts), so the project the user last
   * saw stored is still the one the app opens (real-use hunt S1). `writer`
   * names the autosave saving (`ProjectSummary.writer`; one that isn't a
   * `writerId` is left out).
   */
  save(id: string, project: Project, read?: Date, unchangedSince?: Date, behind?: boolean, writer?: string): Promise<void>;
  /** Forgets a stored project; refuses an id that is not stored. */
  remove(id: string): Promise<void>;
}

/** A save refused because another tab stored the project since this one last read or wrote it (app sweep 2026-10-28, finding 2). */
export class ProjectChangedError extends Error {
  constructor() {
    super("This project was changed in another tab. Reload to see the newer version.");
    this.name = "ProjectChangedError";
  }
}

const PROJECT = "project/";
const SUMMARY = "summary/";
const ORDER = "order";

/** A stored count, or 0 for none or anything else: a count that can't be read starts again, behind no save counted since. */
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A writer id a summary and a journal entry's head can hold: 1 to 64 letters, digits, "-" or "_" (a random UUID fits). */
export const writerId = (w: unknown): string | null => (typeof w === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(w) ? w : null);

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) throw new Error("a stored project needs a non-empty id");
  return id;
}

/** Reads a summary entry; anything odd becomes a problem on the entry, never a thrown error. */
function readSummary(id: string, text: string | undefined): ProjectSummary {
  try {
    const s: unknown = JSON.parse(text ?? "");
    if (typeof s !== "object" || s === null) throw new Error("not an object");
    const { name, modified, order, writer } = s as Record<string, unknown>;
    const when = typeof modified === "string" ? new Date(modified) : new Date(NaN);
    if (typeof name !== "string") throw new Error("no name");
    if (Number.isNaN(when.getTime())) throw new Error("no save time");
    const by = writerId(writer);
    return by === null ? { id, name, modified: when, order: count(order) } : { id, name, modified: when, order: count(order), writer: by };
  } catch (e) {
    return { id, name: id, modified: new Date(0), order: 0, problem: `this project's summary can't be read (${message(e)})` };
  }
}

/**
 * A ProjectStore over `kv`. `readers` are the workspace plugins (each one's
 * readData upgrades its own part on open); `now` is the clock, so tests can
 * fix the save time.
 */
export function projectStore(kv: KeyValue, readers: readonly DataReader[], now: () => Date = () => new Date()): ProjectStore {
  return {
    async list() {
      const ids = (await kv.keys(SUMMARY)).map((k) => k.slice(SUMMARY.length));
      const all = await Promise.all(ids.map(async (id) => readSummary(id, await kv.get(SUMMARY + id))));
      // By order first: a project saved while the clock ran ahead must not stay newest once it is put right (B5).
      return all.sort((a, b) => b.order - a.order || b.modified.getTime() - a.modified.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    async open(id) {
      checkId(id);
      const text = await kv.get(PROJECT + id);
      if (text === undefined) throw new Error(`there is no stored project "${id}" in this browser`);
      try {
        return projectFromJson(text, readers);
      } catch (e) {
        throw new Error(`can't open the stored project "${id}": ${message(e)}`);
      }
    },
    async save(id, project, read, unchangedSince, behind = false, writer) {
      checkId(id);
      const text = projectToJson(project); // refuses NaN and the like before anything is written
      // The save time is when the state was read, never when the writes finish: a journal entry written while
      // they run holds a newer state, and must not look older than this one (unsaved.ts).
      const when = read ?? now();
      if (Number.isNaN(when.getTime())) throw new Error("a stored project needs a valid save time");
      const modified = when.toISOString();
      const by = writerId(writer);
      const summaryOf = (order: number) => JSON.stringify(by === null ? { name: project.name, modified, order } : { name: project.name, modified, order, writer: by });
      // The check and both writes in one step (KeyValue.update): no other tab's save lands between them, and a tab
      // killed mid-save leaves both entries or neither (real-use hunt B6, B7).
      await kv.update([SUMMARY + id, ORDER], ([summary, last]) => {
        // No summary at all: the browser emptied the store under this tab (site data cleared), so this tab's state is
        // the only copy left and is stored again, rather than taken for another tab's change (real-use hunt B4).
        if (unchangedSince !== undefined && summary !== undefined) {
          const holds = readSummary(id, summary);
          if (holds.problem !== undefined || holds.modified.getTime() !== unchangedSince.getTime()) throw new ProjectChangedError();
        }
        if (behind) return { [PROJECT + id]: text, [SUMMARY + id]: summaryOf(0) };
        const order = count(last === undefined ? undefined : Number(last)) + 1;
        return { [PROJECT + id]: text, [SUMMARY + id]: summaryOf(order), [ORDER]: String(order) };
      });
    },
    async remove(id) {
      checkId(id);
      const [p, s] = await Promise.all([kv.get(PROJECT + id), kv.get(SUMMARY + id)]);
      if (p === undefined && s === undefined) throw new Error(`there is no stored project "${id}" to remove`);
      await kv.delete(PROJECT + id);
      await kv.delete(SUMMARY + id);
    },
  };
}

/**
 * The stored project that holds exactly `project` (compared as read, so a file's spacing or an older version doesn't
 * matter), the one saved last when there are several; none when no stored project does. Open reuses it rather than
 * storing the same file again as a new copy no one can reach (real-use hunt B3). A stored project that can't be read
 * is passed over. Only projects of the same name are read.
 */
export async function storedCopy(store: ProjectStore, project: Project): Promise<ProjectSummary | undefined> {
  const text = projectToJson(project);
  for (const summary of await store.list()) {
    if (summary.problem !== undefined || summary.name !== project.name) continue;
    try {
      if (projectToJson(await store.open(summary.id)) === text) return summary;
    } catch {
      // can't be read: not a copy of anything
    }
  }
  return undefined;
}
