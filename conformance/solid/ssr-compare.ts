// Every server test file run twice, its renders' HTML recorded (ssr-record.ts) and compared byte for byte: one way of
// rendering set against another. `bun ssr-compare.ts [treeA] [treeB]`, trees prepare.ts writes (solid-tests by
// default for both: the same code twice, which must render the same, a check that the recording is deterministic).
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = import.meta.dir;
const [treeA = "solid-tests", treeB = treeA] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = join(tmpdir(), "twist-ssr-compare");
rmSync(out, { recursive: true, force: true });

/** The name ssr-record.ts keeps a test file's renders under. */
const recordedName = (f: string) => f.replace(/\\/g, "/").replace(/^.*solid-tests[^/]*\//, "").replace(/[^\w.-]+/g, "_") + ".json";
const serverFiles = (tree: string) =>
  readdirSync(join(here, tree, "web", "test", "server"))
    .filter((f) => /\.(test|spec)\.[jt]sx?$/.test(f))
    .map((f) => `./${tree}/web/test/server/${f}`);

/** The tree's server tests run (only those named, when given), each render's HTML recorded under out/<side>. */
async function record(tree: string, side: string, only?: Set<string>) {
  const queue = serverFiles(tree).filter((f) => !only || only.has(recordedName(f)));
  for (const f of queue) rmSync(join(out, side, recordedName(f)), { force: true });
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const p = Bun.spawn([process.execPath, "test", f, "--timeout", "2000"], {
        cwd: here,
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, TWIST_SSR_RECORD: join(out, side), BUN_JSC_watchdog: "10000" },
      });
      const timer = setTimeout(() => p.kill(), 30_000);
      await p.exited;
      clearTimeout(timer);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

type Render = { kind: string; html: string };
// What differs between two runs of the same code, and says nothing of the markup: a trace's random ids. A stream's
// data scripts are compared as their statements, sorted: which flush a statement went out in is timing.
const steady = (html: string) => {
  const ids = html.replace(/\b00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]\b/g, "00-TRACE-SPAN-00").replace(/\b[0-9a-f]{32}\b/g, "TRACE-ID");
  const statements: string[] = [];
  const markup = ids.replace(/<script(?: nonce="[^"]*")?>([\s\S]*?)<\/script>/g, (_, body: string) => {
    statements.push(...body.split(";").map((s) => s.trim()).filter(Boolean));
    return "<script/>";
  });
  return markup.replace(/(<script\/>)+/g, "<script/>") + "\n-- scripts --\n" + statements.sort().join(";\n");
};
const read = (side: string, name: string): Render[] => {
  const f = join(out, side, name);
  const renders: Render[] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  return renders.map((r) => ({ ...r, html: steady(r.html) }));
};

/** How a file's renders differ between the two sides: nothing when they are the same. */
function differences(name: string): string[] {
  const a = read("a", name);
  const b = read("b", name);
  if (a.length !== b.length) return [`${name}: ${a.length} renders against ${b.length}`];
  const found: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!.html;
    const y = b[i]!.html;
    if (x === y) continue;
    let at = 0;
    while (at < x.length && x[at] === y[at]) at++;
    const near = (s: string) => JSON.stringify(s.slice(Math.max(0, at - 40), at + 60));
    found.push(`${name} #${i} (${a[i]!.kind}) differs at ${at}:\n  a ${near(x)}\n  b ${near(y)}`);
  }
  return found;
}

await record(treeA, "a");
await record(treeB, "b");
const names = [...new Set([...readdirSync(join(out, "a")), ...(existsSync(join(out, "b")) ? readdirSync(join(out, "b")) : [])])].sort();
const renders = names.reduce((n, name) => n + read("a", name).length, 0);
// A file that differs is run again on both sides, twice more: one whose output depends on timing (a stream racing its
// data) renders the same in one of the runs; a real difference, every time.
let differing = new Set(names.filter((n) => differences(n).length));
for (let again = 0; again < 2 && differing.size; again++) {
  await record(treeA, "a", differing);
  await record(treeB, "b", differing);
  differing = new Set([...differing].filter((n) => differences(n).length));
}
for (const name of differing) console.log(differences(name).join("\n"));
console.log(`${names.length} files, ${renders} renders: ${differing.size ? `${differing.size} files differ` : "all the same"}`);
process.exit(differing.size ? 1 : 0);
