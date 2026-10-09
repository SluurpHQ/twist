// `solid-js`: Solid 2's API on Sluurp's signals. Components run once; what they read updates only what read it.
import { collect, effect as signalEffect, flush, getOwner, isPending, memo, onCleanup, onMount, runWithOwner, selector, signal, untrack, computed, action, store } from "../../signals/index.js";

export { flush, getOwner, isPending, onCleanup, runWithOwner, untrack, action };

type Accessor<T> = () => T;
type Setter<T> = (next: T | ((prev: T) => T)) => T;

/** A value and its setter; given a function, a value worked out from what it reads that can still be set. */
export function createSignal<T>(value: T | ((prev?: T) => T), _options?: { equals?: false | ((a: T, b: T) => boolean) }): [Accessor<T>, Setter<T>] {
  const s: any = typeof value === "function" ? computed(value as any) : signal(value);
  const set: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as any)(s.peek()) : next;
    s.set(v);
    return v;
  };
  return [s, set];
}

/** A value worked out from what it reads, again only when that changes. */
export const createMemo = <T>(fn: (prev?: T) => T): Accessor<T> => memo(fn as any) as Accessor<T>;

/**
 * Solid 2's split effect: `compute` tracks and gives a value, `apply` does the work with it, untracked, and may give
 * back a cleanup, run before the next apply and when the owner ends.
 */
export function createEffect<T>(compute: (prev?: T) => T, apply?: (value: T, prev?: T) => void | (() => void)) {
  let clean: void | (() => void);
  if (!apply) return void signalEffect(compute as any);
  signalEffect(compute as any, (value: T, prev?: T) => {
    if (typeof clean === "function") clean();
    clean = apply(value, prev);
  });
  onCleanup(() => typeof clean === "function" && clean());
}
export const createRenderEffect = createEffect;

/** Run once what is being built is on the page (its returned function runs when it ends). */
export const onSettled = (fn: () => void | (() => void)) => onMount(fn);

/** Its own scope: what `fn` builds is disposed by the function it is given. */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  let dispose = () => {};
  const [value, end] = collect(() => fn(() => dispose()));
  dispose = end;
  return value;
}

/** Whether `source` equals a key, per key: a change wakes only the old key's readers and the new one's. */
export const createSelector = <T>(source: Accessor<T>) => selector(source) as (key: T) => boolean;

/** Kept for code written for Solid 1: writes are batched already. */
export const batch = <T>(fn: () => T): T => fn();

/** A component, run once, untracked (its props are read where they are used). */
export function createComponent<P>(Comp: (props: P) => any, props: P) {
  return untrack(() => Comp(props));
}

// ---------------------------------------------------------------- lists

/**
 * Each item mapped once, by identity: an item kept keeps what it made (and its owner), a new one is made, a gone one
 * disposed. What it answers is the list of what each made, in the list's order.
 */
export function mapArray<T, U>(list: Accessor<readonly T[] | null | undefined | false>, fn: (item: T, index: Accessor<number>) => U): Accessor<U[]> {
  let items: T[] = [];
  let mapped: U[] = [];
  let ends: (() => void)[] = [];
  let indexes: ((i: number) => void)[] | null = fn.length > 1 ? [] : null;
  onCleanup(() => {
    for (const end of ends) end();
  });
  return () => {
    const next = (list() || []) as T[];
    return untrack(() => {
      if (!next.length) {
        for (const end of ends) end();
        items = [];
        mapped = [];
        ends = [];
        if (indexes) indexes = [];
        return mapped;
      }
      // Where each old item was (several places for an item listed twice).
      const at = new Map<T, number[]>();
      for (let i = items.length - 1; i >= 0; i--) {
        const k = items[i]!;
        const list = at.get(k);
        list ? list.push(i) : at.set(k, [i]);
      }
      const nextMapped: U[] = new Array(next.length);
      const nextEnds: (() => void)[] = new Array(next.length);
      const nextIndexes: ((i: number) => void)[] | null = indexes ? new Array(next.length) : null;
      const kept = new Uint8Array(items.length);
      for (let j = 0; j < next.length; j++) {
        const i = at.get(next[j]!)?.pop();
        if (i !== undefined) {
          kept[i] = 1;
          nextMapped[j] = mapped[i]!;
          nextEnds[j] = ends[i]!;
          if (nextIndexes) (nextIndexes[j] = indexes![i]!)(j);
        } else {
          const index = signal(j);
          const [value, end] = collect(() => fn(next[j]!, index as Accessor<number>));
          nextMapped[j] = value;
          nextEnds[j] = end;
          if (nextIndexes) nextIndexes[j] = (n) => index.set(n);
        }
      }
      for (let i = 0; i < items.length; i++) if (!kept[i]) ends[i]!();
      items = next.slice();
      mapped = nextMapped;
      ends = nextEnds;
      indexes = nextIndexes;
      return mapped;
    });
  };
}

/** A list, each item rendered once by `children` (kept while it stays in the list). */
export function For<T>(props: { each: readonly T[] | null | undefined | false; fallback?: any; children: (item: T, index: Accessor<number>) => any }) {
  const fallback = "fallback" in props;
  const mapped = mapArray(() => props.each, (item, index) => props.children(item, index));
  return fallback ? () => (props.each && (props.each as T[]).length ? mapped() : props.fallback) : mapped;
}

/** `children` while `when` holds (given what it holds, if it is a function), else `fallback`. */
export function Show<T>(props: { when: T | undefined | null | false; fallback?: any; children: any }) {
  const when = memo(() => props.when);
  const shown = memo(() => !!when());
  return memo(() => {
    if (!shown()) return props.fallback;
    const c = props.children;
    return typeof c === "function" && c.length > 0 ? untrack(() => c(() => when())) : c;
  });
}

/** Shallow stores (Solid's createStore): reads track per property; setters change through a draft. */
export function createStore<T extends object>(initial: T): [T, (fn: (draft: T) => void) => void] {
  const [state, set] = store(initial) as any;
  return [state, set];
}
