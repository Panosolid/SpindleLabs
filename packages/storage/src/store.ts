// Projects kept in this browser (19b): list, open, save, remove, written
// over a KeyValue. Each project is two entries:
//   project/<id>  the exact text of its .spindlelabs.json file (projectToJson)
//   summary/<id>  {"name", "modified"} for the list, so listing never reads whole projects
// Opening goes through projectFromJson, so an old project migrates exactly
// as an opened file would, and a corrupt one is refused with a message.

import { projectFromJson, projectToJson, type DataReader, type Project } from "@fission/core";
import type { KeyValue } from "./key-value.ts";

export interface ProjectSummary {
  id: string;
  name: string;
  modified: Date;
  /** Set when this entry's summary can't be read; the project may still open. */
  problem?: string;
}

export interface ProjectStore {
  /** Every stored project, most recently saved first. */
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
   * overwrites newer work.
   */
  save(id: string, project: Project, read?: Date, unchangedSince?: Date): Promise<void>;
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

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) throw new Error("a stored project needs a non-empty id");
  return id;
}

/** Reads a summary entry; anything odd becomes a problem on the entry, never a thrown error. */
function readSummary(id: string, text: string | undefined): ProjectSummary {
  try {
    const s: unknown = JSON.parse(text ?? "");
    if (typeof s !== "object" || s === null) throw new Error("not an object");
    const { name, modified } = s as Record<string, unknown>;
    const when = typeof modified === "string" ? new Date(modified) : new Date(NaN);
    if (typeof name !== "string") throw new Error("no name");
    if (Number.isNaN(when.getTime())) throw new Error("no save time");
    return { id, name, modified: when };
  } catch (e) {
    return { id, name: id, modified: new Date(0), problem: `this project's summary can't be read (${message(e)})` };
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
      return all.sort((a, b) => b.modified.getTime() - a.modified.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
    async save(id, project, read, unchangedSince) {
      checkId(id);
      const text = projectToJson(project); // refuses NaN and the like before anything is written
      // The save time is when the state was read, never when the writes finish: a journal entry written while
      // they run holds a newer state, and must not look older than this one (unsaved.ts).
      const when = read ?? now();
      if (Number.isNaN(when.getTime())) throw new Error("a stored project needs a valid save time");
      const modified = when.toISOString();
      if (unchangedSince !== undefined) {
        // Read just before writing: another tab's save landing in between is the one gap left (IndexedDB has no compare-and-set across tabs here).
        const holds = readSummary(id, await kv.get(SUMMARY + id));
        if (holds.problem !== undefined || holds.modified.getTime() !== unchangedSince.getTime()) throw new ProjectChangedError();
      }
      await kv.set(PROJECT + id, text);
      await kv.set(SUMMARY + id, JSON.stringify({ name: project.name, modified }));
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
