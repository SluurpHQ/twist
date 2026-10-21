// Twist's side of solid-js's components on a server: the marks Twist's JSX pass leaves, components the React bridge
// may render instead, and solid-js's control flow marked Solid-style. Twist's renderer renders what a component
// returns after it returned, so a component runs under an owner of its own (transparent: no id of its own) that what
// it returns is rendered under too.
declare const process: { env: Record<string, string | undefined> };
import { $PROXY, createComponentOwner, createMemo, getOwner, merge, runWithOwner } from "./signals.js";
import { createComponent as layerComponent } from "./component.js";
import { For, Repeat, Show, Switch, Match, Errored, Loading, Reveal } from "./flow.js";
import { NoHydration, Hydration } from "./hydration.js";
import { foreign, isTwist, ownOf, isDynamic, isChildren, builtin } from "../marks.ts";
export { TWIST, setReactHost, __twist_mark, isTwist, ownOf, setForeignComponent, __twist_d, __twist_c, __twist_k, __twist_ref, isDynamic, isChildren, markBuiltin, builtin } from "../marks.ts";
export { setDescribedNode } from "./flow.js";

/** solid-js's control flow marked Solid-style (for the React bridge: what it meets unmarked, it renders as React's). */
export function markControlFlow() {
  for (const f of [For, Repeat, Show, Switch, Match, Errored, Loading, Reveal, NoHydration, Hydration]) builtin(f);
}

/** A component's body run (Solid's API: always Solid-style), under an owner of its own named `<Name>`. */
export function createComponent<P>(Comp: (props: P) => any, props: P, name?: string) {
  return solidComponent(Comp, props, (v) => v, name);
}

/** A component rendered from JSX: a Solid-style one as createComponent, a React one by the bridge. */
export const callComponent = <P,>(type: (props: P) => any, props: P) => (foreign && !isTwist(type) ? foreign(type, props) : createComponent(type, props));

/** A component called in the current owner, with none of its own (a static dynamic: as compiled `<C />` sits). */
export function callInline<P>(type: (props: P) => any, props: P) {
  return foreign && !isTwist(type) ? foreign(type, props) : ownOf(type)(props);
}

/** A component called and what it returns rendered by `render`, both under its owner (what it renders is its own). */
export function renderComponent<P, R>(Comp: (props: P) => any, props: P, render: (v: any) => R, name?: string): R {
  if (foreign && !isTwist(Comp)) return render(foreign(Comp, props));
  return solidComponent(Comp, props, render, name);
}

function solidComponent<P, R>(Comp: (props: P) => any, props: P, render: (v: any) => R, name?: string): R {
  if (process.env.NODE_ENV !== "production" && typeof Comp !== "function")
    throw new Error(`createComponent: expected a component function but got ${Comp === null ? "null" : typeof Comp}. A JSX tag resolved to a non-function value — check the import: a missing or misnamed export resolves to undefined.`);
  const own = ownOf(Comp);
  if (!props) props = {} as P;
  // (Outside any owner: a plain call, nothing to label.)
  if (!getOwner()) return render(layerComponent(own as any, props as any, name));
  // (Labelled in development; transparent, and not a creation for the live-hole engine's stamp.)
  const o = createComponentOwner(process.env.NODE_ENV !== "production" ? `<${name || own.name || "Anonymous"}>` : (undefined as any));
  return runWithOwner(o, () => render(own(props)));
}

/** A condition in JSX (`test ? a : b`, `test && a`): its test as a memo, so a branch is made again only when it flips. */
export const __twist_memo = <T,>(fn: () => T) => createMemo(fn, { sync: true } as any);

/** `use:fn={value}` (Solid 1's directive): nothing on a server (refs are the browser's). */
export const __twist_use = (_fn: unknown, _value: unknown) => () => {};

/** Spread props' merge, given by each compiled file that has spreads (`__twist_spreads()`, which the compiler adds): an
 * app without spreads leaves `merge` and its helpers out of its bundle. */
let mergeSpreads: ((...sources: any[]) => any) | null = null;
export const __twist_spreads = () => void (mergeSpreads ??= merge);
/** Props with spreads merged in their order. */
export function mergedSpreads(sources: any[]): any {
  if (!mergeSpreads) throw new Error("spread props reached the runtime from a file Twist did not compile");
  return mergeSpreads(...sources);
}

/** A component's props: marked parts as getters, spreads (each read where used) merged in their order, children lazy. */
export function componentProps(raw: Record<string, any>): Record<string, any> {
  let sources: any[] | null = null;
  let own: Record<string, any> = {};
  let owned = false;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (k.startsWith("$spread$")) {
      sources ??= [];
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
  return mergedSpreads(sources);
}

/** A spread's object, read each time a key is read, a proxy as merge() takes one. */
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

/** An Errored fallback for `err`: a function is called with the error and reset. */
export function erroredFallback(f: any, err: () => unknown, reset: () => void) {
  return typeof f === "function" ? f(err, reset) : f;
}
