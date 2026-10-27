// The Extrude panel (step 21d; UX1b Fusion's feel), at the top of the
// properties: the profile, picked by clicking a closed sketch in the view
// (its name, or how to pick one, and ✕ to clear it, like Fusion's "1
// selected ×"); the distance, typeable and kept in step with the arrow
// dragged in the view, negative going the other way from the sketch's
// plane; Flip, which turns the distance's sign (26c: the start still on
// the plane); whether the profile makes a closed outline or the kernel's
// reason it doesn't; and OK or Cancel. OK stays off until the kernel says
// the outline is closed. The workspace drives it; the panel only shows what
// it is given and reports what was typed and clicked.
// Styles: src/styles/extrude.css.

export interface ExtrudePanelEvents {
  /** The distance box changed as typed (every keystroke), so the preview and arrow follow it. */
  distance(typed: string): void;
  /** Flip: the distance's sign turned (the box already shows it). */
  flip(typed: string): void;
  /** ✕: no profile chosen. */
  clear(): void;
  /** OK (or Enter in the distance box), with the distance as typed. */
  ok(typed: string): void;
  cancel(): void;
}

export interface ExtrudePanel {
  /** Opens the panel with the profile chosen (its name; null for none yet) and the distance as typed. */
  show(chosen: string | null, distance: string): void;
  /** The profile chosen now (its name; null for none), as a click in the view or ✕ left it. */
  showProfile(chosen: string | null): void;
  /** The distance box set to `typed` (an arrow drag); the caret and focus are left alone. */
  showDistance(typed: string): void;
  /** Whether the chosen profile can be extruded, in words; OK follows it. */
  showStatus(text: string, closed: boolean): void;
  /** Why OK did nothing, or why the preview can't be built (a distance the kernel refused); empty hides it. */
  showError(message: string): void;
  hide(): void;
  readonly shown: boolean;
  /** Whether OK can be pressed now (Enter outside the box presses it too). */
  readonly ready: boolean;
  /** The distance as typed now. */
  readonly typed: string;
}

/** What the profile row says while none is chosen. */
export const PICK_PROFILE = "Click a closed sketch or a flat face in the view";

export function extrudePanel(slot: HTMLElement, on: ExtrudePanelEvents): ExtrudePanel {
  const document = slot.ownerDocument;
  const box = document.createElement("section");
  box.className = "extrude";
  box.id = "extrude-panel"; // the ids are read by the e2e test
  box.setAttribute("aria-label", "Extrude");
  box.hidden = true;
  slot.prepend(box);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id = "", className = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (id) e.id = id;
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  };
  let parts: { status: HTMLElement; error: HTMLElement; ok: HTMLButtonElement; input: HTMLInputElement; profile: HTMLElement; clear: HTMLButtonElement } | null = null;
  return {
    show(chosen, distance) {
      const profile = el("span", "extrude-profile", "extrude-profile");
      const clear = el("button", "extrude-clear", "extrude-clear", "✕");
      clear.type = "button";
      clear.title = "Clear the profile: click another closed sketch in the view";
      clear.setAttribute("aria-label", "Clear the profile");
      clear.addEventListener("click", () => on.clear());
      const profileRow = el("div", "", "extrude-row extrude-profile-row");
      profileRow.append(el("span", "", "extrude-label", "Profile"), profile, clear);
      const input = el("input", "extrude-distance");
      Object.assign(input, { type: "number", step: "any", value: distance });
      input.setAttribute("aria-label", "Distance in mm");
      input.addEventListener("input", () => on.distance(input.value));
      // Enter in the box is OK, as in any dialog.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !ok.disabled) on.ok(input.value);
      });
      const flip = el("button", "extrude-flip", "extrude-flip", "Flip");
      flip.type = "button";
      flip.title = "Extrude the other way from the sketch's plane (the distance turns negative); the body still starts on it";
      flip.addEventListener("click", () => {
        const n = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(n) || n === 0) return;
        input.value = String(-n);
        on.flip(input.value);
      });
      const distanceRow = el("label", "", "extrude-row");
      distanceRow.append(el("span", "", "extrude-label", "Distance"), input, " mm ", flip);
      const status = el("p", "extrude-status", "extrude-status");
      const error = el("p", "extrude-error", "bad");
      error.hidden = true;
      const ok = el("button", "extrude-ok", "", "OK");
      ok.type = "button";
      ok.disabled = true; // until the kernel says the outline is closed
      ok.addEventListener("click", () => on.ok(input.value));
      const cancel = el("button", "extrude-cancel", "", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => on.cancel());
      const buttons = el("div", "", "extrude-buttons");
      buttons.append(ok, cancel);
      box.replaceChildren(
        el("h2", "", "", "Extrude"),
        profileRow,
        distanceRow,
        el("p", "", "extrude-note", "Drag the arrow in the view or type the distance; a negative one goes the other way."),
        status,
        error,
        el("p", "", "extrude-note", "The extrude is a new body, put in the timeline at the marker."),
        buttons,
      );
      parts = { status, error, ok, input, profile, clear };
      this.showProfile(chosen);
      box.hidden = false;
    },
    showProfile(chosen) {
      if (!parts) return;
      parts.profile.textContent = chosen ?? PICK_PROFILE;
      parts.profile.classList.toggle("extrude-unpicked", chosen === null);
      parts.clear.hidden = chosen === null;
    },
    showDistance(typed) {
      if (parts) parts.input.value = typed;
    },
    showStatus(text, closed) {
      if (!parts) return;
      parts.status.textContent = text;
      parts.ok.disabled = !closed;
    },
    showError(message) {
      if (!parts) return;
      parts.error.textContent = message;
      parts.error.hidden = message === "";
    },
    hide() {
      box.hidden = true;
      box.replaceChildren();
      parts = null;
    },
    get shown() {
      return !box.hidden;
    },
    get ready() {
      return parts !== null && !parts.ok.disabled;
    },
    get typed() {
      return parts?.input.value ?? "";
    },
  };
}
