// Control flow and components, renderer-neutral (exported by solid-js): For, Repeat, Show, Switch/Match, Loading,
// Errored, createComponent, and the marks Twist's JSX pass leaves for the runtime.
import { createErrorBoundary, createLoadingBoundary, createMemo, flatten, untrack } from "./signals.ts";
import { mapArray, repeat } from "./flow.ts";

// ---------------------------------------------------------------- marks from the pass

const DYNAMIC = Symbol("twist.dynamic");
const CHILDREN = Symbol("twist.children");

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
export function createComponent<P>(Comp: (props: P) => any, props: P) {
  return untrack(() => Comp(props));
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

/** One branch of a Switch. */
export function Match<T>(props: MatchProps<T>) {
  return { [MATCH]: true, props } as any;
}

/** The first Match whose `when` holds, else `fallback`. */
export function Switch(props: { fallback?: any; children: any }) {
  const matches = createMemo(() => {
    const list = flatten(typeof props.children === "function" ? props.children() : props.children);
    return (Array.isArray(list) ? list : [list]).filter((m: any) => m && m[MATCH]).map((m: any) => m.props as MatchProps<unknown>);
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
export function Loading(props: { fallback?: any; on?: unknown; children: any }) {
  return createLoadingBoundary(() => props.children, () => props.fallback);
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
  let loading: Promise<unknown> | null = null;
  const Comp = (props: P) => {
    if (loaded) return loaded(props);
    loading ??= load().then((m) => (loaded = m.default));
    const ready = createMemo(() => loading!.then(() => true));
    return createMemo(() => ((ready() as unknown as boolean) ? untrack(() => loaded!(props)) : undefined));
  };
  (Comp as any).preload = () => (loading ??= load().then((m) => (loaded = m.default)));
  return Comp;
}

