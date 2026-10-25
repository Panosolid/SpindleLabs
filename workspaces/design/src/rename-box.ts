// The box that renames a timeline item (U0e2), opened by Rename in the
// item's menu (timeline-menu.ts) where the menu was: one line holding the
// name, all of it selected, so typing replaces it. Enter or Rename saves
// (`save`, timeline-menu.ts `renameEntry`); a refusal stays in the box,
// its words under the line, so the name can be put right; Escape, Cancel
// or a click outside close it and nothing changes. A native modal dialog
// like the row menu (delete-ask.ts), so keys typed in it never reach the
// app's shortcuts and it sits above everything, the phone's drawer too.

export interface RenameBox {
  /**
   * Opens the box for item `name` ("Box 1") at a point on the screen.
   * `save` is given what was typed and returns why it was refused, or null
   * when it is done (the box then closes).
   */
  show(name: string, at: { x: number; y: number }, save: (typed: string) => string | null): void;
  /** Closes it without saving. */
  close(): void;
  /** Whether it is open. */
  readonly open: boolean;
}

/** The rename box in `slot`'s page: `#rename-box`, its line `#rename-input`, the refusal `#rename-why`, and `#rename-save` and `#rename-cancel`. */
export function renameBox(slot: HTMLElement): RenameBox {
  const document = slot.ownerDocument;
  const holder = document.createElement("div");
  holder.className = "rename-box";
  const box = document.createElement("dialog");
  box.id = "rename-box";
  box.className = "rename-box-dialog";
  box.setAttribute("aria-labelledby", "rename-heading");
  const heading = document.createElement("label");
  heading.id = "rename-heading";
  heading.htmlFor = "rename-input";
  const input = document.createElement("input");
  input.id = "rename-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", "rename-why");
  const why = document.createElement("p");
  why.id = "rename-why";
  why.className = "rename-box-why";
  why.setAttribute("role", "alert");
  why.hidden = true;
  const actions = document.createElement("div");
  actions.className = "rename-box-actions";
  const button = (id: string, text: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.textContent = text;
    return b;
  };
  const cancel = button("rename-cancel", "Cancel");
  const go = button("rename-save", "Rename");
  actions.append(cancel, go);
  box.append(heading, input, why, actions);
  holder.append(box);
  slot.append(holder);

  let save: (typed: string) => string | null = () => null;
  let point = { x: 0, y: 0 };
  /** At the menu's point, kept on the screen: again when a refusal makes it taller (a phone's menu opens near the bottom). */
  const place = () => {
    const view = document.defaultView;
    const w = view?.innerWidth ?? 0;
    const h = view?.innerHeight ?? 0;
    const r = box.getBoundingClientRect();
    box.style.left = `${Math.max(0, Math.min(point.x, w - r.width))}px`;
    box.style.top = `${Math.max(0, Math.min(point.y, h - r.height))}px`;
  };
  const shut = () => {
    if (box.open) box.close();
  };
  const submit = () => {
    const refused = save(input.value);
    if (refused === null) return shut();
    why.textContent = refused;
    why.hidden = false;
    place();
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };
  // The app's shortcuts listen on the document: keys stay in the box. Enter saves, Escape cancels.
  box.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Escape") {
      e.preventDefault();
      shut();
    } else if (key === "Enter" && !(e as KeyboardEvent).isComposing) {
      e.preventDefault();
      submit();
    }
    e.stopPropagation();
  });
  // Typing again clears the refusal.
  input.addEventListener("input", () => {
    why.hidden = true;
    input.removeAttribute("aria-invalid");
  });
  // A click on the backdrop (outside the box) is a cancel.
  box.addEventListener("click", (e) => {
    if (e.target !== box) return;
    const r = box.getBoundingClientRect();
    const { clientX: x, clientY: y } = e as MouseEvent;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) shut();
  });
  box.addEventListener("contextmenu", (e) => e.stopPropagation());
  cancel.addEventListener("click", shut);
  go.addEventListener("click", submit);

  return {
    show(name, at, onSave) {
      save = onSave;
      heading.textContent = `Rename ${name}`;
      input.value = name;
      why.hidden = true;
      why.textContent = "";
      input.removeAttribute("aria-invalid");
      if (typeof box.showModal === "function") box.showModal();
      else box.setAttribute("open", "");
      point = at;
      place();
      input.focus();
      input.select();
    },
    close: shut,
    get open() {
      return box.open;
    },
  };
}
