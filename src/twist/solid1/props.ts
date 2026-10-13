// Solid 1's props helpers (kernel-free: its browser and its server entry both use them).
import { LIVE } from "../marks.ts";
import { $PROXY as STORE_PROXY } from "../store.ts";
import { $PROXY } from "../core/index.ts";

/** Props whose keys can change (a store, a merge of one, an accessor of props): read through a proxy. */
// (A live object: a function of props, a store of either kernel, merged or spread props.)
const isLive = (o: any) => typeof o === "function" || (o != null && ($PROXY in o || STORE_PROXY in o || LIVE in o));
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

