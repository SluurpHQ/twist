// Solid's API as it runs on a server: the same core, but effects are one render pass. A render effect computes and
// applies once; createEffect only computes; tracked effects and onSettled only take their ids (the client's tree has
// them, so hydration ids line up).
import { createOwner, getNextChildId, getOwner, NotReadyError, runWithOwner, untrack } from "./signals.ts";

export * from "./index.ts";
export { NoHydration, Hydration, Loading, Errored } from "./server.ts";

type Opts = { defer?: boolean };

function once<T>(compute: (prev?: T) => T, apply: ((v: T, prev?: T) => void) | undefined, options?: Opts) {
  const o = createOwner();
  try {
    const v = runWithOwner(o, () => compute(undefined));
    if (apply && !options?.defer) untrack(() => apply(v, undefined));
  } catch (e) {
    // Not ready on the server: nothing to apply (the client runs it after hydration).
    if (!(e instanceof NotReadyError)) throw e;
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
