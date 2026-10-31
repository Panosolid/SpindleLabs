// Slice for printing (H2a, the slicer's first step into the app): every
// body shown, sliced by the slicing engine with the owner's printer's
// defaults (Bambu Lab P1S, 0.4 mm nozzle, PLA) and the beginner's four
// choices (quality, walls, infill, supports), downloaded as the P1S's own
// print file (.gcode.3mf, W6c: its start and end routines, for the build
// plate chosen) or, for another printer, plain G-code. The workspace offers it as File ▾
// > Slice for printing; its dialog holds the choices, says what the slice
// came to (layers, filament) and warns about any part too thin to print.
// Nothing is saved into the project: choices, never results (decision 6,
// docs/progress/slice.md). Styles: src/styles/slice-print.css.

import type { BuildPlate, Feature, KernelCalls, P1sPrintFile, SlicedPrint, StlFile, SupportStyle } from "@fission/core";
import type { SaveKind } from "@fission/ui";
import type { DesignDocument } from "./document.ts";
import { endSpec } from "./move-tool.ts";

/** The beginner's choices: layer height (mm), walls, infill (%), and supports under overhangs (off, normal or tree). */
export interface PrintChoices {
  layerHeight: number;
  walls: number;
  infill: number;
  supports: SupportStyle;
}

/** The P1S's defaults for a 0.4 mm nozzle and PLA, as the engine's own (0.2 mm layers, 2 walls, 15 % infill, no supports). */
export const PRINT_DEFAULTS: PrintChoices = { layerHeight: 0.2, walls: 2, infill: 15, supports: "off" };

/** Each choice's options, as the dialog lists them. */
export const QUALITY_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "Fine (0.12 mm layers)", value: 0.12 },
  { label: "Detailed (0.16 mm layers)", value: 0.16 },
  { label: "Standard (0.2 mm layers)", value: 0.2 },
  { label: "Fast (0.28 mm layers)", value: 0.28 },
];
export const WALL_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const INFILL_OPTIONS: readonly number[] = [0, 10, 15, 20, 25, 40, 60, 100];
export const SUPPORT_OPTIONS: readonly { label: string; value: SupportStyle }[] = [
  { label: "Off", value: "off" },
  { label: "Normal (columns)", value: "normal" },
  { label: "Tree (less plastic)", value: "tree" },
];

/** The nozzle fitted to the P1S, as the engine names it (kernel-types.ts' NozzleType: the kernel call checks the two agree). */
export type NozzleType = "standard" | "high-flow";

/** Which file to save: the P1S's print file, or plain G-code for another printer. */
export type PrintFormat = "p1s" | "gcode";

/** The file's choices: its kind and, for the P1S's, the build plate (the owner's textured PEI by default) and the nozzle fitted (the stock Standard by default; the dialog remembers the last one chosen, as a printer's nozzle rarely changes). */
export interface FileChoices {
  format: PrintFormat;
  plate: BuildPlate;
  nozzle: NozzleType;
}

export const FILE_DEFAULTS: FileChoices = { format: "p1s", plate: "textured", nozzle: "standard" };

/**
 * The file kinds, as the dialog lists them. The plain file's start
 * routine primes a line across the P1S plate's front-left corner, which
 * the P1S keeps clear, so it is named as not for the P1S.
 */
export const FORMAT_OPTIONS: readonly { label: string; value: PrintFormat }[] = [
  { label: "Bambu Lab P1S (.gcode.3mf)", value: "p1s" },
  { label: "Plain G-code, not for the P1S (.gcode)", value: "gcode" },
];
export const PLATE_OPTIONS: readonly { label: string; value: BuildPlate }[] = [
  { label: "Textured PEI plate", value: "textured" },
  { label: "Smooth, cool or engineering plate", value: "smooth" },
];
export const NOZZLE_OPTIONS: readonly { label: string; value: NozzleType }[] = [
  { label: "0.4 mm Standard", value: "standard" },
  { label: "0.4 mm High Flow", value: "high-flow" },
];

/** Where the dialog keeps the nozzle last chosen (this browser only). */
export const NOZZLE_KEY = "spindlelabs.slice.nozzle";

/** The nozzle last chosen, or the default when none was kept, the value is not one of ours, or storage is blocked. */
export function rememberedNozzle(storage: Pick<Storage, "getItem"> | null): NozzleType {
  try {
    const v = storage?.getItem(NOZZLE_KEY);
    return v === "standard" || v === "high-flow" ? v : FILE_DEFAULTS.nozzle;
  } catch {
    return FILE_DEFAULTS.nozzle;
  }
}

/** The P1S's print file, as the save box names it. */
export const P1S_KIND: SaveKind = { description: "Bambu Lab P1S print file", mime: "model/3mf", extension: ".gcode.3mf" };

/** What the dialog says of any slice, plain or packed. */
export type PrintFacts = Pick<SlicedPrint, "layers" | "filamentMm" | "filamentG" | "printTimeS" | "unprintedVolume">;

/**
 * The bodies' STL files back to back, one file per body, as the engine
 * reads them: each body stays its own mesh, so two that touch are never
 * welded into one (the engine joins their overlaps itself).
 */
export function stackStl(files: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(files.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of files) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/** The bodies shown as the engine reads them: each body's STL from the kernel, back to back. */
async function bodiesStl(kernel: KernelCalls, doc: DesignDocument, features: readonly Feature[]): Promise<Uint8Array<ArrayBuffer>> {
  if (features.length === 0) throw new Error("There is no body to slice: make or show one first.");
  const files: StlFile[] = [];
  for (const f of features) files.push(await kernel.call("export_stl", await endSpec(kernel, doc, f), "body"));
  return stackStl(files.map((f) => f.bytes));
}

/** Slices `features` (bodies, in build order) as they are shown: each body's STL from the kernel, then the engine. */
export async function sliceBodies(kernel: KernelCalls, doc: DesignDocument, features: readonly Feature[], choices: PrintChoices): Promise<SlicedPrint> {
  const stl = await bodiesStl(kernel, doc, features);
  return kernel.call("slice_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports);
}

/** The same slice as the P1S's print file for `plate` and the `nozzle` fitted. */
export async function printFileOf(kernel: KernelCalls, doc: DesignDocument, features: readonly Feature[], choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle): Promise<P1sPrintFile> {
  const stl = await bodiesStl(kernel, doc, features);
  return kernel.call("print_file_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports, plate, nozzle);
}

/**
 * The G-code inside a P1S print file (a ZIP the engine writes with every file stored, never compressed): the plate's
 * Metadata/plate_1.gcode, as the printer would run it. Null when the bytes are not such a ZIP or hold no plate, so
 * the caller can fall back to the plain slice. The preview draws this, so it shows the file that is downloaded (its
 * time, its filament, its own start routine), not the plain file's (slicer hunt 2026-10-31, finding 4).
 */
export function gcodeOfPackage(bytes: Uint8Array): string | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 30 <= bytes.length && v.getUint32(at, true) === 0x04034b50) {
    const stored = v.getUint16(at + 8, true) === 0;
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const start = at + 30 + nameLen + v.getUint16(at + 28, true);
    if (start + size > bytes.length) return null;
    if (stored && new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen)) === "Metadata/plate_1.gcode") return new TextDecoder().decode(bytes.subarray(start, start + size));
    at = start + size;
  }
  return null;
}

/**
 * The layer moves of a P1S file's G-code, for the preview: from the first ";LAYER_CHANGE" to the end routine, absolute
 * moves with relative feeds. The file's start routine (purge, wipe, load line) lays plastic at heights of its own, which
 * the replayer would count as layers (a 20 mm cube read as 99 layers, not 100), and the end routine is not the part.
 */
export function printMovesOf(gcode: string): string | null {
  const first = gcode.search(/^;LAYER_CHANGE$/m);
  if (first < 0) return null;
  const end = gcode.indexOf(";===== end", first);
  // The height the nozzle was lifted to just before the first layer is set by the routine's last Z move: keep it.
  const zs = [...gcode.slice(0, first).matchAll(/^G[01] [^;\n]*\bZ(-?\d+(?:\.\d+)?)/gm)];
  const z = zs.length > 0 ? `G1 Z${zs[zs.length - 1][1]}\n` : "";
  return `G90\nM83\n${z}${gcode.slice(first, end < 0 ? undefined : end)}`;
}

/** Thrown by an event when the dialog was closed while it worked: the result is dropped, nothing is saved or shown. */
export class SliceDropped extends Error {
  constructor() {
    super("The dialog was closed before the slice finished.");
  }
}

/**
 * The engine's refusal in words for a beginner: "the part ... runs from (-22, 118) to (278, 138), off the 256 × 256 mm bed"
 * becomes how wide the part is and what the plate takes; "layer 1280 reaches z = 256.2 mm, above the printer's 256 mm"
 * becomes how tall. Any other message is kept, starting with a capital.
 */
export function refusalWords(message: string): string {
  const across = /runs from \((-?[\d.]+), (-?[\d.]+)\) to \((-?[\d.]+), (-?[\d.]+)\), off the (\d+) × (\d+) mm bed/.exec(message);
  if (across) {
    const [w, d] = [Number(across[3]) - Number(across[1]), Number(across[4]) - Number(across[2])];
    const wide = Math.max(w, d);
    return `The part is ${Math.round(wide * 10) / 10} mm ${w >= d ? "wide" : "deep"}, and the P1S's plate takes ${across[5]} × ${across[6]} mm. Make it smaller or split it into pieces.`;
  }
  const tall = /reaches z = ([\d.]+) mm, above the printer's ([\d.]+) mm/.exec(message);
  if (tall) return `The part is about ${tall[1]} mm tall, and the P1S prints up to ${tall[2]} mm. Make it shorter or split it into pieces.`;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** The plain file's name: the layer height, the walls and infill and its supports, so two slices of one part never share a name. */
export function gcodeName(choices: PrintChoices, project?: string): string {
  return `${baseName(choices, project)}.gcode`;
}

/**
 * The P1S file's name: as the plain file's, plus the plate and, for a High Flow nozzle, "high-flow", so a file for one
 * plate or nozzle is never taken for another's.
 */
export function printFileName(choices: PrintChoices, plate: BuildPlate, nozzle: NozzleType = FILE_DEFAULTS.nozzle, project?: string): string {
  return `${baseName(choices, project)}-${plate}${nozzle === "high-flow" ? "-high-flow" : ""}${P1S_KIND.extension}`;
}

/**
 * The project's name leads a file's name, so files of different projects look different on the printer's list; a project
 * not named yet (empty, or the "Untitled" it starts with) gives "spindlelabs".
 */
export const nameLead = (project?: string): string => {
  const name = (project ?? "").trim();
  return name === "" || /^untitled$/i.test(name) ? "spindlelabs" : name;
};

const baseName = (choices: PrintChoices, project?: string) => `${nameLead(project)}-${choices.layerHeight}mm-${choices.walls}w-${choices.infill}pc${SUPPORT_SUFFIX[choices.supports]}`;

/** Normal supports keep the name they had when supports were on or off. */
const SUPPORT_SUFFIX: Record<SupportStyle, string> = { off: "", normal: "-supports", tree: "-tree-supports" };

/** The supports select's value as a style: anything it does not list is off. */
const supportStyle = (v: string): SupportStyle => SUPPORT_OPTIONS.find((o) => o.value === v)?.value ?? "off";

const grams = (g: number) => (g < 10 ? g.toFixed(1) : Math.round(g).toString());

/**
 * The moves' time in words, rounded to the nearest minute: "4 min",
 * "1 h 5 min"; under half a minute is "under a minute". Null for a time
 * that is not a number or below 0 (an engine fault), so no figure shows.
 */
export function timeWords(s: number): string | null {
  if (!(s >= 0) || !Number.isFinite(s)) return null;
  const min = Math.round(s / 60);
  if (min === 0) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

/**
 * What a slice came to, in words: "100 layers, 5.2 g of PLA (1.73 m of
 * filament), about 4 min of printing (plus heating and levelling)."
 * The time is the engine's estimate of the moves alone, so the words say
 * the printer's own warm-up comes on top.
 */
export function printWords(print: PrintFacts): string {
  const layers = `${print.layers} ${print.layers === 1 ? "layer" : "layers"}`;
  const time = timeWords(print.printTimeS);
  const timePart = time === null ? "" : `, about ${time} of printing (plus heating and levelling)`;
  return `${layers}, ${grams(print.filamentG)} g of PLA (${(print.filamentMm / 1000).toFixed(2)} m of filament)${timePart}.`;
}

/**
 * The warning for plastic the slice leaves out, or null: a part thinner
 * than one line (0.4 mm) has no wall to print. Under a hundredth of a
 * mm³ rounds to nothing in the words, so it is not worth a warning.
 */
export function unprintedWords(print: Pick<PrintFacts, "unprintedVolume">): string | null {
  if (!(print.unprintedVolume >= 0.005)) return null;
  return `Some of the part is thinner than one printed line, so about ${print.unprintedVolume.toFixed(2)} mm³ of it won't print.`;
}

export interface SlicePrintEvents {
  /** Slices the bodies shown with these choices and saves the file chosen (`alive()` turns false once the dialog is closed: then throw SliceDropped before saving or showing anything); saved false when the user closed the save box, with the name it was saved under. */
  slice(choices: PrintChoices, file: FileChoices, alive: () => boolean): Promise<{ print: PrintFacts; saved: boolean; name: string }>;
  /** Slices the bodies shown, as the file chosen (what Slice and download would save), and opens the print preview (H2b, H2c); nothing is saved. */
  preview(choices: PrintChoices, file: FileChoices, alive: () => boolean): Promise<void>;
}

export interface SlicePrint {
  /** Opens the dialog. */
  ask(): void;
  /** Whether the dialog is open. */
  readonly open: boolean;
}

export const SLICE_PRINT_TITLE = "Slice for printing: turn the bodies shown into a print file for a Bambu Lab P1S (0.4 mm nozzle, PLA).";

/**
 * The dialog, in the toolbar slot's page, modal (native <dialog>) like
 * Start fresh's: Close or Escape close it; keys pressed in it never reach
 * the app's shortcuts. Slice and download slices and saves, then says what
 * the slice came to; a refusal says why, in the engine's words.
 */
export function slicePrint(slot: HTMLElement, events: SlicePrintEvents): SlicePrint {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = "") => {
    const e = document.createElement(tag);
    e.id = id;
    if (text) e.textContent = text;
    return e;
  };
  const dialog = el("dialog", "slice-print-dialog");
  dialog.className = "slice-print";
  dialog.setAttribute("aria-labelledby", "slice-print-heading");
  const heading = el("h2", "slice-print-heading", "Slice for printing");
  const printer = el("p", "slice-print-printer", "For a Bambu Lab P1S with a 0.4 mm nozzle and PLA. Every body shown is printed, placed in the middle of the plate.");
  // Placeholders never pretend to work: until a real test print passes (H3a), the dialog says so.
  const untested = el("p", "slice-print-untested", "First version: these files haven't been test-printed yet, so open one in Bambu Studio or a G-code viewer to check it before printing it.");
  const choice = <T extends string | number>(id: string, label: string, options: readonly { label: string; value: T }[], value: T) => {
    const wrap = document.createElement("label");
    wrap.className = "slice-print-choice";
    wrap.textContent = label;
    const select = el("select", id);
    select.classList.add("dark-select"); // styles/dark-select.css (packages/ui)
    for (const o of options) {
      const option = document.createElement("option");
      option.value = String(o.value);
      option.textContent = o.label;
      select.append(option);
    }
    select.value = String(value);
    wrap.append(select);
    return { wrap, select };
  };
  const quality = choice("slice-print-quality", "Quality", QUALITY_OPTIONS, PRINT_DEFAULTS.layerHeight);
  const walls = choice("slice-print-walls", "Walls", WALL_OPTIONS.map((n) => ({ label: `${n} ${n === 1 ? "wall" : "walls"}`, value: n })), PRINT_DEFAULTS.walls);
  const infill = choice("slice-print-infill", "Infill", INFILL_OPTIONS.map((n) => ({ label: `${n} %`, value: n })), PRINT_DEFAULTS.infill);
  // Supports: off by default, as most parts made to print need none; otherwise the engine props up every overhang steeper than 45° from upright, as columns or as trees.
  const supports = choice("slice-print-supports", "Supports", SUPPORT_OPTIONS, PRINT_DEFAULTS.supports);
  supports.wrap.title = "Prints break-away supports under parts that hang out too far (more than 45° from upright) to print on thin air. Normal: columns straight down under the whole overhang. Tree: branches that merge on the way down, usually less plastic and easier to snap off.";
  const format = choice("slice-print-format", "File", FORMAT_OPTIONS, FILE_DEFAULTS.format);
  format.wrap.title = "The P1S's own print file, with its start and end routines, ready to send to the printer; or plain G-code for another printer.";
  const plate = choice("slice-print-plate", "Build plate", PLATE_OPTIONS, FILE_DEFAULTS.plate);
  plate.wrap.title = "The plate on the printer's bed: the textured plate's first layer prints 0.04 mm lower, as its bumps stop the nozzle when the printer finds the bed.";
  const storage = (() => {
    try {
      return slot.ownerDocument.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  const nozzle = choice("slice-print-nozzle", "Nozzle", NOZZLE_OPTIONS, rememberedNozzle(storage));
  nozzle.wrap.title = "The nozzle on your P1S. Bambu Studio won't send a file made for the other kind (Standard is the one it comes with; High Flow is Bambu's faster hotend). Your choice is remembered.";
  nozzle.select.addEventListener("change", () => {
    try {
      storage?.setItem(NOZZLE_KEY, nozzle.select.value);
    } catch {
      // Storage blocked: the choice still holds for this dialog.
    }
  });
  // The plate and the nozzle matter to the P1S's file only.
  const plateFor = () => {
    plate.select.disabled = format.select.value !== "p1s";
    nozzle.select.disabled = format.select.value !== "p1s";
  };
  format.select.addEventListener("change", plateFor);
  const status = el("p", "slice-print-status");
  status.setAttribute("role", "status");
  const actions = el("div", "slice-print-actions");
  actions.className = "slice-print-actions";
  const close = el("button", "slice-print-close", "Close");
  close.type = "button";
  const preview = el("button", "slice-print-preview", "Preview");
  preview.type = "button";
  preview.title = "Watch it print: the slice in 3D, layer by layer, with a time-lapse of the nozzle laying it down.";
  const go = el("button", "slice-print-go", "Slice and download");
  go.title = "Slices the bodies shown and saves the file chosen above.";
  go.type = "button";
  actions.append(close, preview, go);
  // The choices in one block: two columns where there is room, so the dialog fits a laptop's height (Ben 10-31: Supports was cut off).
  const choices6 = document.createElement("div");
  choices6.className = "slice-print-choices";
  choices6.append(format.wrap, plate.wrap, nozzle.wrap, quality.wrap, walls.wrap, infill.wrap, supports.wrap);
  dialog.append(heading, printer, untested, choices6, status, actions);
  slot.append(dialog);

  const say = (text: string, bad: boolean) => {
    status.textContent = text;
    status.classList.toggle("slice-print-bad", bad);
  };
  const choices = (): PrintChoices => ({ layerHeight: Number(quality.select.value), walls: Number(walls.select.value), infill: Number(infill.select.value), supports: supportStyle(supports.select.value) });
  const file = (): FileChoices => ({ format: format.select.value === "gcode" ? "gcode" : "p1s", plate: plate.select.value === "smooth" ? "smooth" : "textured", nozzle: nozzle.select.value === "high-flow" ? "high-flow" : "standard" });
  let busy = false;
  // Closing the dialog drops a slice still running: its file is not saved and its preview not opened (slicer hunt 2026-10-31).
  let generation = 0;
  dialog.addEventListener("close", () => generation++);
  const alive = () => {
    const mine = generation;
    return () => mine === generation && dialog.open;
  };
  // A result stays displayed next to choices it no longer matches: any change clears it.
  for (const c of [quality, walls, infill, supports, format, plate, nozzle]) c.select.addEventListener("change", () => !busy && say("", false));
  go.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    go.disabled = preview.disabled = true;
    say("Slicing…", false);
    try {
      const { print, saved, name } = await events.slice(choices(), file(), alive());
      const warning = unprintedWords(print);
      say([saved ? `Saved ${name}:` : "Sliced, but not saved:", printWords(print), ...(warning ? [warning] : [])].join(" "), warning !== null);
    } catch (e) {
      if (e instanceof SliceDropped) say("", false);
      else say(refusalWords(e instanceof Error ? e.message : String(e)), true);
    } finally {
      busy = false;
      go.disabled = preview.disabled = false;
    }
  });
  preview.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    go.disabled = preview.disabled = true;
    say("Slicing…", false);
    try {
      await events.preview(choices(), file(), alive());
      say("", false);
      dialog.close();
    } catch (e) {
      if (e instanceof SliceDropped) say("", false);
      else say(refusalWords(e instanceof Error ? e.message : String(e)), true);
    } finally {
      busy = false;
      go.disabled = preview.disabled = false;
    }
  });
  close.addEventListener("click", () => dialog.close());
  // Its keys stay in it: a sketch tool key can't act behind the dialog.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    ask() {
      if (dialog.open) return;
      if (!busy) say("", false); // a slice still running keeps saying so
      dialog.showModal();
      go.focus();
    },
    get open() {
      return dialog.open;
    },
  };
}
