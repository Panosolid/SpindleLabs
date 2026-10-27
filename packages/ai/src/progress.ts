// How far along an answer is, for the progress bar (AI5c2, Ben's ask). A
// model can't know its own progress, so this is honest about what it is:
// a named stage that is known (asking, writing commands, writing the
// working out, checking, asking again), and within a writing stage an
// estimate from how much has been written against a typical answer. It
// never reaches the end on its own: only the panel, once the preview is
// on screen, shows 100%.

/** The stages an answer goes through, in order. */
export type Stage = "asking" | "commands" | "working" | "checking";

export interface Progress {
  stage: Stage;
  /** 1 on a second try (the first answer couldn't be used). */
  attempt: 1 | 2;
  /** The estimate, 0 to below 1: never 1 before the preview is ready. */
  fraction: number;
  /** The working out written so far, as plain text (empty until it starts). */
  working: string;
  /** How many commands have been started so far. */
  commands: number;
}

/** Where the bar is while nothing is being written: the request is out, or the answer is being checked. */
export const ASKING = 0.05;
export const CHECKING = 0.9;
/** Where the bar is while the panel builds the preview: the most it shows before the preview is on screen. */
export const PREVIEWING = 0.95;
/**
 * A typical answer's length, in characters: one command
 * ('{"commands":[{"op":"set_part","shape":"box","width":50,"depth":30,"height":20}],' is 81)
 * and a one-sentence working out of about 100.
 */
export const TYPICAL_ANSWER = 190;

/** The bar before any text has arrived (the request is out, or being asked again), and while the answer is checked. */
export function waiting(stage: "asking" | "checking", attempt: 1 | 2): Progress {
  return { stage, attempt, fraction: stage === "asking" ? ASKING : CHECKING, working: "", commands: 0 };
}

/**
 * The progress of an answer from the text written so far. The bar moves
 * from just above ASKING towards CHECKING as the text grows, a typical
 * answer's length taking it 86% of the way (1 − e⁻²), and never arrives:
 * an answer longer than usual slows the bar rather than overrunning it.
 * It depends only on the length, so it never goes back as the text grows,
 * whatever order the model writes its keys in. The stage says which key
 * the model is writing ("commands" or "explanation", whichever came last).
 */
export function progressOf(soFar: string, attempt: 1 | 2): Progress {
  if (soFar === "") return waiting("asking", attempt);
  const explanationAt = soFar.lastIndexOf('"explanation"');
  const working = explanationAt < 0 ? "" : partialString(soFar, explanationAt + '"explanation"'.length);
  const fraction = ASKING + (CHECKING - ASKING) * (1 - Math.exp((-2 * soFar.length) / TYPICAL_ANSWER));
  return {
    stage: explanationAt > soFar.lastIndexOf('"commands"') ? "working" : "commands",
    attempt,
    fraction,
    working,
    commands: soFar.split('"op"').length - 1,
  };
}

/**
 * The text of a JSON string that is still being written: after `from`
 * (just past its key), skip the colon and spaces, then read to the closing
 * quote or the end. Escapes are decoded; one cut off at the end is left
 * out until the rest arrives.
 */
export function partialString(text: string, from: number): string {
  const start = /^\s*:\s*"/.exec(text.slice(from));
  if (!start) return "";
  let out = "";
  for (let i = from + start[0].length; i < text.length; i++) {
    const c = text[i];
    if (c === '"') break;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[next] ?? next;
    i++;
  }
  return out;
}
