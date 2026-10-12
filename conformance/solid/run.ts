// Every test file of Solid's run against Twist, one process each, counted into report.md: pass, fail per file, and
// what stopped a file from loading (an export Twist lacks, an internal module). `bun run.ts [filter]`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const here = import.meta.dir;
const filter = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
// `--accept`: the baseline rewritten even when files lost passes (a change that rightly costs some).
const accept = process.argv.includes("--accept");
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(test|spec)\.[jt]sx?$/.test(f.name) && p.replace(/\\/g, "/").includes(filter)) files.push(p);
  }
};
for (const part of ["signals/tests", "solid/test", "web/test"]) walk(join(here, "solid-tests", part));

type Row = { file: string; pass: number; fail: number; skip?: number; beyond?: number; note?: string };
const rows: Row[] = [];
/** What failed, by message: counted across files into errors.txt, with the files it came from. */
const errors = new Map<string, { n: number; files: Set<string> }>();
const count = (out: string, word: string) => Number(new RegExp(`^\\s*(\\d+) ${word}$`, "m").exec(out)?.[1] ?? 0);
const queue = [...files];
async function worker() {
  for (let f = queue.shift(); f; f = queue.shift()) {
    const rel = relative(here, f).replace(/\\/g, "/");
    // JavaScriptCore's watchdog ends runaway synchronous code (a loop no test timeout can interrupt) after 10 s.
    const p = Bun.spawn([process.execPath, "test", "./" + rel, "--timeout", "2000"], { cwd: here, stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_JSC_watchdog: "10000" } });
    const timer = setTimeout(() => p.kill(), 30_000);
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    clearTimeout(timer);
    const row: Row = { file: rel.replace(/^solid-tests\//, ""), pass: count(out, "pass"), fail: count(out, "fail") };
    // (A test Solid marks failing — a bug of its own it pins — that Twist passes: not a failure of Twist's.)
    const beyond = out.match(/marked as failing but it passed/g)?.length ?? 0;
    if (beyond) (row.fail -= beyond), (row.beyond = beyond);
    // (Skipped by skips.ts: what Twist leaves out, each with its reason there.)
    const skip = count(out, "skip");
    if (skip) row.skip = skip;
    // A file that did not load: why (an export Twist lacks, an internal module).
    // (A SyntaxError at a line's start: one in a dumped object is not why.)
    const load = /(Export named '[^']+' not found|Cannot find module '[^']+'|^(?:error: )?SyntaxError[^\n]*)/m.exec(out)?.[1];
    if (!row.pass && load) row.note = load.replace(/ in module.*$/, "").slice(0, 120);
    rows.push(row);
    for (const m of out.matchAll(/^(?:\w*Error|error):[^\n]*/gm)) {
      const msg = m[0].replace(/\d+/g, "N").slice(0, 160);
      const e = errors.get(msg) ?? errors.set(msg, { n: 0, files: new Set() }).get(msg)!;
      e.n++;
      e.files.add(row.file);
    }
  }
}
// The server tests first: they write the artifacts the hydration tests replay (Twist's own server output, not the
// copies from Solid's repo).
const later = queue.splice(0).filter((f) => !/[\\/]test[\\/]server[\\/]/.test(f) || !queue.push(f));
await Promise.all(Array.from({ length: 8 }, worker));
queue.push(...later);
await Promise.all(Array.from({ length: 8 }, worker));
rows.sort((a, b) => a.file.localeCompare(b.file));

// Files that reach into Solid's own modules (its internals, its build output, its dev tooling): they test Solid's
// implementation, not its behaviour, and cannot run against another.
const INTERNAL = /Cannot find module 'solid-js\/(internal|attribution|refresh)'|Cannot find module '(\.\.\/)+(src\/(attribution|core\/|client\/|client\.js|store\/(store|target)\.js|server\/)|dist\/|frames\/src|server-functions\/src)|Export named '(DEV|OBSERVE|\$RECORD|clearSnapshots|markSnapshotScope|setSnapshotCapture|releaseSnapshotScope)'/;
for (const r of rows) if (r.note && INTERNAL.test(r.note)) r.note = "not ours: " + r.note;
// More of the same: Solid's dev hooks, its own source modules, its diagnostics package, its build output.
const INTERNAL_MORE = /Export named '(\$DEVCOMP|_resetExternalSourceConfig)'|Cannot find module '(\.\.\/)+src\/(map|render|refresh\/index|server-mock)\.js'|Cannot find module 'solid-js\/internal\/|Cannot find module '@solidjs\/diagnostics'|[\\/]dist[\\/]/;
for (const r of rows) if (r.note && !r.note.startsWith("not ours") && INTERNAL_MORE.test(r.note)) r.note = "not ours: " + r.note;
// Files that test Solid's published build or its package layout (its dist, its export conditions).
const BUILD = /(^|\/)(dist-[^/]*|exports-server-conditions|internal-surface)\.(test|spec)\.[jt]sx?$/;
for (const r of rows) if (BUILD.test(r.file)) r.note = "not ours: Solid's published build";
// The deprecated <Dynamic> wrapper (kept in 2.0 for Solid 1 code): left out of Twist, dynamic() replaces it.
for (const r of rows) if (r.note && /Export named 'Dynamic'/.test(r.note)) r.note = "not ours: <Dynamic> (deprecated; dynamic() replaces it)";
// Files that run Solid's built packages (or its repo's scripts) in a child process, or walk its graph's own fields.
for (const r of rows) {
  const src = readFileSync(join(here, "solid-tests", r.file), "utf8");
  if (/\bexecFileSync\(/.test(src)) r.note = "not ours: runs Solid's built packages in a child process";
  else if (/\bfunction createMockSSRContext\(/.test(src)) r.note = "not ours: drives Solid's server half through a mock of its renderer (the solid-js / web seam)";
  else if (!r.pass && /\._nextSub\b|\._subs\b/.test(src)) r.note = "not ours: reads Solid's graph fields";
}
const notOurs = rows.filter((r) => r.note?.startsWith("not ours"));
const sum = (k: "pass" | "fail" | "beyond" | "skip") => rows.filter((r) => !r.note?.startsWith("not ours")).reduce((n, r) => n + (r[k] ?? 0), 0);
const unloaded = rows.filter((r) => r.note && !r.note.startsWith("not ours"));
const reasons = new Map<string, number>();
for (const r of unloaded) reasons.set(r.note!, (reasons.get(r.note!) ?? 0) + 1);
const md = [
  `# Solid's tests on Twist\n`,
  `${sum("pass")} pass, ${sum("fail")} fail, ${files.length} files (${unloaded.length} did not load, ${notOurs.length} test Solid's internals), ${sum("skip")} tests skipped (by Solid, or by skips.ts)\n`,
  `${sum("beyond")} more pass that Solid itself fails (its own \`.fails\` tests, pinning its known bugs)\n`,
  `## Why files did not load\n`,
  ...[...reasons].sort((a, b) => b[1] - a[1]).map(([why, n]) => `- ${n} × ${why}`),
  `\n## Files\n`,
  `| file | pass | fail | skip | beyond Solid | note |`,
  `|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.file} | ${r.pass} | ${r.fail} | ${r.skip ?? ""} | ${r.beyond ?? ""} | ${r.note ?? ""} |`),
].join("\n");
writeFileSync(join(here, "report.md"), md + "\n");
// Against the last full run with no losses: files that lost passes. A run that lost some keeps that baseline.
const json = join(here, "report.json");
let lostAny = false;
if (existsSync(json) && !filter) {
  const before = new Map<string, Row>((JSON.parse(readFileSync(json, "utf8")) as Row[]).map((r) => [r.file, r]));
  const lost = rows.filter((r) => (before.get(r.file)?.pass ?? 0) > r.pass).map((r) => `  ${r.file}: ${before.get(r.file)!.pass} -> ${r.pass}`);
  lostAny = lost.length > 0;
  console.log(lost.length ? "lost passes:\n" + lost.join("\n") : "no file lost passes");
}
if (!filter && (!lostAny || accept)) writeFileSync(json, JSON.stringify(rows));
writeFileSync(join(here, "errors.txt"), [...errors].sort((a, b) => b[1].n - a[1].n).map(([m, e]) => `${e.n}\t${m}\n\t\t${[...e.files].join(", ")}`).join("\n") + "\n");
console.log(md.split("\n").slice(0, 30).join("\n"));
