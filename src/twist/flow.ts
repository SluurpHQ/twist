// Lists and props helpers: mapArray (by identity, by position or by key), repeat, merge, omit.
import { createMemo, keepMemo, ownerUnder, getOwner, runWithOwner, untrack, Signal, onCleanup, type Owner } from "./signals.ts";

type Accessor<T> = () => T;
type Keyed<T> = boolean | ((item: T) => unknown) | undefined;

/** An item's own scope, disposed when the item leaves the list. */
function scope<T>(parent: Owner | null, fn: () => T): [T, () => void] {
  const o = ownerUnder(parent);
  const value = runWithOwner(o, fn);
  return [value, () => disposeScope(o, parent)];
}
function disposeScope(o: Owner, parent: Owner | null) {
  if (o.disposed) return;
  o.disposed = true;
  const owned = o.owned;
  o.owned = null;
  if (owned) for (let i = owned.length - 1; i >= 0; i--) disposeAny(owned[i]!);
  const cleanups = o.cleanups;
  o.cleanups = null;
  if (cleanups) for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!();
  if (parent?.owned) {
    const i = parent.owned.indexOf(o);
    if (i >= 0) parent.owned.splice(i, 1);
  }
}
const disposeAny = (o: Owner) => ((o as any).end ? disposeComputation(o) : disposeScope(o, null));
function disposeComputation(o: Owner) {
  // A computation disposes through its own owner path.
  disposeScope(o, null);
  (o as any).end();
}

/** A value as a node of its own (an item's index or a slot's item), set without the owned-scope guard. */
function cell<T>(v: T) {
  const s = new Signal<T>(v, { ownedWrite: true });
  return { read: () => s.read(), set: (n: T) => s.write(n) };
}

/**
 * Each item mapped once and kept while it stays: by identity (`fn(item, index())`), by position
 * (`keyed: false`: `fn(item(), index)`), or by a key (`keyed: item => key`: `fn(item(), index())`).
 */
export function mapArray<T, U>(
  list: Accessor<readonly T[] | null | undefined | false>,
  fn: (item: any, index: any) => U,
  options: { keyed?: Keyed<T>; fallback?: () => U } = {},
): Accessor<U[]> {
  const parent = getOwner();
  const keyed = options.keyed ?? true;
  const keyOf = typeof keyed === "function" ? keyed : (v: T) => v;
  let keys: unknown[] = [];
  let rows: U[] = [];
  let ends: (() => void)[] = [];
  let indexes: ReturnType<typeof cell<number>>[] = [];
  let items: ReturnType<typeof cell<T>>[] = [];
  let fallbackEnd: (() => void) | null = null;
  let fallbackRow: U[] | null = null;
  onCleanup(() => {
    for (const end of ends) end();
    fallbackEnd?.();
  });
  return keepMemo(createMemo(() => {
    // Every item read here, tracked (a store list keeps its identity while its items move); mapped untracked.
    const source = (list() || []) as T[];
    const next = Array.from(source);
    return untrack(() => {
      if (!next.length) {
        for (const end of ends) end();
        keys = [];
        rows = [];
        ends = [];
        indexes = [];
        items = [];
        if (!options.fallback) return rows;
        if (!fallbackRow) {
          const [v, end] = scope(parent, () => options.fallback!());
          fallbackRow = [v];
          fallbackEnd = end;
        }
        return fallbackRow;
      }
      if (fallbackEnd) fallbackEnd(), (fallbackEnd = null), (fallbackRow = null);
      // By position: slots kept, their item set.
      if (keyed === false) {
        const out: U[] = new Array(next.length);
        for (let i = 0; i < next.length; i++) {
          if (i < rows.length) {
            items[i]!.set(next[i]!);
            out[i] = rows[i]!;
          } else {
            const item = cell<T>(next[i]!);
            items[i] = item;
            const [v, end] = scope(parent, () => fn(item.read, i));
            out[i] = v;
            ends[i] = end;
          }
        }
        for (let i = next.length; i < rows.length; i++) ends[i]!();
        ends.length = items.length = next.length;
        return (rows = out);
      }
      // By identity or key: where each old key was (several places for one listed twice).
      const at = new Map<unknown, number[]>();
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        const places = at.get(k);
        places ? places.push(i) : at.set(k, [i]);
      }
      const nextKeys = next.map(keyOf);
      const out: U[] = new Array(next.length);
      const outEnds: (() => void)[] = new Array(next.length);
      const outIndexes: ReturnType<typeof cell<number>>[] = new Array(next.length);
      const outItems: ReturnType<typeof cell<T>>[] = new Array(next.length);
      const kept = new Uint8Array(keys.length);
      for (let j = 0; j < next.length; j++) {
        const i = at.get(nextKeys[j])?.pop();
        if (i !== undefined) {
          kept[i] = 1;
          out[j] = rows[i]!;
          outEnds[j] = ends[i]!;
          (outIndexes[j] = indexes[i]!).set(j);
          if (typeof keyed === "function") (outItems[j] = items[i]!).set(next[j]!);
        } else {
          const index = (outIndexes[j] = cell(j));
          const item = typeof keyed === "function" ? (outItems[j] = cell<T>(next[j]!)) : null;
          const [v, end] = scope(parent, () => fn(item ? item.read : next[j], index.read));
          out[j] = v;
          outEnds[j] = end;
        }
      }
      for (let i = 0; i < keys.length; i++) if (!kept[i]) ends[i]!();
      keys = nextKeys;
      ends = outEnds;
      indexes = outIndexes;
      items = outItems;
      return (rows = out);
    });
  }));
}

/** `fn(index)` for each index from `from` (0 unless given) up to `from + count`: rows kept, none diffed. */
export function repeat<U>(count: Accessor<number>, fn: (index: number) => U, options: { from?: Accessor<number>; fallback?: () => U } = {}): Accessor<U[]> {
  const parent = getOwner();
  const made = new Map<number, [U, () => void]>();
  let fallback: [U, () => void] | null = null;
  onCleanup(() => {
    for (const [, end] of made.values()) end();
    fallback?.[1]();
  });
  return keepMemo(createMemo(() => {
    const n = Math.max(0, count() | 0);
    const from = options.from ? options.from() | 0 : 0;
    return untrack(() => {
      for (const [i, [, end]] of made) if (i < from || i >= from + n) end(), made.delete(i);
      if (!n) {
        if (!options.fallback) return [];
        fallback ??= scope(parent, () => options.fallback!());
        return [fallback[0]];
      }
      if (fallback) fallback[1](), (fallback = null);
      const out: U[] = new Array(n);
      for (let k = 0; k < n; k++) {
        const i = from + k;
        let row = made.get(i);
        if (!row) made.set(i, (row = scope(parent, () => fn(i))));
        out[k] = row[0];
      }
      return out;
    });
  }));
}

// ---------------------------------------------------------------- props

/** Sources merged into one view: later ones win (an undefined value too), each read where it is used. */
/** Marks a view whose keys can change (read each time). */
export const LIVE = Symbol("twist.live");

export function merge<T extends object[]>(...sources: T): any {
  const list = sources.filter((s) => s != null);
  const view: any = {};
  const keys = new Set<PropertyKey>();
  // (A function source is read for its object, keys and values alike.)
  const at = (s: any) => (typeof s === "function" ? s() ?? {} : s);
  // A source whose keys can change (a function, a live view): the merge is live too, its keys read each time.
  if (list.some((s) => typeof s === "function" || (s as any)[LIVE])) {
    const ordered = () => {
      const ks = new Set<PropertyKey>();
      for (const s of list) for (const k of Reflect.ownKeys(at(s))) ks.delete(k), ks.add(k);
      return [...ks];
    };
    const find = (k: PropertyKey) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = at(list[i]);
        if (k in s) return s;
      }
    };
    return new Proxy({ [LIVE]: true } as any, {
      get: (_t, k) => (k === LIVE ? true : find(k)?.[k]),
      has: (_t, k) => k === LIVE || find(k) !== undefined,
      ownKeys: () => ordered(),
      getOwnPropertyDescriptor: (_t, k) => (find(k) ? { enumerable: true, configurable: true, get: () => find(k)?.[k] } : undefined),
    });
  }
  // Each key where its winning (last) source puts it.
  for (const s of list) for (const k of Reflect.ownKeys(at(s))) keys.delete(k), keys.add(k);
  for (const k of keys) {
    Object.defineProperty(view, k, {
      enumerable: true,
      configurable: true,
      get() {
        for (let i = list.length - 1; i >= 0; i--) {
          const s = at(list[i]);
          if (k in s) return s[k];
        }
      },
    });
  }
  return view;
}

/** A view of `props` without the given keys (read where used). */
export function omit<T extends object, K extends keyof T>(props: T, ...keys: (K | ((k: PropertyKey) => boolean))[]): Omit<T, K> {
  // Keys, or a rule that names them.
  const rules = keys.filter((k) => typeof k === "function") as ((k: PropertyKey) => boolean)[];
  const skip = new Set<PropertyKey>(keys.filter((k) => typeof k !== "function") as PropertyKey[]);
  const view: any = {};
  for (const k of Reflect.ownKeys(props)) {
    if (skip.has(k) || rules.some((r) => r(k))) continue;
    Object.defineProperty(view, k, { enumerable: true, configurable: true, get: () => (props as any)[k] });
  }
  return view;
}

/** Whether a prop is a plain value (not a getter that follows something): a source read once, then. */
export function isStatic(props: object, key: PropertyKey): boolean {
  const d = Object.getOwnPropertyDescriptor(props, key);
  return !d || !d.get;
}
