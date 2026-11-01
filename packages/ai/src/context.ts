// What the AI is told about the project: a compact, structured summary,
// never raw geometry. Small enough for small local models; larger
// providers can ask for more detail.

import type { DependencyGraph, Feature, Project, WorkspaceId } from "@fission/core";

export interface AIContext {
  workspace: WorkspaceId;
  units: string;
  /** Selected items by stable id, with their intent. Empty until selection exists (step 17). */
  selection: { id: string; intent?: string }[];
  /** Every timeline feature of every workspace: id, intent and parameters, and whether it is after its timeline's marker (rolled back, so not built; 25c3). */
  features: { workspace: string; id: string; summary: string; parameters: Feature["intent"]["parameters"]; suppressed: boolean; afterMarker: boolean }[];
  materials: string[];
  /** Recent errors and failed features, newest first. */
  errors: string[];
  /** What is out of date, and what depends on the selection (for "what breaks if I change this?"). */
  graph: { stale: string[]; dependsOnSelection: string[] };
}

export interface ContextOptions {
  workspace: WorkspaceId;
  graph: DependencyGraph;
  selection?: string[];
  errors?: string[];
  /** "small" (default) keeps it short for small local models. */
  detail?: "small" | "large";
}

const LIMITS = { small: { features: 20, errors: 3 }, large: { features: 500, errors: 20 } };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
/** An item shaped as a timeline feature: an id, an intent with a summary. */
const isFeature = (f: unknown): f is Feature => isRecord(f) && typeof f.id === "string" && isRecord(f.intent) && typeof f.intent.summary === "string";

/** The context for one request. */
export function buildContext(project: Project, o: ContextOptions): AIContext {
  const limit = LIMITS[o.detail ?? "small"];
  const features: AIContext["features"] = [];
  for (const [workspace, data] of Object.entries(project.workspaces)) {
    const timeline = (data as { timeline?: { features?: Feature[]; marker?: string } } | null | undefined)?.timeline;
    // A workspace this build has no reader for keeps its data as the file had it (core's projectFromJson): only the
    // items shaped as features are described (real-use hunt S7: a render timeline holding null threw here).
    const list = (Array.isArray(timeline?.features) ? timeline.features : []).filter(isFeature);
    // The marker names the last item built, or "start" when none is; left out, every item is built (docs/project-format.md).
    const end = timeline?.marker === undefined ? list.length : timeline.marker === "start" ? 0 : list.findIndex((f) => f.id === timeline.marker) + 1;
    for (const [i, f] of list.entries()) features.push({ workspace, id: f.id, summary: f.intent.summary, parameters: f.intent.parameters, suppressed: f.suppressed, afterMarker: i >= end });
  }
  const selection = o.selection ?? [];
  const byId = new Map(features.map((f) => [f.id, f.summary]));
  return {
    workspace: o.workspace,
    units: project.units.length,
    selection: selection.map((id) => ({ id, intent: byId.get(id) })),
    // Most recent features last in a timeline: keep the end when trimming.
    features: features.slice(-limit.features),
    materials: project.materials.flatMap((m) => (typeof m?.name === "string" ? [m.name] : [])), // a draft: a name may be missing (real-use hunt S7)
    errors: (o.errors ?? []).slice(0, limit.errors),
    graph: { stale: o.graph.stale(), dependsOnSelection: [...new Set(selection.flatMap((id) => (o.graph.has(id) ? [...o.graph.downstreamOf(id)] : [])))] },
  };
}
