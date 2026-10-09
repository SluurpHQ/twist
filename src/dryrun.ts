// A transition's render tried before it is applied: the components it changes rendered to elements with the
// transition's state, along with what they render below them — no DOM, no effects, real state untouched. What
// suspends there holds the whole transition (React keeps the screen as it is until the data is there); otherwise
// the transition is applied and drawn as usual. React gets the same from rendering a draft tree it can throw away.
import { CONSUMER, CONTEXT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, SUSPENSE, readLazy, readThenable } from "./element.ts";
import { type Fiber, depsChanged, keyOf, readContext, typeOf } from "./core.ts";
import { setDryHooks, withHooks } from "./hooks.ts";

/** A transition's state, seen by the dry run only: hook boxes and class instances, with their new values. */
export type Preview = { states: Map<any, any>; classes: Map<any, any[]> };

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
  for (const c of parent.children) if (c.key === key && c.type === type && !c.dead) return c;
  return null;
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

function walk(node: any, parent: Fiber | null, anchor: Fiber, contexts: [any, any][], i = 0): void {
  if (node == null || typeof node === "boolean" || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((c, j) => walk(c, parent, anchor, contexts, j));
  if (typeof node.then === "function") return walk(readThenable(node), parent, anchor, contexts, i);
  if (node.$$typeof === PORTAL) return walk(node.children, null, anchor, contexts);
  if (!node.$$typeof && typeof node[Symbol.iterator] === "function") return walk([...node], parent, anchor, contexts, i);
  let { type } = node;
  const props = node.props ?? {};
  const fiber = matching(parent, node, i);
  const at = fiber ?? anchor;
  if (typeof type === "string") return walk(props.children, fiber, at, contexts);
  if (type?.$$typeof === LAZY) type = readLazy(type._payload);
  if (type === SUSPENSE) {
    try {
      walk(props.children, fiber, at, contexts);
    } catch (e: any) {
      // Suspending inside a boundary already on the page holds the transition; a new one shows its fallback.
      if (e && typeof e.then === "function" && fiber && !(fiber.pending && fiber.pending.peek() > 0)) {
        // React renders the fallback too before it holds the transition.
        try {
          walk(props.fallback, null, at, contexts);
        } catch {}
        throw e;
      }
      if (!(e && typeof e.then === "function")) throw e;
    }
    return;
  }
  if (typeof type === "symbol" || type === FRAGMENT) return walk(props.children, fiber, at, contexts);
  if (type?.$$typeof === CONTEXT) return walk(props.children, fiber, at, [...contexts, [type, props.value]]);
  if (type?.$$typeof === CONSUMER) {
    const value = renderDry(fiber, at, contexts, () => dryHooks.useContext(type._context));
    return walk(props.children(value), fiber, at, contexts);
  }
  if (type?.$$typeof === MEMO) {
    if (fiber && fiber.props && (type.compare ?? shallowEqual)(fiber.props, props) && !preview.states.size) return;
    return walk({ ...node, type: type.type }, parent, anchor, contexts, i);
  }
  if (type?.$$typeof === FORWARD_REF) {
    const { ref, ...rest } = props;
    return walk(renderDry(fiber, at, contexts, () => type.render(rest, ref ?? null)), fiber, at, contexts);
  }
  if (typeof type !== "function") return;
  // Given the same props, and nothing of its own in the transition: as it is.
  if (fiber && fiber.props === props && !touches(fiber)) return;
  walk(renderComponent(fiber, at, contexts, type, props), fiber, at, contexts);
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
  if (!type.prototype?.isReactComponent) return renderDry(fiber, at, contexts, () => type(props));
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

/** The transition's components rendered dry: the thenable that holds it if one suspends, else null. */
export function tryTransition(changed: Fiber[], p: Preview): PromiseLike<any> | null {
  preview = p;
  // Only the outermost of those changed: the others render as part of them.
  const set = new Set(changed);
  const tops = changed.filter((f) => {
    for (let q = f.parent; q; q = q.parent) if (set.has(q)) return false;
    return !f.dead;
  });
  try {
    for (const f of tops) {
      // The fiber itself, from its own hooks; what it renders matched against its children.
      let type = f.type;
      let props = f.props ?? {};
      if (type?.$$typeof === MEMO) type = type.type;
      if (type?.$$typeof === FORWARD_REF) {
        const render = type.render;
        const { ref, ...rest } = props;
        walk(renderDry(f, f, [], () => render(rest, ref ?? null)), f, f, []);
        continue;
      }
      if (typeof type !== "function") continue;
      walk(renderComponent(f, f, [], type, props), f, f, []);
    }
    return null;
  } catch (e: any) {
    if (e && typeof e.then === "function") return e;
    // Any other error: left to the real render, where boundaries catch it.
    return null;
  } finally {
    preview = { states: new Map(), classes: new Map() };
  }
}

setDryHooks(dryHooks);
