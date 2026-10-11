// A case's CPU profile in headless Chromium (DevTools protocol, 100 µs samples): self and total time per function.
// node bench/profile.mjs <playwright-core> [app] [case] [rounds]; needs test/serve.ts running and bench/build.ts built.
import { createRequire } from "node:module";

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

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const label = (n) => `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber + 1}`;
const self = new Map();
const total = new Map();
let count = 0;
for (const id of profile.samples) {
  const n = byId.get(id);
  const l = label(n);
  if (l.startsWith("(idle)") || l.startsWith("(program)") || l.startsWith("(garbage")) {
    self.set(l, (self.get(l) ?? 0) + 1);
    count++;
    continue;
  }
  count++;
  self.set(l, (self.get(l) ?? 0) + 1);
  const seen = new Set();
  for (let at = id; at != null; at = parent.get(at)) {
    const k = label(byId.get(at));
    if (seen.has(k)) continue;
    seen.add(k);
    total.set(k, (total.get(k) ?? 0) + 1);
  }
}
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, v]) => `${((100 * v) / count).toFixed(1).padStart(5)}%  ${l}`).join("\n");
// Who calls the hottest function, by its self time.
const hot = [...self].filter(([l]) => !l.startsWith("(")).sort((a, b) => b[1] - a[1])[0]?.[0];
const callers = new Map();
for (const id of profile.samples) {
  if (label(byId.get(id)) !== hot) continue;
  const path = [];
  for (let at = parent.get(id); at != null && path.length < 3; at = parent.get(at)) path.push(label(byId.get(at)));
  const k = path.join(" < ");
  callers.set(k, (callers.get(k) ?? 0) + 1);
}
console.log(`${app} ${name}: ${count} samples\n-- self\n${top(self, 30)}\n-- total\n${top(total, 25)}\n-- ${hot} called from\n${top(callers, 5)}`);
