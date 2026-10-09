// Solid 2's own tests, fetched (a sparse clone of solidjs/solid at REF) into solid-tests/, unchanged: they are run
// against Twist (bun run.ts), the modules they import redirected by preload.ts. Only the tests are taken, never
// Solid's code: Twist is written clean room.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REF = process.env.SOLID_REF ?? "solid-js@2.0.0-rc.14";
const here = import.meta.dir;
const clone = join(tmpdir(), "twist-solid-tests");
const PARTS: Record<string, string> = { "packages/signals/tests": "signals", "packages/solid/test": "solid", "packages/web/test": "web" };

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
  if (!/\.(test|spec)\.tsx?$/.test(f)) continue;
  const s = readFileSync(f, "utf8");
  const t = s.replace(/\)\.to\.(to[A-Z]|not\.)/g, ").$1");
  if (t !== s) writeFileSync(f, t);
}
// Where the tests reach for the package itself (../src/index.js from each folder): ours.
mkdirSync(join(out, "src"), { recursive: true });
const ours = join(here, "..", "..", "src", "twist", "index.ts").split("\\").join("/");
await Bun.write(join(out, "src", "index.js"), `export * from ${JSON.stringify(ours)};\n`);
// And by package name: packages that are ours (Bun's resolver finds packages; a plugin cannot invent them).
for (const name of ["solid-js", "@solidjs/signals"]) {
  const dir = join(here, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  await Bun.write(join(dir, "package.json"), JSON.stringify({ name, type: "module", main: "index.js" }));
  await Bun.write(join(dir, "index.js"), `export * from ${JSON.stringify(ours)};\n`);
}
console.log(`Solid's tests at ${REF} (${git(["rev-parse", "--short", "HEAD"], clone)}) in solid-tests/`);
