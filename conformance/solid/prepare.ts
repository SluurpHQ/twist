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
// Chai-style `expect(x).to.toBe(…)` (Vitest allows the `.to`; Bun's expect has none): the same assertion without it.
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : [join(d, f.name)]));
for (const f of walk(out)) {
  if (!/\.tsx?$/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  let t = s.replace(/\r\n/g, "\n").replace(/\)\.to\.(to[A-Z]|not\.)/g, ").$1");
  // The JSX import source in a comment of its own (Bun reads the line break after it, inside a longer block comment,
  // into the module's name).
  if (/@jsxImportSource\s+(\S+)/.test(t)) {
    const source = /@jsxImportSource\s+(\S+)/.exec(t)![1]!;
    t = `/** @jsxImportSource ${source} */\n` + t.replace(/^\s*\*?\s*@jsxImportSource\s+\S+\s*$/m, "");
  }
  // JSX files through Twist's pass (Bun's JSX transform runs after, when the test loads).
  if (f.endsWith(".tsx")) t = compile(t, f);
  if (t !== s) writeFileSync(f, t);
}
// Where the tests reach for their package itself (../src/index.js): Twist's module for it.
const twist = (f: string) => join(here, "..", "..", "src", "twist", f).split("\\").join("/");
for (const [pkg, file] of Object.entries(SRC)) {
  mkdirSync(join(out, pkg, "src"), { recursive: true });
  await Bun.write(join(out, pkg, "src", "index.js"), `export * from ${JSON.stringify(twist(file))};\n`);
}
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
console.log(`Solid's tests at ${REF} (${git(["rev-parse", "--short", "HEAD"], clone)}) in solid-tests/`);
