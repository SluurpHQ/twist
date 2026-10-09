// Every test file of Solid's run against Twist, one process each, counted into report.md: pass, fail per file, and
// what stopped a file from loading (an export Twist lacks, an internal module). `bun run.ts [filter]`.
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const here = import.meta.dir;
const filter = process.argv[2] ?? "";
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(test|spec)\.tsx?$/.test(f.name) && p.includes(filter)) files.push(p);
  }
};
for (const part of ["signals/tests", "solid/test", "web/test"]) walk(join(here, "solid-tests", part));

type Row = { file: string; pass: number; fail: number; note?: string };
const rows: Row[] = [];
/** What failed, by message: counted across files into errors.txt. */
const errors = new Map<string, number>();
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
    // A file that did not load: why (an export Twist lacks, an internal module).
    const load = /(Export named '[^']+' not found|Cannot find module '[^']+'|SyntaxError[^\n]*)/.exec(out)?.[1];
    if (!row.pass && load) row.note = load.replace(/ in module.*$/, "").slice(0, 120);
    rows.push(row);
    for (const m of out.matchAll(/^(?:\w*Error|error):[^\n]*/gm)) {
      const msg = m[0].replace(/\d+/g, "N").slice(0, 160);
      errors.set(msg, (errors.get(msg) ?? 0) + 1);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
rows.sort((a, b) => a.file.localeCompare(b.file));

// Files that reach into Solid's own modules (its internals, its build output, its dev tooling): they test Solid's
// implementation, not its behaviour, and cannot run against another.
const INTERNAL = /Cannot find module 'solid-js\/(internal|attribution|refresh)'|Cannot find module '(\.\.\/)+(src\/(attribution|core\/|client\/|client\.js|store\/(store|target)\.js|server\/)|dist\/|frames\/src|server-functions\/src)|Export named '(DEV|OBSERVE|\$RECORD|clearSnapshots|markSnapshotScope|setSnapshotCapture|releaseSnapshotScope)'/;
for (const r of rows) if (r.note && INTERNAL.test(r.note)) r.note = "not ours: " + r.note;
const notOurs = rows.filter((r) => r.note?.startsWith("not ours"));
const sum = (k: "pass" | "fail") => rows.filter((r) => !r.note?.startsWith("not ours")).reduce((n, r) => n + r[k], 0);
const unloaded = rows.filter((r) => r.note && !r.note.startsWith("not ours"));
const reasons = new Map<string, number>();
for (const r of unloaded) reasons.set(r.note!, (reasons.get(r.note!) ?? 0) + 1);
const md = [
  `# Solid's tests on Twist\n`,
  `${sum("pass")} pass, ${sum("fail")} fail, ${files.length} files (${unloaded.length} did not load, ${notOurs.length} test Solid's internals)\n`,
  `## Why files did not load\n`,
  ...[...reasons].sort((a, b) => b[1] - a[1]).map(([why, n]) => `- ${n} × ${why}`),
  `\n## Files\n`,
  `| file | pass | fail | note |`,
  `|---|---|---|---|`,
  ...rows.map((r) => `| ${r.file} | ${r.pass} | ${r.fail} | ${r.note ?? ""} |`),
].join("\n");
writeFileSync(join(here, "report.md"), md + "\n");
writeFileSync(join(here, "errors.txt"), [...errors].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n}\t${m}`).join("\n") + "\n");
console.log(md.split("\n").slice(0, 30).join("\n"));
