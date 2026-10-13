// Solid 1's own tests (a sparse clone of solidjs/solid at REF) into solid-tests/, run against Twist's Solid 1 entry
// (bun run.ts). Only the tests are taken, never Solid's code.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compile } from "../../test/twist-compile.ts";

const REF = process.env.SOLID1_REF ?? "v1.9.9";
const here = import.meta.dir;
const clone = join(tmpdir(), "twist-solid1-tests");
const PARTS = ["packages/solid/test", "packages/solid/store/test", "packages/solid/web/test"];

const git = (args: string[], cwd?: string) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (!r.success) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
};
if (!existsSync(join(clone, ".git"))) git(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", REF, "https://github.com/solidjs/solid.git", clone]);
git(["sparse-checkout", "set", "--no-cone", ...PARTS.map((p) => `/${p}/`)], clone);

const out = join(here, "solid-tests");
rmSync(out, { recursive: true, force: true });
for (const p of PARTS) cpSync(join(clone, p), join(out, p.replace(/^packages\/solid\/?/, "")), { recursive: true });
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : [join(d, f.name)]));
for (const f of walk(out)) {
  if (!/\.tsx?$/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  let t = s.replace(/\r\n/g, "\n").replace(/\)\.to\.(to[A-Z]|not\.)/g, ").$1");
  t = t.replace(/\b(test|it)\.fails\b/g, "$1.failing");
  if (/@jsxImportSource\s+(\S+)/.test(t)) {
    const source = /@jsxImportSource\s+(\S+)/.exec(t)![1]!;
    t = `/** @jsxImportSource ${source} */\n` + t.replace(/^\s*\*?\s*@jsxImportSource\s+\S+\s*$/m, "");
  }
  t = t.replace(/(from\s*)(["'])vitest\2/g, '$1"@twist/vitest"');
  if (f.endsWith(".tsx")) t = compile(t, f);
  if (t !== s) writeFileSync(f, t);
}
// Where the tests reach for their package itself: Twist's Solid 1 modules.
const solid1 = (f: string) => JSON.stringify(join(here, "..", "..", "src", "twist", "solid1", f).split("\\").join("/"));
const write = (rel: string, text: string) => {
  mkdirSync(join(out, rel, ".."), { recursive: true });
  writeFileSync(join(out, rel), text);
};
write("src/index.js", `export * from ${solid1("index.ts")};\n`);
write("store/src/index.js", `export * from ${solid1("store.ts")};\n`);
for (const name of ["index.js", "server-mock.js"]) write(`web/src/${name}`, `export * from ${solid1("web.ts")};\n`);
// By package name.
const pkg = join(here, "node_modules", "solid-js");
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "solid-js", version: "1.9.9", type: "module", exports: { ".": "./index.js", "./web": "./web.js", "./store": "./store.js", "./jsx-runtime": "./jsx.js", "./jsx-dev-runtime": "./jsx.js" } }));
writeFileSync(join(pkg, "index.js"), `export * from ${solid1("index.ts")};\n`);
writeFileSync(join(pkg, "web.js"), `export * from ${solid1("web.ts")};\n`);
writeFileSync(join(pkg, "store.js"), `export * from ${solid1("store.ts")};\n`);
writeFileSync(join(pkg, "jsx.js"), `export * from ${solid1("jsx-runtime.ts")};\n`);
const web = join(here, "node_modules", "@solidjs", "web");
mkdirSync(web, { recursive: true });
writeFileSync(join(web, "package.json"), JSON.stringify({ name: "@solidjs/web", type: "module", exports: { ".": "./index.js" } }));
writeFileSync(join(web, "index.js"), `export * from ${solid1("web.ts")};\n`);
const vitest = join(here, "node_modules", "@twist", "vitest");
mkdirSync(vitest, { recursive: true });
writeFileSync(join(vitest, "package.json"), JSON.stringify({ name: "@twist/vitest", type: "module", exports: { ".": "./index.js" } }));
writeFileSync(join(vitest, "index.js"), `export * from ${JSON.stringify(join(here, "..", "solid", "vitest.ts").split("\\").join("/"))};\n`);
console.log("ok");
