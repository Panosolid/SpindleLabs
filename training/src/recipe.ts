// What the generator is made of. Each command gets a rule (how to build it
// on the kernel, so every example is checked by the same code users
// rely on) and one or more recipes (how people ask for it). A new command
// in any workspace's list needs both before the generator will run with
// it, so the data grows as commands arrive.

import type { BodySpec, Command, KernelCalls } from "@fission/core";
import type { SeededRandom } from "@fission/testing";

/** What replaying commands has built so far. Grows a field per workspace as commands arrive. */
export interface ReplayState {
  /** Design's part, once a set_part has built one. */
  part?: BodySpec;
  /** The origin planes of the sketches create_sketch started, in order (AI7a). */
  sketches?: string[];
}

export type Applied = { ok: true; state: ReplayState } | { ok: false; reason: string };

/** How one command is built on the kernel. */
export interface CommandRule {
  op: string;
  /** Builds the command after `state`; the reason when the kernel or the workspace refuses it. Never throws. */
  apply(kernel: KernelCalls, state: ReplayState, command: Command): Promise<Applied>;
  /** The words a working out must contain to say what this command makes ("part is a box: width 40 mm, …"). */
  says(command: Command): string;
}

/** A training example before it is checked. */
export interface Draft {
  /** What kind of request this is: "create", "edit-parameter", "export", or "cannot" (no command can do it: no commands). */
  task: string;
  /** The project the request is asked about, as the commands that make it (empty: a new project). */
  setup: Command[];
  /** The user's words. */
  prompt: string;
  /** The working out a correct model writes first, in plain words (docs/ai.md, "Full working out"). */
  explanation: string;
  /** The answer: what a correct model sends. Empty only for a "cannot" request. */
  commands: Command[];
}

/** One way people ask for something. */
export interface Recipe {
  /** Stable name, recorded on every example it makes. */
  id: string;
  /** Every op its drafts use, setup included; it runs only when all are offered. */
  ops: readonly string[];
  /** A random draft, or null when this sample can't make a sensible one (counted, never forced). */
  sample(r: SeededRandom): Draft | null;
}
