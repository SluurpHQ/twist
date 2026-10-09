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
  const when = createMemo(() => props.when, { equals: props.keyed ? Object.is : (a: any, b: any) => !a === !b });
  return createMemo(() => {
    const w = when();
    if (!w) return props.fallback;
    const c = props.children;
    if (typeof c === "function" && c.length > 0 && !isChildren(c)) return untrack(() => c(props.keyed ? w : () => props.when));
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
  const picked = createMemo(
    () => {
      const ms = matches();
      for (let i = 0; i < ms.length; i++) {
        const w = ms[i]!.when;
        if (w) return [i, w] as const;
      }
      return [-1, undefined] as const;
    },
    { equals: (a: any, b: any) => a[0] === b[0] && (ms(a[0])?.keyed ? a[1] === b[1] : !a[1] === !b[1]) },
  );
  const ms = (i: number) => matches()[i];
  return createMemo(() => {
    const [i, w] = picked();
    if (i < 0) return props.fallback;
    const m = matches()[i]!;
    const c = m.children;
    if (typeof c === "function" && c.length > 0 && !isChildren(c)) return untrack(() => c(m.keyed ? w : () => m.when));
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
    (err, reset) => (typeof props.fallback === "function" ? untrack(() => props.fallback(err, reset)) : props.fallback),
  );
}

