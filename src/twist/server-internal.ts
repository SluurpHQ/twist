// What Solid's frames server and integrations read from "solid-js/internal": the server layer's seams. A server
// component's scope renders what it returns there, as Solid's eager templates are made where they are called.
import { runInServerComponentScope as layerScope } from "./server/signals.ts";
import { html } from "./server.ts";

export {
  creationStamp,
  inServerComponentScope,
  inLiveServerComponentScope,
  shareAsyncIterable,
  getProjectionTrace,
  ssrSanitizeError,
  reportServerError,
  NoHydrateContext,
} from "./server/signals.ts";
export { sharedConfig } from "./server/shared.ts";
export { ssrHandleError } from "./server/hydration.ts";

/**
 * `fn` under a server component's barrier: app context does not reach it (as on every later response, rendered
 * standalone), boundary plumbing does. Transparent, so hydration ids are untouched.
 */
export function runInServerComponentScope<T>(fn: () => T, options?: { live?: boolean }): T {
  return layerScope(() => ({ t: html(fn(), false) }), options) as T;
}
