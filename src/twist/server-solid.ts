// Solid's API as it runs on a server: the same core, but effects are one render pass. A render effect computes and
// applies once; createEffect only computes; tracked effects and onSettled only take their ids (the client's tree has
// them, so hydration ids line up). Plain state is plain: a signal or a store written applies at once, optimistic
// writes do not land (the page shows settled state), actions are their functions.
declare const process: { env: Record<string, string | undefined> };
import { createSignal as coreSignal, createStore as coreStore, isWrappable } from "./index.ts";
import { createMemo, createOwner, getNextChildId, getOwner, NotReadyError, onCleanup, peekNextChildId, resetOwner, runWithOwner, settlesOf, sharedConfig, untrack, renderContextOf } from "./signals.ts";
import { __twist_mark } from "./control.ts";
import { isNoHydration } from "./server.ts";
import { devCheck, errorText } from "./request.ts";
import { OBSERVE } from "./diagnostics.ts";
import { serverSlots } from "./trace.ts";
import "./store-trail.ts";

// The process-wide trace-provider slot, there as soon as the server API loads (an observer installs before any render).
if (OBSERVE) OBSERVE.server = serverSlots();

export * from "./index.ts";
export { NoHydration, Hydration, Loading, Errored, Reveal, isHydratable } from "./server.ts";
// The browser's observe and dev surfaces, the same objects (one diagnostics channel).
export { DEV } from "./core/index.ts";
export { OBSERVE };
export { inServerComponentScope, inLiveServerComponentScope, ssrSanitizeError } from "./server-internal.ts";
export { reportServerError } from "./request.ts";
// The client's store-hydration seams, inert here (nothing delivers a trace to a server), as Solid's server entry has them.
export function withStoreHydration<T>(coreFn: (fn: any, seed: any, options?: any) => T, fn: any, seed: any, options?: any): T {
  return coreFn(fn, seed, options);
}
export function applyPatches(_target: any, _patches: any[]): void {}
export function forwardIteratorReturn(it: any, value?: any): any {
  return Promise.resolve(it.return ? it.return(value) : { done: true, value });
}

type Opts = { defer?: boolean; ssrSource?: string };

function once<T>(compute: (prev?: T) => T, apply: ((v: T, prev?: T) => void) | undefined, options?: Opts) {
  const o = createOwner();
  // (The client's alone: neither computed nor applied here.)
  if (options?.ssrSource === "client") return;
  let disposed = false;
  if (apply) onCleanup(() => (disposed = true));
  try {
    const v = runWithOwner(o, () => compute(undefined));
    if (apply && !options?.defer) untrack(() => apply(v, undefined));
  } catch (e) {
    if (!(e instanceof NotReadyError)) throw e;
    // A render effect waiting in a stream holds the shell and applies once its value settles (createEffect does not).
    const ctx = sharedConfig.context as any;
    const waits = settlesOf(e);
    if (!apply || !ctx?.async || !waits) return;
    const retry = () => {
      if (disposed) return;
      try {
        resetOwner(o);
        const v = runWithOwner(o, () => compute(undefined));
        if (!options?.defer) untrack(() => apply(v, undefined));
      } catch (e2) {
        const next = e2 instanceof NotReadyError && settlesOf(e2);
        if (next) return void ctx.block(next.then(retry, () => {}));
        throw e2;
      }
    };
    ctx.block(waits.then(retry, () => {}));
  }
}

const applyOf = (a: any) => (typeof a === "function" ? a : a?.effect);

// ---------------------------------------------------------------- lazy (ported from Solid's server component.ts, MIT)

type Assets = { js: string[]; css: any[]; preloads?: any[] };

/** A lazy component whose client assets cannot be known: its module loads late on the client (dev only). */
function lazyAssetUnmapped(id?: string, error?: unknown, subject?: unknown) {
  if (process.env.NODE_ENV === "production") return;
  devCheck(
    {
      code: "LAZY_ASSET_UNMAPPED",
      kind: "ssr",
      severity: "warn",
      message:
        id !== undefined
          ? `[LAZY_ASSET_UNMAPPED] lazy() asset resolution failed for "${id}": ${errorText(error)}`
          : "[LAZY_ASSET_UNMAPPED] lazy() used in SSR without a moduleUrl and the loaded module has no $$moduleUrl export, so its client assets cannot be resolved — the component will load late during hydration. This is typically injected by the bundler plugin.",
      data: id !== undefined ? { reason: "resolution-failed", id, error } : { reason: "no-module-url" },
    },
    subject,
  );
}

/** A module's assets through the render's resolver (cached per render); applied when they are known. */
function resolveLazyAssets(ctx: any, id: string, apply: (a: Assets | null | undefined) => void): Promise<void> | undefined {
  const cache: Map<string, any> = (ctx._lazyAssets ??= new Map());
  let assets: any;
  if (cache.has(id)) assets = cache.get(id);
  else cache.set(id, (assets = ctx.resolveAssets(id)));
  if (assets && typeof assets.then === "function") {
    const boundary = ctx._currentBoundaryId;
    const owner = getOwner();
    return assets.then(
      (resolved: Assets | null) => {
        cache.set(id, resolved ?? null);
        const current = ctx._currentBoundaryId;
        ctx._currentBoundaryId = boundary;
        try {
          apply(resolved);
        } finally {
          ctx._currentBoundaryId = current;
        }
      },
      (err: unknown) => {
        cache.set(id, null);
        lazyAssetUnmapped(id, err, owner);
      },
    );
  }
  apply(assets);
}

/** What a lazy module's assets put in the head: its css, its preloads, its modules (none of them under NoHydration). */
function hintAssets(ctx: any, assets: Assets | null | undefined, noHydrate: boolean) {
  if (!assets) return;
  for (const css of assets.css) ctx.registerAsset(typeof css === "string" ? "style" : "inline-style", css);
  if (assets.preloads)
    for (const p of assets.preloads) if (!noHydrate || typeof p?.as !== "string" || p.as.toLowerCase() !== "script") ctx.registerAsset("preload", p);
  if (!noHydrate) for (const js of assets.js) ctx.registerAsset("module", js);
}

/** A component whose module loads on the server, its client assets registered for the page (see Solid's lazy). */
export function lazy<P>(fn: () => Promise<any>, options?: { export?: string }, moduleUrl?: string) {
  const exportName = options?.export;
  let p: any;
  const load = () => {
    if (p) return p;
    const cur: Promise<any> & { mod?: any; v?: any; error?: unknown; errored?: boolean } = (p = fn());
    cur.then(
      (mod: any) => ((cur.mod = mod), (cur.v = exportName ? mod[exportName] : mod.default)),
      (err: unknown) => ((cur.error = err), (cur.errored = true), p === cur && (p = undefined)),
    );
    return cur;
  };
  const wrap: any = (props: P) => {
    const noHydrate = isNoHydration();
    const ctx = sharedConfig.context as any;
    if (!noHydrate && !ctx?.resolveAssets)
      throw new Error(
        `lazy() called${moduleUrl ? ` with moduleUrl "${moduleUrl}"` : ""} but no asset manifest is set. Pass a manifest option to renderToStream/renderToString.`,
      );
    const cur = load();
    let assetsPending: Promise<void> | undefined;
    if (ctx?.registerAsset && ctx.resolveAssets) {
      const o = getOwner() as any;
      const hydrationKey = !noHydrate && o?.id != null ? peekNextChildId(o) : undefined;
      const apply = (assets: Assets | null | undefined) => {
        if (!assets) return;
        hintAssets(ctx, assets, noHydrate);
        if (!noHydrate && hydrationKey != null) ctx.registerModule?.(hydrationKey, assets.js[0]);
      };
      const id = moduleUrl ?? (typeof cur.mod?.$$moduleUrl === "string" ? cur.mod.$$moduleUrl : undefined);
      if (id) assetsPending = resolveLazyAssets(ctx, id, apply);
      else if (!noHydrate && cur.mod !== undefined) lazyAssetUnmapped();
      else if (!noHydrate)
        assetsPending = cur.then((mod: any) => (typeof mod?.$$moduleUrl === "string" ? resolveLazyAssets(ctx, mod.$$moduleUrl, apply) : lazyAssetUnmapped(undefined, undefined, o)));
      if (assetsPending) {
        const clear = () => void (assetsPending = undefined);
        assetsPending = assetsPending.then(clear, clear);
      }
    }
    if (ctx?.async && ((cur.v === undefined && !cur.errored) || assetsPending))
      ctx.block((assetsPending ? cur.then(() => assetsPending) : cur).then(noopFn, noopFn));
    return createMemo(() => {
      if (cur.errored) throw cur.error;
      if (!cur.v) throw new NotReadyError(cur);
      if (assetsPending) throw new NotReadyError(assetsPending);
      return cur.v(props);
    });
  };
  wrap.preload = () => {
    const cur = load();
    // (The render of the owner it runs under: none without one.)
    const ctx = renderContextOf(getOwner());
    if (!ctx?.resolveAssets || !ctx.registerAsset) return cur;
    const noHydrate = isNoHydration();
    const hint = (id: string) => resolveLazyAssets(ctx, id, (a) => hintAssets(ctx, a, noHydrate));
    if (moduleUrl) hint(moduleUrl);
    else if (typeof cur.mod?.$$moduleUrl === "string") hint(cur.mod.$$moduleUrl);
    else cur.then((mod: any) => typeof mod?.$$moduleUrl === "string" && hint(mod.$$moduleUrl), noopFn);
    return cur;
  };
  const marked: any = __twist_mark(wrap);
  marked.preload = wrap.preload;
  // Its module's client URL in the render of the owner it is read under (that render hinted to load it), else as given.
  Object.defineProperty(marked, "moduleUrl", {
    enumerable: true,
    get() {
      const ctx = renderContextOf(getOwner());
      if (!moduleUrl || !ctx?.resolveAssets || !ctx.registerAsset) return moduleUrl;
      let url: string | undefined;
      resolveLazyAssets(ctx, moduleUrl, (a) => {
        hintAssets(ctx, a, isNoHydration());
        url = a?.js?.[0];
      });
      return url ?? moduleUrl;
    },
  });
  return marked as ((props: P) => any) & { preload: () => Promise<any>; moduleUrl?: string };
}
const noopFn = () => {};

export function createRenderEffect<T>(compute: (prev?: T) => T, apply?: any, options?: Opts) {
  once(compute, applyOf(apply), options);
}

export function createEffect<T>(compute: (prev?: T) => T, _apply?: any, options?: Opts) {
  once(compute, undefined, options);
}

const takeId = () => {
  const o = getOwner();
  if (o && (o as any).id != null) getNextChildId(o);
};

export function createTrackedEffect(_fn: () => void | (() => void)) {
  takeId();
}

export function onSettled(_fn: () => void | (() => void)) {
  takeId();
}

const SERVER_WRITE = {
  signal:
    "Writing a signal on the server is deprecated and will become an error. Server render is pure: state changes flow from async sources (promises, async iterables), never setters — this write landed as inert data (nothing re-renders). If you are bridging a subscription, make it the async source itself instead of pushing writes from its callback.",
  store:
    "Writing a store on the server is deprecated and will become an error. Server render is pure: state changes flow from async sources (promises, async iterables), never setters — this write landed as inert data (nothing re-renders). Derive the store from its source (createStore(fn, seed)) instead of writing into it.",
  optimistic:
    "Optimistic writes are inert on the server and will become an error. Optimistic state reverts once the async work it accompanies settles, and server output is settled state — optimistic updates only have meaning on the client.",
};
const warnedWrites = new Set<string>();
/** A write on the server: said once per kind (dev only). */
function serverWrite(category: keyof typeof SERVER_WRITE) {
  if (process.env.NODE_ENV === "production" || warnedWrites.has(category)) return;
  warnedWrites.add(category);
  devCheck({ code: "SERVER_WRITE", kind: "write", severity: "warn", message: `[SERVER_WRITE] ${SERVER_WRITE[category]}`, data: { category } });
}

export function createSignal<T>(first?: T | ((prev?: T) => T), options?: any): [() => T, (v: T | ((prev: T) => T)) => T] {
  // (Derived: the core's memo, which the page serializes; nothing writes it here.)
  if (typeof first === "function") return [(coreSignal as any)(first, options)[0], () => (serverWrite("signal"), undefined as any)];
  let value = first as T;
  return [() => value, (v) => (serverWrite("signal"), (value = typeof v === "function" ? (v as (prev: T) => T)(value) : v))];
}

export function createOptimistic<T>(first?: T | ((prev?: T) => T), options?: any): [() => T, (v: any) => T] {
  const [read] = createSignal(first, options);
  return [read, () => (serverWrite("optimistic"), untrack(read))];
}

/** A setter of plain state: the draft is the state; a wrappable it returns replaces it. */
const storeSetter = (state: any) => (fn: (draft: any) => any) => {
  serverWrite("store");
  const next = fn(state);
  if (next !== undefined && next !== state && isWrappable(next)) replaceState(state, next);
};
function replaceState(target: any, next: any) {
  if (Array.isArray(target) && Array.isArray(next)) {
    for (let i = 0; i < next.length; i++) target[i] = next[i];
    target.length = next.length;
    return;
  }
  for (const key of Object.keys(target)) if (!(key in next)) delete target[key];
  Object.assign(target, next);
}

export function createStore(first: any, ...rest: any[]): [any, (fn: (draft: any) => any) => void] {
  if (typeof first !== "function") return [first, storeSetter(first)];
  const [state, set] = (coreStore as any)(first, ...rest);
  return [state, (fn) => (serverWrite("store"), set(fn))];
}

export function createOptimisticStore(first: any, ...rest: any[]): [any, (fn: (draft: any) => any) => void] {
  return [createStore(first, ...rest)[0], () => serverWrite("optimistic")];
}

/** Plain state brought to `value`: its keys set, the ones it lacks removed. */
export function reconcile(value: any) {
  return (state: any) => {
    if (!isWrappable(state) || !isWrappable(value)) return value;
    for (const key of Object.keys(value)) if (state[key] !== value[key]) value[key] === undefined ? delete state[key] : (state[key] = value[key]);
    for (const key of Object.keys(state)) if (value[key] === undefined) delete state[key];
    return state;
  };
}

/** Whether `fn` reads something pending: on a server a pending read is not an answer, it waits (thrown on). */
export function isPending(fn: () => unknown) {
  try {
    untrack(fn);
    return false;
  } catch (e) {
    if (e instanceof NotReadyError) throw e;
    return false;
  }
}

export const action = <F>(fn: F) => fn;

/** An id unique on this page: its owner's next child id (what hydration takes again on the client). */
export function createUniqueId(): string {
  const o = getOwner();
  if (!o) throw new Error("createUniqueId cannot be used outside of a reactive context");
  return getNextChildId(o);
}
