// The Settings page (the skeleton): a dialog of sections, each a card. Most
// sections say what will live there; only what really works today has a
// control (the shortcuts list, the version). `SettingsStore` keeps choices in
// the browser alone, so Settings works offline with no account; storage that
// is off or full never throws, the settings just don't stick.

export interface SettingsSection {
  id: string;
  title: string;
  /** What will live here, in plain words, shown while there is nothing to set. */
  coming: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", title: "General", coming: "Units and theme will be set here." },
  { id: "design", title: "Design", coming: "Snapping and the grid will be set here." },
  { id: "phone", title: "Phone", coming: "Touch and sheet choices will be set here." },
  { id: "printing", title: "Printing", coming: "Your printer and the slicer will be set here." },
  { id: "privacy", title: "Privacy and data", coming: "" },
  { id: "about", title: "About", coming: "" },
];

export const SETTINGS_KEY = "spindlelabs-settings";

/** The part of Web Storage the store uses (any of it may throw: storage off, private mode, full). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SettingValue = string | number | boolean;

export class SettingsStore {
  private values = new Map<string, SettingValue>();
  private readonly storage: SettingsStorage | null;
  constructor(storage: SettingsStorage | null) {
    this.storage = storage;
    try {
      const raw = storage?.getItem(SETTINGS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") this.values.set(k, v);
      }
    } catch {
      // Damaged or unreadable: start empty rather than refuse to open.
    }
  }
  get<T extends SettingValue>(key: string, fallback: T): T {
    const v = this.values.get(key);
    return typeof v === typeof fallback ? (v as T) : fallback;
  }
  set(key: string, value: SettingValue): void {
    this.values.set(key, value);
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(this.values)));
    } catch {
      // Not kept this time; the choice still holds until the page closes.
    }
  }
}

export interface SettingsParts {
  /** "kernel v0.1.2" or "" while the kernel loads. */
  version: string;
  onShortcuts: () => void;
}

/** Fill the dialog: a header with Close, then one card per section. */
export function fillSettings(dialog: HTMLDialogElement, parts: SettingsParts): void {
  const doc = dialog.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const header = el("header", "settings-head");
  const h2 = el("h2", undefined, "Settings");
  h2.id = "settings-title";
  const close = el("button", "close", "Close");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  header.append(h2, close);
  const body = el("div", "settings-body");
  for (const s of SETTINGS_SECTIONS) {
    const card = el("section", "settings-card");
    card.dataset.section = s.id;
    card.append(el("h3", undefined, s.title));
    if (s.coming) card.append(el("p", "settings-empty", s.coming));
    if (s.id === "general") {
      const row = el("div", "settings-row");
      const label = el("span", undefined, "Keyboard shortcuts");
      const open = el("button", "settings-action", "Show");
      open.type = "button";
      open.addEventListener("click", () => {
        dialog.close();
        parts.onShortcuts();
      });
      row.append(label, open);
      card.append(row);
    } else if (s.id === "privacy") {
      card.append(el("p", undefined, "There is no account. Your projects are kept in this browser and nothing is sent anywhere by SpindleLabs itself. The optional AI assistant sends only what you ask it, and only once you turn it on."));
    } else if (s.id === "about") {
      card.append(el("p", undefined, parts.version ? `SpindleLabs, ${parts.version}` : "SpindleLabs"));
    }
    body.append(card);
  }
  dialog.replaceChildren(header, body);
}
