// A transition's render tried before it is applied: the components it changes rendered to elements with the
// transition's state, along with what they render below them — no DOM, no effects, real state untouched. What
// suspends there holds the whole transition (React keeps the screen as it is until the data is there); otherwise
// the transition is applied and drawn as usual. React gets the same from rendering a draft tree it can throw away.
import { CONSUMER, CONTEXT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, SUSPENSE, readLazy, readThenable } from "./element.ts";
import { type Fiber, clearRecorded, depsChanged, keyOf, readContext, recordDone, recordNew, recordRender, typeOf } from "./core.ts";
import { setDryHooks, withHooks } from "./hooks.ts";
import { stylesheetPending } from "./float-client.ts";

/** A transition's state, seen by the dry run only: hook boxes and class instances, with their new values. */
export type Preview = { states: Map<any, any>; classes: Map<any, any[]>; roots?: Map<Fiber, any> };

type Dry = { fiber: Fiber | null; anchor: Fiber; at: number; scratch: any[]; contexts: [any, any][] };
let dry: Dry | null = null;
let preview: Preview = { states: new Map(), classes: new Map() };

const noop = () => {};
function slot<T>(make: () => T): [any, T] {
  const d = dry!;
  const i = d.at++;
  const existing = d.fiber?.hooks?.[i];
  if (!(i in d.scratch)) d.scratch[i] = existing ?? make();
  return [existing, d.scratch[i]];
}
const valueOf = (box: any) => (preview.states.has(box) ? preview.states.get(box) : box.v);
function readCtx(ctx: any) {
  const d = dry!;
  for (let i = d.contexts.length - 1; i >= 0; i--) if (d.contexts[i]![0] === ctx) return d.contexts[i]![1];
  return readContext(d.anchor, ctx);
}

/** The hooks a dry run's components call: values read, nothing written, nothing scheduled. */
export const dryHooks: any = {
  useState(init: any) {
    const [ex] = slot(() => ({ v: typeof init === "function" ? init() : init }));
    return [ex ? valueOf(ex) : dry!.scratch[dry!.at - 1].v, noop];
  },
  useReducer(_r: any, arg: any, init?: any) {
    const [ex] = slot(() => ({ v: init ? init(arg) : arg }));
    return [ex ? valueOf(ex) : dry!.scratch[dry!.at - 1].v, noop];
  },
  useRef(v: any) {
    return slot(() => ({ current: v }))[1];
  },
  useMemo(fn: () => any, deps?: any[]) {
    const [ex] = slot(() => ({ deps: undefined, value: undefined }));
    return ex && deps && !depsChanged(ex.deps, deps) ? ex.value : fn();
  },
  useCallback(fn: any, deps?: any[]) {
    return dryHooks.useMemo(() => fn, deps);
  },
  useEffect: noop,
  useLayoutEffect: noop,
  useInsertionEffect: noop,
  useImperativeHandle: noop,
  useContext: readCtx,
  useId() {
    return slot(() => "_r_dry_")[1];
  },
  useSyncExternalStore(_s: any, get: () => any) {
    return get();
  },
  useTransition: () => [false, noop],
  useDeferredValue: (v: any) => v,
  useDebugValue: noop,
  useActionState(_a: any, initial: any) {
    const [ex] = slot(() => ({ v: initial }));
    return [ex ? ex.v : initial, noop, false];
  },
  useOptimistic: (s: any) => [s, noop],
  useEffectEvent: (fn: any) => fn,
  use(u: any) {
    return u && u.$$typeof === CONTEXT ? readCtx(u) : readThenable(u);
  },
};

/** The fiber an element would update under `parent` (same key or place, same type), if there is one. */
function matching(parent: Fiber | null, el: any, i: number): Fiber | null {
  if (!parent) return null;
  const key = keyOf(el, i);
  const type = typeOf(el);
  // (In its place, most often; else looked up by key, the parent's children mapped once.)
  const at = parent.children[i];
  const c = at && at.key === key ? at : byKey(parent).get(key);
  return c && c.type === type && !c.dead ? c : null;
}
const keyMaps = new WeakMap<Fiber, { children: Fiber[]; map: Map<any, Fiber> }>();
function byKey(parent: Fiber): Map<any, Fiber> {
  const had = keyMaps.get(parent);
  if (had && had.children === parent.children) return had.map;
  const map = new Map<any, Fiber>();
  for (const c of parent.children) if (!map.has(c.key)) map.set(c.key, c);
  keyMaps.set(parent, { children: parent.children, map });
  return map;
}

/** A component rendered dry: its output, from its fiber's hooks (with the preview) or new ones. */
function renderDry(fiber: Fiber | null, anchor: Fiber, contexts: [any, any][], fn: () => any) {
  const was = dry;
  dry = { fiber, anchor, at: 0, scratch: [], contexts };
  try {
    return withHooks(dryHooks, fn);
  } finally {
    dry = was;
  }
}

/** The transition's render below `node`, a component at a time: it stops (yields) after each. */
function* walk(node: any, parent: Fiber | null, anchor: Fiber, contexts: [any, any][], i = 0): Generator<void, void, void> {
  if (node == null || typeof node === "boolean" || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let j = 0; j < node.length; j++) yield* walk(node[j], parent, anchor, contexts, j);
    return;
  }
  if (typeof node.then === "function") return yield* walk(readThenable(node), parent, anchor, contexts, i);
  if (node.$$typeof === PORTAL) return yield* walk(node.children, null, anchor, contexts);
  if (!node.$$typeof && typeof node[Symbol.iterator] === "function") return yield* walk([...node], parent, anchor, contexts, i);
  let { type } = node;
  const props = node.props ?? {};
  const fiber = matching(parent, node, i);
  const at = fiber ?? anchor;
  if (typeof type === "string") {
    // A stylesheet not loaded yet: the transition waits for it (React's suspended commit), the old UI kept meanwhile.
    // (An urgent update's inside a boundary: that boundary shows its fallback for it, as React's
    // shouldRemainOnPreviousScreen has it; nothing is held, nor started.)
    if (type === "link" && typeof document !== "undefined" && !(urgent && inBoundary > 0)) {
      const pending = stylesheetPending(document, props);
      if (pending) throw pending;
    }
    return yield* walk(props.children, fiber, at, contexts);
  }
  if (type?.$$typeof === LAZY) type = readLazy(type._payload);
  if (type === SUSPENSE) {
    // Still as the server drew it, its content not streamed in yet (its fallback showing): not rendered into.
    if (fiber && (fiber as any).dehydrated && (fiber as any).region?.start?.data === "$?") return;
    inBoundary++;
    try {
      // (Its children are kept under its content fragment, key "c": matched against that.)
      const content = fiber ? (fiber.children.find((c) => c.key === "c" && !c.dead) ?? null) : null;
      yield* walk(props.children, content, content ?? at, contexts);
    } catch (e: any) {
      // Suspending inside a boundary already on the page holds the transition; a new one shows its fallback.
      if (e && typeof e.then === "function" && fiber && !(fiber.pending && fiber.pending.peek() > 0)) {
        // React renders the fallback too before it holds the transition.
        try {
          for (const _ of walk(props.fallback, null, at, contexts));
        } catch {}
        throw e;
      }
      if (!(e && typeof e.then === "function")) throw e;
    } finally {
      inBoundary--;
    }
    return;
  }
  if (typeof type === "symbol" || type === FRAGMENT) return yield* walk(props.children, fiber, at, contexts);
  if (type?.$$typeof === CONTEXT) return yield* walk(props.children, fiber, at, [...contexts, [type, props.value]]);
  if (type?.$$typeof === CONSUMER) {
    const value = renderDry(fiber, at, contexts, () => dryHooks.useContext(type._context));
    yield;
    return yield* walk(props.children(value), fiber, at, contexts);
  }
  if (type?.$$typeof === MEMO) {
    if (fiber && fiber.props && (type.compare ?? shallowEqual)(fiber.props, props) && !preview.states.size) return;
    if (!fiber && typeof type.type === "function" && !type.type.prototype?.isReactComponent) {
      const r = recordNew(type, keyOf(node, i), props, at, preview.states, contexts);
      if (r) {
        yield;
        return yield* walk(r.out, null, r.fiber, contexts);
      }
    }
    return yield* walk({ ...node, type: type.type }, parent, anchor, contexts, i);
  }
  if (type?.$$typeof === FORWARD_REF) {
    const { ref, ...rest } = props;
    const out = renderDry(fiber, at, contexts, () => type.render(rest, ref ?? null));
    yield;
    return yield* walk(out, fiber, at, contexts);
  }
  if (typeof type !== "function") return;
  // Given the same props, and nothing of its own in the transition: as it is.
  if (fiber && fiber.props === props && !touches(fiber)) return;
  // New: rendered on a fiber of its own, kept for the real mount.
  if (!fiber && typeOf(node) === type) {
    renderingAt = at;
    const r = recordNew(type, keyOf(node, i), props, at, preview.states, contexts);
    if (r) {
      yield;
      return yield* walk(r.out, null, r.fiber, contexts);
    }
  }
  renderingAt = at;
  const out = renderComponent(fiber, at, contexts, type, props);
  yield;
  yield* walk(out, fiber, at, contexts);
  recordDone(fiber);
}

const shallowEqual = (a: any, b: any) => {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
};

/** Whether the transition changes state this fiber holds. */
function touches(f: Fiber): boolean {
  if (f.inst && preview.classes.has(f.inst)) return true;
  return !!f.hooks?.some((h) => preview.states.has(h));
}

function renderComponent(fiber: Fiber | null, at: Fiber, contexts: [any, any][], type: any, props: any) {
  if (!type.prototype?.isReactComponent) {
    // With the real hooks, kept for the transition's draw (no second render).
    const r = fiber ? recordRender(fiber, props, preview, contexts) : null;
    return r ? r.out : renderDry(fiber, at, contexts, () => type(props));
  }
  if (fiber?.inst) {
    const r = recordRender(fiber, props, preview, contexts);
    if (r) return r.out;
  }
  const inst = fiber?.inst;
  if (!inst) {
    const made = new type(props, type.contextType ? readCtx(type.contextType) : undefined);
    made.props = props;
    return made.render();
  }
  // An instance's render with the transition's state, then put back as it was.
  let state = inst.state;
  for (const u of preview.classes.get(inst) ?? []) state = { ...state, ...(typeof u === "function" ? u.call(inst, state, props) : u) };
  const was = [inst.props, inst.state];
  inst.props = props;
  inst.state = state;
  try {
    return inst.render();
  } finally {
    [inst.props, inst.state] = was;
  }
}

/** Whether the update tried is urgent (not a transition): it is held only for stylesheets outside any boundary. */
let urgent = false;
/** Suspense boundaries the walk is inside. */
let inBoundary = 0;
/** Said by tryTransition and resumeTransition when the render stopped between two components, to go on later. */
export const PAUSED = Symbol("paused");
type Outcome = PromiseLike<any> | null | typeof PAUSED;
/** The component the dry run renders now (or the fiber above a new one): where a hold comes from. */
let renderingAt: Fiber | null = null;
/** Where the last dry run that held its transition suspended. */
let heldAt: Fiber | null = null;
export const dryHeldAt = () => heldAt;
/** Whether the dry run running now is an urgent update's (not a transition's). */
export const dryUrgent = () => urgent;
/** A dry run stopped between two components: where it is, and what it renders with. */
let paused: { it: Generator<void, void, void>; preview: Preview; urgent: boolean; inBoundary: number } | null = null;

/** The transition's components rendered dry: the thenable that holds it if one suspends, PAUSED if `shouldYield` stopped
 * it between two components (resumeTransition goes on), else null. */
export function tryTransition(changed: Fiber[], p: Preview, isUrgent = false, shouldYield?: () => boolean): Outcome {
  dropPausedTransition();
  preview = p;
  urgent = isUrgent;
  clearRecorded();
  inBoundary = 0;
  // Only the outermost of those changed: the others render as part of them.
  const set = new Set(changed);
  const tops = changed.filter((f) => {
    for (let q = f.parent; q; q = q.parent) if (set.has(q)) return false;
    return !f.dead;
  });
  return drive(renderAll(p, tops), shouldYield);
}

function* renderAll(p: Preview, tops: Fiber[]): Generator<void, void, void> {
  // A root given new children: those, matched against what it has.
  for (const [f, children] of p.roots ?? []) if (!f.dead) yield* walk(children, f, f, []);
  for (const f of tops) {
    if (f.dead) continue;
    // The fiber itself, from its own hooks; what it renders matched against its children.
    let type = f.type;
    let props = f.props ?? {};
    if (type?.$$typeof === MEMO) type = type.type;
    if (type?.$$typeof === FORWARD_REF) {
      const render = type.render;
      const { ref, ...rest } = props;
      const out = renderDry(f, f, [], () => render(rest, ref ?? null));
      yield;
      yield* walk(out, f, f, []);
      continue;
    }
    if (typeof type !== "function") continue;
    renderingAt = f;
    const out = renderComponent(f, f, [], type, props);
    yield;
    yield* walk(out, f, f, []);
    recordDone(f);
  }
}

/** The dry run stopped earlier gone on with: as tryTransition answers. */
export function resumeTransition(shouldYield?: () => boolean): Outcome {
  const p = paused;
  if (!p) return null;
  paused = null;
  preview = p.preview;
  urgent = p.urgent;
  inBoundary = p.inBoundary;
  return drive(p.it, shouldYield);
}
export const transitionPaused = () => paused !== null;
/** A dry run stopped earlier given up (something else was drawn meanwhile): its records go too. */
export function dropPausedTransition() {
  const p = paused;
  if (!p) return;
  paused = null;
  try {
    p.it.return();
  } catch {}
  clearRecorded();
}

function drive(it: Generator<void, void, void>, shouldYield?: () => boolean): Outcome {
  try {
    for (;;) {
      if (it.next().done) return null;
      if (shouldYield?.()) {
        paused = { it, preview, urgent, inBoundary };
        return PAUSED;
      }
    }
  } catch (e: any) {
    // (Its records dropped: what holds it, or an error the real render meets again.)
    clearRecorded();
    heldAt = renderingAt;
    if (e && typeof e.then === "function") return e;
    // Any other error: left to the real render, where boundaries catch it.
    return null;
  } finally {
    preview = { states: new Map(), classes: new Map() };
    inBoundary = 0;
  }
}

setDryHooks(dryHooks);
