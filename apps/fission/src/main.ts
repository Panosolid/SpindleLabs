// The app shell: one project, one kernel, one viewport, and a switcher
// between workspaces. Each workspace fills the layout slots around the
// shared viewport (toolbar above, browser floating over its top left,
// properties right, a workspace's timeline in a thin row along the bottom); the
// viewport is shared, so switching keeps the camera and what is on screen.
// Workspaces stay warm (X7): each gets slots of its own the first time it is
// shown in a pane, and switching swaps whole slots in and out and puts the
// workspace to sleep or wakes it, so a switch rebuilds nothing. Split view (X3) shows a second workspace
// beside the first, in slots of its own, with its own camera on the same
// scene and the same project and selection. Change notes (X5) show over
// each pane's viewport, for the workspace in that pane.
/// <reference types="vite/client" />
// First, before any module that starts work: a framed page stops here (audit S10).
import "./frame-guard.ts";
import "@fission/ui/theme.css";
// Every feature's own styles (src/styles/<feature>.css in packages/ui and the
// workspaces), loaded without a list, so two features never edit one file.
import.meta.glob(["../../../packages/ui/src/styles/*.css", "../../../workspaces/*/src/styles/*.css"], { eager: true });
import { ActionRegistry, CLIPBOARD_CHORDS, chordLabel, chordOf, SHELL_SHORTCUTS, ShortcutTable, type Chord, ChangeNotes, DependencyGraph, DownstreamRegistry, emptyProject, FILE_FORMATS, formatInfo, HEAD_BYTES, projectFromJson, routeFiles, projectToJson, RepresentationRegistry, createHistory, KernelClient, createSelection, type ChangeNote, type MountedWorkspace, type Project, type SharedViewport, type WorkspaceContext, type WorkspaceId, type WorkspacePlugin, workspaceName } from "@fission/core";
import { changeNote, fileMenu, PROJECT_KIND, saveFile, type FileHandle, iconSvg, openElsewhere, shortcutList, defaultSplit, showPlaceholder, SPLIT_MIN_WIDTH_PX, splitChoices, WarmPool, fillSettings, SettingsStore, withIcon, workspaceSwitcher } from "@fission/ui";
import { paneViewports, Viewer, type ViewportView } from "@fission/viewport";
import { communityPage } from "@fission/community";
import { keepStorage, keptEntry, localStore, OPENING_KEY, recoverUnsaved, reopenGuard, startAutosave, STORAGE_ANSWER_MS, storedCopy, type Autosave, type AutosaveStatus, type OpeningChannel } from "@fission/storage";
import { createAssistant } from "./assistant.ts";
import { startOffline } from "./offline.ts";
import { watchKernel } from "./kernel-lost.ts";
import { startPhoneFloat } from "./phone-float.ts";
import { sheetDrag } from "./sheet-drag.ts";
import { designWorkspace } from "@fission/design";
import { renderWorkspace } from "@fission/render";
import { simulateWorkspace } from "@fission/simulate";
import { manufactureWorkspace } from "@fission/manufacture";
import { laserWorkspace } from "@fission/laser";
import { sliceWorkspace } from "@fission/slice";
import { circuitWorkspace } from "@fission/circuit";
import { vectorWorkspace } from "@fission/vector";
import { imageWorkspace } from "@fission/image";
import { layoutWorkspace } from "@fission/layout";

const workspaces: WorkspacePlugin[] = [
  designWorkspace,
  renderWorkspace,
  simulateWorkspace,
  manufactureWorkspace,
  laserWorkspace,
  sliceWorkspace,
  circuitWorkspace,
  vectorWorkspace,
  imageWorkspace,
  layoutWorkspace,
];

// The browser test of a kernel lost mid-call (e2e/kernel-lost.mjs) shortens its deadline with ?test-hooks&kernel-deadline=<ms>.
const hooks = new URLSearchParams(location.search);
const kernel = new KernelClient({ answerWithinMs: (hooks.has("test-hooks") && Number(hooks.get("kernel-deadline"))) || undefined });
// The kernel's files missing (a deploy since this page loaded, or the network): say which, and recover (kernel-lost.ts).
watchKernel(kernel);
// The one conversion layer: every workspace says what it can hand over.
const representations = new RepresentationRegistry();
for (const w of workspaces) w.registerRepresentations?.(representations, kernel);
// The shell opens whole projects, dropped or pasted like any other file (X6).
representations.registerImporter({ formats: ["project"], workspace: null, open: async (_name, bytes) => openProject(new TextDecoder().decode(bytes)) });
// The one action registry: the verbs each workspace offers for a selection.
const actions = new ActionRegistry();
for (const w of workspaces) w.registerActions?.(actions);
// The one downstream registry: what each workspace makes from the design (Design shows them as chips).
const downstream = new DownstreamRegistry();
for (const w of workspaces) w.registerDownstream?.(downstream);
const workspaceTitle = (id: WorkspaceId) => workspaces.find((w) => w.id === id)?.title ?? id;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// The one viewer (one scene); each workspace on screen sees it through a
// pane of its own: its own camera, the viewer's body, selection and picks.
const viewer = new Viewer($("viewport"));
const pane = paneViewports(viewer);
const ctx: WorkspaceContext = {
  project: emptyProject(),
  projectChanged: (label, mergeKey) => projectChanged(label, mergeKey),
  kernel,
  selection: createSelection(),
  history: null!, // created just below: it captures the project as it starts
  graph: new DependencyGraph(),
  // The page's first slots; each workspace gets slots of its own (paneCtx, X7).
  toolbar: $("toolbar"),
  browser: $("browser"),
  properties: $("properties"),
  timeline: $("timeline"),
  viewport: pane(viewer.main),
  representations,
  actions,
  downstream,
  changeNotes: new ChangeNotes(),
  openWorkspace: (id) => openFrom("main", id),
  workspaceTitle,
  openFile: () => $("open-file").click(),
};

// The one undo history (step 20): whole-project snapshots, put back the way
// a file is opened, then every workspace on screen is mounted afresh on it.
ctx.history = createHistory({ capture: () => projectToJson(ctx.project), restore: restoreSnapshot });
/** Mounts in progress: a change a workspace makes while being mounted is a default filled in, not an undo step. */
let mounting = 0;
/**
 * The id of a new project started in place of the last one (skipped, or
 * Start fresh instead): kept from its first change on, not from the
 * defaults its workspaces fill in, so until then a reload opens the last one.
 */
let keepOnChange: string | null = null;
function projectChanged(label = "Edit", mergeKey?: string) {
  if (keepOnChange !== null && mounting === 0) keep(keepOnChange);
  autosave?.changed();
  if (mounting === 0) ctx.history.record(label, mergeKey);
}
/** Runs a show or mount; once the last one ends, takes whatever defaults the workspaces filled in into the present undo step. */
function mountingDone<T>(run: () => T): T {
  mounting++;
  try {
    return run();
  } finally {
    if (--mounting === 0) ctx.history.amend(); // ignored while an undo is putting a snapshot back
  }
}
/** Puts an undo snapshot back: read like an opened file, so a snapshot that doesn't read cleanly leaves everything as it was. */
function restoreSnapshot(text: string) {
  const project = projectFromJson(text, workspaces);
  ctx.project = project;
  pool.forgetAll(); // every warm workspace showed the project as it was
  show(current);
  if (split) mountSplit(split.id);
  autosave?.changed();
}

// The View group (SF3a): each view builds its own navigation bar
// (packages/viewport nav-bar.ts); the main one gets the id the e2e tests
// and the phone layout use.
$("viewport").querySelector<HTMLElement>(".view-controls")!.id = "view-controls";

// What is selected, read by the e2e test (17d draws it on screen).
ctx.selection.onChange((items) => (document.body.dataset.selection = items.map((r) => r.id).join(" ")));

// Change notes (X5): a strip over each pane's viewport shows the notes about
// the workspace in that pane (docs/integration.md, principle 9), redrawn
// after every change to the graph or the notes; × dismisses one. Notes
// about a workspace not on screen wait until it is shown.
function notesStrip(host: HTMLElement): HTMLElement {
  const strip = Object.assign(document.createElement("div"), { className: "notes-strip" });
  strip.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-dismiss]")?.dataset.dismiss;
    if (id) ctx.changeNotes.dismiss(id);
  });
  host.append(strip);
  return strip;
}
const notesStrips = { main: notesStrip($("viewport")), split: notesStrip($("split-viewport")) };
const drawn = new WeakMap<HTMLElement, string>();
/** Draws `notes` in `strip`, keeping open any "Why?" the user opened; nothing changes when nothing would. */
function drawNotes(strip: HTMLElement, notes: ChangeNote[]) {
  const html = notes.map(changeNote).join("");
  if (drawn.get(strip) === html) return;
  const open = [...strip.querySelectorAll("details[open]")].map((d) => d.closest<HTMLElement>("[data-note]")!.dataset.note!);
  strip.innerHTML = html;
  drawn.set(strip, html);
  for (const id of open) strip.querySelector(`[data-note="${CSS.escape(id)}"] details`)?.setAttribute("open", "");
}
let notesQueued = false;
/** Redraws both strips once the current change is finished (a Design edit changes the graph several times, then records). */
function showNotes() {
  if (notesQueued) return;
  notesQueued = true;
  queueMicrotask(() => {
    notesQueued = false;
    const notes = ctx.changeNotes.current(ctx.graph);
    drawNotes(notesStrips.main, notes.filter((n) => n.workspace === current));
    drawNotes(notesStrips.split, notes.filter((n) => n.workspace === split?.id));
  });
}
let stopWatching = () => {};
/** The graph and notes of the project now open; the strips follow both. */
function useGraph(graph: DependencyGraph, notes: ChangeNotes) {
  stopWatching();
  ctx.graph = graph;
  ctx.changeNotes = notes;
  const stops = [graph.onChange(showNotes), notes.onChange(showNotes)];
  stopWatching = () => stops.forEach((stop) => stop());
  showNotes();
}
useGraph(ctx.graph, ctx.changeNotes);
// For the browser test only (?test-hooks): the graph and notes, so it can
// stand in a result in another workspace before any workspace makes one;
// the main view's camera, to check navigation (SF3a); split view's second
// view, to check its camera and to break its "no 3D view" on purpose; how
// many bodies the kernel holds (the monkey tester's leak check); the
// kernel's WebAssembly memory and the viewport's counts (the soak test's);
// any kernel call, to run the kernel out of memory (e2e/kernel-restart.mjs).
if (new URLSearchParams(location.search).has("test-hooks"))
  Object.assign(window, {
    fissionTest: {
      get graph() {
        return ctx.graph;
      },
      get notes() {
        return ctx.changeNotes;
      },
      camera: () => viewer.main.cameraPose(),
      splitView: () => split?.view ?? null,
      bodyCount: () => kernel.call("body_count"),
      wasmBytes: () => kernel.call("wasm_bytes"),
      kernelCall: (op: Parameters<typeof kernel.call>[0], ...args: unknown[]) => (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args),
      gpu: () => viewer.memoryCounts(),
    },
  });

type Page = WorkspaceId | "community";
let current: Page = "design";

// Warm workspaces (X7). Each pane has four slots, found by id
// (#toolbar or #split-toolbar…; the timeline row along the bottom from
// SF3d); a workspace mounted in a pane gets four elements of its own that take the slots' place in the page while it is
// shown (same id, role and label, so the layout and :empty rules apply
// unchanged). Asleep, its elements are out of the page, kept as they are.
type PaneId = "main" | "split";
type Slots = Required<Pick<WorkspaceContext, "toolbar" | "browser" | "properties" | "timeline">>;
const SLOT_KEYS = ["toolbar", "browser", "properties", "timeline"] as const;
const SLOT_IDS: Record<PaneId, Record<keyof Slots, string>> = {
  main: { toolbar: "toolbar", browser: "browser", properties: "properties", timeline: "timeline" },
  split: { toolbar: "split-toolbar", browser: "split-browser", properties: "split-properties", timeline: "split-timeline" },
};
/** Puts `slots` in the page in place of whatever fills `pane`'s slots now. */
function placeSlots(pane: PaneId, slots: Slots) {
  for (const key of SLOT_KEYS) {
    const now = $(SLOT_IDS[pane][key]);
    if (now !== slots[key]) now.replaceWith(slots[key]);
  }
}
/**
 * Each pane's slots as the page first had them (an element's attributes, no
 * children). New slots copy these, never the slots on screen: a mark a
 * workspace put on its own slot (Design's folded properties, U0b) must not
 * reach the next one's (found by image.mjs: Image's panel opened folded).
 */
const PRISTINE: Record<PaneId, Slots> = {
  main: Object.fromEntries(SLOT_KEYS.map((key) => [key, $(SLOT_IDS.main[key]).cloneNode(false)])) as Slots,
  split: Object.fromEntries(SLOT_KEYS.map((key) => [key, $(SLOT_IDS.split[key]).cloneNode(false)])) as Slots,
};
/** Four empty slots shaped like `pane`'s as the page first had them. */
const emptySlots = (pane: PaneId): Slots => Object.fromEntries(SLOT_KEYS.map((key) => [key, PRISTINE[pane][key].cloneNode(false) as HTMLElement])) as Slots;
const pool = new WarmPool<WorkspaceId, PaneId, { slots: Slots; view: MountedWorkspace }>({
  mount(pane, id) {
    const slots = emptySlots(pane);
    placeSlots(pane, slots);
    const view = workspaces.find((w) => w.id === id)!.mount(paneCtx(pane, slots));
    return { slots, view };
  },
  sleep(pane, _id, { view }) {
    view.sleep?.();
    placeSlots(pane, emptySlots(pane));
  },
  wake(pane, _id, { slots, view }) {
    placeSlots(pane, slots);
    view.wake?.();
  },
  unmount: (_pane, _id, { view }) => view.unmount(), // asleep: its slots are already out of the page
});
// DESIGN ▾ (U0f2b): one button naming the page on screen, its menu the ten workspaces, in place of the tabs.
const markTab = workspaceSwitcher(
  $("workspaces"),
  workspaces.map((w) => ({ id: w.id, title: w.title, summary: w.summary, placeholder: w.status === "placeholder" })),
  (id) => show(id as WorkspaceId),
  { community: "Community" },
);

// The assistant (AI2): changes Design's part through Design's own run, as one undo step.
const assistant = createAssistant(
  $("assistant"),
  {
    history: ctx.history,
    project: () => ctx.project,
    design() {
      const where = pool.paneOf("design");
      return where && pool.showing(where) === "design" ? (pool.awake(where)?.view ?? null) : null;
    },
  },
  $("ai-status"),
);

function show(page: Page) {
  mountingDone(() => showPage(page));
}
function showPage(page: Page) {
  // Choosing the workspace that is in the second pane swaps the two panes.
  const swap = split?.id === page ? current : null;
  const workspace = workspaces.find((w) => w.id === page);
  if (workspace) pool.show("main", workspace.id);
  else {
    pool.hide("main"); // empty slots in its place
    showPlaceholder($("properties"), communityPage);
  }
  markTab(page);
  $("community").setAttribute("aria-pressed", String(page === "community"));
  document.body.dataset.activeWorkspace = page; // read by the e2e test
  current = page;
  if (swap) {
    if (swap === "community") closeSplit();
    else mountSplit(swap);
  }
  if (split) fillSplitChoice();
  showNotes();
  assistant.show(page, workspace?.title ?? "Community");
  if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
}

$("community").addEventListener("click", () => show("community"));

// Split view (X3): Split (over the viewport, wide screens only) puts a
// second workspace beside the first; the choice in its pane changes which;
// Close split, or a window too narrow for two, goes back to one. The
// second workspace gets slots of its own and a pane over a second view;
// the project, selection, history and registries are the first one's.
let split: { id: WorkspaceId; view: ViewportView; viewport: SharedViewport; settled: boolean; framed: boolean } | null = null;
const splitEntries = workspaces.map((w) => ({ id: w.id, title: w.title, placeholder: w.status === "placeholder" }));
const shownWorkspace = () => (current === "community" ? null : current);
/** What a workspace in `pane` sees: its own slots and that pane's viewport; the project, selection, history and registries are the one set. */
function paneCtx(pane: PaneId, slots: Slots): WorkspaceContext {
  return {
    get project() {
      return ctx.project;
    },
    set project(p) {
      ctx.project = p;
    },
    get graph() {
      return ctx.graph;
    },
    set graph(g) {
      ctx.graph = g;
    },
    get changeNotes() {
      return ctx.changeNotes;
    },
    set changeNotes(n) {
      ctx.changeNotes = n;
    },
    projectChanged: (label, mergeKey) => ctx.projectChanged(label, mergeKey),
    kernel: ctx.kernel,
    selection: ctx.selection,
    history: ctx.history,
    ...slots,
    viewport: pane === "main" ? ctx.viewport : split!.viewport,
    representations: ctx.representations,
    actions: ctx.actions,
    downstream: ctx.downstream,
    openWorkspace: (id) => openFrom(pane, id),
    workspaceTitle,
    openFile: ctx.openFile,
  };
}
/**
 * A workspace asked to open `id` (a downstream chip's click): with a split
 * open it goes in the other pane, beside the one that asked; otherwise it
 * replaces what is shown. Already on screen: nothing changes.
 */
function openFrom(asker: PaneId, id: WorkspaceId) {
  if (id === current || id === split?.id) return;
  if (split && asker === "main") mountSplit(id);
  else show(id);
}
function fillSplitChoice() {
  const select = $<HTMLSelectElement>("split-choice");
  select.replaceChildren(...splitChoices(splitEntries, shownWorkspace()).map((e) => new Option(e.title, e.id, false, e.id === split?.id)));
}
/** Shows workspace `id` in the second pane, opening the split if it is closed (the camera of an open one stays). */
function mountSplit(id: WorkspaceId) {
  mountingDone(() => mountSplitPane(id));
}
function mountSplitPane(id: WorkspaceId) {
  const workspace = workspaces.find((w) => w.id === id);
  if (!workspace) return;
  if (!split) {
    $("split").hidden = false;
    $("workspace").dataset.split = "on";
    $("workspace").classList.add("split-view"); // styles/split-view.css
    const view = viewer.addView($("split-viewport"));
    const viewport = pane(view);
    // The new view framed the body at home before the grid had settled its
    // size; frame it again once it has (the view's own resize runs first,
    // as its observer was registered first), or, while the pane shows no 3D
    // view (Image's 2D view, a placeholder), when a 3D workspace comes in.
    const settled = new ResizeObserver(([entry]) => {
      if (split?.view !== view) return settled.disconnect(); // closed before it settled: let the view go
      if (!entry || entry.contentRect.width === 0) return;
      settled.disconnect();
      split.settled = true;
      frameSplit();
    });
    settled.observe($("split-viewport"));
    split = { id, view, viewport, settled: false, framed: false };
  }
  split!.id = id;
  pool.show("split", id);
  showSoon(workspace);
  document.body.dataset.split = id; // read by the e2e test
  $("split-toggle").setAttribute("aria-pressed", "true");
  fillSplitChoice();
  showNotes();
}
/**
 * A workspace not built yet gets no 3D view in the second pane: the view
 * stops drawing (its camera kept for the next workspace there) and the
 * pane shows its name and "Coming soon" with what its page says it will
 * do; a working workspace gets the view back.
 */
function showSoon(workspace: WorkspacePlugin) {
  const soon = $("split-viewport").querySelector<HTMLElement>(".split-soon")!;
  const placeholder = workspace.status === "placeholder";
  split!.view.setDrawing(!placeholder);
  $("workspace").dataset.splitPane = placeholder ? "placeholder" : "workspace";
  soon.hidden = !placeholder;
  if (!placeholder) {
    frameSplit();
    return soon.replaceChildren();
  }
  const page = $("split-properties").querySelector(".placeholder");
  if (page) soon.replaceChildren(page.cloneNode(true));
  else soon.innerHTML = `<div class="placeholder"><h2></h2><p class="coming-soon">Coming soon</p></div>`;
  if (!page) soon.querySelector("h2")!.textContent = workspace.title;
}
/** Frames the second view at home once, the first time it shows in 3D at its settled size. */
function frameSplit() {
  if (!split || split.framed || !split.settled) return;
  const { dataset } = split.view.element;
  if (dataset.image !== undefined || dataset.drawing === "off") return;
  split.view.fit();
  split.framed = true;
}
function closeSplit() {
  if (!split) return;
  activePane = "main";
  pool.forgetPane("split"); // its viewport goes
  viewer.removeView(split.view);
  split = null;
  $("split").hidden = true;
  $("workspace").dataset.split = "off";
  $("workspace").classList.remove("split-view");
  delete $("workspace").dataset.splitPane;
  const soon = $("split-viewport").querySelector<HTMLElement>(".split-soon")!;
  soon.hidden = true;
  soon.replaceChildren();
  document.body.dataset.split = "";
  $("split-toggle").setAttribute("aria-pressed", "false");
  showNotes();
}
{
  const toggle = Object.assign(document.createElement("button"), { id: "split-toggle", type: "button", textContent: "Split", title: "Show a second workspace beside this one" });
  toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", () => {
    if (split) return closeSplit();
    const id = defaultSplit(splitEntries, shownWorkspace())?.id;
    if (id) mountSplit(id);
  });
  $("viewport").append(toggle);
  $("split-choice").addEventListener("change", () => mountSplit($<HTMLSelectElement>("split-choice").value as WorkspaceId));
  $("split-close").addEventListener("click", () => {
    closeSplit();
    toggle.focus();
  });
  $("workspace").dataset.split = "off";
  // A half-width toolbar scrolls sideways (styles/split-view.css): the
  // mouse wheel scrolls it too, as a wheel has no sideways turn.
  $("workspace").addEventListener(
    "wheel",
    (e) => {
      const bar = (e.target as Element).closest<HTMLElement>(".split-view #toolbar, .split-view #split-toolbar");
      if (!bar || e.deltaX !== 0 || e.deltaY === 0 || bar.scrollWidth <= bar.clientWidth) return;
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  const wide = matchMedia(`(min-width: ${SPLIT_MIN_WIDTH_PX}px)`);
  wide.addEventListener("change", () => {
    if (!wide.matches) closeSplit();
  });
}

// At phone width AI, Guide and Community fold behind Menu (theme.css),
// leaving the top bar's row to File ▾ and the workspace button. Choosing one,
// Escape or a tap anywhere else closes it; Escape puts focus back on Menu.
{
  const toggle = $("menu-toggle");
  const setMenu = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    $("topbar").dataset.menu = open ? "open" : "closed";
  };
  setMenu(false);
  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  $("topbar-actions").addEventListener("click", () => setMenu(false)); // after the chosen button's own handler
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
    // Menu's Escape is its own, as every menu's is (menu-button.ts): the shortcut table below never also cancels the sketch's plane prompt.
    e.preventDefault();
    e.stopImmediatePropagation();
    setMenu(false);
    toggle.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!(e.target instanceof Node) || toggle.contains(e.target) || $("topbar-actions").contains(e.target)) return;
    setMenu(false);
  });
}

// Autosave (19c): the project is kept in this browser and saved a moment
// after each change; the top bar says "Saving…", "Saved" or what went wrong.
// Each project has its own stored id: an opened file becomes a new stored
// project rather than overwriting the one that was open.
const store = localStore(workspaces);
/** The browser's localStorage, or null when storage is turned off (then the guard and the journal keep nothing). */
const local = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
// Marks the project being opened, so one that froze or crashed the tab isn't
// reopened on the next visit (audit S2, reopen.ts in @fission/storage). The
// tabs ask each other over a channel, so a tab started while another is still
// opening the project doesn't take that for a freeze (real-use hunt A3).
const guard = reopenGuard(local, {
  channel: (() => {
    try {
      return new BroadcastChannel(OPENING_KEY) as OpeningChannel; // its MessageEvent carries the `data` the guard reads
    } catch {
      return null; // no channel: a mark found is taken for a freeze, as before
    }
  })(),
});
window.addEventListener("pagehide", () => guard.finished());
// A phone locked or the app switched: the OS may kill the tab later with no pagehide (real-use hunt D1).
document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? guard.putAway() : guard.back()));
document.addEventListener("freeze", () => guard.putAway());
document.addEventListener("resume", () => guard.back());
let autosave: Autosave | null = null;
// Leaving (timeline hunt, finding 1): when the page is hidden, reloaded or
// closed, the changes not stored yet go to the unsaved-changes journal at
// once (unsaved.ts), and are put back on the next visit; the store's save
// starts too. Only when the journal can't be written (storage off or full)
// does the page ask before going, and only while a change waits, so a saved
// page never asks and stays fit for the back/forward cache.
const leaving = () => autosave?.leaving() ?? true;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") leaving();
});
window.addEventListener("pagehide", leaving);
function askBeforeLeaving(e: BeforeUnloadEvent) {
  if (leaving()) return;
  e.preventDefault();
  e.returnValue = ""; // older browsers ask only when this is set
}
const saveStatus = (s: AutosaveStatus) => {
  const el = $("save-status");
  el.dataset.state = s.state; // read by the e2e test
  el.textContent = s.state === "saving" ? "Saving…" : s.state === "saved" ? "Saved" : `Not saved: ${s.message}`;
  el.title = el.textContent; // the words behind the mark at phone width
  if (s.state === "saved") window.removeEventListener("beforeunload", askBeforeLeaving);
  else window.addEventListener("beforeunload", askBeforeLeaving);
};
/**
 * After the first save of the user's own work (an edit, or a file opened), asks the browser not to clear the kept
 * projects when space runs low (real-use hunt B3). Never on load: the empty project a first visit stores is no work.
 */
const askToKeepStorage = keepStorage(globalThis.navigator?.storage);
/** A file has been opened in this tab (its first save is the user's work, with nothing to undo). */
let openedFile = false;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
/** False once the browser has shown it can't keep projects: then nothing autosaves, and Save/Open use files. */
let canKeep = true;
/**
 * Keeps the open project in the store under `id` from now on; `stored` when it was just opened from there as it is,
 * stored at `storedAt`: a save after another tab stored it since is refused and says so (app sweep, finding 2).
 */
function keep(id: string, stored = false, storedAt: Date | null = null, fromKept = false) {
  keepOnChange = null;
  autosave?.finish();
  if (!canKeep) return;
  // Following the undo history: an amend (a face sketch settled, a pinned point followed once the kernel answers) is a
  // change no one records, and it can come after the edit was stored (hunt 26h). One that changes nothing (the history
  // started afresh on a reopened project) is not.
  autosave = startAutosave(store, id, () => ctx.project, (s) => (s.state === "saved" && (openedFile || ctx.history.canUndo()) && askToKeepStorage(), saveStatus(s)), { journal: local, follows: ctx.history, stored, storedAt, fromKept });
  document.body.dataset.projectId = id; // read by the e2e test
}
/** A new project in place of the last one, kept once it is changed (`keepOnChange`). */
function keepOnFirstChange() {
  autosave?.finish(); // the last project keeps a change made within the quiet moment
  autosave = null;
  keepOnChange = newId();
}

// Save and Open: the whole project, every workspace's data, as one
// .spindle file (docs/project-format.md). Opening replaces the project
// only once all of it has read cleanly; a refused file leaves the open
// project as it was and says why.
const fileStatus = (message: string) => ($("file-status").textContent = message);
$("file-dismiss").addEventListener("click", () => fileStatus(""));
/** The file the project was last saved to (the save picker's), so Save writes it again without asking; Save As and a new or opened project let it go. */
let savedTo: FileHandle | null = null;
async function save(asNew = false) {
  try {
    await started; // the project shown, not the empty one the app starts with
    const result = await saveFile(document, { suggestedName: ctx.project.name || "Untitled", kind: PROJECT_KIND, bytes: projectToJson(ctx.project), handle: asNew ? null : savedTo });
    if (result.status === "failed") return fileStatus(result.message);
    if (result.status === "saved") savedTo = result.handle;
    fileStatus("");
  } catch (e) {
    fileStatus(e instanceof Error ? e.message : String(e));
  }
}
const SAVE_TITLE = $("save").title;
withIcon($("save"), "save"); // its word kept as its name, out of sight (styles/app-bar.css)
$("save").addEventListener("click", () => void save());
const SAVE_AS_TITLE = "Save As…: save the whole project under a name and in a place you choose";
// Open takes what a drop or paste takes (X6): every format with an importer,
// routed by its contents, so a PNG opens in Image and a project as a project.
$<HTMLInputElement>("open-file").accept = FILE_FORMATS.filter((f) => representations.importerFor(f.format))
  .flatMap((f) => (f.format === "project" ? [".spindle", ".json"] : f.extensions))
  .join(",");
const OPEN_TITLE = `Open ${FILE_FORMATS.filter((f) => representations.importerFor(f.format)).map((f) => f.many).join(", ")}`;
// File ▾ (U0f2a), first on the bar as in Fusion: New and the exports are
// the workspace's in use (the pane last clicked, as for keys), Open and
// Save the shell's. Save also stays one click, as the icon beside it.
const file = fileMenu(document, {
  open: { id: "open", label: "Open…", title: OPEN_TITLE, run: () => $("open-file").click() },
  save: { id: "file-save", label: "Save", title: SAVE_TITLE, run: () => void save() },
  saveAs: { id: "file-save-as", label: "Save As…", title: SAVE_AS_TITLE, run: () => void save(true) },
  where: () => {
    const id = panesInUse().map((p) => pool.showing(p))[0];
    return id ? workspaceTitle(id) : "Community";
  },
  entries: () => {
    for (const p of panesInUse()) {
      const entries = pool.awake(p)?.view.fileEntries?.();
      if (entries) return entries;
    }
    return null;
  },
});
$("file-bar").prepend(file.element);
/** Puts `project` in place of the open one: every workspace mounted afresh on it, nothing to undo. */
function replaceProject(project: Project) {
  savedTo = null; // the file belonged to the old project
  ctx.selection.clear(); // it named the old part's faces
  ctx.project = project;
  useGraph(new DependencyGraph(), new ChangeNotes()); // the old notes were about the old project
  pool.forgetAll(); // every warm workspace showed the old project
  show(current); // mounts the workspace on the new project
  if (split) mountSplit(split.id); // and the second one
  ctx.history.reset(); // a new start: nothing from the old project to undo
}
/**
 * Replaces the open project with the one in `text`; throws, leaving the
 * open project as it was, when it doesn't read cleanly. The opened file is
 * kept in this browser only once it has shown (security audit S2): one that
 * freezes the tab while it builds is never stored, so never reopened.
 */
function openProject(text: string) {
  const project = projectFromJson(text, workspaces);
  // A file already kept here as it is (opened before, unchanged since) goes on under its stored id, not as one more
  // copy no one can reach (real-use hunt B3). Looked up while it opens; a store that can't answer means a new copy.
  const copy = canKeep ? storedCopy(store, project).catch(() => undefined) : Promise.resolve(undefined);
  // The old project is kept as it was, its last change too (finish, not stop: one made within the quiet moment
  // before Open was dropped, timeline hunt follow-up); nothing of the new one is stored yet.
  autosave?.finish();
  autosave = null;
  guard.finished(); // the last project, if it was still opening, didn't freeze the tab
  fileStatus("");
  replaceProject(project);
  const ticket = whileOpening(OPENING_FILE, () =>
    void copy.then((found) => {
      if (ticket !== openings) return; // another opening, or Start fresh, since
      // Its first save writes it (so it is the project a reload opens), checking no other tab changed the copy since.
      openedFile = true;
      keep(found?.id ?? newId(), false, found?.modified ?? null);
      autosave?.changed(); // store the opened file, with anything changed while it opened
    }),
  );
}

// While a project opens (the last one reopened, or a file), the top bar
// offers to start a new one instead once it has taken OFFER_MS, so a big
// project that takes long to build is never a wait with no way out
// (security audit S2). The project being opened is then never kept (a
// file) or counted as reopened (the last one, still kept as it was).
const OFFER_MS = 1500;
const OPENING_LAST = "Opening the last project…";
const OPENING_FILE = "Opening the project…";
/** Counts openings: Start fresh, or another opening, ends the wait for the one before. */
let openings = 0;
/** What is being opened while the offer stands. */
let openingNow: string | null = null;
/** Settles once every workspace on screen has shown the project (each one's `ready`). */
const shownOnScreen = () => Promise.all((["main", "split"] as const).map((p) => pool.awake(p)?.view.ready)).then(() => {});
/** Returns the opening's ticket: `openings` moves past it once another opening, or Start fresh, ends its wait. */
function whileOpening(words: string, opened: () => void) {
  const ticket = ++openings;
  const offer = setTimeout(() => {
    if (ticket !== openings) return;
    openingNow = words;
    fileStatus(words);
    $("opening-fresh").hidden = false;
  }, OFFER_MS);
  void shownOnScreen().then(() => {
    clearTimeout(offer);
    if (ticket !== openings) return;
    endOffer();
    opened();
  });
  return ticket;
}
/** Takes the offer away, and its words if nothing has replaced them. */
function endOffer() {
  $("opening-fresh").hidden = true;
  if (openingNow !== null && $("file-status").textContent === openingNow) fileStatus("");
  openingNow = null;
}
$("opening-fresh").addEventListener("click", () => {
  const was = openingNow;
  openings++; // the project being opened is never kept or counted as reopened
  endOffer();
  guard.finished(); // the last project didn't freeze the tab: the next visit opens it as before
  keepOnFirstChange(); // first: the last project's autosave must not store the new one over it
  replaceProject(emptyProject());
  fileStatus(
    was === OPENING_LAST
      ? "Started a new project instead. The last one is still kept in this browser: reload the page, before changing anything, to try it again."
      : "Started a new project instead. The file was not opened: open it again to try again.",
  );
});
$("open-file").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("open-file");
  const file = input.files?.[0];
  input.value = ""; // so choosing the same file again opens it again
  if (file) await receive([file]);
});

// Files from outside (X6): a file dropped anywhere on the app, or pasted
// (outside a text field), goes through the representation registry: a
// project opens as Open does, a PNG or JPEG opens in Image, and anything
// else is refused in the top bar with what will take it and when. A file
// for a workspace not on screen asks first ("Open in Image?"; the owner's
// ask, 2026-10-28): Cancel opens nothing and leaves you where you were.
const elsewhere = openElsewhere(document);
async function receive(files: File[]) {
  await started; // or the project being reopened would replace what this opens
  const heads = await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, head: new Uint8Array(await f.slice(0, HEAD_BYTES).arrayBuffer()) })));
  const route = routeFiles(representations, heads);
  if (!route) return;
  if (route.kind === "refused") return fileStatus(route.message);
  const file = files[0];
  const target = route.importer.workspace;
  if (target && pool.showing("main") !== target && pool.showing("split") !== target) {
    const here = pool.showing("main");
    if (!(await elsewhere.ask(file.name, formatInfo(route.format).one, workspaceName(target), here ? workspaceName(here) : null))) return;
  }
  try {
    await route.importer.open(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return fileStatus(`Couldn't open “${file.name}”: ${e instanceof Error ? e.message : String(e)}`);
  }
  fileStatus("");
  const into = route.importer.workspace;
  if (!into) return; // the shell itself (a project) has already shown it
  pool.forget(into); // mounted afresh, to show what it opened
  if (split?.id === into) mountSplit(into); // where it already is
  else show(into);
}
const carriesFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
const dropHint = (on: boolean) => {
  document.body.dataset.drop = on ? "on" : ""; // read by the e2e test
  $("workspace").classList.toggle("file-drop", on); // the outline (styles/file-drop.css)
};
window.addEventListener("dragover", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault(); // allows the drop
  e.dataTransfer!.dropEffect = "copy";
  dropHint(true);
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropHint(false); // left the window
});
window.addEventListener("drop", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault(); // never let the browser navigate to the file
  dropHint(false);
  void receive([...e.dataTransfer!.files]);
});

// One shortcut table (X7b): the shell's keys and every workspace's. A key
// goes to the workspace in the pane last clicked or focused, then the other
// one on screen, then the shell; a sleeping workspace never hears one.
// Copy, cut and paste come from the clipboard events, so the browser's Edit
// menu runs them too. Keys are left alone while typing in a field, unless a
// shortcut says otherwise.
const shortcuts = new ShortcutTable(SHELL_SHORTCUTS, workspaces);
for (const c of shortcuts.clashes()) console.error(`Shortcut clash: ${c.message}`); // a unit test keeps this empty
let activePane: PaneId = "main";
for (const type of ["pointerdown", "focusin"] as const)
  document.addEventListener(type, (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest("#split")) activePane = "split";
    else if (e.target.closest("#workspace")) activePane = "main";
  }, true);
/** The panes showing a workspace, the one in use first. */
const panesInUse = (): PaneId[] => (activePane === "split" ? ["split", "main"] : ["main", "split"]).filter((p): p is PaneId => pool.showing(p as PaneId) !== null);
/** Typing in a field: a text box, text area, list or editable text. A tickbox, radio or button takes no letters, so keys still reach the shortcuts after one is clicked (found in SF1: ticking Snap to grid stopped L, R, C and A). */
const TEXT_FIELDS = "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file]), textarea, select, [contenteditable]:not([contenteditable=false])";
const inText = (t: EventTarget | null) => t instanceof Element && t.closest(TEXT_FIELDS) !== null;
const shellShortcuts: Record<string, (e: Event) => boolean> = {
  shortcuts: () => (showShortcuts(), true),
  undo: () => (undoRedo("undo"), true),
  redo: () => (undoRedo("redo"), true),
  "redo-y": () => (undoRedo("redo"), true),
  "paste-files": (e) => {
    const files = [...((e as ClipboardEvent).clipboardData?.files ?? [])];
    if (files.length === 0) return false; // text pastes as usual
    void receive(files);
    return true;
  },
};
function runShortcut(chord: Chord, e: Event) {
  // Every dialog the app opens is modal (the key list, the guide, Design's item menu and its questions): while one is
  // open no shortcut runs, so Escape is the dialog's own and the browser closes it, wherever the focus went
  // (timeline hunt, finding 13: the item menu stayed open once the focus had left it).
  if (document.querySelector("dialog[open]")) return;
  const panes = panesInUse();
  const entry = shortcuts.lookup(chord, panes.map((p) => pool.showing(p)!));
  if (!entry || (!entry.inText && inText(e.target))) return;
  const done = entry.scope === "app" ? shellShortcuts[entry.id]?.(e) : pool.awake(panes.find((p) => pool.showing(p) === entry.scope)!)?.view.shortcut?.(entry.id, e);
  if (done !== false && done !== undefined) e.preventDefault();
}
const clipboardChords = new Set<string>(Object.values(CLIPBOARD_CHORDS));
document.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  const chord = chordOf(e);
  if (chord && !clipboardChords.has(chord)) runShortcut(chord, e);
});
for (const type of ["copy", "cut", "paste"] as const) document.addEventListener(type, (e) => runShortcut(CLIPBOARD_CHORDS[type], e));
// The list of every key (?), the workspaces on screen first. No top-bar button:
// the bar has no room left for one at 1280 px (the wide-screen smoke check).
const shortcutDialog = Object.assign(document.createElement("dialog"), { id: "shortcuts", className: "shortcut-list" });
shortcutDialog.setAttribute("aria-labelledby", "shortcuts-title");
document.body.append(shortcutDialog);
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
function showShortcuts() {
  const groups = shortcuts.help(panesInUse().map((p) => pool.showing(p)!)).map((g) => ({
    title: g.scope === "app" ? "Everywhere" : workspaceTitle(g.scope),
    onScreen: g.onScreen,
    rows: g.entries.map((e) => ({ keys: chordLabel(e.chord, mac), label: e.label })),
  }));
  shortcutDialog.innerHTML = `<header><h2 id="shortcuts-title">Keyboard shortcuts</h2><button type="button" class="close">Close</button></header>${shortcutList(groups)}`;
  shortcutDialog.querySelector(".close")!.addEventListener("click", () => shortcutDialog.close());
  shortcutDialog.showModal();
}
// Settings: a card dialog of sections (@fission/ui settings.ts), kept in this
// browser alone. Close, Escape and a tap outside the card all leave it.
const settingsDialog = Object.assign(document.createElement("dialog"), { id: "settings", className: "settings" });
settingsDialog.setAttribute("aria-labelledby", "settings-title");
document.body.append(settingsDialog);
let browserSettings: SettingsStore | null = null;
const settings = () => (browserSettings ??= new SettingsStore(local));
$("settings-open").addEventListener("click", () => {
  settings(); // read once now, so the first real setting has its place
  fillSettings(settingsDialog, { version: $("version").textContent ?? "", onShortcuts: showShortcuts });
  settingsDialog.showModal();
});
settingsDialog.addEventListener("click", (e) => {
  if (e.target === settingsDialog) settingsDialog.close(); // the backdrop belongs to the dialog element
});
// Undo and Redo (step 20b): the top bar's buttons and the keys above. Each
// button says what it would take back or do again, and is off when there is
// nothing; a snapshot that can't be put back says why and moves nothing.
function undoRedo(which: "undo" | "redo") {
  try {
    ctx.history[which]();
  } catch (e) {
    return fileStatus(`Couldn't ${which}: ${e instanceof Error ? e.message : String(e)}`);
  }
  ctx.history.amend(); // defaults the remounted workspaces filled in
}
function showUndoRedo() {
  const buttons = [
    ["undo", "Undo", ctx.history.undoLabel(), "Mod+Z"],
    ["redo", "Redo", ctx.history.redoLabel(), "Mod+Shift+Z"],
  ] as const;
  for (const [id, verb, label, chord] of buttons) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = label === null;
    b.title = label === null ? `Nothing to ${id}` : `${verb} ${label} (${chordLabel(chord, mac)})`;
  }
}
// At phone width the pair leaves the bar for the main viewport's
// bottom-right corner, across from the View buttons (step 20c): one tap, by
// the thumb, beside the part it changes; the bar keeps its room for the
// workspace button. Wider screens keep it on the bar after Save, as Fusion.
const phone = matchMedia("(max-width: 640px)");
function placeUndoRedo() {
  const pair = $("undo-redo");
  pair.classList.toggle("docked", phone.matches);
  // Before the View buttons in the page: its top is higher, so keyboard focus still moves down the screen.
  if (phone.matches) $("view-controls").before(pair);
  else $("save").after(pair);
}
phone.addEventListener("change", placeUndoRedo);
placeUndoRedo();
for (const id of ["undo", "redo"] as const) $(id).append(iconSvg(document, id)); // named by aria-label
$("undo").addEventListener("click", () => undoRedo("undo"));
$("redo").addEventListener("click", () => undoRedo("redo"));
ctx.history.onChange(showUndoRedo);
showUndoRedo();
// AI, Guide and Community, small at the bar's right (styles/app-bar.css).
withIcon($("assistant-toggle"), "ai", 16);
withIcon($("guide-open"), "guide", 16);
withIcon($("community"), "community", 16);
withIcon($("settings-open"), "settings", 16);
// One assistant panel for every workspace, beside the viewport.
const setAssistant = (open: boolean) => {
  const panel = $("assistant");
  if (!!panel.hidden !== open) return;
  panel.hidden = !open;
  $("assistant-toggle").setAttribute("aria-pressed", String(open));
  document.body.classList.toggle("assistant-narrow", open); // styles/assistant-narrow.css
  if (open) assistant.opened();
};
$("assistant-toggle").addEventListener("click", () => {
  const open = !!$("assistant").hidden;
  // At phone width the panel is a sheet over the view like the other two (styles/phone-sheet.css): one at a time.
  if (open && window.matchMedia("(max-width: 640px)").matches) for (const slot of ["browser", "properties"]) $(`${slot}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
  setAssistant(open);
});
// At phone width the browser and properties fold away behind two toggles
// (theme.css hides a closed one there); wider screens hide the toggles and
// show both panels. The state lives on #workspace, so it survives switching.
for (const slot of ["browser", "properties"] as const) {
  const toggle = $(`${slot}-toggle`);
  const set = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    $("workspace").dataset[slot] = open ? "open" : "closed";
  };
  set(toggle.getAttribute("aria-expanded") === "true");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    // At phone width each opens as a sheet over the view (styles/phone-sheet.css): one at a time.
    if (open) for (const other of ["browser", "properties"] as const) if (other !== slot) $(`${other}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
    if (open && window.matchMedia("(max-width: 640px)").matches) setAssistant(false);
    set(open);
  });
  toggle.addEventListener("sheet-close", () => set(false));
}
// At phone width what a tool asks for lives in the Properties sheet, so the sheet opens when it appears
// (Edit feature, Move's boxes once a body is picked: without the sheet open they are out of reach; not the plane prompt or
// Extrude's box: the bar over the view, phone-float.ts, holds the planes, Finish and Cancel) and closes again, if it opened it, when
// that is done, leaving the view clear to draw in; as the folded panel opens for a tool's box on a wide screen.
{
  const toggle = $("properties-toggle");
  const phone = window.matchMedia("(max-width: 640px)");
  let wanted = false;
  let opened = false;
  // `turned`: the screen just became phone width (a sketch started sideways, then the phone turned upright), so a prompt already up is shown.
  const update = (turned: boolean) => {
    const props = $("properties"); // a workspace's mount replaces the slot, so it is looked up each time
    const now = props.querySelector<HTMLElement>("#feature-edit:not([hidden])") !== null || props.querySelector("#move-panel:not([hidden]) #move-bodies:not([hidden])") !== null;
    if (now === wanted && !(turned && now)) return;
    wanted = now;
    const open = toggle.getAttribute("aria-expanded") === "true";
    if (now && phone.matches && !open) {
      toggle.click();
      opened = true;
      // The panel's first box took the keys while the sheet was still closed (nothing hidden is focused): give them again.
      const give = () => $("properties").querySelector<HTMLElement>("#feature-edit:not([hidden]) input")?.focus();
      give();
      // WebKit and Firefox lay the sheet out a frame later, and the row menu that chose Edit feature gives the focus back to
      // its opener (in the sheet just put away) as it closes, which WebKit can leave on the opener rather than the page:
      // try again until the focus is inside the panel (a tap on one of its boxes puts it there for good).
      for (const ms of [0, 50, 100, 200, 300, 500, 800]) setTimeout(() => !$("properties").querySelector("#feature-edit:not([hidden])")?.contains(document.activeElement) && give(), ms);
    } else if (!now && opened && open) {
      toggle.click();
      opened = false;
    } else if (!now) opened = false;
  };
  phone.addEventListener("change", () => phone.matches && update(true));
  new MutationObserver(() => update(false)).observe($("workspace"), { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
}
// At phone width the bar over the view (phone-float.ts) ends the tool in use; a tool ending puts the Properties sheet away.
startPhoneFloat($("workspace"), $("viewport"), () => {
  if (window.matchMedia("(max-width: 640px)").matches) $("properties-toggle").dispatchEvent(new CustomEvent("sheet-close"));
});
// Body facts (Inspect ▾) shows the numbers in the Properties sheet, which at phone width stays shut unless asked (demo rehearsal 10-28).
$("workspace").addEventListener("properties-reveal", () => {
  const toggle = $("properties-toggle");
  if (window.matchMedia("(max-width: 640px)").matches && toggle.getAttribute("aria-expanded") !== "true") toggle.click();
});
// A press in the view outside a sheet puts the sheet away (a tap on the part beside it is the way out; the toggles still work).
{
  const phone = window.matchMedia("(max-width: 640px)");
  $("workspace").addEventListener("pointerdown", (e) => {
    if (!phone.matches || !(e.target instanceof Element) || !e.target.closest("#viewport") || e.target.closest("#phone-float")) return; // the bar over the view ends a tool, which puts the sheet away itself
    for (const slot of ["browser", "properties"]) {
      const toggle = $(`${slot}-toggle`);
      if (toggle.getAttribute("aria-expanded") === "true") toggle.click();
    }
    setAssistant(false);
  });
}
// Dragging a sheet down by its handle puts it away too (src/sheet-drag.ts).
sheetDrag(document, window.matchMedia("(max-width: 640px)"), (sheet) => {
  if (sheet.id === "assistant") setAssistant(false);
  else $(`${sheet.id}-toggle`).dispatchEvent(new CustomEvent("sheet-close"));
});
const pages: string[] = [...workspaces.map((w) => w.id), "community"];
const fromHash = (): Page => {
  const id = location.hash.slice(1);
  return pages.includes(id) ? (id as Page) : "design";
};
// Links (and back/forward) can name a workspace: #design, #slice, …
window.addEventListener("hashchange", () => show(fromHash()));
// Start on the project saved most recently in this browser, or a new one.
// One that can't be read is left stored as it is, and a new project starts
// with a message saying so; so does one the last visit started opening and
// never finished (it froze or crashed the tab), once: the visit after tries
// it again. A browser that can't keep projects at all still gets a working
// app (Save and Open use files). Never a blank app: storage that doesn't
// answer within STORAGE_ANSWER_MS is taken as failing (blind spots B2b: an
// IndexedDB that never answered left the app blank for good).
async function start() {
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const answered = <T>(asked: Promise<T>) =>
    Promise.race([asked, new Promise<never>((_, refuse) => setTimeout(() => refuse(new Error("browser storage didn't answer")), STORAGE_ANSWER_MS))]);
  let newest: string | undefined;
  let newestAt: Date | null = null;
  try {
    // Changes the last visit left with before they were stored go back first, so the project reopens with them.
    const unsaved = await answered(recoverUnsaved(store, local, workspaces));
    if (unsaved.length > 0) fileStatus(`${unsaved.join(". ")}.`.replace(/^./, (c) => c.toUpperCase()));
    const top = (await answered(store.list()))[0];
    newest = top?.id;
    newestAt = top && !top.problem ? top.modified : null; // a summary that can't be read gives no save time to expect
  } catch (e) {
    canKeep = false;
    fileStatus(`Projects can't be kept in this browser (${why(e)}). Use Save to keep your work as a file.`);
    show(fromHash());
    return ctx.history.reset();
  }
  let opened: string | undefined;
  try {
    if (newest && (await guard.check(newest))) {
      keepOnFirstChange();
      fileStatus("The last project didn't finish opening on your last visit, so a new one was started. The old one is still kept in this browser: reload the page now, before changing anything, to try it again.");
    } else if (newest) {
      guard.opening(newest);
      // Its newest state, when the store had no room for it (storage full): kept in the journal, and what the user
      // last saw, so it is what opens and what Save writes (real-use hunt B1). Its autosave stores it once it can.
      const kept = keptEntry(local, newest);
      ctx.project = kept === null ? await answered(store.open(newest)) : projectFromJson(kept, workspaces);
      keep(newest, kept === null, newestAt, kept !== null);
      saveStatus(kept === null ? { state: "saved" } : { state: "error", message: "this browser's storage had no room for your latest changes. They're kept until it has, and Save keeps them as a file." });
      opened = newest;
    } else keep(newId());
  } catch (e) {
    guard.finished(); // refused with a message, which is not a freeze
    keepOnFirstChange(); // stored only once changed, so a reload tries the old one again (real-use hunt A1)
    fileStatus(`Couldn't open the last project (${why(e)}), so a new one was started. The old one is still kept in this browser.`);
  }
  show(fromHash());
  // Counted as reopened once it has shown: a tab that freezes building it leaves the mark.
  if (opened) whileOpening(OPENING_LAST, () => guard.shown(opened));
  ctx.history.reset(); // the project as it opened is the start
}
// Save, Open, a drop and a paste wait for this: until the last project is
// open, ctx.project is the empty one the app starts with.
const started = start();
ctx.kernel.call("kernel_version").then((v) => {
  $("version").textContent = `kernel v${v}`;
  $("version").parentElement!.title = `SpindleLabs, kernel v${v}`; // where the version shows when the bar has no room for it
}, () => {}); // a kernel that didn't start says so where the part would be (Design's error line), not as an uncaught error

// Offline mode: the service worker keeps this build for use with no connection, and offers a new one when it ships.
startOffline();
