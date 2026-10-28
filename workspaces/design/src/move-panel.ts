// The Move panel (step 35e2b, move.ts and move-tool.ts), at the top of the
// properties as Fusion's Move/Copy box is: the bodies picked, the distance
// along X, Y and Z (mm), the angle about each axis (degrees, turned X then
// Y then Z), the pivot they turn about (folded under its summary, as it is
// rarely changed: the centre of the picked bodies until a pivot box is
// typed in, "Centre of the bodies" giving that back), the kernel's
// refusal, and OK or Cancel. Enter in a box is OK; Escape is Cancel
// (workspace.ts `shortcut`). A new Move picks its bodies in the view or the
// browser while the panel is open; an edited one keeps the bodies it was
// made with. The workspace drives it; the panel only shows what it is given
// and reports what was typed and clicked. Styles: src/styles/move-panel.css.

import { MOVE_PARAMS, type MoveParam } from "./document.ts";
import type { MoveValues } from "./move.ts";
import { boxText } from "./move-tool.ts";

export interface MoveEvents {
  /** A box typed in: the preview follows (every box as typed). */
  typed(typed: Record<MoveParam, string>): void;
  /** OK (or Enter in a box). */
  ok(typed: Record<MoveParam, string>): void;
  cancel(): void;
  /** "Centre of the bodies": the pivot follows the picked bodies again. */
  centre(): void;
}

/** What the panel opens on: a new Move (no id) or Move `id`'s numbers, the bodies' names, and whether the pivot follows the bodies. */
export interface MoveShow {
  id: string | null;
  name: string;
  bodies: readonly string[];
  values: MoveValues;
}

export interface MovePanel {
  show(m: MoveShow): void;
  /** The picked bodies' names, as the selection changes (a new Move). */
  setBodies(names: readonly string[]): void;
  /** The pivot the bodies give, put in its boxes unless the user typed one. */
  setPivot(p: readonly [number, number, number]): void;
  /** Why OK recorded nothing ("" hides it). */
  showError(message: string): void;
  /** OK off while the kernel checks the Move, so a second press can't record twice. */
  busy(on: boolean): void;
  hide(): void;
  /** Whether the panel is open. */
  readonly shown: boolean;
  /** The Move being edited, or null for a new one (or none open). */
  readonly editing: string | null;
  /** Whether a pivot box was typed in, so the pivot no longer follows the bodies. */
  readonly pivotTyped: boolean;
  /** Every box as it is now. */
  readonly typed: Record<MoveParam, string>;
}

/** The three rows of boxes: their legend, the boxes' keys, and the unit after them. */
const ROWS: readonly { legend: string; keys: readonly MoveParam[]; unit: string; id: string }[] = [
  { legend: "Distance", keys: ["x", "y", "z"], unit: "mm", id: "move-distance" },
  { legend: "Angle", keys: ["turnX", "turnY", "turnZ"], unit: "°", id: "move-angle" },
  { legend: "Pivot", keys: ["pivotX", "pivotY", "pivotZ"], unit: "mm", id: "move-pivot" },
];

/** What the folded pivot's summary says: where the Move turns about. */
export const pivotWords = (typed: boolean, p: readonly string[]) => (typed ? `Pivot (${p.join(", ")}) mm` : "Pivot: centre of the bodies");

export function movePanel(slot: HTMLElement, on: MoveEvents): MovePanel {
  const document = slot.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  const box = el("section", "move-panel", "move-panel"); // the ids are read by the e2e test
  box.setAttribute("aria-label", "Move");
  box.hidden = true;
  slot.prepend(box);
  const title = el("h2", "move-title");
  // The bodies picked, or how to pick them; the second is hidden once there is one (main.ts opens a phone's sheet then).
  const bodies = el("p", "move-bodies", "move-panel-bodies");
  const pick = el("p", "move-pick", "move-panel-note", "Click the bodies to move in the view, or their rows in the browser.");
  const inputs = new Map<MoveParam, HTMLInputElement>();
  const typed = () => Object.fromEntries(MOVE_PARAMS.map((k) => [k, inputs.get(k)!.value])) as Record<MoveParam, string>;
  let pivotTyped = false;
  let editing: string | null = null;
  let open = false;
  const summary = el("summary", "move-pivot-summary");
  const showSummary = () => (summary.textContent = pivotWords(pivotTyped, ["pivotX", "pivotY", "pivotZ"].map((k) => inputs.get(k as MoveParam)!.value)));
  const ok = el("button", "move-ok", "", "OK");
  const rows = ROWS.map((row) => {
    // A group with its name as its first cell: over the boxes on a wide screen, beside them on a phone (move-panel.css).
    const set = el("div", row.id, "move-panel-row");
    set.setAttribute("role", "group");
    set.setAttribute("aria-label", `${row.legend} (${row.unit})`);
    set.append(el("span", "", "move-panel-legend", `${row.legend} (${row.unit})`));
    for (const key of row.keys) {
      const input = el("input", `move-${key}`);
      Object.assign(input, { type: "number", step: "any", inputMode: "decimal" });
      const axis = key.slice(-1).toUpperCase();
      input.setAttribute("aria-label", `${row.legend} ${axis}`);
      input.addEventListener("input", () => {
        if (row.id === "move-pivot") (pivotTyped = true), showSummary();
        on.typed(typed());
      });
      // Enter in a box is OK, as in any dialog.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !ok.disabled) on.ok(typed());
      });
      inputs.set(key, input);
      const label = el("label", "", "move-panel-box");
      label.append(el("span", "", "move-panel-axis", axis), input);
      set.append(label);
    }
    return set;
  });
  const pivot = el("details", "move-pivot-fold", "move-panel-pivot");
  const centre = el("button", "move-pivot-centre", "", "Centre of the bodies");
  centre.type = "button";
  centre.title = "Turn about the middle of the box round the picked bodies";
  centre.addEventListener("click", () => {
    pivotTyped = false;
    showSummary();
    on.centre();
  });
  pivot.append(summary, rows[2], centre);
  const error = el("p", "move-error", "bad");
  error.hidden = true;
  error.setAttribute("role", "alert");
  ok.type = "button";
  ok.addEventListener("click", () => on.ok(typed()));
  const cancel = el("button", "move-cancel", "", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => on.cancel());
  const buttons = el("div", "", "move-panel-buttons");
  buttons.append(ok, cancel);
  const note = el("p", "", "move-panel-note", "Turned about X, then Y, then Z through the pivot, then moved.");
  box.append(title, bodies, pick, rows[0], rows[1], pivot, error, note, buttons);
  const setBodies = (names: readonly string[]) => {
    bodies.textContent = names.length === 0 ? "" : `${names.length === 1 ? "Body" : "Bodies"}: ${names.join(", ")}`;
    bodies.hidden = names.length === 0;
    pick.hidden = names.length > 0 || editing !== null;
  };
  return {
    show(m) {
      editing = m.id;
      open = true;
      // An edited Move keeps its pivot; a new one follows its bodies.
      pivotTyped = m.id !== null;
      title.textContent = m.id === null ? "Move" : `Edit ${m.name}`;
      for (const k of MOVE_PARAMS) inputs.get(k)!.value = boxText(m.values[k]);
      pivot.open = false;
      showSummary();
      setBodies(m.bodies);
      error.hidden = true;
      ok.disabled = false;
      box.hidden = false;
      inputs.get("x")!.focus();
      inputs.get("x")!.select();
    },
    setBodies,
    setPivot(p) {
      if (pivotTyped) return;
      (["pivotX", "pivotY", "pivotZ"] as const).forEach((k, i) => (inputs.get(k)!.value = boxText(p[i])));
      showSummary();
    },
    showError(message) {
      error.textContent = message;
      error.hidden = message === "";
    },
    busy(on) {
      ok.disabled = on;
    },
    hide() {
      editing = null;
      open = false;
      box.hidden = true;
      error.hidden = true;
    },
    get shown() {
      return open;
    },
    get editing() {
      return editing;
    },
    get pivotTyped() {
      return pivotTyped;
    },
    get typed() {
      return typed();
    },
  };
}
