// Twist's side of solid-js's components in the browser: the marks Twist's JSX pass leaves, components the React
// bridge may mount instead, and solid-js's control flow marked Solid-style (so a React tree mounts it as Twist's).
import { $PROXY, createRoot, getOwner, merge, untrack } from "../core/index.js";
import { createComponent, lazy } from "./component.js";
import { For, Repeat, Show, Switch, Match, Errored, Loading, Reveal } from "./flow.js";
import { NoHydration, Hydration, createMemo } from "./hydration.js";
import { foreign, isTwist, ownOf, isDynamic, isChildren, builtin } from "../marks.ts";
export { TWIST, setReactHost, __twist_mark, isTwist, ownOf, setForeignComponent, __twist_d, __twist_c, __twist_k, __twist_ref, isDynamic, isChildren, markBuiltin, builtin } from "../marks.ts";

/** solid-js's control flow marked Solid-style (for the React bridge: what it meets unmarked, it mounts as React's). */
export function markControlFlow() {
  for (const f of [For, Repeat, Show, Switch, Match, Errored, Loading, Reveal, NoHydration, Hydration]) builtin(f);
}

/** A component rendered: a Solid-style one through createComponent, a React one mounted by the bridge. */
export function callComponent<P extends Record<string, any>>(type: (props: P) => any, props: P) {
  return foreign && !isTwist(type) ? foreign(type, props) : createComponent(type, props);
}

/** A component called in the current owner, with none of its own (a static dynamic: as compiled `<C />` sits). */
export function callInline<P>(type: (props: P) => any, props: P) {
  return foreign && !isTwist(type) ? foreign(type, props) : untrack(() => ownOf(type)(props));
}

/** A component called and what it returns rendered by `render`, both under its owner (what it renders is its own). */
export function renderComponent<P, R>(Comp: (props: P) => any, props: P, render: (v: any) => R): R {
  if (foreign && !isTwist(Comp)) return render(foreign(Comp, props));
  const own = ownOf(Comp);
  if (process.env.NODE_ENV === "production") return render(untrack(() => own(props)));
  const label = `<${own.name || "Anonymous"}>`;
  return createRoot(
    () => {
      (getOwner() as any)._name = label;
      return render(untrack(() => own(props), label));
    },
    { transparent: true },
  );
}

/** A condition in JSX (`test ? a : b`, `test && a`): its test as a memo, so a branch is made again only when it flips. */
export const __twist_memo = <T>(fn: () => T) => createMemo(fn, { sync: true } as any);

/** `use:fn={value}` (Solid 1's directive): a ref calling `fn(el, () => value)`, untracked. */
export const __twist_use = (fn: (el: unknown, value: () => unknown) => void, value: () => unknown) => (el: unknown) => untrack(() => fn(el, value));

/** A component's props: marked parts as getters, spreads (each read through a memo) merged in their order, children lazy. */
export function componentProps(raw: Record<string, any>): Record<string, any> {
  let sources: any[] | null = null;
  let own: Record<string, any> = {};
  let owned = false;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (k.startsWith("$spread$")) {
      (sources ??= []);
      if (owned) sources.push(own), (own = {}), (owned = false);
      sources.push(spreadSource(v));
      continue;
    }
    owned = true;
    if (isDynamic(v) || (k === "children" && isChildren(v))) Object.defineProperty(own, k, { enumerable: true, configurable: true, get: v });
    else own[k] = v;
  }
  if (!sources) return own;
  if (owned) sources.push(own);
  return merge(...sources);
}

/** A spread's object, read each time a key is read (no memo: the expression is read where its keys are), a proxy as
 * merge() takes one. */
export function spreadSource(read: () => any) {
  const proxy: any = new Proxy({} as any, {
    get: (_t, k) => (k === $PROXY ? proxy : read()?.[k]),
    has: (_t, k) => k === $PROXY || k in (read() ?? {}),
    ownKeys: () => Reflect.ownKeys(read() ?? {}),
    getOwnPropertyDescriptor: (_t, k) => {
      const s = read();
      // (A getter, not the value: listing keys reads none of them.)
      return s && k in s ? { enumerable: true, configurable: true, get: () => read()?.[k] } : undefined;
    },
  });
  return proxy;
}

/** An Errored fallback for `err`: a function is called with the error and reset (one that declares no parameters cannot
 * see the error: development tells it on the console). */
export function erroredFallback(f: any, err: () => unknown, reset: () => void) {
  if (typeof f !== "function") return f;
  if (process.env.NODE_ENV !== "production" && f.length === 0) console.error(untrack(err));
  return f(err, reset);
}

export { For, Repeat, Show, Switch, Match, Errored, Loading, Reveal, NoHydration, Hydration, createComponent, lazy };
