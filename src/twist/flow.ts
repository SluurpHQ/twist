// Lists and props helpers: mapArray (by identity, by position or by key), repeat, merge, omit.
import { createMemo, keepMemo, ownerUnder, getOwner, runOwned, untrack, Signal, onCleanup, type Owner } from "./signals.ts";
import { $PROXY } from "./store.ts";

type Accessor<T> = () => T;
type Keyed<T> = boolean | ((item: T) => unknown) | undefined;

/** `fn` in an item's own scope, kept in `owners[at]` (disposed with disposeScope when the item leaves the list). */
function scope<T, A, B>(parent: Owner | null, owners: Owner[], at: number, fn: (a: A, b: B) => T, a?: A, b?: B): T {
  return runOwned((owners[at] = ownerUnder(parent)), fn, a, b);
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
  if (parent?.owned) leave(parent as Owner & { gone?: number }, o);
}
/** A disposed item out of its parent's list: counted, the list compacted once half of it is gone (rows go in bulk). */
function leave(parent: Owner & { gone?: number }, o: Owner) {
  const owned = parent.owned!;
  if (owned[owned.length - 1] === o) return void owned.pop();
  parent.gone = (parent.gone ?? 0) + 1;
  if (parent.gone * 2 < owned.length) return;
  parent.owned = owned.filter((c) => !c.disposed);
  parent.gone = 0;
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
  // (A row that takes no index gets no cell for one.)
  const indexed = fn.length > 1;
  let keys: unknown[] = [];
  let rows: U[] = [];
  let owners: Owner[] = [];
  let indexes: ReturnType<typeof cell<number>>[] = [];
  let items: ReturnType<typeof cell<T>>[] = [];
  const fallbackOwner: Owner[] = [];
  let fallbackRow: U[] | null = null;
  const end = (o: Owner) => disposeScope(o, parent);
  onCleanup(() => {
    owners.forEach(end);
    fallbackOwner.forEach(end);
  });
  return keepMemo(createMemo(() => {
    // Every item read here, tracked (a store list keeps its identity while its items move); mapped untracked.
    const source = (list() || []) as T[];
    const next = Array.from(source);
    return untrack(() => {
      if (!next.length) {
        owners.forEach(end);
        keys = [];
        rows = [];
        owners = [];
        indexes = [];
        items = [];
        if (!options.fallback) return rows;
        return (fallbackRow ??= [scope(parent, fallbackOwner, 0, options.fallback)]);
      }
      if (fallbackRow) end(fallbackOwner.pop()!), (fallbackRow = null);
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
            out[i] = scope(parent, owners, i, fn, item.read, i);
          }
        }
        for (let i = next.length; i < rows.length; i++) end(owners[i]!);
        owners.length = items.length = next.length;
        return (rows = out);
      }
      // By identity or key: where each old key was (several places for one listed twice).
      // (A place, or the places of a key listed more than once, last first.)
      const at = new Map<unknown, number | number[]>();
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        const places = at.get(k);
        if (places === undefined) at.set(k, i);
        else if (typeof places === "number") at.set(k, [places, i]);
        else places.push(i);
      }
      const nextKeys = keyed === true ? next : next.map(keyOf);
      const out: U[] = new Array(next.length);
      const outOwners: Owner[] = new Array(next.length);
      const outIndexes: ReturnType<typeof cell<number>>[] = new Array(next.length);
      const outItems: ReturnType<typeof cell<T>>[] = new Array(next.length);
      const kept = new Uint8Array(keys.length);
      for (let j = 0; j < next.length; j++) {
        const places = keys.length ? at.get(nextKeys[j]) : undefined;
        const i = typeof places === "number" ? (at.delete(nextKeys[j]), places) : places?.pop();
        if (i !== undefined) {
          kept[i] = 1;
          out[j] = rows[i]!;
          outOwners[j] = owners[i]!;
          if (indexed) (outIndexes[j] = indexes[i]!).set(j);
          if (typeof keyed === "function") (outItems[j] = items[i]!).set(next[j]!);
        } else {
          const index = indexed ? (outIndexes[j] = cell(j)) : null;
          const item = typeof keyed === "function" ? (outItems[j] = cell<T>(next[j]!)) : null;
          out[j] = scope(parent, outOwners, j, fn, item ? item.read : next[j], index?.read);
        }
      }
      for (let i = 0; i < keys.length; i++) if (!kept[i]) end(owners[i]!);
      keys = nextKeys;
      owners = outOwners;
      indexes = outIndexes;
      items = outItems;
      return (rows = out);
    });
  }));
}

/** `fn(index)` for each index from `from` (0 unless given) up to `from + count`: rows kept, none diffed. */
export function repeat<U>(count: Accessor<number>, fn: (index: number) => U, options: { from?: Accessor<number>; fallback?: () => U } = {}): Accessor<U[]> {
  const parent = getOwner();
  const made = new Map<number, [U, Owner]>();
  let fallback: [U, Owner] | null = null;
  const end = (o: Owner) => disposeScope(o, parent);
  const row = (fn: () => U): [U, Owner] => {
    const o: Owner[] = [];
    return [scope(parent, o, 0, fn), o[0]!];
  };
  onCleanup(() => {
    for (const [, o] of made.values()) end(o);
    if (fallback) end(fallback[1]);
  });
  return keepMemo(createMemo(() => {
    const n = Math.max(0, count() | 0);
    const from = options.from ? options.from() | 0 : 0;
    return untrack(() => {
      for (const [i, [, o]] of made) if (i < from || i >= from + n) end(o), made.delete(i);
      if (!n) {
        if (!options.fallback) return [];
        fallback ??= row(options.fallback);
        return [fallback[0]];
      }
      if (fallback) end(fallback[1]), (fallback = null);
      const out: U[] = new Array(n);
      for (let k = 0; k < n; k++) {
        const i = from + k;
        let r = made.get(i);
        if (!r) made.set(i, (r = row(() => fn(i))));
        out[k] = r[0];
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
  // (A proxy answering for keys it does not list — a store, a slot props proxy — is read per key too, as Solid's merge does.)
  if (list.some((s) => typeof s === "function" || (s as any)[LIVE] || (typeof s === "object" && $PROXY in s))) {
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
