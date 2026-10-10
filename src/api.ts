// Everything `react` exports by name.
export * from "./element.ts";
export * from "./hooks.ts";
export { Component, PureComponent, startTransition, version } from "./core.ts";
export const unstable_batchedUpdates = (fn: () => any) => fn();
export { act } from "./core.ts";
export const cache = <T extends (...a: any[]) => any>(fn: T): T => fn;
export const unstable_useCacheRefresh = () => () => {};
/** The signal that aborts when the current cache() scope ends: only server components have one, so none here. */
export const cacheSignal = (): AbortSignal | null => null;
export { captureOwnerStack } from "./core.ts";
// What some libraries look for on React itself.
// H: the hooks dispatcher (some code calls H.readContext or H.useState directly), always these hooks.
import * as hooks from "./hooks.ts";
const dispatcher = { ...hooks };
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = { H: dispatcher, A: null, T: null, S: null };
