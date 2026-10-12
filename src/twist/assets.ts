// The client's ref-counted assets (ported from Solid's web runtime, MIT): what mounts acquires a stylesheet, a module
// preload or an inline style, and releases it on cleanup. The first acquire makes the element (or adopts the one the
// server sent); the last release removes it after a grace period, so a quick release and re-acquire keeps it.

export type AssetDescriptor =
  | { type: "style" | "module"; href: string; attrs?: Record<string, string>; policy?: undefined }
  | { type: "inline-style"; id: string; content?: string; attrs?: Record<string, string>; policy?: undefined }
  | { policy: "exclusive"; key: string; value: unknown; get: () => unknown; set: (v: unknown) => void };

const GRACE = 100;
const registry = new Map<string, any>();

const keyOf = (d: AssetDescriptor) =>
  d.policy === "exclusive" ? "x|" + d.key : d.type === "inline-style" ? "i|" + d.id : d.type + "|" + d.href;

function find(selector: string, attr: string, value: string): Element | null {
  for (const n of document.querySelectorAll(selector)) if (n.getAttribute(attr) === value) return n;
  return null;
}

function mount(d: Exclude<AssetDescriptor, { policy: "exclusive" }>): Element {
  let el: any;
  if (d.type === "inline-style") {
    el = find("style[data-asset]", "data-asset", d.id);
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-asset", d.id);
      el.textContent = d.content || "";
    }
  } else {
    const rel = d.type === "module" ? "modulepreload" : "stylesheet";
    el = find(`link[rel="${rel}"]`, "href", d.href);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      el.href = d.href;
    }
  }
  if (d.attrs) for (const name in d.attrs) el.setAttribute(name, d.attrs[name]!);
  if (!el.isConnected) document.head.appendChild(el);
  return el;
}

/** An asset held while what needs it is mounted; the release it answers lets go of it (once). */
export function acquireAsset(d: AssetDescriptor): () => void {
  const key = keyOf(d);
  let entry = registry.get(key);
  let released = false;
  // Exclusive: one value at a time, the latest writer's; the original back when the last lets go.
  if (d.policy === "exclusive") {
    if (!entry) registry.set(key, (entry = { original: d.get(), set: d.set, writers: [] }));
    const writer = { value: d.value };
    entry.writers.push(writer);
    entry.set(writer.value);
    return () => {
      if (released) return;
      released = true;
      const at = entry.writers.indexOf(writer);
      const wasTop = at === entry.writers.length - 1;
      entry.writers.splice(at, 1);
      if (!wasTop) return;
      if (entry.writers.length) entry.set(entry.writers[entry.writers.length - 1].value);
      else entry.set(entry.original), registry.delete(key);
    };
  }
  if (!entry) registry.set(key, (entry = { count: 0, element: null, timer: null }));
  if (entry.timer) clearTimeout(entry.timer), (entry.timer = null);
  entry.count++;
  if (!entry.element?.isConnected) entry.element = mount(d);
  // (Warmed as a preload: now the stylesheet itself.)
  else if (d.type === "style" && entry.element.getAttribute("rel") === "preload") entry.element.removeAttribute("as"), entry.element.setAttribute("rel", "stylesheet");
  return () => {
    if (released) return;
    released = true;
    if (--entry.count > 0) return;
    entry.timer = setTimeout(() => {
      registry.delete(key);
      entry.element?.remove();
    }, GRACE);
  };
}
