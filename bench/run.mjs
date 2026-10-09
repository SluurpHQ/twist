// Runs the benchmark in WebKit (JavaScriptCore, as on iPhones and in Bun) and Chromium, React against ours.
// node bench/run.mjs [playwright-core path]; needs test/serve.ts running and bench/build.ts built.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { webkit, chromium } = require(process.argv[2] ?? "playwright-core");
const runs = 31;
const rows = {};
for (const [engine, type] of [["webkit", webkit], ["chromium", chromium]]) {
  // WEBKIT_EXE: a WebKit build already on disk, when this playwright-core wants a newer one.
  const browser = await type.launch(engine === "webkit" && process.env.WEBKIT_EXE ? { executablePath: process.env.WEBKIT_EXE } : {});
  for (const name of ["vanilla", "react", "sluurp", "signals"]) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:8820/bench/${name}/index.html`);
    const got = await page.evaluate((n) => window.bench(n), runs);
    for (const [k, v] of Object.entries(got)) ((rows[k] ??= {})[`${engine} ${name}`] = v);
    await page.close();
  }
  await browser.close();
}
console.table(rows);
