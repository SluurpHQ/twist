// Twist's compile pass, native: this platform's addon, beside this file (built here: `node scripts/build-compiler.mjs`)
// or from its own package (published: @sluurp/twist-compiler-<platform>), as Tailwind's Oxide is found.
import { createRequire } from "node:module";
import { platformName } from "./platform.js";

const require = createRequire(import.meta.url);

function load() {
  const name = platformName();
  const tried = [];
  for (const at of [`./twist-compiler.${name}.node`, `@sluurp/twist-compiler-${name}`]) {
    try {
      return require(at);
    } catch (e) {
      tried.push(`${at}: ${e.message}`);
    }
  }
  throw new Error(`Twist's compiler has no build for ${name}:\n${tried.join("\n")}`);
}

const addon = load();

/**
 * `source` (the file at `path`) with its JSX marked for Twist and its fixed markup made templates; `hot`: each
 * component's mark also names it, for hot reload.
 */
export const compile = (source, path, { hot = false } = {}) => addon.compile(source, path, hot);

/** One of Twist's own files (`source`, at `path`) with its private property names made short, for a production browser build. */
export const mangle = (source, path) => addon.mangle(source, path);
