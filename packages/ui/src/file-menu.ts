// The top bar's File ▾ (U0f2a), at its left as in Fusion: New, Open…,
// Save, then the exports. Open and Save are the shell's (the whole
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
  const item = (e: FileMenuEntry, icon: MenuItem["icon"]): MenuItem => ({ id: e.id, label: e.label, title: e.title, off: e.off, icon, run: () => e.run() });
  const newEntry = entries?.new ?? { id: NEW_ID, label: "New", title: "", off: noNew(where), run() {} };
  const exports = entries?.exports?.length ? entries.exports : [{ id: EXPORT_STL_ID, label: "Export STL", title: "", off: noExport(where), run() {} }];
  return [{ items: [item(newEntry, "new"), item(parts.open, "open"), item(parts.save, "save")] }, { items: exports.map((e) => item(e, "export")) }];
}

/** File ▾ in `doc`: a menu button with the id `file-menu`. */
export function fileMenu(doc: Document, parts: FileMenuParts): MenuButton {
  return menuButton(doc, { id: "file-menu", label: "File", title: "File: New, Open, Save and Export", sections: () => fileSections(parts) });
}
