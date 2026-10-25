// The workspace button on the app bar (U0f2b, the owner's Fusion-like top
// bar): one "DESIGN ▾" naming the workspace on screen in place of the ten
// tabs, its menu listing all ten in order, the one on screen marked, the
// ones not built yet greyed with "Coming soon" at their right (still
// chosen as before: each shows its page saying what it will do). Each
// item carries data-workspace. Styles: src/styles/workspace-menu.css (and
// the menu's own, menu-button.css).

import { menuButton, type MenuButton } from "./menu-button.ts";

export interface SwitcherEntry {
  id: string;
  title: string;
  summary: string;
  placeholder: boolean;
}

/** The words at a not-yet-built workspace's right in the menu. */
export const COMING_SOON = "Coming soon";

/** The button's words for the page on screen: a workspace's title, or another page's name (Community). */
export const switcherLabel = (entries: readonly SwitcherEntry[], id: string, other: Record<string, string> = {}) => entries.find((e) => e.id === id)?.title ?? other[id] ?? id;

/**
 * Fills `bar` with the workspace button and calls `choose` when an item is
 * chosen. Returns a function that names the page on screen (`id`), with
 * `other` naming pages that are not workspaces (`community`), and the
 * menu button itself.
 */
export function workspaceSwitcher(bar: HTMLElement, entries: SwitcherEntry[], choose: (id: string) => void, other: Record<string, string> = {}): ((id: string) => void) & { menu: MenuButton } {
  const doc = bar.ownerDocument;
  let shown = entries[0]?.id ?? "";
  const menu = menuButton(doc, {
    id: "workspace-menu",
    label: switcherLabel(entries, shown, other),
    title: "The workspace on screen: choose another",
    sections: () => [
      {
        heading: "Workspaces",
        items: entries.map((e) => ({
          id: `workspace-${e.id}`,
          label: e.title,
          title: e.placeholder ? `${e.summary} (coming soon)` : e.summary,
          data: { workspace: e.id, ...(e.placeholder ? { soon: "" } : {}) },
          note: e.placeholder ? COMING_SOON : undefined,
          current: e.id === shown,
          run: () => choose(e.id),
        })),
      },
    ],
  });
  menu.element.classList.add("workspace-menu");
  bar.replaceChildren(menu.element);
  const mark = (id: string) => {
    shown = id;
    menu.setLabel(switcherLabel(entries, id, other));
    menu.button.dataset.active = id; // read by the e2e tests
    menu.button.title = `The workspace on screen, ${switcherLabel(entries, id, other)}: choose another`;
  };
  mark(shown);
  return Object.assign(mark, { menu });
}
