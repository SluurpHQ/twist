// DOM calls one benchmark case makes: bun jsc-ops.ts [app] [case].
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { join } from "node:path";

GlobalRegistrator.register();
document.body.innerHTML = '<div id="main"></div>';
const [app = "sluurp-plain", name = "create 1k"] = process.argv.slice(2);
const counts: Record<string, number> = {};
let on = false;
const spy = (proto: any, key: string) => {
  const d = Object.getOwnPropertyDescriptor(proto, key);
  if (!d) return;
  if (typeof d.value === "function") {
    const fn = d.value;
    proto[key] = function (this: any, ...a: any[]) {
      if (on) counts[key] = (counts[key] ?? 0) + 1;
      return fn.apply(this, a);
    };
  } else if (d.set) {
    Object.defineProperty(proto, key, { ...d, set(v) { if (on) counts["set " + key] = (counts["set " + key] ?? 0) + 1; d.set!.call(this, v); } });
  }
};
const w = globalThis as any;
for (const k of ["insertBefore", "appendChild", "removeChild", "replaceChild", "cloneNode"]) spy(w.Node.prototype, k);
for (const k of ["setAttribute", "removeAttribute", "addEventListener", "remove"]) spy(w.Element.prototype, k);
for (const k of ["createElement", "createElementNS", "createTextNode"]) spy(w.Document.prototype, k);
for (const k of ["textContent", "nodeValue"]) spy(w.Node.prototype, k);
for (const k of ["className"]) spy(w.Element.prototype, k);
spy(w.CharacterData.prototype, "data");
const dir = join(import.meta.dir, "..", "test", "out", "bench", app);
await import(join(dir, "app.js"));
const one = w.benchOne as (n: string) => void;
one(name);
on = true;
one(name);
on = false;
console.log(app, name, JSON.stringify(counts));
