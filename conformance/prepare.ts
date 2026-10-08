// React's own tests, fetched (a sparse clone of facebook/react at REF) and copied into react-tests/ with their
// `// @gate` pragmas applied for stable React 19. `bun prepare.ts`, then `bun test ./react-tests`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gateSource } from "./gates.ts";

const REF = process.env.REACT_REF ?? "main";
const here = import.meta.dir;
const clone = join(tmpdir(), "sluurp-react-src");
const PARTS = ["packages/react/src/__tests__", "packages/react-dom/src/__tests__", "packages/shared"];

const git = (args: string[], cwd?: string) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!r.success) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
};
if (!existsSync(join(clone, ".git"))) git(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/facebook/react.git", clone]);
git(["sparse-checkout", "set", ...PARTS], clone);
if (REF !== "main") git(["fetch", "-q", "--depth", "1", "origin", REF], clone), git(["checkout", "-q", "FETCH_HEAD"], clone);
const at = git(["rev-parse", "--short", "HEAD"], clone);

const out = join(here, "react-tests");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(clone, "packages/shared"), join(out, "shared"), { recursive: true });

function copy(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    const a = join(from, f), b = join(to, f);
    if (statSync(a).isDirectory()) copy(a, b);
    else writeFileSync(b, /-test(\.internal)?\.js$/.test(f) ? gateSource(readFileSync(a, "utf8")) : readFileSync(a));
  }
}
copy(join(clone, "packages/react/src/__tests__"), join(out, "react"));
copy(join(clone, "packages/react-dom/src/__tests__"), join(out, "react-dom"));
writeFileSync(join(out, "REF"), at + "\n");
console.log(`React's tests at ${at} in react-tests/`);
