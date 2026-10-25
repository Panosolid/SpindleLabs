// One group of the Fusion-style toolbar (U0f): a row of icon buttons over
// the group's name, small and in capitals. A group with a menu has its
// name as the menu's button ("CREATE ▾"), listing every tool of the group
// with its icon and key, so a tool is one click from its icon and two from
// its words. A group that is only a menu (Insert ▾) is one tall button,
// its icon over its name. The row's buttons show only their icons; their
// words stay as their accessible names, and their tooltips say them.
// Styles: src/styles/toolbar-group.css.

import { withIcon, type IconName } from "./icons.ts";
import { menuButton, type MenuButton, type MenuButtonOptions } from "./menu-button.ts";

/** A toolbar icon's size in px: the icons' own 24 grid, one unit a pixel, so every line lands crisp. */
export const TOOL_ICON_SIZE = 24;

export interface ToolGroupOptions {
  /** The group's name: its label under the row, its menu's words, and its accessible name. */
  name: string;
  /** A menu under the name ("CREATE ▾"); without one the name is plain words. */
  menu?: Omit<MenuButtonOptions, "label" | "icon" | "iconSize">;
  /** A group that is only its menu: the one tall button's icon (needs `menu`). */
  solo?: IconName;
}

export interface ToolGroup {
  element: HTMLElement;
  /** The row of icon buttons (empty for a solo group). */
  row: HTMLElement;
  /** The group's menu, if it has one. */
  menu: MenuButton | null;
  /** Adds buttons to the row, each with its icon before its words. */
  add(...buttons: [HTMLButtonElement, IconName][]): void;
}

/** Makes a toolbar group in `doc`. */
export function toolGroup(doc: Document, options: ToolGroupOptions): ToolGroup {
  const element = doc.createElement("div");
  element.className = "tool-group toolbar-group";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", options.name);
  const row = doc.createElement("div");
  row.className = "toolbar-group-row";
  let menu: MenuButton | null = null;
  if (options.menu) menu = menuButton(doc, { ...options.menu, label: options.name, icon: options.solo, iconSize: TOOL_ICON_SIZE });
  if (options.solo && menu) {
    element.classList.add("toolbar-group-solo");
    element.append(menu.element);
  } else {
    const name = doc.createElement("span");
    name.className = "tool-group-name toolbar-group-name";
    if (menu) name.append(menu.element);
    else name.textContent = options.name;
    element.append(row, name);
  }
  return {
    element,
    row,
    menu,
    add(...buttons) {
      for (const [b, icon] of buttons) {
        withIcon(b, icon, TOOL_ICON_SIZE);
        b.classList.add("toolbar-group-tool");
        b.setAttribute("aria-label", b.textContent ?? "");
        row.append(b);
      }
    },
  };
}
