// Hydration's bookkeeping, as Solid's client/hydration.ts keeps it: when hydration is done, boundary holds, the claim
// window, and the ledger of streamed fragments (`_$HY.fr`).
import { flush, getOwner, isDisposed, isFlushing, onCleanup, sharedConfig, type Owner } from "./signals.ts";

type Scope = { registry?: Map<string, object>; gather?: (key: string) => void };

let pendingBoundaries = 0;
let hydrationDone = false;
let endCallbacks: (() => void)[] | null = null;
let hydratingValue = false;
let claimOwner: Owner | null = null;
let installed = false;

/** Whether a hydration pass is still claiming server-rendered DOM. */
function isHydrationInProgress(): boolean {
  return !hydrationDone && (hydratingValue || pendingBoundaries > 0);
}

/** Whether the code running now claims server-rendered DOM (under the claim owner, when a window set one). */
function isClaiming(): boolean {
  if (!claimOwner) return true;
  for (let o: any = getOwner(); o; o = o.parent) if (o === claimOwner) return true;
  return false;
}

/** `callback` once every root and boundary has hydrated (in a microtask when that is already so). */
function onHydrationEnd(callback: () => void) {
  if (hydrationDone || (!hydratingValue && pendingBoundaries === 0)) return void queueMicrotask(callback);
  (endCallbacks ??= []).push(callback);
}

function drain() {
  if (hydrationDone) return;
  hydrationDone = true;
  // (Ended inside a flush: that flush carries on with what is left.)
  if (!isFlushing()) flush();
  const cbs = endCallbacks;
  endCallbacks = null;
  if (cbs) for (const cb of cbs) cb();
  setTimeout(() => {
    if ((globalThis as any)._$HY) (globalThis as any)._$HY.done = true;
    (sharedConfig as any).registry?.clear();
  });
}

/** Done when no root pass runs and no boundary waits. */
export function checkHydrationComplete() {
  if (!hydratingValue && pendingBoundaries === 0) drain();
}

/** A boundary waiting on the server (fragment `id`), held until its release; disposal releases it. */
export function initBoundaryResume(o: Owner, id: string): () => boolean {
  pendingBoundaries++;
  (o as any)._hp = 1;
  (sharedConfig as any).captureBoundaryScope?.(id);
  claimFragment(id);
  let released = false;
  const release = () => {
    if (released) return false;
    released = true;
    pendingBoundaries--;
    (o as any)._hp = 0;
    (sharedConfig as any).boundaryScopes?.delete(id);
    const f = fragments.get(id);
    if (f) f.claimed = false;
    return true;
  };
  onCleanup(() => {
    if (!isDisposed(o)) return;
    (sharedConfig as any).cleanupFragment?.(id);
    if (release()) checkHydrationComplete();
  });
  return release;
}

/** `fn` claiming server-rendered DOM under `o`: the keys under `id` gathered, `scope`'s registry for its span. */
function hydrateWindow<T>(id: string | undefined, fn: () => T, scope?: Scope, o: Owner | null = getOwner()): T {
  const prevRegistry = (sharedConfig as any).registry;
  const prevGather = (sharedConfig as any).gather;
  const prevHydrating = hydratingValue;
  const prevClaim = claimOwner;
  if (scope) {
    (sharedConfig as any).registry = scope.registry;
    (sharedConfig as any).gather = scope.gather;
  }
  try {
    if (id) (sharedConfig as any).gather?.(id);
    hydratingValue = true;
    claimOwner = o;
    return fn();
  } finally {
    hydratingValue = prevHydrating;
    claimOwner = prevClaim;
    if (scope) {
      (sharedConfig as any).registry = prevRegistry;
      (sharedConfig as any).gather = prevGather;
    }
  }
}

// ---------------------------------------------------------------- the fragment ledger

const fragments = new Map<string, { claimed?: boolean; held?: boolean }>();
const truncated = new Set<string>();
const revealSubs = new Set<(id: string, parent?: ParentNode) => void>();

function fragmentState(id: string) {
  let f = fragments.get(id);
  if (!f) fragments.set(id, (f = {}));
  return f;
}

/** `$df(id)`: swaps while hydrating, or when a claimant or an owning range is on record; else held. */
function fragmentPolicy(id: string) {
  const f = fragmentState(id);
  if (!hydrationDone || f.claimed || ownedFragment(id)) return (globalThis as any).$dfr(id);
  f.held = true;
  return 0;
}

function ownedFragment(id: string) {
  const hy = (globalThis as any)._$HY;
  const pl = document.getElementById("pl-" + id);
  return !!(pl && hy.fa && hy.fa(pl));
}

function claimFragment(id: string) {
  const f = fragmentState(id);
  f.claimed = true;
  if (f.held) {
    f.held = false;
    (globalThis as any).$dfr(id);
  }
}

/** Whether fragment `id` may still arrive: declared and unsettled, or settled with its swap parked. */
function fragmentPending(hy: any, id: string): boolean {
  if (truncated.has(id) || hy.v?.[id]) return false;
  const ref = hy.r[id + "_fr"];
  if (!ref || typeof ref !== "object") return false;
  return !ref.s || fragmentParked(id);
}

function fragmentParked(id: string): boolean {
  const hy = (globalThis as any)._$HY;
  if (hy?.v?.[id]) return false;
  return !!document.getElementById(id) && !!document.getElementById("pl-" + id);
}

function anyFragmentPending(): boolean {
  const hy = (globalThis as any)._$HY;
  if (!hy?.r) return false;
  for (const key in hy.r) if (key.length > 3 && key.endsWith("_fr") && fragmentPending(hy, key.slice(0, -3))) return true;
  return false;
}

function subscribeFragments(cb: (id: string, parent?: ParentNode) => void): () => void {
  revealSubs.add(cb);
  return () => revealSubs.delete(cb);
}

/** A stream cut short: declarations still unsettled at DOMContentLoaded never arrive. */
function watchTruncation(hy: any) {
  if (typeof document === "undefined" || document.readyState !== "loading") return;
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      for (const key in hy.r ?? {}) {
        if (key.length <= 3 || !key.endsWith("_fr")) continue;
        const ref = hy.r[key];
        if (ref && typeof ref === "object" && !ref.s) truncated.add(key.slice(0, -3));
      }
    },
    { once: true },
  );
}

/** Hydration's hooks on `sharedConfig`, and the ledger on `_$HY`. */
export function enableHydration() {
  const hy = (globalThis as any)._$HY;
  if (hy && !hy.fr) {
    if (!hy.f) hy.f = fragmentPolicy;
    hy.fr = { pending: anyFragmentPending, subscribe: subscribeFragments };
    const prevFe = hy.fe;
    hy.fe = (id: string, parent?: ParentNode) => {
      prevFe?.(id, parent);
      for (const sub of revealSubs) sub(id, parent);
    };
    watchTruncation(hy);
  }
  if (installed) return;
  installed = true;
  (sharedConfig as any).isHydrationInProgress = isHydrationInProgress;
  (sharedConfig as any).onHydrationEnd = onHydrationEnd;
  (sharedConfig as any).isClaiming = isClaiming;
  (sharedConfig as any).holdBoundary = (id: string) => {
    const release = initBoundaryResume(getOwner()!, id);
    return () => release() && checkHydrationComplete();
  };
  (sharedConfig as any).hydrateWindow = hydrateWindow;
  hydratingValue = sharedConfig.hydrating;
  Object.defineProperty(sharedConfig, "hydrating", {
    get: () => hydratingValue,
    set(v: boolean) {
      const was = hydratingValue;
      hydratingValue = v;
      if (!was && v) hydrationDone = false;
      else if (was && !v) checkHydrationComplete();
    },
    configurable: true,
    enumerable: true,
  });
}
