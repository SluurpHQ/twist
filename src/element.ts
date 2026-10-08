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

function element(type: any, key: any, props: any): Element {
  return { $$typeof: ELEMENT, type, key: key == null ? null : "" + key, props, _owner: null, _store: {} };
}

/** What the automatic JSX runtime calls: `children` already in the props, the key apart. */
export function jsx(type: any, config: any, maybeKey?: any): Element {
  let key = maybeKey;
  let props = config;
  if (config && "key" in config) {
    key = config.key;
    props = {};
    for (const k in config) if (k !== "key") props[k] = config[k];
  }
  return element(type, key, withDefaults(type, props ?? {}));
}
export const jsxs = jsx;
export const jsxDEV = (type: any, config: any, key?: any) => jsx(type, config, key);

export function createElement(type: any, config?: any, ...children: any[]): Element {
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

/** Children as React's `Children` helpers see them: arrays flattened, each element keyed by where it is. */
function walk(children: any, out: any[], prefix: string) {
  if (Array.isArray(children)) {
    children.forEach((c, i) => walk(c, out, `${prefix}${prefix ? ":" : "."}${keyOf(c, i)}`));
    return;
  }
  if (children && typeof children === "object" && !isValidElement(children) && typeof children[Symbol.iterator] === "function") {
    walk([...children], out, prefix);
    return;
  }
  out.push([children, prefix || ".0"]);
}
const keyOf = (c: any, i: number) => (isValidElement(c) && c.key != null ? "$" + c.key : i.toString(36));

export const Children = {
  map(children: any, fn: (c: any, i: number) => any, ctx?: any) {
    if (children == null) return children;
    const out: any[] = [];
    let i = 0;
    const all: any[] = [];
    walk(children, all, "");
    for (const [c, key] of all) {
      const mapped = fn.call(ctx, typeof c === "boolean" || c === undefined ? null : c, i++);
      const list: any[] = [];
      walk(mapped, list, "");
      for (const [m, k2] of list) {
        if (m == null || typeof m === "boolean") continue;
        out.push(isValidElement(m) ? cloneElement(m, { key: (m.key != null && m.key !== c?.key ? "." + "$" + m.key + "/" : "") + key + (list.length > 1 ? k2 : "") }) : m);
      }
    }
    return out;
  },
  forEach(children: any, fn: (c: any, i: number) => void, ctx?: any) {
    const all: any[] = [];
    walk(children, all, "");
    all.forEach(([c], i) => fn.call(ctx, typeof c === "boolean" || c === undefined ? null : c, i));
  },
  count(children: any) {
    if (children == null) return 0;
    const all: any[] = [];
    walk(children, all, "");
    return all.length;
  },
  toArray(children: any) {
    return Children.map(children, (c) => c) ?? [];
  },
  only(children: any) {
    if (!isValidElement(children)) throw new Error("React.Children.only expected to receive a single React element child.");
    return children;
  },
};
