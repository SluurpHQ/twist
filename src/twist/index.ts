// Twist: Solid 2's API (signals, effects, owners, context) on Twist's own reactive core.
export * from "./signals.ts";
export { $PROXY, $TARGET, $TRACK, createOptimisticStore, createProjection, createStore, deep, isWrappable, reconcile, snapshot, storePath } from "./store.ts";
/** Solid's default equality for signals and memos. */
export const isEqual = (a: unknown, b: unknown) => a === b;
/** What a component returns, as Solid's `Element`: nodes, text, numbers, nothing, or a list of these. */
export type Element = Node | (string & {}) | number | bigint | boolean | null | undefined | Element[];
export { mapArray, merge, omit, repeat, isStatic, hasStaticKeys } from "./flow.ts";
export { For, Repeat, Show, Switch, Match, Loading, Errored, Reveal, createComponent, lazy, NoHydration, Hydration, isHydratable, $DEVCOMP } from "./control.ts";

/** Solid's diagnostics channel (findings to tools and tests).
 */
export { OBSERVE } from "./diagnostics.ts";
