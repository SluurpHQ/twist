// Solid's API as it runs on a server: the same core, but effects are one render pass. A render effect computes and
// applies once; createEffect only computes; tracked effects and onSettled only take their ids (the client's tree has
// them, so hydration ids line up).
import { createMemo, createOwner, getNextChildId, getOwner, NotReadyError, onCleanup, peekNextChildId, resetOwner, runWithOwner, settlesOf, sharedConfig, untrack, renderContextOf } from "./signals.ts";
import { __twist_mark } from "./control.ts";
import { isNoHydration } from "./server.ts";

export * from "./index.ts";
export { NoHydration, Hydration, Loading, Errored, isHydratable } from "./server.ts";

type Opts = { defer?: boolean };

function once<T>(compute: (prev?: T) => T, apply: ((v: T, prev?: T) => void) | undefined, options?: Opts) {
  const o = createOwner();
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

/** A module's assets through the render's resolver (cached per render); applied when they are known. */
function resolveLazyAssets(ctx: any, id: string, apply: (a: Assets | null | undefined) => void): Promise<void> | undefined {
  const cache: Map<string, any> = (ctx._lazyAssets ??= new Map());
  let assets: any;
  if (cache.has(id)) assets = cache.get(id);
  else cache.set(id, (assets = ctx.resolveAssets(id)));
  if (assets && typeof assets.then === "function") {
    const boundary = ctx._currentBoundaryId;
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
      () => void cache.set(id, null),
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
    const cur = (p = fn());
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
      else if (!noHydrate && cur.mod === undefined)
        assetsPending = cur.then((mod: any) => (typeof mod?.$$moduleUrl === "string" ? resolveLazyAssets(ctx, mod.$$moduleUrl, apply) : undefined));
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
