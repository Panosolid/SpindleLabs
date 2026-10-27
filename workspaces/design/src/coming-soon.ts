// The tools still to come, shown greyed in the toolbar's menus so people
// can see what is on the way (Ben, 2026-10-26: "placeholders that say eg.
// 'Fillet' but are greyed out so you know they aren't released yet").
// Each is a menu item that is off, with "Coming soon" at its right and its
// tooltip saying what it will do; choosing it does nothing. Never a tool
// that pretends to work. When a tool lands, its line here goes and a real
// item takes its place: test/coming-soon.test.ts fails once its step is
// ticked in docs/roadmap.md (or docs/progress/cad.md for 35e2 and
// 35f) while its line is still here. Modify ▾ and Construct ▾ hold only
// these for now. Styles: src/styles/coming-soon.css.

import type { MenuItem } from "@fission/ui";

/** The toolbar group a coming tool sits in, as Fusion groups them. */
export type ComingGroup = "Create" | "Modify" | "Construct" | "Inspect";

export interface ComingTool {
  /** Its menu item's id is `coming-<id>` (read by the tests). */
  id: string;
  label: string;
  group: ComingGroup;
  /** The roadmap step that brings it (docs/roadmap.md, or docs/progress/cad.md for 35e2 and 35f). */
  step: string;
  /** What it will do, in plain words, for the tooltip. */
  does: string;
}

/** Every tool shown as coming soon, in each group's menu order. */
export const COMING_SOON: readonly ComingTool[] = [
  { id: "revolve", label: "Revolve", group: "Create", step: "56", does: "spin a closed sketch round an axis to make a solid" },
  { id: "hole", label: "Hole", group: "Create", step: "54", does: "drill a hole of a set size and depth into a face" },
  { id: "pattern", label: "Pattern", group: "Create", step: "61", does: "repeat a body or feature in rows or round a circle" },
  { id: "sweep", label: "Sweep", group: "Create", step: "70", does: "move a sketch along a path to make a solid" },
  { id: "loft", label: "Loft", group: "Create", step: "71", does: "blend between two or more sketches to make a solid" },
  { id: "move", label: "Move/Rotate", group: "Modify", step: "35e2", does: "move or turn a body, by dragging arrows or typing distances and angles" },
  { id: "duplicate", label: "Duplicate body", group: "Modify", step: "35e2", does: "make a copy of a body" },
  { id: "mirror", label: "Mirror body", group: "Modify", step: "35e2", does: "make a mirror image of a body across a plane" },
  { id: "combine", label: "Combine", group: "Modify", step: "35f", does: "join two bodies into one, cut one from another, or keep only where they overlap" },
  { id: "chamfer", label: "Chamfer", group: "Modify", step: "44", does: "cut a sloped face along the edges you pick" },
  { id: "fillet", label: "Fillet", group: "Modify", step: "45", does: "round the edges you pick" },
  { id: "shell", label: "Shell", group: "Modify", step: "62", does: "hollow a body out, leaving walls of a set thickness" },
  { id: "draft", label: "Draft", group: "Modify", step: "63", does: "slope faces slightly so a moulded part comes out of its mould" },
  { id: "plane", label: "Construction plane", group: "Construct", step: "59", does: "make a plane to sketch on: offset from a face, at an angle, or midway between two" },
  { id: "axis", label: "Construction axis", group: "Construct", step: "59", does: "make an axis to revolve round or mirror across" },
  { id: "point", label: "Construction point", group: "Construct", step: "59", does: "make a point to measure from or build on" },
  { id: "measure", label: "Measure", group: "Inspect", step: "35e2", does: "measure the distance between two points, edges or faces" },
  { id: "section", label: "Section view", group: "Inspect", step: "65", does: "cut the view open to see inside the part" },
];

/** What a coming tool's greyed item says at its right. */
export const COMING_NOTE = "Coming soon";

/** The greyed menu items of `group`'s coming tools: off, saying what each will do, choosing one does nothing. */
export function comingItems(group: ComingGroup): MenuItem[] {
  return COMING_SOON.filter((t) => t.group === group).map((t) => ({
    id: `coming-${t.id}`,
    label: t.label,
    note: COMING_NOTE,
    off: `${t.label} is coming soon: it will ${t.does}.`,
    data: { step: t.step },
    run: () => {},
  }));
}
