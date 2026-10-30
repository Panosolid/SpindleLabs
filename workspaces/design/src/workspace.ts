// The Design workspace: the CAD, and the source of truth for all geometry.
// Until the sketcher (steps 21–33) it builds primitives and ready-made
// outlines; every other workspace will refer to its bodies, faces and edges.

import { latestOnly, NO_HIGHLIGHT, playback, ORIGIN_AT_FIRST, type BodySpec, type MoveKind, type BodyView, type ExtrudeArrow, type OfferedProfile, type SketchPointer, type SketchXY, type Command, type Framing, type Plane, type GeometryReference, type MountedWorkspace, type Selected, type SharedViewport, type WorkspaceContext, type WorkspaceId, type WorkspacePlugin } from "@fission/core";
import { needsRefit, printView, snapDistance } from "@fission/viewport";
import type { ShapeKind } from "./profiles.ts";
import { insertAt, isMoveItem, isSketchItem, ORIGIN_AXES, ORIGIN_PLANES as EYE_PLANES, originDrawn, partFeature, partOf, readDesignDocument, SKETCH_PLANES, type DesignDocument, type MoveParam, type PartKind } from "./document.ts";
import { arrowOf, DEFAULT_DISTANCE, DISTANCE_STEP, extrudeSketch, NO_SKETCH, NO_USABLE_SKETCH, PICK_PROFILE_STATUS, extrudeStep, featureSpec, previewSpec, setExtrudeDistance, signedDistance, ZERO_OK } from "./extrude.ts";
import { extrudePanel } from "./extrude-panel.ts";
import { CHANGED_WHILE_CHECKING, editableFeature, editFeature, editStep, readTyped, refusedSizes } from "./feature-edit.ts";
import { featureEditPanel } from "./feature-edit-panel.ts";
import { changedMove, insertMove, MOVE_STEP, moveKindOf, moveValues, NO_MOVE, ROTATE_STEP, type MoveValues } from "./move.ts";
import { draggedValues, editedBodies, editedMoveMesh, handlesCentre, MOVE_BOX_WORDS, movedMesh, pickedBodies, previewable, readMoveBoxes, refusedMove, startPivot } from "./move-tool.ts";
import { movePanel } from "./move-panel.ts";
import { snapEnds, snappedValues, snapPart, type SnapPart } from "./move-snap.ts";
import { PART_VIEW, syncGraph } from "./graph.ts";
import { registerDesign } from "./representations.ts";
import { DESIGN_COMMANDS, documentFor, DRAW_OPS, DRAW_STEPS, drawingFor, drawRefused, EXTRUDE_OP, commandDistance, extrudeTarget, RENAME_OP, renameTarget } from "./commands.ts";
import { buildSpec } from "./spec.ts";
import { SHAPE_LABELS, toolbarGroups, type ToolButton } from "./toolbar.ts";
import { commandSearch, GCODE_KIND, iconSvg, saveFile, toolGroup, type Command as SearchCommand, type IconName, type MenuButton, type MenuSection } from "@fission/ui";
import { comingItems, type ComingGroup } from "./coming-soon.ts";
import { INSERT_SIZES, INSERT_TITLE, inserted, insertSections, insertStep } from "./insert.ts";
import { startHint } from "./start-hint.ts";
import { browserTree, eyeId, rowItem, rowReferences, type BrowserNode } from "./browser.ts";
import { callOffDrag, showTimelineBar, timelineBarItems } from "./timeline-bar.ts";
import { DEFAULT_SIZES, parameterRows, propertiesPanel, revertedNote, SIZE_KEYS, type SizeKey } from "./properties.ts";
import { FOLDED_AT_START, propertiesFold, readPinned, type FoldState, type PropertiesFold } from "./properties-fold.ts";
import { freshDesign, START_FRESH_STEP, startFresh } from "./start-fresh.ts";
import { gcodeName, printWords, SLICE_PRINT_TITLE, sliceBodies, slicePrint } from "./slice-print.ts";
import { openPrintPreview } from "./print-preview.ts";
import { deleteAsk } from "./delete-ask.ts";
import { renameBox } from "./rename-box.ts";
import { hideRow, itemName, renameItem, TIMELINE_STEPS, usedSketchHidden } from "./timeline-edits.ts";
import { chooseBarAction, chooseEntry, menuEntries, openAction, renameEntry, type MenuHost } from "./timeline-menu.ts";
import { pickChange } from "./picking.ts";
import { DESIGN_SHORTCUTS, designShortcut, sketchToolKey, typedSizeKey } from "./shortcuts.ts";
import { BodyCache, followedDoc, rebuildTimeline, settleKept, type TimelineBuild } from "./rebuild.ts";
import { isFaceSketch } from "./face-sketch.ts";
import { droppedNote, highlightOf, panelFocus, selectionRows, survivors } from "./selection.ts";
import { bodyOf, joinBodies, sceneHit, shownBodies, type Scene, type ShownBody } from "./scene.ts";
import { bodyReference, readProfileReference } from "./references.ts";
import { addFaceSketch, addSketch, askOutline, outlineSourceOf, pinNewPoints, planeOf, projectEdges, SKETCH_STEPS, sketchCurves, sketchItem, sketchPlane, sketchSide } from "./sketch.ts";
import { PROJECT_AGAIN, projectedOpen, projectPick, sketchEdgeCurves } from "./projection.ts";
import { sketchEdgeTargets, sketchPlaneCorners } from "./face-edges.ts";
import { sketchableFaces, sketchSpot, type SketchSpot } from "./face-pick.ts";
import { FACE_NEW_BODY, faceOpen, faceProfile, type FaceProfile } from "./face-extrude.ts";
import { rounding, SNAP_PIXELS, snapOnSketch, snapsNow, withSnap, type BodySnaps, type Snap } from "./snap.ts";
import { aimOf, anchorOf, lengthRefused, liveValues, NO_AIM, typedFields, withLocks, type Locks } from "./typed-entry.ts";
import { typedBoxes } from "./typed-boxes.ts";
import { hintOf, pointerHint } from "./pointer-hint.ts";
import { clickAt, curveCount, hoverTool, DEFAULT_GRID, DEFAULT_GRID_SNAP, drawStep, GRID_ATE_RADIUS, NO_RADIUS, ORIGIN_PLANES, originPlanes, sketchDrawings, startTool, switchTool, toolBusy, unfinishedWords, type SketchTool, type ToolKind } from "./sketch-tool.ts";
import { sketchPanel } from "./sketch-panel.ts";
import { sketchToolbar } from "./sketch-toolbar.ts";
import type { Sketch, SketchPlane } from "./document.ts";
import { aiFaces, designAIView } from "./ai-view.ts";
import { COPY_SVG, DOWNLOAD_STL, hiddenStlNote, NO_BODY_STL, noBodyWords, registerDesignActions, shownBodyFeature, shownBodyRefs, STL_OVERLAY, targetsOf, type DesignRun } from "./actions.ts";

/**
 * What the user last entered (as typed), kept while other workspaces are
 * shown, with the document it made: when the project holds a different
 * document (a file was opened), the panel shows that one instead.
 */
let saved: { doc: DesignDocument; shape: PartKind; sizes: string[] } | null = null;
let framed: Framing | null = null;
let framedKind: PartKind | null = null;
/** Design was put away by an Undo or Redo made in another workspace: the next mount is that restore's, not an opened file's. */
let putAwayByRestore = false;
/**
 * Rebuilds asked for and not answered yet, per view element: its `data-rebuilding` says whether any is, so a test reads
 * the page only once it shows the last edit (the monkey). Counted across mounts: every Undo remounts Design on the same
 * view, and a rebuild of the Design put away that ends first must not say "done" while the new one's still runs
 * (real-use hunt C2, 2026-10-28).
 */
const rebuildsOn = new WeakMap<HTMLElement, number>();
/**
 * The sketch being edited and its grid, kept across mounts: Undo and Redo
 * re-mount Design, and you stay in the sketch (the chain in progress ends,
 * since the point it ran from may be gone). Cleared by Finish sketch.
 */
let editingSketch: { id: string; grid: number; typed: string; tool: ToolKind } | null = null;
/** Grid snap on or off (sketch feel SF1; off by default: points go where you click), kept for every sketch until the page reloads. */
let gridSnap = DEFAULT_GRID_SNAP;
/** How long (ms) Ctrl or Cmd is held with no other key before the snap under a still pointer goes: long enough for a shortcut's second key. */
const HELD_SHOW_MS = 150;
/** The Snap button on the sketch's toolbar: snapping to points, edges and line-ups on (the default) or off, kept for every sketch until the page reloads. */
let snapOn = true;
/** The properties' fold a new mount starts with (U0b): the user's pin, kept across Undo, Redo and switching; null until the first mount reads it from storage. */
let foldKept: FoldState | null = null;
/** How many times Design has framed the part, read by the e2e test (an undo must not add one). */
let fits = 0;

/** What Inspect ▾ does (U0f): show the body facts, and why there are none yet (null once a body is built). */
interface Inspecting {
  facts(): void;
  none(): string | null;
}

/** Why Body facts is off with nothing built. */
const NO_FACTS = "Nothing built yet: insert a preset or extrude a sketch, and its volume, area and faces show here.";

/**
 * Fills the toolbar slot the way Fusion lays it out (U0f): groups of icons,
 * each over its name. Create ▾ (Create sketch, Extrude), Modify ▾ (Move,
 * 35e2b), Insert ▾ (the presets, U0d), Inspect ▾ (Body facts), then the
 * command groups. Returns
 * each command button with its element, the Insert menu and the Body facts
 * button.
 */
function toolbar(slot: HTMLElement, onClick: (b: ToolButton) => void, onSketch: () => void, onExtrude: () => void, onMove: () => void, onRotate: () => void, onInsert: (kind: ShapeKind) => void, inspect: Inspecting): { made: [ToolButton, HTMLButtonElement][]; insert: MenuButton; facts: HTMLButtonElement; commands: () => SearchCommand[] } {
  const made: [ToolButton, HTMLButtonElement][] = [];
  const document = slot.ownerDocument; // the slot's own page, not a global one
  const button = (id: string, words: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.textContent = words;
    b.title = title;
    b.addEventListener("click", run);
    return b;
  };
  // The sketch tool is the user's, not a command yet: whether the AI gets
  // create_sketch and draw_line is the AI workstream's call (docs/ai.md).
  const sketchTitle = "Create sketch: draw lines, rectangles, circles and arcs on a plane. Pick the plane, then click.";
  const extrudeTitle = "Extrude: make a solid from a closed sketch or a flat face, by a distance you drag or type. A new body in the timeline, at the marker.";
  const create = button("create-sketch", "Create sketch", sketchTitle, onSketch);
  create.dataset.modelling = ""; // hidden while a sketch is edited (SF3b): the sketch's toolbar stands in
  const extrude = button("extrude", "Extrude", extrudeTitle, onExtrude);
  const createSections = (): MenuSection[] => [
    {
      items: [
        { id: "create-menu-sketch", label: "Create sketch", icon: "sketch", title: sketchTitle, run: onSketch },
        { id: "create-menu-extrude", label: "Extrude", icon: "extrude", key: "E", title: extrudeTitle, run: onExtrude },
      ],
    },
    { items: comingItems("Create") },
  ];
  const creating = toolGroup(document, { name: "Create", menu: { id: "create-menu", title: "Every way to make a solid, by name", sections: createSections } });
  creating.add([create, "sketch"], [extrude, "extrude"]);
  // While a sketch is edited its own Create ▾ stands in, and Extrude (kept, SF3b) sits over the plain name Solid.
  creating.menu!.element.dataset.modelling = "";
  const solid = document.createElement("span");
  solid.textContent = "Solid";
  solid.dataset.sketching = "";
  solid.hidden = true;
  creating.menu!.element.after(solid);
  // The presets, hidden in a menu until wanted, each a new body (insert.ts).
  const inserting = toolGroup(document, { name: "Insert", solo: "insert", menu: { id: "insert", title: INSERT_TITLE, sections: () => insertSections(onInsert) } });
  inserting.element.dataset.modelling = "";
  // The body facts (volume, area, faces), from the properties panel, folded since U0b.
  const facts = button("inspect-facts", "Body facts", "Body facts: the volume, area and faces of what is built, in the properties.", () => inspect.facts());
  facts.disabled = true; // until a body is built (workspace: after each build)
  const inspectSections = (): MenuSection[] => [{ items: [{ id: "inspect-menu-facts", label: "Body facts", icon: "inspect", title: facts.title, off: inspect.none() ?? undefined, run: () => inspect.facts() }] }, { items: comingItems("Inspect") }];
  const inspecting = toolGroup(document, { name: "Inspect", menu: { id: "inspect-menu", title: "Every way to look into the part, by name", sections: inspectSections } });
  inspecting.add([facts, "inspect"]);
  inspecting.element.dataset.modelling = "";
  // Groups whose tools are all still to come (coming-soon.ts), greyed: their menus list what is on the way.
  const coming = (name: string, id: string, icon: IconName, title: string) => {
    const g = toolGroup(document, { name, solo: icon, menu: { id, title, sections: () => [{ items: comingItems(name as ComingGroup) }] } });
    g.element.classList.add("coming-soon");
    g.element.dataset.modelling = "";
    return g;
  };
  // Modify ▾ (35e2b): Move and (Ben, 2026-10-29) Rotate, each its own tool, then the tools still to come.
  const moveTitle = "Move: slide bodies along X, Y and Z by distances you drag or type. Pick the bodies, then OK. A Move in the timeline, at the marker.";
  const move = button("move", "Move", moveTitle, onMove);
  const rotateTitle = "Rotate: turn bodies about X, Y and Z by angles you drag or type. Pick the bodies, then OK. A Rotate in the timeline, at the marker.";
  const rotate = button("rotate", "Rotate", rotateTitle, onRotate);
  const modifySections = (): MenuSection[] => [{ items: [{ id: "modify-menu-move", label: "Move", icon: "move", key: "M", title: moveTitle, run: onMove }, { id: "modify-menu-rotate", label: "Rotate", icon: "rotate", key: "Shift+R", title: rotateTitle, run: onRotate }] }, { items: comingItems("Modify") }];
  const modifying = toolGroup(document, { name: "Modify", menu: { id: "modify-menu", title: "Every way to change bodies, by name", sections: modifySections } });
  modifying.add([move, "move"], [rotate, "rotate"]);
  modifying.element.dataset.modelling = "";
  const constructing = coming("Construct", "construct-menu", "plane", "Construct: planes, axes and points to build on. Coming soon: open to see what is on the way.");
  // Fusion's order: Create, Modify, Construct, Inspect, Insert, then the exports.
  slot.append(creating.element, modifying.element, constructing.element, inspecting.element, inserting.element);
  /** The toolbar's own buttons as the command search names them: the group's name, then the button's ("Export STL"). */
  const named: [string, HTMLButtonElement][] = [];
  for (const group of toolbarGroups()) {
    const g = toolGroup(document, { name: group.name });
    g.element.dataset.modelling = "";
    for (const b of group.buttons) {
      const el = button(`tool-${b.command.op}`, b.label, `${b.label}: ${b.title}`, () => onClick(b));
      el.dataset.op = b.command.op; // read by the e2e test
      if (typeof b.command.shape === "string") el.dataset.shape = b.command.shape;
      g.add([el, b.icon]);
      made.push([b, el]);
      named.push([`${group.name} ${b.label}`, el]);
    }
    slot.append(g.element);
  }
  // The command search box (S, Ben's keys 10-29): every menu's items as they are now, in the toolbar's order, then the
  // toolbar's own buttons (Export STL…), each off with its reason exactly when its menu item or button is.
  const commands = (): SearchCommand[] => {
    const items = [createSections(), modifySections(), [{ items: comingItems("Construct") }], inspectSections(), insertSections(onInsert)].flatMap((ss) => ss.flatMap((sec) => sec.items));
    return [
      ...items.map((i) => ({ id: i.id, label: i.label, key: i.key, off: i.off, run: i.run })),
      ...named.map(([label, el]) => ({ id: el.id, label, off: el.disabled ? `${label} is off now` : undefined, run: () => el.click() })),
    ];
  };
  return { made, insert: inserting.menu!, facts, commands };
}

/** A browser row's icon (U0f3): 16 px, before its words, hidden from screen readers. */
const rowIcon = (document: Document, name: IconName) => {
  const icon = iconSvg(document, name, 16);
  icon.classList.add("browser-row-icon");
  return icon;
};

/** Whether two sets of ids hold the same ids. */
const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

/** Browser groups the user folded (false) or opened (true), kept across rebuilds and workspace switches; any other group starts as its node says (`startsFolded`). */
const folding = new Map<string, boolean>();
const isOpen = (n: { id: string; startsFolded?: boolean }) => folding.get(n.id) ?? !n.startsFolded;

/** Lights the browser rows whose geometry is selected (aria-current), and only those; `failed`, the last rebuild's failed ids, select nothing. */
function lightRows(slot: HTMLElement, doc: DesignDocument, failed: ReadonlySet<string>, items: readonly GeometryReference[]) {
  const refOf = rowReferences(doc, failed);
  for (const row of slot.querySelectorAll<HTMLElement>(".tree-row")) {
    const ref = refOf(row.dataset.node!);
    if (ref && items.some((i) => i.kind === ref.kind && i.id === ref.id)) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  }
}

/**
 * Fills the browser slot with the document's tree: groups fold (native
 * details/summary). A row for selectable geometry (Body 1, a profile) is a button
 * that selects it (Shift adds or takes out); the others are plain rows
 * until features (step 24) and origin planes (step 21) can be selected.
 * A sketch's row in the Sketches group opens its menu (Delete, 24e4) on a
 * right-click, or from its ⋯ button for touch and the keyboard; a
 * double-click on it or a Timeline row opens the item (`onOpen`, 25a3).
 * The items the last rebuild failed (`failed`) have no Body row and their
 * Timeline rows select nothing. Rebuilt on every edit and after every
 * rebuild that changes `failed`; folding is kept by id.
 */
function browser(slot: HTMLElement, doc: DesignDocument, failed: ReadonlySet<string>, onSelect: (ref: GeometryReference, shift: boolean) => void, onMenu: (node: string, at: { x: number; y: number }) => void, onOpen: (node: string) => void, onEye: (node: string) => void) {
  // Rows with the timeline's item menu (24f3): every Timeline row by its item's id, and each sketch's row in Sketches.
  const items = new Set(doc.timeline.features.map((f) => f.id));
  const refOf = rowReferences(doc, failed);
  const document = slot.ownerDocument;
  // The toggle event fires a task after the click, so a rebuild can come
  // first: read the folding from the tree being replaced, not only events.
  for (const d of slot.querySelectorAll<HTMLDetailsElement>("details[data-node]")) folding.set(d.dataset.node!, d.open);
  // A row's eye (U0f3, Fusion's; on every row that draws something since Ben's ask 2026-10-29): hides or shows it, one undo step; a hidden row is dimmed.
  const eyeOf = (n: BrowserNode): HTMLButtonElement | null => {
    if (n.hidden === undefined) return null;
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "browser-row-eye";
    eye.dataset.eye = n.id; // read by the e2e test
    const words = `${n.hidden ? "Show" : "Hide"} ${n.label}`;
    eye.setAttribute("aria-label", words);
    eye.setAttribute("aria-pressed", String(!n.hidden)); // pressed while it shows
    eye.title = words;
    eye.append(iconSvg(document, n.hidden ? "eye-off" : "eye", 16));
    eye.addEventListener("click", (e) => {
      e.preventDefault(); // in a folder's summary: the press is the eye's, not the fold's
      onEye(n.id);
    });
    return eye;
  };
  const list = (nodes: BrowserNode[]) => {
    const ul = document.createElement("ul");
    ul.className = "tree";
    for (const n of nodes) {
      const li = document.createElement("li");
      if (n.children) {
        const details = document.createElement("details");
        details.open = isOpen(n);
        details.dataset.node = n.id; // read by the e2e test
        details.addEventListener("toggle", () => {
          if (details.isConnected) folding.set(n.id, details.open);
        });
        const summary = document.createElement("summary");
        summary.textContent = n.label;
        summary.prepend(rowIcon(document, n.icon)); // U0f3: a folder before each group's name
        // A folder's eye (Ben, 2026-10-29): shut, nothing in it is drawn; its press doesn't fold the folder.
        const shut = eyeOf(n);
        if (shut) summary.prepend(shut);
        details.append(summary, list(n.children));
        li.append(details);
      } else {
        const ref = refOf(n.id);
        const row = document.createElement(ref ? "button" : "span");
        if (ref) row.setAttribute("type", "button");
        row.className = "tree-row";
        row.textContent = n.label;
        row.prepend(rowIcon(document, n.icon)); // U0f3: the item's icon before its words (its words stay its name)
        // One line per row (U0a): a label too long for it ends in "…", and the tooltip has it whole, or an item's description (U0e).
        row.title = n.title ?? n.label;
        row.dataset.label = n.label;
        row.dataset.tip = row.title;
        row.dataset.node = n.id;
        if (ref) row.addEventListener("click", (e) => onSelect(ref, (e as MouseEvent).shiftKey));
        if (items.has(n.id) || n.id.startsWith("sketches/") || n.id.startsWith("body-")) {
          row.addEventListener("dblclick", () => onOpen(n.id));
          // The row's menu: a right-click at the pointer, or the ⋯ button under itself.
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            onMenu(n.id, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
          });
          const more = document.createElement("button");
          more.type = "button";
          more.className = "delete-ask-more";
          more.dataset.more = n.id; // read by the e2e test
          more.textContent = "⋯";
          more.title = `${n.label}: more`;
          more.setAttribute("aria-label", `${n.label} options`);
          more.setAttribute("aria-haspopup", "menu");
          more.addEventListener("click", () => {
            const r = more.getBoundingClientRect();
            onMenu(n.id, { x: r.left, y: r.bottom });
          });
          const line = document.createElement("div");
          line.className = "delete-ask delete-ask-row";
          line.append(row, more);
          const eye = eyeOf(n);
          if (eye) line.prepend(eye);
          if (n.hidden || n.folderHidden) line.classList.add("browser-row-hidden");
          li.append(line);
        } else if (n.hidden !== undefined) {
          // An origin row's eye, on a line of its own as an item row's.
          const line = document.createElement("div");
          line.className = "delete-ask delete-ask-row";
          line.append(eyeOf(n)!, row);
          if (n.hidden || n.folderHidden) line.classList.add("browser-row-hidden");
          li.append(line);
        } else li.append(row);
      }
      ul.append(li);
    }
    return ul;
  };
  // The whole panel folds too (SF3d): it floats over the view, so folding it gives the view back.
  const fold = document.createElement("details");
  fold.className = "browser-fold";
  fold.dataset.node = "browser";
  fold.open = isOpen({ id: "browser" });
  fold.addEventListener("toggle", () => {
    if (fold.isConnected) folding.set("browser", fold.open);
  });
  const title = document.createElement("summary");
  title.textContent = "Browser";
  fold.append(title, list(browserTree(doc, failed)));
  slot.replaceChildren(fold);
}

/** A warning from the rebuild (24d2's kept shape; 26e's lost plane and lost source): its item, the Timeline rows it marks, the sketch it is about, its words, and whether it is a lost plane. */
interface Warned {
  item: string;
  rows: string[];
  sketch: string;
  words: string;
  lost?: true;
}

function mount(ctx: WorkspaceContext): MountedWorkspace {
  const panel = propertiesPanel(ctx.properties);
  const { inputs } = panel;
  let shape: PartKind = "box";
  const held = ctx.project.workspaces.design as DesignDocument | undefined;
  /** A document the project holds that this panel did not make (an opened file): shown as it is, and framed. */
  let loaded: DesignDocument | undefined;
  /** The document this panel last made, mounted again (Design moved to the other pane): shown as it is, never remade from the size boxes (daily hunt 2026-10-23: a design with no body got a new box). */
  let remounted: DesignDocument | undefined;
  if (saved && held === saved.doc) {
    shape = saved.shape;
    inputs.forEach((input, i) => (input.value = saved!.sizes[i]));
    remounted = held;
  } else if (held) {
    const part = partOf(held); // readDesignDocument checked it when the file was opened; null when it has no body (24f4)
    if (part) {
      shape = part.shape;
      for (const [i, key] of SIZE_KEYS.entries()) if (part.sizes[key] !== undefined) inputs[i].value = String(part.sizes[key]);
    }
    loaded = held;
    framedKind = null; // an opened file is a new part: frame it (not after Undo or Redo: keepCamera)
  }
  /** Mounted by Undo or Redo (step 20c): the first build keeps the camera unless the body no longer fits, even for another shape. */
  let keepCamera = ctx.history.restoring() || putAwayByRestore;
  putAwayByRestore = false;
  const inspecting: Inspecting = {
    // Opens the folded panel until the user moves on (U0b), at the numbers.
    facts() {
      if (inspecting.none()) return;
      fold?.reveal();
      ctx.properties?.dispatchEvent(new Event("properties-reveal", { bubbles: true })); // a phone opens its Properties sheet (main.ts)
      ctx.properties?.querySelector("#volume")?.closest("dl")?.scrollIntoView({ block: "nearest" });
    },
    none: () => ((lastScene?.bodies.length ?? 0) > 0 ? null : NO_FACTS),
  };
  const { insert: insertMenu, facts: factsButton, commands } = toolbar(ctx.toolbar, (b) => run(b.command), () => startSketch(), () => startExtrude(), () => startMove(), () => startMove(null, "rotate"), (kind) => void insertBody(kind), inspecting);
  // S: the command search box over the page (Ben's keys 10-29), listing what the toolbar offers now.
  const searchBox = commandSearch(ctx.toolbar.ownerDocument, commands);
  const fresh = startFresh(ctx.toolbar, { current: () => designDoc(), confirm: () => void clearDesign() });
  // File ▾ > Slice for printing (H2a): every body shown, as Export STL takes them, sliced and saved as G-code.
  const printing = slicePrint(ctx.toolbar, {
    async slice(choices) {
      const doc = designDoc();
      const features = doc ? shownBodyRefs(doc, failedNow).flatMap((r) => shownBodyFeature(r, doc, failedNow) ?? []) : [];
      const print = await sliceBodies(kernel, doc!, features, choices);
      const r = await saveFile(ctx.toolbar.ownerDocument, { suggestedName: gcodeName(choices), kind: GCODE_KIND, bytes: new TextEncoder().encode(print.gcode) as Uint8Array<ArrayBuffer> });
      if (r.status === "failed") throw new Error(r.message);
      return { print, saved: r.status === "saved" };
    },
    // Preview (H2b, H2c): the same slice, played through the replayer and shown in 3D with its time-lapse.
    async preview(choices) {
      const doc = designDoc();
      const features = doc ? shownBodyRefs(doc, failedNow).flatMap((r) => shownBodyFeature(r, doc, failedNow) ?? []) : [];
      const print = await sliceBodies(kernel, doc!, features, choices);
      openPrintPreview(ctx.toolbar, playback(print.gcode), printWords(print), (host, p) => printView(host, p));
    },
  });
  const deleting = deleteAsk(ctx.toolbar);
  const renaming = renameBox(ctx.toolbar);
  /** Where the last item menu opened: Rename's box opens there (U0e2). */
  let menuAt = { x: 0, y: 0 };
  // An empty design's hint (U0c): its buttons do what the toolbar's and the top bar's do.
  const startCard = startHint(ctx.viewport.element, { sketch: () => startSketch(), insert: () => insertMenu.open(true), open: ctx.openFile });
  /**
   * Shows the hint while the design is empty and no sketch is being started, and only while Design is on screen:
   * the card sits in the shared 3D view, so asleep it would float over another workspace (owner's report, 2026-10-28).
   */
  const showStart = () => startCard.update(shown ? (ctx.project.workspaces.design as DesignDocument | undefined) : undefined, mode.kind !== "none");
  const { kernel, viewport } = ctx;
  /** On screen (awake); false while asleep (X7) and after unmount. */
  let shown = true;
  /** A build finished while asleep and was not drawn: wake builds again. */
  let missed = false;
  /** Every body drawn, with its faces' and edges' names (steps 24c, 24d3b), which the selection holds. */
  let lastScene: Scene | null = null;
  /** The part's body in the last scene that showed it: the panel's numbers, marked out of date, while the part fails. */
  let partShown: ShownBody | null = null;
  /** The note about items the last rebuild dropped, and whether that drop is being applied now. */
  let note = "";
  let settling = false;

  /** The failed ids the browser's rows were last drawn with. */
  let rowsFailed: ReadonlySet<string> = new Set();
  /** Draws the browser for `doc` with the last rebuild's failed items (no Body row for them). */
  function drawBrowser(doc: DesignDocument) {
    rowsFailed = failedNow;
    browser(ctx.browser, doc, failedNow, selectRow, openRowMenu, (node) => openItem(itemOfRow(node)), toggleHidden);
  }

  /** The origin's axes and planes as their eyes say (Ben, 2026-10-29): every axis and no plane until an eye is pressed. */
  function showOrigin(doc: DesignDocument) {
    viewport.showOrigin({
      axes: [originDrawn(doc, ORIGIN_AXES[0]), originDrawn(doc, ORIGIN_AXES[1]), originDrawn(doc, ORIGIN_AXES[2])],
      planes: EYE_PLANES.filter((id) => originDrawn(doc, id)).map((id) => ({ id, plane: planeOf(id.slice("origin-".length).toUpperCase() as SketchPlane) })),
    });
  }

  /**
   * A Body row's eye (U0f3): hides its body, or shows it again, as one undo
   * step ("Hide Body 1"), in any mode (a sketch being drawn stays open, as
   * in Fusion). Hiding clears the selection: what was picked may be on it.
   */
  function toggleHidden(node: string) {
    const doc = designDoc();
    const flat = (nodes: readonly BrowserNode[]): BrowserNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
    const n = flat(browserTree(doc, failedNow)).find((r) => r.id === node);
    const id = eyeId(doc, node, failedNow);
    if (n?.hidden === undefined || id === null) return;
    const hide = !n.hidden;
    if (hide) ctx.selection.clear();
    void update(hide ? TIMELINE_STEPS.hide(n.label) : TIMELINE_STEPS.show(n.label), undefined, hideRow(doc, id, hide));
  }

  /** The browser's Body 1 row: a click selects the body, Shift adds or takes it out. */
  function selectRow(ref: GeometryReference, shift: boolean) {
    // A new Move picks its bodies one click at a time, as Fusion's selection box does (35e2b).
    if (shift || (picksBodies() && ref.kind === "body")) ctx.selection.toggle(ref);
    else ctx.selection.set([ref]);
  }

  /** The properties' fold (U0b), made once the tool boxes are in the panel; a selection drawn before then folds nothing. */
  let fold: PropertiesFold | null = null;
  /** The ids of the sketches whose outlines are selected, as the last showSelection found them. */
  let selectedSketches: ReadonlySet<string> = new Set();
  /** Draws the selection: the viewport's colours, the lit browser rows, the properties' rows. */
  function showSelection() {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc) return;
    const items = ctx.selection.items;
    // Which selected outlines are sketches', for the note when a rebuild drops one (25c1); one already
    // gone from `doc` (shown again before the rebuild that drops it) keeps what it was.
    selectedSketches = new Set(
      items.flatMap((i) => {
        const id = readProfileReference(i);
        if (id === null) return [];
        const source = outlineSourceOf(i, doc);
        return (source ? source.kind === "sketch" : selectedSketches.has(id)) ? [id] : [];
      }),
    );
    viewport.showSelection(highlightOf(items, lastScene));
    lightRows(ctx.browser, doc, failedNow, items);
    fold?.update({ selected: items.length > 0 });
    panel.showSelection(selectionRows(items, lastScene, doc));
    // The Feature and Body sections describe the selected feature (else the part), with the browser's number for its body.
    const focus = panelFocus(items, lastScene, doc);
    panel.showFeature(focus?.feature ?? null);
    if (focus?.body) panel.showBody(focus.body.view, `Body ${focus.body.place}`);
    // The part failed: the numbers it last built, marked out of date (markStale, "Out of date: these numbers are for the last part that built").
    else if (focus && partShown?.feature === focus.feature.id && focus.feature === partFeature(doc)) panel.showBody(partShown.view, `Body ${partShown.place}`);
    else panel.showNoBody(); // a body that did not build, or a design with no body (24f4)
    // Verbs, not apps: whatever the registry offers for this selection, from any workspace.
    const verbs = ctx.actions.actionsFor(targetsOf(items, doc, failedNow));
    panel.showActions(verbs, (id) => runAction(id, ctx.selection.items));
  }

  /** Runs a registered verb on these targets and shows what it said. */
  async function runAction(id: string, targets: readonly Selected[], note = "") {
    const action = ctx.actions.get(id);
    if (!action) return panel.showActionNote(`No action ${id} is registered.`, true);
    // Design's own runs know the bodies drawn (actions.ts, DesignRun: the precision overlay marks only those that warned);
    // the shell's context stays the prototype, so its getters (the project, the graph) read live as ever.
    const run: DesignRun = Object.assign(Object.create(ctx) as WorkspaceContext, { scene: lastScene });
    const outcome = await action.run(targets, run);
    if (shown) panel.showActionNote([outcome.message, note].filter(Boolean).join(" "), outcome.bad);
  }

  // The body is built from the part's feature intent (document.ts); an extrude of a sketch asks the kernel for the outline (extrude.ts).
  // Its faces and edges are named from the spec it was built from (naming.ts).
  // The whole timeline is rebuilt on the kernel's body store (step 24d2,
  // rebuild.ts): a feature whose spec is unchanged keeps its body, and
  // bodies no feature holds are freed. Rebuilds run one after another, so
  // one never frees a body another is about to show.
  // Settling an edit (26c, 26g) places its face sketches on these bodies too, reusing what is built: a body is never
  // held twice, and the ones a settle builds that no rebuild keeps are freed once it ends (BodyCache.using).
  const bodies = new BodyCache(kernel);
  // A kernel that trapped is replaced by a fresh one (kernel-client.ts): its bodies are gone, so the design is built
  // again on the new one, and every item the trap turned red comes back (Ben's phone project, 2026-10-28). A restart
  // while that build runs (memory still tight, another call trapping) builds once more when it ends, or the design
  // stayed red until the next edit (real-use hunt E2); a design that traps every fresh kernel stops after HEALS builds
  // in a row and shows the failure, rather than restarting forever.
  const HEALS = 3;
  let healing = false;
  let again = false;
  let heals = 0;
  const heal = () => {
    healing = true;
    again = false;
    heals++;
    void show(designDoc(), shape).finally(() => {
      healing = false;
      if (!again) heals = 0;
      else if (heals < HEALS) heal();
      else heals = 0;
    });
  };
  /** Kernel restarts so far: a panel's question cut off by one is asked again on the fresh kernel (onceMoreAfterRestart). */
  let restarts = 0;
  /**
   * `ask`, and once more if the kernel restarted while it was asked: the answer it gave (often "the geometry kernel ...
   * was started again", or a body the restart left unbuilt) is the old kernel's, not the question's (weak-spot hunt C3:
   * Extrude's outline check stuck with OK off, Move's OK saying the box was not built though it was drawn again).
   */
  async function onceMoreAfterRestart<T>(ask: () => Promise<T>): Promise<T> {
    const seen = restarts;
    try {
      const answer = await ask();
      if (restarts === seen) return answer;
    } catch (e) {
      if (restarts === seen) throw e;
    }
    return ask();
  }
  const stopHealing = kernel.onRestart?.(() => {
    restarts++;
    bodies.forget();
    if (healing) again = true;
    else heal();
  });
  let rebuilds: Promise<unknown> = Promise.resolve();
  const build = latestOnly((doc: DesignDocument) => {
    const next = rebuilds.then(() => buildPart(doc));
    rebuilds = next.catch(() => {});
    return next;
  });
  /**
   * Every body the timeline built, joined for drawing (scene.ts, 24d3b);
   * when a body is built from a kept shape, the warning (the last such);
   * and, when the part (the last solid feature) has no body, why: the
   * bodies that did build are drawn all the same (bug hunt 2026-10-19,
   * finding 5: a failed part left the scene from before, so the browser's
   * rows and the panel described bodies that were not there). A design
   * with no part (24f4) builds an empty scene.
   */
  async function buildPart(doc: DesignDocument) {
    const feature = partFeature(doc);
    const build = await rebuildTimeline(doc, bodies, kernel);
    failedNow = new Set(Object.keys(build.results).filter((id) => build.results[id].status === "failed"));
    resultsNow = build.results;
    // Where each sketch on a face was placed (26c), so it is drawn there.
    placedNow = new Map(Object.entries(build.results).flatMap(([id, r]) => (r.status === "built" && r.placement ? [[id, r.placement.plane] as const] : [])));
    const result = feature && build.results[feature.id];
    let failure: string | undefined;
    if (result?.status === "failed") failure = result.message;
    else if (feature && result && (result.status !== "built" || result.body === undefined || result.spec === undefined)) failure = `${feature.provenance.self.label} is ${result.status}`;
    const drawn = await shownBodies(doc, build, bodies);
    return { scene: joinBodies(drawn), warnings: warningsOf(doc, build), failure, followed: followedDoc(doc, build) };
  }
  /**
   * The rebuild's warnings in timeline order: an extrude built from its kept
   * shape (the owner's rule: on its row and its sketch's), and from 26e a
   * sketch whose plane is lost (Q1, Q6: it stays where it was, drawn red)
   * and an extrude built from one (its source is lost); from 26f a
   * sketch's points whose edges are lost, and from 27d its projections.
   */
  function warningsOf(doc: DesignDocument, build: TimelineBuild): Warned[] {
    const out: Warned[] = [];
    for (const f of doc.timeline.features) {
      const r = build.results[f.id];
      if (r?.status !== "built") continue;
      const label = f.provenance.self.label;
      if (r.plane) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.plane.message}.`, lost: true });
      if (r.warning) out.push({ item: f.id, rows: [f.id, r.warning.sketch], sketch: r.warning.sketch, words: `${label} keeps its last shape. ${r.warning.message}.` });
      if (r.source) out.push({ item: f.id, rows: [f.id], sketch: r.source.sketch, words: `${r.source.message}.` });
      if (r.points) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.points.message}.` });
      if (r.projections) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.projections.message}.` });
    }
    return out;
  }
  /** The last rebuild's warnings: shown on their timeline rows and items and, once the sketch each is about is finished, in the panel. */
  let warningsNow: Warned[] = [];
  /** The warnings to show now: while a sketch is being edited, none about it (the outline status says what is open; the owner's rule: a warning after Finish Sketch). */
  const shownWarnings = () => warningsNow.filter((w) => !(mode.kind === "edit" && editingSketch?.id === w.sketch));
  /** Each row's warning words, by row (a row with two warnings has both). */
  function warnedRows(): Map<string, string> {
    const rows = new Map<string, string>();
    for (const w of shownWarnings()) for (const row of w.rows) rows.set(row, rows.has(row) ? `${rows.get(row)} ${w.words}` : w.words);
    return rows;
  }
  function showKept() {
    const shown = shownWarnings();
    panel.showWarning(shown.map((w) => w.words).join(" "));
    const rows = warnedRows();
    for (const row of ctx.browser.querySelectorAll<HTMLElement>(".tree-row")) {
      const words = rows.get(row.dataset.node!);
      if (words !== undefined) row.title = words;
      else if (row.classList.contains("kept")) row.title = row.dataset.tip ?? "";
      row.classList.toggle("kept", words !== undefined);
    }
  }

  /** Never shows stale numbers unmarked: dims them while out of date, and says so if the rebuild failed. */
  function markStale(failed = false) {
    panel.markStale(ctx.graph.isStale(PART_VIEW), failed);
    showDownstream();
  }

  /**
   * The chips for what other workspaces make from the design, their state
   * read from the graph now: drawn after every change Design makes to the
   * graph (markStale runs after each), so none shows a state it has lost.
   */
  function showDownstream() {
    const chips = ctx.downstream.summaries("design", ctx.graph).map((s) => ({ ...s, targetName: ctx.workspaceTitle(s.target) }));
    panel.showDownstream(chips, (target) => ctx.openWorkspace(target as WorkspaceId));
  }

  /** The command the toolbar and the inputs stand for: set_part with this shape and these sizes. */
  function partCommand(): Command {
    const [width, depth, height] = inputs.map((i) => Number(i.value));
    return { op: "set_part", shape, width, depth, height };
  }

  /**
   * Does what a Design command says: the toolbar's buttons come here, and
   * the AI's accepted commands will too. A set_part from the toolbar names
   * only the shape and keeps the sizes; the kernel judges the sizes (a bad
   * one shows its message, as when typed).
   */
  function run(command: Command) {
    // The whole design's STL, every body shown in one file (25c1): the same verb selected bodies offer, from the registry.
    if (command.op === "export_stl") {
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      const bodies = doc ? shownBodyRefs(doc, failedNow) : [];
      if (bodies.length === 0) return panel.showActionNote(doc ? noBodyWords(doc, failedNow) : NO_BODY_STL, true);
      // Hidden bodies are left out, as in Fusion; the note says which (beginner play-test 2026-10-28).
      return runAction(DOWNLOAD_STL, bodies, hiddenStlNote(doc!, failedNow));
    }
    if (command.op === "create_sketch") return aiSketch(String(command.on));
    if (DRAW_OPS.includes(command.op)) return aiDraw(command);
    if (command.op === EXTRUDE_OP) return aiExtrude(command);
    if (command.op === RENAME_OP) return aiRename(command);
    if (command.op !== "set_part") throw new Error(`Design has no command ${command.op}`);
    const kind = command.shape as ShapeKind;
    shape = kind;
    for (const [i, key] of SIZE_KEYS.entries()) if (typeof command[key] === "number") inputs[i].value = String(command[key]);
    return update(`Change shape to ${SHAPE_LABELS[kind] ?? kind}`);
  }

  /** Why the panel's sizes for `kind` can't be taken (the first shown box that isn't from 0.001 mm to 1 km), or null. */
  function refusedSize(kind: PartKind): string | null {
    for (const r of parameterRows(kind)) {
      if (!r.shown) continue;
      const text = inputs[SIZE_KEYS.indexOf(r.key)].value;
      const label = kind === "sketch-extrude" ? "distance" : r.label.toLowerCase();
      const v = Number(text);
      if (text.trim() === "" || !Number.isFinite(v)) return `Type the ${label} in mm.`;
      if (v <= 0) return `The ${label} must be more than 0 mm.`;
      // Under 0.001 mm or over 1 km: the sketch boxes' and the AI's one rule (typed-entry.ts), in the box's own name (app sweep 2026-10-28).
      const refused = lengthRefused(v);
      if (refused !== null) return `The ${label}${refused.slice("A length".length)}`;
    }
    return null;
  }
  /** Leaving a size box whose text was refused: the size the design last took comes back, and the words go. */
  function restoreRefused(i: number) {
    const why = saved === null ? null : refusedSize(shape);
    if (saved === null || why === null) return;
    const typed = inputs[i].value;
    inputs[i].value = saved.sizes[i];
    // It went back without a word (beginner play-test 2026-10-28): say so, until the next size typed.
    if (refusedSize(shape) === null) panel.showError(revertedNote(why, typed, saved.sizes[i], shape === "sketch-extrude"));
  }

  /**
   * Builds the part from the panel, or makes `next` the document (an
   * extrude); `label` and `mergeKey` name the undo step when this is a
   * user's edit (none while mounting).
   */
  async function update(label?: string, mergeKey?: string, next?: DesignDocument) {
    const kind = shape;
    // A size typed in the panel that isn't one is refused there, and the design keeps its last sizes: no number, or one
    // no file can hold ("Infinity" where the box takes it as typed; hunt 26g: it took the size, its undo step couldn't
    // be saved, and nothing said so), and an empty box, 0 or below (Ben's Fusion answer 8: -5 and 0 are not accepted;
    // hunt 26h: they went to the kernel and the failed part was recorded and saved). Leaving the box puts the last
    // size back (`restoreRefused`). Under 0.001 mm or over 1 km is refused there too (`lengthRefused`); the kernel judges the rest.
    if (next === undefined && loaded === undefined) {
      const refused = refusedSize(kind);
      if (refused !== null) return panel.showError(refused);
    }
    viewport.clearOverlay(STL_OVERLAY); // it described the part before this edit
    // The panel edits the part's one solid feature, keeping the sketches; the
    // project holds it. An opened file's document is kept as it is until the
    // first edit. An extrude of a sketch has one size, its distance (the height box).
    const current = ctx.project.workspaces.design as DesignDocument | undefined;
    const doc = next ?? loaded ?? remounted ?? (kind === "sketch-extrude" && current ? setExtrudeDistance(current, Number(inputs[2].value)) : documentFor(partCommand(), current));
    // No shape is the part's while the design has no body (24f4): the Shape choice says "—".
    panel.setShape(kind, partFeature(doc) === null ? null : kind);
    // An opened document is all new to the graph: out of date until it builds.
    const before = loaded ? null : (current ?? null);
    loaded = undefined;
    remounted = undefined;
    saved = { doc, shape, sizes: inputs.map((i) => i.value) };
    syncGraph(ctx.graph, doc, before, ctx.changeNotes);
    const changed = ctx.project.workspaces.design !== doc;
    // A user's edit is settled once recorded (`settled`), from the design before the first edit not yet settled.
    if (changed && label !== undefined && current) unsettled ??= current;
    ctx.project.workspaces.design = doc;
    if (changed) ctx.projectChanged(label, mergeKey); // the shell autosaves (19c) and records the undo step (20b)
    await show(doc, kind);
  }

  /**
   * Start fresh (start-fresh.ts), once its dialog is confirmed: out of any
   * sketch or Extrude panel, the selection cleared, the panel back to the
   * box at its default sizes, and the fresh design as one undo step, framed.
   */
  function clearDesign() {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind !== "none") leaveSketch(false); // update() below shows the fresh design
    ctx.selection.clear();
    shape = "box";
    inputs.forEach((input, i) => (input.value = DEFAULT_SIZES[SIZE_KEYS[i]]));
    framedKind = null; // a new part: frame it
    return update(START_FRESH_STEP, undefined, freshDesign());
  }

  /**
   * Insert ▾ (insert.ts): a whole new `kind` body at the marker at the
   * default sizes, as one undo step, never changing a body already there.
   * The panel then edits it (the boxes take its sizes) and opens to show
   * them; the first body of an empty design is framed, a later one keeps
   * the camera.
   */
  function insertBody(kind: ShapeKind) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind !== "none") leaveSketch(false);
    const doc = designDoc();
    ctx.selection.clear();
    shape = kind;
    inputs.forEach((input, i) => (input.value = String(INSERT_SIZES[SIZE_KEYS[i]])));
    if (partFeature(doc) === null) framedKind = null;
    const made = update(insertStep(kind), undefined, inserted(doc, kind).doc);
    fold?.reveal();
    return made;
  }

  /** The sketches whose plane the last rebuild found lost (26e): drawn red where they stay. */
  const lostSketches = () => new Set(warningsNow.flatMap((w) => (w.lost ? [w.item] : [])));
  /** The items the last rebuild failed (24f3: red in the bar and the browser's Timeline rows); the data's own failures are added by `timelineBarItems`. */
  let failedNow: ReadonlySet<string> = new Set();
  /** Where the last rebuild placed each sketch on a face (26c), by sketch id: drawn and looked at there. */
  let placedNow: ReadonlyMap<string, Plane> = new Map();
  /** What the last rebuild made of each item (built, failed, greyed…): an edited Move's preview starts from it (35e2c). */
  let resultsNow: Readonly<Record<string, { status: string }>> = {};
  /**
   * What a pointer on sketch `id` may snap to on its face's edges (26f):
   * their ends, middles and centres in the plane the sketch is drawn in
   * (the last rebuild's placement, or, for a sketch just made on a face and
   * not rebuilt since, the frame it was made in).
   */
  const edgeTargets = (id: string) => sketchEdgeTargets(designDoc(), id, lastScene, sketchPlane(designDoc(), id, placedNow));
  /** The body edges sketch `id` lands on part way along ("on edge", projection.ts `sketchEdgeCurves`) and the corners in its plane it lines up with. */
  const bodySnaps = (id: string): BodySnaps => {
    const plane = sketchPlane(designDoc(), id, placedNow);
    return { curves: sketchEdgeCurves(designDoc(), id, lastScene, plane), corners: sketchPlaneCorners(designDoc(), id, lastScene, plane) };
  };
  /** Ctrl (Cmd on a Mac) held over the view: snapping and the grid are off while it is (snap.ts `snapsNow`). */
  let modHeld = false;
  /** Where the pointer landed on `doc`'s sketch for `tool`: snap.ts `snapOnSketch` with the body's corners and edges, unless snapping is off now. */
  const snapHere = (doc: DesignDocument, tool: SketchTool, at: SketchXY, rounded: SketchXY, pixel: number | undefined, edges = edgeTargets(tool.sketch), held = modHeld) =>
    snapOnSketch(doc, tool, at, rounded, pixel, edges, bodySnaps(tool.sketch), snapsNow(snapOn, held, gridSnap).points);
  /** The bar's item whose ⋯ shows (a click or tap picked it). */
  let picked: string | null = null;
  /** The sketch being edited, whose own Suppress and Delete are off. */
  const editingId = () => (mode.kind === "edit" && editingSketch ? editingSketch.id : null);

  /** The timeline bar for `doc`, wired to the item menu. */
  function showBar(doc: DesignDocument) {
    if (!ctx.timeline) return;
    showTimelineBar(ctx.timeline, doc, {
      failed: failedNow,
      warnings: warnedRows(),
      picked,
      onPick: (id) => {
        picked = picked === id ? null : id;
        showBar(designDoc());
      },
      onMenu: (id, at) => openMenu(id, at),
      // 25a3: a double-click opens the item: Edit Sketch, or Edit feature.
      onOpen: (id) => openItem(id),
      // 24f5: the playback buttons, the marker dragged and a tap between items, each one undo step.
      editing: editingId(),
      // A refusal goes to the error line and back to the bar, which shows it beside itself (timeline hunt, finding 4).
      onAction: (a) => {
        if (a.kind === "menu") return;
        let refused: string | undefined;
        try {
          chooseBarAction({ ...menuHost, refuse: (message) => (menuHost.refuse(message), (refused = message)) }, a, editingId());
        } catch (err) {
          panel.showError(err instanceof Error ? err.message : String(err));
        }
        return refused;
      },
    });
  }

  /**
   * The bar's items and the browser's Timeline rows red for every failed
   * item (24f3), greyed for every item after the marker (24f5), and from 26e
   * greyed for every item built on a suppressed one (Q3), its title saying
   * which. Rows with a warning are `showKept`'s.
   */
  function showFailed(doc: DesignDocument) {
    showBar(doc);
    const { items } = timelineBarItems(doc, failedNow);
    const failed = new Set(items.filter((i) => i.failed).map((i) => i.id));
    const rolledBack = new Set(items.filter((i) => i.rolledBack).map((i) => i.id));
    const greyed = new Map(items.flatMap((i) => (i.greyed === null ? [] : [[i.id, i.greyed] as const])));
    for (const row of ctx.browser.querySelectorAll<HTMLElement>('[data-node="timeline"] .tree-row')) {
      const id = row.dataset.node!;
      const red = failed.has(id);
      const grey = rolledBack.has(id);
      const by = greyed.get(id);
      row.classList.toggle("timeline-menu", red || grey || by !== undefined);
      row.classList.toggle("timeline-menu-failed", red);
      row.classList.toggle("timeline-menu-rolled-back", grey);
      row.classList.toggle("timeline-menu-greyed", by !== undefined);
      if (by !== undefined) row.title = `Greyed: ${by} is suppressed`;
      else if (row.title.startsWith("Greyed: ")) row.title = row.dataset.tip ?? "";
    }
  }

  /** The timeline item of a browser row with a menu: "sketches/<id>" or an item's id. */
  /** The item a row stands for (browser.ts rowItem), or "" for none. */
  const itemOfRow = (node: string) => rowItem(node, designDoc(), failedNow) ?? "";
  /** A row's menu (24e4 for sketches, 24f3 for every timeline item, U0a for bodies: their feature's). */
  function openRowMenu(node: string, at: { x: number; y: number }) {
    openMenu(itemOfRow(node), at);
  }

  /** A double-click on item `id` (25a3): its menu's Edit Sketch or Edit feature, refused with the menu's words when that is off. */
  function openItem(id: string) {
    const doc = designDoc();
    if (!doc.timeline.features.some((f) => f.id === id)) return;
    void chooseEntry(menuHost, id, openAction(doc, id), editingId()).catch((err) => panel.showError(err instanceof Error ? err.message : String(err)));
  }

  /** Item `id`'s menu (timeline-menu.ts): Move the marker here, Suppress or Unsuppress, Delete; an entry that is off says why. */
  function openMenu(id: string, at: { x: number; y: number }) {
    const doc = designDoc();
    const item = doc.timeline.features.find((f) => f.id === id);
    if (!item) return;
    const editing = editingId();
    const entries = menuEntries(doc, id, editing).map((e) => ({ ...e, run: () => void chooseEntry(menuHost, id, e.action, editing).catch((err) => panel.showError(err instanceof Error ? err.message : String(err))) }));
    menuAt = at;
    deleting.menu(itemName(item), at, entries);
  }

  /**
   * How a menu choice reaches the project: the document recorded as one
   * undo step (out of any sketch or Extrude panel first, the panel showing
   * the part the edit leaves), the delete box asking first (24e4), and a
   * refusal shown as the part's error line.
   */
  const menuHost: MenuHost = {
    kernel,
    bodies,
    current: () => designDoc(),
    record(step, next) {
      leaveExtrude();
      leaveEdit();
      leaveMove();
      if (mode.kind !== "none") leaveSketch(false); // update() below shows the new design
      // The part the panel shows may now be another feature (the last body that still builds), or none (24f4):
      // then the boxes stay, and a size typed adds a preset of the shape shown. After an extrude of a sketch, that is a
      // new box at a fresh design's sizes: the boxes held its distance as a height and older numbers (hunt 26g).
      const part = partOf(next);
      if (part) {
        shape = part.shape;
        for (const [i, key] of SIZE_KEYS.entries()) if (part.sizes[key] !== undefined) inputs[i].value = String(part.sizes[key]);
      } else if (shape === "sketch-extrude") {
        shape = "box";
        inputs.forEach((input, i) => (input.value = DEFAULT_SIZES[SIZE_KEYS[i]]));
      }
      void update(step, undefined, next);
    },
    ask: (q, go) => deleting.ask(q, go),
    refuse: (message) => panel.showError(message),
    edit: (id) => openEdit(id),
    editSketch: (id) => openSketch(id),
    rename(id) {
      const item = designDoc().timeline.features.find((f) => f.id === id);
      if (item) renaming.show(itemName(item), menuAt, (typed) => renameEntry(menuHost, id, typed));
    },
  };

  /** Shows a document the project now holds and builds its part: the browser, sketches, selection, then the body or the reason it failed. */
  /** The design last shown and built: a sketch left after edits to it differs, and is rebuilt (25a3). */
  let shownDoc: DesignDocument | null = null;
  async function show(doc: DesignDocument, kind: PartKind) {
    shownDoc = doc;
    const view = viewport.element;
    rebuildsOn.set(view, (rebuildsOn.get(view) ?? 0) + 1);
    view.dataset.rebuilding = "true";
    try {
      await showBuilt(await settled(doc), kind);
    } finally {
      const left = rebuildsOn.get(view)! - 1;
      rebuildsOn.set(view, left);
      view.dataset.rebuilding = String(left > 0);
    }
  }
  /**
   * The design before the first edit recorded since the last settle (26g),
   * or null: an edit made outside a sketch (Edit feature, a shape or size
   * from the panel or the assistant, the timeline's verbs) can lose a face
   * sketch's face, find it again or move it, so the edit is settled as the
   * naming harness settles Design after every edit (`settleKept`): a sketch
   * whose face goes holds where it last was (Fusion's last place, not where
   * it was first drawn), one found again holds nothing, pinned points follow.
   * Sketch clicks and deletes settle themselves before they are recorded.
   */
  let unsettled: DesignDocument | null = null;
  /**
   * `doc`, the design just recorded, settled against `unsettled` and taken
   * into the edit's own undo step (the typing in a box still one step), or
   * `doc` itself: when nothing is unsettled, when it has no sketch on a face
   * (nothing else a non-sketch edit changes is settled), or when the design
   * changed again while the kernel looked (the next edit settles from the
   * same `unsettled`).
   */
  async function settled(doc: DesignDocument): Promise<DesignDocument> {
    const from = unsettled;
    if (from === null || ctx.history.restoring()) return doc;
    if (!doc.timeline.features.some(isFaceSketch)) {
      unsettled = null;
      return doc;
    }
    let next: DesignDocument;
    try {
      next = await settleKept(kernel, from, doc, bodies);
    } catch {
      return doc; // the rebuild says what failed
    }
    if (designDoc() !== doc || ctx.history.restoring()) return doc;
    unsettled = null;
    if (next !== doc) takeIn(doc, next);
    return next;
  }
  /**
   * `next`, `doc` settled or with its pinned points followed, taken in as
   * the design in `doc`'s own undo step: it follows from that step, so the
   * typing in a box stays one step.
   */
  function takeIn(doc: DesignDocument, next: DesignDocument) {
    ctx.project.workspaces.design = next;
    if (saved?.doc === doc) saved = { ...saved, doc: next };
    if (shownDoc === doc) shownDoc = next;
    ctx.history.amend(true);
  }
  async function showBuilt(doc: DesignDocument, kind: PartKind) {
    // The item the Edit feature panel is open on was deleted (the bar, Undo in another way): the panel goes with it.
    if (editBox.editing !== null && !doc.timeline.features.some((f) => f.id === editBox.editing)) leaveEdit();
    // So does the Move panel's Move (35e2b).
    if (moveBox.editing !== null && !doc.timeline.features.some((f) => f.id === moveBox.editing)) leaveMove();
    drawBrowser(doc);
    showOrigin(doc);
    showStart();
    showFailed(doc);
    showKept();
    drawSketches();
    showSelection();
    markStale();
    try {
      const { current, value } = await build(doc);
      if (!current) return;
      if (!shown) return void (missed = true);
      missed = false;
      const { scene, failure } = value;
      // Points pinned to a face's edges (26f) where this rebuild found them, taken into the edit's own undo step (the
      // typing in a box still one step): drawn there, and held there should their edge go. An edit's settling has
      // followed them already, so this takes in a file opened with its points elsewhere (or an edit whose settling
      // failed). Not while an undo or redo is putting a snapshot back (it was taken in when that step was made), nor
      // once the design has changed again.
      if (value.followed !== doc && designDoc() === doc && !ctx.history.restoring()) takeIn(doc, value.followed);
      // The rows were drawn before the rebuild said what failed: a failed item has no Body row.
      if (!sameIds(rowsFailed, failedNow)) drawBrowser(doc);
      warningsNow = value.warnings;
      showKept();
      showFailed(doc);
      // Built from the current inputs: the feature and the numbers are fresh. A failed part is not (its numbers stay, marked).
      if (failure === undefined) {
        for (const f of doc.timeline.features) ctx.graph.markFresh(f.id);
        ctx.graph.markFresh(PART_VIEW);
      }
      markStale(failure !== undefined);
      viewport.showBody(scene.mesh);
      // A sketch on a face is drawn where this rebuild placed it (26c).
      drawSketches();
      const empty = scene.bodies.length === 0;
      // A different shape is a new part: frame it (not when Undo or Redo put
      // it back: the camera stays unless the body no longer fits). With no
      // body (24f4) the camera stays where it is, for the body's return; so
      // it does while the part fails, for its return.
      if (failure === undefined) {
        const newPart = kind !== framedKind && !keepCamera;
        keepCamera = false;
        if (!empty && (newPart || needsRefit(framed, viewport.bodyFraming()))) {
          framed = viewport.fit();
          viewport.element.dataset.framedRadius = String(framed?.radius); // read by the e2e test
          viewport.element.dataset.fits = String(++fits);
        }
        if (!empty) framedKind = kind;
      }
      panel.showError(failure ?? "");
      // Faces and edges the edit took off the body leave the selection, with a
      // note (17e); so do ones whose name now names two (25a4: never a guess);
      // the rest follow their names, however the kernel numbers them now.
      const outlines = [...doc.profiles.map((p) => p.id), ...doc.sketches.flatMap((s) => (s.curves.length > 0 ? [s.id] : []))];
      const { kept, dropped, shared } = survivors(ctx.selection.items, scene, outlines);
      lastScene = scene;
      // A snap's "from" was read off the bodies as they were: picked again on these (35e2d).
      if (snapping) (snapping.from = null), showMoveHint();
      // A new Move's preview drawn again on the bodies as now built (a body it picked that no longer shows is let go); an edited one's too (35e2c).
      if (picksBodies()) pickMoveBodies();
      else if (moveBox.shown) previewMove();
      factsButton.disabled = inspecting.none() !== null;
      if (mode.kind === "pick") viewport.showPlanes(originPlanes(), sketchableFaces(scene)); // the faces offered are this scene's
      // Extrude opened before this build landed (a slow kernel, a file just opened, an Undo) offered the faces of the scene
      // before it, or none: they are offered again from this one, so a face is never missing or where the body was.
      if (extruding && designDoc() === doc) void offerProfiles(doc, [...extruding.usable]);
      const part = partFeature(doc);
      partShown = scene.bodies.find((b) => b.feature === part?.id) ?? (failure === undefined ? null : partShown);
      note = droppedNote(dropped, shared, selectedSketches);
      if (dropped.length > 0) {
        settling = true;
        ctx.selection.set(kept);
        settling = false;
      }
      panel.showSelectionNote(note);
      showSelection();
      if (failure === undefined) viewport.element.dataset.shape = empty ? "none" : kind; // read by the e2e test: what is on screen
    } catch (e) {
      if (!shown) return void (missed = true);
      missed = false;
      warningsNow = [];
      if (designDoc() === doc && !sameIds(rowsFailed, failedNow)) drawBrowser(doc);
      showKept();
      if (designDoc() === doc) showFailed(doc);
      panel.showError(e instanceof Error ? e.message : String(e));
      markStale(true);
    }
  }

  // The sketch tool (step 21c, docs/document-model.md section 3).
  /** While editing: the tool, the grid, where the pointer landed (snapped) and why, with the pixel size it was snapped at. */
  type Mode = { kind: "none" } | { kind: "pick" } | { kind: "edit"; tool: SketchTool; grid: number; pointer: SketchXY | null; snap: Snap | null; pixel?: number };
  let mode: Mode = { kind: "none" };
  const sketchPanelBox = sketchPanel(ctx.properties, {
    pickPlane: (id) => pickPlane(id),
    cancel: () => leaveSketch(),
    grid: (typed) => void setGrid(typed),
    gridSnap: (on) => setGridSnap(on),
    finish: () => finishSketch(),
    extrude: () => startExtrude(),
    lookAt: () => lookAtSketch(),
  });
  /**
   * Why the last click or press did nothing, also shown by the pointer
   * (`hint`) while sketching: on a phone the panel is in the Properties
   * sheet, closed while drawing, so a refused click said nothing at all
   * (beginner play-test 2026-10-28). Empty when there is nothing to say.
   */
  let sketchNote = "";
  const sketchBox: typeof sketchPanelBox = {
    ...sketchPanelBox,
    showError(message) {
      sketchPanelBox.showError(message);
      if (message === sketchNote) return;
      sketchNote = message;
      if (mode.kind === "edit") drawSketches();
    },
    // A panel shown afresh has no note, and neither has the pointer.
    showPick: () => ((sketchNote = ""), sketchPanelBox.showPick()),
    showEditing: (...args) => ((sketchNote = ""), sketchPanelBox.showEditing(...args)),
    hide: () => ((sketchNote = ""), sketchPanelBox.hide()),
  };
  /** The tool whose unfinished shape Extrude or Finish sketch last warned of: pressed again with it unchanged, it goes on (`unfinishedWords`). */
  let warnedUnfinished: SketchTool | null = null;
  /** True when `verb` must wait: the tool has a shape half drawn that it would drop, and this is the first press since. */
  function holdUnfinished(verb: "Extrude" | "Finish sketch"): boolean {
    if (mode.kind !== "edit") return false;
    // A click still waiting for the kernel may finish the shape, or start one: asked again once it has landed.
    if (waiting > 0) {
      const again = () => void (mode.kind === "edit" && (verb === "Extrude" ? startExtrude() : finishSketch()));
      clicks = clicks.then(again, again);
      return true;
    }
    if (warnedUnfinished === mode.tool) return false;
    const words = unfinishedWords(mode.tool, verb);
    if (words === null) return false;
    warnedUnfinished = mode.tool;
    sketchBox.showError(words);
    return true;
  }
  /** The sketch's own toolbar (SF3b), standing in for the modelling buttons while a sketch is edited; Extrude stays. */
  const sketchBar = sketchToolbar(ctx.toolbar, { tool: (kind) => chooseTool(kind), finish: () => finishSketch(), snap: (on) => setSnapOn(on) });
  /** Typed sizes (SF4): what the boxes by the pointer lock, and where the pointer is over the view (px), where they float. */
  let locks: Locks = {};
  let screen = { x: 0, y: 0 };
  /** Where on the edited sketch's plane the pointer was last (the raw point, before snapping): `screen` again after the view changes size. */
  let pointerAt: SketchXY | null = null;
  const typed = typedBoxes(viewport.element, {
    locks: (next) => ((locks = next), drawSketches()),
    enter: () => placeTyped(),
    escape: () => ((locks = {}), drawSketches()),
  });
  /** What the next click places, by the pointer ("Specify next point"). */
  const hint = pointerHint(viewport.element);
  /** Empties the boxes: a point placed, the tool changed or ended, the sketch left. */
  function unlock(keepFocus = false) {
    locks = {};
    typed.clear(keepFocus);
  }
  /** Shows the modelling buttons (true) or the sketch's toolbar in their place (false). */
  function modelling(on: boolean) {
    for (const el of ctx.toolbar.querySelectorAll<HTMLElement>("[data-modelling]")) el.hidden = !on;
    for (const el of ctx.toolbar.querySelectorAll<HTMLElement>("[data-sketching]")) el.hidden = on;
  }
  const designDoc = () => ctx.project.workspaces.design as DesignDocument;
  /** Counts tool changes (a tool chosen, Escape, the sketch entered again): a click the kernel was still snapping across one is dropped. */
  let toolChanges = 0;

  /** Draws every sketch, the edited one with its grid, points and preview. */
  function drawSketches() {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc) return;
    const editing = mode.kind === "edit" ? mode : null;
    // With a size typed the preview goes where the locks put it, and the snap marks (which the locks overrule) are left out.
    const locked = Object.keys(locks).length > 0;
    const aim = editing && aimOf(doc, editing.tool, editing.pointer, locks);
    // A typed arc angle goes the pointer's way round however little it went (typed-entry.ts withLocks): the preview from the tool the click will use.
    viewport.showSketches(withSnap(sketchDrawings(doc, editing && { ...editing, tool: withLocks(editing.tool, locks, editing.pointer), pointer: aim, gridSnap }, placedNow, lostSketches()), locked ? null : (editing?.snap ?? null), editing?.pixel));
    const anchor = editing && anchorOf(doc, editing.tool);
    if (!editing) return (typed.hide(), hint.hide());
    const width = viewport.element.clientWidth;
    typed.show(typedFields(editing.tool), anchor && aim ? liveValues(anchor, aim, editing.tool) : {}, Math.min(screen.x, Math.max(0, width - 200)), screen.y, viewport.editedScreenPoints());
    // A note shows where the pointer last was even once it has left the view (a finger lifted, the mouse gone to Extrude).
    if (editing.pointer || sketchNote) hint.show(sketchNote || hintOf(editing.tool), Math.min(screen.x, Math.max(0, width - 200)), screen.y, sketchNote !== "");
    else hint.hide();
  }

  /**
   * Applies a sketch edit to the project: one undo step named `label`
   * (SKETCH_STEPS), the timeline in the graph (a sketch has nothing to
   * build: its outline is asked of the kernel when read), the browser
   * and the drawing. What is built from the sketch is marked out of date
   * and rebuilt when the sketch is left (Finish Sketch, 25a3), as the
   * reference app does: never part way through drawing an outline.
   */
  function applySketchEdit(next: DesignDocument, label: string, sketchId: string) {
    const before = designDoc();
    syncGraph(ctx.graph, next, before, ctx.changeNotes);
    ctx.graph.markFresh(sketchId);
    ctx.project.workspaces.design = next;
    saved = { doc: next, shape, sizes: inputs.map((i) => i.value) };
    ctx.projectChanged(label);
    drawBrowser(next);
    showStart();
    showFailed(next);
    showKept(); // the rows are new: mark them again until the rebuild says otherwise
    markStale();
  }

  /** Create sketch: the origin planes appear at the origin, the flat faces of the bodies on screen light under the pointer (26d), and the panel asks for one. */
  function startSketch() {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind === "edit") leaveSketch();
    mode = { kind: "pick" };
    showStart();
    viewport.showPlanes(originPlanes(), sketchableFaces(lastScene));
    sketchBox.showPick();
  }

  /** A plane picked: the new sketch (one undo step), looked at straight down, ready to draw on. */
  function pickPlane(plane: SketchPlane) {
    if (mode.kind !== "pick" || !ORIGIN_PLANES.some((p) => p.id === plane)) return;
    startNewSketch(addSketch(designDoc(), plane));
  }

  /**
   * A face picked (26d, face-pick.ts): a flat one gets the new sketch on it,
   * drawn with the frame its face gives it (rule 8) and looked at from
   * outside the body; a curved one, or one with no name of its own, is
   * refused in the panel's words and the planes stay offered.
   */
  function pickFace(spot: SketchSpot & { kind: "face" | "refused" }) {
    if (mode.kind !== "pick") return;
    if (spot.kind === "refused") return sketchBox.showError(spot.message);
    let made: ReturnType<typeof addFaceSketch>;
    try {
      made = addFaceSketch(designDoc(), spot.face, spot.drawn);
    } catch (e) {
      return sketchBox.showError(e instanceof Error ? e.message : String(e));
    }
    startNewSketch(made);
  }

  /**
   * create_sketch (AI7a): what Create sketch then a click on the plane or
   * face does, out of any tool open first. A face is found by its name on
   * the bodies on screen, as the AI was told of them (ai-view.ts
   * `aiFaces`); a name no flat face there has is refused, so the
   * assistant puts the project back.
   */
  function aiSketch(on: string) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind !== "none") leaveSketch();
    startNewSketch(sketchOn(designDoc(), on));
  }

  /** The sketch create_sketch makes on a plane or a named face of the bodies on screen, added to `doc` (a name no flat face there has is refused). */
  function sketchOn(doc: DesignDocument, on: string): { doc: DesignDocument; id: string } {
    if ((SKETCH_PLANES as readonly string[]).includes(on)) return addSketch(doc, on as SketchPlane);
    const spot = lastScene === null ? null : sketchableFaces(lastScene).map((face) => sketchSpot({ face, shift: false }, lastScene)).find((x) => x?.kind === "face" && x.face.plane === on);
    if (spot?.kind !== "face") throw new Error(`There is no flat face ${on} on the bodies shown to start a sketch on.`);
    return addFaceSketch(doc, spot.face, spot.drawn);
  }

  /**
   * extrude_sketch (AI7c): what the Extrude tool's OK does with a typed
   * distance, for the sketch named, else the one open, else the newest.
   * Out of the sketch first without a rebuild (the extrude's own shows the
   * new design). `check` has already had the kernel build it, so only a
   * design that changed meanwhile can fail here, and the assistant puts
   * the project back.
   */
  function aiExtrude(command: Command) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    const doc = designDoc();
    const id = extrudeTarget(doc, command, mode.kind === "edit" ? mode.tool.sketch : null);
    const d = commandDistance(command);
    const made = extrudeSketch(doc, id, Math.abs(d), d < 0);
    if (mode.kind !== "none") leaveSketch(false);
    shape = "sketch-extrude";
    inputs[SIZE_KEYS.indexOf("height")].value = String(Math.abs(d));
    return update(extrudeStep(doc, id), undefined, usedSketchHidden(made.doc, id));
  }

  /**
   * rename_item (AI7d): what Rename in an item's menu does with the name
   * typed, for the item named, else the one just made. An open sketch stays
   * open (a draw may follow in the same answer); anything else is recorded as one
   * step, the part the panel shows left as it is.
   */
  function aiRename(command: Command) {
    const doc = designDoc();
    const id = renameTarget(doc, command);
    const renamed = renameItem(doc, id, String(command.name));
    if ("refused" in renamed) throw new Error(renamed.message);
    if (renamed.doc === doc) return;
    const step = TIMELINE_STEPS.rename(itemName(doc.timeline.features.find((f) => f.id === id)!));
    if (mode.kind === "edit") return applySketchEdit(renamed.doc, step, mode.tool.sketch);
    leaveExtrude();
    leaveEdit();
    leaveMove();
    return update(step, undefined, renamed.doc);
  }

  /**
   * Whether the kernel can build what `commands` would do, played out on a
   * copy of the design (null: yes; else the reason, in words): the same
   * steps `run` takes, sketches started and drawn in, and each extrude
   * built by the kernel (an open or empty outline, or a size it refuses).
   * Asked before the preview, so the user is never shown a change that
   * cannot be made. Changes nothing.
   */
  async function aiCheck(commands: readonly Command[]): Promise<string | null> {
    let doc = designDoc();
    let open: string | null = mode.kind === "edit" ? mode.tool.sketch : null;
    try {
      for (const c of commands) {
        if (c.op === "create_sketch") {
          const made = sketchOn(doc, String(c.on));
          doc = made.doc;
          open = made.id;
        } else if (DRAW_OPS.includes(c.op)) {
          if (open === null) throw new Error("No sketch is open to draw in: ask for a new sketch first, or open one with Edit Sketch.");
          const refused = drawRefused(doc, open);
          if (refused) throw new Error(refused);
          doc = drawingFor(doc, open, c);
        } else if (c.op === RENAME_OP) {
          const renamed = renameItem(doc, renameTarget(doc, c), String(c.name));
          if ("refused" in renamed) throw new Error(renamed.message);
          doc = renamed.doc;
        } else if (c.op === EXTRUDE_OP) {
          const id = extrudeTarget(doc, c, open);
          const d = commandDistance(c);
          const made = extrudeSketch(doc, id, Math.abs(d), d < 0);
          const built = await buildSpec(kernel, await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!));
          if (built.errors.length > 0) throw new Error(`the kernel's checks failed: ${built.errors.join("; ")}`);
          doc = made.doc;
          open = null;
        }
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return null;
  }

  /**
   * A draw command (AI7b): drawn in the sketch open, as its tool would
   * draw it with typed sizes, the tool's step in the undo list ("Draw
   * circle", inside the AI's one step). Refused, so the assistant puts the
   * project back, with no sketch open or one an extrude is built from (its
   * edits are settled on the kernel first, which an AI step can't wait
   * for: `drawRefused`). Anything part drawn with the tool is dropped first,
   * as Escape would.
   */
  function aiDraw(command: Command) {
    if (mode.kind !== "edit") throw new Error("No sketch is open to draw in: ask for a new sketch first, or open one with Edit Sketch.");
    const id = mode.tool.sketch;
    const refused = drawRefused(designDoc(), id);
    if (refused) throw new Error(refused);
    const next = drawingFor(designDoc(), id, command);
    if (toolBusy(mode.tool)) {
      mode.tool = startTool(mode.tool.kind, id);
      mode.snap = null;
      toolChanges++;
      unlock();
    }
    applySketchEdit(next, DRAW_STEPS[command.op], id);
    drawSketches();
    void showOutline();
  }

  /** A new sketch made on a plane or a face: recorded (one undo step), opened with the line tool, looked at square on. */
  function startNewSketch(made: { doc: DesignDocument; id: string }) {
    viewport.showPlanes([]);
    applySketchEdit(made.doc, SKETCH_STEPS.create, made.id);
    editingSketch = { id: made.id, grid: DEFAULT_GRID, typed: String(DEFAULT_GRID), tool: "line" };
    enterSketch();
    lookAtSketch();
  }

  /**
   * Edit Sketch (25a3, from an item's menu or a double-click): sketch `id`
   * open again with the line tool, out of any other sketch (rebuilt when
   * changed), Extrude or Edit feature panel first, looked at straight down.
   * Nothing is recorded until something is drawn; the kept-shape warning
   * of what is built from it waits for Finish Sketch.
   */
  function openSketch(id: string) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind !== "none") leaveSketch();
    editingSketch = { id, grid: DEFAULT_GRID, typed: String(DEFAULT_GRID), tool: "line" };
    enterSketch();
    if (mode.kind !== "edit") return;
    showKept();
    lookAtSketch();
  }

  /** Look At (SF2): the camera square onto the edited sketch's plane, framing the body and what is drawn; from outside the body on a back or bottom face (26d). */
  function lookAtSketch() {
    if (mode.kind !== "edit" || !editingSketch) return;
    const doc = designDoc();
    viewport.lookAt(sketchPlane(doc, editingSketch.id, placedNow), sketchSide(doc, editingSketch.id));
  }

  /** Edits the sketch named in editingSketch with its tool, nothing clicked yet. */
  function enterSketch() {
    const doc = designDoc();
    if (!editingSketch || !doc.sketches.some((s) => s.id === editingSketch!.id)) return void (editingSketch = null);
    mode = { kind: "edit", tool: startTool(editingSketch.tool, editingSketch.id), grid: editingSketch.grid, pointer: null, snap: null };
    pointerAt = null;
    toolChanges++;
    sketchBox.showEditing(sketchItem(doc, editingSketch.id).provenance.self.label, editingSketch.typed, gridSnap, editingSketch.tool);
    modelling(false);
    sketchBar.show(editingSketch.tool);
    sketchBar.showSnap(snapOn);
    drawSketches();
    showBar(doc); // the playback buttons that would roll the sketch back are off (24f5)
    void showOutline();
  }

  /** Line, Rectangle, Circle or an arc (3-point, centre or tangent; the buttons and Create menu, or L, R, C, A and T): what was part way through is dropped, as Escape would, except that a line chain and a tangent arc carry on from each other's last point (`switchTool`). */
  function chooseTool(kind: ToolKind) {
    if (mode.kind !== "edit" || !editingSketch) return;
    editingSketch.tool = kind;
    mode.tool = switchTool(designDoc(), mode.tool, kind);
    mode.snap = null;
    toolChanges++;
    unlock();
    sketchBox.showTool(kind);
    sketchBar.showTool(kind);
    sketchBox.showError("");
    drawSketches();
  }

  /**
   * Cancel, Finish sketch, Extrude, another sketch or item opened: back to
   * modelling; the sketch stays as drawn. When the design changed since it
   * was last built (something was drawn), everything is rebuilt from it
   * (25a3): what is built from the sketch, and everything after that; the
   * rebuild keeps every body whose spec is unchanged. `rebuild` false: the
   * caller shows a new design straight after.
   */
  function leaveSketch(rebuild = true) {
    const drew = mode.kind === "edit" && rebuild && designDoc() !== shownDoc;
    mode = { kind: "none" };
    unlock();
    editingSketch = null;
    showStart();
    viewport.showPlanes([]);
    sketchBox.hide();
    sketchBar.hide();
    modelling(true);
    drawSketches();
    showKept();
    showBar(designDoc());
    if (drew) void show(designDoc(), shape);
  }

  /** Finish Sketch (the toolbar's or the panel's): back to modelling, the camera at the home view (as the owner's CAD suite does, not the view from before the sketch). */
  function finishSketch() {
    if (mode.kind !== "edit") return leaveSketch();
    // A click still waiting for the kernel is drawn first, then the sketch closes (`holdUnfinished` asks again once it has
    // landed): closed at once, the click's turn came for a sketch no longer open and it was dropped (a slow phone tapping fast
    // lost its last circle; found in 27b).
    if (holdUnfinished("Finish sketch")) return;
    leaveSketch();
    viewport.setView("home");
  }

  /** A grid size typed: the kernel judges it (snapping 0, 0 to it); a refused one keeps the grid and says why. */
  async function setGrid(typed: string) {
    if (mode.kind !== "edit" || !editingSketch) return;
    const sketch = editingSketch;
    const grid = Number(typed);
    try {
      if (typed.trim() === "" || !Number.isFinite(grid)) throw new Error("Type the grid size in mm.");
      await kernel.call("snap_to_grid", 0, 0, grid);
    } catch (e) {
      return sketchBox.showError(e instanceof Error ? e.message : String(e));
    }
    // The kernel answered after an Undo, Escape or Finish put this sketch away: the size is for a sketch no longer open.
    if (mode.kind !== "edit" || editingSketch !== sketch) return;
    sketchBox.showError("");
    mode.grid = sketch.grid = grid;
    sketch.typed = typed;
    drawSketches();
  }

  /** The Snap button pressed: snapping to points, edges and line-ups on or off, from the snap shown now. */
  function setSnapOn(on: boolean) {
    snapOn = on;
    sketchBar.showSnap(on);
    if (mode.kind === "edit") mode.snap = null;
    if (mode.kind === "edit" && lastHover) onSketchPointer(lastHover);
    drawSketches();
  }

  /** Grid snap ticked or unticked: from the next pointer move, points land on the grid or where you click. */
  function setGridSnap(on: boolean) {
    gridSnap = on;
    if (mode.kind === "edit") mode.snap = null;
    drawSketches();
  }

  /** Says what the edited sketch holds and whether it makes one closed outline, or the kernel's reason it doesn't. */
  // Every answer goes through one latestOnly, those needing no kernel too, so an older ask answered later never shows over a newer one.
  const outlineOf = latestOnly(async (sketch: Sketch) => (sketch.curves.length === 0 ? null : (projectedOpen(sketch) ?? (await askOutline(kernel, sketchCurves(sketch))))));
  async function showOutline() {
    if (mode.kind !== "edit") return;
    const id = mode.tool.sketch;
    const sketch = designDoc().sketches.find((s) => s.id === id);
    if (!sketch) return;
    const n = curveCount(sketch);
    try {
      const { current, value } = await outlineOf(sketch);
      if (current) sketchBox.showStatus(value === null ? `${n}.` : typeof value === "string" ? `${n}, not closed: ${value}.` : "closed" in value ? `${n}, a closed outline.` : `${n}, not closed: ${value.open}.`);
    } catch (e) {
      sketchBox.showStatus(`${n}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Extrude (step 21d; UX1b, Fusion's feel): click a closed sketch in the view (or its row in the
  // browser), see the extrude as OK would make it, drag its arrow or type the distance; OK when the
  // kernel says the outline closes. Nothing is recorded until OK, as one undo step.
  /**
   * While the Extrude panel is open: the sketches it can use (before the
   * marker, not suppressed), the one chosen, the closed outlines offered in
   * the view, the distance (signed mm; null while the box holds none), the
   * chosen sketch's extrude going 1 mm (`previewSpec` turns it into any
   * distance; worked out once per sketch and document, so a drag never asks
   * for the outline again), the preview built and its arrow.
   */
  let extruding: {
    usable: ReadonlySet<string>;
    /** The flat faces of the bodies on screen it can use (UX1c), by face name, each with its sketch of the face's edges (face-extrude.ts). */
    faces: ReadonlyMap<string, FaceProfile>;
    /** The flat faces not offered, by name, with why (a face with holes until step 48). */
    refusedFaces: ReadonlyMap<string, string>;
    /** A face selected before Extrude (Fusion: select, then the command): chosen once it is offered. */
    wanted: string | null;
    /** The sketch or face chosen (a face by its name). */
    sketch: string | null;
    /** The kernel said the chosen sketch's outline closes (checkExtrude): only then is a preview built. */
    closed: boolean;
    offered: OfferedProfile[];
    distance: number | null;
    base: { doc: DesignDocument; sketch: string; spec: BodySpec } | null;
    preview: BodyView | null;
    arrow: ExtrudeArrow | null;
  } | null = null;
  const extrudeBox = extrudePanel(ctx.properties, {
    distance: (typed) => extrudeDistance(signedDistance(typed)),
    flip: (typed) => extrudeDistance(signedDistance(typed)),
    clear: () => chooseProfile(null),
    ok: (typed) => void finishExtrude(typed),
    cancel: () => leaveExtrude(),
  });
  const sketchLabel = (id: string) => sketchItem(designDoc(), id).provenance.self.label;
  /** What the chosen `id` extrudes: a sketch of the design, or a face's sketch in the design it was offered in (UX1c). */
  const sourceOf = (id: string): { doc: DesignDocument; sketch: string; label: string; face: FaceProfile | null } => {
    const face = extruding?.faces.get(id) ?? null;
    return face ? { doc: face.doc, sketch: face.sketch, label: face.label, face } : { doc: designDoc(), sketch: id, label: sketchLabel(id), face: null };
  };

  /**
   * Extrude: like Finish sketch first when a sketch is being drawn (that
   * sketch is the one chosen); else a sketch selected in the browser (picked
   * before the command, as in Fusion); else the newest. Every usable
   * sketch's closed outline is offered in the view to click.
   */
  function startExtrude() {
    if (holdUnfinished("Extrude")) return;
    leaveEdit();
    leaveMove();
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    const editing = mode.kind === "edit" ? mode.tool.sketch : null;
    if (mode.kind !== "none") leaveSketch();
    // Only sketches an extrude put in at the marker can use: before it, and not suppressed (hunt 2026-10-21).
    const sketches = doc ? doc.timeline.features.filter(isSketchItem) : [];
    const items = doc ? sketches.filter((f) => !f.suppressed && doc.timeline.features.indexOf(f) < insertAt(doc)) : [];
    const selected = ctx.selection.items.length === 1 ? readProfileReference(ctx.selection.items[0]) : null;
    // A flat face selected first is chosen once it is offered (UX1c); meanwhile nothing is.
    const wanted = editing === null && ctx.selection.items.length === 1 && ctx.selection.items[0].kind === "face" ? String(ctx.selection.items[0].id) : null;
    const chosen = items.find((f) => f.id === editing)?.id ?? items.find((f) => f.id === selected)?.id ?? (wanted ? undefined : items.at(-1)?.id) ?? null;
    extruding = { usable: new Set(items.map((f) => f.id)), faces: new Map(), refusedFaces: new Map(), wanted, sketch: chosen, closed: false, offered: [], distance: DEFAULT_DISTANCE, base: null, preview: null, arrow: null };
    extrudeBox.show(chosen ? sketchLabel(chosen) : null, String(DEFAULT_DISTANCE));
    // No usable sketch: say why (a body's flat faces are still offered to click, UX1c); with no sketch at all and a body, just how to pick.
    if (items.length > 0 ? !chosen : sketches.length === 0 && (lastScene?.bodies.length ?? 0) > 0) extrudeBox.showStatus(PICK_PROFILE_STATUS, false);
    else if (items.length === 0) extrudeBox.showStatus(sketches.length > 0 ? NO_USABLE_SKETCH : NO_SKETCH, false);
    showExtrudeView();
    if (doc) void offerProfiles(doc, items.map((f) => f.id));
    if (chosen) void checkExtrude(chosen);
  }

  function leaveExtrude() {
    extruding = null;
    extrudeBox.hide();
    viewport.showExtrude(null);
  }

  /** What the view shows while Extrude is open: the outlines offered, the chosen one, the preview and its arrow at the distance now. */
  function showExtrudeView() {
    const e = extruding;
    if (!e) return viewport.showExtrude(null);
    const arrow = e.arrow && e.distance !== null ? { ...e.arrow, distance: e.distance } : null;
    viewport.showExtrude({ profiles: e.offered, chosen: e.sketch, preview: e.preview?.mesh ?? null, arrow });
    // Read by the tests: the sketches it can use, the one chosen, and the volume of the body OK would make, as the kernel worked it out.
    const box = ctx.properties.querySelector<HTMLElement>("#extrude-panel");
    if (box) Object.assign(box.dataset, { usable: [...e.usable].join(" "), faces: [...e.faces.keys()].join(" "), chosen: e.sketch ?? "", previewVolume: e.preview ? String(e.preview.volume) : "" });
  }

  /**
   * Every usable sketch that makes a closed outline, then every flat face of
   * the bodies on screen whose edges do (UX1c), offered to click (asked of
   * the kernel at once, none waiting on another). Sketches come first, so a
   * sketch drawn on a face wins a click on both.
   */
  async function offerProfiles(doc: DesignDocument, ids: readonly string[]) {
    const scene = lastScene;
    const faces = new Map<string, FaceProfile>();
    const refusedFaces = new Map<string, string>();
    for (const f of sketchableFaces(scene)) {
      const made = faceProfile(doc, scene, f);
      if (made !== null && !("refused" in made)) faces.set(made.face, made);
    }
    // A face whose edges make no one closed outline (one with holes, until step 48) is not offered; a click on it says why.
    const faceOffers = Promise.all([...faces.values()].map(async (f): Promise<OfferedProfile | null> => {
      try {
        const out = await askOutline(kernel, sketchCurves(f.doc.sketches.find((s) => s.id === f.sketch)!));
        if ("closed" in out) return { id: f.face, plane: f.plane, outline: out.closed, face: true };
        refusedFaces.set(f.face, faceOpen(out.open));
      } catch (e) {
        refusedFaces.set(f.face, `This face can't be extruded: ${e instanceof Error ? e.message : String(e)}`);
      }
      return null;
    }));
    const offered = await Promise.all(ids.map(async (id): Promise<OfferedProfile | null> => {
      const sketch = doc.sketches.find((s) => s.id === id);
      if (!sketch || sketch.curves.length === 0 || projectedOpen(sketch) !== null) return null;
      try {
        const out = await askOutline(kernel, sketchCurves(sketch));
        return "closed" in out ? { id, plane: sketchPlane(doc, id, placedNow), outline: out.closed } : null;
      } catch {
        return null; // a sketch the kernel refuses is not offered; its status says why when it is chosen
      }
    }));
    const facesOffered = (await faceOffers).filter((p) => p !== null);
    if (!extruding || designDoc() !== doc) return;
    extruding.offered = [...offered.filter((p) => p !== null), ...facesOffered];
    const before = extruding.faces;
    extruding.faces = new Map(facesOffered.map((p) => [p.id, faces.get(p.id)!]));
    extruding.refusedFaces = refusedFaces;
    // Offered again from a newer scene: a face chosen from the old one is checked and previewed again from its new
    // outline, or let go if this scene has no such flat face.
    const was = extruding.sketch;
    if (was !== null && before.has(was)) {
      if (!extruding.faces.has(was)) chooseProfile(null);
      else if (before.get(was) !== extruding.faces.get(was)) void checkExtrude(was);
    }
    const wanted = extruding.wanted;
    extruding.wanted = null;
    if (wanted !== null && extruding.sketch === null && extruding.faces.has(wanted)) chooseProfile(wanted);
    else if (extruding.sketch === null && extruding.offered.length === 0 && ids.length === 0) extrudeBox.showStatus(doc.sketches.length > 0 ? NO_USABLE_SKETCH : NO_SKETCH, false);
    showExtrudeView();
  }

  /** Another sketch chosen (a click in the view, its row in the browser, or ✕ for none): its preview and arrow start again. */
  function chooseProfile(id: string | null) {
    const e = extruding;
    if (!e || e.sketch === id || (id !== null && !e.usable.has(id) && !e.faces.has(id))) return;
    Object.assign(e, { sketch: id, closed: false, base: null, preview: null, arrow: null });
    extrudeBox.showProfile(id ? sourceOf(id).label : null);
    extrudeBox.showError("");
    if (id) void checkExtrude(id);
    else extrudeBox.showStatus(PICK_PROFILE_STATUS, false);
    showExtrudeView();
  }

  /** The distance typed, flipped or dragged to (signed mm, null for none): the arrow moves at once, the preview follows. */
  function extrudeDistance(d: number | null) {
    const e = extruding;
    if (!e) return;
    e.distance = d;
    extrudeBox.showError("");
    if (d === null) e.preview = null;
    showExtrudeView();
    if (d !== null) refreshPreview();
  }

  // The pointer while Extrude is shown (UX1b): a click on an offered outline chooses it (one on
  // none keeps the choice, as Fusion does); the arrow dragged sets the distance in whole mm.
  const onExtrudePointer: SharedViewport["onExtrudePointer"] = (pointer) => {
    if (!extruding) return;
    if (pointer.kind === "pick") {
      if (pointer.profile !== null) return void chooseProfile(pointer.profile);
      // On no outline but on a face that can't be extruded (a curved one, one with holes): say why, keeping the choice.
      const made = pointer.face != null ? faceProfile(designDoc(), lastScene, pointer.face) : null;
      const why = made === null ? undefined : "refused" in made ? made.refused : extruding.refusedFaces.get(made.face);
      if (why) extrudeBox.showError(why);
      return;
    }
    extrudeBox.dragging(!pointer.done); // the distance box glows while the arrow is held
    const d = snapDistance(pointer.distance);
    if (d === extruding.distance) return;
    extrudeBox.showDistance(String(d));
    extrudeDistance(d);
  };

  /**
   * Builds the preview for the distance now, at most one at a time: a
   * change while one builds asks for one more after it, so a fast drag
   * never queues a build per pointer move. The built body is freed at once;
   * only its view is kept. A preview the kernel refuses (a distance too
   * long) shows why, and OK says it again.
   */
  let previewing = false;
  let previewAgain = false;
  function refreshPreview() {
    if (previewing) return void (previewAgain = true);
    previewing = true;
    void buildPreview().finally(() => {
      previewing = false;
      if (previewAgain) {
        previewAgain = false;
        refreshPreview();
      }
    });
  }
  async function buildPreview() {
    const e = extruding;
    const id = e?.sketch;
    const d = e?.distance;
    if (!e || !id || !e.closed || d === null || d === undefined) return;
    // A face's sketch lives in the design it was offered in (UX1c), a sketch in the design now.
    const { doc, sketch } = sourceOf(id);
    try {
      if (e.base?.doc !== doc || e.base.sketch !== id) {
        const made = extrudeSketch(doc, sketch, 1);
        const spec = await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!);
        if (extruding !== e || e.sketch !== id) return;
        e.base = { doc, sketch: id, spec };
      }
      // At 0 mm (where Extrude starts) nothing is drawn, but the arrow still stands on the profile: it is found from a 1 mm build.
      const handle = await kernel.call("body_build", previewSpec(e.base.spec, d === 0 ? 1 : d));
      const view = await kernel.call("body_view", handle).finally(() => void bodies.release(handle));
      // Out of date: another sketch chosen or the panel closed. A newer distance only means another build follows.
      if (extruding !== e || e.sketch !== id) return;
      e.preview = e.distance === null || d === 0 ? null : view;
      e.arrow = arrowOf(view, d === 0 ? 1 : d) ?? e.arrow;
    } catch (err) {
      if (extruding !== e || e.sketch !== id || e.distance !== d) return;
      e.preview = null;
      extrudeBox.showError(err instanceof Error ? err.message : String(err));
    }
    showExtrudeView();
  }

  /** Says whether the chosen sketch makes a closed outline (OK on, and its preview built) or the kernel's reason it doesn't (OK off). */
  const extrudeOutline = latestOnly((curves: ReturnType<typeof sketchCurves>) => askOutline(kernel, curves));
  async function checkExtrude(id: string) {
    const source = sourceOf(id);
    const sketch = source.doc.sketches.find((s) => s.id === source.sketch);
    if (!sketch) return;
    const name = source.label;
    extrudeBox.showStatus(sketch.curves.length === 0 ? `${name} has nothing drawn yet.` : `Checking ${name}…`, false);
    if (sketch.curves.length === 0) return;
    try {
      const { current, value } = await onceMoreAfterRestart(() => extrudeOutline(sketchCurves(sketch)));
      if (!current || extruding?.sketch !== id) return;
      if ("closed" in value) {
        // A face's extrude is a new body until Combine (35f): said plainly (UX1c).
        extrudeBox.showStatus(source.face ? `${name} makes a closed outline. ${FACE_NEW_BODY}` : `${name} makes a closed outline.`, true);
        extruding.closed = true;
        refreshPreview();
      } else extrudeBox.showStatus(`${name} can't be extruded: it doesn't make one closed outline (${value.open}).`, false);
    } catch (e) {
      if (extruding?.sketch === id) extrudeBox.showStatus(`${name} can't be extruded: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  /**
   * OK: the kernel builds the extrude first; only one that builds is
   * recorded, as one undo step ("Extrude Sketch 1"; a face's sketch and its
   * extrude together, "Extrude Face of Box 1", UX1c). A negative distance
   * goes the other way (recorded as Flip). A refused distance keeps the
   * panel open and says why.
   */
  async function finishExtrude(typed: string) {
    const id = extruding?.sketch;
    if (!id) return;
    const distance = Number(typed);
    if (typed.trim() === "" || !Number.isFinite(distance)) return extrudeBox.showError("Type the distance in mm.");
    if (distance === 0) return extrudeBox.showError(ZERO_OK);
    // Under 0.001 mm or over 1 km, either way: the one rule for typed lengths, in short words (1e300 gave the kernel's
    // 350-character refusal, weak-spot hunt 10-29).
    const tooFar = lengthRefused(Math.abs(distance));
    if (tooFar !== null) return extrudeBox.showError(`The distance${tooFar.slice("A length".length)}`);
    const before = designDoc();
    const source = sourceOf(id);
    // A face offered in another design is out of date (that design changed since).
    if (source.face && source.face.from !== before) return;
    let made: ReturnType<typeof extrudeSketch>;
    try {
      made = extrudeSketch(source.doc, source.sketch, Math.abs(distance), distance < 0);
      await buildSpec(kernel, await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!));
    } catch (e) {
      if (extruding?.sketch === id) extrudeBox.showError(e instanceof Error ? e.message : String(e));
      return;
    }
    // Something else changed the design while the kernel worked: this extrude is out of date.
    if (extruding?.sketch !== id || designDoc() !== before) return;
    leaveExtrude();
    shape = "sketch-extrude";
    inputs[SIZE_KEYS.indexOf("height")].value = String(Math.abs(distance));
    await update(source.face ? `Extrude ${source.label}` : extrudeStep(before, id), undefined, usedSketchHidden(made.doc, source.sketch));
  }

  // Edit feature (step 25a2): an earlier feature's sizes from its timeline item or browser row.
  const editBox = featureEditPanel(ctx.properties, {
    ok: (typed, flip) => void finishEdit(typed, flip),
    cancel: () => leaveEdit(),
  });

  // Move (step 35e2b): a new Move of the bodies picked, or a Move's numbers edited from its timeline item.
  const moveBox = movePanel(ctx.properties, {
    typed: () => previewMove(),
    ok: (typed) => void finishMove(typed),
    cancel: () => leaveMove(),
    snap: () => (snapping ? stopSnap() : startSnap()),
    centre: () => {
      moveBox.setPivot(startPivot(moveBodies, lastScene));
      previewMove();
    },
  });
  /** The bodies the Move panel moves (feature ids): the selection's, and an edited Move's hidden or unbuilt ones it still holds (35e2i). */
  let moveBodies: string[] = [];
  /** Whether the Move panel is picking its bodies: a new Move's, or since 35e2i an edited one's (a click adds a body or takes it out). */
  const picksBodies = () => moveBox.shown;
  /** Over the view while a new Move has no body yet: on a phone the panel's own words wait in the shut sheet, so the view stays clear to tap. */
  const moveHint = viewport.element.ownerDocument.createElement("p");
  moveHint.id = "move-hint"; // read by the e2e test
  moveHint.className = "move-panel-hint";
  moveHint.textContent = "";
  moveHint.hidden = true;
  viewport.element.append(moveHint);
  /** What the hint says while Snap picks (35e2d): first what to snap, then where it lands. */
  const SNAP_FROM = "Snap: click or tap a face or edge to move";
  const SNAP_TO = "Now click or tap where it lands, on another body";
  /** Words when a snap pick is on the wrong body. */
  const SNAP_NOT_MOVING = "Pick a face or edge of the bodies being moved first.";
  const SNAP_MOVING = "That body is being moved: pick where it lands on another body.";
  /** Snap (35e2d) while it picks: null when off, else the face or edge to snap once picked (on body `body`, as the scene shows it). */
  let snapping: { from: { body: string; part: SnapPart } | null } | null = null;
  function showMoveHint() {
    moveHint.textContent = snapping ? (snapping.from === null ? SNAP_FROM : SNAP_TO) : moveBox.kind === "rotate" ? "Rotate: click or tap the bodies to turn" : "Move: click or tap the bodies to move";
    if (moveBox.shown) moveBox.snapping(snapping && moveHint.textContent);
    moveHint.hidden = !(shown && moveBox.shown && (snapping !== null || (picksBodies() && moveBodies.length === 0)));
    viewport.element.dataset.moveSnap = snapping ? (snapping.from === null ? "from" : "to") : ""; // read by the e2e test
  }
  const bodyLabels = (ids: readonly string[]) => ids.map((id) => itemName(designDoc().timeline.features.find((f) => f.id === id)!));
  /** An edited Move's bodies' names: a body deleted since keeps the name the Move knew it by. */
  const heldLabels = (ids: readonly string[]) => {
    const doc = designDoc();
    const move = moveBox.editing === null ? undefined : doc.timeline.features.find((f) => f.id === moveBox.editing);
    return ids.map((id) => {
      const f = doc.timeline.features.find((x) => x.id === id);
      return f ? itemName(f) : (move?.provenance.from.find((r) => r.id === id)?.label ?? id);
    });
  };

  // The panel folds away until something is selected or a tool's box is in it (U0b); the user's pin is kept across mounts.
  fold = propertiesFold(
    ctx.properties,
    ["sketch-panel", "extrude-panel", "feature-edit", "move-panel"].map((id) => ctx.properties.querySelector<HTMLElement>(`#${id}`)!),
    foldKept ?? { ...FOLDED_AT_START, pinned: readPinned() },
  );
  fold.update({ selected: ctx.selection.items.length > 0 });

  /** Opens item `id`'s sizes in the Edit feature panel, out of any sketch or Extrude panel first. */
  function openEdit(id: string) {
    if (isMoveItem(designDoc().timeline.features.find((f) => f.id === id)!)) return startMove(id);
    leaveExtrude();
    leaveMove();
    if (mode.kind !== "none") leaveSketch();
    editBox.show(editableFeature(designDoc(), id));
  }

  function leaveEdit() {
    editBox.hide();
  }

  /**
   * OK: the typed sizes made the item's (`editFeature`), checked by the
   * kernel (`refusedSizes`) and recorded as one undo step ("Edit Extrude
   * 1") only when it takes them; the rebuild builds the item and everything
   * after it. A refused size keeps the panel open with the kernel's words
   * and records nothing; sizes that change nothing close it.
   */
  async function finishEdit(typed: Partial<Record<SizeKey, string>>, flip?: boolean) {
    const id = editBox.editing;
    if (id === null) return;
    const before = designDoc();
    let next: DesignDocument;
    try {
      const f = editableFeature(before, id);
      const read = readTyped(f.keys, typed);
      if (!("sizes" in read)) {
        const key = "bad" in read ? read.bad : read.refused;
        const label = f.shape === "sketch-extrude" ? "distance" : parameterRows(f.shape).find((r) => r.key === key)!.label.toLowerCase();
        return editBox.showError("bad" in read ? `Type the ${label} in mm.` : `The ${label}${read.why.slice("A length".length)}`);
      }
      next = editFeature(before, id, read.sizes, flip);
    } catch (e) {
      return editBox.showError(e instanceof Error ? e.message : String(e));
    }
    if (next === before) return leaveEdit();
    editBox.busy(true);
    let refused: string | null;
    try {
      refused = await refusedSizes(kernel, before, next, id);
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    // Closed, or the design changed while the kernel looked: this edit is out of date.
    if (editBox.editing !== id) return;
    editBox.busy(false);
    if (designDoc() !== before) return editBox.showError(CHANGED_WHILE_CHECKING);
    if (refused !== null) return editBox.showError(refused);
    menuHost.record(editStep(before, id), next);
  }

  /**
   * Move (35e2b), from Modify ▾, M, or Edit feature on a Move; Rotate (Ben,
   * 2026-10-29, its own tool) from Modify ▾ or Shift+R: out of any sketch
   * or other panel first. A new one starts with the selection's bodies (a
   * face or edge picks its body) and turns about their centre; an edited
   * one opens in the tool its numbers say (move.ts moveKindOf), shows them
   * and keeps its bodies.
   */
  function startMove(id: string | null = null, kind: MoveKind = "move") {
    leaveExtrude();
    leaveEdit();
    if (mode.kind !== "none") leaveSketch();
    const doc = designDoc();
    if (id !== null) {
      const f = doc.timeline.features.find((x) => x.id === id)!;
      moveBodies = [...f.dependsOn];
      moveBox.show({ id, kind: moveKindOf(f), name: itemName(f), bodies: f.dependsOn.map((b) => doc.timeline.features.find((x) => x.id === b)?.provenance.self.label ?? f.provenance.from.find((r) => r.id === b)?.label ?? b), values: moveValues(f) });
      // Its bodies picked as a new Move's are (35e2i), so a click adds one or takes one out; this comes back through pickMoveBodies.
      const shownNow = new Set((lastScene?.bodies ?? []).map((b) => b.feature));
      ctx.selection.set(f.dependsOn.filter((b) => shownNow.has(b)).map(bodyReference));
      return pickMoveBodies();
    }
    moveBodies = pickedBodies(ctx.selection.items, lastScene);
    const [pivotX, pivotY, pivotZ] = startPivot(moveBodies, lastScene);
    moveBox.show({ id: null, kind, name: kind === "rotate" ? "Rotate" : "Move", bodies: bodyLabels(moveBodies), values: { ...NO_MOVE, pivotX, pivotY, pivotZ } });
    pickMoveBodies();
  }

  /**
   * A new Move's bodies from the selection, as it changes: a face or edge
   * picked stands for its body, so the selection becomes the bodies (they
   * light as picked); the names, the pivot (unless typed) and the preview
   * follow.
   */
  function pickMoveBodies() {
    const id = moveBox.editing;
    let picked = pickedBodies(ctx.selection.items, lastScene);
    // An edited Move (35e2i) can't move a body made after it: the pick is let go, saying why.
    const edited = id === null ? null : editedBodies(designDoc(), id, moveBodies, picked, lastScene);
    if (edited?.refused) {
      moveBox.showError(edited.refused);
      picked = picked.filter((b) => edited.bodies.includes(b));
    }
    const refs = picked.map(bodyReference);
    const items = ctx.selection.items;
    if (items.length !== refs.length || items.some((r, i) => r.kind !== "body" || r.id !== refs[i].id)) return ctx.selection.set(refs); // comes back here
    moveBodies = edited ? edited.bodies : picked;
    if (snapping?.from && !picked.includes(snapping.from.body)) snapping.from = null;
    if (snapping && picked.length === 0) snapping = null;
    showMoveHint();
    moveBox.setBodies(edited ? heldLabels(moveBodies) : bodyLabels(picked));
    moveBox.setPivot(startPivot(picked, lastScene));
    previewMove();
  }

  /**
   * The preview: a new Move's bodies drawn turned and shifted by the boxes
   * as typed (move-tool.ts `movedMesh`, no kernel call), the rest as built;
   * an edited Move's bodies where OK will put them (35e2c, `editedMoveMesh`:
   * out of where the Move put them as built, into where the boxes say); a
   * box that isn't a number shows them as built. The arrows and rings
   * follow (`showMoveHandles`).
   */
  function previewMove() {
    if (!lastScene) return;
    const read = readMoveBoxes(moveBox.typed);
    const v = moveBox.shown && "values" in read && previewable(read.values) ? read.values : null;
    const id = moveBox.editing;
    viewport.showBody(v === null ? lastScene.mesh : id === null ? movedMesh(lastScene, moveBodies, v) : editedMoveMesh(lastScene, designDoc(), resultsNow, id, v, moveBodies));
    showMoveHandles();
  }

  /**
   * Move's arrows and rings (35e2c) where the pivot ends up, while the panel
   * is open on bodies and every box reads as a number (a box half typed
   * hides them, as it stops the preview); taken away otherwise.
   */
  function showMoveHandles() {
    const read = readMoveBoxes(moveBox.typed);
    // Not while Snap picks (35e2d): a click on the bodies is a pick then, never a grab of an arrow or ring over them.
    const on = shown && moveBox.shown && moveBodies.length > 0 && snapping === null && "values" in read && previewable(read.values);
    viewport.showMoveHandles(on ? { centre: handlesCentre(read.values), kind: moveBox.kind } : null);
  }

  /** The Move's numbers as a handle's drag began (the boxes then), or null while none is held. */
  let dragFrom: MoveValues | null = null;
  /**
   * A Move handle dragged (35e2c): the handle's box set to its number at the
   * press moved by the drag in whole millimetres or 15° steps
   * (`draggedValues`), so the typed values follow the drag and the preview
   * and handles follow the box; a box typed after the drag is the user's.
   */
  const onMovePointer: SharedViewport["onMovePointer"] = (pointer) => {
    if (!moveBox.shown) return;
    if (dragFrom === null) {
      const read = readMoveBoxes(moveBox.typed);
      if ("bad" in read) return moveBox.showError(`Type the ${MOVE_BOX_WORDS[read.bad]}.`);
      dragFrom = read.values;
    }
    moveBox.setValue(pointer.handle, draggedValues(dragFrom, pointer.handle, pointer.amount)[pointer.handle]);
    moveBox.dragging(pointer.done ? null : pointer.handle); // the box being changed glows while the drag lasts
    if (pointer.done) dragFrom = null;
    previewMove();
  };

  function startSnap() {
    if (!moveBox.shown || moveBodies.length === 0) return;
    snapping = { from: null };
    moveBox.showError("");
    showMoveHint();
    showMoveHandles();
  }
  function stopSnap() {
    snapping = null;
    showMoveHint();
    showMoveHandles();
  }
  /**
   * A click while Snap picks: the first, a face or edge of a body the Move
   * moves; the second, one of another body, where it lands. The boxes are
   * then set to the numbers that lay the one on the other (move-snap.ts,
   * on top of the turn they held) and the preview follows; OK records them
   * as typed numbers. A curved face, a body on the wrong side or a face
   * onto an edge says why and waits for another pick; empty space does
   * nothing.
   */
  function snapPick(pick: Parameters<NonNullable<SharedViewport["onPick"]>>[0]) {
    const at = pick.edge != null ? ({ kind: "edge", index: pick.edge } as const) : pick.face !== null ? ({ kind: "face", index: pick.face } as const) : null;
    const hit = at && lastScene ? sceneHit(lastScene, at.kind, at.index) : null;
    if (!snapping || !at || !hit || !lastScene) return;
    const body = lastScene.bodies[hit.body];
    const got = snapPart(body.view, at.kind, hit.index);
    if ("refused" in got) return moveBox.showError(got.refused);
    const moving = moveBodies.includes(body.feature);
    if (snapping.from === null) {
      if (!moving) return moveBox.showError(SNAP_NOT_MOVING);
      snapping.from = { body: body.feature, part: got.part };
      moveBox.showError("");
      return showMoveHint();
    }
    if (moving) return moveBox.showError(SNAP_MOVING);
    const read = readMoveBoxes(moveBox.typed);
    if ("bad" in read) return moveBox.showError(`Type the ${MOVE_BOX_WORDS[read.bad]}.`);
    const ends = snapEnds(designDoc(), resultsNow, moveBox.editing, snapping.from.body, snapping.from.part, got.part);
    const r = snappedValues(read.values, ends.from, ends.to);
    if ("refused" in r) return moveBox.showError(r.refused);
    moveBox.setValues(r.values);
    moveBox.showError("");
    stopSnap();
    previewMove();
  }

  /** The Move panel put away, its preview with it; a new Move's picked bodies stay selected, an edited one's are let go (35e2i). */
  function leaveMove() {
    if (!moveBox.shown) return;
    const edited = moveBox.editing !== null;
    moveBox.hide();
    moveBodies = [];
    dragFrom = null;
    snapping = null;
    showMoveHint();
    viewport.showMoveHandles(null);
    if (lastScene) viewport.showBody(lastScene.mesh);
    if (edited) ctx.selection.clear();
  }

  /** OK's words when the design changed while the kernel checked the Move: nothing was recorded. */
  const MOVE_CHANGED = "The design changed while the Move was checked: nothing was changed. Press OK again.";

  /**
   * OK: the boxes read (one that isn't a number says which), the Move made
   * (`insertMove` at the marker, or `changedMove`), checked by building the
   * design on the kernel (`refusedMove`: a body moved out past model space
   * is refused with the kernel's words) and recorded as one undo step,
   * "Move bodies" or "Edit Move 1". A new Move that moves nothing, or an
   * edit that changes nothing, closes the panel and records nothing.
   */
  async function finishMove(typed: Record<MoveParam, string>) {
    if (!moveBox.shown) return;
    const id = moveBox.editing;
    const before = designDoc();
    const read = readMoveBoxes(typed);
    if ("bad" in read) return moveBox.showError(`Type the ${MOVE_BOX_WORDS[read.bad]}.`);
    const v = read.values;
    let next: DesignDocument;
    let moved: string;
    try {
      if (id === null) {
        if (v.x === 0 && v.y === 0 && v.z === 0 && v.turnX === 0 && v.turnY === 0 && v.turnZ === 0 && moveBodies.length > 0) return leaveMove();
        ({ doc: next, id: moved } = insertMove(before, moveBodies, v, moveBox.kind));
      } else [next, moved] = [changedMove(before, id, v, moveBodies), id];
    } catch (e) {
      return moveBox.showError(e instanceof Error ? e.message : String(e));
    }
    if (next === before) return leaveMove();
    moveBox.busy(true);
    let refused: string | null;
    try {
      refused = await onceMoreAfterRestart(() => refusedMove(kernel, next, moved));
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    // Closed, or opened on another Move, while the kernel looked: this OK is out of date.
    if (!moveBox.shown || moveBox.editing !== id) return;
    moveBox.busy(false);
    if (designDoc() !== before) return moveBox.showError(MOVE_CHANGED);
    if (refused !== null) return moveBox.showError(refused);
    if (id === null) ctx.selection.clear();
    menuHost.record(id === null ? (moveBox.kind === "rotate" ? ROTATE_STEP : MOVE_STEP) : editStep(before, id), next);
  }

  /** The pointer rounded by the kernel: onto the grid with grid snap on, else where it is to within half a pixel (snap.ts `rounding`). */
  const roundPointer = (at: SketchXY, grid: number, pixel: number | undefined, held = modHeld): Promise<SketchXY> => {
    const r = rounding(at, grid, snapsNow(snapOn, held, gridSnap).grid, pixel);
    return r.op === "snap_to_grid" ? kernel.call("snap_to_grid", ...r.args) : kernel.call("place_freely", ...r.args);
  };
  /** The pointer's moves counted, the pointer leaving the view among them: a move's rounding answered after a later move is dropped, so it never shows a snap where the pointer was. */
  let moves = 0;
  /** The last hover the kernel has answered (its move's count, where the pointer was, rounded, its pixel); null once the pointer left the view. */
  let hovered: { move: number; at: SketchXY; rounded: SketchXY; pixel: number | undefined } | null = null;
  /**
   * The pointer's last move since the last click (its count, where it was, its pixel, and the kernel's rounding of it
   * on the way), or null: an Enter places from where the pointer was as Enter was pressed, once that move is rounded.
   */
  let lastMove: { at: SketchXY; pixel: number | undefined; rounded: Promise<SketchXY> } | null = null;
  /** The pointer's last move over the sketch, snapped again when Ctrl or Cmd is pressed or let go with the pointer still. */
  let lastHover: SketchPointer | null = null;
  /** A press of Ctrl or Cmd waiting to show: dropped when another key follows, a shortcut like Ctrl+Z rather than a hold. */
  let heldShow: ReturnType<typeof setTimeout> | undefined;
  /** Another key pressed while Ctrl or Cmd is held (a shortcut, not a hold). */
  let chord = false;
  /**
   * Ctrl or Cmd pressed or let go: the snap under a still pointer shows the change, as Fusion's does. A press shows it
   * after HELD_SHOW_MS unless another key comes first, and a release after another key shows nothing until the pointer
   * moves, so Ctrl+Z never snaps a hover again just as Undo puts the sketch state away (a hover answered after Undo
   * would draw the old tool on the new document: sketch-session.mjs, seed 1).
   */
  const onHeldKey = (e: KeyboardEvent) => {
    clearTimeout(heldShow);
    const now = e.ctrlKey || e.metaKey;
    if (now && e.type === "keydown" && e.key !== "Control" && e.key !== "Meta") chord = true;
    if (now === modHeld) return;
    modHeld = now;
    const show = () => {
      if (shown && mode.kind === "edit" && lastHover) onSketchPointer(lastHover);
    };
    // Let go after a shortcut: the next pointer move shows the snap, never a hover snapped while the shortcut's change lands.
    if (now) heldShow = setTimeout(show, HELD_SHOW_MS);
    else if (!chord) show();
    if (!now) chord = false;
  };
  /** The window lost focus (Alt-Tab, Ctrl+Tab): a held Ctrl or Cmd's release will never arrive here, so it counts as let go now. */
  const onLostFocus = () => {
    clearTimeout(heldShow);
    chord = false;
    if (!modHeld) return;
    modHeld = false;
    if (shown && mode.kind === "edit" && lastHover) onSketchPointer(lastHover);
  };
  /** Clicks are handled one after another, each on the document the last one left. */
  let clicks = Promise.resolve();
  /** How many clicks (typed Enters and projections too) wait their turn: Finish Sketch waits for them. */
  let waiting = 0;
  /** `turn` in line behind the clicks before it. */
  const inTurn = (turn: () => Promise<void>) => {
    waiting++;
    clicks = clicks.then(turn).finally(() => void waiting--);
  };
  const onSketchPointer = (pointer: SketchPointer) => {
    if (mode.kind !== "edit") return;
    const at = pointer.at;
    if (at) pointerAt = at;
    // Step 27d: the Project tool snaps nothing and places nothing; a click projects what the viewport says is under it.
    if (mode.tool.kind === "project") {
      ++moves;
      hovered = lastMove = null;
      mode.snap = null;
      mode.pointer = at;
      if (pointer.kind === "click") projectAt(pointer);
      return drawSketches();
    }
    if (pointer.kind === "move") {
      lastHover = at ? pointer : null;
      const move = ++moves;
      if (!at) {
        mode.pointer = mode.snap = null;
        hovered = lastMove = null;
        return drawSketches();
      }
      // The centre arc follows which way the pointer goes round its centre, from every move (a reply the kernel drops as stale must not lose a turn).
      mode.tool = hoverTool(mode.tool, at);
      // A hover off the modelling range just doesn't move the preview.
      const rounded = roundPointer(at, mode.grid, pointer.pixel);
      lastMove = { at, pixel: pointer.pixel, rounded };
      void rounded.then((value) => {
        if (move !== moves || mode.kind !== "edit") return;
        hovered = { move, at, rounded: value, pixel: pointer.pixel };
        mode.snap = snapHere(designDoc(), mode.tool, at, value, pointer.pixel);
        mode.pointer = mode.snap.at;
        mode.pixel = pointer.pixel;
        drawSketches();
      }, () => {});
      return;
    }
    if (!at) return;
    const changes = toolChanges;
    // What is typed as the click is made (hunt 26h): the kernel may answer after more is typed, which is for the next point.
    const took = locks;
    // Ctrl or Cmd as the click is made: the kernel may answer after it is let go.
    const held = modHeld;
    const movedAt = moves;
    lastMove = null; // an Enter from now on places from this click's point, or from a hover after it
    inTurn(async () => {
      if (mode.kind !== "edit") return;
      let rounded: SketchXY;
      try {
        rounded = await roundPointer(at, mode.grid, pointer.pixel, held);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      // The tool changed while the kernel snapped (L, R, C or Escape): the click was for the old tool, so it is dropped.
      if (mode.kind !== "edit" || toolChanges !== changes) return;
      // The click lands where the hover showed it would: where it was rounded to (free or on the grid), or on the point or line-up snap.ts finds.
      const edges = edgeTargets(mode.tool.sketch);
      const snapped = snapHere(designDoc(), mode.tool, at, rounded, pointer.pixel, edges, held).at;
      // A typed size overrules the pointer for what it locks (SF4): the point goes where the locks put it, exactly.
      const aim = aimOf(designDoc(), mode.tool, snapped, took);
      if (!aim) return sketchBox.showError(NO_AIM);
      const before = designDoc();
      const done = clickAt(before, withLocks(mode.tool, took, snapped), aim);
      // The owner's rule (rebuild.ts): an extrude whose sketch this edit breaks keeps the sketch as it was, in the same undo step.
      // A new point on the face's edges is pinned there (26f), in the same step.
      let next = pinNewPoints(before, done.doc, done.tool.sketch, edges);
      if (done.drew) {
        try {
          next = await settleKept(kernel, before, next, bodies);
        } catch (e) {
          return sketchBox.showError(e instanceof Error ? e.message : String(e));
        }
        // Undo, Escape or a tool change while the kernel looked: the click was for a sketch that is no longer there.
        if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      }
      // A circle's rim the grid rounded onto its centre from further out than a snap's reach (so not a click on the centre)
      // says the grid did it (a small circle at phone zoom; beginner play-test 2026-10-28).
      sketchBox.showError(done.note === NO_RADIUS && snapsNow(snapOn, held, gridSnap).grid && rounded[0] === snapped[0] && rounded[1] === snapped[1] && pointer.pixel !== undefined && Math.sqrt((at[0] - snapped[0]) ** 2 + (at[1] - snapped[1]) ** 2) > SNAP_PIXELS * pointer.pixel ? GRID_ATE_RADIUS : (done.note ?? ""));
      if (done.tool !== mode.tool && locks === took) unlock(); // the sizes it placed with, not any typed since
      mode.tool = done.tool;
      // What the pointer snaps to now, with the new point and the tool's next step: where a hover answered since the
      // click has it (the click waited its turn behind the kernel while the pointer moved on: hunt 26h), else still at
      // the click. (A finger has left the view by now, and this keeps the hint and the boxes by the tap; sketch-hover.journey.ts.)
      const now = hovered !== null && hovered.move > movedAt ? hovered : { at, rounded, pixel: pointer.pixel };
      mode.snap = snapHere(done.doc, done.tool, now.at, now.rounded, now.pixel, edges);
      mode.pointer = mode.snap.at;
      mode.pixel = now.pixel;
      if (done.drew) applySketchEdit(next, drawStep(done.tool), done.tool.sketch);
      drawSketches();
      if (done.drew) await showOutline();
    });
  };

  /**
   * A click with the Project tool (27d): the edge under the pointer, else
   * every edge of the face there, of a body before the sketch, projected
   * into it as one undo step ("Project"), in turn with the clicks before it
   * (each on the document the last left); settled as a click is, so an
   * extrude of the sketch keeps its shape if this breaks its outline. What
   * was refused, left out or projected already is said in the panel.
   */
  function projectAt(pointer: SketchPointer) {
    const changes = toolChanges;
    inTurn(async () => {
      if (mode.kind !== "edit" || mode.tool.kind !== "project" || toolChanges !== changes) return;
      const id = mode.tool.sketch;
      const before = designDoc();
      const pick = projectPick(before, id, lastScene, sketchPlane(before, id, placedNow), pointer);
      let made: ReturnType<typeof projectEdges>;
      try {
        made = projectEdges(before, id, pick.edges);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      sketchBox.showError(pick.note ?? (pick.edges.length > 0 && made.ids.length === 0 ? PROJECT_AGAIN : ""));
      if (made.ids.length === 0) return;
      let next: DesignDocument;
      try {
        next = await settleKept(kernel, before, made.doc, bodies);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      // Undo, Escape or a tool change while the kernel looked: the click was for a sketch that is no longer there.
      if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      applySketchEdit(next, SKETCH_STEPS.project, id);
      drawSketches();
      await showOutline();
    });
  }

  /**
   * Enter in a typed box (SF4): the point placed where the locks and the
   * pointer put it as Enter is pressed, as a click there would; the keys
   * stay in the boxes for the next line. Enter takes the boxes and empties
   * them at once (hunt 26h): placing waits behind the kernel's last answer,
   * and the next side typed meanwhile must go into fresh boxes, not be read
   * by this Enter (a fast "10, Tab, 90, Enter" placed a point 180 mm off).
   * An Enter that places nothing gives its sizes back, unless something was
   * typed since.
   */
  function placeTyped() {
    if (mode.kind !== "edit") return;
    const took = locks;
    const texts = typed.texts();
    const from = lastMove;
    const changes = toolChanges;
    unlock(true);
    drawSketches();
    const giveBack = () => void (mode.kind === "edit" && typed.restore(texts));
    inTurn(async () => {
      // A tool chosen (or Escape) since: the sizes were for the old tool, so the Enter is dropped, as a click is.
      if (mode.kind !== "edit" || toolChanges !== changes) return;
      // Where the pointer was as Enter was pressed: its last move, rounded and snapped on the sketch as it is now (the
      // points placed before this one in), else where the last click or hover left it.
      let pointer = mode.pointer;
      if (from) {
        const rounded = await from.rounded.catch(() => null);
        if (mode.kind !== "edit" || toolChanges !== changes) return;
        if (rounded) pointer = snapHere(designDoc(), mode.tool, from.at, rounded, from.pixel).at;
      }
      const aim = aimOf(designDoc(), mode.tool, pointer, took);
      if (!aim) return (sketchBox.showError(NO_AIM), giveBack());
      const before = designDoc();
      const done = clickAt(before, withLocks(mode.tool, took, pointer), aim);
      // As a click: an extrude whose sketch this breaks keeps the sketch as it was (rebuild.ts), in the same undo step, and a point on the face's edges is pinned (26f).
      let next = pinNewPoints(before, done.doc, done.tool.sketch, edgeTargets(done.tool.sketch));
      if (done.drew) {
        try {
          next = await settleKept(kernel, before, next, bodies);
        } catch (e) {
          return (sketchBox.showError(e instanceof Error ? e.message : String(e)), giveBack());
        }
        if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      }
      sketchBox.showError(done.note ?? "");
      if (done.tool === mode.tool) giveBack();
      mode.tool = done.tool;
      mode.snap = null;
      if (done.drew) applySketchEdit(next, drawStep(done.tool), done.tool.sketch);
      drawSketches();
      if (done.drew) await showOutline();
    });
  }
  const onViewportMove = (e: PointerEvent) => {
    modHeld = e.ctrlKey || e.metaKey;
    if (e.target instanceof Node && typed.element.contains(e.target)) return; // over the boxes themselves: they stay put
    const r = viewport.element.getBoundingClientRect();
    screen = { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Picking (17b): a click on a face selects it, Shift adds, empty space or Escape clears.
  const onPick: SharedViewport["onPick"] = (pick) => {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc) return;
    // Choosing where Create sketch puts the sketch: an origin plane, or a flat face of a body on screen (26d).
    if (mode.kind === "pick") {
      const spot = sketchSpot(pick, lastScene);
      if (spot?.kind === "plane") pickPlane(spot.plane);
      else if (spot) pickFace(spot);
      return;
    }
    // Snap (35e2d): the click picks what to snap, then where it lands, and picks no bodies.
    if (moveBox.shown && snapping) return snapPick(pick);
    // A Move (35e2b; an edited one too since 35e2i): a click on a body adds it or takes it out; empty space keeps what is picked.
    if (moveBox.shown) {
      const c = pickChange({ ...pick, shift: true }, lastScene);
      const b = c.change === "toggle" && lastScene ? bodyOf(lastScene, c.item) : -1;
      if (picksBodies() && b >= 0) ctx.selection.toggle(bodyReference(lastScene!.bodies[b].feature));
      return;
    }
    const c = pickChange(pick, lastScene);
    if (c.change === "set") ctx.selection.set([c.item]);
    else if (c.change === "toggle") ctx.selection.toggle(c.item);
    else if (c.change === "clear") ctx.selection.clear();
  };
  let stopWatching = () => {};
  // The phone turned or the window resized (a keyboard, a panel): the line's point moved on screen, so the typed
  // boxes and the hint go beside it again rather than staying where they were, maybe past the view's edge (hunt D2).
  // The viewer's own observer, made first, has already fitted the camera to the new size. (None outside a browser: the journeys.)
  const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    if (mode.kind !== "edit" || !pointerAt) return;
    const at = viewport.sketchScreenPoint(pointerAt);
    if (at) screen = at;
    drawSketches();
  });
  /** Listens to picks and the selection: from mount, and again on each wake. Keys come from the shell (X7b), only while shown. */
  function listen() {
    viewport.onPick = onPick;
    viewport.onSketchPointer = onSketchPointer;
    viewport.onExtrudePointer = onExtrudePointer;
    viewport.onMovePointer = onMovePointer;
    showExtrudeView();
    showMoveHandles();
    viewport.element.addEventListener("pointermove", onViewportMove);
    viewport.element.addEventListener("pointerdown", onViewportMove); // a tap moves no pointer first
    resized?.observe(viewport.element);
    globalThis.addEventListener?.("keydown", onHeldKey);
    globalThis.addEventListener?.("keyup", onHeldKey);
    globalThis.addEventListener?.("blur", onLostFocus);
    if (mode.kind === "pick") viewport.showPlanes(originPlanes(), sketchableFaces(lastScene));
    drawSketches();
    showMoveHint();
    stopWatching = ctx.selection.onChange(() => {
      // Extrude (UX1b): a sketch's row clicked in the browser chooses it, as a click on its outline in the view does.
      const items = ctx.selection.items;
      const sketch = extruding && items.length === 1 ? readProfileReference(items[0]) : null;
      if (sketch !== null) chooseProfile(sketch);
      if (picksBodies()) pickMoveBodies();
      // The user's next change of selection retires the note about dropped items.
      if (!settling && note) panel.showSelectionNote((note = ""));
      showSelection();
    });
  }
  function sleep() {
    if (!shown) return;
    shown = false;
    viewport.onPick = null;
    viewport.onSketchPointer = null;
    viewport.onExtrudePointer = null;
    viewport.showExtrude(null);
    viewport.onMovePointer = null;
    viewport.showMoveHandles(null);
    viewport.element.removeEventListener("pointermove", onViewportMove);
    viewport.element.removeEventListener("pointerdown", onViewportMove);
    resized?.disconnect();
    globalThis.removeEventListener?.("keydown", onHeldKey);
    globalThis.removeEventListener?.("keyup", onHeldKey);
    globalThis.removeEventListener?.("blur", onLostFocus);
    clearTimeout(heldShow);
    typed.hide();
    hint.hide();
    moveHint.hidden = true;
    showStart(); // hidden while asleep; wake shows it again if it still applies
    sketchBar.closeMenu();
    // Asleep, the sketches stay drawn as finished ones: no grid, no planes to pick.
    viewport.showPlanes([]);
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    viewport.showSketches(doc ? sketchDrawings(doc, null, placedNow, lostSketches()) : []);
    viewport.showSelection(NO_HIGHLIGHT);
    stopWatching();
  }

  // The Shape choice (U0d) does what the toolbar's shape buttons did: set_part with this shape and the boxes' sizes.
  panel.shapeChoice.addEventListener("change", () => {
    const kind = panel.shapeChoice.value as ShapeKind;
    if (kind) void run({ op: "set_part", shape: kind });
  });
  // Typing in one box is one undo step (the merge key), named for the box.
  inputs.forEach((input, i) => {
    input.addEventListener("input", () => update(shape === "sketch-extrude" && SIZE_KEYS[i] === "height" ? DISTANCE_STEP : `Change ${SIZE_KEYS[i]}`, SIZE_KEYS[i]));
    // Left (or Enter): a refused size gives way to the last one. Blur too: Firefox gives no change for a number box
    // left empty after 0 and -5 (hunt 26h, CI's browsers job).
    input.addEventListener("change", () => restoreRefused(i));
    input.addEventListener("blur", () => restoreRefused(i));
  });
  listen();
  // A new project's design starts empty (U0c, the owner's ask), never as a box made from the size boxes.
  const first = held === undefined ? update(undefined, undefined, freshDesign()) : update();
  enterSketch(); // after an Undo or Redo inside a sketch: still in it
  return {
    ready: first.then(
      () => {},
      () => {},
    ),
    sleep,
    run,
    check: aiCheck,
    // File ▾ (U0f2a): New clears the design after asking (start-fresh.ts); Export STL downloads every body shown, as the toolbar's STL does.
    fileEntries: () => {
      const doc = designDoc();
      const stl = DESIGN_COMMANDS.find((c) => c.op === "export_stl")!;
      const bodies = shownBodyRefs(doc, failedNow);
      return {
        new: fresh.entry(doc, mode.kind !== "none"),
        exports: [
          { id: "file-export-stl", label: "Export STL", title: `Export STL: ${stl.summary}`, off: bodies.length === 0 ? noBodyWords(doc, failedNow) : undefined, run: () => run({ op: "export_stl" }) },
          { id: "file-slice-print", label: "Slice for printing", title: SLICE_PRINT_TITLE, off: bodies.length === 0 ? noBodyWords(doc, failedNow) : undefined, run: () => printing.ask() },
        ],
      };
    },
    // What the AI assistant is told before a request (25c3): the timeline as last built, and the panel's sizes, which a set_part keeps for each it leaves out.
    aiView: () => {
      const [width, depth, height] = inputs.map((i) => Number(i.value));
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      const label = (id: string) => doc?.timeline.features.find((f) => f.id === id)?.provenance.self.label ?? id;
      return designAIView(doc, failedNow, { width, depth, height }, aiFaces(lastScene, label), mode.kind === "edit" ? mode.tool.sketch : null);
    },
    // Escape clears the selection; Copy with one profile selected runs Copy as SVG (shortcuts.ts).
    shortcut(id) {
      if (!shown) return false; // the shell only asks while shown; never act asleep
      // Escape during a drag on the timeline bar calls the drag off, and only that (timeline hunt, finding 7).
      if (id === "clear-selection" && callOffDrag()) return true;
      // Escape with the Create menu open closes the menu, and only that.
      if (id === "clear-selection" && sketchBar.menuOpen) return sketchBar.closeMenu(), true;
      // Escape in the sketch tool: leaves the plane prompt, or ends the line, rectangle, circle, arc or tangent arc being drawn.
      if (id === "clear-selection" && mode.kind === "pick") return leaveSketch(), true;
      if (id === "clear-selection" && extrudeBox.shown) return leaveExtrude(), true;
      // Enter is the Extrude panel's OK with the focus on the view (after a drag of the arrow) or nowhere; anything else focused (a button, a timeline item) takes its own Enter.
      if (id === "extrude-ok") {
        const active = ctx.properties.ownerDocument.activeElement;
        // Enter is the Move panel's OK the same way (35e2b).
        if (moveBox.shown && !extrudeBox.shown) {
          if (active && active !== active.ownerDocument.body && !viewport.element.contains(active)) return false;
          return void finishMove(moveBox.typed), true;
        }
        if (!extrudeBox.shown || (active && active !== active.ownerDocument.body && !viewport.element.contains(active))) return false;
        if (extrudeBox.ready) void finishExtrude(extrudeBox.typed);
        return true;
      }
      if (id === "clear-selection" && editBox.editing !== null) return leaveEdit(), true;
      // Escape while Snap picks stops the snap, and only that (35e2d).
      if (id === "clear-selection" && moveBox.shown && snapping) return stopSnap(), true;
      if (id === "clear-selection" && moveBox.shown) return leaveMove(), true;
      // M opens Move outside a sketch (Fusion's key); in a sketch the key does what it would.
      if (id === "move-tool") return mode.kind === "none" ? (startMove(), true) : false;
      // E is Extrude (Fusion's key), in a sketch too (Extrude leaves it, as its toolbar button does); not while a plane is
      // being picked, nor with Extrude already open. S opens the command search box outside a sketch (Ben's keys 10-29).
      if (id === "extrude-tool") return mode.kind === "pick" || extrudeBox.shown ? false : (startExtrude(), true);
      if (id === "command-search") return mode.kind === "none" ? (searchBox.open(), true) : false;
      if (id === "rotate-tool") return mode.kind === "none" ? (startMove(null, "rotate"), true) : false;
      if (id === "clear-selection" && mode.kind === "edit" && toolBusy(mode.tool)) {
        mode.tool = startTool(mode.tool.kind, mode.tool.sketch);
        mode.snap = null;
        toolChanges++;
        unlock();
        sketchBox.showError("");
        drawSketches();
        return true;
      }
      // L, R, C and A choose the line, rectangle, circle and arc tools while a sketch is edited; otherwise the key does what it would.
      // A digit, point or minus while a line or rectangle is part drawn starts typing its size in the first box (SF4).
      const typedKey = typedSizeKey(id);
      if (typedKey !== null) return mode.kind === "edit" && typedFields(mode.tool).length > 0 ? (typed.start(typedKey), true) : false;
      const kind = sketchToolKey(id);
      if (kind) return mode.kind === "edit" ? (chooseTool(kind), true) : false;
      const items = ctx.selection.items;
      const what = designShortcut(id, items);
      if (what === "clear") ctx.selection.clear();
      else if (what === "copy") void runAction(COPY_SVG, items);
      return what !== null;
    },
    wake() {
      if (shown) return;
      shown = true;
      listen();
      showStart();
      // A build that finished while asleep was not drawn: show the document again
      // (never rebuilt from the size boxes, which would add a box to a design with
      // no body; hunt 2026-10-21). Otherwise the body is still in the viewport;
      // redraw what others may have changed.
      if (missed) return void show(designDoc(), shape);
      showSelection();
      markStale();
    },
    unmount() {
      putAwayByRestore = ctx.history.restoring();
      if (!putAwayByRestore) editingSketch = null;
      // A click, Enter or hover still waiting on the kernel was for the sketch shown until now; an undo that puts the
      // workspace away may have taken that sketch out, so it is dropped as a tool change drops it (app sweep 2026-10-28).
      toolChanges++;
      moves++;
      sleep();
      stopHealing?.();
      void bodies.close();
      viewport.showSketches([]);
      viewport.showOrigin(ORIGIN_AT_FIRST);
      typed.element.remove();
      hint.element.remove();
      moveHint.remove();
      startCard.element.remove();
      if (fold) {
        foldKept = { ...FOLDED_AT_START, pinned: fold.state.pinned };
        fold.close();
      }
      for (const slot of [ctx.toolbar, ctx.browser, ctx.properties, ctx.timeline]) slot?.replaceChildren();
    },
  };
}

export const designWorkspace: WorkspacePlugin = {
  id: "design",
  title: "Design",
  summary: "Parametric modelling: sketches, features and the timeline. The source of truth for all geometry.",
  status: "working",
  representations: { produces: ["solid", "mesh", "outline"], accepts: [] },
  registerRepresentations: registerDesign,
  registerActions: (registry) => registerDesignActions(registry),
  readData: readDesignDocument,
  commands: DESIGN_COMMANDS,
  shortcuts: DESIGN_SHORTCUTS,
  mount,
};
