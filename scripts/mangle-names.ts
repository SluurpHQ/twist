// Writes compiler/src/mangle-names.txt: the private names of Twist's core (`_name` properties), each with the short
// name a production browser build gives it, the most used first. Run after the core gains or loses fields:
//   bun scripts/mangle-names.ts
// A name missing from the list keeps its long name: it costs bytes, never correctness.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const src = join(root, "src");
/** Names that objects from outside Twist carry too (React elements, contexts, lazy components), or that name attributes. */
const RESERVED = new Set(["_owner", "_store", "_self", "_source", "_debugStack", "_debugTask", "_debugInfo", "_debugOwner", "_context", "_currentValue", "_currentValue2", "_payload", "_init", "_status", "_result", "_key", "_valueTracker"]);

const files: string[] = [];
(function walk(dir: string) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js)$/.test(n) && !n.endsWith(".d.ts")) files.push(p.replace(/\\/g, "/"));
  }
})(src);

const loaders = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), js: new Bun.Transpiler({ loader: "js" }) };
/** A file's code, its types and comments gone. */
const code = (f: string) => loaders[f.slice(f.lastIndexOf(".") + 1) as keyof typeof loaders].transformSync(readFileSync(f, "utf8"));
const PROP = /(?<=\.|\?\.)(_[a-zA-Z]\w*)|(?<![\w$.])(_[a-zA-Z]\w*)(?=\s*:)/g;
const TOKEN = /(?<![\w$])_[a-zA-Z]\w*/g;

const core = new Set<string>();
const uses = new Map<string, number>();
const taken = new Set<string>();
for (const f of files) {
  const js = code(f);
  for (const m of js.matchAll(TOKEN)) taken.add(m[0]);
  for (const m of js.matchAll(PROP)) {
    const name = (m[1] ?? m[2])!;
    uses.set(name, (uses.get(name) ?? 0) + 1);
    if (f.includes("/twist/core/")) core.add(name);
  }
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function* shortNames() {
  for (const a of ALPHABET) yield "_" + a;
  for (const a of ALPHABET) for (const b of ALPHABET + "0123456789") yield "_" + a + b;
}
const names = [...core].filter((n) => !RESERVED.has(n)).sort((a, b) => (uses.get(b) ?? 0) * b.length - (uses.get(a) ?? 0) * a.length || a.localeCompare(b));
const free = shortNames();
const lines: string[] = [];
for (const name of names) {
  let short: string;
  do short = free.next().value!;
  while (taken.has(short));
  if (short.length < name.length) lines.push(`${name} ${short}`);
}
writeFileSync(join(root, "compiler", "src", "mangle-names.txt"), lines.join("\n") + "\n");
console.log(`${lines.length} names`);
