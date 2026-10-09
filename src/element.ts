import { checkKeys } from "./warnings.ts";

// Elements as React 19 makes them: what JSX and createElement return, and what libraries inspect
// (`$$typeof`, `type`, `key`, `props`, the ref among the props).

export const ELEMENT = Symbol.for("react.transitional.element");
export const PORTAL = Symbol.for("react.portal");
export const FRAGMENT = Symbol.for("react.fragment");
export const STRICT = Symbol.for("react.strict_mode");
export const PROFILER = Symbol.for("react.profiler");
export const SUSPENSE = Symbol.for("react.suspense");
export const SUSPENSE_LIST = Symbol.for("react.suspense_list");
export const ACTIVITY = Symbol.for("react.activity");
export const VIEW_TRANSITION = Symbol.for("react.view_transition");
export const CONTEXT = Symbol.for("react.context");
export const CONSUMER = Symbol.for("react.consumer");
export const FORWARD_REF = Symbol.for("react.forward_ref");
export const MEMO = Symbol.for("react.memo");
export const LAZY = Symbol.for("react.lazy");

export type Element = { $$typeof: symbol; type: any; key: string | null; props: any; _owner?: null; _store?: object };

export const Fragment = FRAGMENT;
export const StrictMode = STRICT;
export const Profiler = PROFILER;
export const Suspense = SUSPENSE;
export const SuspenseList = SUSPENSE_LIST;
export const Activity = ACTIVITY;
/** A part of the page animated by the browser's view transitions when it changes; drawn as its children. */
export const ViewTransition = VIEW_TRANSITION;
export const unstable_ViewTransition = VIEW_TRANSITION;
export const unstable_SuspenseList = SUSPENSE_LIST;
/** Names a transition's kind for view transitions; nothing to do where they are drawn as children. */
export function addTransitionType(_type: string) {}

function element(type: any, key: any, props: any): Element {
  const el: any = { $$typeof: ELEMENT, type, key: key == null ? null : "" + key, props, _owner: null };
  // Not enumerable, as React's: elements compare equal whatever was checked on them.
  Object.defineProperty(el, "_store", { value: {}, writable: true, configurable: false, enumerable: false });
  return el;
}

/** What the automatic JSX runtime calls: `children` already in the props, the key apart. An array as children
 * came from code (a map), so its elements should have keys. */
export function jsx(type: any, config: any, maybeKey?: any): Element {
  validate(config?.children, type);
  return make(type, config, maybeKey);
}

/** JSX with several children: they are siblings written out, needing no keys, but an array among them does. */
export function jsxs(type: any, config: any, maybeKey?: any): Element {
  const children = config?.children;
  if (Array.isArray(children)) for (const c of children) validate(c, type);
  return make(type, config, maybeKey);
}

/** A child as written: an array's elements need keys; an element is marked checked (passed on later in an array,
 * as a Provider passes its children, it needs none), as React marks it. */
function validate(c: any, type: any) {
  if (Array.isArray(c)) checkKeys(c, type);
  else if (c?._store) c._store.validated = 1;
}

function make(type: any, config: any, maybeKey?: any): Element {
  let key = maybeKey;
  let props = config;
  if (config && "key" in config) {
    key = config.key;
    props = {};
    for (const k in config) if (k !== "key") props[k] = config[k];
  }
  return element(type, key, withDefaults(type, props ?? {}));
}
export const jsxDEV = (type: any, config: any, key?: any, isStatic?: boolean) => (isStatic ? jsxs : jsx)(type, config, key);

export function createElement(type: any, config?: any, ...children: any[]): Element {
  for (const c of children) validate(c, type);
  const props: any = {};
  let key = null;
  if (config != null) {
    if (config.key !== undefined) key = config.key;
    for (const k in config) if (k !== "key" && k !== "__self" && k !== "__source") props[k] = config[k];
  }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return element(type, key, withDefaults(type, props));
}

/** Class components keep `defaultProps` (React 19 dropped them for functions). */
function withDefaults(type: any, props: any) {
  const d = typeof type === "function" && type.prototype?.isReactComponent ? type.defaultProps : null;
  if (!d) return props;
  for (const k in d) if (props[k] === undefined) props[k] = d[k];
  return props;
}

export function cloneElement(el: Element, config?: any, ...children: any[]): Element {
  const props = { ...el.props };
  let key = el.key;
  if (config != null) {
    if (config.key !== undefined) key = config.key;
    for (const k in config) if (k !== "key" && k !== "__self" && k !== "__source") props[k] = config[k];
  }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return element(el.type, key, props);
}

export const isValidElement = (x: any): x is Element => typeof x === "object" && x !== null && x.$$typeof === ELEMENT;

export function createRef<T = any>(): { current: T | null } {
  return { current: null };
}

export function forwardRef(render: (props: any, ref: any) => any) {
  return { $$typeof: FORWARD_REF, render };
}

export function memo(type: any, compare?: (a: any, b: any) => boolean) {
  return { $$typeof: MEMO, type, compare: compare ?? null };
}

export function lazy(load: () => Promise<{ default: any }>) {
  return { $$typeof: LAZY, _payload: { status: -1, load, value: undefined as any } };
}

export function createContext<T>(defaultValue: T) {
  const ctx: any = { $$typeof: CONTEXT, _defaultValue: defaultValue, _currentValue: defaultValue, displayName: undefined };
  ctx.Provider = ctx;
  ctx.Consumer = { $$typeof: CONSUMER, _context: ctx };
  return ctx;
}

export function createPortal(children: any, container: Node, key?: any) {
  return { $$typeof: PORTAL, key: key == null ? null : "" + key, children, containerInfo: container, implementation: null };
}

/** React's error for a type that is no component: undefined (a missing export), an object, null. */
export function invalidType(type: any): Error {
  const got = type === null ? "null" : Array.isArray(type) ? "array" : typeof type;
  const hint =
    type === undefined || (typeof type === "object" && type !== null && Object.keys(type).length === 0)
      ? " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports."
      : "";
  return new Error(`Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: ${got}.${hint}`);
}

/** React's error for an object rendered as a child. */
export function objectChild(c: any): Error {
  const shown = Object.prototype.toString.call(c) === "[object Object]" ? `object with keys {${Object.keys(c).join(", ")}}` : String(c);
  return new Error(`Objects are not valid as a React child (found: ${shown}). If you meant to render a collection of children, use an array instead.`);
}

/** A lazy component's value, or the promise to wait for (thrown, to suspend). */
export function readLazy(p: any) {
  if (p.status === 1) return p.value;
  if (p.status === 2) throw p.value;
  if (p.status === -1) {
    p.status = 0;
    p.promise = p.load().then(
      (m: any) => ((p.status = 1), (p.value = m.default ?? m)),
      (e: any) => ((p.status = 2), (p.value = e)),
    );
  }
  throw p.promise;
}

/** A promise's value, or the promise itself thrown (to suspend), as `use` reads it. */
export function readThenable(t: any) {
  if (t.status === "fulfilled") return t.value;
  if (t.status === "rejected") throw t.reason;
  if (t.status !== "pending") {
    t.status = "pending";
    t.then(
      (v: any) => ((t.status = "fulfilled"), (t.value = v)),
      (e: any) => ((t.status = "rejected"), (t.reason = e)),
    );
  }
  throw t;
}

/** A child that is a lazy or a promise, as what it resolves to (React 19 renders both as children). */
export function unwrapChild(c: any): any {
  for (let i = 0; i < 10 && c && typeof c === "object"; i++) {
    if (c.$$typeof === LAZY) c = readLazy(c._payload);
    else if (typeof c.then === "function" && !c.$$typeof) c = readThenable(c);
    else break;
  }
  return c;
}

/** Children as React's `Children` helpers walk them (its mapIntoArray): arrays flattened, each child keyed by where it
 * is (`.0`, `.$key`, `:` between levels), keys the callback returns joined with `/`. */
const escapeKey = (key: string) => "$" + key.replace(/[=:]/g, (m) => (m === "=" ? "=0" : "=2"));
const escapeUserKey = (key: string) => key.replace(/\/+/g, "$&/");
const keyAt = (c: any, i: number) => (c && typeof c === "object" && c.key != null ? escapeKey("" + c.key) : i.toString(36));

function mapInto(children: any, out: any[], prefix: string, name: string, fn: (c: any) => any): number {
  children = unwrapChild(children);
  const t = typeof children;
  const single =
    children == null || t === "boolean" || t === "string" || t === "number" || t === "bigint" ||
    (t === "object" && (children.$$typeof === ELEMENT || children.$$typeof === PORTAL));
  if (single) {
    const child = t === "boolean" || children === undefined ? null : children;
    const mapped = fn(child);
    const key = name === "" ? "." + keyAt(child, 0) : name;
    if (Array.isArray(mapped)) {
      mapInto(mapped, out, escapeUserKey(key) + "/", "", (c) => c);
    } else if (mapped != null) {
      out.push(
        isValidElement(mapped)
          ? cloneElement(mapped, {
              key: prefix + (mapped.key != null && (!child || child.key !== mapped.key) ? escapeUserKey("" + mapped.key) + "/" : "") + key,
            })
          : mapped,
      );
    }
    return 1;
  }
  const next = name === "" ? "." : name + ":";
  let count = 0;
  if (Array.isArray(children)) {
    children.forEach((c, i) => (count += mapInto(c, out, prefix, next + keyAt(c, i), fn)));
    return count;
  }
  if (t === "object" && typeof children[Symbol.iterator] === "function") {
    let i = 0;
    for (const c of children) count += mapInto(c, out, prefix, next + keyAt(c, i++), fn);
    return count;
  }
  const shown = Object.prototype.toString.call(children) === "[object Object]" ? `object with keys {${Object.keys(children).join(", ")}}` : String(children);
  throw new Error(`Objects are not valid as a React child (found: ${shown}). If you meant to render a collection of children, use an array instead.`);
}

export const Children = {
  map(children: any, fn: (c: any, i: number) => any, ctx?: any) {
    if (children == null) return children;
    const out: any[] = [];
    let i = 0;
    mapInto(children, out, "", "", (c) => fn.call(ctx, c, i++));
    return out;
  },
  forEach(children: any, fn: (c: any, i: number) => void, ctx?: any) {
    if (children == null) return;
    let i = 0;
    mapInto(children, [], "", "", (c) => void fn.call(ctx, c, i++));
  },
  count(children: any) {
    if (children == null) return 0;
    return mapInto(children, [], "", "", () => null);
  },
  toArray(children: any) {
    return Children.map(children, (c) => c) ?? [];
  },
  only(children: any) {
    if (!isValidElement(children)) throw new Error("React.Children.only expected to receive a single React element child.");
    return children;
  },
};
