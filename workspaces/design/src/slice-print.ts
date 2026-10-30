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

import type { BuildPlate, Feature, KernelCalls, P1sPrintFile, SlicedPrint, StlFile } from "@fission/core";
import type { SaveKind } from "@fission/ui";
import type { DesignDocument } from "./document.ts";
import { endSpec } from "./move-tool.ts";

/** The beginner's choices: layer height (mm), walls, infill (%), and supports under overhangs. */
export interface PrintChoices {
  layerHeight: number;
  walls: number;
  infill: number;
  supports: boolean;
}

/** The P1S's defaults for a 0.4 mm nozzle and PLA, as the engine's own (0.2 mm layers, 2 walls, 15 % infill, no supports). */
export const PRINT_DEFAULTS: PrintChoices = { layerHeight: 0.2, walls: 2, infill: 15, supports: false };

/** Each choice's options, as the dialog lists them. */
export const QUALITY_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "Fine (0.12 mm layers)", value: 0.12 },
  { label: "Detailed (0.16 mm layers)", value: 0.16 },
  { label: "Standard (0.2 mm layers)", value: 0.2 },
  { label: "Fast (0.28 mm layers)", value: 0.28 },
];
export const WALL_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const INFILL_OPTIONS: readonly number[] = [0, 10, 15, 20, 25, 40, 60, 100];

/** Which file to save: the P1S's print file, or plain G-code for another printer. */
export type PrintFormat = "p1s" | "gcode";

/** The file's choices: its kind and, for the P1S's, the build plate (the owner's textured PEI by default). */
export interface FileChoices {
  format: PrintFormat;
  plate: BuildPlate;
}

export const FILE_DEFAULTS: FileChoices = { format: "p1s", plate: "textured" };

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

/** The same slice as the P1S's print file for `plate`. */
export async function printFileOf(kernel: KernelCalls, doc: DesignDocument, features: readonly Feature[], choices: PrintChoices, plate: BuildPlate): Promise<P1sPrintFile> {
  const stl = await bodiesStl(kernel, doc, features);
  return kernel.call("print_file_stl", stl, choices.layerHeight, choices.walls, choices.infill, choices.supports, plate);
}

/** The plain file's name: the layer height, the walls and infill and whether it has supports, so two slices of one part never share a name. */
export function gcodeName(choices: PrintChoices): string {
  return `${baseName(choices)}.gcode`;
}

/** The P1S file's name: as the plain file's, plus the plate, so a file for one plate is never taken for the other's. */
export function printFileName(choices: PrintChoices, plate: BuildPlate): string {
  return `${baseName(choices)}-${plate}${P1S_KIND.extension}`;
}

const baseName = (choices: PrintChoices) => `spindlelabs-${choices.layerHeight}mm-${choices.walls}w-${choices.infill}pc${choices.supports ? "-supports" : ""}`;

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
  /** Slices the bodies shown with these choices and saves the file chosen; saved false when the user closed the save box, with the name it was saved under. */
  slice(choices: PrintChoices, file: FileChoices): Promise<{ print: PrintFacts; saved: boolean; name: string }>;
  /** Slices the bodies shown with these choices and opens the print preview (H2b, H2c); nothing is saved. */
  preview(choices: PrintChoices): Promise<void>;
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
  // Supports: off by default, as most parts made to print need none; on, the engine props up every overhang steeper than 45° from upright.
  const supportsWrap = document.createElement("label");
  supportsWrap.className = "slice-print-choice";
  const supports = el("input", "slice-print-supports");
  supports.type = "checkbox";
  supports.checked = PRINT_DEFAULTS.supports;
  supportsWrap.title = "Prints break-away supports under parts that hang out too far (more than 45° from upright) to print on thin air.";
  supportsWrap.append("Supports under overhangs", supports);
  const format = choice("slice-print-format", "File", FORMAT_OPTIONS, FILE_DEFAULTS.format);
  format.wrap.title = "The P1S's own print file, with its start and end routines, ready to send to the printer; or plain G-code for another printer.";
  const plate = choice("slice-print-plate", "Build plate", PLATE_OPTIONS, FILE_DEFAULTS.plate);
  plate.wrap.title = "The plate on the printer's bed: the textured plate's first layer prints 0.04 mm lower, as its bumps stop the nozzle when the printer finds the bed.";
  // The plate matters to the P1S's file only.
  const plateFor = () => {
    plate.select.disabled = format.select.value !== "p1s";
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
  dialog.append(heading, printer, untested, format.wrap, plate.wrap, quality.wrap, walls.wrap, infill.wrap, supportsWrap, status, actions);
  slot.append(dialog);

  const say = (text: string, bad: boolean) => {
    status.textContent = text;
    status.classList.toggle("slice-print-bad", bad);
  };
  const choices = (): PrintChoices => ({ layerHeight: Number(quality.select.value), walls: Number(walls.select.value), infill: Number(infill.select.value), supports: supports.checked });
  const file = (): FileChoices => ({ format: format.select.value === "gcode" ? "gcode" : "p1s", plate: plate.select.value === "smooth" ? "smooth" : "textured" });
  let busy = false;
  go.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    say("Slicing…", false);
    try {
      const { print, saved, name } = await events.slice(choices(), file());
      const warning = unprintedWords(print);
      say([saved ? `Saved ${name}:` : "Sliced, but not saved:", printWords(print), ...(warning ? [warning] : [])].join(" "), warning !== null);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    } finally {
      busy = false;
      go.disabled = false;
    }
  });
  preview.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    go.disabled = preview.disabled = true;
    say("Slicing…", false);
    try {
      await events.preview(choices());
      say("", false);
      dialog.close();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
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
      say("", false);
      dialog.showModal();
      go.focus();
    },
    get open() {
      return dialog.open;
    },
  };
}
