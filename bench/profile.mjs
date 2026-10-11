// A case's CPU profile in headless Chromium (DevTools protocol, 100 µs samples): self and total time per function.
// node bench/profile.mjs <playwright-core> [app] [case] [rounds]; needs test/serve.ts running and bench/build.ts built.
import { createRequire } from "node:module";
import { summary } from "./summary.mjs";

const require = createRequire(import.meta.url);
const [pw, app = "sluurp-plain", name = "create 1k", rounds = "200"] = process.argv.slice(2);
const { chromium } = require(pw ?? "playwright-core");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:8820/bench/${app}/index.html`);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await page.evaluate(([n]) => { for (let i = 0; i < 20; i++) window.benchOne(n); }, [name]);
await cdp.send("Profiler.start");
await page.evaluate(([n, r]) => { for (let i = 0; i < r; i++) window.benchOne(n); }, [name, +rounds]);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
console.log(summary(profile, `${app} ${name}`));
