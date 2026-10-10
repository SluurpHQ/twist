// Solid's API as it runs on a server: the same core, but effects are one render pass. A render effect computes and
// applies once; createEffect only computes; tracked effects and onSettled only take their ids (the client's tree has
// them, so hydration ids line up).
import { createOwner, getNextChildId, getOwner, NotReadyError, onCleanup, resetOwner, runWithOwner, settlesOf, sharedConfig, untrack } from "./signals.ts";

export * from "./index.ts";
export { NoHydration, Hydration, Loading, Errored } from "./server.ts";

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
