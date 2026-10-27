// Training data for SpindleLabs's own model (docs/ai.md, "SpindleLabs's own
// model"; roadmap A11). Kept in its own folder, ready to move to a
// repository of its own: nothing in the app imports it.

import { aiCommands } from "@fission/design";
import { DESIGN_RECIPES, DESIGN_RULES } from "./design.ts";

export { DESIGN_RECIPES, DESIGN_RULES, createPart, randomPart } from "./design.ts";
export { checkDraft, commandApiVersion, generate, hash, replay, wording, type Example, type GenerateOptions, type Generated } from "./generate.ts";
export { lengthIn, numberText, randomLength, randomSize, randomUnit, toMm, type Length, type Unit } from "./lengths.ts";
export type { Applied, CommandRule, Draft, Recipe, ReplayState } from "./recipe.ts";
export { dataset, isValidation, toRecord, type ChatRecord, type Dataset, type Manifest } from "./records.ts";

/** Every command rule and recipe there is; a workspace's are added here when its commands arrive. */
export const RULES = [...DESIGN_RULES];
export const RECIPES = [...DESIGN_RECIPES];

/** The items the training prompts name in a rename (AI7d): the sketches the setups start, in the order they are made. */
export const TRAINING_ITEMS = ["Sketch 1", "Sketch 2", "Sketch 3"];

/** What the assistant panel offers the model today (Design's aiView, ai-view.ts `aiCommands`): set_part, create_sketch on an origin plane (no body's faces: the training prompts list none), the draw, extrude and rename commands. */
export const OFFERED = aiCommands([], [], TRAINING_ITEMS);
