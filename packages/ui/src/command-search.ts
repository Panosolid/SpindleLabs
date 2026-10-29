// The command search box (Fusion's S shortcut box, Ben's keys of 10-29): a
// box over the view listing every command the workspace has, by name, with
// its key; typing narrows the list, ArrowUp and ArrowDown move through it,
// Enter runs the one marked (the first, unless moved), a click runs the one
// clicked, and Escape or a press outside closes it. A command that is off
// stays in the list, dimmed, saying why, and can't be run, so the box never
// does anything the toolbar could not. The workspace gives the commands as
// they are now (read each time the box opens). Styles:
// src/styles/command-search.css.

export interface Command {
  id: string;
  label: string;
  /** The shortcut key shown at the right, e.g. "E". */
  key?: string;
  /** Why the command is off; an off command can't be run. */
  off?: string;
  run(): void;
}

/**
 * The commands whose names hold every word of `query` (any case, each word
 * anywhere in the name), those whose name starts with the query first, in
 * the order given otherwise. An empty query keeps them all.
 */
export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  const q = words.join(" ");
  const hits = commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
  const starts = (c: Command) => (q !== "" && c.label.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.map((c, i) => ({ c, i })).sort((a, b) => starts(a.c) - starts(b.c) || a.i - b.i).map((x) => x.c);
}

export interface CommandSearch {
  readonly isOpen: boolean;
  /** Opens the box over `doc`'s page with the commands as they are now; the focus goes to the box. */
  open(): void;
  close(): void;
}

/** The command search box in `doc`, listing `commands()` each time it opens. */
export function commandSearch(doc: Document, commands: () => readonly Command[]): CommandSearch {
  let root: HTMLElement | null = null;
  let previous: Element | null = null;
  const close = () => {
    if (!root) return;
    root.remove();
    root = null;
    (previous as HTMLElement | null)?.focus?.();
  };
  const open = () => {
    if (root) return;
    previous = doc.activeElement;
    const all = commands();
    root = doc.createElement("div");
    root.className = "command-search";
    const box = doc.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Search the commands");
    const input = doc.createElement("input");
    Object.assign(input, { id: "command-search-input", type: "text", placeholder: "Type a command…", autocomplete: "off", spellcheck: false });
    input.setAttribute("aria-label", "Command");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", "command-search-list");
    input.setAttribute("aria-expanded", "true");
    const list = doc.createElement("ul");
    list.id = "command-search-list";
    list.setAttribute("role", "listbox");
    const empty = doc.createElement("p");
    empty.className = "command-search-none";
    empty.textContent = "No command by that name.";
    box.append(input, list, empty);
    root.append(box);
    let shown: Command[] = [];
    let active = 0;
    const run = (c: Command | undefined) => {
      if (!c || c.off) return;
      close();
      c.run();
    };
    const mark = () => {
      list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
      const li = list.children[active] as HTMLElement | undefined;
      if (li) input.setAttribute("aria-activedescendant", li.id);
      else input.removeAttribute("aria-activedescendant");
      li?.scrollIntoView?.({ block: "nearest" });
    };
    const show = () => {
      shown = matchCommands(all, input.value);
      // The first one that can be run is marked, so Enter runs it.
      active = Math.max(0, shown.findIndex((c) => !c.off));
      list.replaceChildren(
        ...shown.map((c) => {
          const li = doc.createElement("li");
          li.id = `command-search-${c.id}`;
          li.setAttribute("role", "option");
          li.dataset.command = c.id;
          const name = doc.createElement("span");
          name.className = "command-search-label";
          name.textContent = c.label;
          li.append(name);
          if (c.key) {
            const key = doc.createElement("kbd");
            key.textContent = c.key;
            li.append(key);
          }
          if (c.off) {
            li.setAttribute("aria-disabled", "true");
            li.title = c.off;
            const why = doc.createElement("span");
            why.className = "command-search-off";
            why.textContent = c.off;
            li.append(why);
          }
          li.addEventListener("click", () => run(c));
          return li;
        }),
      );
      empty.hidden = shown.length > 0;
      mark();
    };
    input.addEventListener("input", show);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (shown.length === 0) return;
        active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        mark();
      } else if (e.key === "Enter") {
        e.preventDefault();
        run(shown[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      // No key in the box reaches the app's shortcuts (S, M, ? typed as words).
      e.stopPropagation();
    });
    root.addEventListener("pointerdown", (e) => {
      if (e.target === root) close();
    });
    doc.body.append(root);
    show();
    input.focus();
  };
  return {
    get isOpen() {
      return root !== null;
    },
    open,
    close,
  };
}
