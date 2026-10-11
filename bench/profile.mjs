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
// ALLOC=1: what allocates instead (sampled bytes by function and line).
if (process.env.ALLOC) {
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.evaluate(([n, r]) => { for (let i = 0; i < r; i++) window.benchOne(n); }, [name, +rounds]);
  const { profile } = await cdp.send("HeapProfiler.stopSampling");
  await browser.close();
  const bytes = new Map();
  let all = 0;
  const walk = (n, up) => {
    const k = `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber + 1}` + (n.callFrame.lineNumber < 0 && up ? ` < ${up}` : "");
    bytes.set(k, (bytes.get(k) ?? 0) + n.selfSize);
    all += n.selfSize;
    for (const c of n.children) walk(c, `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber + 1}`);
  };
  walk(profile.head);
  console.log(`${app} ${name}: ${(all / 1048576).toFixed(1)} MB sampled`);
  for (const [k, v] of [...bytes].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${((100 * v) / all).toFixed(1).padStart(5)}%  ${k}`);
  process.exit(0);
}
// EACH=1: the step alone, warmed before each round outside the profile (one profile per round, merged).
if (process.env.EACH) {
  const merged = { nodes: [], samples: [], timeDeltas: [] };
  let offset = 0;
  for (let i = 0; i < +rounds; i++) {
    await page.evaluate(([n]) => window.benchWarm(n), [name]);
    await cdp.send("Profiler.start");
    await page.evaluate(([n]) => window.benchRun(n), [name]);
    const { profile } = await cdp.send("Profiler.stop");
    let top = 0;
    for (const n of profile.nodes) {
      merged.nodes.push({ ...n, id: n.id + offset, children: n.children?.map((c) => c + offset) });
      top = Math.max(top, n.id);
    }
    merged.samples.push(...profile.samples.map((s) => s + offset));
    merged.timeDeltas.push(...profile.timeDeltas);
    offset += top + 1;
  }
  await browser.close();
  console.log(summary(merged, `${app} ${name} (each)`));
  process.exit(0);
}
// STEP=1: the step alone, warmed once (a step that undoes itself, as select row is made to).
const step = !!process.env.STEP;
if (step) await page.evaluate(([n]) => window.benchWarm(n), [name]);
await cdp.send("Profiler.start");
await page.evaluate(([n, r, step]) => { for (let i = 0; i < r; i++) step ? window.benchRun(n) : window.benchOne(n); }, [name, +rounds, step]);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
console.log(summary(profile, `${app} ${name}`));
