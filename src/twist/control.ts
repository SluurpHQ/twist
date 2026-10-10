// Control flow and components, renderer-neutral (exported by solid-js): For, Repeat, Show, Switch/Match, Loading,
// Errored, createComponent, and the marks Twist's JSX pass leaves for the runtime.
import { createErrorBoundary, createLoadingBoundary, createMemo, createOwner, createRevealOrder, flatten, getOwner, runWithOwner, sharedConfig, untrack, type RevealOrder } from "./signals.ts";
import { LIVE, mapArray, merge, repeat } from "./flow.ts";

// ---------------------------------------------------------------- marks from the pass

const DYNAMIC = Symbol("twist.dynamic");
const CHILDREN = Symbol("twist.children");

/**
 * A component written Solid-style (it runs once): marked, so a React tree that meets it mounts it as a Twist subtree,
 * and Twist calls it directly (an unmarked component is React's: Twist mounts it as a React subtree, when the bridge is
 * there). Twist's compile pass marks what a Solid-style file declares.
 */
export const TWIST = Symbol.for("twist.component");
/** How React draws a Solid-style component it calls (installed by the bridge, with its host). */
let reactHost: ((component: any, props: any) => any) | null = null;
export const setReactHost = (fn: typeof reactHost) => void (reactHost = fn);

/**
 * A Solid-style component, marked; returned as one any React can call: React gets the bridge's host for it, Twist the
 * component itself (the mark holds it).
 */
export function __twist_mark<T>(f: T): T {
  if (typeof f !== "function") return f;
  const own = f as any;
  own[TWIST] = true;
  const asReact = (props: any) => (reactHost ? reactHost(own, props) : own(props));
  Object.defineProperty(asReact, "name", { value: own.name });
  (asReact as any)[TWIST] = own;
  return asReact as T;
}
export const isTwist = (f: any) => typeof f === "function" && !!f[TWIST];
/** The Solid-style component itself, for a marked one React calls. */
const ownOf = (f: any) => (typeof f?.[TWIST] === "function" ? f[TWIST] : f);

/** How a React component is mounted inside a Twist tree (installed by the bridge; none, and it is called as is). */
let foreign: ((type: any, props: any) => any) | null = null;
export const setForeignComponent = (fn: typeof foreign) => void (foreign = fn);

/** A component rendered: a Solid-style one called once (untracked), a React one mounted by the bridge. */
export function callComponent<P>(type: (props: P) => any, props: P) {
  return foreign && !isTwist(type) ? foreign(type, props) : createComponent(type, props);
}

/** A part that can change: read where it is used (bound to its node, or a prop getter). */
export const __twist_d = <T>(fn: () => T) => ((fn as any)[DYNAMIC] = true, fn);
/** A component's children: built when the component reads them. */
export const __twist_c = <T>(fn: () => T) => ((fn as any)[CHILDREN] = true, fn);
/** JSX used as a statement: its value passed through, so the call is kept. */
export const __twist_k = <T>(v: T) => v;
/** `ref={el}` with a bare variable: called when it is a function, else assigned. */
export const __twist_ref = (current: unknown, assign: (el: unknown) => void) => (typeof current === "function" ? current : assign);

export const isDynamic = (v: any): v is () => any => typeof v === "function" && v[DYNAMIC] === true;
export const isChildren = (v: any): v is () => any => typeof v === "function" && v[CHILDREN] === true;


/** A component, run once, untracked. */
/**
 * A component's body run: under an owner of its own named `<Name>` (transparent: no id of its own), untracked, a
 * direct reactive read in it said to never update (as Solid's).
 */
export function createComponent<P>(Comp: (props: P) => any, props: P) {
  const own = ownOf(Comp);
  const label = `<${own.name || "Anonymous"}>`;
  const o = createOwner(getOwner(), { transparent: true }) as any;
  o.name = label;
  return runWithOwner(o, () => untrack(() => own(props), builtins.has(own) ? undefined : label));
}

/** Twist's own components (control flow, boundaries): their bodies read what they need, as Solid's computations do. */
const builtins = new WeakSet<Function>();
export const markBuiltin = (...fs: Function[]) => fs.forEach((f) => builtins.add(f));


/** A component's props: marked parts as getters, spreads read where used, children lazy. */
export function componentProps(raw: Record<string, any>): Record<string, any> {
  const sources: any[] = [];
  let own: Record<string, any> = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (k.startsWith("$spread$")) {
      if (Object.keys(own).length) sources.push(own), (own = {});
      sources.push(spreadSource(v));
      continue;
    }
    if (isDynamic(v) || (k === "children" && isChildren(v))) Object.defineProperty(own, k, { enumerable: true, configurable: true, get: v });
    else own[k] = v;
  }
  if (!sources.length) return own;
  if (Object.keys(own).length) sources.push(own);
  return merge(...sources);
}

/** A spread's object, read each time a key is read (so a props object's getters keep working). */
export function spreadSource(read: () => any) {
  return new Proxy({ [LIVE]: true } as any, {
    get: (_t, k) => (k === LIVE ? true : read()?.[k]),
    has: (_t, k) => k === LIVE || k in (read() ?? {}),
    ownKeys: () => Reflect.ownKeys(read() ?? {}),
    getOwnPropertyDescriptor: (_t, k) => {
      const s = read();
      // (A getter, not the value: listing keys reads none of them.)
      return s && k in s ? { enumerable: true, configurable: true, get: () => read()?.[k] } : undefined;
    },
  });
}

// ---------------------------------------------------------------- control flow

/** A list: `children(item, index)`, by identity (default), position (`keyed={false}`) or a key function. */
export function For<T>(props: { each: readonly T[] | null | undefined | false; fallback?: any; keyed?: boolean | ((v: T) => unknown); children: (item: any, index: any) => any }) {
  return mapArray(() => props.each, (item, index) => props.children(item, index), { keyed: props.keyed, ...("fallback" in props ? { fallback: () => props.fallback } : {}) });
}

/** `children(index)` for `count` indices (from `from`), no diffing. */
export function Repeat(props: { count: number; from?: number; fallback?: any; children: (index: number) => any }) {
  return repeat(() => props.count, (i) => props.children(i), { from: "from" in props ? () => props.from ?? 0 : undefined, ...("fallback" in props ? { fallback: () => props.fallback } : {}) });
}

/** `children` while `when` holds, else `fallback`; function children get an accessor (the value, when keyed). */
export function Show<T>(props: { when: T | undefined | null | false; keyed?: boolean; fallback?: any; children: any }) {
  // The condition read once per change; what decides the branch is its truth (its value, when keyed).
  const value = createMemo(() => props.when);
  const branch = createMemo(() => (props.keyed ? value() : !!value()), { equals: Object.is });
  return createMemo(() => {
    const b = branch();
    if (!b) return props.fallback;
    const c = props.children;
    if (typeof c === "function" && c.length > 0 && !isChildren(c)) return untrack(() => c(props.keyed ? b : value));
    return c;
  });
}

type MatchProps<T> = { when: T | undefined | null | false; keyed?: boolean; children: any };
const MATCH = Symbol("match");

/** A renderer whose JSX describes components (the server) resolves one here, where its value is needed. */
let describedNode = (v: any) => v;
export const setDescribedNode = (fn: (v: any) => any) => void (describedNode = fn);

/** One branch of a Switch. */
export function Match<T>(props: MatchProps<T>) {
  return { [MATCH]: true, props } as any;
}

/** The first Match whose `when` holds, else `fallback`. */
export function Switch(props: { fallback?: any; children: any }) {
  const matches = createMemo(() => {
    const list = flatten(typeof props.children === "function" ? props.children() : props.children);
    return (Array.isArray(list) ? list : [list]).map((m: any) => describedNode(m)).filter((m: any) => m && m[MATCH]).map((m: any) => m.props as MatchProps<unknown>);
  });
  // Each Match's condition read once per change (later ones only while earlier ones fail); the branch is which matches
  // (and its value, when keyed).
  const values = createMemo(() => matches().map((m) => createMemo(() => m.when)));
  const picked = createMemo(
    () => {
      const ms = matches();
      const vs = values();
      for (let i = 0; i < ms.length; i++) {
        const w = vs[i]!();
        if (w) return [i, ms[i]!.keyed ? w : true] as const;
      }
      return [-1, undefined] as const;
    },
    { equals: (a: any, b: any) => a[0] === b[0] && a[1] === b[1] },
  );
  return createMemo(() => {
    const [i, w] = picked();
    if (i < 0) return props.fallback;
    const m = matches()[i]!;
    const c = m.children;
    if (typeof c === "function" && c.length > 0 && !isChildren(c)) return untrack(() => c(m.keyed ? w : values()[i]!));
    return c;
  });
}

/** Shows `fallback` while what is under it waits on a first load. */
/** The order in which the Loading boundaries directly inside show their content (see createRevealOrder). */
export function Reveal(props: { order?: RevealOrder; collapsed?: boolean; children: any }) {
  return createRevealOrder(() => props.children, { order: () => props.order ?? "sequential", collapsed: () => !!props.collapsed });
}

export function Loading(props: { fallback?: any; on?: unknown; children: any }) {
  return createLoadingBoundary(() => props.children, () => props.fallback, "on" in props ? { on: () => props.on } : undefined);
}

/** Shows `fallback` (or `fallback(error, reset)`) once something under it throws. */
export function Errored(props: { fallback: any; children: any }) {
  return createErrorBoundary(
    () => props.children,
    // A function fallback is called with the error and reset (a fallback that declares no parameters cannot see the
    // error: development tells it on the console).
    (err, reset) => {
      const f = props.fallback;
      if (typeof f !== "function") return f;
      if (f.length === 0 && !/\.\.\./.test(String(f).slice(0, String(f).indexOf(")") + 1))) console.error(untrack(err));
      return f(err, reset);
    },
  );
}


/** A component whose code loads when first rendered (its readers wait, as for any first load). */
export function lazy<P>(load: () => Promise<{ default: (props: P) => any }>) {
  let loaded: ((props: P) => any) | null = null;
  let loading: Promise<(props: P) => any> | null = null;
  // The import, shared by every instance; a failed one is not kept (the next render or preload asks again).
  const start = () =>
    (loading ??= load().then(
      (m) => (loaded = m.default),
      (e) => {
        loading = null;
        throw e;
      },
    ));
  const Comp = (props: P) => {
    if (loaded) return callComponent(loaded, props);
    // Not loaded yet: an async memo of the component (its readers wait, as for any first load), then rendered.
    // (Its code holds a stream's shell: a page never streams the fallback of a module still loading.)
    const which = createMemo<(props: P) => any>(() => (loaded ?? start()) as any, { deferStream: true } as any);
    return createMemo(() => {
      const C = which();
      return callComponent(C, props);
    });
  };
  const marked = __twist_mark(Comp);
  (marked as any).preload = () => start();
  return marked;
}


/** Its children are not hydrated: what the server rendered stays as it is. */
export function NoHydration(props: { children?: any }) {
  return sharedConfig.hydrating ? undefined : props.children;
}

/** Its children hydrate again (inside NoHydration). */
export function Hydration(props: { children?: any }) {
  return props.children;
}

// The control flow here is Solid-style.
for (const f of [For, Repeat, Show, Switch, Match, Loading, Errored, Reveal, NoHydration, Hydration]) __twist_mark(f), markBuiltin(f);
