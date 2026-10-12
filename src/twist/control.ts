// Control flow and components, renderer-neutral (exported by solid-js): For, Repeat, Show, Switch/Match, Loading,
// Errored, createComponent, and the marks Twist's JSX pass leaves for the runtime.
declare const process: { env: Record<string, string | undefined> };
import { createErrorBoundary, createLoadingBoundary, createMemo, createOwner, createRevealOrder, flatten, getOwner, peekNextChildId, runWithOwner, sharedConfig, untrack, type RevealOrder } from "./signals.ts";
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
  // (Called as a plain function — a marked helper taking several arguments — it gets them all.)
  const asReact = (props: any, ...rest: any[]) => (reactHost ? reactHost(own, props) : own(props, ...rest));
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

/** A component called in the current owner, with none of its own (a static dynamic: as compiled `<C />` sits). */
export function callInline<P>(type: (props: P) => any, props: P) {
  return foreign && !isTwist(type) ? foreign(type, props) : untrack(() => ownOf(type)(props));
}

/** A part that can change: read where it is used (bound to its node, or a prop getter). */
export const __twist_d = <T>(fn: () => T) => ((fn as any)[DYNAMIC] = true, fn);
/** A condition in JSX (`test ? a : b`, `test && a`): its test as a memo, so a branch is made again only when it flips. */
export const __twist_memo = <T>(fn: () => T) => createMemo(fn);
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
export function createComponent<P>(Comp: (props: P) => any, props: P, name?: string) {
  if (typeof Comp !== "function")
    throw new Error(
      `createComponent: expected a component function but got ${Comp === null ? "null" : typeof Comp}. A JSX tag resolved to a non-function value — check the import: a missing or misnamed export resolves to undefined.`,
    );
  const own = ownOf(Comp);
  // (Outside any owner: a plain call, nothing to label.)
  if (!getOwner()) return untrack(() => own(props));
  const label = `<${name || own.name || "Anonymous"}>`;
  const o = createOwner({ transparent: true }) as any;
  o.name = label;
  return runWithOwner(o, () => untrack(() => own(props), builtins.has(own) ? undefined : label));
}

/** A component called and what it returns rendered by `render`, both under its owner (what it renders is its own). */
export function renderComponent<P, R>(Comp: (props: P) => any, props: P, render: (v: any) => R): R {
  if (foreign && !isTwist(Comp)) return render(foreign(Comp, props));
  const own = ownOf(Comp);
  const label = `<${own.name || "Anonymous"}>`;
  const o = createOwner({ transparent: true }) as any;
  o.name = label;
  return runWithOwner(o, () => render(untrack(() => own(props), builtins.has(own) ? undefined : label)));
}

/** Twist's own components (control flow, boundaries): their bodies read what they need, as Solid's computations do. */
const builtins = new WeakSet<Function>();
export const markBuiltin = (...fs: Function[]) => fs.forEach((f) => builtins.add(f));
/** A built-in component, marked as one where it is defined (a pure call: unused, it is dropped). */
export const builtin = <F extends Function>(f: F): F => (__twist_mark(f), markBuiltin(f), f);


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
export const For = /* @__PURE__ */ builtin(function For<T>(props: { each: readonly T[] | null | undefined | false; fallback?: any; keyed?: boolean | ((v: T) => unknown); children: (item: any, index: any) => any }) {
  // (The row function's own arity passed on: one that takes no index gets no index cell.)
  const indexed = untrack(() => props.children).length > 1;
  return mapArray(() => props.each, indexed ? (item, index) => props.children(item, index) : (item) => props.children(item), { keyed: props.keyed, ...("fallback" in props ? { fallback: () => props.fallback } : {}) });
});

/** `children(index)` for `count` indices (from `from`), no diffing; children that are not a function, repeated as they are. */
export const Repeat = /* @__PURE__ */ builtin(function Repeat(props: { count: number; from?: number; fallback?: any; children: ((index: number) => any) | any }) {
  return repeat(() => props.count, (i) => {
    const c = props.children;
    return typeof c === "function" ? c(i) : c;
  }, { from: "from" in props ? () => props.from ?? 0 : undefined, ...("fallback" in props ? { fallback: () => props.fallback } : {}) });
});

/** `children` while `when` holds, else `fallback`; function children get an accessor (the value, when keyed). */
export const Show = /* @__PURE__ */ builtin(function Show<T>(props: { when: T | undefined | null | false; keyed?: boolean; fallback?: any; children: any }) {
  // The condition read once per change; what decides the branch is its truth (its value, when keyed).
  const value = createMemo(() => props.when);
  const branch = createMemo(() => (props.keyed ? value() : !!value()), { equals: Object.is });
  return createMemo(() => {
    const b = branch();
    if (!b) return props.fallback;
    const c = props.children;
    if (typeof c === "function" && c.length > 0 && !isChildren(c)) return untrack(() => c(props.keyed ? b : narrowed("Show", () => !!untrack(branch), value)));
    return c;
  });
});

/** A branch's accessor: its value while the branch is the one shown, an error once it is not (a stale read). */
const narrowed =
  <T,>(name: string, live: () => boolean, read: () => T) =>
  (): T => {
    if (!live())
      throw new Error(
        process.env.NODE_ENV !== "production"
          ? `Attempting to access a stale value from <${name}> that could possibly be undefined. This may occur because you are reading the accessor returned from the component at a time where it has already been unmounted. We recommend cleaning up any stale timers or async, or reading from the initial condition.`
          : `Stale read from <${name}>.`,
      );
    return read();
  };

type MatchProps<T> = { when: T | undefined | null | false; keyed?: boolean; children: any };
const MATCH = Symbol("match");

/** A renderer whose JSX describes components (the server) resolves one here, where its value is needed. */
let describedNode = (v: any) => v;
export const setDescribedNode = (fn: (v: any) => any) => void (describedNode = fn);

/** One branch of a Switch. */
export const Match = /* @__PURE__ */ builtin(function Match<T>(props: MatchProps<T>) {
  return { [MATCH]: true, props } as any;
});

/** The first Match whose `when` holds, else `fallback`. */
export const Switch = /* @__PURE__ */ builtin(function Switch(props: { fallback?: any; children: any }) {
  const matches = createMemo(() => {
    const list = flatten(typeof props.children === "function" ? props.children() : props.children);
    return (Array.isArray(list) ? list : [list]).map((m: any) => describedNode(m)).filter((m: any) => m && m[MATCH]).map((m: any) => m.props as MatchProps<unknown>);
  });
  // Each Match's condition read once per change (later ones only while earlier ones fail); the branch is which matches
  // (and its value, when keyed).
  const values = createMemo(() => matches().map((m) => createMemo(() => m.when, { lazy: true })));
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
    if (typeof c === "function" && c.length > 0 && !isChildren(c)) return untrack(() => c(m.keyed ? w : narrowed("Match", () => untrack(picked)[0] === i, values()[i]!)));
    return c;
  });
});

/** Shows `fallback` while what is under it waits on a first load. */
/** The order in which the Loading boundaries directly inside show their content (see createRevealOrder). */
export const Reveal = /* @__PURE__ */ builtin(function Reveal(props: { order?: RevealOrder; collapsed?: boolean; children: any }) {
  return createRevealOrder(() => props.children, { order: () => props.order ?? "sequential", collapsed: () => !!props.collapsed });
});

export const Loading = /* @__PURE__ */ builtin(function Loading(props: { fallback?: any; on?: unknown; children: any }) {
  return createLoadingBoundary(() => props.children, () => props.fallback, "on" in props ? { on: () => props.on } : undefined);
});

/** Shows `fallback` (or `fallback(error, reset)`) once something under it throws. */
export const Errored = /* @__PURE__ */ builtin(function Errored(props: { fallback: any; children: any }) {
  return createErrorBoundary(
    () => props.children,
    (err, reset) => erroredFallback(props.fallback, err, reset),
  );
});

/** An Errored fallback for `err`: a function is called with the error and reset (one that declares no parameters cannot
 * see the error: development tells it on the console). */
export function erroredFallback(f: any, err: () => unknown, reset: () => void) {
  if (typeof f !== "function") return f;
  if (f.length === 0 && !/\.\.\./.test(String(f).slice(0, String(f).indexOf(")") + 1))) console.error(untrack(err));
  return f(err, reset);
}


/** A component whose code loads when first rendered (its readers wait, as for any first load). */
export function lazy<P>(fn: () => Promise<any>, options?: { export?: string }, moduleUrl?: string) {
  if (typeof options === "string")
    throw new Error("lazy() moduleUrl moved to the third argument: lazy(fn, options?, moduleUrl?). Pass { export } options second, or undefined.");
  const exportName = options?.export;
  const pick = (mod: any) => (exportName ? mod[exportName] : mod.default);
  let comp: (() => (props: P) => any) | undefined;
  let p: Promise<any> | undefined;
  // The import, shared by every instance; a failed one is not kept (the next render or preload asks again).
  const load = () => {
    if (p) return p;
    const cur = (p = fn());
    cur.then(
      (mod) => void (comp = () => pick(mod)),
      () => void (p === cur && (p = undefined)),
    );
    return cur;
  };
  const Comp = (props: P) => {
    // Hydrating: the module the server rendered with, preloaded under this place's id, renders at once.
    if (sharedConfig.hydrating) comp = preloaded(comp, moduleUrl, exportName);
    let local = comp;
    // Not loaded yet: an async memo of the component (its readers wait, as for any first load).
    // (Its code holds a stream's shell: a page never streams the fallback of a module still loading.)
    if (!local) load(), (local = createMemo(() => load().then(pick), { deferStream: true } as any) as () => (props: P) => any);
    return createMemo(() => {
      const C = (comp || local)();
      return C ? callComponent(C, props) : "";
    });
  };
  const marked = __twist_mark(Comp);
  (marked as any).preload = load;
  (marked as any).moduleUrl = moduleUrl;
  return marked as typeof marked & { preload: () => Promise<any>; moduleUrl?: string };
}

/** The component of the module preloaded for this place (`_$HY.modules` by its id), else what is known already. */
function preloaded<C>(comp: (() => C) | undefined, moduleUrl: string | undefined, exportName: string | undefined): (() => C) | undefined {
  const o = getOwner();
  const key = o && o.id != null ? peekNextChildId(o) : undefined;
  const cached = key != null ? (globalThis as any)._$HY?.modules?.[key] : undefined;
  if (cached) {
    const component = exportName ? cached[exportName] : cached.default;
    if (typeof component !== "function")
      throw new Error(
        `lazy() (hydration id "${key}") preloaded a module whose "${exportName ?? "default"}" export is not a component. lazy() hydrates synchronously from the preloaded module; select a named export with the { export } option, or re-export the component as the module's default. Wrappers that pick an export at runtime inside the import thunk are not supported.`,
      );
    return () => component;
  }
  if (!comp && moduleUrl)
    throw new Error(
      `lazy() module "${moduleUrl}" (hydration id "${key}") was not preloaded before hydration: the server serialized no client entry for it. Check the server log for "Asset manifest returned no client assets for module" — the manifest passed to renderToStream/renderToString did not answer for this moduleUrl (a key that does not match the client manifest, or a manifest built for different output). If the server did register it, the server and client hydration id namespaces are misaligned.`,
    );
  return comp;
}


const NO_HYDRATE = Symbol.for("twist.no-hydrate");
/** Whether what renders here hydrates: under an owner, outside NoHydration. */
export const isHydratable = () => {
  const o = getOwner() as any;
  return !!o && !o.context?.[NO_HYDRATE];
};

/** Its children are not hydrated: what the server rendered stays as it is. */
export const NoHydration = /* @__PURE__ */ builtin(function NoHydration(props: { children?: any }) {
  const o = createOwner() as any;
  o.context = { ...o.context, [NO_HYDRATE]: true };
  return runWithOwner(o, () => (sharedConfig.hydrating ? undefined : props.children));
});

/** Its children hydrate again (inside NoHydration). */
export const Hydration = /* @__PURE__ */ builtin(function Hydration(props: { children?: any }) {
  return props.children;
});

// The control flow here is Solid-style.
