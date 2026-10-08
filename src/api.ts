// Everything `react` exports by name.
export * from "./element.ts";
export * from "./hooks.ts";
export { Component, PureComponent, startTransition, version } from "./core.ts";
export const unstable_batchedUpdates = (fn: () => any) => fn();
export const act = async (fn: () => any) => fn();
export const cache = <T extends (...a: any[]) => any>(fn: T): T => fn;
export const unstable_useCacheRefresh = () => () => {};
export const captureOwnerStack = () => null;
// What some libraries look for on React itself.
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = { H: null, A: null, T: null, S: null };
