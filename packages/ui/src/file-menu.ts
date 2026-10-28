// The top bar's File ▾ (U0f2a), at its left as in Fusion: New, Open…,
// Save (and Save As…), then the exports. Open, Save and Save As are the shell's (the whole
// project as a file); New and the exports are the workspace's on screen
// (Design: Start fresh, after asking, and Export STL), read each time the
// menu opens, so an entry that would do nothing is off and says why. A
// workspace with none still lists New and Export STL, off with why, so the
// menu keeps its shape wherever it is opened. Styles: the bar's
// (styles/app-bar.css) and the menu's own (styles/menu-button.css).

import { menuButton, type MenuButton, type MenuItem, type MenuSection } from "./menu-button.ts";

/** One entry of the menu (a workspace's: @fission/core FileEntry). */
export interface FileMenuEntry {
  id: string;
  label: string;
  title: string;
  off?: string;
  run(): void;
}

export interface FileMenuParts {
  /** The shell's Open… and Save. */
  open: FileMenuEntry;
  save: FileMenuEntry;
  /** Save As…, listed after Save when given: it asks for a name and place again. */
  saveAs?: FileMenuEntry;
  /** The name of what is on screen ("Slice", "Community"), for the words of an entry that is off there. */
  where(): string;
  /** The entries of the workspace on screen, or null when it has none. */
  entries(): { new?: FileMenuEntry; exports?: FileMenuEntry[] } | null;
}

/** New's id and words when the workspace on screen has nothing to clear (Design's own New keeps the id, `start-fresh`). */
export const NEW_ID = "start-fresh";
/** Why New is off where the workspace on screen has no New. */
export const noNew = (where: string) => `New: ${where} has nothing to clear yet. New clears the design in Design.`;
/** Export STL's id, and why it is off where the workspace on screen exports nothing. */
export const EXPORT_STL_ID = "file-export-stl";
export const noExport = (where: string) => `Export STL: ${where} has nothing to export yet. Design exports its bodies as STL.`;

/** The menu's sections as things are now. Pure, so it is tested by hand. */
export function fileSections(parts: FileMenuParts): MenuSection[] {
  const entries = parts.entries();
  const where = parts.where();
  // A workspace's entry runs as it is when chosen, found again by its id: the menu may have stayed open while a project
  // opened (every workspace mounted afresh) or another came on screen, and the one listed then is gone (issue #323).
  // Off or gone by then, nothing runs. Open and Save are the shell's own and never change.
  const now = (id: string) => {
    const e = parts.entries();
    return [e?.new, ...(e?.exports ?? [])].find((x) => x?.id === id);
  };
  const item = (e: FileMenuEntry, icon: MenuItem["icon"], shell = false): MenuItem => ({
    id: e.id,
    label: e.label,
    title: e.title,
    off: e.off,
    icon,
    run: () => {
      const chosen = shell ? e : now(e.id);
      if (chosen && !chosen.off) chosen.run();
    },
  });
  const newEntry = entries?.new ?? { id: NEW_ID, label: "New", title: "", off: noNew(where), run() {} };
  const exports = entries?.exports?.length ? entries.exports : [{ id: EXPORT_STL_ID, label: "Export STL", title: "", off: noExport(where), run() {} }];
  return [{ items: [item(newEntry, "new"), item(parts.open, "open", true), item(parts.save, "save", true), ...(parts.saveAs ? [item(parts.saveAs, "save", true)] : [])] }, { items: exports.map((e) => item(e, "export")) }];
}

/** File ▾ in `doc`: a menu button with the id `file-menu`. */
export function fileMenu(doc: Document, parts: FileMenuParts): MenuButton {
  return menuButton(doc, { id: "file-menu", label: "File", title: "File: New, Open, Save and Export", sections: () => fileSections(parts) });
}
