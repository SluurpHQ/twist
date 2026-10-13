// Runs the benchmark in WebKit (JavaScriptCore, as on iPhones and in Bun) and Chromium, React against ours.
// node bench/run.mjs [playwright-core path]; needs test/serve.ts running and bench/build.ts built.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { webkit, chromium } = require(process.argv[2] ?? "playwright-core");
// BENCH_RUNS: runs per case (the median is shown); ENGINES=chromium: one engine.
const runs = +(process.env.BENCH_RUNS ?? 31);
// BENCH_ROUNDS: the apps taken in turn this many times, each case's best round kept (a busy machine's drift and the
// order the apps run in weigh on none of them more than the others).
const rounds = +(process.env.BENCH_ROUNDS ?? 1);
const rows = {};
for (const [engine, type] of [["webkit", webkit], ["chromium", chromium]].filter(([e]) => !process.env.ENGINES || process.env.ENGINES.split(",").includes(e))) {
  // WEBKIT_EXE: a WebKit build already on disk, when this playwright-core wants a newer one.
  const launch = () => type.launch(engine === "webkit" && process.env.WEBKIT_EXE ? { executablePath: process.env.WEBKIT_EXE } : {});
  // (Each app in a browser of its own, as js-framework-benchmark runs them: no page pays for another's heap.)
  let browser = await launch();
  // BENCH_APPS=solid,twist: some of them.
  const apps = process.env.BENCH_APPS?.split(",") ?? ["vanilla", "react", "preact", "sluurp", "signals", "solid", "twist"];
  for (let round = 0; round < rounds; round++)
    for (const name of round % 2 ? [...apps].reverse() : apps) {
      if (process.env.BENCH_FRESH) await browser.close(), (browser = await launch());
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:8820/bench/${name}/index.html`);
      const got = await page.evaluate((n) => window.bench(n), runs);
      for (const [k, v] of Object.entries(got)) {
        const row = (rows[k] ??= {});
        const col = `${engine} ${name}`;
        if (!(row[col] <= v)) row[col] = v;
      }
      // (Progress as it goes: a full run takes minutes.)
      console.error(`${engine} ${name}: create 1k ${got["create 1k"]}, create 10k ${got["create 10k"]}`);
      await page.close();
    }
  await browser.close();
}
console.table(rows);
