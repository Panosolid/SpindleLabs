// Move (step 35e2, Ben 2026-10-28, pulled forward for the demo): a timeline
// item that moves and turns bodies, Fusion's Move/Copy without the copy.
// It holds the bodies it moves as `dependsOn` and its numbers as
// MOVE_PARAMS: each body is turned about the line through the pivot along
// X, then Y, then Z (degrees, counter-clockwise looking down the axis),
// then shifted by (x, y, z) mm. It makes no body of its own; from its place
// in the timeline on, each body it moves is where it put it (rebuild.ts),
// so editing, suppressing, deleting or reordering it works like any item.
// `insertMove` and `changedMove` (its numbers, and since 35e2i its bodies) are the document changes, pure functions;
// since 35eb both name bodies by body id ("body:feature-1"), as the rebuild
// holds them, and since 35ec (Design data version 6) so does the file: the
// Move's `bodies` (`movedBodies`), with `dependsOn` the items that made them.
// `moveMotions` what the kernel is asked to do.

import type { BodySpec, Feature, Motion, MoveKind } from "@fission/core";
import { bodyItem, freshName, isPiece, insertItem, insertAt, isMoveItem, makesBody, MOVE_PARAMS, shown, takenNames, type DesignDocument, type MoveParam } from "./document.ts";

/** A Move's numbers: the shift (mm), turns (degrees) and pivot (mm). */
export type MoveValues = Record<MoveParam, number>;

/** No move: nothing shifted or turned, about the origin. */
export const NO_MOVE: MoveValues = { x: 0, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 };

/** The undo step a new Move is recorded as. */
export const MOVE_STEP = "Move bodies";

/** The undo step a new Rotate is recorded as. */
export const ROTATE_STEP = "Rotate bodies";

/** The words a Move's summary and the timeline row say: "Move Box 1 by (10, 0, 0) mm, turned 90° about Z"; a Rotate's start "Rotate". */
export function moveSummary(labels: readonly string[], v: MoveValues, verb: "Move" | "Rotate" = "Move"): string {
  const what = labels.length === 1 ? labels[0] : `${labels.length} bodies`;
  const shift = v.x !== 0 || v.y !== 0 || v.z !== 0 ? ` by (${v.x}, ${v.y}, ${v.z}) mm` : "";
  const turns = (["X", "Y", "Z"] as const).flatMap((a) => (v[`turn${a}`] !== 0 ? [`${v[`turn${a}`]}° about ${a}`] : []));
  const turned = turns.length > 0 ? `${shift ? "," : ""} turned ${turns.join(", then ")}` : "";
  return `${verb} ${what}${shift}${turned}${shift || turned ? "" : verb === "Move" ? " (not moved yet)" : " (not turned yet)"}`;
}

/**
 * Which tool opens a Move item (Ben, 2026-10-29: Move and Rotate are
 * separate tools, one kind of timeline item): Rotate for one that only
 * turns, or one made by Rotate that does nothing yet (its summary says
 * "Rotate"); Move for anything that shifts, an old file's Move that
 * shifts and turns included, whose Move panel then shows its angles too.
 */
export function moveKindOf(f: Feature): MoveKind {
  const v = moveValues(f);
  const shifts = v.x !== 0 || v.y !== 0 || v.z !== 0;
  const turns = v.turnX !== 0 || v.turnY !== 0 || v.turnZ !== 0;
  if (shifts) return "move";
  return turns || f.intent.summary.startsWith("Rotate ") ? "rotate" : "move";
}

/** A Move's numbers, read from its intent (checked when the file was read). */
export function moveValues(f: Feature): MoveValues {
  if (!isMoveItem(f)) throw new Error(`${f.provenance.self.label} is not a move`);
  return Object.fromEntries(MOVE_PARAMS.map((k) => [k, f.intent.parameters[k] as number])) as MoveValues;
}

const DEGREES = Math.PI / 180;

/**
 * What the kernel is asked to do to each body a Move moves: a turn about
 * each axis that is turned, X, Y then Z, about the pivot, then the shift
 * when there is one. Nothing turned or shifted is left out, so a Move of
 * nothing asks for nothing.
 */
export function moveMotions(v: MoveValues): Motion[] {
  const pivot: [number, number, number] = [v.pivotX, v.pivotY, v.pivotZ];
  const axes = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] } as const;
  const turns: Motion[] = (["X", "Y", "Z"] as const).flatMap((a) => (v[`turn${a}`] === 0 ? [] : [{ turn: { pivot, axis: [...axes[a]], angle: v[`turn${a}`] * DEGREES } }]));
  return v.x === 0 && v.y === 0 && v.z === 0 ? turns : [...turns, { move: [v.x, v.y, v.z] }];
}

/** `spec` moved by `motions` too: a moved body's list grows (the kernel takes a shape inside one `moved` only); nothing to do gives `spec` itself. */
export function movedSpec(spec: BodySpec, motions: readonly Motion[]): BodySpec {
  if (motions.length === 0) return spec;
  if ("moved" in spec) return { moved: { body: spec.moved.body, moves: [...spec.moved.moves, ...motions] } };
  return { moved: { body: spec, moves: [...motions] } };
}

/** `values` checked: every one a finite number. */
function checked(values: MoveValues): MoveValues {
  for (const k of MOVE_PARAMS) if (typeof values[k] !== "number" || !Number.isFinite(values[k])) throw new Error(`a move needs ${k} as a number, not ${shown(values[k])}`);
  return Object.fromEntries(MOVE_PARAMS.map((k) => [k, values[k]])) as MoveValues;
}

/** The bodies Move `move` moves, by body id (35eb), as the file lists them (its `bodies`, version 6), in its order. */
export const movedBodies = (move: Feature): string[] => [...(move.intent.parameters.bodies as readonly string[])];

/** Whether the design numbers body `id` (a piece, 35ec, is a body once `bodies` lists it). */
const numbered = (doc: DesignDocument, id: string): boolean => (doc.bodies ?? []).some((b) => b.id === id);

/** The items that made `bodies` (body ids), each once, in order: a Move's `dependsOn`. */
const makersOf = (bodies: readonly string[]): string[] => [...new Set(bodies.map((b) => bodyItem(b)!))];

/** Each picked body's item id, in order: refused for anything that is no body id (a bare feature id included), and for a body picked twice. */
function itemsOf(bodies: readonly string[]): string[] {
  return bodies.map((b, i) => {
    const item = bodyItem(b);
    if (item === null) throw new Error(`${shown(b)} is not a body id`);
    if (bodies.indexOf(b) !== i) throw new Error(`${shown(b)} is picked twice`);
    return item;
  });
}

/** Each body's item for a Move: refused unless every one makes a body and is in range before the marker, each once. */
function bodiesFor(doc: DesignDocument, bodies: readonly string[]): Feature[] {
  if (bodies.length === 0) throw new Error("pick at least one body to move");
  const end = insertAt(doc);
  return itemsOf(bodies).map((id, i) => {
    const at = doc.timeline.features.findIndex((f) => f.id === id);
    const f = doc.timeline.features[at];
    if (f === undefined || !(isPiece(bodies[i]) ? numbered(doc, bodies[i]) : makesBody(f))) throw new Error(`${shown(bodies[i])} is not a body in the design`);
    if (at >= end) throw new Error(`${f.provenance.self.label} comes after the rollback marker, so a move put in at the marker can't move it`);
    return f;
  });
}

/** The design with a new Move of `bodies` (body ids, 35eb) by `values` put in at the marker ("Move 1", or "Rotate 1" made by Rotate, its id from the counter), and its id. */
export function insertMove(doc: DesignDocument, bodies: readonly string[], values: MoveValues, kind: MoveKind = "move"): { doc: DesignDocument; id: string } {
  const items = bodiesFor(doc, bodies);
  const v = checked(values);
  const id = `feature-${doc.nextId}`;
  const verb = kind === "rotate" ? "Rotate" : "Move";
  // Counted as before for a Move (every Move item but the Rotates); a Rotate counts the Rotates.
  const rotates = (f: Feature) => f.provenance.self.label.startsWith("Rotate ");
  const label = freshName(verb, doc.timeline.features.filter((f) => isMoveItem(f) && rotates(f) === (kind === "rotate")).length, takenNames(doc));
  const labels = items.map((f) => f.provenance.self.label);
  const feature: Feature = {
    id,
    intent: { type: "move", parameters: { ...v, bodies: [...bodies] }, summary: moveSummary(labels, v, verb) },
    provenance: { self: { workspace: "design", id, label }, from: items.map((f) => ({ workspace: "design", id: f.id, label: f.provenance.self.label })) },
    dependsOn: makersOf(bodies),
    suppressed: false,
  };
  return { id, doc: { ...doc, nextId: doc.nextId + 1, timeline: insertItem(doc, feature) } };
}

/** Words for a body picked for Move `move` that is made after it in the timeline (35e2i): it can't move what isn't made yet. */
export const madeAfter = (body: string, move: string): string => `${body} is made after ${move} in the timeline, so ${move} can't move it.`;

/**
 * The bodies an edited Move moves instead (35e2i), as `bodiesFor` checks a
 * new one's but against the Move's own place: each makes a body and comes
 * before the Move in the timeline, each once, at least one. A body the
 * Move already held that has been deleted since may stay (as a file may
 * hold it: the rebuild fails the Move naming it), under its old name.
 */
function bodiesBefore(doc: DesignDocument, move: Feature, bodies: readonly string[]): { id: string; label: string }[] {
  if (bodies.length === 0) throw new Error(`pick at least one body for ${move.provenance.self.label} to move`);
  const end = doc.timeline.features.indexOf(move);
  return itemsOf(bodies).map((id, i) => {
    const at = doc.timeline.features.findIndex((f) => f.id === id);
    const f = doc.timeline.features[at];
    const held = move.provenance.from.find((r) => r.id === id);
    if (f === undefined && movedBodies(move).includes(bodies[i]) && held) return { id, label: held.label };
    if (f === undefined || !(isPiece(bodies[i]) ? numbered(doc, bodies[i]) : makesBody(f))) throw new Error(`${shown(bodies[i])} is not a body in the design`);
    if (at > end) throw new Error(madeAfter(f.provenance.self.label, move.provenance.self.label).slice(0, -1));
    return { id, label: f.provenance.self.label };
  });
}

/**
 * The design with Move `id` at these numbers instead, and moving `bodies`
 * (body ids, 35eb) when given (35e2i; refused as `bodiesBefore` says): the same item, its
 * place and flags kept; its bodies kept when not given. The design itself
 * when nothing changes (the same bodies in another order change nothing).
 */
export function changedMove(doc: DesignDocument, id: string, values: MoveValues, bodies?: readonly string[]): DesignDocument {
  const old = doc.timeline.features.find((f) => f.id === id);
  if (!old || !isMoveItem(old)) throw new Error(`there is no move ${shown(id)} in the design`);
  const v = checked(values);
  const items = bodies === undefined ? null : bodiesBefore(doc, old, bodies);
  const held = movedBodies(old);
  const sameBodies = items === null || (bodies!.length === held.length && bodies!.every((b) => held.includes(b)));
  if (sameBodies && MOVE_PARAMS.every((k) => old.intent.parameters[k] === v[k])) return doc;
  const kept = sameBodies ? null : items!;
  const labels = kept ? kept.map((b) => b.label) : held.map((b) => bodyItem(b)!).map((b) => doc.timeline.features.find((f) => f.id === b)?.provenance.self.label ?? old.provenance.from.find((r) => r.id === b)?.label ?? b);
  const verb = old.intent.summary.startsWith("Rotate ") ? "Rotate" : "Move";
  const intent = { ...old.intent, parameters: { ...v, bodies: kept ? [...bodies!] : held }, summary: moveSummary(labels, v, verb) };
  const feature: Feature = kept
    ? { ...old, intent, dependsOn: makersOf(bodies!), provenance: { ...old.provenance, from: kept.map((b) => ({ workspace: "design", id: b.id, label: b.label })) } }
    : { ...old, intent };
  return { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } };
}
