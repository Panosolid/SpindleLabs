// The print preview and its time-lapse (H2b, H2c): Slice for printing's
// Preview button slices the bodies shown and opens this full-screen view of
// the print in 3D (orbit, pan, zoom), every line coloured by what it is.
// The layer slider shows the print up to a layer; Play lays it down move by
// move with the nozzle, at 1× to 1,000× the clock, and the bar under it
// scrubs. All three share one clock, the G-code played through the
// replayer (core's print/playback.ts), so what plays is what the printer
// gets. Nothing is saved into the project. Styles: src/styles/print-preview.css.

import { layerDone, momentAt, PRINT_KINDS, type Playback, type PrintKind } from "@fission/core";

/** The 3D view the preview draws into (the viewport's printView; tests pass a stand-in). */
export interface PreviewView {
  setTime(t: number): void;
  frame(): void;
  resize(): void;
  dispose(): void;
}

/** The time-lapse speeds offered: times the clock. */
export const SPEEDS: readonly number[] = [1, 10, 100, 1000];

/** How long the default speed's time-lapse may take at most (s): the slowest speed that plays the whole print within it. */
export const TARGET_SECONDS = 40;

/** The default speed: the slowest offered that plays `seconds` of clock in TARGET_SECONDS or less, else the fastest. */
export function defaultSpeed(seconds: number): number {
  return SPEEDS.find((s) => seconds / s <= TARGET_SECONDS) ?? SPEEDS[SPEEDS.length - 1];
}

/** The kinds' names in the legend. */
export const KIND_NAMES: Record<PrintKind, string> = {
  "outer-wall": "Outer wall",
  "inner-wall": "Inner wall",
  "solid-infill": "Solid infill",
  "sparse-infill": "Sparse infill",
  support: "Support",
  prime: "Prime line",
  other: "Other",
};

/** The kinds this print has, in the legend's order. */
export function kindsIn(p: Playback): PrintKind[] {
  const has = new Set<PrintKind>();
  for (let i = 0; i < p.count; i++) if (p.plastic[i]) has.add(p.kind[i]);
  return PRINT_KINDS.filter((k) => has.has(k));
}

/** The layer readout: "Layer 12 of 100 · 2.40 mm". */
export function layerWords(p: Playback, layer: number): string {
  if (p.layers.length === 0) return "No layers";
  const k = Math.min(Math.max(layer, 0), p.layers.length - 1);
  return `Layer ${k + 1} of ${p.layers.length} · ${p.layers[k].z.toFixed(2)} mm`;
}

export interface PrintPreview {
  /** Whether the preview is open. */
  readonly open: boolean;
  /** The clock's second shown. */
  readonly time: number;
  readonly playing: boolean;
  /** Moves the clock on by `ms` of real time at the chosen speed (what each animation frame does while playing). */
  advance(ms: number): void;
  close(): void;
}

/**
 * Opens the preview of `p` over the page, in `slot`'s document: a modal
 * <dialog> filling the window, its 3D view made by `makeView` in its
 * middle. `words` is what the slice came to (layers, filament). It opens
 * showing the finished print; Play starts the time-lapse from the first
 * layer (or carries on from where the scrubber is). Close or Escape close
 * it and free the view.
 */
export function openPrintPreview(slot: HTMLElement, p: Playback, words: string, makeView: (host: HTMLElement, p: Playback) => PreviewView): PrintPreview {
  const document = slot.ownerDocument;
  const window = document.defaultView!;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, text = "") => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (text) e.textContent = text;
    return e;
  };
  const dialog = el("dialog", "print-preview");
  dialog.className = "print-preview";
  dialog.setAttribute("aria-labelledby", "print-preview-heading");
  const head = el("div", "", "");
  head.className = "print-preview-head";
  const heading = el("h2", "print-preview-heading", "Print preview");
  const summary = el("p", "print-preview-words", words);
  const close = el("button", "print-preview-close", "Close");
  close.type = "button";
  head.append(heading, summary, close);
  const host = el("div", "print-preview-view");
  const legend = el("ul", "print-preview-legend");
  legend.setAttribute("aria-label", "Colours");
  for (const k of kindsIn(p)) {
    const item = el("li", "", KIND_NAMES[k]);
    item.className = `print-preview-kind print-preview-${k}`;
    legend.append(item);
  }
  const bar = el("div", "", "");
  bar.className = "print-preview-bar";
  const play = el("button", "print-preview-play", "Play");
  play.type = "button";
  const speed = el("select", "print-preview-speed");
  speed.setAttribute("aria-label", "Time-lapse speed");
  for (const s of SPEEDS) {
    const o = document.createElement("option");
    o.value = String(s);
    o.textContent = `${s.toLocaleString("en")}×`;
    speed.append(o);
  }
  speed.value = String(defaultSpeed(p.seconds));
  const scrub = el("input", "print-preview-scrub");
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "1000";
  scrub.step = "1";
  scrub.setAttribute("aria-label", "Time-lapse position");
  const layerLabel = el("label", "", "");
  layerLabel.className = "print-preview-layer";
  const layerSlider = el("input", "print-preview-layers");
  layerSlider.type = "range";
  layerSlider.min = "1";
  layerSlider.max = String(Math.max(1, p.layers.length));
  layerSlider.step = "1";
  layerSlider.setAttribute("aria-label", "Show up to layer");
  const layerText = el("span", "print-preview-layer-words");
  layerText.setAttribute("aria-live", "polite");
  layerLabel.append(layerSlider, layerText);
  bar.append(play, speed, scrub, layerLabel);
  dialog.append(head, host, legend, bar);
  slot.append(dialog);
  dialog.showModal();

  let view: PreviewView | null = null;
  try {
    view = makeView(host, p);
  } catch (e) {
    host.textContent = `The 3D preview needs WebGL, which this browser didn't give: ${e instanceof Error ? e.message : String(e)}`;
    host.classList.add("print-preview-bad");
  }
  let time = p.seconds;
  let playing = false;
  let frame = 0;
  let last = 0;

  const show = () => {
    view?.setTime(time);
    scrub.value = String(p.seconds > 0 ? Math.round((time / p.seconds) * 1000) : 1000);
    const at = momentAt(p, time);
    const layer = at ? Math.max(at.layer, 0) : 0;
    layerSlider.value = String(layer + 1);
    layerText.textContent = layerWords(p, layer);
  };
  const stop = () => {
    playing = false;
    play.textContent = "Play";
    play.setAttribute("aria-pressed", "false");
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  };
  const tick = (now: number) => {
    if (!playing) return;
    if (last) api.advance(now - last);
    last = now;
    if (playing) frame = window.requestAnimationFrame(tick);
  };
  const start = () => {
    if (p.seconds <= 0) return;
    if (time >= p.seconds) time = 0;
    playing = true;
    play.textContent = "Pause";
    play.setAttribute("aria-pressed", "true");
    last = 0;
    show();
    frame = window.requestAnimationFrame(tick);
  };
  const onResize = () => view?.resize();

  play.addEventListener("click", () => (playing ? stop() : start()));
  scrub.addEventListener("input", () => {
    time = (Number(scrub.value) / 1000) * p.seconds;
    show();
  });
  layerSlider.addEventListener("input", () => {
    stop();
    time = layerDone(p, Number(layerSlider.value) - 1);
    show();
  });
  close.addEventListener("click", () => dialog.close());
  // Its keys stay in it: a sketch tool key can't act behind the preview. Space plays and pauses.
  dialog.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === " " && !(e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      play.click();
    }
  });
  dialog.addEventListener("close", () => {
    stop();
    window.removeEventListener("resize", onResize);
    view?.dispose();
    view = null;
    dialog.remove();
  });
  window.addEventListener("resize", onResize);
  show();

  const api: PrintPreview = {
    get open() {
      return dialog.open;
    },
    get time() {
      return time;
    },
    get playing() {
      return playing;
    },
    advance(ms) {
      if (!(ms > 0)) return;
      time = Math.min(p.seconds, time + (ms / 1000) * Number(speed.value));
      if (time >= p.seconds) stop();
      show();
    },
    close() {
      dialog.close();
    },
  };
  return api;
}
