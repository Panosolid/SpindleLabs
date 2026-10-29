// Slice for printing (H2a, the slicer's first step into the app): every
// body shown, sliced by the slicing engine with the owner's printer's
// defaults (Bambu Lab P1S, 0.4 mm nozzle, PLA) and the beginner's three
// choices, downloaded as a G-code file. The workspace offers it as File ▾
// > Slice for printing; its dialog holds the choices, says what the slice
// came to (layers, filament) and warns about any part too thin to print.
// Nothing is saved into the project: choices, never results (decision 6,
// docs/progress/slice.md). Styles: src/styles/slice-print.css.

import type { Feature, KernelCalls, SlicedPrint, StlFile } from "@fission/core";
import type { DesignDocument } from "./document.ts";
import { endSpec } from "./move-tool.ts";

/** The beginner's choices: layer height (mm), walls, infill (%). */
export interface PrintChoices {
  layerHeight: number;
  walls: number;
  infill: number;
}

/** The P1S's defaults for a 0.4 mm nozzle and PLA, as the engine's own (0.2 mm layers, 2 walls, 15 % infill). */
export const PRINT_DEFAULTS: PrintChoices = { layerHeight: 0.2, walls: 2, infill: 15 };

/** Each choice's options, as the dialog lists them. */
export const QUALITY_OPTIONS: readonly { label: string; value: number }[] = [
  { label: "Fine (0.12 mm layers)", value: 0.12 },
  { label: "Detailed (0.16 mm layers)", value: 0.16 },
  { label: "Standard (0.2 mm layers)", value: 0.2 },
  { label: "Fast (0.28 mm layers)", value: 0.28 },
];
export const WALL_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const INFILL_OPTIONS: readonly number[] = [0, 10, 15, 20, 25, 40, 60, 100];

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

/** Slices `features` (bodies, in build order) as they are shown: each body's STL from the kernel, then the engine. */
export async function sliceBodies(kernel: KernelCalls, doc: DesignDocument, features: readonly Feature[], choices: PrintChoices): Promise<SlicedPrint> {
  if (features.length === 0) throw new Error("There is no body to slice: make or show one first.");
  const files: StlFile[] = [];
  for (const f of features) files.push(await kernel.call("export_stl", await endSpec(kernel, doc, f), "body"));
  return kernel.call("slice_stl", stackStl(files.map((f) => f.bytes)), choices.layerHeight, choices.walls, choices.infill);
}

/** The file's name: the layer height and the walls and infill in it, so two slices of one part never share a name. */
export function gcodeName(choices: PrintChoices): string {
  return `spindlelabs-${choices.layerHeight}mm-${choices.walls}w-${choices.infill}pc.gcode`;
}

const grams = (g: number) => (g < 10 ? g.toFixed(1) : Math.round(g).toString());

/** What a slice came to, in words: "100 layers, 5.2 g of PLA (1.73 m of filament)." */
export function printWords(print: SlicedPrint): string {
  const layers = `${print.layers} ${print.layers === 1 ? "layer" : "layers"}`;
  return `${layers}, ${grams(print.filamentG)} g of PLA (${(print.filamentMm / 1000).toFixed(2)} m of filament).`;
}

/**
 * The warning for plastic the slice leaves out, or null: a part thinner
 * than one line (0.4 mm) has no wall to print. Under a hundredth of a
 * mm³ rounds to nothing in the words, so it is not worth a warning.
 */
export function unprintedWords(print: SlicedPrint): string | null {
  if (!(print.unprintedVolume >= 0.005)) return null;
  return `Some of the part is thinner than one printed line, so about ${print.unprintedVolume.toFixed(2)} mm³ of it won't print.`;
}

export interface SlicePrintEvents {
  /** Slices the bodies shown with these choices and saves the file; false when the user closed the save box. */
  slice(choices: PrintChoices): Promise<{ print: SlicedPrint; saved: boolean }>;
}

export interface SlicePrint {
  /** Opens the dialog. */
  ask(): void;
  /** Whether the dialog is open. */
  readonly open: boolean;
}

export const SLICE_PRINT_TITLE = "Slice for printing: turn the bodies shown into a G-code file for a Bambu Lab P1S (0.4 mm nozzle, PLA).";

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
  const untested = el("p", "slice-print-untested", "First version: these files haven't been test-printed yet, so check one in a G-code viewer before printing it.");
  const choice = (id: string, label: string, options: readonly { label: string; value: number }[], value: number) => {
    const wrap = document.createElement("label");
    wrap.className = "slice-print-choice";
    wrap.textContent = label;
    const select = el("select", id);
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
  const status = el("p", "slice-print-status");
  status.setAttribute("role", "status");
  const actions = el("div", "slice-print-actions");
  actions.className = "slice-print-actions";
  const close = el("button", "slice-print-close", "Close");
  close.type = "button";
  const go = el("button", "slice-print-go", "Slice and download");
  go.type = "button";
  actions.append(close, go);
  dialog.append(heading, printer, untested, quality.wrap, walls.wrap, infill.wrap, status, actions);
  slot.append(dialog);

  const say = (text: string, bad: boolean) => {
    status.textContent = text;
    status.classList.toggle("slice-print-bad", bad);
  };
  const choices = (): PrintChoices => ({ layerHeight: Number(quality.select.value), walls: Number(walls.select.value), infill: Number(infill.select.value) });
  let busy = false;
  go.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    say("Slicing…", false);
    try {
      const { print, saved } = await events.slice(choices());
      const warning = unprintedWords(print);
      say([saved ? `Saved ${gcodeName(choices())}:` : "Sliced, but not saved:", printWords(print), ...(warning ? [warning] : [])].join(" "), warning !== null);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    } finally {
      busy = false;
      go.disabled = false;
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
