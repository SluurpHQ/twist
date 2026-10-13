// Twist's additions to the server layer: what its renderer needs of owners. Twist's JSX describes; a description is
// rendered after the code that made it returned, so the renderer keeps owners, id places and the render they belong
// to across the wait for what they read.
import { getOwner, materializeId, NotReadyError, onCleanup, runWithOwner, type Owner } from "./signals.js";
import type { HydrationContext } from "./shared.js";

type O = any;

/** The owner that hands out ids for `o`: itself, or the first non-transparent owner above it. */
const idOwner = (o: O): O => {
  while (o._transparent && o._parent) o = o._parent;
  return o;
};

/** How many child ids `o` (through the owner that hands them out) has given. */
export const childIdCount = (o: Owner | null): number => (o ? idOwner(o)._childCount : 0);
/** Its child-id count set back (a part rendered again takes the same ids). */
export const setChildIdCount = (o: Owner | null, n: number) => void (o && (idOwner(o)._childCount = n));

/**
 * The owner a template's element takes its key under, as Solid's takes it where the template is made: the owner that
 * made it, when the ids it hands out are below those where it is drawn (a row's, a component's memo's); else where it
 * is drawn (one made ahead, as a prop, takes its key in place, as Solid's getter would make it there).
 */
export function keyOwnerOf(made: Owner | null | undefined): Owner | null {
  const here = getOwner();
  if (!made || (made as O)._disposed || !here) return here;
  const a = idOwner(made);
  const b = idOwner(here);
  if (a === b) return here;
  for (let o = a._parent; o; o = o._parent) if (o === b) return made;
  return here;
}

/** `fn(arg)` run now in an id scope of its own (one id of the current owner taken; what it makes takes ids under it). */
export function inIdScope<A, T>(fn: (arg: A) => T, arg: A): T {
  const o = getOwner() as O;
  const at = o && idOwner(o);
  if (!at || at.id == null) return fn(arg);
  const prefix = materializeId(at)!;
  const slot = at._childCount++;
  const count = at._childCount;
  at.id = prefix;
  at._scopeSlot = slot;
  at._childCount = 0;
  try {
    return fn(arg);
  } finally {
    at.id = prefix;
    at._scopeSlot = -1;
    at._childCount = count;
  }
}

/** Where ids are taken under `o` now (a scope's id, while one runs): a run later takes them from the same place. */
export function idPlace(o: Owner | null): <T>(fn: () => T) => T {
  const at = o && idOwner(o);
  if (!at) return (fn) => fn();
  const id = at.id == null ? at.id : materializeId(at);
  return (fn) => {
    if (at.id === id && at._scopeSlot < 0) return fn();
    const was = at.id;
    const wasSlot = at._scopeSlot;
    const count = at._childCount;
    at.id = id;
    at._scopeSlot = -1;
    try {
      return fn();
    } finally {
      at.id = was;
      at._scopeSlot = wasSlot;
      at._childCount = count;
    }
  };
}

/** Whether what `o` rendered still stands: false once `o` (or an owner above it) is disposed or reset to run again. */
export function standing(o: Owner | null): () => boolean {
  if (!o) return () => true;
  let alive = true;
  runWithOwner(o, () => onCleanup(() => void (alive = false)));
  return () => alive;
}

/** What a not-ready read waits on (none for client-only content, which nothing on the server settles). */
export function settlesOf(e: NotReadyError): Promise<void> | null {
  const s = (e as any).source;
  if (!s || typeof s.then !== "function" || s.$clientHole) return null;
  return Promise.resolve(s).then(noop, noop);
}
const noop = () => {};

/** The renders under way, by root owner (Solid's registry: `callerRenderContext` reads it too). */
const RENDER_ROOTS = Symbol.for("@solidjs/web/render-roots");
const roots = ((globalThis as any)[RENDER_ROOTS] ??= new WeakMap<object, HydrationContext>()) as WeakMap<object, any>;
/** `o` filed as the root of the render `ctx` (until it is disposed). */
export function fileRenderRoot(o: Owner, ctx: any) {
  roots.set(o, ctx);
  runWithOwner(o, () => onCleanup(() => roots.delete(o)));
}
/** The render an owner was made in, found up its chain; null with none. */
export function renderContextOf(o: Owner | null): any {
  for (let x = o as O; x; x = x._parent) {
    const c = roots.get(x);
    if (c) return c;
  }
  return null;
}
