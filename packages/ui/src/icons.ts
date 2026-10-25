// The app's own icons (U0f, from U3a): flat and two-tone, Fusion-like in
// weight but drawn here, never copied. Each is a few paths on one 24 × 24
// grid, kept 2 units in from the edge: lines drawn 1.75 wide in the text
// colour (`currentColor`), and the second tone a fill of the same colour at
// a third of its strength, so an icon follows the theme (dark, and light
// mode from U1) with no colour of its own. `iconSvg` makes the <svg> the
// toolbars and menus show; `ICON_NAMES` is every icon, which the tests
// walk. Sizes: 16, 20 (the toolbar) and 24 px. Paths use absolute
// commands only (M L H V A C S Z), which the tests read back to check every
// mark stays on the grid.

/** One mark of an icon: a path, drawn as a line, or filled in the second tone. */
export interface IconPart {
  d: string;
  /** Filled in the second tone instead of drawn as a line. */
  tone?: boolean;
}

const line = (d: string): IconPart => ({ d });
const tone = (d: string): IconPart => ({ d, tone: true });

/** A cube seen from above the front-right corner, as Fusion's box: the top face in the second tone. */
const CUBE = [tone("M12 3.5 20 7.5 12 11.5 4 7.5Z"), line("M12 3.5 20 7.5V16.5L12 20.5 4 16.5V7.5ZM4 7.5 12 11.5 20 7.5M12 11.5V20.5")];

export const ICONS = {
  // Creating and changing the part.
  sketch: [tone("M4 20V15L15 4 20 9 9 20Z"), line("M4 20V15L15 4 20 9 9 20ZM12.5 6.5 17.5 11.5M4 20H20")],
  extrude: [tone("M4 15 12 19 20 15 12 11Z"), line("M4 15 12 19 20 15 12 11ZM12 15V3M8.5 6.5 12 3 15.5 6.5")],
  insert: [tone("M4 4H20V20H4Z"), line("M4 4H20V20H4ZM12 8V16M8 12H16")],
  inspect: [tone("M10.5 4A6.5 6.5 0 1 1 10.5 17A6.5 6.5 0 1 1 10.5 4Z"), line("M10.5 4A6.5 6.5 0 1 1 10.5 17A6.5 6.5 0 1 1 10.5 4ZM15.5 15.5 20 20")],
  // The presets (Insert ▾), one per shape.
  box: CUBE,
  cylinder: [tone("M5 6.5A7 2.5 0 1 0 19 6.5A7 2.5 0 1 0 5 6.5Z"), line("M5 6.5A7 2.5 0 1 0 19 6.5A7 2.5 0 1 0 5 6.5ZM5 6.5V17.5A7 2.5 0 0 0 19 17.5V6.5")],
  sphere: [tone("M4 12A8 3 0 0 0 20 12A8 8 0 0 0 4 12Z"), line("M4 12A8 8 0 1 1 20 12A8 8 0 1 1 4 12ZM4 12A8 3 0 0 0 20 12")],
  "l-bracket": [tone("M4 4H9V15H20V20H4Z"), line("M4 4H9V15H20V20H4Z")],
  plate: [tone("M3 6H21V18H3Z"), line("M3 6H21V18H3ZM6.5 12A1.5 1.5 0 1 0 9.5 12A1.5 1.5 0 1 0 6.5 12ZM14.5 12A1.5 1.5 0 1 0 17.5 12A1.5 1.5 0 1 0 14.5 12Z")],
  slot: [tone("M8 7H16A5 5 0 0 1 16 17H8A5 5 0 0 1 8 7Z"), line("M8 7H16A5 5 0 0 1 16 17H8A5 5 0 0 1 8 7Z")],
  star: [tone("M12 3 14.5 9.5H21L15.75 13.5 17.5 20 12 16 6.5 20 8.25 13.5 3 9.5H9.5Z"), line("M12 3 14.5 9.5H21L15.75 13.5 17.5 20 12 16 6.5 20 8.25 13.5 3 9.5H9.5Z")],
  // The sketch tools.
  line: [tone("M3 19A2 2 0 1 0 7 19A2 2 0 1 0 3 19ZM17 5A2 2 0 1 0 21 5A2 2 0 1 0 17 5Z"), line("M6.5 17.5 17.5 6.5")],
  rectangle: [tone("M4 6H20V18H4Z"), line("M4 6H20V18H4Z")],
  circle: [tone("M4 12A8 8 0 1 1 20 12A8 8 0 1 1 4 12Z"), line("M4 12A8 8 0 1 1 20 12A8 8 0 1 1 4 12ZM12 12H12.01")],
  arc: [tone("M2.5 18A1.5 1.5 0 1 0 5.5 18A1.5 1.5 0 1 0 2.5 18ZM10.5 5A1.5 1.5 0 1 0 13.5 5A1.5 1.5 0 1 0 10.5 5ZM18.5 18A1.5 1.5 0 1 0 21.5 18A1.5 1.5 0 1 0 18.5 18Z"), line("M4 18A8 13 0 0 1 20 18")],
  "centre-arc": [tone("M10.5 15A1.5 1.5 0 1 0 13.5 15A1.5 1.5 0 1 0 10.5 15Z"), line("M4 15A8 8 0 0 1 20 15M12 15 6.5 9.5")],
  "tangent-arc": [tone("M2.5 18A1.5 1.5 0 1 0 5.5 18A1.5 1.5 0 1 0 2.5 18Z"), line("M4 18H11M11 18A6 6 0 0 0 17 12V4")],
  project: [tone("M4 14 12 18 20 14 12 10Z"), line("M4 14 12 18 20 14 12 10ZM12 3V9M9.5 6.5 12 9 14.5 6.5")],
  finish: [tone("M4 12A8 8 0 1 1 20 12A8 8 0 1 1 4 12Z"), line("M8 12.5 11 15.5 16.5 9")],
  // Files and the app.
  new: [tone("M6 3H14L19 8V21H6Z"), line("M6 3H14L19 8V21H6ZM14 3V8H19M12.5 11.5V17.5M9.5 14.5H15.5")],
  open: [tone("M3 9H21L19 19H5Z"), line("M3 19V5H9L11 7H19V9M3 19 5 9H21L19 19Z")],
  save: [tone("M4 15H20V20H4Z"), line("M4 15V20H20V15M12 3V14M7.5 9.5 12 14 16.5 9.5")],
  export: [tone("M4 15H20V20H4Z"), line("M4 15V20H20V15M12 14V3M7.5 7.5 12 3 16.5 7.5")],
  undo: [line("M9 5 4 10 9 15M4 10H14.5A5.5 5.5 0 0 1 14.5 21H11")],
  redo: [line("M15 5 20 10 15 15M20 10H9.5A5.5 5.5 0 0 0 9.5 21H13")],
  settings: [tone("M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z"), line("M12 3V5.5M12 18.5V21M3 12H5.5M18.5 12H21M5.6 5.6 7.4 7.4M16.6 16.6 18.4 18.4M5.6 18.4 7.4 16.6M16.6 7.4 18.4 5.6M6.5 12A5.5 5.5 0 1 0 17.5 12A5.5 5.5 0 1 0 6.5 12Z")],
  guide: [tone("M4 5H11V19H4Z"), line("M4 5H11V19H4ZM13 5H20V19H13ZM11 19H13")],
  ai: [tone("M10 4 11.75 9.25 17 11 11.75 12.75 10 18 8.25 12.75 3 11 8.25 9.25Z"), line("M10 4 11.75 9.25 17 11 11.75 12.75 10 18 8.25 12.75 3 11 8.25 9.25ZM18 3V7M16 5H20")],
  community: [tone("M3 20A6 6 0 0 1 15 20Z"), line("M6 9A3 3 0 1 0 12 9A3 3 0 1 0 6 9ZM3 20A6 6 0 0 1 15 20M15 6.5A2.5 2.5 0 1 1 15 11.5M17 14.5A5 5 0 0 1 21 19.5")],
  // The browser's rows.
  body: [tone("M12 3.5 20 7.5V16.5L12 20.5 4 16.5V7.5Z"), line("M12 3.5 20 7.5V16.5L12 20.5 4 16.5V7.5ZM4 7.5 12 11.5 20 7.5M12 11.5V20.5")],
  folder: [tone("M3 8H21V19H3Z"), line("M3 19V5H9L11 8H21V19Z")],
  feature: [tone("M5 5H19V19H5Z"), line("M5 5H19V19H5ZM9 9H15M9 12H15M9 15H12.5")],
  origin: [tone("M3 19A2 2 0 1 0 7 19A2 2 0 1 0 3 19Z"), line("M5 19V4M5 19H20M5 19 14 10M2.5 6.5 5 4 7.5 6.5M17.5 16.5 20 19 17.5 21.5")],
  eye: [tone("M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z"), line("M2.5 12C5 7 8.25 5 12 5S19 7 21.5 12C19 17 15.75 19 12 19S5 17 2.5 12ZM9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z")],
  "eye-off": [line("M2.5 12C5 7 8.25 5 12 5S19 7 21.5 12C19 17 15.75 19 12 19S5 17 2.5 12ZM4 20 20 4")],
  // The menus' own mark.
  chevron: [line("M7 10 12 15 17 10")],
} satisfies Record<string, readonly IconPart[]>;

export type IconName = keyof typeof ICONS;

/** Every icon's name, in the order above. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** The grid every icon is drawn on, and how far in from its edge the marks stay. */
export const ICON_GRID = 24;
export const ICON_MARGIN = 2;
/** The width of an icon's lines, in grid units. */
export const ICON_LINE = 1.75;
/** How strong the second tone is, as a share of the line colour. */
export const ICON_TONE = 0.35;

/**
 * The icon as an <svg> in `doc`, `size` px square, hidden from screen
 * readers (the button it sits on carries the words). Class `icon`, and
 * `data-icon` its name.
 */
export function iconSvg(doc: Document, name: IconName, size = 20): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${ICON_GRID} ${ICON_GRID}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "icon");
  svg.dataset.icon = name;
  for (const part of ICONS[name]) {
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", part.d);
    if (part.tone) {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("fill-opacity", String(ICON_TONE));
      path.setAttribute("stroke", "none");
    } else {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", String(ICON_LINE));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    svg.append(path);
  }
  return svg;
}

/**
 * Puts icon `name` before an element's words (U0f): the words move into a
 * `.tool-word` span, which a toolbar may hide from sight (toolbar-group.css)
 * while they stay the element's accessible name, so a screen reader and the
 * tests read the same words as before. Returns the element.
 */
export function withIcon<T extends HTMLElement>(el: T, name: IconName, size = 20): T {
  const doc = el.ownerDocument;
  const word = doc.createElement("span");
  word.className = "tool-word";
  word.append(...el.childNodes);
  el.replaceChildren(iconSvg(doc, name, size), word);
  el.classList.add("with-icon");
  return el;
}
