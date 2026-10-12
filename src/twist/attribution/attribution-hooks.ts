// Ported from Solid's signals attribution engine (MIT, Ryan Carniato and contributors): same behaviour, Twist's nodes.
// The attribution engine's hook points in the core: the core calls them with true facts while an engine is installed
// (`attribution.enable()`); with none installed each site is one null check. (Solid's attribution-hooks.)
import type { ChangeOrigin } from "./attribution.ts";

export type Transition = any;
type Computed = any;
type Signal = any;
type Owner = any;

export interface AttributionHooks {
  interactionStart(ref: InteractionRef): void;
  interactionEnd(returned?: unknown): void;
  originStart(ref: NavigationRef): void;
  originEnd(): void;
  flushStart(): void;
  flushEnd(): void;
  recomputeStart(el: Computed, create: boolean): void;
  recomputeEnd(el: Computed, create: boolean, changed: boolean, optimistic: boolean, transition: boolean, held: boolean): void;
  derivedChanged(el: Computed): void;
  write(el: Signal | Computed, prev: unknown, value: unknown): void;
  refreshed(el: Computed): void;
  flightStart(el: Computed, flight: object): void;
  asyncStart(el: Computed): void;
  asyncEnd(el: Computed, prev: unknown, value: unknown, direct: boolean): void;
  effectRunStart(el: Computed): void;
  effectRunEnd(el: Computed): void;
  actionStepStart(it: object, name: string | undefined): void;
  actionStepEnd(it: object): void;
  holdStart(t: Transition): void;
  holdEnd(): void;
  transitionSettled(t: Transition): void;
  transitionMerged(target: Transition, outgoing: Transition): void;
  storeReplaced(path: string, isArray: boolean, total: number, unchanged: number, prevTotal: number, owner: Owner | null | undefined): void;
  listChurn(el: Computed, removed: unknown[], created: unknown[], newLen: number, keyed: boolean): void;
  boundaryFallback(boundary: object, tree: Computed | undefined, shown: boolean, transition?: Transition | null): void;
  optimisticReverted(el: Signal | Computed, shown: unknown, truth: unknown, how: "superseded" | "reverted"): void;
  currentOrigin(): ChangeOrigin | undefined;
}

export interface InteractionRef {
  type: string;
  target?: string;
  at?: number;
  event?: object;
}

export interface NavigationRef {
  kind: "navigation";
  name?: string;
  to?: string;
  from?: string;
  params?: Readonly<Record<string, string | undefined>>;
  at?: number;
  redirect?: number;
  initial?: boolean;
  interaction?: ChangeOrigin;
}

/** The installed engine's hooks, or null. */
export let attrHooks: AttributionHooks | null = null;

const INSTALLED = Symbol.for("@solidjs/signals/observe/attribution");

export function setAttributionHooks(hooks: AttributionHooks | null): void {
  attrHooks = hooks;
  (globalThis as { [INSTALLED]?: AttributionHooks })[INSTALLED] = hooks ?? undefined;
}
