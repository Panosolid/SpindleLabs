// The working out every example carries (docs/ai.md, "Full working out";
// AI5c): a few plain sentences before the commands. Each is checked
// before it is kept, by rules that hold for any workspace:
// - every conversion it writes ("4 cm is 40 mm") is right, by lengths.ts;
// - every sum it writes ("2 × 15 = 30") is right;
// - it says what each command makes (its rule's `says`), in order;
// - an answer with no commands says plainly what can't be done;
// - it is plain words: no JSON and no command names.

import { toMm, type Unit } from "./lengths.ts";

/** The longest working out an example may have: a few sentences, well inside what the app accepts (1,000). */
export const MAX_WORKING = 600;

const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;
const UNITS: Record<string, Unit> = { mm: "mm", cm: "cm", m: "m", inch: "in", inches: "in" };
const CONVERSION = new RegExp(String.raw`${NUMBER} (mm|cm|m|inch|inches) is ${NUMBER} mm\b`, "g");
const SUM = new RegExp(String.raw`${NUMBER} ([+−×÷]) ${NUMBER} = ${NUMBER}`, "g");
const round12 = (v: number) => Number(v.toPrecision(12));
const OPS: Record<string, (a: number, b: number) => number> = { "+": (a, b) => a + b, "−": (a, b) => a - b, "×": (a, b) => a * b, "÷": (a, b) => a / b };

/** The words that say an answer can't be done: the one thing a refusal must contain. */
export const CANNOT = "can't";

/**
 * Why this working out can't be used with these commands, or null.
 * `says` gives the words the working out must contain for each command
 * (its rule's `says`); `ops` are the command names it must not use.
 */
export function checkWorking(working: string, says: readonly string[], ops: readonly string[]): string | null {
  const text = working.trim();
  if (text === "") return "no working out";
  if (text.length > MAX_WORKING) return `working out too long (${text.length} characters; at most ${MAX_WORKING})`;
  if (/[{}[\]]/.test(text)) return "working out not in plain words: it has JSON in it";
  const op = ops.find((o) => text.includes(o));
  if (op) return `working out not in plain words: it names the command ${op}`;
  for (const m of text.matchAll(CONVERSION)) {
    const right = toMm(m[1], UNITS[m[2]]);
    if (right !== Number(m[3])) return `working out converts wrongly: ${m[0]} (it is ${right} mm)`;
  }
  for (const m of text.matchAll(SUM)) {
    const right = round12(OPS[m[2]](Number(m[1]), Number(m[3])));
    if (right !== Number(m[4])) return `working out sums wrongly: ${m[0]} (it is ${right})`;
  }
  if (says.length === 0) return text.includes(CANNOT) ? null : `working out of an answer with no commands doesn't say what ${CANNOT} be done`;
  let from = 0;
  for (const [i, words] of says.entries()) {
    const at = text.indexOf(words, from);
    if (at < 0) return `working out doesn't say what command ${i + 1} makes: "${words}"`;
    from = at + words.length;
  }
  return null;
}
