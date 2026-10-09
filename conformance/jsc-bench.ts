// A benchmark case run in Bun (JavaScriptCore) on happy-dom, for its CPU profile:
// bun --cpu-prof-md bench/jsc.ts [app] [case] [rounds]. The DOM is happy-dom's (slower than a browser's): read our own
// functions in the profile, not the DOM's.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { join } from "node:path";

GlobalRegistrator.register();
document.body.innerHTML = '<div id="main"></div>';
const [app = "sluurp-plain", name = "create 1k", rounds = "200"] = process.argv.slice(2);
const dir = join(import.meta.dir, "..", "test", "out", "bench", app);
await import(join(dir, "app.js"));
const one = (globalThis as any).benchOne as (n: string) => void;
const t = performance.now();
for (let i = 0; i < +rounds; i++) one(name);
console.log("rows", (globalThis as any).document.querySelector("tbody")?.children.length);
console.log(`${app} ${name}: ${((performance.now() - t) / +rounds).toFixed(2)} ms a round`);
