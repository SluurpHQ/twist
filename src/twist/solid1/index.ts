// Solid 1's API (`solid-js` 1.x) on Twist's kernel. Its rules, apart from Solid 2's: a write is seen at once, effects
// wait for the end of the outermost update (a root, a batch, a write outside both), and writes are allowed anywhere.
import * as K from "../signals.ts";
import { mapArray as mapRows, LIVE } from "../flow.ts";
import { Loading, Errored, Show, Switch, Match, createComponent, lazy, builtin, isChildren } from "../control.ts";
import { $PROXY, $TRACK } from "../store.ts";

export { $PROXY, $TRACK, Show, Switch, Match, createComponent, lazy };
export const { untrack, getOwner, onCleanup, createUniqueId, children, sharedConfig, enableExternalSource, DEV } = K;
export const getListener = K.getObserver;
export const equalFn = <T>(a: T, b: T) => a === b;
export type Accessor<T> = () => T;
export type Setter<T> = (next?: T | ((prev: T) => T)) => T;
export type Signal<T> = [Accessor<T>, Setter<T>];
export type Owner = K.Owner;

// ---------------------------------------------------------------- updates

/** How deep in Solid 1's updates (roots, batches, computations) the code is: effects run when it is back to 0. */
let depth = 0;
const settle = () => {
  if (depth === 0 && !K.isFlushing()) K.flush();
};
function update<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
    settle();
  }
}
/** Inside a batch: writes wait to propagate (what reads them still sees them). */
let batching = 0;
export function batch<T>(fn: () => T): T {
  batching++;
  depth++;
  try {
    return fn();
  } finally {
    batching--;
    depth--;
    if (batching) {
    } else if (depth) for (const s of written.splice(0)) propagate(s);
    else (written.length = 0), settle();
  }
}
/** Written in a batch: propagated as it ends. */
const written: K.Signal<any>[] = [];
/** The memos below `s` brought up to date, depth first in the order they read it (as Solid 1 runs them). */
function propagate(s: K.Signal<any>) {
  const order: K.Computation<any>[] = [];
  const seen = new Set<K.Computation<any>>();
  const visit = (n: { observers: unknown }) => {
    for (const c of n.observers as Iterable<K.Computation<any>>) {
      if (c.kind !== 0 || seen.has(c)) continue;
      seen.add(c);
      order.push(c);
      visit(c);
    }
  };
  visit(s);
  for (const c of order) if (!c.disposed) c.update();
}
/**
 * A node changed in place (its readers told): outside every update everything runs now; inside one its memos do (at
 * the batch's end, in a batch) and its effects wait for the update's end.
 */
export function changed(s: K.Signal<any>) {
  // (Written by effects as they run: grouped, the flush running them takes the rest.)
  if (K.isFlushing()) return;
  if (depth === 0) K.flush();
  else if (batching) written.push(s);
  else propagate(s);
}

/** A signal of Solid 1: written, it holds the new value at once; what reads it follows. */
class Signal1<T> extends K.Signal<T> {
  write(next: T) {
    if (this.equals !== false && this.equals(this.value, next)) return;
    this.value = next;
    this.bump();
    changed(this);
  }
}

export function createSignal<T>(value?: T, options?: { equals?: false | ((a: T, b: T) => boolean); name?: string; internal?: boolean }): Signal<T> {
  const s = new Signal1<T>(value as T, options as any);
  const read = () => s.read();
  const set = (next?: any) => {
    const v = typeof next === "function" ? next(s.value) : next;
    s.write(v);
    return v;
  };
  return [read, set as Setter<T>];
}

/** `fn` given `init` on its first run, and what it returned last after. */
function withPrev<T>(fn: (prev: T) => T, init: T) {
  let first = true;
  return (prev?: T) => {
    const p = first ? init : (prev as T);
    first = false;
    depth++;
    try {
      return fn(p);
    } finally {
      depth--;
    }
  };
}

export function createMemo<T>(fn: (prev: T) => T, value?: T, options?: { equals?: false | ((a: T, b: T) => boolean); name?: string }): Accessor<T> {
  return K.createMemo(withPrev(fn, value as T), options as any);
}

export function createComputed<T>(fn: (prev: T) => T, value?: T) {
  K.createMemo(withPrev(fn, value as T), { equals: false });
}

export function createRenderEffect<T>(fn: (prev: T) => T, value?: T) {
  K.createRenderEffect(withPrev(fn, value as T), () => {});
}

export function createEffect<T>(fn: (prev: T) => T, value?: T) {
  // (Not on a server: effects are the browser's.)
  if (K.isServerRender()) return;
  let v = value as T;
  K.createPlainEffect(() => void (v = fn(v)));
  settle();
}

export const onMount = (fn: () => void) => createEffect(() => void untrack(fn));

const noDispose = () => {
  throw new Error("Dispose method must be an explicit argument to createRoot function");
};
export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner | null): T {
  const parent = fn.length === 0 ? null : detachedOwner === undefined ? K.getOwner() : detachedOwner;
  // (One that takes no dispose function is never disposed: what it is given throws.)
  return update(() => K.runWithOwner(parent, () => K.createRoot(fn.length === 0 ? () => fn(noDispose) : fn)));
}

export const runWithOwner = <T>(o: Owner | null, fn: () => T): T => update(() => K.runWithOwner(o, fn));

export function on<S, Next, Init = unknown>(deps: any, fn: (input: S, prevInput: S | undefined, prev: any) => Next, options?: { defer?: boolean }) {
  const many = Array.isArray(deps);
  let prevInput: S | undefined;
  let defer = options?.defer;
  return (prevValue: Init | Next) => {
    const input = (many ? deps.map((d: () => unknown) => d()) : deps()) as S;
    if (defer) {
      defer = false;
      return prevValue as Next;
    }
    const result = untrack(() => fn(input, prevInput, prevValue));
    prevInput = input;
    return result;
  };
}

// ---------------------------------------------------------------- errors

const castError = (e: unknown) => (e instanceof Error ? e : new Error(typeof e === "string" ? e : "Unknown error", { cause: e }));

/** `e` to the nearest handler above `o`, else thrown. */
function handOn(o: Owner | null, e: unknown) {
  for (let x = o; x; x = x.parent) {
    const c = (x as any).catch as ((e: unknown) => boolean) | undefined;
    if (c && c(e)) return;
  }
  throw e;
}

export function catchError<T>(fn: () => T, handler: (err: Error) => void): T | undefined {
  const o = K.createOwner() as any;
  o.catch = (e: unknown) => {
    try {
      handler(castError(e));
    } catch (again) {
      handOn(o.parent, again);
    }
    return true;
  };
  try {
    return K.runWithOwner(o, fn);
  } catch (e) {
    o.catch(e);
  }
}

/** Deprecated in Solid 1: errors under the current owner to `fn`. */
export function onError(fn: (err: Error) => void) {
  const o = K.getOwner() as any;
  if (!o) return;
  const was = o.catch;
  o.catch = (e: unknown) => (fn(castError(e)), was?.(e), true);
}

export const ErrorBoundary = builtin(function ErrorBoundary(props: { fallback: any; children: any }) {
  return Errored({
    get fallback() {
      const f = props.fallback;
      if (typeof f !== "function") return f;
      return (err: () => unknown, reset: () => void) => {
        // (A reset shows the content again at once; resetErrorBoundaries resets every boundary showing an error.)
        const again = () => {
          failing.delete(again);
          reset();
          settle();
        };
        failing.add(again);
        return f(err(), again);
      };
    },
    get children() {
      return props.children;
    },
  });
});
/** The resets of the boundaries showing an error now. */
const failing = new Set<() => void>();
export const resetErrorBoundaries = () => batch(() => [...failing].forEach((r) => r()));

// ---------------------------------------------------------------- derived helpers

export function createDeferred<T>(source: Accessor<T>, options?: { timeoutMs?: number; equals?: false | ((a: T, b: T) => boolean) }): Accessor<T> {
  const [value, set] = createSignal(untrack(source), options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  createComputed(() => {
    const v = source();
    clearTimeout(timer);
    timer = setTimeout(() => set(() => v), 0);
  });
  onCleanup(() => clearTimeout(timer));
  return value;
}

export function createSelector<T, U = T>(source: Accessor<T>, fn: (a: U, b: T) => boolean = equalFn as any): (key: U) => boolean {
  const keys = new Map<U, { node: Signal1<number>; users: number }>();
  let value!: T;
  createComputed((prev?: T) => {
    const v = source();
    value = v;
    if (prev !== undefined || keys.size) for (const [k, e] of keys) if (fn(k, v) !== fn(k, prev as T)) e.node.bump();
    return v;
  });
  return (key: U) => {
    if (K.getObserver()) {
      let e = keys.get(key);
      if (!e) keys.set(key, (e = { node: new Signal1(0), users: 0 }));
      e.users++;
      e.node.read();
      onCleanup(() => {
        if (--e!.users === 0) keys.delete(key);
      });
    }
    return fn(key, value);
  };
}

export function createReaction(onInvalidate: () => void, options?: { name?: string }) {
  const o = K.getOwner();
  let stop: (() => void) | null = null;
  return (tracking: () => void) => {
    stop?.();
    let first = true;
    let fired = false;
    K.runWithOwner(o, () =>
      createRoot((dispose) => {
        stop = dispose;
        createComputed(() => {
          tracking();
          if (first) return void (first = false);
          if (fired) return;
          fired = true;
          untrack(onInvalidate);
        });
      }),
    );
  };
}

// ---------------------------------------------------------------- context

export type Context<T> = { id: symbol; Provider: (props: { value: T; children: any }) => any; defaultValue: T };
export function createContext<T>(defaultValue?: T, options?: { name?: string }): Context<T> {
  const Provider = K.createContext(defaultValue, options);
  return { id: Provider.id, Provider, defaultValue: defaultValue as T };
}
export function useContext<T>(context: Context<T>): T {
  const ctx = K.getOwner()?.context;
  return ctx && context.id in ctx ? (ctx[context.id] as T) : context.defaultValue;
}

// ---------------------------------------------------------------- props

/** Props whose keys can change (a store, a merge of one, an accessor of props): read through a proxy. */
const isLive = (o: any) => typeof o === "function" || (o != null && ($PROXY in o || LIVE in o));
const resolve = (o: any) => (typeof o === "function" ? o() : o);
/** A proxy answering from `get`, `has` and `keys` (each key a getter). */
function liveProps(get: (k: PropertyKey) => unknown, has: (k: PropertyKey) => boolean, keys: () => (string | symbol)[]) {
  return new Proxy({ [LIVE]: true } as any, {
    get: (_t, k) => (k === LIVE ? true : k === $PROXY ? undefined : get(k)),
    has: (_t, k) => k === LIVE || has(k),
    set: () => true,
    deleteProperty: () => true,
    ownKeys: () => keys(),
    getOwnPropertyDescriptor: (_t, k) => (has(k) ? { configurable: true, enumerable: true, get: () => get(k) } : undefined),
  });
}

export function mergeProps(...args: any[]): any {
  const sources = args.filter((s) => {
    if (!s) return false;
    if (typeof s !== "object" && typeof s !== "function") throw new Error(`mergeProps: expected an object, got ${typeof s}`);
    return true;
  });
  // The last source with a value (not undefined) for a key wins; read where it is used.
  if (sources.some(isLive))
    return liveProps(
      (k) => {
        for (let i = sources.length - 1; i >= 0; i--) {
          const v = resolve(sources[i])?.[k];
          if (v !== undefined) return v;
        }
      },
      (k) => sources.some((s) => k in (resolve(s) ?? {})),
      () => [...new Set(sources.flatMap((s) => Object.keys(resolve(s) ?? {})))],
    );
  // Plain sources: values copied, getters chained (the last that answers something wins).
  const getters: Record<string, (() => unknown)[]> = Object.create(null);
  const found: Record<string, PropertyDescriptor | undefined> = Object.create(null);
  const seen = new Set<string>();
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i];
    const names = Object.getOwnPropertyNames(source);
    for (let j = names.length - 1; j >= 0; j--) {
      const k = names[j]!;
      if (k === "__proto__" || k === "constructor") continue;
      const d = Object.getOwnPropertyDescriptor(source, k)!;
      if (!seen.has(k) || !found[k]) {
        seen.add(k);
        if (d.get) {
          const chain = (getters[k] = [d.get.bind(source)]);
          found[k] = { enumerable: true, configurable: true, get: () => { for (const g of chain) { const v = g(); if (v !== undefined) return v; } } };
        } else found[k] = d.value !== undefined ? d : undefined;
      } else if (getters[k]) getters[k]!.push(d.get ? d.get.bind(source) : () => d.value);
    }
  }
  const target: any = {};
  const keys = [...seen];
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i]!;
    const d = found[k];
    if (d?.get) Object.defineProperty(target, k, d);
    else target[k] = d ? d.value : undefined;
  }
  return target;
}

export function splitProps<T extends object>(props: T, ...keys: (readonly PropertyKey[])[]): any[] {
  if (isLive(props)) {
    const blocked = new Set(keys.flat());
    const parts = keys.map((ks) =>
      liveProps(
        (k) => (ks.includes(k) ? (props as any)[k] : undefined),
        (k) => ks.includes(k) && k in props,
        () => ks.filter((k) => k in props) as (string | symbol)[],
      ),
    );
    parts.push(
      liveProps(
        (k) => (blocked.has(k) ? undefined : (props as any)[k]),
        (k) => !blocked.has(k) && k in props,
        () => Object.keys(props).filter((k) => !blocked.has(k)),
      ),
    );
    return parts;
  }
  const parts: any[] = keys.map(() => ({}));
  const rest: any = {};
  for (const name of Object.getOwnPropertyNames(props)) {
    const d = Object.getOwnPropertyDescriptor(props, name)!;
    // (A plain value is copied as one; anything else keeps its descriptor.)
    const plain = !d.get && !d.set && d.enumerable && d.writable && d.configurable && name !== "__proto__";
    let taken = false;
    keys.forEach((ks, i) => {
      if (!ks.includes(name)) return;
      taken = true;
      plain ? (parts[i][name] = d.value) : Object.defineProperty(parts[i], name, d);
    });
    if (!taken) plain ? (rest[name] = d.value) : Object.defineProperty(rest, name, d);
  }
  parts.push(rest);
  return parts;
}

// ---------------------------------------------------------------- lists

export function mapArray<T, U>(list: Accessor<readonly T[] | undefined | null | false>, fn: (v: T, i: Accessor<number>) => U, options?: { fallback?: Accessor<any> }): () => U[] {
  return mapRows(list, fn, options as any);
}
export function indexArray<T, U>(list: Accessor<readonly T[] | undefined | null | false>, fn: (v: Accessor<T>, i: number) => U, options?: { fallback?: Accessor<any> }): () => U[] {
  return mapRows(list, fn, { ...(options as any), keyed: false });
}

export const For = builtin(function For<T>(props: { each: readonly T[] | undefined | null | false; fallback?: any; children: (item: T, index: Accessor<number>) => any }) {
  const fallback = "fallback" in props ? { fallback: () => props.fallback } : undefined;
  return mapArray(() => props.each, untrack(() => props.children).length > 1 ? (item: T, i: Accessor<number>) => props.children(item, i) : (item: T) => (props.children as any)(item), fallback);
});

export const Index = builtin(function Index<T>(props: { each: readonly T[] | undefined | null | false; fallback?: any; children: (item: Accessor<T>, index: number) => any }) {
  const fallback = "fallback" in props ? { fallback: () => props.fallback } : undefined;
  return indexArray(() => props.each, (item, i) => props.children(item, i), fallback);
});

// ---------------------------------------------------------------- async

/** The Suspense boundaries a resource read is under (a pending read there suspends). */
const SUSPENSE = Symbol("solid1.suspense");

/** A Suspense: `boundary` (the renderer's Loading) made under an owner that resource reads know as one. */
export function suspense<R>(boundary: (props: { fallback?: any; children: any }) => R, props: { fallback?: any; children: any }): R {
  const o = K.createOwner() as any;
  o.context = { ...o.context, [SUSPENSE]: true };
  return K.runWithOwner(o, () =>
    boundary({
      get fallback() {
        return props.fallback;
      },
      get children() {
        return props.children;
      },
    }),
  );
}
export const Suspense = builtin(function Suspense(props: { fallback?: any; children: any }) {
  return suspense(Loading, props);
});
/** The order the Suspense boundaries directly inside show their content: together, or one after another. */
export const SuspenseList = builtin(function SuspenseList(props: { children: any; revealOrder?: "forwards" | "backwards" | "together"; tail?: "collapsed" | "hidden" }) {
  return K.createRevealOrder(() => props.children, { order: () => (props.revealOrder === "together" ? "together" : props.revealOrder ? "sequential" : "natural"), collapsed: () => !!props.tail });
});

export type ResourceState = "unresolved" | "pending" | "ready" | "refreshing" | "errored";
export type Resource<T> = Accessor<T> & { state: ResourceState; loading: boolean; error: any; latest: T | undefined };
export type ResourceFetcherInfo<T, R = unknown> = { value: T | undefined; refetching: R | boolean };
type Fetcher<S, T> = (source: S, info: ResourceFetcherInfo<T>) => T | Promise<T>;
type ResourceOptions<T> = { initialValue?: T; name?: string; deferStream?: boolean; ssrLoadFrom?: string; storage?: (init: T | undefined) => Signal<T | undefined>; onHydrated?: (k: unknown, info: unknown) => void };

export function createResource<T, S = true>(...args: any[]): [Resource<T>, { mutate: Setter<T>; refetch: (info?: unknown) => T | Promise<T> | undefined | null }] {
  let source: S | Accessor<S | false | null | undefined> | true;
  let fetcher: Fetcher<S, T>;
  let options: ResourceOptions<T>;
  if (typeof args[1] === "function") (source = args[0]), (fetcher = args[1]), (options = args[2] || {});
  else (source = true), (fetcher = args[0]), (options = args[1] || {});
  let pr: Promise<T> | null = null;
  /** The load in flight is a transition's: what it had shows meanwhile. */
  let held = false;
  let resolved = "initialValue" in options;
  let scheduled = false;
  const dynamic = typeof source === "function" && createMemo(source as Accessor<S>);
  const [value, setValue] = (options.storage || createSignal)(options.initialValue) as Signal<T | undefined>;
  const [error, setError] = createSignal<unknown>(undefined);
  const [track, trigger] = createSignal(undefined, { equals: false });
  const [state, setState] = createSignal<ResourceState>(resolved ? "ready" : "unresolved");

  function loadEnd(p: Promise<T> | null, v: T | undefined, err?: unknown, key?: unknown) {
    if (pr !== p) return v;
    pr = null;
    if (key !== undefined) resolved = true;
    batch(() => {
      if (err === undefined) setValue(() => v);
      setState(err !== undefined ? "errored" : "ready");
      setError(err);
      trigger();
    });
    return v;
  }
  function read() {
    const v = value();
    const err = error();
    if (err !== undefined && !pr) throw err;
    // (Under a Suspense, a pending read suspends: its boundary shows the fallback until the answer lands.)
    if ((K.getOwner()?.context as any)?.[SUSPENSE]) {
      // (On a server, the render waits on the load itself.)
      if (K.isServerRender()) {
        if (pr) throw new K.NotReadyError(pr);
      } else if (K.getObserver()) {
        track();
        if (pr && !held) throw new K.NotReadyError(pendingNode);
      }
    }
    return v;
  }
  // (What a suspended read waits on: told when the answer lands.)
  const pendingNode = new Signal1(0);
  function load(refetching: unknown = true) {
    if (refetching !== false && scheduled) return;
    scheduled = false;
    const lookup = dynamic ? dynamic() : (source as S);
    if (lookup == null || lookup === false) {
      loadEnd(pr, untrack(value));
      return;
    }
    let p: T | Promise<T>;
    try {
      p = untrack(() => fetcher(lookup as S, { value: untrack(value), refetching: refetching as any }));
    } catch (e) {
      pr = null;
      batch(() => {
        setState("errored");
        setError(castError(e));
        trigger();
      });
      return;
    }
    if (!(p && typeof (p as any).then === "function")) {
      loadEnd(pr, p as T, undefined, lookup);
      return p;
    }
    pr = p as Promise<T>;
    held = resolved && transitionLoad(pr);
    scheduled = true;
    queueMicrotask(() => (scheduled = false));
    batch(() => {
      setState(resolved ? "refreshing" : "pending");
      trigger();
    });
    return (p as Promise<T>).then(
      (v) => (loadEnd(p as Promise<T>, v, undefined, lookup), pendingNode.bump(), settle(), v),
      (e) => (loadEnd(p as Promise<T>, undefined, castError(e)), pendingNode.bump(), settle(), undefined),
    );
  }
  Object.defineProperties(read, {
    state: { get: () => state() },
    error: { get: () => error() },
    loading: {
      get() {
        const s = state();
        return s === "pending" || s === "refreshing";
      },
    },
    latest: {
      get() {
        if (!resolved) return read();
        const err = error();
        if (err && !pr) throw err;
        return value();
      },
    },
  });
  if (dynamic) createComputed(() => void load(false));
  else load(false);
  return [read as Resource<T>, { refetch: (info?: unknown) => update(() => load(info)) as any, mutate: setValue as Setter<T> }];
}

/** Loads a transition started and is waiting on: their resources show what they had meanwhile (no fallback). */
let transition: { loads: Set<Promise<unknown>>; done: () => void; promise: Promise<void> } | null = null;
let inTransition = false;
const [transitionPending, setTransitionPending] = createSignal(false);
export function startTransition(fn: () => unknown): Promise<void> {
  if (!transition) {
    let done!: () => void;
    const promise = new Promise<void>((r) => (done = r));
    transition = { loads: new Set(), done, promise };
  }
  const t = transition;
  inTransition = true;
  try {
    batch(fn);
  } finally {
    inTransition = false;
  }
  if (t.loads.size) setTransitionPending(true);
  else if (transition === t) (transition = null), t.done();
  return t.promise;
}
/** A load a transition set off: tracked until it settles. */
function transitionLoad(p: Promise<unknown>): boolean {
  if (!inTransition || !transition) return false;
  const t = transition;
  t.loads.add(p);
  const end = () => {
    t.loads.delete(p);
    if (t.loads.size || transition !== t) return;
    transition = null;
    setTransitionPending(false);
    t.done();
  };
  p.then(end, end);
  return true;
}
export function useTransition(): [Accessor<boolean>, (fn: () => void) => Promise<void>] {
  return [transitionPending, startTransition];
}

// ---------------------------------------------------------------- observables

export function observable<T>(input: Accessor<T>) {
  return {
    subscribe(observer: ((v: T) => void) | { next?: (v: T) => void }) {
      if (!(observer instanceof Object) || observer == null) throw new TypeError("Expected the observer to be an object.");
      const handler = typeof observer === "function" ? observer : observer.next?.bind(observer);
      if (!handler) return { unsubscribe() {} };
      const dispose = createRoot((disposer) => {
        createEffect(() => {
          const v = input();
          untrack(() => handler(v));
        });
        return disposer;
      });
      if (K.getOwner()) onCleanup(dispose);
      return { unsubscribe: () => dispose() };
    },
    [(Symbol as any).observable || "@@observable"]() {
      return this;
    },
  };
}

export function from<T>(producer: ((setter: Setter<T>) => () => void) | { subscribe: (fn: (v: T) => void) => (() => void) | { unsubscribe: () => void } }, initialValue?: T): Accessor<T | undefined> {
  const [s, set] = createSignal<T | undefined>(initialValue, { equals: false });
  if ("subscribe" in producer) {
    const unsub = producer.subscribe((v) => set(() => v));
    onCleanup(() => ("unsubscribe" in unsub ? unsub.unsubscribe() : unsub()));
  } else onCleanup(producer(set as Setter<T>));
  return s;
}

// ---------------------------------------------------------------- scheduling

export function requestCallback(fn: () => void, options?: { timeout?: number }) {
  const id = setTimeout(fn, 0);
  return { id, fn, startTime: 0, expirationTime: options?.timeout ?? 0 };
}
export const cancelCallback = (task: { id: ReturnType<typeof setTimeout> }) => clearTimeout(task.id);
export const enableScheduling = () => {};

// Solid 1 reads signals freely in component bodies and effects (Solid 2 warns there).
K.setStrictReads(false);

// Solid 1's owners name their parent `owner`.
for (const proto of [Object.getPrototypeOf(K.ownerUnder(null)), K.Computation.prototype])
  if (!("owner" in proto)) Object.defineProperty(proto, "owner", { get(this: Owner) { return this.parent; }, configurable: true });

export type JSX = any;
export type Component<P = {}> = (props: P) => any;
export type ParentComponent<P = {}> = (props: P & { children?: any }) => any;
export type ParentProps<P = {}> = P & { children?: any };
export type VoidComponent<P = {}> = (props: P) => any;
export type FlowComponent<P = {}, C = any> = (props: P & { children: C }) => any;
export type ComponentProps<T> = T extends (props: infer P) => any ? P : never;
export { isChildren };
