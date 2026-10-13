// Solid 1's stores (`solid-js/store` 1.x) on Twist's kernel: a proxy over the plain object, a signal per key read
// under a listener, written at once through path setters, produce, reconcile, or a mutable proxy.
import * as K from "../signals.ts";
import { $PROXY, $TRACK } from "../store.ts";
import { batch, changed } from "./index.ts";

export { $PROXY, $TRACK };
export const $RAW = Symbol("store-raw");
const $NODE = Symbol("store-node");
const $HAS = Symbol("store-has");
const $SELF = Symbol("store-self");
export const DEV = undefined;

/** A key's signal: read to track, `$` to tell its readers. */
class KeyNode extends K.Signal<unknown> {
  $(v?: unknown) {
    this.value = v;
    this.bump();
    changed(this);
  }
}
type Nodes = Record<PropertyKey, KeyNode>;

export function isWrappable(obj: any): boolean {
  if (obj == null || typeof obj !== "object") return false;
  if (obj[$PROXY]) return true;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null || Array.isArray(obj);
}

export function unwrap<T>(item: T, set = new Set<unknown>()): T {
  let raw: any;
  if (item != null && (raw = (item as any)[$RAW])) return raw;
  if (!isWrappable(item) || set.has(item)) return item;
  set.add(item);
  const obj = item as any;
  if (Array.isArray(obj)) {
    if (Object.isFrozen(obj)) item = obj.slice(0) as T;
    else set.add(obj);
    const a = item as any[];
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      const u = unwrap(v, set);
      if (u !== v) a[i] = u;
    }
  } else {
    if (Object.isFrozen(obj)) item = Object.assign({}, obj);
    const o = item as any;
    for (const k of Object.keys(o)) {
      const desc = Object.getOwnPropertyDescriptor(o, k)!;
      if (desc.get) continue;
      const v = o[k];
      const u = unwrap(v, set);
      if (u !== v) o[k] = u;
    }
  }
  return item;
}

function nodesOf(target: any, symbol: symbol): Nodes {
  let nodes = target[symbol];
  if (!nodes) Object.defineProperty(target, symbol, { value: (nodes = Object.create(null)) });
  return nodes;
}
function nodeOf(nodes: Nodes, key: PropertyKey, value?: unknown): KeyNode {
  return nodes[key as any] ?? (nodes[key as any] = new KeyNode(value, { equals: false }));
}
const trackSelf = (target: any) => K.getObserver() && nodeOf(nodesOf(target, $NODE), $SELF).read();

function ownKeys(target: any) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}
function descriptor(target: any, key: PropertyKey) {
  const desc = Reflect.getOwnPropertyDescriptor(target, key);
  if (!desc || desc.get || !desc.configurable || key === $PROXY || key === $NODE) return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][key];
  return desc;
}

/** A read of `key` through the proxy: tracked under a listener, wrapped when it is a store-able value. */
function readKey(target: any, key: PropertyKey, receiver: any) {
  if (key === $RAW) return target;
  if (key === $PROXY) return receiver;
  if (key === $TRACK) return trackSelf(target), receiver;
  const nodes = nodesOf(target, $NODE);
  const tracked = nodes[key as any];
  let value = tracked ? tracked.read() : target[key];
  if (key === $NODE || key === $HAS || key === "__proto__") return value;
  if (!tracked) {
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (K.getObserver() && (typeof value !== "function" || Object.prototype.hasOwnProperty.call(target, key)) && !desc?.get) value = nodeOf(nodes, key, value).read();
  }
  return isWrappable(value) ? wrap(value) : value;
}
function hasKey(target: any, key: PropertyKey) {
  if (key === $RAW || key === $PROXY || key === $TRACK || key === $NODE || key === $HAS || key === "__proto__") return true;
  if (K.getObserver()) nodeOf(nodesOf(target, $HAS), key).read();
  return key in target;
}

const traps: ProxyHandler<any> = {
  get: readKey,
  has: hasKey,
  set: () => true,
  deleteProperty: () => true,
  ownKeys,
  getOwnPropertyDescriptor: descriptor,
};

function wrap<T>(value: T): T {
  let p = (value as any)[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, { value: (p = new Proxy(value, traps)) });
    // (A getter on the object reads through the proxy: what it reads is tracked.)
    if (!Array.isArray(value))
      for (const k of Object.keys(value as object)) {
        const desc = Object.getOwnPropertyDescriptor(value, k)!;
        if (desc.get) Object.defineProperty(value, k, { enumerable: desc.enumerable, get: desc.get.bind(p) });
      }
  }
  return p;
}

/** `state[key] = value`, its readers told (and the length's, the keys' and the object's own, as they change). */
export function setProperty(state: any, key: PropertyKey, value: unknown, deleting = false) {
  if (!deleting && state[key] === value) return;
  const prev = state[key];
  const len = state.length;
  if (value === undefined) {
    delete state[key];
    if (state[$HAS]?.[key] && prev !== undefined) state[$HAS][key].$();
  } else {
    state[key] = value;
    if (state[$HAS]?.[key] && prev === undefined) state[$HAS][key].$();
  }
  const nodes = state[$NODE] as Nodes | undefined;
  if (!nodes) return;
  nodes[key as any]?.$(value);
  if (Array.isArray(state) && state.length !== len) {
    for (let i = state.length; i < len; i++) nodes[i]?.$(undefined);
    nodes.length?.$(state.length);
  }
  nodes[$SELF as any]?.$();
}

function mergeNode(state: any, value: any) {
  for (const k of Object.keys(value)) setProperty(state, k, value[k]);
}

function updateArray(current: any[], next: any) {
  if (typeof next === "function") next = next(current);
  next = unwrap(next);
  if (Array.isArray(next)) {
    if (current === next) return;
    let i = 0;
    for (const len = next.length; i < len; i++) if (current[i] !== next[i]) setProperty(current, i, next[i]);
    setProperty(current, "length", next.length);
  } else mergeNode(current, next);
}

function updatePath(current: any, path: any[], traversed: PropertyKey[] = []) {
  let part: any;
  let prev = current;
  if (path.length > 1) {
    part = path.shift();
    const isArray = Array.isArray(current);
    if (Array.isArray(part)) {
      for (const p of part) updatePath(current, [p, ...path], traversed);
      return;
    }
    if (isArray && typeof part === "function") {
      for (let i = 0; i < current.length; i++) if (part(current[i], i)) updatePath(current, [i, ...path], traversed);
      return;
    }
    if (isArray && typeof part === "object") {
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) updatePath(current, [i, ...path], traversed);
      return;
    }
    if (path.length > 1) return updatePath(current[part], path, [part, ...traversed]);
    prev = current[part];
    traversed = [part, ...traversed];
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(prev, traversed);
    if (value === prev) return;
  }
  if (part === undefined && value == undefined) return;
  value = unwrap(value);
  if (part === undefined || (isWrappable(prev) && isWrappable(value) && !Array.isArray(value))) mergeNode(prev, value);
  else setProperty(current, part, value);
}

export type Store<T> = T;
export type SetStoreFunction<T> = (...args: any[]) => void;

export function createStore<T extends object>(...[store, options]: [T?, { name?: string }?]): [Store<T>, SetStoreFunction<T>] {
  const raw = unwrap((store || {}) as T);
  const isArray = Array.isArray(raw);
  const wrapped = wrap(raw);
  const set = (...args: any[]) => batch(() => (isArray && args.length === 1 ? updateArray(raw as any, args[0]) : updatePath(raw, args)));
  return [wrapped, set];
}

// ---------------------------------------------------------------- produce

const producers = new WeakMap<object, any>();
const producerTraps: ProxyHandler<any> = {
  get(target, key) {
    if (key === $RAW) return target;
    const value = target[key];
    let proxy;
    return isWrappable(value) ? producers.get(value) || (producers.set(value, (proxy = new Proxy(value, producerTraps))), proxy) : value;
  },
  set(target, key, value) {
    setProperty(target, key, unwrap(value));
    return true;
  },
  deleteProperty(target, key) {
    setProperty(target, key, undefined, true);
    return true;
  },
};
export function produce<T>(fn: (state: T) => void): (state: T) => T {
  return (state) => {
    if (isWrappable(state)) {
      let proxy = producers.get(state as object);
      if (!proxy) producers.set(state as object, (proxy = new Proxy(state, producerTraps)));
      fn(proxy);
    }
    return state;
  };
}

// ---------------------------------------------------------------- reconcile

const $ROOT = Symbol("store-root");

/** `previous[key]` made to match `target`, changed only where it differs (rows matched by `key`, or by identity). */
function applyState(target: any, parent: any, property: PropertyKey, merge: boolean | undefined, key: string | null) {
  const previous = parent[property];
  if (target === previous) return;
  const isArray = Array.isArray(target);
  if (property !== $ROOT && (!isWrappable(target) || !isWrappable(previous) || isArray !== Array.isArray(previous) || (key && target[key] !== previous[key]))) {
    setProperty(parent, property, target);
    return;
  }
  if (isArray) {
    const same = (a: any, b: any) => a === b || (!!key && !!a && !!b && a[key] === b[key]);
    if (target.length && previous.length && (!merge || (key && target[0] && target[0][key] != null))) {
      let start = 0;
      let end = Math.min(previous.length, target.length);
      for (; start < end && same(previous[start], target[start]); start++) applyState(target[start], previous, start, merge, key);
      const temp = new Array(target.length);
      let newEnd = target.length - 1;
      for (end = previous.length - 1; end >= start && newEnd >= start && same(previous[end], target[newEnd]); end--, newEnd--) temp[newEnd] = previous[end];
      let j: number;
      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) setProperty(previous, j, target[j]);
        for (; j < target.length; j++) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        }
        if (previous.length > target.length) setProperty(previous, "length", target.length);
        return;
      }
      // Where each item of the new middle came from in the old one, by its key.
      const at = new Map<unknown, number>();
      const nextAt = new Array(newEnd + 1);
      const keyOf = (item: any) => (key && item ? item[key] : item);
      for (j = newEnd; j >= start; j--) {
        const k = keyOf(target[j]);
        const i = at.get(k);
        nextAt[j] = i === undefined ? -1 : i;
        at.set(k, j);
      }
      for (let i = start; i <= end; i++) {
        const k = keyOf(previous[i]);
        j = at.get(k) as number;
        if (j !== undefined && j !== -1) {
          temp[j] = previous[i];
          at.set(k, nextAt[j]);
        }
      }
      for (j = start; j < target.length; j++) {
        if (j in temp) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        } else setProperty(previous, j, target[j]);
      }
    } else for (let i = 0; i < target.length; i++) applyState(target[i], previous, i, merge, key);
    if (previous.length > target.length) setProperty(previous, "length", target.length);
    return;
  }
  for (const k of Object.keys(target)) applyState(target[k], previous, k, merge, key);
  for (const k of Object.keys(previous)) if (target[k] === undefined) setProperty(previous, k, undefined);
}

export type ReconcileOptions = { key?: string | null; merge?: boolean };
export function reconcile<T>(value: T, options: ReconcileOptions = {}): (state: T) => T {
  const { merge, key = "id" } = options;
  const v = unwrap(value);
  return (state) => {
    if (!isWrappable(state) || !isWrappable(v)) return v;
    const res = applyState(v, { [$ROOT]: state }, $ROOT, merge, key);
    return res === undefined ? state : res;
  };
}

// ---------------------------------------------------------------- mutable

const mutableTraps: ProxyHandler<any> = {
  get(target, key, receiver) {
    if (key === $RAW) return target;
    if (key === $PROXY) return receiver;
    if (key === $TRACK) return trackSelf(target), receiver;
    const nodes = nodesOf(target, $NODE);
    const tracked = nodes[key as any];
    let value = tracked ? tracked.read() : target[key];
    if (key === $NODE || key === $HAS || key === "__proto__") return value;
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, key);
      const isFunction = typeof value === "function";
      if (K.getObserver() && (!isFunction || Object.prototype.hasOwnProperty.call(target, key)) && !desc?.get) value = nodeOf(nodes, key, value).read();
      // (An array's own methods run on the proxy, their writes batched.)
      else if (value != null && isFunction && value === Array.prototype[key as any]) return (...args: unknown[]) => batch(() => Array.prototype[key as any].apply(receiver, args));
    }
    return isWrappable(value) ? wrapMutable(value) : value;
  },
  has: hasKey,
  set(target, key, value) {
    batch(() => setProperty(target, key, unwrap(value)));
    return true;
  },
  deleteProperty(target, key) {
    batch(() => setProperty(target, key, undefined, true));
    return true;
  },
  ownKeys,
  getOwnPropertyDescriptor: descriptor,
};

function wrapMutable<T>(value: T): T {
  let p = (value as any)[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, { value: (p = new Proxy(value, mutableTraps)) });
    for (const k of Object.keys(value as object)) {
      const d = Object.getOwnPropertyDescriptor(value, k)!;
      if (d.get) Object.defineProperty(value, k, { get: d.get.bind(p), set: d.set && ((v: unknown) => batch(() => d.set!.call(p, v))), enumerable: d.enumerable });
    }
    // (A class instance's accessors, inherited ones too: run on the proxy, setters batched.)
    for (let proto = Object.getPrototypeOf(value); proto && proto !== Object.prototype && proto !== Array.prototype; proto = Object.getPrototypeOf(proto))
      for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
        if (k === "constructor" || Object.prototype.hasOwnProperty.call(value, k)) continue;
        if (d.get || d.set) Object.defineProperty(value, k, { get: d.get?.bind(p), set: d.set && ((v: unknown) => batch(() => d.set!.call(p, v))), enumerable: false, configurable: true });
      }
  }
  return p;
}

export function createMutable<T extends object>(state: T, options?: { name?: string }): T {
  const raw = unwrap(state || ({} as T));
  return wrapMutable(raw);
}

export function modifyMutable<T>(state: T, modifier: (state: T) => T) {
  batch(() => modifier(unwrap(state)));
}
