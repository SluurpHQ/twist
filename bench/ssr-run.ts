// Server rendering: the 1000-row table to HTML, median of 100 renders after a warm-up, in Bun.
// bun bench/ssr-run.ts; needs bench/build.ts built.
import { join } from "node:path";

const rows: Record<string, { "render 1k rows (ms)": number; "HTML (KB)": number }> = {};
for (const name of ["react", "preact", "sluurp", "solid", "twist"]) {
  const { render } = await import(join(import.meta.dir, "..", "test", "out", "bench", `ssr-${name}`, "app.js"));
  const html: string = render();
  const trs = html.match(/<tr[\s>]/g)?.length ?? 0;
  if (trs !== 1000) throw new Error(`${name}: ${trs} rows`);
  for (let i = 0; i < 30; i++) render();
  const ts: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    render();
    ts.push(performance.now() - t);
  }
  ts.sort((a, b) => a - b);
  rows[name] = { "render 1k rows (ms)": +ts[50]!.toFixed(2), "HTML (KB)": +(html.length / 1024).toFixed(0) };
}
console.table(rows);
