// Saving a file the way a desktop app does: the user chooses the name and
// the place. Where the browser has the save picker (Chrome, Edge) it opens,
// and the file it returned is written again, without asking, by the next
// Save. Where it hasn't (Safari, iOS, Firefox) a small box asks for the name
// and the file downloads. A page driven by a test (navigator.webdriver) skips
// both and downloads under the suggested name, so the tests that wait for a
// download need no extra click; save-name.mjs puts the real paths back.
// Styles: styles/save-name.css.

/** What kind of file is saved: its words, type and ending (with the dot). */
export interface SaveKind {
  description: string;
  mime: string;
  extension: string;
}

/** A SpindleLabs project: the ending is ours; old .json, .spindlelabs.json and .fission.json files still open (core files.ts). */
export const PROJECT_KIND: SaveKind = { description: "SpindleLabs project", mime: "application/json", extension: ".spindle" };
/** A binary STL mesh. */
export const STL_KIND: SaveKind = { description: "STL mesh", mime: "model/stl", extension: ".stl" };
/** A 3D printer's instructions (plain-text G-code). */
export const GCODE_KIND: SaveKind = { description: "G-code for a 3D printer", mime: "text/plain", extension: ".gcode" };

export interface SaveRequest {
  /** The name offered, with or without the ending. */
  suggestedName: string;
  kind: SaveKind;
  bytes: BlobPart;
  /** The file this project was last saved to: written again without asking. */
  handle?: FileHandle | null;
}

/** The part of a browser file handle that saving uses. */
export interface FileHandle {
  name: string;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

export type SaveResult =
  | { status: "saved"; name: string; handle: FileHandle | null }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

type Picker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle>;

/** The longest name offered, in characters, endings included. */
const MAX_NAME = 120;
/** And in bytes of UTF-8, endings included: file systems allow 255 bytes, and an emoji is 4 of them. */
export const MAX_NAME_BYTES = 200;

/** The longest start of `chars` (whole code points) that is at most `bytes` bytes of UTF-8. */
function fitBytes(chars: string[], bytes: number): string {
  let used = 0;
  let n = 0;
  for (const c of chars) {
    const cp = c.codePointAt(0)!;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (used + size > bytes) break;
    used += size;
    n++;
  }
  return chars.slice(0, n).join("");
}

/**
 * A file name safe on every system: `name` without its ending if it already has `extension`, with the characters
 * Windows and the browsers refuse ( \ / : * ? " < > | and control characters) turned into "-", no dots or spaces at
 * either end, `fallback` if nothing is left, then `extension` added; cut to MAX_NAME characters and MAX_NAME_BYTES
 * bytes of UTF-8 with the ending, at whole code points.
 */
export function fileNameFor(name: string, extension: string, fallback = "Untitled"): string {
  let base = name.trim();
  if (base.toLowerCase().endsWith(extension.toLowerCase())) base = base.slice(0, base.length - extension.length);
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^[.\s]+|[.\s]+$/g, "");
  // A name Windows keeps for devices (CON, NUL, COM1…) can't be a file there.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `${base}-`;
  if (base === "") base = fallback;
  const chars = [...base].slice(0, MAX_NAME - extension.length);
  return `${fitBytes(chars, MAX_NAME_BYTES - new TextEncoder().encode(extension).length)}${extension}`;
}

/** The name without its ending, for the box: what the user edits. */
export const baseNameOf = (fileName: string, extension: string) => (fileName.toLowerCase().endsWith(extension.toLowerCase()) ? fileName.slice(0, fileName.length - extension.length) : fileName);

const driven = (win: Window) => Boolean((win.navigator as Navigator & { webdriver?: boolean }).webdriver);

/** The browser's save picker, or null where there is none or a test drives the page. */
export function pickerOf(win: Window): Picker | null {
  const p = (win as Window & { showSaveFilePicker?: Picker }).showSaveFilePicker;
  return typeof p === "function" && !driven(win) ? p.bind(win) : null;
}

async function write(handle: FileHandle, bytes: BlobPart) {
  const w = await handle.createWritable();
  try {
    await w.write(bytes);
  } finally {
    await w.close();
  }
}

/** Hands `bytes` to the browser as a download named `name`. */
function download(doc: Document, bytes: BlobPart, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The small box that asks for a name: the name in a text box with the ending beside it, Save and Cancel; Enter saves,
 * Escape cancels, and a tap outside it cancels. Resolves with the name chosen (ending added), or null.
 */
export function askName(doc: Document, suggested: string, kind: SaveKind): Promise<string | null> {
  return new Promise((resolve) => {
    const previous = doc.activeElement as HTMLElement | null;
    const root = doc.createElement("div");
    root.className = "save-name";
    root.innerHTML =
      '<form role="dialog" aria-modal="true" aria-labelledby="save-name-title">' +
      '<label id="save-name-title" for="save-name-input">Name this file</label>' +
      '<div class="row"><input id="save-name-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="100" /><span class="ext"></span></div>' +
      '<p class="note">It goes to your Downloads folder, or where your browser asks.</p>' +
      '<div class="buttons"><button type="button" class="cancel">Cancel</button><button type="submit" class="ok">Save</button></div>' +
      "</form>";
    const form = root.querySelector("form")!;
    const input = root.querySelector("input")!;
    root.querySelector(".ext")!.textContent = kind.extension;
    input.value = baseNameOf(fileNameFor(suggested, kind.extension), kind.extension);
    const done = (name: string | null) => {
      root.remove();
      previous?.focus?.();
      resolve(name);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      done(fileNameFor(input.value, kind.extension));
    });
    root.querySelector(".cancel")!.addEventListener("click", () => done(null));
    root.addEventListener("pointerdown", (e) => {
      if (e.target === root) done(null);
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    });
    doc.body.append(root);
    input.focus();
    input.select();
  });
}

/**
 * Saves `request`. With its `handle` the file is written again without asking (if that fails, say the file moved or
 * the permission went, the user is asked as for a first save). Then the picker (a picked file that can't be written
 * fails, with why), then the name box. Never throws.
 */
export async function saveFile(doc: Document, request: SaveRequest): Promise<SaveResult> {
  const win = doc.defaultView!;
  const { kind, bytes } = request;
  const suggested = fileNameFor(request.suggestedName, kind.extension);
  try {
    if (request.handle) {
      try {
        await write(request.handle, bytes);
        return { status: "saved", name: request.handle.name, handle: request.handle };
      } catch {
        // Gone or no longer allowed: ask again below.
      }
    }
    const picker = pickerOf(win);
    if (picker) {
      let handle: FileHandle | null = null;
      try {
        handle = await picker({ suggestedName: suggested, types: [{ description: kind.description, accept: { [kind.mime]: [kind.extension] } }] });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return { status: "cancelled" };
        // The picker is refused here (a frame, a policy): the box does it.
      }
      if (handle) {
        // The file was picked but can't be written (disk full, no permission): say so, rather than quietly asking
        // for a name and downloading somewhere else (weak-spot hunt 10-29).
        try {
          await write(handle, bytes);
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          return { status: "failed", message: `Couldn't write "${handle.name}"${why ? `: ${why}` : ""}. Nothing was saved there; try again, or pick another place.` };
        }
        return { status: "saved", name: handle.name, handle };
      }
    }
    const name = driven(win) ? suggested : await askName(doc, suggested, kind);
    if (name === null) return { status: "cancelled" };
    download(doc, bytes, name, kind.mime);
    return { status: "saved", name, handle: null };
  } catch (e) {
    return { status: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}
