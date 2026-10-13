// Solid 1's test files run against Twist, one process each, counted into report.md. `bun run.ts [filter]`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const here = import.meta.dir;
const filter = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
const accept = process.argv.includes("--accept");
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.spec\.[jt]sx?$/.test(f.name) && p.replace(/\\/g, "/").includes(filter)) files.push(p);
  }
};
walk(join(here, "solid-tests"));

type Row = { file: string; pass: number; fail: number; skip?: number; note?: string };
const rows: Row[] = [];
const errors = new Map<string, { n: number; files: Set<string> }>();
const count = (out: string, word: string) => Number(new RegExp(`^\\s*(\\d+) ${word}$`, "m").exec(out)?.[1] ?? 0);
const queue = [...files];
async function worker() {
  for (let f = queue.shift(); f; f = queue.shift()) {
    const rel = relative(here, f).replace(/\\/g, "/");
    const p = Bun.spawn([process.execPath, "test", "./" + rel, "--timeout", "2000"], { cwd: here, stdout: "pipe", stderr: "pipe", env: { ...process.env, BUN_JSC_watchdog: "10000" } });
    const timer = setTimeout(() => p.kill(), 30_000);
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    clearTimeout(timer);
    const row: Row = { file: rel.replace(/^solid-tests\//, ""), pass: count(out, "pass"), fail: count(out, "fail") };
    const skip = count(out, "skip");
    if (skip) row.skip = skip;
    const load = /(Export named '[^']+' not found|Cannot find module '[^']+'|^(?:error: )?SyntaxError[^\n]*)/m.exec(out)?.[1];
    if (!row.pass && load) row.note = load.replace(/ in module.*$/, "").slice(0, 120);
    // Files that test Solid's own dev hooks or its scheduler internals.
    if (/(^|\/)(dev|scheduler)\.spec\.ts$/.test(row.file)) row.note = "not ours: Solid 1's dev hooks and scheduler internals";
    rows.push(row);
    for (const m of out.matchAll(/^(?:\w*Error|error):[^\n]*/gm)) {
      const msg = m[0].replace(/\d+/g, "N").slice(0, 160);
      const e = errors.get(msg) ?? errors.set(msg, { n: 0, files: new Set() }).get(msg)!;
      e.n++;
      e.files.add(row.file);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
rows.sort((a, b) => a.file.localeCompare(b.file));
const ours = rows.filter((r) => !r.note?.startsWith("not ours"));
const sum = (k: "pass" | "fail" | "skip") => ours.reduce((n, r) => n + (r[k] ?? 0), 0);
const md = [
  `# Solid 1's tests on Twist\n`,
  `${sum("pass")} pass, ${sum("fail")} fail, ${files.length} files, ${sum("skip")} skipped\n`,
  `| file | pass | fail | skip | note |`,
  `|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.file} | ${r.pass} | ${r.fail} | ${r.skip ?? ""} | ${r.note ?? ""} |`),
].join("\n");
writeFileSync(join(here, "report.md"), md + "\n");
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
console.log(md);
