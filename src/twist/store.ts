// Twist's stores: objects and arrays read property by property (each a node of its own), changed through a draft.
// Writes batch as signals' do: a read sees the committed value until the flush. Written from Solid 2's design (RFC
// 04) and its tests, not its code.
import { emitDiagnostic } from "./diagnostics.ts";
import { Signal, DEV, isFlushing, trackNode, isVerdictReading, isAuthoritative, registerGraph, getOwner, createMemo, untrack, isTracking, guardStoreWrite, refreshTarget, queueGuess, endWith, onTake, NotReadyError, isServerRender, type Transaction } from "./signals.ts";
import { registerProjectionTrace } from "./container-trace.ts";

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
  /** Optimistic values shown over the truth, by key, each with the transaction it lives as long as. */
  overlay: Map<PropertyKey, { v: any; tx: Transaction | null }> | null = null;
  /** Optimistic writes waiting for the next flush. */
  guessing: Map<PropertyKey, any> | null = null;
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
  /** A flushed write's value, staged like a signal's (held by a transaction, or put on the object when promoted). */
  raw: any = NO_RAW;
  seq = 0;
  constructor(public record: Record_, public key: PropertyKey) {
    super(0, { equals: false, ownedWrite: true });
  }
  override commit() {
    this.settle();
    if (this.key === $TRACK && commitRecord(this.record)) this.bump();
  }
  override promote() {
    if (this.raw !== NO_RAW) {
      const t = this.record.target;
      const desc = Object.getOwnPropertyDescriptor(t, this.key);
      if (this.raw === DELETE) delete t[this.key];
      else if (desc && !desc.writable && !desc.set && desc.configurable) Object.defineProperty(t, this.key, { ...desc, value: this.raw });
      else t[this.key] = this.raw;
      this.raw = NO_RAW;
    }
    super.promote();
  }
}
const NO_RAW: unique symbol = Symbol("no-raw");

/** `target[key]` in the world being read: a staged write where the reader sees it, else the object's. */
function rawGet(target: Raw, key: PropertyKey): any {
  const n = seenStaged(target, key);
  if (!n) return target[key];
  return n.raw === DELETE ? undefined : n.raw;
}
function rawHas(target: Raw, key: PropertyKey): boolean {
  const n = seenStaged(target, key);
  if (!n) return key in target;
  return n.raw !== DELETE;
}
/** The keys in the world being read: the object's, with the staged additions and removals the reader sees. */
function rawKeys(target: Raw): (string | symbol)[] {
  const r = records.get(target);
  const own = Reflect.ownKeys(target);
  if (!r) return own;
  let keys: Set<string | symbol> | null = null;
  for (const [k, n] of r.nodes) {
    if (n.raw === NO_RAW || k === "length" || typeof k === "symbol" && k === $TRACK) continue;
    if (n.current() === n.value) continue;
    keys ??= new Set(own);
    n.raw === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  }
  if (!keys) return own;
  if (Array.isArray(target)) {
    const len = rawGet(target, "length");
    for (const k of keys) if (typeof k === "string" && /^\d+$/.test(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}
/** The key's node when it has a staged write the reader sees. */
function seenStaged(target: Raw, key: PropertyKey): KeyNode | null {
  const n = records.get(target)?.nodes.get(key);
  if (!n || n.raw === NO_RAW) return null;
  return n.current() === n.value ? null : n;
}
/** The newest `target[key]`, staged or not (what a draft builds on). */
function latestGet(target: Raw, key: PropertyKey): any {
  const n = records.get(target)?.nodes.get(key);
  if (!n || n.raw === NO_RAW) return target[key];
  return n.raw === DELETE ? undefined : n.raw;
}
function latestHas(target: Raw, key: PropertyKey): boolean {
  const n = records.get(target)?.nodes.get(key);
  if (!n || n.raw === NO_RAW) return key in target;
  return n.raw !== DELETE;
}
function latestKeys(target: Raw): (string | symbol)[] {
  const r = records.get(target);
  const own = Reflect.ownKeys(target);
  if (!r) return own;
  const keys = new Set(own);
  for (const [k, n] of r.nodes) if (n.raw !== NO_RAW && k !== "length") n.raw === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    const len = latestGet(target, "length");
    for (const k of keys) if (typeof k === "string" && /^\d+$/.test(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}

/**
 * Whether a value is wrapped in a store proxy (as Solid 2): plain objects, arrays, objects with no prototype, and class
 * instances that are plain records (not DOM nodes, dates, maps…); never a frozen one.
 */
export function isWrappable(v: any): v is Raw {
  if (v == null || typeof v !== "object" || Object.isFrozen(v)) return false;
  if (v[$PROXY]) return false;
  const proto = Object.getPrototypeOf(v);
  if (proto === Object.prototype || proto === null || Array.isArray(v)) return true;
  let plain = wrappableProtos.get(proto);
  if (plain === undefined) {
    plain = Object.prototype.toString.call(v) === "[object Object]" && (typeof Node === "undefined" || !(v instanceof Node));
    wrappableProtos.set(proto, plain);
  }
  return plain;
}
const wrappableProtos = new WeakMap<object, boolean>();

/** The backing object under a store proxy (or the value itself). */
export const unwrap = <T>(v: T): T => ((v as any)?.[$TARGET] ?? v);

// ---------------------------------------------------------------- reading

/** Whether `key` shows an optimistic guess. (A probe asking whether it is final: only while it differs from the truth beneath, A24.) */
function overlaid(target: Raw, key: PropertyKey) {
  const o = isAuthoritative() ? undefined : records.get(target)?.overlay?.get(key);
  if (!o) return false;
  if (isVerdictReading() && (o.v === DELETE ? !latestHas(target, key) : latestHas(target, key) && Object.is(o.v, latestGet(target, key)))) return "final";
  return true;
}

const readHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    if (key === $TRACK) return trackAll(target), receiver;
    const desc = Object.getOwnPropertyDescriptor(target, key);
    // Getters run against the proxy, so what they read is tracked.
    if (desc?.get) return desc.get.call(receiver);
    // (Through an overlay the guess is the value: no held write under it is read.)
    if (isTracking()) {
      const o = overlaid(target, key);
      if (o === true) trackNode(node(target, key));
      else if (!o) node(target, key).read();
    }
    const v = viewGet(target, key);
    if (Array.isArray(target) && key === "length") return v;
    // A method of an array (or anything inherited) is not a property of the state.
    if (!desc && typeof v === "function") return v;
    return leaf(target, key, v);
  },
  has(target, key) {
    if (key === $PROXY || key === $TARGET) return true;
    if (isTracking()) {
      const o = overlaid(target, key);
      if (o === true) trackNode(node(target, key));
      else if (!o) node(target, key).read();
    }
    return viewHas(target, key);
  },
  ownKeys(target) {
    if (isTracking()) recordOf(target).keys.read();
    return viewKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    const o = isAuthoritative() ? undefined : records.get(target)?.overlay?.get(key);
    if (o) return o.v === DELETE ? undefined : { value: leaf(target, key, o.v), writable: true, enumerable: true, configurable: true };
    const n = seenStaged(target, key);
    if (n) return n.raw === DELETE ? undefined : { value: leaf(target, key, n.raw), writable: true, enumerable: true, configurable: true };
    const desc = Reflect.getOwnPropertyDescriptor(target, key);
    if (!desc || desc.get || !desc.configurable) return desc;
    return { ...desc, value: leaf(target, key, desc.value) };
  },
  // Read-only from the outside: changes go through the setter. (A frozen property must answer false: the proxy may
  // not claim to have changed what cannot change.)
  set: (t, k, v) => !frozen(t, k, v),
  deleteProperty: (t, k) => !frozen(t, k),
  defineProperty: (t, k) => !frozen(t, k),
};

/** Whether `key` cannot change on `target` (non-configurable, and non-writable or a different value). */
function frozen(target: Raw, key: PropertyKey, value?: unknown): boolean {
  const d = Object.getOwnPropertyDescriptor(target, key);
  if (!d || d.configurable) return false;
  return arguments.length < 3 || (!d.writable && !Object.is(d.value, value));
}

/** What a key shows: its optimistic value if one is installed, else the committed value. */
function viewGet(target: Raw, key: PropertyKey): any {
  const o = isAuthoritative() ? undefined : records.get(target)?.overlay?.get(key);
  if (o) return o.v === DELETE ? undefined : o.v;
  return rawGet(target, key);
}
function viewHas(target: Raw, key: PropertyKey): boolean {
  const o = isAuthoritative() ? undefined : records.get(target)?.overlay?.get(key);
  if (o) return o.v !== DELETE;
  return rawHas(target, key);
}
function viewKeys(target: Raw): (string | symbol)[] {
  const overlay = isAuthoritative() ? null : records.get(target)?.overlay;
  if (!overlay?.size) return rawKeys(target);
  const keys = new Set<string | symbol>(rawKeys(target));
  for (const [k, o] of overlay) o.v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    const len = viewGet(target, "length");
    for (const k of keys) if (typeof k === "string" && /^\d+$/.test(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}

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

/** Stores made with `shallow`: their values are given as they are, not as stores of their own. */
const shallowTargets = new WeakSet<object>();
export const markShallow = (target: object) => void shallowTargets.add(target);

/** A value read from `target[key]`: a store of its own, unless the store is shallow or the property frozen (a proxy
 * must give a frozen property's value as it is). */
function leaf(target: Raw, key: PropertyKey, v: any) {
  if (shallowTargets.has(target)) return v;
  const d = Reflect.getOwnPropertyDescriptor(target, key);
  if (d && !d.configurable && !d.writable) return v;
  return wrap(v);
}
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
  return latestGet(target, key);
}
function pendingHas(target: Raw, key: PropertyKey): boolean {
  const p = records.get(target)?.pending;
  if (p && p.has(key)) return p.get(key) !== DELETE;
  return latestHas(target, key);
}

/** Records with pending writes, committed at the next flush. */
const dirtyRecords = new Set<Record_>();

/** The records written since `before` was taken, committed now (their readers told). */
function promoteWrites(before: Set<Record_>) {
  for (const r of [...dirtyRecords]) if (!before.has(r)) r.keys.commit();
}

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
  let stagedShape = false;
  const lenBefore = Array.isArray(t) ? t.length : 0;
  const told = DEV.hooks.onStoreNodeUpdate;
  for (const [key, v] of p) {
    // A new value of a key it has (not its length), on an object read through a store: staged on its node, as a signal's write (a hold keeps it off).
    const own = Object.getOwnPropertyDescriptor(t, key);
    if (isFlushing() && (proxies.has(t) || derives.has(t)) && (!own || ("value" in own && (own.writable || own.configurable)))) {
      const had = latestHas(t, key);
      const prev = latestGet(t, key);
      if (v === DELETE ? !had : had && Object.is(prev, v) && key !== "length") continue;
      if (key === "length" && Object.is(prev, v)) continue;
      if (told) told(wrap(t), key, v === DELETE ? undefined : v, prev);
      const n = node(t, key);
      n.raw = v;
      // (An action's write: its transaction's, as a signal's is.)
      if (r.keys.writtenIn) n.writtenIn = r.keys.writtenIn;
      n.stage(++n.seq);
      if (v === DELETE || !had || key === "length") stagedShape = true;
      continue;
    }
    if (told) {
      const prev = latestGet(t, key);
      if (v === DELETE ? key in t : !Object.is(prev, v)) told(wrap(t), key, v === DELETE ? undefined : v, prev);
    }
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
  // (Staged shape changes: what enumerates the object follows them as a staged write too.)
  if (stagedShape) r.keys.stage(++r.keys.seq);
  return shape;
}

const draftHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    const v = pendingValue(target, key);
    if (typeof v === "function" && !Object.prototype.hasOwnProperty.call(target, key)) return v;
    // (Shallow, or a frozen property: as it is.)
    if (shallowTargets.has(target)) return v;
    const d = Reflect.getOwnPropertyDescriptor(target, key);
    if (d && !d.configurable && !d.writable) return v;
    return draftOf(v);
  },
  has: (target, key) => pendingHas(target, key),
  ownKeys(target) {
    const keys = new Set<string | symbol>(latestKeys(target));
    const p = records.get(target)?.pending;
    if (p) for (const [k, v] of p) v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
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
    else {
      // An accessor: defined now, its readers (and the key set's, for a new key) told.
      const had = Object.prototype.hasOwnProperty.call(target, key);
      Object.defineProperty(target, key, desc);
      const r = records.get(target);
      r?.nodes.get(key)?.bump();
      if (!had) r?.keys.bump();
    }
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

const ASYNC_STORE_SETTER_MESSAGE =
  "[ASYNC_STORE_SETTER] Store setter callback returned a Promise. A store setter is a synchronous transaction: " +
  "the draft closes when the callback returns, so writes after an `await` are lost. " +
  "Move the await into an action() and call the setter from there.";
function asyncStoreSetter(): never {
  emitDiagnostic({ code: "ASYNC_STORE_SETTER", kind: "write", severity: "error", message: ASYNC_STORE_SETTER_MESSAGE, data: { operation: "setStore" } });
  throw new Error(ASYNC_STORE_SETTER_MESSAGE);
}

/** A store and its setter; given a function, a store derived from what the function reads (RFC 04). */
export function createStore<T extends object>(init: T | ((draft: T) => T | void | Promise<T | void>), seed?: T, options?: StoreOptions): [T, StoreSetter<T>] {
  if (typeof init === "function") return derivedStore(init as any, seed ?? ({} as T), options, true) as [T, StoreSetter<T>];
  const target = unwrap(init) as Raw;
  if ((seed as any)?.shallow ?? options?.shallow) markShallow(target);
  const set: StoreSetter<T> = (fn) => {
    guardStoreWrite();
    const d = draftOf(target);
    const before = (fn as any)?.[RECONCILE] ? new Set(dirtyRecords) : null;
    if (typeof fn === "function") {
      const r = (fn as (d: T) => T | void)(d as T);
      if (r != null && (typeof r === "object" || typeof r === "function") && typeof (r as any).then === "function") asyncStoreSetter();
      if (r !== undefined && r !== d) replaceInto(target, r);
    } else replaceInto(target, { ...untrack(() => ({ ...d })), ...(fn as object) });
    // A reconcile given to the setter: its diff visible at once.
    if (before) promoteWrites(before);
  };
  const proxy = wrap(target) as T;
  registerGraph(proxy, getOwner());
  return [proxy, set];
}

/** A read-only store derived from what `fn` reads: it changes its draft, or returns a value reconciled into it. */
export function createProjection<T extends object>(fn: (draft: T) => T | void | Promise<T | void>, seed: T = {} as T, options?: { key?: string | ((v: any) => any) }): T {
  return derivedStore(fn, seed, options, false)[0];
}

type StoreOptions = { key?: string | ((v: any) => any); seedLoadingValue?: boolean; shallow?: boolean };

/** A derived store's derive, by its root. */
const derives = new WeakMap<object, () => unknown>();

function derivedStore<T extends object>(fn: (draft: T) => any, seed: T, options: StoreOptions | undefined, writable: boolean): [T, StoreSetter<T>] {
  const target = unwrap(seed) as Raw;
  if (options?.shallow) markShallow(target);
  const key = options?.key ?? "id";
  // On a server, a projection's trace (what crosses a frame's border): told of each change, and of its source's end.
  const traced = !writable && isServerRender();
  let streaming = false;
  let ended = false;
  let waiters: (() => void)[] = [];
  const changed = () => {
    for (const w of waiters.splice(0)) w();
  };
  const endsWith = (it: AsyncIterable<any>): AsyncIterable<any> => ({
    [Symbol.asyncIterator]() {
      const inner = it[Symbol.asyncIterator]();
      return {
        next: (...a: any[]) =>
          Promise.resolve((inner.next as any)(...a)).then((res: IteratorResult<any>) => {
            if (res.done) (ended = true), queueMicrotask(changed);
            return res;
          }),
        return: (v?: any) => ((ended = true), queueMicrotask(changed), Promise.resolve(inner.return ? inner.return(v) : { done: true, value: v })),
      } as AsyncIterator<any>;
    },
  });
  // The derive: run as a memo, its draft writes staged like a setter's (owned writes are allowed here).
  // An async derive makes the memo async: the store is not ready until its first derive lands.
  let runs = 0;
  const m = createMemo(() => {
    const d = draftOf(target);
    const before = new Set(dirtyRecords);
    let r = fn(d as T);
    ++runs;
    if (traced && r && typeof (r as any)[Symbol.asyncIterator] === "function") (streaming = true), (r = endsWith(r as any) as any);
    // An async derive's answers are reconciled as they land (onTake, below): the memo flies on its promise or generator.
    if (r && (typeof (r as any).then === "function" || typeof (r as any)[Symbol.asyncIterator] === "function")) return r;
    if (r !== undefined) reconcileInto(target, unwrap(r) as Raw, key);
    // What the derive wrote is visible as it returns (A28 (4): a computation never runs on against its own writes).
    promoteWrites(before);
    // The same answer each run: readers are told by the keys that changed, not by the derive having run.
    return 0;
  }, { writes: true, ...(options?.seedLoadingValue ? { loadingValue: 0 } : {}) } as any);
  derives.set(target, m);
  onTake(m, (v) => {
    // (On a server, what its source wrote before this answer is the state it answers with.)
    if (traced) promoteWrites(new Set()), queueMicrotask(changed);
    if (v === undefined || typeof v === "number") return;
    const before = new Set(dirtyRecords);
    reconcileInto(target, unwrap(v) as Raw, key);
    promoteWrites(before);
  });
  const proxy = new Proxy(target, {
    ...readHandler,
    get(t, k, receiver) {
      // Every read brings the derive up to date first (a key with an optimistic value shows it even before the
      // derive's first answer).
      if (k === $TARGET || k === $PROXY) return readHandler.get!(t, k, receiver);
      if (records.get(t)?.overlay?.has(k)) {
        try {
          m();
        } catch (e) {
          if (!(e instanceof NotReadyError)) throw e;
        }
      } else m();
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
  if (traced)
    registerProjectionTrace(
      proxy,
      target,
      () => void m(),
      () => new Promise<void>((ok) => waiters.push(ok)),
      () => !streaming || ended,
    );
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
  const apply = (draft: any) => {
    if (draft == null) return;
    const target = unwrap(draft) as Raw;
    const next = unwrap(value) as any;
    // The same record, or none: a different key at the top is not a diff of this one.
    if (key != null && isWrappable(target) && isWrappable(next) && !Array.isArray(target) && !Array.isArray(next) && keyOf(key, target) !== keyOf(key, next))
      throw new Error("reconcile: the value's key differs from the target's");
    const before = new Set(dirtyRecords);
    reconcileInto(target, next, key);
    // A reconcile's diff is visible as it returns.
    promoteWrites(before);
    return draft;
  };
  (apply as any)[RECONCILE] = true;
  return apply;
}
/** Marks a reconcile function: given to a setter, its diff is visible as the setter returns. */
const RECONCILE = Symbol("reconcile");

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
      if (match && isWrappable(match) && isWrappable(n) && match !== n && Array.isArray(match) === Array.isArray(n)) {
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
  // Nothing optimistic shown: the committed objects themselves (unchanged data keeps its identity).
  if (!liveOverlays) return unwrap(v);
  return untrack(() => plain(unwrap(v), new Map())) as T;
}

function plain(v: any, seen: Map<any, any>): any {
  if (!isWrappable(v)) return v;
  if (seen.has(v)) return seen.get(v);
  const out: any = Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v));
  seen.set(v, out);
  for (const k of viewKeys(v)) {
    const desc = Object.getOwnPropertyDescriptor(v, k);
    if (desc?.get) Object.defineProperty(out, k, desc);
    else out[k] = plain(unwrap(viewGet(v, k)), seen);
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


// ---------------------------------------------------------------- optimistic stores

/** What an optimistic draft reads: this tick's guesses, then the view (the overlay over the truth). */
function guessGet(target: Raw, key: PropertyKey): any {
  const g = records.get(target)?.guessing;
  if (g && g.has(key)) {
    const v = g.get(key);
    return v === DELETE ? undefined : v;
  }
  return viewGet(target, key);
}
function guessHas(target: Raw, key: PropertyKey): boolean {
  const g = records.get(target)?.guessing;
  if (g && g.has(key)) return g.get(key) !== DELETE;
  return viewHas(target, key);
}

/** A guess for the next flush: installed then over the truth, for as long as its action's transaction lives. */
function guessStage(target: Raw, key: PropertyKey, v: any) {
  const r = recordOf(target);
  const first = !r.guessing;
  (r.guessing ??= new Map()).set(key, v);
  if (first) queueGuess((tx) => install(r, tx), guessSource);
}

/** The derive of the optimistic store whose setter runs (a guess outside an action rides over its refetch). */
let guessSource: (() => unknown) | undefined;

/** Records with an optimistic overlay shown. */
let liveOverlays = 0;

/** A record's guesses installed: each shown over the truth until its transaction ends (its readers told). */
function install(r: Record_, tx: Transaction | null) {
  const g = r.guessing;
  r.guessing = null;
  // A guess with no transaction to be optimistic over is void (lane contract 2): nobody sees it.
  if (!g || !tx) return;
  if (!r.overlay?.size) liveOverlays++;
  const t = r.target;
  const lenBefore = Array.isArray(t) ? viewGet(t, "length") : 0;
  let shape = false;
  const mine: PropertyKey[] = [];
  for (const [key, v] of g) {
    const before = viewGet(t, key);
    const had = viewHas(t, key);
    (r.overlay ??= new Map()).set(key, { v, tx });
    mine.push(key);
    if (v === DELETE ? had : !had || !Object.is(before, v)) {
      if (v === DELETE || !had) shape = true;
      r.nodes.get(key)?.bump();
    }
  }
  if (Array.isArray(t) && viewGet(t, "length") !== lenBefore) shape = true;
  if (shape) r.keys.bump();
  endWith(tx, () => revert(r, mine, tx));
}

/** A transaction's guesses taken off again: the truth shown (readers told where the view changes). */
function revert(r: Record_, keys: PropertyKey[], tx: Transaction | null) {
  const o = r.overlay;
  if (!o) return;
  const t = r.target;
  const lenBefore = Array.isArray(t) ? viewGet(t, "length") : 0;
  let shape = false;
  for (const key of keys) {
    const e = o.get(key);
    if (!e || e.tx !== tx) continue;
    const before = viewGet(t, key);
    const had = viewHas(t, key);
    o.delete(key);
    const now = viewGet(t, key);
    if (had !== viewHas(t, key)) shape = true;
    if (!Object.is(before, now) || had !== viewHas(t, key)) r.nodes.get(key)?.bump();
  }
  if (!o.size) (r.overlay = null), liveOverlays--;
  if (Array.isArray(t) && viewGet(t, "length") !== lenBefore) shape = true;
  if (shape) r.keys.bump();
}

const guessHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    const v = guessGet(target, key);
    if (typeof v === "function" && !Object.prototype.hasOwnProperty.call(target, key)) return v;
    return guessDraftOf(v);
  },
  has: (target, key) => guessHas(target, key),
  ownKeys(target) {
    const keys = new Set<string | symbol>(viewKeys(target));
    const g = records.get(target)?.guessing;
    if (g) for (const [k, v] of g) v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
    if (Array.isArray(target)) {
      const len = guessGet(target, "length");
      for (const k of keys) if (typeof k === "string" && /^\d+$/.test(k) && +k >= len) keys.delete(k);
    }
    return [...keys];
  },
  getOwnPropertyDescriptor(target, key) {
    if (!guessHas(target, key)) return undefined;
    return { value: guessGet(target, key), writable: true, enumerable: true, configurable: true };
  },
  set(target, key, value) {
    const raw = unwrap(value);
    if (Array.isArray(target) && key === "length") {
      const before = guessGet(target, "length");
      for (let i = raw; i < before; i++) guessStage(target, String(i), DELETE);
      guessStage(target, "length", raw);
      return true;
    }
    guessStage(target, key, raw);
    if (Array.isArray(target) && typeof key === "string" && /^\d+$/.test(key) && +key >= guessGet(target, "length")) guessStage(target, "length", +key + 1);
    return true;
  },
  deleteProperty(target, key) {
    if (guessHas(target, key)) guessStage(target, key, DELETE);
    return true;
  },
};

const guessDrafts = new WeakMap<object, any>();
function guessDraftOf<T>(v: T): T {
  if (!isWrappable(v)) return v;
  let d = guessDrafts.get(v as object);
  if (!d) guessDrafts.set(v as object, (d = new Proxy(v as Raw, guessHandler)));
  return d;
}

/**
 * A store whose setter's writes are optimistic: shown from the next flush over the truth (derived, when given a
 * function), until the action that made them ends (or, outside an action, the flush does).
 */
export function createOptimisticStore<T extends object>(init: T | ((draft: T) => T | void | Promise<T | void>), seed?: T, options?: { key?: string | ((v: any) => any) }): [T, StoreSetter<T>] {
  const [store] = typeof init === "function" ? derivedStore(init as any, seed ?? ({} as T), options, true) : createStore(init as T, undefined, options);
  const target = unwrap(store) as Raw;
  const source = derives.get(target);
  const set: StoreSetter<T> = (fn) => {
    const was = guessSource;
    guessSource = source;
    try {
      write(fn);
    } finally {
      guessSource = was;
    }
  };
  const write: StoreSetter<T> = (fn) => {
    const d = guessDraftOf(target);
    if (typeof fn === "function") {
      const r = (fn as (d: T) => T | void)(d as T);
      if (r !== undefined && r !== d) {
        const raw = unwrap(r) as Raw;
        for (const k of Reflect.ownKeys(d)) if (!(k in raw)) delete (d as any)[k];
        for (const k of Reflect.ownKeys(raw)) (d as any)[k] = raw[k as any];
      }
    } else for (const k of Reflect.ownKeys(fn as object)) (d as any)[k] = (fn as any)[k];
  };
  return [store, set];
}

/** A path step over an array: indices, a filter, or a range. */
type PathPart = PropertyKey | PropertyKey[] | ((v: any, i: number) => boolean) | { from?: number; to?: number; by?: number };
const UNSAFE = new Set<PropertyKey>(["__proto__", "constructor", "prototype"]);
const STORE_PATH_DELETE: unique symbol = Symbol("storePath.DELETE");

/**
 * A setter for a store, made from a path and a value: `setStore(storePath("todos", 0, "done", true))`. Steps may be keys,
 * lists of keys, filters `(item, index) => boolean` or ranges `{ from, to, by }`. The value may be a function of the old
 * one, an object merged into the one there, or `storePath.DELETE`.
 */
export function storePath(...args: any[]): (draft: any) => void {
  return (draft) => walk(draft, args, 0);
}
storePath.DELETE = STORE_PATH_DELETE;

function walk(at: any, args: any[], i: number) {
  if (i === args.length - 1) return assign(at, args[i]);
  const part = args[i] as PathPart;
  const each = (k: PropertyKey) => {
    if (UNSAFE.has(k)) return;
    if (i === args.length - 2) return setKey(at, k, args[i + 1]);
    const next = at[k];
    if (next && typeof next === "object") walk(next, args, i + 1);
  };
  if (Array.isArray(part)) for (const k of part) each(k);
  else if (typeof part === "function") {
    const n = at.length;
    for (let j = 0; j < n; j++) if ((part as (v: any, i: number) => boolean)(at[j], j)) each(j);
  } else if (part && typeof part === "object") {
    const { from = 0, to = at.length - 1, by = 1 } = part as { from?: number; to?: number; by?: number };
    for (let j = from; j <= to; j += by) each(j);
  } else each(part as PropertyKey);
}

function setKey(at: any, k: PropertyKey, value: any) {
  const prev = at[k];
  const v = typeof value === "function" ? value(prev) : value;
  if (v === STORE_PATH_DELETE) return void delete at[k];
  if (Object.is(v, prev)) return;
  if (isWrappable(v) && !Array.isArray(v) && isWrappable(prev) && !Array.isArray(prev)) return assign(prev, v);
  const d = isWrappable(v) ? Object.getOwnPropertyDescriptors(v) : null;
  if (d && Object.values(d).some((x) => x.get)) at[k] = Object.defineProperties({}, d);
  else at[k] = v;
}

/** An object merged into `at`: its own safe keys, getters kept as getters. */
function assign(at: any, value: any) {
  if (!isWrappable(value) || Array.isArray(value)) return;
  for (const k of Reflect.ownKeys(value)) {
    if (UNSAFE.has(k)) continue;
    const d = Object.getOwnPropertyDescriptor(value, k)!;
    if (d.get || d.set) Object.defineProperty(at, k, { ...d, configurable: true, enumerable: true });
    else at[k] = d.value;
  }
}
