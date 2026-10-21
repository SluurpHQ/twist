// Twist's compile pass for the benchmark and the conformance runs: the native addon, built first (nothing to do when
// it is current).
import { join } from "node:path";

const built = Bun.spawnSync(["node", join(import.meta.dir, "..", "scripts", "build-compiler.mjs")], { stdout: "ignore", stderr: "inherit" });
if (built.exitCode !== 0) throw new Error("Twist's compiler did not build");
const addon: { compile: (source: string, path: string) => string; mangle: (source: string, path: string) => string } = await import("../napi/index.js");

/** `source` with its JSX marked and its fixed markup made templates, as every integration compiles a Solid-style file. */
export const compile = addon.compile;

/** One of Twist's own files with its private property names made short, as a production browser build has it. */
export const mangle = addon.mangle;
