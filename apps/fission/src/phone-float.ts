// The phone's tool bar over the 3D view (Ben's iPhone notes, 10-28): at
// phone width a tool's own buttons live in the Properties sheet or at the far
// end of the toolbar's sideways scroll, out of sight, so a beginner could not
// find how to finish a sketch or an extrude. While a tool is open this bar
// sits along the top of the view with what ends it: a big green Finish
// (Finish Sketch, Finish Extrude, Finish Move, Finish Edit) and Cancel where the tool has
// one; while a sketch's plane is being picked, the words "Tap a plane or
// face" with the three planes and Cancel, so the plane prompt no longer needs
// the sheet that covered the view. Every button only presses the tool's own
// button (the one the workspace already listens to), so the bar can never do
// anything the tool could not, and it shows a disabled OK as disabled. When
// a tool ends, the Properties sheet is put away too, leaving the whole view.
// Wider screens never show the bar (styles/phone-float.css).
import "./styles/phone-float.css";
import { withIcon } from "@fission/ui";

/** A tool the bar can end: its panel (shown while the tool is open), its own OK and Cancel, and the words on the bar's Finish. */
interface Ender {
  kind: string;
  panel: string;
  ok: string;
  cancel: string | null;
  label: string;
}

/** In order: Extrude first (it is started from inside a sketch, which it leaves). */
export const ENDERS: readonly Ender[] = [
  { kind: "extrude", panel: "#extrude-panel", ok: "#extrude-ok", cancel: "#extrude-cancel", label: "Finish Extrude" },
  { kind: "move", panel: "#move-panel", ok: "#move-ok", cancel: "#move-cancel", label: "Finish Move" },
  { kind: "edit", panel: "#feature-edit", ok: "#feature-edit-ok", cancel: "#feature-edit-cancel", label: "Finish Edit" },
  { kind: "sketch", panel: ".sketchbar-finish", ok: "#finish-sketch", cancel: null, label: "Finish Sketch" },
];

/** The sketch's three planes, by the sketch panel's button ids. */
const PLANES = ["XY", "XZ", "YZ"] as const;

/** An element in the page and on show: connected (a sleeping workspace's slots are taken out) with no hidden ancestor. */
function shown(el: Element | null): el is HTMLElement {
  return el !== null && el.isConnected && el.closest("[hidden]") === null;
}

/** What the bar shows now: the plane prompt, a tool to end, or nothing. */
export function floatState(root: ParentNode): { kind: "pick" } | { kind: "end"; ender: Ender } | null {
  if (shown(root.querySelector("#sketch-plane-XY"))) return { kind: "pick" };
  for (const ender of ENDERS) if (shown(root.querySelector(ender.panel)) && root.querySelector(ender.ok)) return { kind: "end", ender };
  return null;
}

/** Puts the bar in `viewport`, kept up to date with what `workspace` shows. */
export function startPhoneFloat(workspace: HTMLElement, viewport: HTMLElement, closeProperties: () => void) {
  const bar = document.createElement("div");
  bar.id = "phone-float";
  bar.className = "phone-float";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Tool");
  bar.hidden = true;
  // A press on the bar is not a press on the view: the view's own listeners on #viewport (the sketch's pointer
  // position for its typed boxes, a sheet put away by a tap on the view) never hear it.
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) bar.addEventListener(type, (e) => e.stopPropagation());
  viewport.append(bar);
  // WebKit (Safari, every iPhone browser) moves a tap's click onto a button near the finger: a sketch corner tapped
  // 15 px under the bar finished the sketch (CI run 40805491664). So a click from a press counts only when the press
  // began on the bar; a keyboard's Enter or Space (a click with no presses, detail 0) still works.
  let pressOnBar = false;
  document.addEventListener("pointerdown", (e) => (pressOnBar = e.target instanceof Node && bar.contains(e.target)), true);
  /** A bar button pressing the tool's own `target` (looked up at the press: a panel's buttons are rebuilt as it changes). */
  const proxy = (id: string, words: string, target: string, className = "") => {
    const b = Object.assign(document.createElement("button"), { type: "button", id, className, textContent: words });
    b.addEventListener("click", (e) => {
      if (e.detail !== 0 && !pressOnBar) return;
      workspace.querySelector<HTMLButtonElement>(target)?.click();
    });
    return b;
  };
  let last = "";
  let open = false;
  const update = () => {
    const state = floatState(workspace);
    const okButton = state?.kind === "end" ? workspace.querySelector<HTMLButtonElement>(state.ender.ok) : null;
    // The key: what is shown and whether OK is on, so the bar is rebuilt only when that changes.
    const key = state === null ? "" : state.kind === "pick" ? "pick" : `${state.ender.kind}:${okButton?.disabled ? "off" : "on"}`;
    if (key === last) return;
    last = key;
    // A tool ended (Finish, OK, Cancel, Escape, Undo): the Properties sheet goes too, so the whole view is back.
    if (state === null && open) closeProperties();
    open = state !== null;
    bar.hidden = state === null;
    bar.dataset.kind = state === null ? "" : state.kind === "pick" ? "pick" : state.ender.kind;
    if (state === null) return bar.replaceChildren();
    if (state.kind === "pick") {
      const words = Object.assign(document.createElement("span"), { className: "phone-float-words", textContent: "Tap a plane or face" });
      const planes = PLANES.map((p) => proxy(`float-plane-${p}`, p, `#sketch-plane-${p}`, "phone-float-plane"));
      return bar.replaceChildren(words, ...planes, proxy("float-cancel", "Cancel", "#sketch-cancel"));
    }
    const finish = withIcon(proxy("float-finish", state.ender.label, state.ender.ok, "phone-float-finish"), "finish");
    finish.disabled = okButton?.disabled ?? false;
    if (finish.disabled) finish.title = "Not yet: the panel in Properties says why";
    bar.replaceChildren(finish);
    if (state.ender.cancel) bar.append(proxy("float-cancel", "Cancel", state.ender.cancel));
  };
  new MutationObserver(update).observe(workspace, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "disabled"] });
  update();
}
