// Design's commands for the generator: how each is built on the kernel,
// and the ways people ask for them. Sizes in a prompt are written in one
// unit; the command holds the millimetres that text means (lengths.ts).
//
// Conventions the answers follow (the same as the system prompt's "keep
// every size the user doesn't mention"): a new cylinder's depth is its
// width and a new sphere's depth and height are its width (the box it
// fits in); a new star is as deep as it is wide; an edit keeps every
// size it doesn't name, ignored ones included.
//
// Each draft also carries its working out (working.ts, AI5c): what the
// part is now, how each size was read (converted to mm, sums shown), and
// what the part ends up as. It is written from the same lengths as the
// command, never from the command, so a wrong reading shows in the sums.
// A request no command can do ("cannot") gets no commands and a plain
// reason. From AI7a an empty sketch can be started on an origin plane
// (create_sketch): the plane named by its letters or by its place ("the
// top plane" is XY, "the front" XZ, "the right" YZ, as the view cube
// names them). From AI7b a circle, a rectangle or a line can be drawn in
// it (the sketch is started in the same answer, then drawn in); arcs
// still can't be.

import type { Command, KernelCalls } from "@fission/core";
import { buildSpec, documentFor, drawWords, lastFeature, SHAPES, SKETCH_PLANES, specOf, type DesignDocument } from "@fission/design";
import type { SeededRandom } from "@fission/testing";
import { pick, randomLength, randomSize, randomUnit, unitAfter, type Length } from "./lengths.ts";
import { CANNOT } from "./working.ts";
import type { Applied, CommandRule, Draft, Recipe, ReplayState } from "./recipe.ts";

type Shape = (typeof SHAPES)[number];
type Size = "width" | "depth" | "height";
interface Part extends Command {
  op: "set_part";
  shape: Shape;
  width: number;
  depth: number;
  height: number;
}

const part = (shape: Shape, width: number, depth: number, height: number): Part => ({ op: "set_part", shape, width, depth, height });
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SHAPE_WORDS: Record<Shape, string> = { box: "a box", cylinder: "a cylinder", sphere: "a sphere", plate: "a plate", "l-bracket": "an L bracket", slot: "a slot", star: "a star" };

/** A part in words, every size in mm: "a box: width 40 mm, depth 30 mm, height 20 mm". */
const inWords = (c: Command) => `${SHAPE_WORDS[c.shape as Shape] ?? String(c.shape)}: width ${c.width} mm, depth ${c.depth} mm, height ${c.height} mm`;
/** What the working out says an export does. */
const EXPORTED = "exported as an STL file";

export const DESIGN_RULES: readonly CommandRule[] = [
  {
    op: "set_part",
    async apply(kernel: KernelCalls, state: ReplayState, command: Command): Promise<Applied> {
      try {
        const doc = documentFor(command);
        const spec = specOf(doc, lastFeature(doc));
        const view = await buildSpec(kernel, spec);
        if (view.errors.length > 0) return { ok: false, reason: `the kernel's checks failed: ${view.errors.join("; ")}` };
        if (!(view.volume > 0)) return { ok: false, reason: `the part has no volume (${view.volume})` };
        return { ok: true, state: { ...state, part: spec } };
      } catch (e) {
        return { ok: false, reason: `the kernel refused it: ${reason(e)}` };
      }
    },
    says: (c) => `part is ${inWords(c)}`,
  },
  {
    op: "export_stl",
    async apply(kernel: KernelCalls, state: ReplayState): Promise<Applied> {
      if (!state.part) return { ok: false, reason: "there is no part to export" };
      try {
        const stl = await kernel.call("export_stl", state.part, "part");
        // A binary STL is an 80-byte header, a count, then 50 bytes per triangle.
        if (stl.bytes.length < 84 + 50) return { ok: false, reason: `the STL has no triangles (${stl.bytes.length} bytes)` };
        if (stl.warning) return { ok: false, reason: `the STL would lose detail: ${stl.warning}` };
        return { ok: true, state };
      } catch (e) {
        return { ok: false, reason: `the kernel refused the export: ${reason(e)}` };
      }
    },
    says: () => EXPORTED,
  },
  {
    op: "create_sketch",
    async apply(_kernel: KernelCalls, state: ReplayState, command: Command): Promise<Applied> {
      // Design's own document for it (a sketch builds no body, so there is nothing for the kernel to check).
      try {
        const doc = documentFor(command, state.sketched);
        const sketch = doc.timeline.features.at(-1)!;
        if (sketch.intent.type !== "sketch" || sketch.intent.parameters.plane !== command.on) return { ok: false, reason: `the sketch is not on ${String(command.on)}` };
        return { ok: true, state: { ...state, sketched: doc } };
      } catch (e) {
        return { ok: false, reason: `Design refused it: ${reason(e)}` };
      }
    },
    says: (c) => `${SKETCHED} ${String(c.on)} plane`,
  },
  drawRule("draw_circle"),
  drawRule("draw_rectangle"),
  drawRule("draw_line"),
];

/** A draw command (AI7b), drawn as Design draws it in the sketch just started; its words are the preview's (`drawWords`). */
function drawRule(op: string): CommandRule {
  return {
    op,
    async apply(_kernel: KernelCalls, state: ReplayState, command: Command): Promise<Applied> {
      if (!state.sketched) return { ok: false, reason: "there is no sketch to draw in" };
      try {
        return { ok: true, state: { ...state, sketched: documentFor(command, state.sketched as DesignDocument) } };
      } catch (e) {
        return { ok: false, reason: `Design refused it: ${reason(e)}` };
      }
    },
    says: (c) => drawWords(c),
  };
}

/** What the working out says a create_sketch makes, before the plane's letters. */
const SKETCHED = "new sketch on the";

// ---- Setups: a part that already exists, in mm as the system prompt shows it.

/** A random existing part, sized as people make them. Cylinders sometimes carry a leftover depth, as a part changed from a box does. */
export function randomPart(r: SeededRandom): Part {
  const mm = () => Number(randomSize(r, "mm"));
  const shape = pick(r, SHAPES);
  const [w, d, h] = [mm(), mm(), mm()];
  switch (shape) {
    case "cylinder":
      return part(shape, w, r.next() < 0.5 ? w : d, h);
    case "sphere":
      return part(shape, w, w, w);
    case "star":
      return part(shape, w, w, h);
    case "slot":
      // Straight sides need the length to beat the width.
      return w > 1.5 * d ? part(shape, w, d, h) : part(shape, Math.max(w, d) * 2, Math.min(w, d), h);
    default:
      return part(shape, w, d, h);
  }
}

// ---- The working out's sentences.

/** "4 cm is 40 mm", or null for a length already in mm (a bare number is mm too). */
function inMm(l: Length): string | null {
  if (l.unit === "mm" || l.unit === "none") return null;
  const unit = l.unit === "in" ? (Number(l.number) === 1 ? "inch" : "inches") : l.unit;
  return `${l.number} ${unit} is ${l.mm} mm`;
}

/** The conversions these lengths need, as one sentence; none when all are in mm. */
function conversions(ls: readonly Length[]): string[] {
  if (ls.some((l) => l.unit === "none")) return ["A number without a unit is in millimetres."];
  const said = [...new Set(ls.map(inMm).filter((x): x is string => x !== null))];
  if (said.length === 0) return [];
  return [`${sentence(said.length === 1 ? said[0] : `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`)}.`];
}

const now = (p: Part) => `The part now is ${inWords(p)}.`;
const becomes = (p: Part, isNew: boolean) => `So the ${isNew ? "new " : ""}part is ${inWords(p)}.`;
const working = (lines: readonly string[]) => lines.join(" ");

// ---- Creating a part.

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Three sizes as one list: "40 by 30 by 20 mm", "4 cm x 3 cm x 2 cm". */
function list(r: SeededRandom, ls: readonly Length[]): string {
  const sep = pick(r, [" by ", " x ", " × ", "×"]);
  return r.next() < 0.6 ? ls.map((l) => l.number).join(sep) + unitAfter(ls[0].unit, r) : ls.map((l) => l.text).join(sep);
}

// A bare number before "in diameter" reads as inches ("25 in diameter"), so that wording needs a unit.
function diameterWords(r: SeededRandom, l: Length): string {
  return pick(r, [`${l.text} across`, `with a diameter of ${l.text}`, `Ø${l.text}`, ...(l.unit === "none" ? [] : [`${l.text} in diameter`])]);
}
function radiusWords(r: SeededRandom, l: Length): string {
  return pick(r, [`with a radius of ${l.text}`, `of radius ${l.text}`, ...(l.unit === "none" ? [] : [`${l.text} in radius`])]);
}

/** A round size given as a diameter or a radius, the diameter (width) it means, and how that was read. */
function roundSize(r: SeededRandom, unit: ReturnType<typeof randomUnit>): { words: string; width: number; length: Length; working: string } {
  const l = randomLength(r, unit);
  if (r.next() < 0.5) return { words: diameterWords(r, l), width: l.mm, length: l, working: `The size across is the diameter, which is the width: ${l.mm} mm.` };
  const width = Number((2 * l.mm).toPrecision(12));
  return { words: radiusWords(r, l), width, length: l, working: `The radius is ${l.mm} mm, and the width is the diameter, twice the radius: 2 × ${l.mm} = ${width} mm.` };
}

/** Sizes smallest first, so a plate's or star's thickness is its smallest size, as people make them. */
const thinFirst = (ls: Length[]) => ls.sort((a, b) => a.mm - b.mm);

/** How a round part's height is said, by what it's called. */
const HEIGHT_WORDS: Record<string, readonly string[]> = { cylinder: ["tall", "high", "long"], rod: ["long"], dowel: ["long"], peg: ["long", "tall"], puck: ["thick"], disc: ["thick"] };

/** A new part as a prompt, the command it means, and the working out's sentences before the result. */
export function createPart(r: SeededRandom): { prompt: string; command: Part; working: string[] } {
  const unit = randomUnit(r);
  const L = () => randomLength(r, unit);
  const kind = pick(r, [...SHAPES, "cube"] as const);
  switch (kind) {
    case "box": {
      const [w, d, h] = [L(), L(), L()];
      const prompt = pick(r, [
        `make a box ${list(r, [w, d, h])}.`,
        `a block ${list(r, [w, d, h])}, please.`,
        `I need a block ${w.text} wide, ${d.text} deep and ${h.text} tall.`,
        `create a rectangular block: width ${w.text}, depth ${d.text}, height ${h.text}.`,
        `can you make a ${list(r, [w, d, h])} box?`,
      ]);
      const block = /block/.test(prompt) ? "A block is a box. " : "";
      return { prompt: sentence(prompt), command: part("box", w.mm, d.mm, h.mm), working: [`${block}Its sizes are the width, depth and height, in that order.`, ...conversions([w, d, h])] };
    }
    case "cube": {
      const s = L();
      const prompt = pick(r, [`a ${s.text} cube.`, `make a cube with ${s.text} sides.`, `I'd like a cube, ${s.text} on each side.`]);
      return { prompt: sentence(prompt), command: part("box", s.mm, s.mm, s.mm), working: ["A cube is a box with every side the same.", ...conversions([s])] };
    }
    case "cylinder": {
      const round = roundSize(r, unit);
      const h = L();
      const noun = pick(r, ["cylinder", "rod", "dowel", "peg", "puck", "disc"]);
      const tall = pick(r, HEIGHT_WORDS[noun]);
      const prompt = pick(r, [`make a ${noun} ${round.words}, ${h.text} ${tall}.`, `I need a ${noun} ${round.words} and ${h.text} ${tall}.`, `a ${noun}, ${h.text} ${tall}, ${round.words}.`]);
      const lines = [...(noun === "cylinder" ? [] : [`A ${noun} is a cylinder.`]), ...conversions([round.length, h]), round.working, "A new cylinder is as deep as it is wide.", `How ${tall} it is, ${h.mm} mm, is the height.`];
      return { prompt: sentence(prompt), command: part("cylinder", round.width, round.width, h.mm), working: lines };
    }
    case "sphere": {
      const round = roundSize(r, unit);
      const noun = pick(r, ["sphere", "ball"]);
      const prompt = pick(r, [`make a ${noun} ${round.words}.`, `a ${noun} ${round.words}, please.`, `I want a ${noun} ${round.words}.`]);
      const lines = [...(noun === "ball" ? ["A ball is a sphere."] : []), ...conversions([round.length]), round.working, "A sphere is as deep and as tall as it is wide."];
      return { prompt: sentence(prompt), command: part("sphere", round.width, round.width, round.width), working: lines };
    }
    case "plate": {
      const [h, a, b] = thinFirst([L(), L(), L()]);
      const [w, d] = r.next() < 0.5 ? [a, b] : [b, a];
      const prompt = pick(r, [
        `a plate ${list(r, [w, d])}, ${h.text} thick.`,
        `make a mounting plate ${w.text} long, ${d.text} wide and ${h.text} thick.`,
        `I need a flat plate with two holes, ${list(r, [w, d])} and ${h.text} thick.`,
      ]);
      return { prompt: sentence(prompt), command: part("plate", w.mm, d.mm, h.mm), working: ["A plate's two sizes across are its width and depth, and its thickness is the height.", ...conversions([w, d, h])] };
    }
    case "l-bracket": {
      const [w, d, h] = [L(), L(), L()];
      const prompt = pick(r, [`an L bracket ${list(r, [w, d])}, ${h.text} thick.`, `make an L-shaped bracket with legs of ${w.text} and ${d.text}, ${h.text} thick.`]);
      return { prompt: sentence(prompt), command: part("l-bracket", w.mm, d.mm, h.mm), working: ["An L bracket's legs are its width and depth, and its thickness is the height.", ...conversions([w, d, h])] };
    }
    case "slot": {
      const [a, b, h] = [L(), L(), L()];
      const [w, d] = a.mm > b.mm ? [a, b] : [b, a]; // a slot is longer than it is wide
      const prompt = pick(r, [`a slot ${w.text} long and ${d.text} wide, ${h.text} thick.`, `make a rounded slot shape ${list(r, [w, d])}, ${h.text} thick.`]);
      return { prompt: sentence(prompt), command: part("slot", w.mm, d.mm, h.mm), working: ["A slot's length is its width, its width across is its depth, and its thickness is the height.", ...conversions([w, d, h])] };
    }
    case "star": {
      const [h, w] = thinFirst([L(), L()]);
      const prompt = pick(r, [`a five-pointed star ${w.text} across and ${h.text} thick.`, `make a star ${w.text} wide, ${h.text} thick.`]);
      return { prompt: sentence(prompt), command: part("star", w.mm, w.mm, h.mm), working: ["A star's size across is its width, it is as deep as it is wide, and its thickness is the height.", ...conversions([w, h])] };
    }
  }
}

// ---- Editing the part there is.

/** The sizes a shape uses, with the words for making each bigger and smaller. */
const SIZES: Record<Shape, readonly Size[]> = {
  box: ["width", "depth", "height"],
  plate: ["width", "depth", "height"],
  "l-bracket": ["width", "depth", "height"],
  slot: ["width", "depth", "height"],
  cylinder: ["width", "height"],
  sphere: ["width"],
  star: ["width", "height"],
};
const FLAT: readonly Shape[] = ["plate", "l-bracket", "slot", "star"];

function moreLess(r: SeededRandom, shape: Shape, size: Size): [more: string, less: string] {
  if (size === "width") return ["wider", "narrower"];
  if (size === "depth") return ["deeper", "shallower"];
  if (FLAT.includes(shape) && r.next() < 0.5) return ["thicker", "thinner"];
  return pick(r, [["taller", "shorter"], ["higher", "lower"]] as const);
}

/** What people call a size of this shape: a cylinder's width is its diameter, a plate's height its thickness. */
function sizeName(r: SeededRandom, shape: Shape, size: Size): { name: string; factor: number } {
  if (size === "width" && (shape === "cylinder" || shape === "sphere")) return pick(r, [{ name: "diameter", factor: 1 }, { name: "radius", factor: 2 }, { name: "width", factor: 1 }]);
  if (size === "height" && FLAT.includes(shape) && r.next() < 0.5) return { name: "thickness", factor: 1 };
  return { name: size, factor: 1 };
}

const it = (r: SeededRandom, shape: Shape) => (r.next() < 0.7 ? "it" : `the ${shape === "l-bracket" ? "bracket" : shape}`);
const round12 = (v: number) => Number(v.toPrecision(12));

/** "Make it 10 mm wider": one size changed by a length. */
function relativeEdit(r: SeededRandom, from: Part): Draft | null {
  const size = pick(r, SIZES[from.shape]);
  const by = randomLength(r, r.next() < 0.8 ? "mm" : randomUnit(r));
  const grow = r.next() < 0.5;
  const [more, less] = moreLess(r, from.shape, size);
  const to = round12(from[size] + (grow ? by.mm : -by.mm));
  if (to < 1) return null; // shrinking past nothing isn't a sensible request
  const word = grow ? more : less;
  const subject = it(r, from.shape);
  const prompt = pick(r, [`make ${subject} ${by.text} ${word}.`, `can you make ${subject} ${by.text} ${word}?`, `${by.text} ${word}, please.`]);
  const after: Part = { ...from, [size]: to };
  const sum = `${sentence(word)} changes the ${size}: ${from[size]} ${grow ? "+" : "−"} ${by.mm} = ${to} mm.`;
  return { task: "edit-parameter", setup: [from], prompt: sentence(prompt), explanation: working([now(from), ...conversions([by]), sum, "Every other size stays.", becomes(after, false)]), commands: [after] };
}

/** "Set the height to 40 mm": one size given outright. */
function setEdit(r: SeededRandom, from: Part): Draft | null {
  const size = pick(r, SIZES[from.shape]);
  const { name, factor } = sizeName(r, from.shape, size);
  const l = randomLength(r, randomUnit(r));
  const to = round12(l.mm * factor);
  if (to === from[size]) return null; // no change asked for
  const prompt = pick(r, [`set the ${name} to ${l.text}.`, `change the ${name} to ${l.text}.`, `make the ${name} ${l.text}.`, `I want the ${name} to be ${l.text}.`]);
  const after: Part = { ...from, [size]: to };
  const reading =
    name === "radius" ? `The width is the diameter, twice the radius: 2 × ${l.mm} = ${to} mm.` : name === "diameter" ? `The diameter is the width: ${to} mm.` : name === "thickness" ? `The thickness is the height: ${to} mm.` : `The ${size} becomes ${to} mm.`;
  return { task: "edit-parameter", setup: [from], prompt: sentence(prompt), explanation: working([now(from), ...conversions([l]), reading, "Every other size stays.", becomes(after, false)]), commands: [after] };
}

/** "Make it twice as tall", "halve the width", "make it 50% bigger". */
function scaleEdit(r: SeededRandom, from: Part): Draft | null {
  if (r.next() < 0.3) {
    const [words, f] = pick(r, [["make it twice as big", 2], ["make it 50% bigger", 1.5], ["scale it up by 50%", 1.5], ["make it half the size", 0.5], ["scale it down to half its size", 0.5], ["make it three times as big", 3]] as const);
    const after = part(from.shape, round12(from.width * f), round12(from.depth * f), round12(from.height * f));
    const sums = (["width", "depth", "height"] as const).map((k) => `${from[k]} × ${f} = ${after[k]} mm`).join(", ");
    return { task: "edit-parameter", setup: [from], prompt: sentence(`${words}.`), explanation: working([now(from), `That multiplies every size by ${f}: ${sums}.`, becomes(after, false)]), commands: [after] };
  }
  const size = pick(r, SIZES[from.shape]);
  const adjective = { width: "wide", depth: "deep", height: FLAT.includes(from.shape) ? pick(r, ["thick", "tall"]) : pick(r, ["tall", "high"]) }[size];
  const { name } = sizeName(r, from.shape, size);
  const [words, f] = pick(r, [
    [`make it twice as ${adjective}`, 2],
    [`make it three times as ${adjective}`, 3],
    [`make it half as ${adjective}`, 0.5],
    [`double the ${name}`, 2],
    [`halve the ${name}`, 0.5],
  ] as const);
  const after: Part = { ...from, [size]: round12(from[size] * f) };
  // What the words call the size, said only when they name it ("double the radius", not "twice as wide").
  const which = adjective === "thick" ? "The thickness is the height. " : !words.includes(`the ${name}`) ? "" : name === "radius" ? "The radius is half the width, so the width scales the same. " : name === "diameter" ? "The diameter is the width. " : name === "thickness" ? "The thickness is the height. " : "";
  const sum = `${which}That multiplies the ${size} by ${f}: ${from[size]} × ${f} = ${after[size]} mm.`;
  return { task: "edit-parameter", setup: [from], prompt: sentence(`${words}.`), explanation: working([now(from), sum, "Every other size stays.", becomes(after, false)]), commands: [after] };
}

/** "Turn it into a cylinder": the shape changes, every size stays. */
function shapeEdit(r: SeededRandom, from: Part): Draft | null {
  const to = pick(r, SHAPES.filter((s) => s !== from.shape));
  const prompt = pick(r, [`turn it into ${SHAPE_WORDS[to]}.`, `make it ${SHAPE_WORDS[to]} instead.`, `change the shape to ${SHAPE_WORDS[to]}.`]);
  const after: Part = { ...from, shape: to };
  return { task: "edit-parameter", setup: [from], prompt: sentence(prompt), explanation: working([now(from), `Only the shape changes, to ${SHAPE_WORDS[to]}; every size stays.`, becomes(after, false)]), commands: [after] };
}

const EXPORT_WORDS = ["export it as an STL", "download it as an STL file", "save it as an STL for printing", "give me the STL file", "export the STL"];

// ---- Starting a sketch (AI7a).

type Plane = (typeof SKETCH_PLANES)[number];
/** The origin planes by their place, as the view cube names the side each faces (Z up, the front looking along −Y). */
const PLANE_PLACES: Record<string, Plane> = { top: "XY", ground: "XY", bottom: "XY", front: "XZ", back: "XZ", right: "YZ", left: "YZ", side: "YZ" };

/** "Start a new sketch on the front plane": an empty sketch on the plane meant; the working out says which plane a place word is. */
function sketchDraft(r: SeededRandom): Draft {
  const word = r.next() < 0.5 ? pick(r, SKETCH_PLANES) : pick(r, Object.keys(PLANE_PLACES));
  const plane = (SKETCH_PLANES as readonly string[]).includes(word) ? (word as Plane) : PLANE_PLACES[word];
  const on = pick(r, [`on the ${word} plane`, `on ${word}`, ...(word === plane ? [`on the ${word}`] : [])]);
  const prompt = pick(r, [`start a new sketch ${on}.`, `create a sketch ${on}.`, `new sketch ${on}.`, `I want to sketch ${on}.`, `can you start a sketch ${on}?`, `open a new sketch ${on}, please.`]);
  // A sketch never changes the part, so it is asked about a new project or one with a part alike.
  const setup = r.next() < 0.5 ? [randomPart(r)] : [];
  const which = word === plane ? [] : [`The ${word} plane is the ${plane} plane.`];
  const kept = setup.length > 0 ? ["The part stays as it is."] : [];
  return { task: "create", setup, prompt: sentence(prompt), explanation: working([...which, ...kept, `So there is a ${SKETCHED} ${plane} plane, ready to draw in.`]), commands: [{ op: "create_sketch", on: plane }] };
}

/** "Sketch a circle 2 cm across on the front plane": a sketch on the plane meant, then the drawing, centred on the sketch's origin unless a centre is given (AI7b). */
function drawDraft(r: SeededRandom): Draft {
  const word = r.next() < 0.5 ? pick(r, SKETCH_PLANES) : pick(r, Object.keys(PLANE_PLACES));
  const plane = (SKETCH_PLANES as readonly string[]).includes(word) ? (word as Plane) : PLANE_PLACES[word];
  const on = pick(r, [`on the ${word} plane`, `on ${word}`]);
  const which = word === plane ? [] : [`The ${word} plane is the ${plane} plane.`];
  const unit = randomUnit(r);
  const L = () => randomLength(r, unit);
  const sketch = { op: "create_sketch", on: plane };
  const so = (c: Command) => `So there is a ${SKETCHED} ${plane} plane, and in it a ${drawWords(c)}.`;
  const kind = pick(r, ["circle", "circle", "rectangle", "line"]);
  // A centre now and then, in whole mm, written "(x, y)": coordinates in the sketch are millimetres.
  const centre = r.next() < 0.3 ? { x: Math.round(r.next() * 100) - 50, y: Math.round(r.next() * 100) - 50 } : null;
  const at = centre ? ` centred at (${centre.x}, ${centre.y}) mm` : "";
  const centreSays = centre ? ["The centre is given in mm in the sketch."] : ["It is centred on the sketch's origin."];
  if (kind === "circle") {
    const size = L();
    const radius = r.next() < 0.4;
    const diameter = radius ? round12(2 * size.mm) : size.mm;
    const how = radius ? pick(r, [`with a radius of ${size.text}`, `of radius ${size.text}`]) : pick(r, [`${size.text} across`, `with a diameter of ${size.text}`]);
    const prompt = pick(r, [`sketch a circle ${how}${at} ${on}.`, `in a sketch ${on}, draw a circle ${how}${at}.`]);
    const c: Command = { op: "draw_circle", diameter, ...(centre ?? {}) };
    const sum = radius ? [`The diameter is twice the radius: 2 × ${size.mm} = ${diameter} mm.`] : [];
    return { task: "create", setup: [], prompt: sentence(prompt), explanation: working([...which, ...conversions([size]), ...sum, ...centreSays, so(c)]), commands: [sketch, c] };
  }
  if (kind === "rectangle") {
    const [w, h] = [L(), L()];
    const prompt = pick(r, [`draw a ${w.text} by ${h.text} rectangle${at} in a sketch ${on}.`, `sketch a rectangle ${w.text} wide and ${h.text} high${at} ${on}.`]);
    const c: Command = { op: "draw_rectangle", width: w.mm, height: h.mm, ...(centre ?? {}) };
    return { task: "create", setup: [], prompt: sentence(prompt), explanation: working([...which, ...conversions([w, h]), "The first size is along the sketch's x, the second along its y.", ...centreSays, so(c)]), commands: [sketch, c] };
  }
  const p = () => Math.round(r.next() * 200) - 100;
  let [x1, y1, x2, y2] = [p(), p(), p(), p()];
  if (x1 === x2 && y1 === y2) x2 += 10;
  const prompt = pick(r, [`draw a line from (${x1}, ${y1}) to (${x2}, ${y2}) mm in a sketch ${on}.`, `sketch a line from (${x1}, ${y1}) to (${x2}, ${y2}) mm ${on}.`]);
  const c: Command = { op: "draw_line", x1, y1, x2, y2 };
  return { task: "create", setup: [], prompt: sentence(prompt), explanation: working([...which, "The ends are given in mm in the sketch.", so(c)]), commands: [sketch, c] };
}

// ---- Requests no command can do yet: the answer is no commands and a plain reason (AI5c).

const PLANES = ["top", "front", "right", "XY", "XZ", "YZ"];
/** What can be done now, said the same way in every refusal. */
const CAN_DO = "What can be done now is making or resizing a whole ready-made shape (a box, cylinder, sphere, plate, L bracket, slot or star), or starting a sketch on a plane and drawing circles, rectangles and lines in it.";

/** A request that needs a command Design doesn't offer, and what it would need. Each mentions what it can't do by name, so the words alone say why. */
function cannotAsk(r: SeededRandom): { prompt: string; needs: string; onPart: boolean } {
  const L = () => randomLength(r, randomUnit(r)).text;
  const plane = pick(r, PLANES);
  return pick(r, [
    // Circles, rectangles and lines can be drawn (AI7b), arcs not yet: all or nothing, so no commands.
    () => ({ prompt: `draw an arc of radius ${L()} in a sketch on the ${plane} plane.`, needs: "drawing arcs", onPart: false }),
    () => ({ prompt: `put a ${L()} hole in the centre of the top face.`, needs: "a hole", onPart: true }),
    () => ({ prompt: `drill a ${L()} hole through it.`, needs: "a hole", onPart: true }),
    () => ({ prompt: `fillet all the edges with a ${L()} radius.`, needs: "rounding edges (a fillet)", onPart: true }),
    () => ({ prompt: `chamfer the top edges by ${L()}.`, needs: "a chamfer", onPart: true }),
    () => ({ prompt: `hollow it out with ${L()} walls.`, needs: "hollowing a part out (a shell)", onPart: true }),
    () => ({ prompt: `engrave my name on the top face.`, needs: "text", onPart: true }),
    () => ({ prompt: `make ${pick(r, ["3", "4", "6"])} copies of it in a row.`, needs: "copies or patterns", onPart: true }),
  ])();
}

/** "Sketch a circle…": no commands, and the working out says what can't be done and what can. */
function cannotDraft(r: SeededRandom): Draft {
  const ask = cannotAsk(r);
  const setup = ask.onPart || r.next() < 0.5 ? [randomPart(r)] : [];
  const reason = `There is no command for ${ask.needs} yet, so this ${CANNOT} be done and nothing was made.`;
  return { task: "cannot", setup, prompt: sentence(ask.prompt), explanation: working([reason, CAN_DO]), commands: [] };
}

export const DESIGN_RECIPES: readonly Recipe[] = [
  {
    id: "design.create",
    ops: ["set_part"],
    sample(r) {
      const { prompt, command, working: lines } = createPart(r);
      // Asking for a new part over an old one replaces it: set_part is the whole part.
      const setup = r.next() < 0.2 ? [randomPart(r)] : [];
      const replaces = setup.length > 0 ? ["This replaces the part there is now."] : [];
      return { task: "create", setup, prompt, explanation: working([...replaces, ...lines, becomes(command, true)]), commands: [command] };
    },
  },
  { id: "design.edit-by", ops: ["set_part"], sample: (r) => relativeEdit(r, randomPart(r)) },
  { id: "design.edit-set", ops: ["set_part"], sample: (r) => setEdit(r, randomPart(r)) },
  { id: "design.edit-scale", ops: ["set_part"], sample: (r) => scaleEdit(r, randomPart(r)) },
  { id: "design.edit-shape", ops: ["set_part"], sample: (r) => shapeEdit(r, randomPart(r)) },
  {
    id: "design.export",
    ops: ["set_part", "export_stl"],
    sample(r) {
      const from = randomPart(r);
      return { task: "export", setup: [from], prompt: sentence(`${pick(r, EXPORT_WORDS)}.`), explanation: working([now(from), `No size changes; the whole part is ${EXPORTED}.`]), commands: [{ op: "export_stl" }] };
    },
  },
  {
    id: "design.create-and-export",
    ops: ["set_part", "export_stl"],
    sample(r) {
      const { prompt, command, working: lines } = createPart(r);
      const ask = prompt.replace(/[.?]$/, "").replace(/, please$/, "");
      const then = r.next() < 0.5 ? ` and ${pick(r, EXPORT_WORDS)}.` : `. Then ${pick(r, EXPORT_WORDS)}.`;
      return { task: "create", setup: [], prompt: `${ask}${then}`, explanation: working([...lines, becomes(command, true), `Then it is ${EXPORTED}.`]), commands: [command, { op: "export_stl" }] };
    },
  },
  { id: "design.sketch", ops: ["create_sketch", "set_part"], sample: sketchDraft },
  { id: "design.sketch-draw", ops: ["create_sketch", "draw_circle", "draw_rectangle", "draw_line"], sample: drawDraft },
  { id: "design.cannot", ops: ["set_part"], sample: cannotDraft },
];
