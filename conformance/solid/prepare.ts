// Solid 2's own tests, fetched (a sparse clone of solidjs/solid at REF) into solid-tests/, unchanged: they are run
// against Twist (bun run.ts), the modules they import redirected by preload.ts. Only the tests are taken, never
// Solid's code: Twist is written clean room.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compile } from "../../src/twist/compile.ts";

const REF = process.env.SOLID_REF ?? "solid-js@2.0.0-rc.14";
const here = import.meta.dir;
const clone = join(tmpdir(), "twist-solid-tests");
const PARTS: Record<string, string> = { "packages/signals/tests": "signals/tests", "packages/solid/test": "solid/test", "packages/web/test": "web/test" };
/** What each package's own `src/index.js` is in Twist. */
const SRC: Record<string, string> = { signals: "index.ts", solid: "index.ts", web: "web.ts" };

const git = (args: string[], cwd?: string) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!r.success) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
};
if (!existsSync(join(clone, ".git"))) git(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", REF, "https://github.com/solidjs/solid.git", clone]);
git(["sparse-checkout", "set", "--no-cone", ...Object.keys(PARTS).map((p) => `/${p}/`)], clone);

const out = join(here, "solid-tests");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [from, to] of Object.entries(PARTS)) cpSync(join(clone, from), join(out, to), { recursive: true });
// The shared harness, a second time for the server tests (Solid runs those with every import its server build's):
// beside them, so it takes the server rewrite below.
const harness = join(out, "web", "test", "harness");
if (existsSync(harness)) cpSync(harness, join(out, "web", "test", "server", "_harness"), { recursive: true });
// Chai-style `expect(x).to.toBe(…)` (Vitest allows the `.to`; Bun's expect has none): the same assertion without it.
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : [join(d, f.name)]));
for (const f of walk(out)) {
  if (!/\.tsx?$/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  let t = s.replace(/\r\n/g, "\n").replace(/\)\.to\.(to[A-Z]|not\.)/g, ").$1");
  // `expect(() => x).not.toThrow()`: Bun's toThrow waits for a promise the function returns (Vitest's does not), so a
  // call answering a promise that never settles would hang the file. The value made void: the same check, the call
  // not throwing.
  t = t.replace(/expect\(\(\) => (?!\{)([^;\n]*?)\)\.not\.toThrow\(\)/g, "expect(() => void ($1)).not.toThrow()");
  // The JSX import source in a comment of its own (Bun reads the line break after it, inside a longer block comment,
  // into the module's name).
  if (/@jsxImportSource\s+(\S+)/.test(t)) {
    const source = /@jsxImportSource\s+(\S+)/.exec(t)![1]!;
    t = `/** @jsxImportSource ${source} */\n` + t.replace(/^\s*\*?\s*@jsxImportSource\s+\S+\s*$/m, "");
  }
  // JSX files through Twist's pass (Bun's JSX transform runs after, when the test loads).
  if (f.endsWith(".tsx")) t = compile(t, f);
  // Server tests: the web runtime and Solid itself in their server builds.
  if (/[\\/]web[\\/]test[\\/]server[\\/]/.test(f))
    t = t
      .replace(/(["'])@solidjs\/web\1/g, '"@twist/web-server"')
      .replace(/(@jsxImportSource\s+)@solidjs\/web\b/g, "$1@twist/web-server")
      .replace(/(["'])solid-js\1/g, '"@twist/solid-server"')
      .replace(/(["'])\.\.\/harness\/(?!__artifacts__)/g, "$1./_harness/")
      .replace(/(["'])\.\.\/\.\.\/src\/server\.js\1/g, '"@twist/web-server"');
  if (t !== s) writeFileSync(f, t);
}
// Where the tests reach for their package itself (../src/index.js): Twist's module for it.
const twist = (f: string) => join(here, "..", "..", "src", "twist", f).split("\\").join("/");
for (const [pkg, file] of Object.entries(SRC)) {
  mkdirSync(join(out, pkg, "src"), { recursive: true });
  await Bun.write(join(out, pkg, "src", "index.js"), `export * from ${JSON.stringify(twist(file))};\n`);
}
// storePath (a Solid 1 compat helper) is not in Twist: its tests count as not ours, the rest of their files still run.
const notOurs = `export const storePath = () => { throw new Error("NOT OURS: storePath is a Solid 1 compat helper"); };\n`;
for (const pkg of ["signals", "solid"]) await Bun.write(join(out, pkg, "src", "index.js"), `export * from ${JSON.stringify(twist("index.ts"))};\n` + notOurs);
// <Dynamic> (deprecated, kept in 2.0 for Solid 1 code): not in Twist; its tests count as not ours.
const noDynamic = `export const Dynamic = () => { throw new Error("NOT OURS: <Dynamic> is deprecated; dynamic() replaces it"); };\n`;
await Bun.write(join(out, "web", "src", "index.js"), `export * from ${JSON.stringify(twist("web.ts"))};\n` + noDynamic);
// The signals package's core entry is its public core too.
mkdirSync(join(out, "signals", "src", "core"), { recursive: true });
await Bun.write(join(out, "signals", "src", "core", "index.js"), `export * from ${JSON.stringify(twist("index.ts"))};\n`);
const ours = twist("index.ts");
// And by package name: packages that are ours (Bun's resolver finds packages; a plugin cannot invent them).
for (const name of ["solid-js", "@solidjs/signals"]) {
  const dir = join(here, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  await Bun.write(join(dir, "index.js"), `export * from ${JSON.stringify(ours)};\n`);
}
// The web runtime, and the JSX runtime Bun's transform imports from it.
const web = join(here, "..", "..", "src", "twist", "web.ts").split("\\").join("/");
const webDir = join(here, "node_modules", "@solidjs", "web");
mkdirSync(webDir, { recursive: true });
await Bun.write(
  join(webDir, "package.json"),
  JSON.stringify({ name: "@solidjs/web", type: "module", exports: { ".": "./index.js", "./jsx-runtime": "./index.js", "./jsx-dev-runtime": "./index.js" } }),
);
await Bun.write(join(webDir, "index.js"), `export * from ${JSON.stringify(web)};\n`);
// The server builds: Twist's server runtime, and Solid's API as it runs on a server.
for (const [name, file] of [["@twist/web-server", "server.ts"], ["@twist/solid-server", "server-solid.ts"]]) {
  const dir = join(here, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name, type: "module", exports: { ".": "./index.js", "./jsx-runtime": "./index.js", "./jsx-dev-runtime": "./index.js" } }));
  await Bun.write(join(dir, "index.js"), `export * from ${JSON.stringify(twist(file))};\n`);
}
console.log(`Solid's tests at ${REF} (${git(["rev-parse", "--short", "HEAD"], clone)}) in solid-tests/`);
