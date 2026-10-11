// Twist's compile pass for the benchmark and the conformance runs: the core's (src/twist_compile.rs), the one the host
// uses, through the addon built now (nothing to do when it is current).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sluurp = resolve(import.meta.dir, "..", "..", "..", "..");
const windows = process.platform === "win32";

function addon(): { twistCompile: (source: string, path: string) => string } {
  const run = (args: string[]) => spawnSync("cargo", args, { cwd: join(sluurp, "host", "addon"), encoding: "utf8", maxBuffer: 1 << 28, shell: windows });
  const built = run(["build", "--quiet"]);
  if (built.status !== 0) throw new Error(`the addon did not build:\n${built.stderr}`);
  const target = JSON.parse(run(["metadata", "--format-version", "1", "--no-deps"]).stdout).target_directory;
  const lib = join(target, "debug", windows ? "sluurp_addon.dll" : process.platform === "darwin" ? "libsluurp_addon.dylib" : "libsluurp_addon.so");
  // (Copied, as a .node file Bun loads, named by its build: a running process keeps its own copy locked.)
  const copy = join(tmpdir(), `twist-compile-${statSync(lib).mtimeMs.toString(36)}.node`);
  if (!existsSync(copy)) copyFileSync(lib, copy);
  return require(copy);
}

let loaded: ReturnType<typeof addon> | null = null;
/** `source` with its JSX marked and its fixed markup made templates, as the host compiles a Solid-style file. */
export const compile = (source: string, path: string): string => (loaded ??= addon()).twistCompile(source, path);
