// Solid 2's own tests, fetched (a sparse clone of solidjs/solid at REF) into solid-tests/, unchanged: they are run
// against Twist (bun run.ts), the modules they import redirected by preload.ts. Only the tests are taken, never
// Solid's code: Twist is written clean room.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CHANGES, type Change } from "./skips.ts";
import { tmpdir } from "node:os";
import { compile } from "../../test/twist-compile.ts";

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
/** skips.ts applied to a file: each change must match, or the run stops (Solid's test changed: look again). */
const used = new Set<Change>();
function applyChanges(rel: string, t: string): string {
  for (const c of CHANGES) {
    if (c.file !== rel) continue;
    used.add(c);
    const note = `/* Twist: ${c.why} */ `;
    // (A whole file skipped: one skipped test in its place, so what it imports need not exist.)
    if ("skipFile" in c) return `import { test } from "@twist/vitest";\ntest.skip(${JSON.stringify("Twist: " + c.why)}, () => {});\n`;
    else if ("skip" in c) {
      const title = c.skip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^.\\w])(describe|it|test)\\((["'\`])${title}\\3`, "g");
      const n = t.match(re)?.length ?? 0;
      if (n !== 1) throw new Error(`skips.ts: "${c.skip}" found ${n} times in ${rel}`);
      t = t.replace(re, (_m, pre, fn, q) => `${pre}${note}${fn}.skip(${q}${c.skip}${q}`);
    } else {
      if (!t.includes(c.find)) throw new Error(`skips.ts: ${JSON.stringify(c.find)} not found in ${rel}`);
      t = t.split(c.find).join(c.replace);
    }
  }
  return t;
}
// Chai-style `expect(x).to.toBe(…)` (Vitest allows the `.to`; Bun's expect has none): the same assertion without it.
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : [join(d, f.name)]));
for (const f of walk(out)) {
  if (!/\.tsx?$/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  let t = s.replace(/\r\n/g, "\n").replace(/\)\.to\.(to[A-Z]|not\.)/g, ").$1");
  // Vitest's `test.fails` (a test that must fail) is Bun's `test.failing`.
  t = t.replace(/\b(test|it)\.fails\b/g, "$1.failing");
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
  // Vitest's API through vitest.ts (Bun answers "vitest" itself, before any plugin).
  t = t.replace(/(from\s*)(["'])vitest\2/g, '$1"@twist/vitest"');
  // What Twist skips or rewrites (skips.ts).
  t = applyChanges(relative(out, f).split("\\").join("/"), t);
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
for (const c of CHANGES) if (!used.has(c)) throw new Error(`skips.ts: no file ${c.file}`);
// Where the tests reach for their package itself (../src/index.js): Twist's module for it.
const twist = (f: string) => join(here, "..", "..", "src", "twist", f).split("\\").join("/");
for (const [pkg, file] of Object.entries(SRC)) {
  mkdirSync(join(out, pkg, "src"), { recursive: true });
  await Bun.write(join(out, pkg, "src", "index.js"), `export * from ${JSON.stringify(twist(file))};\n`);
}
// On a server, Solid's DEV is undefined (devtools run in the browser).
const serverDev = `export const DEV = undefined;\n`;
for (const pkg of ["signals", "solid"]) await Bun.write(join(out, pkg, "src", "index.js"), `export * from ${JSON.stringify(twist("index.ts"))};\n`);
await Bun.write(join(out, "web", "src", "index.js"), `export * from ${JSON.stringify(twist("web.ts"))};\n`);
// (Its client entry, which the runtime tests import directly: the same module; its server entry, response and cookie
// helpers, Twist's.)
await Bun.write(join(out, "web", "src", "client.js"), `export * from ${JSON.stringify(twist("web.ts"))};\n`);
await Bun.write(join(out, "web", "src", "server.js"), `export * from ${JSON.stringify(twist("server.ts"))};\n`);
// (Its render helpers and its browser stand-ins for the server's API: the client module has both.)
for (const name of ["render.js", "server-mock.js"]) await Bun.write(join(out, "web", "src", name), `export * from ${JSON.stringify(twist("web.ts"))};\n`);
await Bun.write(join(out, "web", "src", "reconcile.js"), `export { reconcileArrays as default } from ${JSON.stringify(twist("web.ts"))};\n`);
await Bun.write(join(out, "web", "src", "response.js"), `export * from ${JSON.stringify(twist("response.ts"))};\n`);
await Bun.write(join(out, "web", "src", "cookies.js"), `export * from ${JSON.stringify(twist("response.ts"))};\n`);
// (Specs that read the document's swap script from Solid's server source: Twist's, under Solid's name.)
const reveal = /const REVEAL = (`[^`]+`)/.exec(await Bun.file(twist("server.ts")).text())![1];
await Bun.write(join(out, "web", "src", "server.ts"), `export * from ${JSON.stringify(twist("server.ts"))};\nconst REPLACE_SCRIPT = ${reveal};\n`);
// (Specs that load the built server by path, `<cwd>/dist/server.js`: Twist's server.)
await Bun.write(join(here, "dist", "server.js"), `export * from ${JSON.stringify(twist("server.ts"))};\n`);
// The signals package's core entry is its public core too.
mkdirSync(join(out, "signals", "src", "core"), { recursive: true });
await Bun.write(join(out, "signals", "src", "core", "index.js"), `export * from ${JSON.stringify(twist("index.ts"))};\n`);
// (Its development module: the diagnostics channel's emit, report, owner path and console footer, Twist's.)
await Bun.write(
  join(out, "signals", "src", "core", "dev.js"),
  `export { emitDiagnostic, ownerPath, reportDiagnostic, setConsoleFooter, GRAPH_SIZE_WARN_AT, GRAPH_SIZE_WARN_EVERY } from ${JSON.stringify(twist("diagnostics.ts"))};\nexport const asyncTailFlights = 0;\n`,
);
// (The attribution engine, at the package's and the core's paths: Twist's.)
for (const pkg of ["signals", "solid"]) await Bun.write(join(out, pkg, "src", "attribution.js"), `export * from ${JSON.stringify(twist("attribution/index.ts"))};\n`);
for (const name of ["attribution", "attribution-hooks", "attribution-queries", "attribution-costs", "attribution-feedback"])
  await Bun.write(join(out, "signals", "src", "core", name + ".js"), `export * from ${JSON.stringify(twist(`attribution/${name}.ts`))};\n`);
// (Its error module: the public not-ready error.)
await Bun.write(join(out, "signals", "src", "core", "error.js"), `export { NotReadyError } from ${JSON.stringify(twist("index.ts"))};\n`);
// Solid's client and server modules, by their paths: Twist's public entries.
mkdirSync(join(out, "solid", "src", "client"), { recursive: true });
mkdirSync(join(out, "solid", "src", "server"), { recursive: true });
for (const name of ["hydration", "flow", "component", "core", "container-trace"])
  await Bun.write(join(out, "solid", "src", "client", name + ".js"), `export * from ${JSON.stringify(twist("index.ts"))};\n`);
await Bun.write(join(out, "solid", "src", "client", "container-trace.js"), `export * from ${JSON.stringify(twist("container-trace.ts"))};\n`);
await Bun.write(join(out, "solid", "src", "client", "core.js"), `export * from ${JSON.stringify(twist("index.ts"))};\nexport { createComponent as observedComponent } from ${JSON.stringify(twist("control.ts"))};\n`);
// (With Twist's names for what Solid's server modules export besides its public API.)
const serverInternals =
  `export { ssrHandleError, getProjectionTrace, shareAsyncIterable, runInServerComponentScope, NoHydrateContext } from ${JSON.stringify(twist("server-internal.ts"))};\n` +
  `export { idScope as ssrScope, resetOwner as resetOwnerForRerun } from ${JSON.stringify(twist("signals.ts"))};\n` +
  `export const ownerId = (o) => o.id;\n`;
for (const name of ["index", "flow", "hydration", "shared", "signals"])
  await Bun.write(join(out, "solid", "src", "server", name + ".js"), `export * from ${JSON.stringify(twist("server-solid.ts"))};\n` + serverInternals);
mkdirSync(join(out, "signals", "src", "store"), { recursive: true });
await Bun.write(join(out, "signals", "src", "store", "store.js"), `export * from ${JSON.stringify(twist("store.ts"))};\n`);
const ours = twist("index.ts");
// And by package name: packages that are ours (Bun's resolver finds packages; a plugin cannot invent them).
for (const name of ["solid-js", "@solidjs/signals"]) {
  const dir = join(here, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name, type: "module", main: "index.js", exports: { ".": "./index.js", "./internal": "./internal.js", "./internal/container-trace": "./container-trace.js", "./attribution": "./attribution.js" } }));
  await Bun.write(join(dir, "index.js"), `export * from ${JSON.stringify(ours)};\n`);
  await Bun.write(join(dir, "internal.js"), `export * from ${JSON.stringify(twist("internal.ts"))};\n`);
  await Bun.write(join(dir, "container-trace.js"), `export * from ${JSON.stringify(twist("container-trace.ts"))};\n`);
  await Bun.write(join(dir, "attribution.js"), `export * from ${JSON.stringify(twist("attribution/index.ts"))};\n`);
}
// The web runtime, and the JSX runtime Bun's transform imports from it.
const web = join(here, "..", "..", "src", "twist", "web.ts").split("\\").join("/");
const webDir = join(here, "node_modules", "@solidjs", "web");
mkdirSync(webDir, { recursive: true });
await Bun.write(
  join(webDir, "package.json"),
  JSON.stringify({ name: "@solidjs/web", type: "module", exports: { ".": "./index.js", "./jsx-runtime": "./index.js", "./jsx-dev-runtime": "./index.js", "./serialization": "./serialization.js", "./server-functions/client": "./server-functions-client.js", "./server-functions/server": "./server-functions-server.js", "./storage": "./storage.js", "./frames": "./frames.js", "./frames/server": "./frames-server.js" } }),
);
await Bun.write(join(webDir, "index.js"), `export * from ${JSON.stringify(web)};\n`);
// Serialization (the wire's codec and the hydration serializer): Twist's, by package name and by Solid's own paths.
const serialization = `export * from ${JSON.stringify(twist("serialization.ts"))};\n`;
await Bun.write(join(webDir, "serialization.js"), serialization);
await Bun.write(join(webDir, "server-functions-client.js"), `export * from ${JSON.stringify(twist("server-functions/client.ts"))};\n`);
await Bun.write(join(webDir, "server-functions-server.js"), `export * from ${JSON.stringify(twist("server-functions/server.ts"))};\n`);
await Bun.write(join(webDir, "storage.js"), `export { provideRequestEvent } from ${JSON.stringify(twist("request.ts"))};\n`);
for (const file of ["serializer.js", "serializer-decode.js"]) await Bun.write(join(out, "web", "serialization", "src", file), serialization);
// Server functions: Twist's modules at Solid's paths.
for (const name of ["shared", "registry", "client", "server", "flash"])
  await Bun.write(join(out, "web", "server-functions", "src", name + ".js"), `export * from ${JSON.stringify(twist(`server-functions/${name}.ts`))};\n`);
// (Specs that load the server functions' built tiers by path: Twist's one module for each tier.)
for (const base of [join(out, "web", "server-functions", "dist"), join(here, "server-functions", "dist")]) {
  mkdirSync(base, { recursive: true });
  for (const side of ["client", "server"])
    for (const tier of ["", ".dev", ".observe"]) await Bun.write(join(base, side + tier + ".js"), `export * from ${JSON.stringify(twist(`server-functions/${side}.ts`))};\n`);
  // (The development tier's server: the same module, its handler answering with development fidelity.)
  const server = JSON.stringify(twist("server-functions/server.ts"));
  await Bun.write(
    join(base, "server.dev.js"),
    `export * from ${server};\nimport { handleServerFunctionRequest as handle, setServerFunctionsDev } from ${server};\n` +
      `export async function handleServerFunctionRequest(...args) {\n  setServerFunctionsDev(true);\n  try {\n    return await handle(...args);\n  } finally {\n    setServerFunctionsDev(false);\n  }\n}\n`,
  );
}
// Frames: Twist's port at Solid's paths.
for (const name of ["client", "frame-client", "frame-container-plugin", "frame-transport", "tree-rewrite", "bind-tier", "regions-tier", "assets-tier", "wire-tier", "frame-sink", "server", "trace-tier"])
  await Bun.write(join(out, "web", "frames", "src", name + ".js"), `export * from ${JSON.stringify(twist(`frames/${name}.ts`))};\n`);
await Bun.write(join(webDir, "frames.js"), `export * from ${JSON.stringify(twist("frames/client.ts"))};\n`);
await Bun.write(join(webDir, "frames-server.js"), `export * from ${JSON.stringify(twist("frames/server.ts"))};\n`);
// The server builds: Twist's server runtime, and Solid's API as it runs on a server.
for (const [name, file] of [["@twist/web-server", "server.ts"], ["@twist/solid-server", "server-solid.ts"]]) {
  const dir = join(here, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name, type: "module", exports: { ".": "./index.js", "./jsx-runtime": "./index.js", "./jsx-dev-runtime": "./index.js" } }));
  await Bun.write(join(dir, "index.js"), `export * from ${JSON.stringify(twist(file))};\n` + (name === "@twist/solid-server" ? serverDev : ""));
}
{
  const dir = join(here, "node_modules", "@twist", "vitest");
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name: "@twist/vitest", type: "module", exports: { ".": "./index.js" } }));
  await Bun.write(join(dir, "index.js"), `export * from ${JSON.stringify(join(here, "vitest.ts").split("\\").join("/"))};\n`);
}
console.log(`Solid's tests at ${REF} (${git(["rev-parse", "--short", "HEAD"], clone)}) in solid-tests/`);
