// Solid 1's web runtime (`solid-js/web` 1.x): Twist's, with Solid 1's control flow and core over it.
import { Portal as TwistPortal, insert, portalNode } from "../web.ts";
import { builtin } from "../control.ts";
import { untrack } from "./index.ts";

export * from "../web.ts";
export { For, Index, Show, Switch, Match, Suspense, SuspenseList, ErrorBoundary, createRoot, mergeProps, createComponent, untrack, getOwner } from "./index.ts";

/** Solid 1's Portal: its content in a `<div>` (a `<g>` for SVG, a shadow root when asked) appended to `mount`; in the head, as it is. */
export const Portal = builtin(function Portal(props: { mount?: Node; useShadow?: boolean; isSVG?: boolean; ref?: (el: Element) => void; children?: any }) {
  if (untrack(() => props.mount instanceof HTMLHeadElement)) return TwistPortal({ get mount() { return props.mount; }, get children() { return props.children; } });
  const container = props.isSVG ? document.createElementNS("http://www.w3.org/2000/svg", "g") : document.createElement("div");
  const root = props.useShadow && container.attachShadow ? container.attachShadow({ mode: "open" }) : container;
  insert(root, () => props.children);
  untrack(() => props.ref)?.(container);
  return portalNode(() => props.mount || document.body, container);
});

export function renderToStringAsync(_code: () => any, _options?: unknown): Promise<string> {
  return console.error(new Error("renderToStringAsync is not supported in the browser, returning undefined")) as never;
}
