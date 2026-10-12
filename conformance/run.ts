// Every test file of React's run against @sluurp/dom, one process each (a hung file times out alone), counted into
// report.json and report.md: pass, fail, skip per file, and the total. `bun run.ts [filter]`.
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { NOT_OURS } from "./not-ours.ts";

const here = import.meta.dir;
const notOurs = Object.values(NOT_OURS).reduce((n, t) => n + Object.keys(t).length, 0);
const filter = process.argv[2] ?? "";
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/(-test(\.internal)?\.js|\.spec\.tsx?)$/.test(f.name) && p.includes(filter)) files.push(p);
  }
};
walk(join(here, "react-tests", "react"));
walk(join(here, "react-tests", "react-dom"));
walk(join(here, "react-tests", "use-sync-external-store"));
walk(join(here, "redux-tests"));

type Row = { file: string; pass: number; fail: number; skip: number; note?: string };
const rows: Row[] = [];
const errors = new Map<string, number>();
const count = (out: string, word: string) => Number(new RegExp(`^\\s*(\\d+) ${word}$`, "m").exec(out)?.[1] ?? 0);

// COVERAGE=<dir>: each test file's coverage of src/ as lcov, in a folder of its own there.
let covered = 0;
const coverage = () => (process.env.COVERAGE ? ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${process.env.COVERAGE}/${covered++}`] : []);
const queue = [...files];
async function worker() {
  for (let f = queue.shift(); f; f = queue.shift()) {
    const p = Bun.spawn([process.execPath, "test", "./" + relative(here, f).replace(/\\/g, "/"), "--timeout", "2000", ...coverage()], { cwd: here, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 30_000);
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    clearTimeout(timer);
    const row: Row = { file: relative(here, f).replace(/\\/g, "/").replace(/^react-tests\//, ""), pass: count(out, "pass"), fail: count(out, "fail"), skip: count(out, "skip") };
    if (!row.pass && !row.fail && !row.skip) row.note = (/(\w*Error[^\n]*)/.exec(out)?.[1] ?? "did not run").slice(0, 160);
    rows.push(row);
    // What failed, by message: counted across files into errors.txt.
    for (const m of out.matchAll(/^(?:\w*Error|error:)[^\n]*/gm)) {
      const k = m[0].replace(/\d+/g, "N").slice(0, 140);
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
    process.stdout.write(`${row.pass}/${row.pass + row.fail} ${row.file}${row.note ? "  " + row.note : ""}\n`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
rows.sort((a, b) => a.file.localeCompare(b.file));
const total = rows.reduce((t, r) => ({ pass: t.pass + r.pass, fail: t.fail + r.fail, skip: t.skip + r.skip }), { pass: 0, fail: 0, skip: 0 });
writeFileSync(join(here, "report.json"), JSON.stringify({ total, rows }, null, 1));
writeFileSync(
  join(here, "report.md"),
  `# React's tests on @sluurp/dom\n\n${total.pass} pass, ${total.fail} fail, ${total.skip - notOurs} skipped (gated off for stable React 19), ${notOurs} set aside as not ours (not-ours.ts).\n\n| File | Pass | Fail | Skip | |\n|---|---:|---:|---:|---|\n` +
    rows.map((r) => `| ${r.file} | ${r.pass} | ${r.fail} | ${r.skip} | ${r.note ?? ""} |`).join("\n") + "\n",
);
writeFileSync(join(here, "errors.txt"), [...errors].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(5)}  ${k}`).join("\n") + "\n");
console.log(`\n${total.pass} pass, ${total.fail} fail, ${total.skip} skip`);
