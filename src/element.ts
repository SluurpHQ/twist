import { checkKeys, dev, warn } from "./warnings.ts";
import { keyString } from "./coercion.ts";

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

/** The component rendering now (in development): an element's owner, for owner stacks. Given by core. */
let ownerSource: () => any = () => null;
export const setOwnerSource = (fn: () => any) => void (ownerSource = fn);
/** The component a server render is in now ({ type, owner }): owner of what it makes, and of the owner stack. */
let ownerOverride: any = null;
export function withOwner<T>(owner: any, fn: () => T): T {
  const was = ownerOverride;
  ownerOverride = owner;
  try {
    return fn();
  } finally {
    ownerOverride = was;
  }
}
export const ownerNow = () => ownerOverride;
export type Element = { $$typeof: symbol; type: any; key: string | null; props: any; _owner?: any; _store?: object };

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
  // Production: a plain object, as React's (no checks to keep).
  if (!dev()) return { $$typeof: ELEMENT, type, key, ref: props.ref ?? null, props } as any;
  const el: any ={ $$typeof: ELEMENT, type, key, props, _owner: null };
  // Its owner (development): not enumerable, so deep equality does not walk into the fiber tree.
  if (dev()) Object.defineProperty(el, "_owner", { value: ownerOverride ?? ownerSource(), writable: true, enumerable: false });
  // Not enumerable, as React's: elements compare equal whatever was checked on them.
  const store = {};
  Object.defineProperty(store, "validated", { value: 0, writable: true, configurable: false, enumerable: false });
  Object.defineProperty(el, "_store", { value: store, writable: true, configurable: false, enumerable: false });
  // element.ref: gone in React 19 (ref is a prop); reading it warns when there is one.
  if (props.ref !== undefined && props.ref !== null) Object.defineProperty(el, "ref", { enumerable: false, get: refGetter });
  else Object.defineProperty(el, "ref", { enumerable: false, value: null });
  // Read-only in development, as React's (a component changing its props is a bug).
  if (dev()) Object.freeze(props), Object.freeze(el);
  return el;
}
const nameForKey = (type: any) => (typeof type === "function" ? type.displayName || type.name || "Unknown" : typeof type === "string" ? type : "Unknown");
function refGetter(this: any) {
  warn("Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release.", "element-ref:" + nameForKey(this.type));
  return this.props.ref !== undefined ? this.props.ref : null;
}
/** props.key reads as nothing, with React's warning: the key is the element's, not a prop. */
function keyGetter(props: any, type: any) {
  if (!dev()) return;
  const get = () => void warn(`${nameForKey(type)}: \`key\` is not a prop. Trying to access it will result in \`undefined\` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)`, "key-prop");
  (get as any).isReactWarning = true;
  Object.defineProperty(props, "key", { get, configurable: true });
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
  if (Array.isArray(children)) {
    for (const c of children) validate(c, type);
    if (dev()) Object.freeze(children);
  } else if (children !== undefined) warn("React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead.");
  return make(type, config, maybeKey);
}

/** A child as written: an array's elements need keys; an element is marked checked (passed on later in an array,
 * as a Provider passes its children, it needs none), as React marks it. */
function validate(c: any, type: any) {
  if (!dev()) return;
  if (Array.isArray(c)) checkKeys(c, type);
  else if (c?._store) c._store.validated = 1;
}

function make(type: any, config: any, maybeKey?: any): Element {
  config ??= {};
  if (dev() && Object.prototype.hasOwnProperty.call(config, "key")) {
    // A key spread in with other props: React wants it written as key={...}.
    const name = nameForKey(type);
    const keys = Object.keys(config).filter((k) => k !== "key");
    const withKey = keys.length ? `{key: someKey, ${keys.join(": ..., ")}: ...}` : "{key: someKey}";
    const without = keys.length ? `{${keys.join(": ..., ")}: ...}` : "{}";
    warn(
      `A props object containing a "key" prop is being spread into JSX:\n  let props = ${withKey};\n  <${name} {...props} />\nReact keys must be passed directly to JSX without using spread:\n  let props = ${without};\n  <${name} key={someKey} {...props} />`,
      "key-spread:" + name + withKey,
    );
  }
  let key: string | null = maybeKey !== undefined ? keyString(maybeKey) : null;
  if (config.key !== undefined) key = keyString(config.key);
  let props = config;
  if ("key" in config) {
    props = {};
    for (const k in config) if (k !== "key") props[k] = config[k];
  }
  if (key !== null) keyGetter(props, type);
  return element(type, key, withDefaults(type, props));
}
export const jsxDEV = (type: any, config: any, key?: any, isStatic?: boolean) => (isStatic ? jsxs : jsx)(type, config, key);

export function createElement(type: any, config?: any, ...children: any[]): Element {
  for (const c of children) validate(c, type);
  const props: any = {};
  let key: string | null = null;
  if (config != null) {
    if (config.key !== undefined) key = keyString(config.key);
    for (const k in config) if (k !== "key" && k !== "__self" && k !== "__source") props[k] = config[k];
  }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = dev() ? Object.freeze(children) : children;
  if (key !== null) keyGetter(props, type);
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
  if (el === null || el === undefined) throw new Error(`The argument must be a React element, but you passed ${el}.`);
  const props = { ...el.props };
  let key = el.key;
  if (config != null) {
    if (config.key !== undefined) key = keyString(config.key);
    const defaults = (el.type as any)?.defaultProps;
    for (const k in config) {
      if (!Object.prototype.hasOwnProperty.call(config, k) || k === "key" || k === "__self" || k === "__source" || (k === "ref" && config.ref === undefined)) continue;
      // An undefined prop takes the type's default, as when the element was made.
      props[k] = config[k] === undefined && defaults !== undefined ? defaults[k] : config[k];
    }
  }
  if (dev()) for (const c of children) validate(c, el.type);
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return element(el.type, key, props);
}

export const isValidElement = (x: any): x is Element => typeof x === "object" && x !== null && x.$$typeof === ELEMENT;

export function createRef<T = any>(): { current: T | null } {
  return { current: null };
}

export function forwardRef(render: (props: any, ref: any) => any) {
  // React's checks of what is given, in development.
  if ((render as any)?.$$typeof === MEMO) {
    warn("forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...)).");
  } else if (typeof render !== "function") {
    warn(`forwardRef requires a render function but was given ${render === null ? "null" : typeof render}.`);
  } else if (render.length !== 0 && render.length !== 2) {
    warn(`forwardRef render functions accept exactly two parameters: props and ref. ${render.length === 1 ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined."}`);
  }
  if (typeof render === "function" && (render as any).defaultProps != null) {
    warn("forwardRef render functions do not support defaultProps. Did you accidentally pass a React component?");
  }
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
  const t = (container as any)?.nodeType;
  if (t !== 1 && t !== 9 && t !== 11) throw new Error("Target container is not a DOM element.");
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
  if (c?.$$typeof === Symbol.for("react.element"))
    return new Error(
      'A React Element from an older version of React was rendered. This is not supported. It can happen if:\n- Multiple copies of the "react" package is used.\n- A library pre-bundled an old copy of "react" or "react/jsx-runtime".\n- A compiler tries to "inline" JSX instead of using the runtime.',
    );
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
      // (A failed load rejects, so what waits on it hears why.)
      (e: any) => {
        p.status = 2;
        p.value = e;
        throw e;
      },
    );
    p.promise.catch(() => {});
  }
  throw p.promise;
}

/** A promise's value, or the promise itself thrown (to suspend), as `use` reads it. */
export function readThenable(t: any) {
  if (t.status === "fulfilled") return t.value;
  if (t.status === "rejected") throw t.reason;
  // Already tracked by someone else (its status set): only subscribed to, as React does.
  if (typeof t.status === "string") t.then(() => {}, () => {});
  else {
    t.status = "pending";
    t.then(
      (v: any) => ((t.status = "fulfilled"), (t.value = v)),
      (e: any) => ((t.status = "rejected"), (t.reason = e)),
    );
    // Settled as it was subscribed to (an instrumented thenable): read at once, no suspending.
    if (t.status === "fulfilled") return t.value;
    if (t.status === "rejected") throw t.reason;
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
  // An iterable (or an old `@@iterator` object, which React still accepts).
  const iterator = t === "object" ? (children[Symbol.iterator] ?? children["@@iterator"]) : undefined;
  if (typeof iterator === "function") {
    let i = 0;
    for (const c of { [Symbol.iterator]: () => iterator.call(children) }) count += mapInto(c, out, prefix, next + keyAt(c, i++), fn);
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
