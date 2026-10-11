// Memory each app keeps for its rows: the heap after a forced GC with 10k rows, less the heap with none.
// node bench/memory.mjs <playwright-core> [apps…]; needs test/serve.ts running and bench/build.ts built.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [pw, ...apps] = process.argv.slice(2);
const { chromium } = require(pw ?? "playwright-core");
const browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] });
for (const app of apps.length ? apps : ["solid", "twist"]) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:8820/bench/${app}/index.html`);
  const cdp = await page.context().newCDPSession(page);
  const used = async (name) => {
    await page.evaluate(([n]) => (window.benchWarm(n), window.benchRun(n)), [name]);
    await page.evaluate(() => (gc(), gc()));
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  // (Warmed first: code compiled, caches made.)
  await used("create 10k");
  const none = await used("clear 1k");
  const rows = await used("create 10k");
  console.log(`${app.padEnd(8)} ${((rows - none) / 1e4).toFixed(0)} bytes a row`);
  await page.close();
}
await browser.close();
