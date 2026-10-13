// Solid 1's server runtime (`solid-js/web` 1.x on a server): Twist's, with Solid 1's control flow and its async render.
import { Errored, Loading, renderToStream } from "../server.ts";
import { suspense } from "./index.ts";

export * from "../server.ts";
export { For, Index, Show, Switch, Match, SuspenseList, createRoot, mergeProps, createComponent, untrack, getOwner } from "./index.ts";

export function Suspense(props: { fallback?: any; children?: any }) {
  return suspense(Loading, props);
}

export function ErrorBoundary(props: { fallback: any; children?: any }) {
  return Errored({
    get fallback() {
      const f = props.fallback;
      return typeof f === "function" ? (err: () => unknown, reset: () => void) => f(err(), reset) : f;
    },
    get children() {
      return props.children;
    },
  });
}

/** The page once everything it waits on has loaded. */
export function renderToStringAsync(code: () => any, options?: Parameters<typeof renderToStream>[1]): Promise<string> {
  return new Promise((ok, fail) => renderToStream(code, options).then(ok, fail));
}
