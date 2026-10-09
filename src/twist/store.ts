// Twist's stores: objects and arrays read property by property (each a node of its own), changed through a draft.
// Writes batch as signals' do: a read sees the committed value until the flush. Written from Solid 2's design (RFC
// 04) and its tests, not its code.
import { Signal, createMemo, untrack, isTracking, guardStoreWrite, refreshTarget } from "./signals.ts";

export const $TARGET = Symbol("store-target");
export const $PROXY = Symbol("store-proxy");
export const $TRACK = Symbol("store-track");
export const $DELETED = Symbol("store-deleted");

const DELETE: unique symbol = Symbol("delete");
type Raw = Record<PropertyKey, any>;

/** Each backing object's state: its key nodes, its proxies, its pending writes. */
class Record_ {
  nodes = new Map<PropertyKey, KeyNode>();
  /** Key set and array length changes: what enumerates the object reads it. */
  keys: KeyNode;
  proxy: any;
  draft: any;
  /** Writes since the last flush, by key (DELETE for a removal). */
  pending: Map<PropertyKey, any> | null = null;
  constructor(public target: Raw) {
    this.keys = new KeyNode(this, $TRACK);
  }
}

const records = new WeakMap<object, Record_>();
const recordOf = (target: Raw) => {
  let r = records.get(target);
  if (!r) records.set(target, (r = new Record_(target)));
  return r;
};

/** A key's node: read tracked, bumped when a flushed write changes the key. The record's key-set node also carries
 * the record's writes into the flush, and commits them there. */
class KeyNode extends Signal<number> {
  constructor(public record: Record_, public key: PropertyKey) {
    super(0, { equals: false, ownedWrite: true });
  }
  override commit() {
    this.settle();
    if (this.key === $TRACK && commitRecord(this.record)) this.bump();
  }
}

/** Whether a value is wrapped in a store proxy: plain objects and arrays (and objects with no prototype). */
export function isWrappable(v: any): v is Raw {
  if (v == null || typeof v !== "object") return false;
  if (v[$PROXY]) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null || Array.isArray(v);
}

/** The backing object under a store proxy (or the value itself). */
export const unwrap = <T>(v: T): T => ((v as any)?.[$TARGET] ?? v);

// ---------------------------------------------------------------- reading

const readHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    if (key === $TRACK) return trackAll(target), receiver;
    const desc = Object.getOwnPropertyDescriptor(target, key);
    // Getters run against the proxy, so what they read is tracked.
    if (desc?.get) return desc.get.call(receiver);
    if (isTracking()) node(target, key).read();
    const v = target[key];
    if (Array.isArray(target) && key === "length") return v;
    // A method of an array (or anything inherited) is not a property of the state.
    if (!desc && typeof v === "function") return v;
    return wrap(v);
  },
  has(target, key) {
    if (key === $PROXY || key === $TARGET) return true;
    if (isTracking()) node(target, key).read();
    return key in target;
  },
  ownKeys(target) {
    if (isTracking()) recordOf(target).keys.read();
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    const desc = Reflect.getOwnPropertyDescriptor(target, key);
    if (!desc || desc.get || !desc.configurable) return desc;
    return { ...desc, value: wrap(desc.value) };
  },
  // Read-only from the outside: changes go through the setter.
  set: () => true,
  deleteProperty: () => true,
  defineProperty: () => true,
};

function node(target: Raw, key: PropertyKey): KeyNode {
  const r = recordOf(target);
  let n = r.nodes.get(key);
  if (!n) r.nodes.set(key, (n = new KeyNode(r, key)));
  return n;
}

function trackAll(target: Raw) {
  recordOf(target).keys.read();
}

const proxies = new WeakMap<object, any>();
export function wrap<T>(v: T): T {
  if (!isWrappable(v)) return v;
  let p = proxies.get(v as object);
  if (!p) proxies.set(v as object, (p = new Proxy(v as Raw, readHandler)));
  return p;
}

// ---------------------------------------------------------------- writing

/** What a draft reads: this tick's pending write if there is one, else the committed value. */
function pendingValue(target: Raw, key: PropertyKey): any {
  const p = records.get(target)?.pending;
  if (p && p.has(key)) {
    const v = p.get(key);
    return v === DELETE ? undefined : v;
  }
  return target[key];
}
function pendingHas(target: Raw, key: PropertyKey): boolean {
  const p = records.get(target)?.pending;
  if (p && p.has(key)) return p.get(key) !== DELETE;
  return key in target;
}

/** Records with pending writes, committed at the next flush. */
const dirtyRecords = new Set<Record_>();

function stage(target: Raw, key: PropertyKey, value: any) {
  const r = recordOf(target);
  (r.pending ??= new Map()).set(key, value);
  if (!dirtyRecords.has(r)) {
    dirtyRecords.add(r);
    // The record's key-set node carries the writes into the flush, where it commits them.
    r.keys.write(0);
  }
}


/** A record's pending writes applied to its backing object, each changed key's readers told (called by the flush). */
export function commitRecord(r: Record_) {
  dirtyRecords.delete(r);
  const p = r.pending;
  r.pending = null;
  if (!p) return false;
  const t = r.target;
  let shape = false;
  const lenBefore = Array.isArray(t) ? t.length : 0;
  for (const [key, v] of p) {
    if (v === DELETE) {
      if (!(key in t)) continue;
      delete t[key];
      shape = true;
    } else {
      const had = Object.prototype.hasOwnProperty.call(t, key);
      if (had && Object.is(t[key], v) && key !== "length") continue;
      if (!had) shape = true;
      const desc = had ? Object.getOwnPropertyDescriptor(t, key) : undefined;
      if (desc && !desc.writable && !desc.set && desc.configurable) Object.defineProperty(t, key, { ...desc, value: v });
      else t[key] = v;
    }
    r.nodes.get(key)?.bump();
  }
  if (Array.isArray(t) && t.length !== lenBefore) {
    shape = true;
    r.nodes.get("length")?.bump();
    // Indices past a shorter length are gone: their readers told.
    for (const [k, n] of r.nodes) if (typeof k === "string" && /^\d+$/.test(k) && +k >= t.length && +k < lenBefore) n.bump();
  }
  return shape;
}

const draftHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    const v = pendingValue(target, key);
    if (typeof v === "function" && !Object.prototype.hasOwnProperty.call(target, key)) return v;
    return draftOf(v);
  },
  has: (target, key) => pendingHas(target, key),
  ownKeys(target) {
    const keys = new Set<string | symbol>(Reflect.ownKeys(target));
    const p = records.get(target)?.pending;
    if (p) for (const [k, v] of p) v === DELETE ? keys.delete(k) : keys.add(k);
    if (Array.isArray(target)) {
      // Indices at or past the pending length are gone.
      const len = pendingValue(target, "length");
      for (const k of keys) if (typeof k === "string" && /^\d+$/.test(k) && +k >= len) keys.delete(k);
    }
    return [...keys];
  },
  getOwnPropertyDescriptor(target, key) {
    if (!pendingHas(target, key)) return undefined;
    const base = Reflect.getOwnPropertyDescriptor(target, key);
    if (base?.get || base?.set) return base;
    return { value: pendingValue(target, key), writable: true, enumerable: base?.enumerable ?? true, configurable: true };
  },
  set(target, key, value) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") return true;
    const raw = unwrap(value);
    if (Array.isArray(target) && key === "length") {
      const before = pendingValue(target, "length");
      for (let i = raw; i < before; i++) stage(target, String(i), DELETE);
      stage(target, "length", raw);
      return true;
    }
    stage(target, key, raw);
    // An index past the end extends the array.
    if (Array.isArray(target) && typeof key === "string" && /^\d+$/.test(key) && +key >= pendingValue(target, "length")) stage(target, "length", +key + 1);
    return true;
  },
  deleteProperty(target, key) {
    if (pendingHas(target, key)) stage(target, key, DELETE);
    return true;
  },
  defineProperty(target, key, desc) {
    if ("value" in desc) stage(target, key, unwrap(desc.value));
    else Object.defineProperty(target, key, desc);
    return true;
  },
};

const drafts = new WeakMap<object, any>();
function draftOf<T>(v: T): T {
  if (!isWrappable(v)) return v;
  let d = drafts.get(v as object);
  if (!d) drafts.set(v as object, (d = new Proxy(v as Raw, draftHandler)));
  return d;
}

/** A setter's return value replaces the target's contents (a shallow diff: keys gone are removed). */
function replaceInto(target: Raw, next: any) {
  const raw = unwrap(next);
  if (raw === target || !isWrappable(raw)) return;
  const d = draftOf(target);
  if (Array.isArray(target)) {
    for (let i = 0; i < raw.length; i++) d[i] = raw[i];
    d.length = raw.length;
    return;
  }
  for (const k of Reflect.ownKeys(d)) if (!(k in raw)) delete d[k];
  for (const k of Reflect.ownKeys(raw)) d[k] = raw[k];
}

export type StoreSetter<T> = (fn: ((draft: T) => T | void) | Partial<T>) => void;

/** A store and its setter; given a function, a store derived from what the function reads (RFC 04). */
export function createStore<T extends object>(init: T | ((draft: T) => T | void | Promise<T | void>), seed?: T, options?: { key?: string | ((v: any) => any) }): [T, StoreSetter<T>] {
  if (typeof init === "function") return derivedStore(init as any, seed ?? ({} as T), options, true) as [T, StoreSetter<T>];
  const target = unwrap(init) as Raw;
  const set: StoreSetter<T> = (fn) => {
    guardStoreWrite();
    const d = draftOf(target);
    if (typeof fn === "function") {
      const r = (fn as (d: T) => T | void)(d as T);
      if (r !== undefined) replaceInto(target, r);
    } else replaceInto(target, { ...untrack(() => ({ ...d })), ...(fn as object) });
  };
  return [wrap(target) as T, set];
}

/** A read-only store derived from what `fn` reads: it changes its draft, or returns a value reconciled into it. */
export function createProjection<T extends object>(fn: (draft: T) => T | void | Promise<T | void>, seed: T = {} as T, options?: { key?: string | ((v: any) => any) }): T {
  return derivedStore(fn, seed, options, false)[0];
}

function derivedStore<T extends object>(fn: (draft: T) => any, seed: T, options: { key?: string | ((v: any) => any) } | undefined, writable: boolean): [T, StoreSetter<T>] {
  const target = unwrap(seed) as Raw;
  const key = options?.key ?? "id";
  // The derive: run as a memo, its draft writes staged like a setter's (owned writes are allowed here).
  const m = createMemo(() => {
    const d = draftOf(target);
    const r = fn(d as T);
    if (r !== undefined && !(r instanceof Promise)) reconcile(r, key)(d);
    else if (r instanceof Promise) r.then((v: any) => v !== undefined && reconcile(v, key)(draftOf(target)));
    return undefined;
  }, { ownedWrite: true } as any);
  const proxy = new Proxy(target, {
    ...readHandler,
    get(t, k, receiver) {
      // Every read brings the derive up to date first.
      m();
      return readHandler.get!(t, k, receiver);
    },
    ownKeys(t) {
      m();
      return readHandler.ownKeys!(t);
    },
    has(t, k) {
      m();
      return readHandler.has!(t, k);
    },
  });
  refreshTarget(proxy, () => m);
  const set: StoreSetter<T> = (change) => {
    guardStoreWrite();
    const d = draftOf(target);
    if (typeof change === "function") {
      const r = (change as (d: T) => T | void)(d as T);
      if (r !== undefined) replaceInto(target, r);
    } else replaceInto(target, { ...(change as object) });
  };
  return [proxy as T, writable ? set : (undefined as any)];
}

// ---------------------------------------------------------------- reconcile, snapshot, deep

/** New data diffed into a store's draft (or a part of it), keeping identity for entries with the same key. */
export function reconcile<T>(value: T, key: string | ((v: any) => any) | null = "id") {
  return (draft: any) => {
    if (draft == null) return;
    reconcileInto(unwrap(draft), unwrap(value) as any, key);
    return draft;
  };
}

const keyOf = (key: string | ((v: any) => any) | null, v: any) => (key == null || v == null || typeof v !== "object" ? v : typeof key === "function" ? key(v) : v[key]);

function reconcileInto(target: Raw, next: Raw, key: string | ((v: any) => any) | null) {
  const d = draftOf(target);
  if (Array.isArray(target) && Array.isArray(next)) {
    const old = untrack(() => [...(d as any[])].map(unwrap));
    const byKey = new Map<any, Raw>();
    if (key != null) for (const o of old) if (o && typeof o === "object") byKey.set(keyOf(key, o), o);
    for (let i = 0; i < next.length; i++) {
      const n = unwrap(next[i]);
      const match = key == null ? old[i] : n && typeof n === "object" ? byKey.get(keyOf(key, n)) : undefined;
      if (match && isWrappable(match) && isWrappable(n) && match !== n) {
        reconcileInto(match, n, key);
        d[i] = match;
      } else d[i] = n;
    }
    d.length = next.length;
    return;
  }
  for (const k of Reflect.ownKeys(d)) if (!(k in next)) delete d[k];
  for (const k of Reflect.ownKeys(next)) {
    const n = unwrap(next[k as any]);
    const o = unwrap(pendingValue(target, k));
    if (isWrappable(o) && isWrappable(n) && o !== n && (Array.isArray(o) === Array.isArray(n)) && (key == null || keyOf(key, o) === keyOf(key, n))) reconcileInto(o, n, key);
    else d[k] = n;
  }
}

const snapshots = new WeakMap<object, { at: number; value: any }>();

/** A plain copy of a store's committed state, untracked (the same copy while nothing in it changed). */
export function snapshot<T>(v: T): T {
  return untrack(() => plain(unwrap(v), new Map())) as T;
}

function plain(v: any, seen: Map<any, any>): any {
  if (!isWrappable(v)) return v;
  if (seen.has(v)) return seen.get(v);
  const out: any = Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v));
  seen.set(v, out);
  for (const k of Reflect.ownKeys(v)) {
    const desc = Object.getOwnPropertyDescriptor(v, k)!;
    if (desc.get) Object.defineProperty(out, k, desc);
    else out[k] = plain(unwrap(desc.value), seen);
  }
  return out;
}

/** Every property read (so any nested change re-runs the reader), answered as a plain snapshot. */
export function deep<T>(v: T): T {
  const visit = (x: any, seen: Set<any>) => {
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    for (const k of Reflect.ownKeys(x)) visit(x[k], seen);
  };
  visit(v, new Set());
  return snapshot(v);
}

