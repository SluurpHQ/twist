// React's <ViewTransition>: in a transition's commit, the boundaries that enter, exit, update or share a name are
// found, the browser's view transition is started for them, and their callbacks are called once it is ready.

/** What core gives this module of a ViewTransition fiber. */
export type VTFiber = { props: any; dead?: boolean; parent: VTFiber | null; type: any };

type Before = { rect: string; html: string };
type Exited = { fiber: VTFiber; outermost: boolean; name: string | null };

const live = new Set<VTFiber>();
/** Each live boundary as it was when the transition began. */
let before = new Map<VTFiber, Before>();
const exited: Exited[] = [];
let ids = 0;
const autoNames = new WeakMap<VTFiber, string>();

let isVT: (f: VTFiber) => boolean = () => false;
let elementsOf: (f: VTFiber) => Element[] = () => [];
export function configureViewTransitions(test: typeof isVT, elements: typeof elementsOf) {
  isVT = test;
  elementsOf = elements;
}

const nameOf = (f: VTFiber): string => {
  const n = f.props?.name;
  if (typeof n === "string" && n !== "auto") return n;
  let auto = autoNames.get(f);
  if (!auto) autoNames.set(f, (auto = `_T_${ids++}_`));
  return auto;
};
const explicitName = (f: VTFiber): string | null => (typeof f.props?.name === "string" && f.props.name !== "auto" ? f.props.name : null);

function measure(f: VTFiber): Before {
  let rect = "";
  let html = "";
  for (const el of elementsOf(f)) {
    const r = el.getBoundingClientRect?.();
    if (r) rect += `${r.x},${r.y},${r.width},${r.height};`;
    html += el.outerHTML;
  }
  return { rect, html };
}

/** A transition begins: how each boundary on the page looks now, to tell which updated. */
export function viewTransitionsBegin() {
  if (!live.size) return;
  before = new Map();
  for (const f of live) if (!f.dead) before.set(f, measure(f));
}

/** A boundary taken away: an exit, if a transition commits it. */
export function viewTransitionUnmounted(f: VTFiber) {
  live.delete(f);
  let outermost = true;
  for (let p = f.parent; p; p = p.parent) if (isVT(p) && p.dead) outermost = false;
  exited.push({ fiber: f, outermost, name: explicitName(f) });
}

/**
 * A commit: the boundaries it made are live from now on. In a transition, what entered, exited, updated or shared
 * is animated by the browser and told to the boundaries' callbacks.
 */
export function viewTransitionsCommit(made: VTFiber[], transition: boolean) {
  const entered = made.filter((f) => !f.dead && !live.has(f));
  for (const f of entered) live.add(f);
  const gone = exited.splice(0);
  const was = before;
  before = new Map();
  if (!transition) return;

  const fresh = new Set(entered);
  const enters = entered.filter((f) => {
    for (let p = f.parent; p; p = p.parent) if (isVT(p) && fresh.has(p)) return false;
    return true;
  });
  const exits = gone.filter((x) => x.outermost);
  // A name that leaves one place and arrives in another is shared: neither an exit nor an enter.
  const shares: Exited[] = [];
  const sharedIn = new Set<VTFiber>();
  for (const x of exits) {
    if (!x.name) continue;
    const to = enters.find((f) => explicitName(f) === x.name);
    if (to) shares.push(x), sharedIn.add(to);
  }
  const shared = new Set(shares);
  const updates: VTFiber[] = [];
  const updatedInside = new Set<VTFiber>();
  // Innermost first: a boundary whose content changed only inside a nested one that updated is not updated itself
  // (unless it moved or resized).
  const persistent = [...was.keys()].filter((f) => !f.dead && live.has(f));
  persistent.sort((a, b) => depthOf(b) - depthOf(a));
  for (const f of persistent) {
    const now = measure(f);
    const old = was.get(f)!;
    const resized = now.rect !== old.rect;
    const changed = now.html !== old.html && !updatedInside.has(f);
    if (resized || changed) {
      updates.push(f);
      for (let p = f.parent; p; p = p.parent) if (isVT(p)) updatedInside.add(p);
    }
  }

  const calls: [VTFiber | Exited, string][] = [];
  for (const f of enters) if (!sharedIn.has(f)) calls.push([f, "onEnter"]);
  for (const x of exits) calls.push([x, shared.has(x) ? "onShare" : "onExit"]);
  for (const f of updates) calls.push([f, "onUpdate"]);
  if (!calls.length) return;

  const doc: any = typeof document !== "undefined" ? document : null;
  if (!doc || typeof doc.startViewTransition !== "function") return;
  // The boundaries' elements named for the browser (and given their classes) while it animates them.
  const named: Element[] = [];
  const name = (f: VTFiber, kind: string) => {
    for (const el of elementsOf(f)) {
      const style = (el as HTMLElement).style;
      if (!style) continue;
      style.setProperty("view-transition-name", nameOf(f));
      const cls = f.props?.[kind] ?? f.props?.default;
      if (typeof cls === "string" && cls !== "auto") style.setProperty("view-transition-class", cls);
      named.push(el);
    }
  };
  for (const f of enters) name(f, sharedIn.has(f) ? "share" : "enter");
  for (const f of updates) name(f, "update");
  let started: any;
  try {
    started = doc.startViewTransition({ update: () => {}, types: [] });
  } catch {
    return;
  }
  const tell = () => {
    for (const [x, callback] of calls) {
      const f = "fiber" in x ? x.fiber : x;
      const fn = f.props?.[callback];
      if (typeof fn === "function") fn(instanceFor(nameOf(f)), []);
    }
  };
  const unname = () => {
    for (const el of named) {
      (el as HTMLElement).style.removeProperty("view-transition-name");
      (el as HTMLElement).style.removeProperty("view-transition-class");
    }
  };
  Promise.resolve(started?.ready).then(tell, tell);
  Promise.resolve(started?.finished).then(unname, unname);
}

const depthOf = (f: VTFiber) => {
  let d = 0;
  for (let p = f.parent; p; p = p.parent) d++;
  return d;
};

/** What a callback is given: the transition's pseudo-elements for the boundary's name, to animate them. */
function instanceFor(name: string) {
  const pseudo = (part: string) => {
    const selector = `::view-transition-${part}(${name})`;
    const root: any = typeof document !== "undefined" ? document.documentElement : null;
    return {
      animate: (keyframes: any, options?: any) => root?.animate?.(keyframes, { ...(typeof options === "number" ? { duration: options } : options), pseudoElement: selector }),
      getAnimations: () => (root?.getAnimations?.({ subtree: true }) ?? []).filter((a: any) => a.effect?.pseudoElement === selector),
      getComputedStyle: () => (typeof getComputedStyle === "function" && root ? getComputedStyle(root, selector) : null),
    };
  };
  return { name, group: pseudo("group"), imagePair: pseudo("image-pair"), old: pseudo("old"), new: pseudo("new") };
}

/** Forget every boundary (a test's fresh start). */
export function resetViewTransitions() {
  live.clear();
  before = new Map();
  exited.length = 0;
}
