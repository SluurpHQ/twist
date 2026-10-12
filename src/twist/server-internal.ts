// What Solid's frames server reads from "solid-js/internal", from Twist: the server-component scope, the creation
// stamp, shared async iterables, and the SSR error hook.
import { createOwner, creationStamp, getOwner, NotReadyError, runWithOwner, settlesOf, sharedConfig, type Owner } from "./signals.ts";

export { creationStamp, sharedConfig };
export { ssrSanitizeError } from "./request.ts";
import { html } from "./server.ts";

// (Registered: the core reads them too, to decide how a source is read in a server component.)
const SERVER_COMPONENT = Symbol.for("twist.ssr.server-component");
const LIVE_SERVER_COMPONENT = Symbol.for("twist.ssr.live-server-component");
/** The context keys that cross a server component's barrier (reveal order coordination). */
const crossing: symbol[] = [Symbol.for("twist.ssr.no-hydrate")];
export const crossesBarrier = (key: symbol) => void crossing.push(key);

/**
 * `fn` under a server component's barrier: app context does not reach it (as on every later response, rendered
 * standalone), boundary plumbing does. Transparent, so hydration ids are untouched.
 */
export function runInServerComponentScope<T>(fn: () => T, options?: { live?: boolean }): T {
  const o = createOwner({ transparent: true });
  const inherited = o.context ?? {};
  const scoped: Record<symbol, unknown> = { [SERVER_COMPONENT]: true };
  if (options?.live || inherited[LIVE_SERVER_COMPONENT] === true) scoped[LIVE_SERVER_COMPONENT] = true;
  for (const key of Object.getOwnPropertySymbols(inherited)) if (crossing.includes(key)) scoped[key] = inherited[key];
  o.context = scoped;
  // Rendered here, as Solid's eager templates are: under the scope and the render context it was called in.
  return runWithOwner(o, () => ({ t: html(fn(), false) })) as T;
}

/** Whether `o` is inside a server component's render scope. */
export const inServerComponentScope = (o: Owner | null = getOwner()) => !!o?.context?.[SERVER_COMPONENT];
/** Whether `o` is inside a live server component's document render. */
export const inLiveServerComponentScope = (o: Owner | null = getOwner()) => !!o?.context?.[LIVE_SERVER_COMPONENT];

/** A pending read's promise (for the renderer to wait on); any other error goes to the nearest boundary, else thrown. */
export function ssrHandleError(err: any, probe?: boolean): Promise<any> | undefined {
  if (err instanceof NotReadyError) return settlesOf(err) ?? undefined;
  if (probe) return;
  for (let o: any = getOwner(); o; o = o.parent) if (o.catch && o.catch(err)) return;
  throw err;
}

export { getProjectionTrace } from "./container-trace.ts";

// ---------------------------------------------------------------- shared async iterables

const sharedSources = new WeakMap<object, { open(): AsyncIterator<any> }>();
const sharedChannels = new WeakSet<object>();
const LIVE_SOURCE = Symbol.for("solid.LiveSource");

function closeAsyncIterator(it: AsyncIterator<any>) {
  try {
    const r = it.return?.();
    if (r && typeof (r as any).then === "function") (r as Promise<unknown>).then(undefined, () => {});
  } catch {}
}

/** One source read by many: each seat sees the whole sequence from where it joined; the last seat out closes it. */
function createSharedSource(source: AsyncIterable<any>) {
  const log: any[] = [];
  let base = 0;
  let done = false;
  let failure: { error: any } | undefined;
  let iter: AsyncIterator<any> | undefined;
  let step: Promise<void> | undefined;
  const cursors = new Set<{ i: number }>();
  const settle = (r?: IteratorResult<any>, error?: { error: any }) => {
    step = undefined;
    if (done) return;
    if (error) (failure = error), (done = true);
    else if (r!.done) done = true;
    else log.push(r!.value);
  };
  const pull = () => {
    if (!step) {
      try {
        iter ??= source[Symbol.asyncIterator]();
        step = Promise.resolve(iter.next()).then(
          (r) => settle(r),
          (error) => settle(undefined, { error }),
        );
      } catch (error) {
        settle(undefined, { error });
        return Promise.resolve();
      }
    }
    return step;
  };
  const trim = () => {
    let min = Infinity;
    for (const c of cursors) if (c.i < min) min = c.i;
    if (min !== Infinity && min > base) log.splice(0, min - base), (base = min);
  };
  return {
    open(): AsyncIterator<any> {
      const cursor = { i: base };
      let finished = false;
      cursors.add(cursor);
      const leave = () => {
        if (finished) return;
        finished = true;
        cursors.delete(cursor);
        if (cursors.size) return trim();
        if (!done) (done = true), iter && closeAsyncIterator(iter);
      };
      const next = (): Promise<IteratorResult<any>> => {
        if (finished) return Promise.resolve({ done: true, value: undefined });
        if (cursor.i - base < log.length) {
          const value = log[cursor.i - base];
          cursor.i++;
          trim();
          return Promise.resolve({ done: false, value });
        }
        if (done) {
          leave();
          return failure ? Promise.reject(failure.error) : Promise.resolve({ done: true, value: undefined });
        }
        return pull().then(next);
      };
      return {
        next,
        return(value?: any) {
          leave();
          return Promise.resolve({ done: true, value });
        },
      };
    },
  };
}

/** A seat on the shared multicast of `source`, its cursor reserved now; a seat itself is returned as is. */
export function shareAsyncIterable<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  if (sharedChannels.has(source)) return source;
  let shared = sharedSources.get(source);
  if (!shared) sharedSources.set(source, (shared = createSharedSource(source)));
  let reserved: AsyncIterator<T> | undefined = shared.open();
  const seat: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      if (reserved) {
        const cursor = reserved;
        reserved = undefined;
        return cursor;
      }
      return shared!.open();
    },
  };
  if ((source as any)[LIVE_SOURCE]) (seat as any)[LIVE_SOURCE] = true;
  sharedChannels.add(seat);
  return seat;
}
