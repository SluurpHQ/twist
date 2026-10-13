// Solid 1's server runtime (`solid-js/web` 1.x on a server): Twist's, with Solid 1's control flow and its async render.
import { renderToStream } from "../server.ts";

export * from "../server.ts";
export { For, Index, Show, Switch, Match, Suspense, SuspenseList, ErrorBoundary, createRoot, mergeProps, createComponent, untrack, getOwner } from "./index.server.ts";

/** The page once everything it waits on has loaded. */
export function renderToStringAsync(code: () => any, options?: Parameters<typeof renderToStream>[1]): Promise<string> {
  return new Promise((ok, fail) => renderToStream(code, options).then(ok, fail));
}
