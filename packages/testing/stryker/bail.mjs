// node:test as the test files see it during a mutation run (tests.mjs):
// the same module, except that a test whose own function throws ends the
// process at once with exit code 1, naming the test, instead of letting
// every later test run. A killed mutant then costs only the tests up to the
// first one that notices it. Nothing else changes: a test marked skip or
// todo, or written with a done callback, is left as it is, and any other
// failure (a subtest, an error after the test returned) still fails the
// run at its end, through node:test's own exit code.
//
// The same file is the resolve hook that hands it to the test files in
// place of node:test (registered by tests.mjs); its own import of
// node:test, and everything outside the target's folder, get the real one.
import * as real from "node:test";

export * from "node:test";

/** The resolve hook: "node:test" from a test file is this file. */
export async function resolve(specifier, context, next) {
  if (specifier === "node:test" && context.parentURL !== import.meta.url && !context.parentURL?.includes("/node_modules/")) return { url: import.meta.url, shortCircuit: true };
  return next(specifier, context);
}

function stopOnThrow(fn, name) {
  // A function taking (t, done) is a callback test: node:test tells by its length, so it stays as it is.
  if (typeof fn !== "function" || fn.length >= 2) return fn;
  return async function (t) {
    try {
      return await fn.call(this, t);
    } catch (error) {
      process.stderr.write(`failed: ${name ?? fn.name ?? "a test"}\n${String(error?.stack ?? error).slice(0, 2000)}\n`);
      process.exit(1);
    }
  };
}

/** test(name?, options?, fn?) with fn wrapped, unless the options skip it or mark it todo. */
function wrapped(base) {
  const f = (...args) => {
    const i = args.findIndex((a) => typeof a === "function");
    const options = args.find((a) => a !== null && typeof a === "object");
    if (i >= 0 && !options?.skip && !options?.todo) args[i] = stopOnThrow(args[i], typeof args[0] === "string" ? args[0] : undefined);
    return base(...args);
  };
  return Object.assign(f, base, { skip: base.skip, todo: base.todo, only: base.only });
}

export const test = wrapped(real.test);
export const it = wrapped(real.it);
export default test;
