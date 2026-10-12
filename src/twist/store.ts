// Twist's stores: objects and arrays read property by property (each a node of its own), changed through a draft.
// Writes batch as signals' do: a read sees the committed value until the flush. Written from Solid 2's design (RFC
// 04) and its tests, not its code.
declare const process: { env: Record<string, string | undefined> };
import { emitDiagnostic } from "./diagnostics.ts";
import { attrHooks } from "./attribution/attribution-hooks.ts";
import { Signal, DEV, isFlushing, trackNode, isVerdictReading, isAuthoritative, registerGraph, getOwner, createMemo, createEffect, untrack, isTracking, guardStoreWrite, refreshTarget, queueGuess, endWith, isTracing, checkStrictRead, postAwaitRead, watchingTails, NotReadyError, isServerRender, flightTransaction, setStoreAncestors, readersOf, setPatchApply, firstYieldDropped, isActing, rederiveHeld, heldPassTx, keepMemo, derivesIn, inPassNow, noteGuessRead, takingSnapshots, servedSnapshot, type Transaction, useStoreMarks } from "./signals.ts";
import { applyPatches, diffPatches, registerProjectionTrace } from "./container-trace.ts";
import { createStream } from "../serial.js";

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
  /** Keys defined through a draft as not enumerable, until their write lands. */
  hidden: Set<PropertyKey> | null = null;
  /** What it holds: the given object until the first write, then a private copy (the given one never changes). */
  own: Raw;
  /** Whether `own` is its private copy yet. */
  copied = false;
  /** The action a landing under its optimism was folded into (#3164): in that action's world its guesses are gone. */
  folded: Transaction | null = null;
  /** Values its keys had before a write while hydration keeps snapshots (what readers in the scope still see). */
  snaps: Map<PropertyKey, any> | null = null;
  constructor(public target: Raw) {
    this.keys = new KeyNode(this, $TRACK);
    this.own = target;
  }
}

const records = new WeakMap<object, Record_>();
/** An array index, as the language counts one ("1", not "01" or "1.0"). */
const isIndex = (k: PropertyKey): k is string => typeof k === "string" && String(+k >>> 0) === k && +k !== 4294967295;

const recordOf = (target: Raw) => {
  let r = records.get(target);
  if (!r) records.set(target, (r = new Record_(target))), useStoreMarks(storeMarks);
  return r;
};
/** What a store object holds now. */
const own = (target: Raw): Raw => records.get(target)?.own ?? target;
/** Its private copy, made at the first write (copy on write: the object the store was given stays as it was). */
function mine(target: Raw): Raw {
  const r = recordOf(target);
  if (r.copied) return r.own;
  const from = r.own;
  const descs = Object.getOwnPropertyDescriptors(from) as Record<PropertyKey, PropertyDescriptor>;
  // (Behind a shell, no proxy invariant holds it: every slot writable, as a store's are.)
  if (from !== target) for (const d of Object.values(descs)) if ("value" in d) (d.writable = true), (d.configurable = true);
  let copy: Raw;
  if (Array.isArray(from)) {
    delete descs.length;
    copy = Object.defineProperties(new Array(from.length), descs);
  } else copy = Object.create(Object.getPrototypeOf(from), descs);
  r.copied = true;
  return (r.own = copy);
}

/** A derived store's objects: each given object's shell there, by the object. */
class Family {
  map = new WeakMap<object, Raw>();
  /** `v`'s shell in this family (another store's object, held live, as it is). */
  shell(v: any, root = false): any {
    if (!isWrappable(v)) return v;
    const fam = families.get(v);
    if (fam === this) return v;
    let t = this.map.get(v);
    if (t) return t;
    if (!root && (fam || proxies.has(v))) return v;
    t = shellOf(v);
    families.set(t!, this);
    this.map.set(v, t!);
    return t;
  }
}
/** Whether `v` has a property it cannot reconfigure (an array's length aside). */
function hasLockedKey(v: object): boolean {
  for (const k of Reflect.ownKeys(v)) {
    if (k === "length" && Array.isArray(v)) continue;
    if (Object.getOwnPropertyDescriptor(v, k)?.configurable === false) return true;
  }
  return false;
}
/** An empty object standing in for `v` as a proxy's target, holding `v` until the first write. */
function shellOf(v: Raw): Raw {
  const t = Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v));
  recordOf(t).own = v;
  return t;
}
const families = new WeakMap<object, Family>();
/** A value read from `target`, as its store holds it: in a derived store, its shell there. */
const child = (target: Raw, v: any) => (v && typeof v === "object" ? (families.get(target)?.shell(v) ?? v) : v);
/** Whether two values of `target`'s are the same (an object and its shell there are). */
const same = (target: Raw, a: any, b: any) => Object.is(a, b) || (a && b && typeof a === "object" && typeof b === "object" && families.has(target) && child(target, a) === child(target, b));

/**
 * What affects() marks on a store: a slot's node, or (no key) the record's own and every key's node under it, nested
 * records included, as they stand now (later records are not covered). Null for anything not a store.
 */
/** Keyed affects() marks, by object and key. */
const keyMarks = new WeakMap<Raw, Map<PropertyKey, { affected: number }>>();
function markCell(raw: Raw, key: PropertyKey) {
  let m = keyMarks.get(raw);
  if (!m) keyMarks.set(raw, (m = new Map()));
  let c = m.get(key);
  if (!c) m.set(key, (c = { affected: 0 }));
  return c;
}
/** A derived store's object → the source store's it takes its values from (and back): marks there show through it. */
const derivedFrom = new WeakMap<Raw, Raw>();
const derivedTo = new WeakMap<Raw, Set<Raw>>();
function linkFamily(derived: Raw, source: Raw) {
  if (derived === source || derivedFrom.get(derived) === source) return;
  derivedFrom.set(derived, source);
  let to = derivedTo.get(source);
  if (!to) derivedTo.set(source, (to = new Set()));
  to.add(derived);
}
/** Keyed marks on `key` of `raw` or of what it derives from. */
function keyMarked(raw: Raw, key: PropertyKey): number {
  let n = 0;
  for (let r: Raw | undefined = raw; r; r = derivedFrom.get(r)) n += keyMarks.get(r)?.get(key)?.affected ?? 0;
  return n;
}

function storeMarks(target: unknown, key: PropertyKey | undefined): KeyNode[] | null {
  const t = (target as any)?.[$TARGET] as Raw | undefined;
  if (t === undefined) return null;
  // (Keyed: a mark on the key itself, so a node made later, here or in a derived store, has it too.)
  if (key !== undefined) return [markCell(t, key) as any];
  const out: KeyNode[] = [];
  const seen = new Set<object>();
  const walk = (raw: Raw) => {
    if (seen.has(raw)) return;
    seen.add(raw);
    out.push(recordOf(raw).keys);
    // (Keys as the record shows them now: what was written this tick, optimistic writes included.)
    const r = records.get(raw)!;
    const keys = new Set<PropertyKey>(Reflect.ownKeys(r.own));
    for (const k of r.pending?.keys() ?? []) keys.add(k);
    for (const k of r.overlay?.keys() ?? []) keys.add(k);
    for (const k of r.guessing?.keys() ?? []) keys.add(k);
    for (const k of keys) {
      out.push(node(raw, k));
      // (An optimistic write parked for the flush is what the record will show: walked into too.)
      const v = child(raw, unwrap(r.guessing?.has(k) ? r.guessing.get(k) : viewGet(raw, k)));
      if (v && typeof v === "object") walk(v as Raw);
    }
    // Stores derived from this one show what it shows: theirs marked too.
    for (const d of derivedTo.get(raw) ?? []) walk(d);
  };
  walk(t);
  return out;
}

/** A key's node: read tracked, bumped when a flushed write changes the key. The record's key-set node also carries
 * the record's writes into the flush, and commits them there. */
const KEY_NODE = { equals: false as const, ownedWrite: true };
class KeyNode extends Signal<number> {
  /** A flushed write's value, staged like a signal's (held by a transaction, or put on the object when promoted). */
  declare raw: any;
  declare seq: number;
  declare record: Record_;
  declare key: PropertyKey;
  constructor(record: Record_, key: PropertyKey) {
    super(0, KEY_NODE);
    this.raw = NO_RAW;
    this.seq = 0;
    this.record = record;
    this.key = key;
    // (Development, an attribution engine installed: named by its path — the store's name, then the key.)
    if (process.env.NODE_ENV !== "production" && attrHooks !== null && key !== $TRACK) this.name = `${storeNames.get(storeRoot(record.target)) ?? "store"}.${String(key)}`;
  }
  /** affects() marks on it: its own (a keyless mark's snapshot), and keyed ones on its key here or upstream. */
  declare private ownAffected: number;
  get affected() {
    return this.ownAffected + keyMarked(this.record.target, this.key);
  }
  set affected(n: number) {
    this.ownAffected = n;
  }
  override commit() {
    this.settle();
    if (this.key === $TRACK && commitRecord(this.record)) this.bump();
  }
  override promote() {
    if (this.raw !== NO_RAW) {
      const t = mine(this.record.target);
      const desc = Object.getOwnPropertyDescriptor(t, this.key);
      if (this.raw === DELETE) delete t[this.key];
      else if (desc && !desc.writable && !desc.set && desc.configurable) Object.defineProperty(t, this.key, { ...desc, value: this.raw });
      else put(this.record, t, this.key, this.raw);
      this.raw = NO_RAW;
    }
    super.promote();
  }
}
(KeyNode.prototype as any).ownAffected = 0;
const NO_RAW: unique symbol = Symbol("no-raw");
/** `o[key] = v`, as not enumerable when the draft defined it so. */
function put(r: Record_, o: Raw, key: PropertyKey, v: any) {
  if (r.hidden?.delete(key)) Object.defineProperty(o, key, { value: v, writable: true, enumerable: false, configurable: true });
  else o[key] = v;
}

/** `target[key]` in the world being read: a staged write where the reader sees it, else the object's. */
function rawGet(target: Raw, key: PropertyKey): any {
  const r = records.get(target);
  if (!r) return target[key];
  const n = r.nodes.get(key);
  if (!n || n.raw === NO_RAW || n.current() === n.value) return r.own[key];
  return n.raw === DELETE ? undefined : n.raw;
}
function rawHas(target: Raw, key: PropertyKey): boolean {
  const r = records.get(target);
  if (!r) return key in target;
  const n = r.nodes.get(key);
  if (!n || n.raw === NO_RAW || n.current() === n.value) return key in r.own;
  return n.raw !== DELETE;
}
/** The keys in the world being read: the object's, with the staged additions and removals the reader sees. */
function rawKeys(target: Raw): (string | symbol)[] {
  const r = records.get(target);
  if (!r) return Reflect.ownKeys(target);
  const own = Reflect.ownKeys(r.own);
  let keys: Set<string | symbol> | null = null;
  for (const [k, n] of r.nodes) {
    if (n.raw === NO_RAW || k === "length" || typeof k === "symbol" && k === $TRACK) continue;
    if (n.current() === n.value) continue;
    keys ??= new Set(own);
    n.raw === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  }
  // (An array whose length is staged shorter drops the indices past it.)
  if (!keys && !(Array.isArray(target) && seenStaged(target, "length"))) return own;
  keys ??= new Set(own);
  if (Array.isArray(target)) {
    const len = rawGet(target, "length");
    for (const k of keys) if (isIndex(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}
/** Whether `target[key]` has a write not committed yet. */
function written(target: Raw, key: PropertyKey) {
  return !!records.get(target)?.pending?.has(key) || !!seenStaged(target, key);
}
/** The keys a snapshot shows: the world being read, with this tick's writes (not flushed yet) over it. */
function snapshotKeys(target: Raw): (string | symbol)[] {
  const p = records.get(target)?.pending;
  if (!p) return rawKeys(target);
  const keys = new Set<string | symbol>(rawKeys(target));
  for (const [k, v] of p) if (k !== "length") v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    const len = snapshotGet(target, "length");
    for (const k of keys) if (isIndex(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}
/** `target[key]` as a snapshot shows it: this tick's write, else the world being read. */
function snapshotGet(target: Raw, key: PropertyKey): any {
  const p = records.get(target)?.pending;
  if (p?.has(key)) {
    const v = p.get(key);
    return v === DELETE ? undefined : v;
  }
  return rawGet(target, key);
}
/** The key's node when it has a staged write the reader sees. */
function seenStaged(target: Raw, key: PropertyKey): KeyNode | null {
  const n = records.get(target)?.nodes.get(key);
  if (!n || n.raw === NO_RAW) return null;
  return n.current() === n.value ? null : n;
}
/** The newest `target[key]`, staged or not (what a draft builds on). */
function latestGet(target: Raw, key: PropertyKey): any {
  const r = records.get(target);
  const n = r?.nodes.get(key);
  if (!n || n.raw === NO_RAW) return (r ? r.own : target)[key];
  return n.raw === DELETE ? undefined : n.raw;
}
function latestHas(target: Raw, key: PropertyKey): boolean {
  const r = records.get(target);
  const n = r?.nodes.get(key);
  if (!n || n.raw === NO_RAW) return key in (r ? r.own : target);
  return n.raw !== DELETE;
}
function latestKeys(target: Raw): (string | symbol)[] {
  const r = records.get(target);
  if (!r) return Reflect.ownKeys(target);
  const keys = new Set(Reflect.ownKeys(r.own));
  for (const [k, n] of r.nodes) if (n.raw !== NO_RAW && k !== "length") n.raw === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    const len = latestGet(target, "length");
    for (const k of keys) if (isIndex(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}

/** Values never made stores: served as they are, tracked by reference where they sit. */
const raws = new WeakSet<object>();
export function markRaw<T extends object>(v: T): T {
  raws.add(v);
  return v;
}
/** A record a shallow store takes in: raw from now on (one value is never both a store and raw). */
function markRawOne(v: any) {
  if (!isWrappable(v)) return;
  // (Another store's object, as its proxy: passed through as that store's.)
  if (unwrap(v) !== v) return;
  if (records.has(v) || proxies.has(v))
    throw new Error("shallow store: an ingested record is already tracked as a deep store — one value cannot present both wrapped and raw");
  raws.add(v);
}
function markRawIngest(container: any) {
  if (Array.isArray(container)) for (const v of container) markRawOne(v);
  else for (const k in container) markRawOne(container[k]);
}

/**
 * Whether a value is wrapped in a store proxy (as Solid 2): plain objects, arrays, objects with no prototype, and class
 * instances that are plain records (not DOM nodes, dates, maps…); never a frozen one.
 */

export function isWrappable(v: any): v is Raw {
  if (v == null || typeof v !== "object" || Object.isFrozen(v)) return false;
  if (raws.has(v)) return false;
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
  const r = isAuthoritative() ? undefined : records.get(target);
  const o = r?.overlay?.get(key);
  if (!o) return false;
  // (A truth folded into the guess's own action under it: read as held — in that world the guess is gone.)
  if (inGuessWorld(r!, actionOf(o.tx))) return false;
  if (isVerdictReading() && (o.v === DELETE ? !latestHas(target, key) : latestHas(target, key) && Object.is(o.v, latestGet(target, key)))) return "final";
  return true;
}

/** A getter `key` has on `proto` or further up (none on Object's or Array's own), found once per prototype. */
function getterOf(proto: object | null, key: PropertyKey): (() => unknown) | undefined {
  if (!proto || proto === Object.prototype || proto === Array.prototype) return undefined;
  let byKey = getters.get(proto);
  if (!byKey) getters.set(proto, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key);
  let get: (() => unknown) | undefined;
  for (let p: object | null = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) {
      get = d.get;
      break;
    }
  }
  byKey.set(key, get);
  return get;
}
const getters = new WeakMap<object, Map<PropertyKey, (() => unknown) | undefined>>();

const readHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    if (key === $TRACK) return trackAll(target), receiver;
    // (A thenable probe — Promise.resolve(store), an await — asks for \`then\`: none, no read of the state.)
    if (key === "then" && !viewHas(target, key)) return undefined;
    const desc = Object.getOwnPropertyDescriptor(own(target), key);
    // Getters run against the proxy, so what they read is tracked (a class's, on its prototype, too).
    if (desc?.get) return desc.get.call(receiver);
    const inherited = desc ? undefined : getterOf(Object.getPrototypeOf(target), key);
    if (inherited) return inherited.call(receiver);
    // (Through an overlay the guess is the value: no held write under it is read.)
    if (isTracking()) {
      const o = overlaid(target, key);
      if (o === true) trackNode(node(target, key));
      else if (!o) node(target, key).read();
    } else checkStrictRead({ name: typeof key === "string" ? key : undefined, store: true });
    let v = viewGet(target, key);
    // (Read untracked after an await in an async compute: said once per store, naming the first field read so — a
    // method it inherits is no state.)
    if (process.env.NODE_ENV !== "production" && watchingTails() && !isTracking() && !(!desc && typeof v === "function")) postAwaitRead(records.get(target)?.nodes.get(key), storeRoot(target), undefined, typeof key === "string" ? key : undefined, false);
    const snaps = records.get(target)?.snaps;
    if (snaps?.has(key)) {
      const s = servedSnapshot(v, snaps.get(key));
      if (s) v = s[0];
    }
    if (Array.isArray(target) && key === "length") return v;
    // A method of an array (or anything inherited) is not a property of the state.
    if (!desc && typeof v === "function") return v;
    return leaf(target, key, v);
  },
  has(target, key) {
    if (key === $PROXY || key === $TARGET) return true;
    if (isTracking()) {
      const o = overlaid(target, key);
      // (Whether it has the key: its key set, which changes only when a key comes or goes, not with a value.)
      if (o === true) trackNode(recordOf(target).keys);
      else if (!o) recordOf(target).keys.read();
    }
    return viewHas(target, key);
  },
  ownKeys(target) {
    if (isTracking()) recordOf(target).keys.read();
    return viewKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    // (Whether it has the key, as `in` asks it: its key set.)
    if (isTracking()) {
      const g = overlaid(target, key);
      if (g === true) trackNode(recordOf(target).keys);
      else if (!g) recordOf(target).keys.read();
    }
    const o = isAuthoritative() ? undefined : records.get(target)?.overlay?.get(key);
    if (o) return o.v === DELETE ? undefined : shownDesc(target, key, leaf(target, key, o.v));
    const n = seenStaged(target, key);
    if (n) return n.raw === DELETE ? undefined : shownDesc(target, key, leaf(target, key, n.raw));
    const desc = Reflect.getOwnPropertyDescriptor(own(target), key);
    if (!desc) return desc;
    if (desc.get || desc.set) return own(target) === target ? desc : { ...desc, configurable: Reflect.getOwnPropertyDescriptor(target, key)?.configurable ?? true };
    if (!desc.configurable) return own(target) === target ? desc : shownDesc(target, key, desc.value);
    return { ...desc, value: leaf(target, key, desc.value) };
  },
  // Read-only from the outside: changes go through the setter. (A frozen property must answer false: the proxy may
  // not claim to have changed what cannot change.)
  set: (t, k, v) => !frozen(t, k, v),
  deleteProperty: (t, k) => !frozen(t, k),
  defineProperty: (t, k) => !frozen(t, k),
};

/** A shown value's descriptor, as a proxy may report it: one the target declares non-configurable (an array's length) stays so. */
function shownDesc(target: Raw, key: PropertyKey, value: unknown): PropertyDescriptor {
  const given = Reflect.getOwnPropertyDescriptor(target, key);
  const d = given && !given.configurable ? given : Reflect.getOwnPropertyDescriptor(own(target), key);
  return { value, writable: true, enumerable: d ? d.enumerable : true, configurable: given ? given.configurable : true };
}

/** Whether `key` cannot change on `target` (non-configurable, and non-writable or a different value). */
function frozen(target: Raw, key: PropertyKey, value?: unknown): boolean {
  const d = Object.getOwnPropertyDescriptor(target, key);
  if (!d || d.configurable) return false;
  return arguments.length < 3 || (!d.writable && !Object.is(d.value, value));
}

/** What a key shows: its optimistic value if one is installed, else the committed value. */
/** An optimistic value the reader sees: not to one asking the truth, nor in the world its action commits to (where the
 * edit is gone). */
function shownGuess(target: Raw, key: PropertyKey) {
  if (isAuthoritative()) return undefined;
  const r = records.get(target);
  const o = r?.overlay?.get(key);
  return o && !inGuessWorld(r!, actionOf(o.tx)) ? o : undefined;
}
/** Whether the reader sees `r` as action `t` commits it: deriving in `t`'s held world, or in a pass while `r`'s
 * writes are folded into `t` (#3164). */
function inGuessWorld(r: Record_, t: Transaction | null): boolean {
  if (!t || t.done) return false;
  if (derivesIn(t)) return true;
  // (Only while the folded writes are not held yet — the landing's own round; once held, reading them joins `t`.)
  const w = r.folded;
  // (An array's arrangement only: a guessed row over a folded length would tear; a field guess stays lane work.)
  return Array.isArray(r.target) && inPassNow() && !!w && !w.root.done && w.root === t && !r.keys.tx;
}
function viewGet(target: Raw, key: PropertyKey): any {
  const o = shownGuess(target, key);
  if (o) return noteGuessRead(o.tx), o.v === DELETE ? undefined : o.v;
  return rawGet(target, key);
}
function viewHas(target: Raw, key: PropertyKey): boolean {
  const o = shownGuess(target, key);
  if (o) return o.v !== DELETE;
  return rawHas(target, key);
}
function viewKeys(target: Raw): (string | symbol)[] {
  const overlay = isAuthoritative() ? null : records.get(target)?.overlay;
  if (!overlay?.size) return rawKeys(target);
  const keys = new Set<string | symbol>(rawKeys(target));
  const r = records.get(target)!;
  for (const [k, o] of overlay) if (!inGuessWorld(r, actionOf(o.tx))) o.v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    const len = viewGet(target, "length");
    for (const k of keys) if (isIndex(k) && +k >= len) keys.delete(k);
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

/** Stores made with `shallow`: the records they take in are raw (given as they are, replaced by reference). */
const shallowTargets = new WeakSet<object>();
export const markShallow = (target: object) => void shallowTargets.add(target);

/** A value read from `target[key]`: a store of its own, unless it is raw or the property frozen (a proxy must give a
 * frozen property's value as it is). */
function leaf(target: Raw, key: PropertyKey, v: any) {
  if (!isWrappable(v)) return v;
  const d = Reflect.getOwnPropertyDescriptor(own(target), key);
  if (d && !d.configurable && !d.writable) return v;
  v = child(target, v);
  // (Read under a refreshable store: refreshing it re-asks that store.)
  if (!parentOf.has(v)) parentOf.set(v, target);
  return wrap(v);
}
setStoreAncestors(storeAncestors);
/** A nested object's store object it was read from. */
const parentOf = new WeakMap<object, Raw>();
/** The store a part belongs to (its outermost object). */
function storeRoot(target: Raw): Raw {
  let r = target;
  // (A store holding itself somewhere: its parents go round; the walk stops where it began.)
  const seen = new Set<Raw>([r]);
  for (let p = parentOf.get(r); p && !seen.has(p); p = parentOf.get(r)) seen.add((r = p));
  return r;
}
/** The store objects a nested store's node lies under, nearest first (what refresh() re-asks). */
export function* storeAncestors(proxy: object): Generator<object> {
  for (let r = parentOf.get(unwrap(proxy) as object); r; r = parentOf.get(r)) yield r;
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
/** The keys with this tick's pending writes over the newest ones. */
function pendingKeys(target: Raw): (string | symbol)[] {
  const keys = new Set<string | symbol>(latestKeys(target));
  const p = records.get(target)?.pending;
  if (p) for (const [k, v] of p) v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    // Indices at or past the pending length are gone.
    const len = pendingValue(target, "length");
    for (const k of keys) if (isIndex(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
}
function pendingHas(target: Raw, key: PropertyKey): boolean {
  const p = records.get(target)?.pending;
  if (p && p.has(key)) return p.get(key) !== DELETE;
  return latestHas(target, key);
}

/** Records with pending writes, committed at the next flush. */
const dirtyRecords = new Set<Record_>();

/** The records written since `before` was taken, committed now (their readers told). */
/** The action a guess was made in (its lane's parent). */
const actionOf = (tx: Transaction | null | undefined) => (tx ? (tx.parentTx ? tx.parentTx.root : tx.root) : null);
/** The live action whose optimistic edits show over `target`, if any. */
function overlayHold(target: Raw, seen = new Set<Raw>()): Transaction | null {
  // (Nothing optimistic shown anywhere: nothing to fold into.)
  if (!liveOverlays || seen.has(target)) return null;
  seen.add(target);
  const r = records.get(target);
  if (!r) return null;
  if (r.overlay)
    for (const { tx } of r.overlay.values()) {
      const t = actionOf(tx);
      if (t && !t.done && t.open > 0) return t;
    }
  // (Or anywhere in the tree under it: the landing replaces that too.)
  for (const k of Reflect.ownKeys(r.own)) {
    const v = r.own[k as any] && typeof r.own[k as any] === "object" ? child(target, r.own[k as any]) : null;
    if (v && typeof v === "object" && records.has(v)) {
      const t = overlayHold(v, seen);
      if (t) return t;
    }
  }
  return null;
}
/** Whether the writes since `before` touch a key (or a key set) a live transaction holds. */
function writesHeldKey(before: Set<Record_>) {
  const held = (n: KeyNode | undefined) => !!n?.tx && !n.tx.root.done;
  for (const r of dirtyRecords) {
    if (before.has(r)) continue;
    if (held(r.keys)) return true;
    for (const k of r.pending?.keys() ?? []) if (held(r.nodes.get(k))) return true;
  }
  return false;
}
function promoteWrites(before: Set<Record_>) {
  for (const r of [...dirtyRecords]) if (!before.has(r)) r.keys.commit();
}

/** Inside a store's setter (a user's write: what a derive or a landing writes is the tree's own work, never held). */
let userWrite = 0;

function stage(target: Raw, key: PropertyKey, value: any) {
  const r = recordOf(target);
  // (Development, an attribution engine installed: a write that changes the key, told on its node where it is made.)
  if (process.env.NODE_ENV !== "production" && attrHooks !== null && key !== $TRACK) {
    const prev = pendingValue(target, key);
    if (!Object.is(prev, value === DELETE ? undefined : value)) attrHooks.write(node(target, key), prev, value === DELETE ? undefined : value);
  }
  // (Written while hydration keeps snapshots: the value it had, for readers in the scope.)
  if (userWrite && !r.snaps?.has(key) && takingSnapshots(() => void (r.snaps = null))) (r.snaps ??= new Map()).set(key, pendingValue(target, key));
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
  const lenBefore = Array.isArray(t) ? r.own.length : 0;
  const told = DEV?.hooks.onStoreNodeUpdate;
  for (const [key, v] of p) {
    // A new value of a key it has (not its length), on an object read through a store: staged on its node, as a signal's write (a hold keeps it off).
    const desc = Object.getOwnPropertyDescriptor(r.own, key);
    if (isFlushing() && (proxies.has(t) || derives.has(t)) && (!desc || ("value" in desc && (desc.writable || desc.configurable)))) {
      const had = latestHas(t, key);
      const prev = latestGet(t, key);
      if (v === DELETE ? !had : had && same(t, prev, v) && key !== "length") continue;
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
      if (v === DELETE ? key in r.own : !same(t, prev, v)) told(wrap(t), key, v === DELETE ? undefined : v, prev);
    }
    if (v === DELETE) {
      if (!(key in r.own)) continue;
      delete mine(t)[key];
      shape = true;
    } else {
      const had = Object.prototype.hasOwnProperty.call(r.own, key);
      if (had && same(t, r.own[key], v) && key !== "length") continue;
      if (!had) shape = true;
      const o = mine(t);
      const desc = had ? Object.getOwnPropertyDescriptor(o, key) : undefined;
      if (desc && !desc.writable && !desc.set && desc.configurable) Object.defineProperty(o, key, { ...desc, value: v });
      else put(r, o, key, v);
    }
    r.nodes.get(key)?.bump();
  }
  const len = Array.isArray(t) ? r.own.length : 0;
  if (len !== lenBefore) {
    shape = true;
    r.nodes.get("length")?.bump();
    // Indices past a shorter length are gone: their readers told.
    for (const [k, n] of r.nodes) if (isIndex(k) && +k >= len && +k < lenBefore) n.bump();
  }
  // (Staged shape changes: what enumerates the object follows them as a staged write too.)
  if (stagedShape) r.keys.stage(++r.keys.seq);
  return shape;
}

const draftHandler: ProxyHandler<Raw> = {
  get(target, key, receiver) {
    if (key === $TARGET) return target;
    if (key === $PROXY) return receiver;
    if ((key === "constructor" || key === "__proto__") && !Object.hasOwn(own(target), key) && !records.get(target)?.pending?.has(key)) return undefined;
    // (An accessor the object carries stays live: read through the draft, so it sees what this draft wrote.)
    const acc = records.get(target)?.pending?.has(key) ? undefined : Object.getOwnPropertyDescriptor(own(target), key);
    if (acc?.get) return acc.get.call(receiver);
    const v = pendingValue(target, key);
    if (typeof v === "function" && !Object.prototype.hasOwnProperty.call(own(target), key)) return v;
    // (A frozen property: as it is.)
    const d = Reflect.getOwnPropertyDescriptor(own(target), key);
    if (d && !d.configurable && !d.writable) return v;
    return draftOf(child(target, v));
  },
  has: (target, key) => pendingHas(target, key),
  ownKeys: (target) => pendingKeys(target),
  getOwnPropertyDescriptor(target, key) {
    if (!pendingHas(target, key)) return undefined;
    const base = Reflect.getOwnPropertyDescriptor(own(target), key);
    if (base?.get || base?.set) return { ...base, configurable: Reflect.getOwnPropertyDescriptor(target, key)?.configurable ?? true };
    return shownDesc(target, key, pendingValue(target, key));
  },
  set(target, key, value, receiver) {
    // (No reaching the prototype through a draft: __proto__ is not written; constructor and prototype are plain keys.)
    if (key === "__proto__") return true;
    // (An accessor the object carries: its setter runs now, through the draft.)
    const acc = records.get(target)?.pending?.has(key) ? undefined : Object.getOwnPropertyDescriptor(own(target), key);
    if (acc?.set) return acc.set.call(receiver ?? draftOf(target), value), true;
    const raw = unwrap(value);
    if (Array.isArray(target) && key === "length") {
      const before = pendingValue(target, "length");
      for (let i = raw; i < before; i++) stage(target, String(i), DELETE);
      stage(target, "length", raw);
      return true;
    }
    // (Taken in by a shallow store: raw, unless it is another store's — that one passes through, its owner's.)
    if (shallowTargets.has(target) && raw === value) markRawOne(raw);
    stage(target, key, raw);
    // An index past the end extends the array.
    if (Array.isArray(target) && isIndex(key) && +key >= pendingValue(target, "length")) stage(target, "length", +key + 1);
    return true;
  },
  deleteProperty(target, key) {
    if (pendingHas(target, key)) stage(target, key, DELETE);
    return true;
  },
  defineProperty(target, key, desc) {
    if ("value" in desc) {
      if (desc.enumerable === false) (recordOf(target).hidden ??= new Set()).add(key);
      stage(target, key, unwrap(desc.value));
    }
    else {
      // An accessor: defined now, its readers (and the key set's, for a new key) told.
      const had = Object.prototype.hasOwnProperty.call(own(target), key);
      Object.defineProperty(mine(target), key, desc);
      const r = records.get(target);
      r?.nodes.get(key)?.bump();
      if (!had) r?.keys.bump();
    }
    return true;
  },
};

const drafts = new WeakMap<object, any>();
function draftOf<T>(v: T): T {
  // (A store held inside another: written through its own object.)
  v = unwrap(v);
  if (!isWrappable(v)) return v;
  let d = drafts.get(v as object);
  if (!d) drafts.set(v as object, (d = new Proxy(v as Raw, draftHandler)));
  return d;
}

/** A setter's return value replaces the target's contents (a shallow diff: keys gone are removed). */
function replaceInto(target: Raw, next: any, d: any = draftOf(target)) {
  const raw = unwrap(next);
  // (The committed object itself: what this batch wrote to it is dropped.)
  if (raw === target) return void records.get(target)?.pending?.clear();
  if (!isWrappable(raw)) return;
  // (Another store's object: what it holds.)
  const src = own(raw);
  if (Array.isArray(target)) {
    for (let i = 0; i < src.length; i++) d[i] = src[i];
    d.length = src.length;
    return;
  }
  for (const k of Reflect.ownKeys(d)) if (!(k in src)) delete d[k];
  for (const k of Reflect.ownKeys(src)) {
    const desc = Object.getOwnPropertyDescriptor(src, k)!;
    // (An accessor it carries is adopted as one, live; a value over an accessor replaces it, not set through it.)
    if (desc.get || desc.set) Object.defineProperty(d, k, desc);
    else if (Object.getOwnPropertyDescriptor(own(target), k)?.set) Object.defineProperty(d, k, { value: desc.value, writable: true, enumerable: desc.enumerable, configurable: true });
    else d[k] = src[k];
  }
}

export type StoreSetter<T> = (fn: ((draft: T) => T | void) | Partial<T>) => void;

const ASYNC_STORE_SETTER_MESSAGE =
  "[ASYNC_STORE_SETTER] Store setter callback returned a Promise. A store setter is a synchronous transaction: " +
  "the draft closes when the callback returns, so writes after an `await` are lost. " +
  "Move the await into an action() and call the setter from there.";
const thenable = (r: unknown) => r != null && (typeof r === "object" || typeof r === "function") && typeof (r as any).then === "function";
function asyncStoreSetter(): never {
  if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "ASYNC_STORE_SETTER", kind: "write", severity: "error", message: ASYNC_STORE_SETTER_MESSAGE, data: { operation: "setStore" } });
  throw new Error(ASYNC_STORE_SETTER_MESSAGE);
}

/** A store and its setter; given a function, a store derived from what the function reads (RFC 04). */
export function createStore<T extends object>(init: T | ((draft: T) => T | void | Promise<T | void>), seed?: T, options?: StoreOptions): [T, StoreSetter<T>] {
  if (typeof init === "function") return derivedStore(init as any, seed ?? ({} as T), options, true) as [T, StoreSetter<T>];
  const given = unwrap(init) as Raw;
  // (A plain store's options come second: `createStore(value, options)`.)
  const name = (seed as StoreOptions | undefined)?.name ?? options?.name;
  if (name) storeNames.set(given, name);
  // (A frozen object, or one with a locked property: behind a shell — no proxy invariant pins what it shows — written
  // to a copy.)
  const target = given && typeof given === "object" && (Array.isArray(given) || [Object.prototype, null].includes(Object.getPrototypeOf(given))) && (Object.isFrozen(given) || hasLockedKey(given)) ? shellOf(given) : given;
  if ((seed as any)?.shallow ?? options?.shallow) {
    if (unwrap(init) !== init) throw new Error("createStore({ shallow }): value is already a store proxy");
    if (records.has(target) && !shallowTargets.has(target)) throw new Error("createStore({ shallow }): value is already tracked as a deep store");
    markShallow(target);
    markRawIngest(own(target));
  }
  const set: StoreSetter<T> = (fn) => {
    guardStoreWrite();
    const d = draftOf(target);
    const before = (fn as any)?.[RECONCILE] ? new Set(dirtyRecords) : null;
    userWrite++;
    try {
      if (typeof fn === "function") {
        const r = (fn as (d: T) => T | void)(d as T);
        if (thenable(r)) asyncStoreSetter();
        if (r !== undefined && r !== d) replaceInto(target, r);
      } else replaceInto(target, { ...untrack(() => ({ ...d })), ...(fn as object) });
    } finally {
      userWrite--;
    }
    // A reconcile given to the setter: its diff visible at once (in an action, held with it like any write; one over a
    // key a transaction holds proposes there, and rides it with the rest of the tick, A34).
    if (before && !isActing() && !writesHeldKey(before)) promoteWrites(before);
  };
  const proxy = wrap(target) as T;
  registerGraph(proxy, getOwner());
  return [proxy, set];
}

/** A derive run: whether it is still the newest, and whether it has gone async; its drafts. */
type Run = { live: boolean; async: boolean; returned?: boolean; stream?: boolean; drafts: WeakMap<object, any>; read?: () => unknown; root?: Raw };

/** `v`'s draft for a derive run: its writes dropped once a newer run has started, committed as made once it is async. */
function runDraft<T>(v: T, run: Run): T {
  v = unwrap(v);
  if (!isWrappable(v)) return v;
  let d = run.drafts.get(v as object);
  if (d) return d;
  const inner = draftOf(v) as any;
  const write = (f: () => boolean) => {
    if (!run.live) return true;
    // (A sync run's late write, after it returned: shown as made, or held by the action making it.)
    if (!run.async && (!run.returned || isActing())) return f();
    const before = new Set(dirtyRecords);
    const ok = f();
    // (A transition waits on this run: its writes are that frame's, through the flush; else they show as made.)
    // (Or an action keeps optimistic edits over the store: they fold into it, #3164.)
    const flight = run.read && !run.stream ? flightTransaction(run.read()) : null;
    const t = flight ?? (run.root ? overlayHold(run.root) : null);
    if (t) for (const r of dirtyRecords) !before.has(r) && ((r.keys.writtenIn = t), !flight && (r.folded = t));
    else promoteWrites(before);
    return ok;
  };
  d = new Proxy(v as Raw, {
    ...draftHandler,
    get(t, k) {
      const x = draftHandler.get!(t, k, inner);
      return typeof x === "object" && x !== null && k !== $TARGET && k !== $PROXY ? runDraft(x, run) : x;
    },
    set: (t, k, value) => write(() => draftHandler.set!(t, k, value, inner)),
    deleteProperty: (t, k) => write(() => draftHandler.deleteProperty!(t, k)),
    defineProperty: (t, k, desc) => write(() => draftHandler.defineProperty!(t, k, desc)),
  });
  run.drafts.set(v as object, d);
  return d;
}

/** A read-only store derived from what `fn` reads: it changes its draft, or returns a value reconciled into it. */
export function createProjection<T extends object>(fn: (draft: T) => T | void | Promise<T | void>, seed: T = {} as T, options?: { key?: string | ((v: any) => any) }): T {
  return derivedStore(fn, seed, options, false)[0];
}

/** A draft whose writes go to a copy until `activate`, then to `real`. */
function shadowDraft(real: any, shallow: boolean) {
  // (A shallow store's leaves are its own values: copied as they are.)
  const raw = plain(unwrap(real) as Raw, new Map());
  const copy = !shallow ? cloneState(raw) : Array.isArray(raw) ? raw.slice() : { ...raw };
  let live = false;
  const at = () => (live ? real : copy);
  return {
    proxy: new Proxy(copy, {
      get: (_t, k) => at()[k],
      set: (_t, k, v) => Reflect.set(at(), k, v),
      deleteProperty: (_t, k) => Reflect.deleteProperty(at(), k),
      has: (_t, k) => k in at(),
      ownKeys: () => Reflect.ownKeys(at()),
      getOwnPropertyDescriptor: (_t, k) => Object.getOwnPropertyDescriptor(at(), k),
    }),
    activate: () => void (live = true),
  };
}
const cloneState = (v: any) => (v === null || typeof v !== "object" ? v : typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

type StoreOptions = { key?: string | ((v: any) => any); seedLoadingValue?: boolean; shallow?: boolean; ssrSource?: "server" | "hybrid" | "client"; name?: string };
/** Stores given a name (development tools name their nodes by it). */
const storeNames = new WeakMap<object, string>();

/** A derived store's derive, by its root. */
const derives = new WeakMap<object, () => unknown>();

function derivedStore<T extends object>(fn: (draft: T) => any, seed: T, options: StoreOptions | undefined, writable: boolean): [T, StoreSetter<T>] {
  // (Seeded with another store: built on that store's object, live; else a family of its own.)
  const target = (unwrap(seed) !== seed ? unwrap(seed) : new Family().shell(seed, true)) as Raw;
  if (options?.name) storeNames.set(target, options.name);
  if (options?.shallow) markShallow(target);
  const key = options && "key" in options ? (options.key ?? null) : "id";
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
  // The seed window (the seed served until the first answer lands): that run's writes go to a copy, committed whole
  // at each landing; nothing it writes before shows (#2988).
  let shadow: Raw | null = null;
  const commitShadow = () => {
    if (!shadow) return;
    const before = new Set(dirtyRecords);
    into(target, plain(shadow, new Map()), key);
    promoteWrites(before);
  };
  const took = (v: unknown) => {
    // (On a server, what its source wrote before this answer is the state it answers with.)
    if (traced) promoteWrites(new Set()), queueMicrotask(changed);
    // (Streaming on a server: the state, then what changed, for the client — after this landing is in.)
    if (trail) queueMicrotask(() => trail.send());
    // (Each landing in the seed window: what the run wrote, committed whole.)
    commitShadow();
    if (v === undefined || typeof v === "number") return;
    const before = new Set(dirtyRecords);
    if (unwrap(v) !== v) linkFamily(target, unwrap(v) as Raw);
    into(target, contentOf(v), key);
    // (Landing while an action keeps optimistic edits over it: folded into that action, revealed when it settles, #3164.)
    const fold = overlayHold(target);
    if (fold) for (const r of dirtyRecords) !before.has(r) && ((r.keys.writtenIn = fold), (r.folded = fold));
    else promoteWrites(before);
  };
  // (On a server, its answer goes to the client as the state it made.)
  // (In the seed window the run wrote to its copy: that is the state it answers with.)
  const answerOf = (v: unknown) => (v === undefined || typeof v === "number" ? snapshot(shadow ?? target) : v);
  let run: Run | null = null;
  let trail: ReturnType<typeof stateTrail> | null = null;
  // (Its accessor, once made: a run's writes look up the transition waiting on its flight.)
  let memo: unknown = null;
  const m = createMemo(() => {
    shadow = options?.seedLoadingValue && runs === 0 ? (plain(target, new Map()) as Raw) : null;
    if (run) run.live = false;
    // (Traced only, its answer the server's: what it writes is dropped.)
    if (isTracing()) return fn(runDraft(target, { live: false, async: false, drafts: new WeakMap() }) as T);
    run = { live: true, async: false, drafts: new WeakMap(), read: () => memo, root: target };
    let d = shadow ? draftOf(shadow) : runDraft(target, run);
    // Taking over the server's stream ("hybrid"): what it writes before its first yield repeats the server's state, and
    // goes to a copy; after that yield, to the store.
    const handoff = options?.ssrSource === "hybrid" && (getOwner() as any)?.handoff ? shadowDraft(d, !!options?.shallow) : null;
    if (handoff) d = handoff.proxy;
    const before = new Set(dirtyRecords);
    let r = fn(d as T);
    if (handoff && r && typeof (r as any)[Symbol.asyncIterator] === "function" && typeof (r as any).then !== "function") r = firstYieldDropped(r as any, handoff.activate, undefined) as any;
    ++runs;
    if (traced && r && typeof (r as any)[Symbol.asyncIterator] === "function") (streaming = true), (r = endsWith(r as any) as any);
    // (Streaming on a server: what the client is sent — its snapshot, then a patch batch per change.)
    if (isServerRender() && options?.ssrSource !== "hybrid" && r && typeof (r as any)[Symbol.asyncIterator] === "function" && typeof (r as any).then !== "function" && !trail) {
      trail = stateTrail(() => plain(target, new Map()));
      const self = getOwner() as any;
      if (self) (self.answerStream = trail.stream), (self.answerEnd = trail.end);
    }
    // An async derive's answers are reconciled as they land (its onTake): the memo flies on its promise or generator.
    if (r && (typeof (r as any).then === "function" || typeof (r as any)[Symbol.asyncIterator] === "function")) return (run.async = true), (run.stream = typeof (r as any).then !== "function"), r;
    // (A first answer at once: its writes are that answer.)
    if (shadow) promoteWrites(before), commitShadow(), (shadow = null);
    if (r !== undefined) {
      // Another store: followed live (its changes reconciled in as they come, by a follower this run owns).
      if (unwrap(r) !== r) {
        const source = unwrap(r) as Raw;
        linkFamily(target, source);
        // (An effect: it runs whenever the source changes, read or not.)
        createEffect(
          () => {
            trackDeep(r);
            const mine = new Set(dirtyRecords);
            // (As it shows now: a write staged this flush included.)
            untrack(() => reconcileInto(target, plain(source, new Map()), key));
            promoteWrites(mine);
            return 0;
          },
          () => {},
        );
      } else into(target, unwrap(r) as Raw, key);
    }
    // What the derive wrote is visible as it returns (A28 (4): a computation never runs on against its own writes) —
    // derived in a held world, held with it (#3074).
    const held = heldPassTx();
    if (held) for (const r of dirtyRecords) !before.has(r) && (r.keys.writtenIn = held);
    else promoteWrites(before);
    run.returned = true;
    // The same answer each run: readers are told by the keys that changed, not by the derive having run.
    return 0;
  }, { writes: true, onTake: took, ...(options?.name ? { name: options.name } : {}), ...(options?.ssrSource ? { ssrSource: options.ssrSource, sourceFn: fn } : {}), ...(isServerRender() ? { answerOf } : {}), ...(options?.seedLoadingValue ? { loadingValue: 0 } : {}) } as any);
  memo = m;
  // (It holds the store's state across runs: never torn down for being read with nothing subscribed.)
  if (writable) keepMemo(m as any);
  derives.set(target, m);
  // (Its draft dies with its owner: a late write after that is dropped.)
  const o = getOwner() as any;
  if (o) (o.cleanups ??= []).push(() => run && (run.live = false));
  const proxy = new Proxy(target, {
    ...readHandler,
    get(t, k, receiver) {
      // Every read brings the derive up to date first (a key with an optimistic value shows it even before the
      // derive's first answer).
      if (k === $TARGET || k === $PROXY) return readHandler.get!(t, k, receiver);
      // (A thenable probe asks for `then`: none, and the derive is not asked either.)
      if (k === "then" && !viewHas(t, k)) return undefined;
      if (records.get(t)?.overlay?.has(k)) {
        try {
          m();
        } catch (e) {
          if (!(e instanceof NotReadyError)) throw e;
        }
      } else m();
      // (Read untracked outside a flush: this tick's own write shows, as the derive's does — #3576.)
      if (!isTracking() && !isFlushing() && records.get(t)?.pending?.has(k)) {
        const v = snapshotGet(t, k);
        return isWrappable(v) ? wrap(child(t, v)) : v;
      }
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
  // (And its object: a node read under it refreshes it.)
  refreshTarget(target, () => m);
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
      if (thenable(r)) asyncStoreSetter();
      if (r !== undefined) replaceInto(target, r);
    } else replaceInto(target, { ...(change as object) });
    // (A write to a key its derive staged under a hold: that derive runs again over it.)
    const held = (k: KeyNode | undefined) => !!k?.tx && !k.tx.root.done;
    if ([...dirtyRecords].some((r) => [...(r.pending?.keys() ?? [])].some((k) => held(r.nodes.get(k))))) rederiveHeld(m);
  };
  return [proxy as T, writable ? set : (undefined as any)];
}

// ---------------------------------------------------------------- reconcile, snapshot, deep

setPatchApply(applyPatches);

/** A store's state as a stream: its snapshot once, then the patches since the last one sent, until `end`. */
function stateTrail(read: () => any) {
  const stream = createStream();
  let ended = false;
  let last: any = undefined;
  let sent = false;
  return {
    send() {
      if (ended) return;
      const now = JSON.parse(JSON.stringify(untrack(read)));
      if (!sent) (sent = true), stream.next(now);
      else {
        const ops = diffPatches(last, now);
        if (ops.length) stream.next(ops);
      }
      last = now;
    },
    end() {
      if (ended) return;
      ended = true;
      stream.return(undefined);
    },
    stream,
  };
}

/** New data diffed into a store's draft (or a part of it), keeping identity for entries with the same key. */
export function reconcile<T>(value: T, key: string | ((v: any) => any) | null = "id") {
  // (An empty key: by position, not by identity.)
  if (key === "") key = null;
  const apply = (draft: any) => {
    if (draft == null) return;
    const target = unwrap(draft) as Raw;
    const next = contentOf(value);
    // The same record, or none: a different key at the top is not a diff of this one.
    if (key != null && isWrappable(target) && isWrappable(next) && !Array.isArray(target) && !Array.isArray(next) && keyOf(key, own(target)) !== keyOf(key, next))
      throw new Error("reconcile: the value has a different identity from the target (its key differs)");
    const before = new Set(dirtyRecords);
    pruning = true;
    try {
      reconcileInto(target, next, key);
    } finally {
      pruning = false;
    }
    // A reconcile's diff is visible as it returns (in an action, held with it like any write — an optimistic one shows;
    // one over a key a transaction holds proposes there, riding it with the rest of the tick, A34).
    if (guessWriting || (!isActing() && !writesHeldKey(before))) promoteWrites(before);
    return draft;
  };
  (apply as any)[RECONCILE] = true;
  return apply;
}
/** Inside an optimistic store's setter (its writes show at once, whatever holds). */
let guessWriting = 0;
/** In reconcile() (not a derived store's landing): a keyed subtree nobody reads is swapped whole. */
let pruning = false;
/** Marks a reconcile function: given to a setter, its diff is visible as the setter returns. */
const RECONCILE = Symbol("reconcile");

const keyOf = (key: string | ((v: any) => any) | null, v: any) => (key == null || v == null || typeof v !== "object" ? v : typeof key === "function" ? key(v) : v[key]);
/** What a value given to reconcile holds: a store's current state, else the value itself. */
const contentOf = (v: any) => {
  const n = unwrap(v);
  return n !== v ? own(n) : n;
};
/** Whether anything reads a store object or what is under it (else a keyed diff swaps it whole: a captured proxy
 * of it may go stale). Only the part read through a store is walked. */
function watched(o: Raw, seen = new Set<Raw>()): boolean {
  const r = records.get(o);
  if (!r && !proxies.has(o)) return false;
  if (seen.has(o)) return false;
  seen.add(o);
  if (r) {
    if (r.pending || r.overlay || r.guessing || readersOf(r.keys)) return true;
    for (const n of r.nodes.values()) if (readersOf(n)) return true;
  }
  const at = own(o);
  for (const k of Reflect.ownKeys(at)) {
    const d = Object.getOwnPropertyDescriptor(at, k);
    const v = d && "value" in d ? (families.get(o)?.map.get(d.value) ?? d.value) : undefined;
    if (v && typeof v === "object" && watched(v, seen)) return true;
  }
  return false;
}

/** A derive's answer into its store: another entity at the root (its key differs) replaces the children, not merged. */
function into(target: Raw, next: Raw, key: string | ((v: any) => any) | null) {
  const other = key != null && !Array.isArray(target) && isWrappable(next) && !Array.isArray(next) && Reflect.ownKeys(own(target)).length > 0 && keyOf(key, own(target)) !== keyOf(key, next);
  reconcileInto(target, next, key, other);
}

/** `next` (what to hold) diffed into `target`; `fresh`: its values put in as they are (nothing merged into what was there). */
function reconcileInto(target: Raw, next: Raw, key: string | ((v: any) => any) | null, fresh = false) {
  // (In an optimistic setter: through its guesses, tentative like any write there.)
  const d = guessWriting ? guessDraftOf(target) : draftOf(target);
  // (A shallow store's values are leaves: each slot replaced by reference, by position or by key.)
  if (shallowTargets.has(target)) {
    markRawIngest(next);
    if (Array.isArray(target) && Array.isArray(next)) {
      const len = untrack(() => d.length);
      for (let i = 0; i < next.length; i++) if (i >= len || untrack(() => d[i]) !== next[i]) d[i] = next[i];
      if (len !== next.length) d.length = next.length;
      return;
    }
    for (const k of Reflect.ownKeys(d)) if (!(k in next)) delete d[k];
    for (const k of Reflect.ownKeys(next)) if (untrack(() => d[k]) !== (next as any)[k] || !untrack(() => k in d)) d[k] = (next as any)[k];
    return;
  }
  if (Array.isArray(target) && Array.isArray(next)) {
    const old = untrack(() => [...(d as any[])].map(unwrap));
    const byKey = new Map<any, Raw>();
    if (key != null) for (const o of old) if (o && typeof o === "object") byKey.set(keyOf(key, own(o)), o);
    // (A row shown optimistically: the landed row with its key takes it over, identity kept.)
    const shown = key != null ? records.get(target)?.overlay : null;
    // (Each such row's transaction: it shows its optimistic values until that ends.)
    const recycled = new Map<Raw, Transaction | null>();
    if (shown)
      for (const e of shown.values()) {
        const o = child(target, unwrap(e.v));
        if (o && typeof o === "object" && !Array.isArray(o)) {
          const k = keyOf(key, own(o));
          if (!byKey.has(k)) byKey.set(k, o), recycled.set(o, e.tx);
        }
      }
    for (let i = 0; i < next.length; i++) {
      const n = unwrap(next[i]);
      const c = contentOf(next[i]);
      const match = key == null ? old[i] : c && typeof c === "object" ? byKey.get(keyOf(key, c)) : undefined;
      if (match && isWrappable(match) && isWrappable(c) && Array.isArray(match) === Array.isArray(c)) {
        if (recycled.has(match)) mask(match, c, recycled.get(match)!);
        d[i] = merge(match, n, c, key);
      }
      else d[i] = n;
    }
    d.length = next.length;
    return;
  }
  for (const k of Reflect.ownKeys(d)) if (!(k in next)) delete d[k];
  for (const k of Reflect.ownKeys(next)) {
    const v = next[k as any];
    const n = unwrap(v);
    const o = child(target, unwrap(pendingValue(target, k)));
    // (Another store given as the value: that store itself, live — not a copy of what it holds now.)
    if (!fresh && n === v && isWrappable(o) && isWrappable(n) && Array.isArray(o) === Array.isArray(n) && (key == null || keyOf(key, own(o)) === keyOf(key, n))) {
      const m = merge(o, n, n, key);
      if (m !== o) d[k] = m;
    } else d[k] = n;
  }
}
/** A matched pair: `o` kept with `c` diffed in (unless it holds `c` already), or, keyed and unread, `n` in its place. */
function merge(o: Raw, n: Raw, c: Raw, key: string | ((v: any) => any) | null): Raw {
  if (own(o) === c) return o;
  // (reconcile(): read by nobody; a derived store's landing: never read through the store at all.)
  if (key != null && keyOf(key, c) != null && (pruning ? !watched(o) : !proxies.has(o))) return n;
  reconcileInto(o, c, key);
  return o;
}

const snapshots = new WeakMap<object, { at: number; value: any }>();

/** A plain copy of a store's committed state, untracked (the same copy while nothing in it changed). */
export function snapshot<T>(v: T): T {
  // Nothing optimistic shown: the committed objects themselves (unchanged data keeps its identity).
  const t = unwrap(v);
  // (An optimistic draft: what it shows, this tick's guesses over the view.)
  if (t && typeof t === "object" && guessDrafts.get(t) === v) return untrack(() => plain(t, new Map(), guessKeys, guessGet));
  if (!liveOverlays) return rawOf(v, new Map());
  return untrack(() => plain(t, new Map())) as T;
}

/** The objects under a value's store proxies, at any depth: one holding a proxy copied with it unwrapped, the rest as they are. */
function rawOf(v: any, seen: Map<any, any>): any {
  const t = unwrap(v);
  if (!t || typeof t !== "object") return t;
  if (seen.has(t)) return seen.get(t);
  // (A projection following another store is rewritten as that one changes: copied, so the snapshot stays as it was.)
  if (derivedFrom.has(t)) return plain(t, seen);
  // (As it is now: writes not committed yet included.)
  const keys = snapshotKeys(t);
  const o = own(t);
  const staged = keys.length !== Reflect.ownKeys(o).length || keys.some((k) => written(t, k));
  // (Written to: a copy, made first, so a cycle back to it finds the copy.)
  let copy: any = staged || records.get(t)?.copied ? (Array.isArray(t) ? [] : Object.create(Object.getPrototypeOf(t))) : null;
  seen.set(t, copy ?? o);
  const vals: any[] = [];
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (d && !("value" in d)) {
      vals.push(d);
      continue;
    }
    const val = snapshotGet(t, k);
    const x = val && typeof val === "object" ? rawOf(child(t, val), seen) : val;
    vals.push(x);
    if (x === val && !staged) continue;
    copy ??= Array.isArray(t) ? [] : Object.create(Object.getPrototypeOf(t));
    copy[k] = x;
  }
  // (A copy holds every key: the staged world's, or the original's with what changed.)
  if (copy) for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (d && !("value" in d)) Object.defineProperty(copy, k, d);
    // (A hidden symbol key is the object's own bookkeeping: not data, not copied.)
    else if (d && !d.enumerable && typeof k === "symbol") continue;
    else if (d && !d.enumerable && !(k === "length" && Array.isArray(copy))) Object.defineProperty(copy, k, { value: vals[i], writable: true, enumerable: false, configurable: true });
    else copy[k] = vals[i];
  }
  // (Changed since the last snapshot of it — the object is written in place: a copy, so what changed has a new
  // identity; unchanged, the same answer as before.)
  const prev = snapped.get(t);
  if (prev && prev.keys.length === keys.length && prev.keys.every((k, i) => k === keys[i] && Object.is(prev.vals[i], vals[i]))) {
    seen.set(t, prev.out);
    return prev.out;
  }
  const out = copy ?? (prev ? (Array.isArray(o) ? [...o] : Object.assign(Object.create(Object.getPrototypeOf(o)), o)) : o);
  snapped.set(t, { keys, vals, out });
  seen.set(t, out);
  return out;
}
/** Each store object's last snapshot: its keys and values then, and the answer given. */
const snapped = new WeakMap<object, { keys: (string | symbol)[]; vals: any[]; out: any }>();

function plain(v: any, seen: Map<any, any>, keys = viewKeys, get = viewGet): any {
  if (!isWrappable(v)) return v;
  if (seen.has(v)) return seen.get(v);
  const out: any = Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v));
  seen.set(v, out);
  for (const k of keys(v)) {
    const desc = Object.getOwnPropertyDescriptor(own(v), k);
    if (desc?.get) Object.defineProperty(out, k, desc);
    else out[k] = plain(child(v, unwrap(get(v, k))), seen, keys, get);
  }
  return out;
}

/** Every property read (so any nested change re-runs the reader), answered as a plain snapshot. */
export function deep<T>(v: T): T {
  trackDeep(v);
  return snapshot(v);
}
/** Every property of a store read (its keys too), at any depth: a change anywhere in it runs the reader again. */
function trackDeep(v: any, seen = new Set<any>()) {
  if (!v || typeof v !== "object" || seen.has(v)) return;
  seen.add(v);
  for (const k of Reflect.ownKeys(v)) trackDeep(v[k], seen);
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
function guessKeys(target: Raw): (string | symbol)[] {
  const keys = new Set<string | symbol>(viewKeys(target));
  const g = records.get(target)?.guessing;
  if (g) for (const [k, v] of g) v === DELETE ? keys.delete(k as string | symbol) : keys.add(k as string | symbol);
  if (Array.isArray(target)) {
    const len = guessGet(target, "length");
    for (const k of keys) if (isIndex(k) && +k >= len) keys.delete(k);
  }
  return [...keys];
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

/** `target`'s values that `next` changes, shown as they are over the truth until `tx` ends. */
function mask(target: Raw, next: Raw, tx: Transaction | null) {
  if (!tx) return;
  const r = recordOf(target);
  const keys: PropertyKey[] = [];
  for (const k of new Set([...Reflect.ownKeys(own(target)), ...Reflect.ownKeys(next)])) {
    if (r.overlay?.has(k) || (viewHas(target, k) && k in next && Object.is(viewGet(target, k), next[k as any]))) continue;
    if (!r.overlay?.size) liveOverlays++;
    (r.overlay ??= new Map()).set(k, { v: viewHas(target, k) ? viewGet(target, k) : DELETE, tx });
    keys.push(k);
  }
  if (keys.length) endWith(tx, () => revert(r, keys, tx));
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
    if (typeof v === "function" && !Object.prototype.hasOwnProperty.call(own(target), key)) return v;
    return guessDraftOf(child(target, v));
  },
  has: (target, key) => guessHas(target, key),
  ownKeys: (target) => guessKeys(target),
  getOwnPropertyDescriptor(target, key) {
    if (!guessHas(target, key)) return undefined;
    return shownDesc(target, key, guessGet(target, key));
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
    if (Array.isArray(target) && isIndex(key) && +key >= guessGet(target, "length")) guessStage(target, "length", +key + 1);
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
  // (Given a plain store: one that follows it, its own optimistic layer over it; given an optimistic one, its layers
  // compose over the same object.)
  // (A value, not a derive: its second argument is its options, as createStore's.)
  if (typeof init !== "function" && seed && !options) (options = seed as any), (seed = undefined);
  const source = typeof init !== "function" && unwrap(init) !== init && !derives.has(unwrap(init) as Raw) ? init : null;
  const [store] =
    typeof init === "function" ? derivedStore(init as any, seed ?? ({} as T), options, true)
    : source ? derivedStore(() => source, (Array.isArray(unwrap(source)) ? [] : {}) as T, options, true)
    : createStore(init as T, undefined, options);
  const target = unwrap(store) as Raw;
  const derive = derives.get(target);
  const set: StoreSetter<T> = (fn) => {
    const was = guessSource;
    guessSource = derive;
    guessWriting++;
    try {
      write(fn);
    } finally {
      guessSource = was;
      guessWriting--;
    }
  };
  const write: StoreSetter<T> = (fn) => {
    const d = guessDraftOf(target);
    if (typeof fn === "function") {
      const r = (fn as (d: T) => T | void)(d as T);
      if (thenable(r)) asyncStoreSetter();
      if (r !== undefined && r !== d) replaceInto(target, r, d);
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
