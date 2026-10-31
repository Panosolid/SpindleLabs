// Design's browser panel, read from the Design document (document.ts):
// the timeline's items in build order, the sketches and profiles, the
// bodies they make, and the origin's planes and axes. A pure function of the document, so step 24's
// longer timeline only adds rows here.

import type { Feature, GeometryReference } from "@fission/core";
import { ICONS, type IconName } from "@fission/ui";
import { bodyHidden, bodyIdOf, bodyItem, bodyNumbers, buildingItems, EYE_FOLDERS, isHidden, isSketchItem, makesBody, ORIGIN_PLANES, presetKinds, profileLabel, type DesignDocument } from "./document.ts";
import { bodyReference, profileReference } from "./references.ts";
import { sketchItem } from "./sketch.ts";

export interface BrowserNode {
  /** Stable within the document: a feature's id, "body-1", "origin-xy"… */
  id: string;
  label: string;
  /** The row's tooltip when it is not its label alone: an item's short name, and its description under it ("Box 1\nBox: 40 × 30 × 20 mm", U0e). */
  title?: string;
  /** Groups have children (possibly none); leaves are rows a click highlights. */
  children?: BrowserNode[];
  /** A group shown folded until the user opens it (U0a, like Fusion's browser). */
  startsFolded?: boolean;
  /** The icon before its words (U0f3, like Fusion's browser): a folder for a group, the item's own for a row. */
  icon: IconName;
  /**
   * The row's eye (U0f3; Ben 2026-10-29, on everything that is drawn, as in
   * Fusion): whether its own eye is shut. On Body, sketch and origin rows
   * and the Sketches, Bodies and Origin folders; left out on the Timeline
   * and its rows, and the Profiles and theirs (drawn by nothing of their own).
   */
  hidden?: boolean;
  /** Whether its folder's eye is shut, so the row is not drawn whatever its own eye says (dimmed); left out when not. */
  folderHidden?: boolean;
}

/** The origin every part is built on; the same for every document. */
const ORIGIN: readonly BrowserNode[] = [
  { id: "origin-xy", label: "XY plane", icon: "plane" },
  { id: "origin-xz", label: "XZ plane", icon: "plane" },
  { id: "origin-yz", label: "YZ plane", icon: "plane" },
  { id: "origin-x", label: "X axis", icon: "axis" },
  { id: "origin-y", label: "Y axis", icon: "axis" },
  { id: "origin-z", label: "Z axis", icon: "axis" },
];

/** A timeline item's icon, as its toolbar button's: a preset's own shape's (the slot's for a slot, though an extrude of its profile), else a sketch's or an extrude's; any other feature the plain feature icon. */
export function itemIcons(doc: Pick<DesignDocument, "profiles">): (f: Feature) => IconName {
  const kindOf = presetKinds(doc);
  return (f) => {
    const name = kindOf(f) ?? f.intent.type;
    return Object.hasOwn(ICONS, name) ? (name as IconName) : "feature";
  };
}

/**
 * The solid features that build (`builds`: not suppressed, not after the
 * rollback marker, their sketch there), in build order: each makes a body
 * (24d1), each with its own number (35e), all drawn (24d3b).
 */
export function bodyFeatures(document: DesignDocument): Feature[] {
  const building = buildingItems(document);
  return document.timeline.features.filter((f) => makesBody(f) && building.has(f));
}

/** No feature failed: the browser before any rebuild has answered. */
const NONE_FAILED: ReadonlySet<string> = new Set();

/**
 * The Bodies group's rows: one for each feature in `bodyFeatures` that the
 * last rebuild did not fail (`failed`, its ids), "body-n" and "Body n", n
 * the body's own number (35e, `bodyNumbers`), so a body keeps it when one
 * before it fails, is suppressed or is reordered. A feature that failed has no body, so no row (bug hunt
 * 2026-10-19, finding 5: its row selected a body that did not exist).
 */
export function bodyRows(document: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): { id: string; label: string; feature: Feature }[] {
  const numbers = bodyNumbers(document);
  return bodyFeatures(document).flatMap((f) => {
    const n = numbers.get(bodyIdOf(f.id))!;
    return failed.has(f.id) ? [] : [{ id: `body-${n}`, label: `Body ${n}`, feature: f }];
  });
}

/**
 * The browser's tree for a document. Each feature is a row in build order
 * by its short name ("Box 1", U0e), its tooltip the name with its
 * description (intent summary) under it, so a name cut short is still
 * there whole; a suppressed one says so. The
 * Timeline and the Origin start folded (U0a): the bar along the bottom
 * shows the timeline, and the origin's planes are seldom needed. Each
 * body the last rebuild built is a row (`bodyRows`; `failed` the ids it failed). Each profile
 * is a row by its own id ("profile-1"), selectable as an outline. Each
 * sketch is a timeline row by its id and a row in Sketches by
 * "sketches/<id>", so no two rows share an id.
 */
export function browserTree(document: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): BrowserNode[] {
  const features = document.timeline.features;
  // Each sketch's item by its id, looked up once (S2: a search per sketch took the timeline's length squared).
  const items = new Map<string, Feature>();
  for (const f of features) if (isSketchItem(f) && !items.has(f.id)) items.set(f.id, f);
  const sketchItemOf = (id: string) => items.get(id) ?? sketchItem(document, id);
  const iconOf = itemIcons(document);
  // A row's eye: its own (an origin plane's shut until shown), and its folder's when shut.
  const planes: readonly string[] = ORIGIN_PLANES;
  const eye = (id: string, folder?: string) => ({
    hidden: planes.includes(id) ? !(document.shownPlanes?.includes(id) ?? false) : isHidden(document, id),
    ...(folder !== undefined && isHidden(document, folder) ? { folderHidden: true } : {}),
  });
  return [
    {
      id: "timeline",
      label: "Timeline",
      icon: "folder",
      // The bar along the bottom shows every item already, with the same menu and double-click.
      startsFolded: true,
      children: features.map((f) => {
        const off = f.suppressed ? " (suppressed)" : "";
        return { id: f.id, label: `${f.provenance.self.label}${off}`, title: `${f.provenance.self.label}${off}\n${f.intent.summary}`, icon: iconOf(f) };
      }),
    },
    {
      id: "sketches",
      label: "Sketches",
      icon: "folder",
      ...eye(EYE_FOLDERS.sketches),
      children: document.sketches.map((s) => {
        const item = sketchItemOf(s.id);
        return { id: `sketches/${s.id}`, label: item.provenance.self.label, title: `${item.provenance.self.label}\n${item.intent.summary}`, icon: "sketch", ...eye(s.id, EYE_FOLDERS.sketches) };
      }),
    },
    { id: "profiles", label: "Profiles", icon: "folder", children: document.profiles.map((p) => ({ id: p.id, label: profileLabel(p), icon: "profile" })) },
    { id: "bodies", label: "Bodies", icon: "folder", ...eye(EYE_FOLDERS.bodies), children: bodyRows(document, failed).map(({ id, label, feature }) => ({ id, label, icon: "body", ...eye(feature.id, EYE_FOLDERS.bodies) })) },
    { id: "origin", label: "Origin", icon: "origin", ...eye(EYE_FOLDERS.origin), children: ORIGIN.map((n) => ({ ...n, ...eye(n.id, EYE_FOLDERS.origin) })), startsFolded: true },
  ];
}

/**
 * The timeline item a browser row stands for, whose menu (Delete, Suppress,
 * Edit…) and double-click it takes: a Timeline row's own item, a sketch's
 * row in Sketches its sketch item, and (the owner's ask, 2026-10-24) a
 * Body row the feature that makes the body, since every body is made by
 * one feature; deleting it asks first when anything is built from it, as
 * the timeline's rules say. Other rows (profiles, the origin) have none.
 */
export function rowItem(node: string, doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): string | null {
  if (node.startsWith("sketches/")) return node.slice("sketches/".length);
  if (node.startsWith("body-")) return bodyRows(doc, failed).find((r) => r.id === node)?.feature.id ?? null;
  return doc.timeline.features.some((f) => f.id === node) ? node : null;
}

/**
 * The browser rows that stand for selectable geometry, and the reference
 * each selects: "body-n" its body, a profile's row its outline, and (step
 * 24f6) a Timeline row of a solid feature that builds the body it makes,
 * the same as its Body row. A sketch's rows (its Timeline row and its
 * row in Sketches) select its outline once it has a curve (25c1), to copy
 * or hand over; an item that builds no body selects nothing, one the last
 * rebuild failed (`failed`) among them.
 */
export function rowReference(node: string, doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): GeometryReference | null {
  return rowReferences(doc, failed)(node);
}

/**
 * `rowReference` for every row of one document: the bodies and profiles
 * are listed once, so the browser's rows take time in proportion to their
 * number (security audit S2: listing them per row took its square).
 */
export function rowReferences(doc: DesignDocument, failed: ReadonlySet<string> = NONE_FAILED): (node: string) => GeometryReference | null {
  // A hidden body (U0f3) is not drawn, so its rows select nothing: a selection of something unseen.
  const rows = new Map(bodyRows(doc, failed).flatMap((r) => (bodyHidden(doc, bodyIdOf(r.feature.id)) ? [] : [[r.id, bodyIdOf(r.feature.id)] as const])));
  const solids = new Map([...rows.values()].map((b) => [bodyItem(b)!, b]));
  // A profile, and (25c1) a sketch with curves by either of its rows: its outline.
  const outlines = new Set([...doc.profiles.map((p) => p.id), ...doc.sketches.flatMap((s) => (s.curves.length > 0 ? [s.id] : []))]);
  return (node) => {
    const body = rows.get(node);
    if (body !== undefined) return bodyReference(body);
    if (solids.has(node)) return bodyReference(solids.get(node)!);
    const outline = node.startsWith("sketches/") ? node.slice("sketches/".length) : node;
    return outlines.has(outline) ? profileReference(outline) : null;
  };
}

/**
 * What a browser row's eye shuts or opens (`hideRow`'s id): a Body row its
 * feature, a sketch's row its item, an origin row itself, the Sketches,
 * Bodies and Origin folders theirs (EYE_FOLDERS); null for a row with no
 * eye (the Timeline's, the Profiles').
 */
export function eyeId(doc: DesignDocument, node: string, failed: ReadonlySet<string> = NONE_FAILED): string | null {
  if (node.startsWith("sketches/")) return node.slice("sketches/".length);
  if (node.startsWith("body-")) return bodyRows(doc, failed).find((r) => r.id === node)?.feature.id ?? null;
  if (ORIGIN.some((n) => n.id === node)) return node;
  return Object.hasOwn(EYE_FOLDERS, node) ? EYE_FOLDERS[node as keyof typeof EYE_FOLDERS] : null;
}
