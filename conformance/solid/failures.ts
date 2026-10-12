// Every failing test of the last run (report.md), with the first lines of its error: failures.txt. `bun failures.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const rows = readFileSync(join(here, "report.md"), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("| ") && !l.includes("not ours"))
  .map((l) => l.split("|").map((c) => c.trim()))
  .filter((c) => Number(c[3]) > 0)
  .map((c) => c[1]!);
const out: string[] = [];
const queue = [...rows];
async function worker() {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const p = Bun.spawn([process.execPath, "test", "./solid-tests/" + file, "--timeout", "3000"], { cwd: here, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 60_000);
    const text = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    clearTimeout(timer);
    // Each failure: the error lines just before its "(fail)" line.
    const lines = text.split("\n");
    const found: string[] = [];
    let errs: string[] = [];
    for (const l of lines) {
      if (/^(error|\w*Error):/.test(l) || /^(Expected|Received|[-+] )/.test(l)) errs.push(l.slice(0, 160));
      if (l.startsWith("(fail) ")) {
        if (!l.includes("marked as failing")) found.push(`  ${l.slice(7, 220)}\n${errs.slice(0, 6).map((e) => "      " + e).join("\n")}`);
        errs = [];
      }
    }
    out.push(`## ${file}\n${found.join("\n")}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
out.sort();
writeFileSync(join(here, "failures.txt"), out.join("\n\n") + "\n");
console.log(`${rows.length} files`);
