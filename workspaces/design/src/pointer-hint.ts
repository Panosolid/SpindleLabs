// The hint by the pointer while sketching: a few words saying what the
// next click places ("Specify next point", "Place point on arc"), the
// tool's step in the panel's longer help (sketch-panel.ts TOOL_HELP)
// put where the eye already is. `hintOf` is the words, a pure function of
// the tool; `pointerHint` the label, which only shows and moves. Styles:
// src/styles/pointer-hint.css.

import type { SketchTool } from "./sketch-tool.ts";

/** What the tool's next click places, in a few words. */
export function hintOf(tool: SketchTool): string {
  switch (tool.kind) {
    case "line":
      return tool.from === null ? "Place start point" : "Specify next point";
    case "rectangle":
      return tool.corner === null ? "Place first corner" : "Place opposite corner";
    case "circle":
      return tool.centre === null ? "Place centre point" : "Place point on circle";
    case "arc":
      return tool.start === null ? "Place start point" : tool.end === null ? "Specify next point" : "Place point on arc";
    case "centre":
      return tool.centre === null ? "Place centre point" : tool.start === null ? "Place start point" : "Place end point";
    case "tangent":
      return tool.from === null ? "Click the free end of a line or arc" : "Specify next point";
    case "project":
      return "Click an edge or a face to project";
  }
}

export interface PointerHint {
  /** Shows `text` by the point (x, y) in the host's pixels; empty text hides it. `note`: why a click did nothing, drawn as a warning that wraps. */
  show(text: string, x: number, y: number, note?: boolean): void;
  hide(): void;
  readonly element: HTMLElement;
}

/**
 * Moves `el` (placed by its style's left and top in `host`'s pixels) back
 * inside `host` where its drawn box, CSS transform and all, sticks out past
 * an edge: drawing by the view's right edge, the typed-size boxes stuck out
 * past the window and the page scrolled sideways (hunt 3f). Whole pixels,
 * rounded outwards so no part pixel stays out; an element bigger than the
 * host keeps its left and top edges in.
 */
export function keepInside(el: HTMLElement, host: HTMLElement): void {
  const b = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const shift = (start: number, end: number, from: number, to: number) => {
    let d = end > to ? Math.floor(to - end) : 0;
    if (start + d < from) d = Math.ceil(from - start);
    return d;
  };
  const dx = shift(b.left, b.right, h.left, h.right);
  const dy = shift(b.top, b.bottom, h.top, h.bottom);
  if (dx !== 0) el.style.left = `${parseFloat(el.style.left) + dx}px`;
  if (dy !== 0) el.style.top = `${parseFloat(el.style.top) + dy}px`;
}

export function pointerHint(host: HTMLElement): PointerHint {
  const el = host.ownerDocument.createElement("div");
  el.className = "pointer-hint";
  el.id = "sketch-hint"; // read by the e2e test
  el.hidden = true;
  el.setAttribute("aria-live", "polite");
  host.append(el);
  const api: PointerHint = {
    element: el,
    show(text, x, y, note = false) {
      if (text === "") return api.hide();
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle("pointer-hint-note", note);
      el.hidden = false;
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      keepInside(el, host);
    },
    hide() {
      el.hidden = true;
    },
  };
  return api;
}
