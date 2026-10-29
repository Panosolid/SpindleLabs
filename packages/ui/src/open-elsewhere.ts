// Asking before a file takes you to another workspace (the owner's ask,
// 2026-10-28: File ▾ > Open in Design with an image switched to Image
// without a word). The shell asks when a file opened, dropped or pasted
// belongs to a workspace not on screen: "Open in Image?" with Cancel and
// Open in Image. Cancel, Escape or a click outside keep you where you were
// and open nothing. Styles: src/styles/open-elsewhere.css.

/** The words of the question: the heading and the line under it. */
export function openElsewhereWords(fileName: string, kind: string, workspace: string, from: string | null): { heading: string; words: string; confirm: string } {
  const stays = from ? ` ${from} stays as it is, and the workspace menu at the top takes you back.` : "";
  return {
    heading: `Open in ${workspace}?`,
    words: `“${fileName}” is ${kind}, which opens in the ${workspace} workspace.${stays}`,
    confirm: `Open in ${workspace}`,
  };
}

export interface OpenElsewhere {
  /** Asks; true only on the confirm button. A new question answers the one still open with false. */
  ask(fileName: string, kind: string, workspace: string, from: string | null): Promise<boolean>;
  readonly open: boolean;
}

/** The question's modal dialog, appended to `doc`'s body (id `open-elsewhere`). */
export function openElsewhere(doc: Document): OpenElsewhere {
  const dialog = doc.createElement("dialog");
  dialog.id = "open-elsewhere";
  dialog.className = "open-elsewhere";
  dialog.setAttribute("aria-labelledby", "open-elsewhere-heading");
  dialog.setAttribute("aria-describedby", "open-elsewhere-words");
  const heading = doc.createElement("h2");
  heading.id = "open-elsewhere-heading";
  const words = doc.createElement("p");
  words.id = "open-elsewhere-words";
  const actions = doc.createElement("div");
  actions.className = "open-elsewhere-actions";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.id = "open-elsewhere-cancel";
  cancel.textContent = "Cancel";
  const go = doc.createElement("button");
  go.type = "button";
  go.id = "open-elsewhere-confirm";
  actions.append(cancel, go);
  dialog.append(heading, words, actions);
  doc.body.append(dialog);

  let answer: ((yes: boolean) => void) | null = null;
  const finish = (yes: boolean) => {
    const a = answer;
    answer = null;
    if (dialog.open) dialog.close();
    a?.(yes);
  };
  cancel.addEventListener("click", () => finish(false));
  go.addEventListener("click", () => finish(true));
  // Escape (the browser's cancel) and a click on the backdrop answer no.
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish(false);
  });
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = e as MouseEvent;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) finish(false);
  });
  // The app's shortcuts listen on the document: keys pressed here stay here.
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
    e.stopPropagation();
  });

  return {
    ask(fileName, kind, workspace, from) {
      finish(false);
      const w = openElsewhereWords(fileName, kind, workspace, from);
      heading.textContent = w.heading;
      words.textContent = w.words;
      go.textContent = w.confirm;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      go.focus();
      return new Promise<boolean>((resolve) => (answer = resolve));
    },
    get open() {
      return dialog.open;
    },
  };
}
