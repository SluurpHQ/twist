// Solid 1's API (`solid-js` 1.x) on a server, as Solid 1's own server build has it: signals are plain values, memos are
// computed once, effects do not run; on the server layer's owners (what Twist's renderer renders under). A resource is
// the layer's async memo: one id, its answer sent to the client under it, the same answer on every pass of a boundary.
import {
  createMemo as layerMemo,
  createOwner,
  createRoot as layerRoot,
  getOwner,
  runWithOwner as layerRunWithOwner,
  onCleanup,
  NotReadyError,
  mapArray as layerMapArray,
  createRevealOrder,
  createUniqueId,
  children,
  enableExternalSource,
} from "../server/index.ts";
import { sharedConfig } from "../server/shared.ts";
import { Show, Switch, Match } from "../server/flow.ts";
import { createComponent, builtin, isChildren } from "../server/control.ts";
import { createContext as layerContext } from "../server/core.ts";
import { lazy } from "../server-solid.ts";
import { Loading, Errored } from "../server.ts";
import { $PROXY, $TRACK } from "../store.ts";

export { $PROXY, $TRACK, Show, Switch, Match, createComponent, lazy, getOwner, onCleanup, createUniqueId, children, sharedConfig, enableExternalSource, isChildren };
export { mergeProps, splitProps } from "./props.ts";
export const DEV = undefined;
export const untrack = <T,>(fn: () => T): T => fn();
export const getListener = () => null;
export const equalFn = <T,>(a: T, b: T) => a === b;
export type Accessor<T> = () => T;
export type Setter<T> = (next?: T | ((prev: T) => T)) => T;
export type Signal<T> = [Accessor<T>, Setter<T>];
export type Owner = ReturnType<typeof getOwner>;

export const batch = <T,>(fn: () => T): T => fn();

export function createSignal<T>(value?: T, _options?: unknown): Signal<T> {
  return [() => value as T, ((next?: any) => (value = typeof next === "function" ? next(value) : next)) as Setter<T>];
}

/** A memo, computed now (and again when a read of it was not ready). */
export function createMemo<T>(fn: (prev: T) => T, value?: T, _options?: unknown): Accessor<T> {
  let prev = value as T;
  return layerMemo(() => (prev = fn(prev)), { sync: true } as any) as Accessor<T>;
}

/** Computed once, now. */
export function createComputed<T>(fn: (prev: T) => T, value?: T) {
  fn(value as T);
}
export const createRenderEffect = createComputed;
/** Not on a server: effects are the browser's. */
export function createEffect<T>(_fn: (prev: T) => T, _value?: T) {}
export const onMount = (_fn: () => void) => {};
export const onError = (_fn: (err: Error) => void) => {};

export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner | null): T {
  const parent = detachedOwner === undefined ? getOwner() : detachedOwner;
  return layerRunWithOwner(parent, () => layerRoot(fn));
}
export const runWithOwner = <T,>(o: Owner | null, fn: () => T): T => layerRunWithOwner(o, fn);

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
    const result = fn(input, prevInput, prevValue);
    prevInput = input;
    return result;
  };
}

const castError = (e: unknown) => (e instanceof Error ? e : new Error(typeof e === "string" ? e : "Unknown error", { cause: e }));
export function catchError<T>(fn: () => T, handler: (err: Error) => void): T | undefined {
  try {
    return layerRunWithOwner(createOwner(), fn);
  } catch (e) {
    if (e instanceof NotReadyError) throw e;
    handler(castError(e));
  }
}

export const ErrorBoundary = builtin(function ErrorBoundary(props: { fallback: any; children: any }) {
  return Errored({
    get fallback() {
      const f = props.fallback;
      return typeof f === "function" ? (err: () => unknown, reset: () => void) => f(err(), reset) : f;
    },
    get children() {
      return props.children;
    },
  });
});
export const resetErrorBoundaries = () => {};

export const createDeferred = <T,>(source: Accessor<T>, _options?: unknown): Accessor<T> => source;
export const createSelector = <T, U = T>(source: Accessor<T>, fn: (a: U, b: T) => boolean = equalFn as any) => (key: U) => fn(key, source());
export const createReaction = (_onInvalidate: () => void, _options?: unknown) => (tracking: () => void) => void tracking();

// ---------------------------------------------------------------- context

export type Context<T> = { id: symbol; Provider: (props: { value: T; children: any }) => any; defaultValue: T };
export function createContext<T>(defaultValue?: T, options?: { name?: string }): Context<T> {
  const Provider = layerContext(defaultValue, options as any) as any;
  return { id: Provider.id, Provider, defaultValue: defaultValue as T };
}
export function useContext<T>(context: Context<T>): T {
  const v = (getOwner() as any)?._context?.[context.id];
  return v !== undefined ? (v as T) : context.defaultValue;
}

// ---------------------------------------------------------------- lists

export function mapArray<T, U>(list: Accessor<readonly T[] | undefined | null | false>, fn: (v: T, i: Accessor<number>) => U, options?: { fallback?: Accessor<any> }): () => U[] {
  return layerMapArray(list, fn as any, options as any) as any;
}
export function indexArray<T, U>(list: Accessor<readonly T[] | undefined | null | false>, fn: (v: Accessor<T>, i: number) => U, options?: { fallback?: Accessor<any> }): () => U[] {
  return layerMapArray(list, fn as any, { ...(options as any), keyed: false }) as any;
}
export const For = builtin(function For<T>(props: { each: readonly T[] | undefined | null | false; fallback?: any; children: (item: T, index: Accessor<number>) => any }) {
  const fallback = "fallback" in props ? { fallback: () => props.fallback } : undefined;
  return mapArray(() => props.each, props.children.length > 1 ? (item: T, i: Accessor<number>) => props.children(item, i) : (item: T) => (props.children as any)(item), fallback);
});
export const Index = builtin(function Index<T>(props: { each: readonly T[] | undefined | null | false; fallback?: any; children: (item: Accessor<T>, index: number) => any }) {
  const fallback = "fallback" in props ? { fallback: () => props.fallback } : undefined;
  return indexArray(() => props.each, (item, i) => props.children(item, i), fallback);
});

// ---------------------------------------------------------------- async

/** The Suspense boundaries a resource read is under (a pending read there suspends; elsewhere it reads undefined). */
const SUSPENSE = Symbol("solid1.suspense");
/** A Suspense: `boundary` (the renderer's Loading), what it renders made under an owner resource reads know as one. */
export function suspense<R>(boundary: (props: { fallback?: any; children?: any }) => R, props: { fallback?: any; children?: any }): R {
  return boundary({
    get fallback() {
      return props.fallback;
    },
    get children() {
      const o = getOwner() as any;
      if (o) o._context = { ...o._context, [SUSPENSE]: true };
      return props.children;
    },
  });
}
export const Suspense = builtin(function Suspense(props: { fallback?: any; children: any }) {
  return suspense(Loading as any, props);
});
export const SuspenseList = builtin(function SuspenseList(props: { children: any; revealOrder?: "forwards" | "backwards" | "together"; tail?: "collapsed" | "hidden" }) {
  return createRevealOrder(() => props.children, { order: () => (props.revealOrder === "together" ? "together" : props.revealOrder ? "sequential" : "natural"), collapsed: () => !!props.tail });
});

export type ResourceState = "unresolved" | "pending" | "ready" | "refreshing" | "errored";
export type Resource<T> = Accessor<T> & { state: ResourceState; loading: boolean; error: any; latest: T | undefined };
type Fetcher<S, T> = (source: S, info: { value: T | undefined; refetching: unknown }) => T | Promise<T>;

export function createResource<T, S = true>(...args: any[]): [Resource<T>, { mutate: Setter<T>; refetch: () => undefined }] {
  let source: S | Accessor<S | false | null | undefined> | true;
  let fetcher: Fetcher<S, T>;
  let options: { initialValue?: T; ssrLoadFrom?: string };
  if (typeof args[1] === "function") (source = args[0]), (fetcher = args[1]), (options = args[2] || {});
  else (source = true), (fetcher = args[0]), (options = args[1] || {});
  let mutated: { v: T } | null = null;
  // (One id, as the browser's resource takes while hydrating: what the server loaded is sent under it.)
  const memo = layerMemo(() => {
    const lookup = typeof source === "function" ? (source as Accessor<S>)() : (source as S);
    if (lookup == null || lookup === false) return options.initialValue;
    return fetcher(lookup as S, { value: options.initialValue, refetching: false });
  });
  const suspends = !!(getOwner() as any)?._context?.[SUSPENSE];
  const state = (): ResourceState => {
    if (mutated) return "ready";
    try {
      memo();
      return "ready";
    } catch (e) {
      return e instanceof NotReadyError ? (options.initialValue !== undefined ? "refreshing" : "pending") : "errored";
    }
  };
  const read = (() => {
    if (mutated) return mutated.v;
    try {
      return memo();
    } catch (e) {
      // (Pending under a Suspense: the boundary waits. Elsewhere: what it had — the render does not wait on it.)
      if (e instanceof NotReadyError && !(suspends || (getOwner() as any)?._context?.[SUSPENSE])) return options.initialValue;
      throw e;
    }
  }) as Resource<T>;
  Object.defineProperties(read, {
    state: { get: state },
    loading: { get: () => state() === "pending" || state() === "refreshing" },
    error: {
      get() {
        try {
          memo();
        } catch (e) {
          if (!(e instanceof NotReadyError)) return e;
        }
        return undefined;
      },
    },
    latest: { get: () => read() },
  });
  return [read, { mutate: ((v: any) => ((mutated = { v: typeof v === "function" ? v(mutated?.v) : v }), mutated.v)) as Setter<T>, refetch: () => undefined }];
}

export function startTransition(fn: () => unknown): Promise<void> {
  fn();
  return Promise.resolve();
}
export function useTransition(): [Accessor<boolean>, (fn: () => void) => Promise<void>] {
  return [() => false, startTransition];
}

// ---------------------------------------------------------------- observables

export function observable<T>(input: Accessor<T>) {
  return {
    subscribe(observer: ((v: T) => void) | { next?: (v: T) => void }) {
      const handler = typeof observer === "function" ? observer : observer.next?.bind(observer);
      handler?.(input());
      return { unsubscribe() {} };
    },
    [(Symbol as any).observable || "@@observable"]() {
      return this;
    },
  };
}
export function from<T>(_producer: unknown, initialValue?: T): Accessor<T | undefined> {
  return () => initialValue;
}

// ---------------------------------------------------------------- scheduling

export function requestCallback(fn: () => void, options?: { timeout?: number }) {
  const id = setTimeout(fn, 0);
  return { id, fn, startTime: 0, expirationTime: options?.timeout ?? 0 };
}
export const cancelCallback = (task: { id: ReturnType<typeof setTimeout> }) => clearTimeout(task.id);
export const enableScheduling = () => {};
export const setDescribe = (_f: unknown) => {};

export type JSX = any;
export type Component<P = {}> = (props: P) => any;
export type ParentComponent<P = {}> = (props: P & { children?: any }) => any;
export type ParentProps<P = {}> = P & { children?: any };
export type VoidComponent<P = {}> = (props: P) => any;
export type FlowComponent<P = {}, C = any> = (props: P & { children: C }) => any;
export type ComponentProps<T> = T extends (props: infer P) => any ? P : never;
