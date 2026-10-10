// A projection across the frame border as Solid's container tier carries it: on the server, its trace (a snapshot once
// it is ready, then a patch batch per change, until its source ends); on the client, a projection materialized from
// one (ported from Solid's client/container-trace.ts, MIT, Ryan Carniato and contributors).
import { createRoot, createSignal, getOwner, NotReadyError, runWithOwner, settlesOf, sharedConfig } from "./signals.ts";
import { createProjection } from "./store.ts";

export type PatchOp = [path: PropertyKey[]] | [path: PropertyKey[], value: any] | [path: PropertyKey[], value: any, insert: 1];
export type ProjectionTrace = { subscribe(): AsyncIterable<any>; array: boolean };

const traces = new WeakMap<object, ProjectionTrace>();
/** A projection's trace (registered on the server), or undefined. */
export const getProjectionTrace = (value: unknown): ProjectionTrace | undefined =>
  typeof value === "object" && value !== null ? traces.get(value) : undefined;

const clone = (v: any) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** The patch ops that turn `a` into `b` (sets and deletes by path; an array's length set last). */
export function diffPatches(a: any, b: any, path: PropertyKey[] = [], out: PatchOp[] = []): PatchOp[] {
  if (a === b) return out;
  const plain = (v: any) => v !== null && typeof v === "object";
  if (!plain(a) || !plain(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push([path, b]);
    return out;
  }
  if (Array.isArray(a)) {
    for (let i = 0; i < b.length; i++) i < a.length ? diffPatches(a[i], b[i], [...path, i], out) : out.push([[...path, i], b[i]]);
    if (a.length !== b.length) out.push([[...path, "length"], b.length]);
    return out;
  }
  for (const k of Object.keys(a)) if (!(k in b)) out.push([[...path, k]]);
  for (const k of Object.keys(b)) (k in a ? diffPatches(a[k], b[k], [...path, k], out) : out.push([[...path, k], b[k]]));
  return out;
}

/**
 * Registers `proxy`'s trace. `ready` brings it up to date (throwing not-ready while it waits), `changed` resolves at its
 * next change, `ended` says whether its source can still change it.
 */
export function registerProjectionTrace(proxy: object, target: object, ready: () => void, changed: () => Promise<void>, ended: () => boolean) {
  traces.set(proxy, {
    array: Array.isArray(target),
    async *subscribe() {
      for (;;) {
        try {
          ready();
          break;
        } catch (e) {
          if (!(e instanceof NotReadyError)) throw e;
          await (settlesOf(e) ?? Promise.resolve());
        }
      }
      let last = clone(target);
      yield last;
      while (!ended()) {
        await changed();
        const now = clone(target);
        const ops = diffPatches(last, now);
        last = now;
        if (ops.length) yield ops;
      }
    },
  });
}

/** Patch ops applied to a draft (a delete, an insert, or a set). */
export function applyPatches(target: any, patches: PatchOp[]) {
  for (const patch of patches) {
    const path = patch[0];
    let current = target;
    for (let i = 0; i < path.length - 1; i++) current = current[path[i] as any];
    const key = path[path.length - 1] as any;
    if (patch.length === 1) Array.isArray(current) ? current.splice(key, 1) : delete current[key];
    else if (patch.length === 3) current.splice(key, 0, patch[1]);
    else current[key] = patch[1];
  }
}

const forwardIteratorReturn = (it: any, value?: any) => Promise.resolve(it.return ? it.return(value) : { done: true, value });
const detachedRoot = <T>(init: () => T): T => runWithOwner(null, () => createRoot(init))!;
function afterHydration(callback: () => void) {
  const onHydrationEnd = (sharedConfig as any).onHydrationEnd;
  onHydrationEnd ? onHydrationEnd(callback) : queueMicrotask(callback);
}

const seedInto = (draft: any, value: any) => {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) draft[i] = value[i];
    draft.length = value.length;
  } else Object.assign(draft, value);
};

/** The projection a trace marker decodes to: its snapshot, then each patch batch as it arrives. */
export function materializeContainerTrace(marker: { $tr: any; $ta?: number }, claiming?: boolean): any {
  const src = marker.$tr;
  if (src != null && src.__SEROVAL_STREAM__ === true) {
    const queue: any[] = [];
    let failed: { error: any } | undefined;
    let cursor = 0;
    let first = true;
    let limit = Infinity;
    return detachedRoot(() => {
      const [version, setVersion] = createSignal(0, { ownedWrite: true });
      let live = false;
      const bump = () => live && setVersion((n) => n + 1);
      src.on({
        next(value: any) {
          queue.push(value);
          bump();
        },
        return() {},
        throw(error: any) {
          failed = { error };
          bump();
        },
      });
      live = true;
      // Hydrating: the snapshot the server rendered with, the rest once hydration is over.
      if (claiming && queue.length > 1) {
        limit = 1;
        afterHydration(() => {
          limit = Infinity;
          bump();
        });
      }
      return createProjection((draft: any) => {
        version();
        while (cursor < queue.length && cursor < limit) {
          const value = queue[cursor++];
          if (first) (first = false), seedInto(draft, value);
          else applyPatches(draft, value);
        }
        if (failed && cursor === queue.length) throw failed.error;
        if (first) throw new NotReadyError(getOwner() as any);
      }, (marker.$ta ? [] : {}) as any);
    });
  }
  return detachedRoot(() =>
    createProjection(
      (draft: any) =>
        ({
          [Symbol.asyncIterator]() {
            const srcIt = src[Symbol.asyncIterator]();
            let first = true;
            return {
              next: () =>
                Promise.resolve(srcIt.next()).then((res: any) => {
                  if (res.done) return { done: true as const, value: undefined };
                  if (first) (first = false), seedInto(draft, res.value);
                  else applyPatches(draft, res.value);
                  return { done: false as const, value: undefined };
                }),
              return: (value?: any) => forwardIteratorReturn(srcIt, value),
            };
          },
        }) as any,
      (marker.$ta ? [] : {}) as any,
    ),
  );
}
