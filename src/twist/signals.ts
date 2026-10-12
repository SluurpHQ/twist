// Twist's reactive core: signals, memos, split effects, owners, async. Written from Solid 2's public design (its RFCs,
// its async spec's statements, its tests), not its code.
//
// Writes are queued: reads return the committed value until a flush. A flush stages the writes, re-runs what depends
// on them in dependency order (height, then creation) against the staged world, then commits. When something a write
// leads to is still loading (an async memo in flight), the write and everything downstream of it are held in a
// transaction instead: what is on screen keeps the committed values, and the transaction commits as one when its last
// flight lands. Writes on graphs no flight touches commit at once.
declare const process: { env: Record<string, string | undefined> };

import { NO_READERS, NOTHING_YET, addReader, dropReader, noteRead, readersOf as kernelReaders } from "../kernel.js";
import { attrHooks } from "./attribution/attribution-hooks.ts";
import { diagnose, emitDiagnostic, ownerPath, reportDiagnostic, setAmbientSubject, GRAPH_SIZE_WARN_AT, noteFanIn, noteFanOut } from "./diagnostics.ts";

// Messages Solid's diagnostics carry, word for word (tools and tests match them).
const OWNED_WRITE_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope (component, computation) is not allowed. " +
  "Move the write outside or set the `ownedWrite` option if this is intentional.";
const OWNED_REFRESH_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Calling refresh() inside an owned scope (component, computation) is not allowed. " +
  "Move the invalidation outside pure computation.";
const ACTION_IN_OWNED_SCOPE_MESSAGE =
  "[ACTION_CALLED_IN_OWNED_SCOPE] Calling an action inside an owned scope (component, computation) is not allowed. " +
  "Call it from an event handler or another imperative scope.";
const PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE =
  "[PRIMITIVE_IN_EFFECT_CALLBACK] Cannot create a memo, effect or root with no owner inside an effect callback. The effect " +
  "phase runs with no ambient owner, so a computation created here belongs to nobody: it is never disposed and never held. " +
  "Create it in the compute (a flow component owns its children), or parent it explicitly with runWithOwner.";
const ownedWriteMessage = (o: Owner) => ((o as any).name ? `${OWNED_WRITE_MESSAGE} (in ${(o as any).name})` : OWNED_WRITE_MESSAGE);
/** Running an effect's apply half (or its cleanup): no ambient owner. */
let inEffectCallback = false;

/** TWIST_TRACE=1: a runaway loop reports itself (every 100,000 runs or rounds, with where it is). */
const TRACE = process.env.NODE_ENV !== "production" && !!(globalThis as any).process?.env?.TWIST_TRACE;
let runs = 0;
let microFlushes = 0;
const trace = (what: string) => console.error(`[twist] ${what}`, new Error().stack?.split("\n").slice(2, 9).join(" | "));

// ---------------------------------------------------------------- dev tools

/** What devtools are told: owners made, values made (and their owner), flushes done, store keys changed. */
export interface DevHooks {
  onOwner?: (owner: Owner) => void;
  onGraph?: (value: any, owner: Owner | null) => void;
  onUpdate?: () => void;
  onStoreNodeUpdate?: (state: any, property: PropertyKey, value: any, prev: any) => void;
}
/** An owner's flag: it takes no id slot of its own (Solid's bit for it). */
export const CONFIG_TRANSPARENT = 1 << 2;
const GUIDE_URL = "https://github.com/solidjs/solid/blob/main/packages/solid/skills/reactivity-diagnostics/SKILL.md";
/** Solid's devtools API: hooks, and the owner and dependency graph (none in production, as Solid's). */
export const DEV = process.env.NODE_ENV === "production" ? undefined : {
  hooks: {} as DevHooks,
  getChildren: (o: Owner): Owner[] => [...(o.owned ?? [])],
  getSignals: (o: Owner): any[] => [...((o as any)._signals ?? [])],
  getParent: (o: Owner): Owner | null => o.parent,
  getSources: (c: Computation<any>): Node[] => [...c.sources],
  getObservers: (n: Node): Computation<any>[] => [...n.observers],
  report: reportDiagnostic,
  guideUrl: (code: string) => `${GUIDE_URL}#${code.toLowerCase()}`,
};
// (A finding with no subject given is about the owner running now.)
if (process.env.NODE_ENV !== "production") setAmbientSubject(() => owner);
/** A value (a signal, a store) recorded on the owner it was made under. */
export function registerGraph(value: any, o: Owner | null) {
  // (For dev tools: nothing in production — a block, not an early return, so a bundler drops what it uses.)
  if (process.env.NODE_ENV !== "production") {
    value._owner = o;
    if (o) ((o as any)._signals ??= []).push(value);
    DEV?.hooks.onGraph?.(value, o);
  }
}

// ---------------------------------------------------------------- owners

export interface Owner {
  parent: Owner | null;
  owned: Owner[] | null;
  cleanups: (() => void)[] | null;
  context: Record<symbol, unknown> | null;
  disposed: boolean;
  /** Its id for hydration (its parent's id and its place among its siblings), when its root has one. */
  id?: string;
  /** How many children it has given ids to (reset when a computation runs again). */
  childCount?: number;
  /** Takes no id slot of its own: its parent's id, and requests passed up. */
  transparent?: boolean;
  /** Disposes what it owns, and itself unless `self` is false. */
  dispose(self?: boolean): void;
}

/** The owner that hands out ids for `o`: itself, or the first non-transparent owner above it. */
const idOwner = (o: Owner) => {
  let at: Owner = o;
  while (at.transparent && at.parent) at = at.parent;
  return at;
};

/**
 * The owner a template's element takes its key under, as Solid's takes it where the template is made: the owner that
 * made it, when the ids it hands out are below those where it is drawn (a row's, a component's memo's); else where it
 * is drawn (one made ahead, as a prop, takes its key in place, as Solid's getter would make it there).
 */
export function keyOwnerOf(made: Owner | null | undefined): Owner | null {
  const here = getOwner();
  if (!made || made.disposed || !here) return here;
  const a = idOwner(made);
  const b = idOwner(here);
  if (a === b) return here;
  for (let o = a.parent; o; o = o.parent) if (o === b) return made;
  return here;
}

/** How many child ids `o` (through the owner that hands them out) has given. */
export const childIdCount = (o: Owner | null): number => (o ? (idOwner(o).childCount ?? 0) : 0);
/** Its child-id count set back (a part rendered again takes the same ids). */
export const setChildIdCount = (o: Owner | null, n: number) => void (o && (idOwner(o).childCount = n));

/** The id the next child of `o` takes (without taking it). */
export function peekNextChildId(o: Owner): string {
  const at = idOwner(o);
  if (at.id == null) throw new Error("Cannot get child id from owner without an id");
  return at.id + (at.childCount ?? 0).toString(36);
}

/** The id the next child of `o` takes: taken. */
export function getNextChildId(o: Owner): string {
  const id = peekNextChildId(o);
  const at = idOwner(o);
  at.childCount = (at.childCount ?? 0) + 1;
  return id;
}

/** The next child id of `o` taken, for a scope of its own (undefined where ids are not given). */
export function scopeIdOf(o: Owner): string | undefined {
  const at = idOwner(o);
  return at.id == null ? undefined : getNextChildId(at);
}

/**
 * A dynamic hole's id scope, as Solid's: one id of the current owner taken now (in source order), and `fn` run with
 * what it makes taking ids under it, from the first each time (a retry takes the same ones).
 */
export function idScope<T>(fn: () => T): () => T {
  const at = owner && idOwner(owner);
  if (!at || at.id == null) return fn;
  const id = getNextChildId(at);
  return () => {
    const was = at.id;
    const count = at.childCount;
    at.id = id;
    at.childCount = 0;
    try {
      return fn();
    } finally {
      at.id = was;
      at.childCount = count;
    }
  };
}

/** Where ids are taken under `o` now (a scope's id, while one runs): a run later takes them from the same place. */
export function idPlace(o: Owner | null): <T>(fn: () => T) => T {
  const at = o && idOwner(o);
  if (!at) return (fn) => fn();
  const id = at.id;
  return (fn) => {
    if (at.id === id) return fn();
    const was = at.id;
    const count = at.childCount;
    at.id = id;
    try {
      return fn();
    } finally {
      at.id = was;
      at.childCount = count;
    }
  };
}

/** An owner made under `parent` given its id (unless transparent, which shares its parent's). */
function giveId(o: Owner, parent: Owner | null) {
  if (!parent || idOwner(parent).id == null) return;
  if (o.transparent) o.id = idOwner(parent).id;
  else o.id = getNextChildId(parent);
}

let owner: Owner | null = null;
let listener: Computation<any> | null = null;
/** Running a computation (or a latest() read): reads see the staged world. */
let inPass = 0;

/** Reactive scopes made so far: a stamp telling what a render made once from what it can make again. */
let ownerCreations = 0;
export const creationStamp = () => ownerCreations;

class Root implements Owner {
  owned: Owner[] | null = null;
  cleanups: (() => void)[] | null = null;
  context: Record<symbol, unknown> | null;
  disposed = false;
  declare id?: string;
  declare childCount: number;
  declare transparent?: boolean;
  constructor(public parent: Owner | null, options?: { id?: string; transparent?: boolean }) {
    this.context = parent?.context ?? null;
    if (parent) parent.owned ? parent.owned.push(this) : (parent.owned = [this]);
    if (options?.transparent) this.transparent = true;
    if (serverRender) (this as any).renderCtx = sharedConfig.context;
    if (options?.id != null) this.id = options.id;
    else giveId(this, parent);
    // (A transparent owner holds nothing of its own: not a creation.)
    if (!options?.transparent) ownerCreations++;
    DEV?.hooks.onOwner?.(this);
  }
  get _config() {
    return this.transparent ? CONFIG_TRANSPARENT : 0;
  }
  get _context() {
    return toolContext(this);
  }
  set _context(c) {
    this.context = c;
  }
  /** (Solid's owner tree as its tools walk it: first child, parent, next sibling; disposed ones skipped.) */
  get _firstChild(): Owner | null {
    return liveFrom(this.owned, (this.owned?.length ?? 0) - 1);
  }
  get _parent(): Owner | null {
    return this.parent;
  }
  get _nextSibling(): Owner | null {
    const o = this.parent?.owned;
    return o ? liveFrom(o, o.indexOf(this as any) - 1) : null;
  }
  /** Disposes what it owns, and itself unless `self` is false. */
  dispose(self = true) {
    if (!self) return disposeOwned(this);
    dispose(this);
    if (this.parent?.owned) remove(this.parent.owned, this);
  }
}
(Root.prototype as any).childCount = 0;

/** An owner made to run again: what it owned and its cleanups gone, its child ids from the start. */
export function resetOwner(o: Owner) {
  disposeOwned(o);
  (o as any).childCount = 0;
  (o as any).resets = ((o as any).resets ?? 0) + 1;
}

/** What `o` owns disposed: its children first (last made first), then its cleanups (last registered first). */
function disposeOwned(o: Owner) {
  if ((o as any)._signals) (o as any)._signals = undefined;
  const owned = o.owned;
  if (owned) {
    o.owned = null;
    for (let i = owned.length - 1; i >= 0; i--) dispose(owned[i]!);
  }
  const cleanups = o.cleanups;
  if (cleanups) {
    o.cleanups = null;
    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!();
  }
}

function dispose(o: Owner) {
  if (o.disposed) return;
  o.disposed = true;
  // (Death takes a parked frame with it: first, as its commit would have retired it.)
  if ((o as any).parked) drainParked(o as any);
  // (Counted without a finally, as Solid's: a cleanup that throws leaves it raised, healed a microtask later.)
  disposalDepth++;
  disposeOwned(o);
  if (o instanceof Computation) o.end();
  disposalDepth--;
}

/** A memo's last frame, kept by a rerun until the swap: it goes when the node commits (or its owner does). */
function parkFrame(c: Computation<any>) {
  const frame = { owned: c.owned, cleanups: c.cleanups } as Owner;
  c.owned = null;
  c.cleanups = null;
  if ((c as any)._signals) (c as any)._signals = undefined;
  if (!(c as any).parked && c.kind === RENDER) parkedRenders++;
  ((c as any).parked ??= []).push(frame);
  // (Not run again before the round decides: past it, a frame left showing reacts again.)
  dormant(frame, true);
  // (An effect's frame being replaced: what it computed against the new values is never applied under it.)
  if (c.kind !== MEMO) unapply(frame);
}
function unapply(o: Owner) {
  for (const k of o.owned ?? []) {
    if (k instanceof Computation && k.due) (k.due = false), remove(applies[k.kind as 1 | 2], k);
    unapply(k);
  }
}
/** Effects whose new pass ran: their last frame goes after the render effects apply (the new children first). */
const effectDrains: Computation<any>[] = [];
/** Memos whose last frame a rerun this round parked. */
const swaps: Computation<any>[] = [];
/** The round settled: a held memo's frame waits for its transition (rendering until it lands); the rest go now. */
function decideSwaps() {
  for (const c of swaps.splice(0)) {
    if (c.disposed || !(c as any).parked) continue;
    const t = c.tx && !c.tx.root.done ? c.tx.root : null;
    if (t) {
      if (c.heldPass === t) continue;
      c.heldPass = t;
      for (const frame of (c as any).parked) dormant(frame, false);
      endWith(t, () => drainParked(c as any));
    } else if (c.kind !== MEMO) effectDrains.push(c);
    // (A memo whose new pass waits on what is not ready yet: its frame stays shown, reacting, until a pass answers.)
    // (Or whose new answer is still out, over one it committed: kept until it lands.)
    else if ((c as any).pendingPass || (c.flight && !c.streaming && c.ready)) for (const frame of (c as any).parked) dormant(frame, false);
    else drainParked(c as any);
  }
}
/** What a parked frame holds, set not to run again (or to run again). */
function dormant(o: Owner, on: boolean) {
  for (const c of o.owned ?? []) {
    if (c instanceof Computation) c.dormant = on;
    dormant(c, on);
  }
}
/** Its parked frames let go: children first, later registrations before earlier, each frame once. */
/** Render effects with a parked frame (none: no first apply waits on one). */
let parkedRenders = 0;
function drainParked(c: { parked?: Owner[] | null }) {
  const p = c.parked;
  if (!p) return;
  c.parked = null;
  if ((c as any).kind === RENDER) parkedRenders--;
  for (let i = p.length - 1; i >= 0; i--) disposeOwned(p[i]!);
}
export function getOwner(): Owner | null {
  return owner;
}
export type ExternalSource = { track: (prev: any) => any; dispose: () => void };
export type ExternalSourceConfig = { factory: (fn: (prev: any) => any, trigger: () => void) => ExternalSource; untrack?: <T>(fn: () => T) => T };
/** Another reactive library tracked along: each computation runs through its tracker, which triggers it again. */
let externalSource: { factory: ExternalSourceConfig["factory"]; untrack: <T>(fn: () => T) => T } | null = null;
/** Computations made from now on track an external reactive library's reads too (a later call wraps the earlier). */
export function enableExternalSource(config: ExternalSourceConfig) {
  const { factory, untrack = (fn) => fn() } = config;
  const prev = externalSource;
  externalSource = prev
    ? {
        factory(fn, trigger) {
          const inner = prev.factory(fn, trigger);
          const outer = factory((x) => inner.track(x), trigger);
          return {
            track: (x) => outer.track(x),
            dispose() {
              outer.dispose();
              inner.dispose();
            },
          };
        },
        untrack: (fn) => prev.untrack(() => untrack(fn)),
      }
    : { factory, untrack };
}
/** External tracking off again (for tests). */
export const _resetExternalSourceConfig = () => void (externalSource = null);

// ---------------------------------------------------------------- snapshots (hydration)
// While hydrating, what derives in the hydrating tree reads the values its signals had when made: a write during the
// pass (an effect, a value restored from storage) is held for it, and lands when its scope is released (the pass
// ends). The page claimed is the page the server rendered.

let snapshotCapture = false;
/** Signals holding a snapshot, cleared when hydration is over. */
let snapshotSources: Set<Signal<any>> | null = null;
/** The hydrating tree's root, a snapshot scope from its first computation until the pass ends. */
let snapshotRoot: Owner | null = null;
/** Snapshots taken from now on (signals made, and written, keep the value they had). */
export function setSnapshotCapture(on: boolean) {
  snapshotCapture = on;
  if (on) snapshotSources ??= new Set();
}
/** What derives under `o` from now on reads snapshots. */
export function markSnapshotScope(o: Owner) {
  (o as any).snapshotScope = true;
}
/** `o`'s scope over: what read a snapshot that has moved on runs again. */
export function releaseSnapshotScope(o: Owner) {
  (o as any).snapshotScope = false;
  releaseScope(o);
  schedule();
}
function releaseScope(o: Owner) {
  for (const c of o.owned ?? []) {
    // (A scope of its own is released on its own.)
    if ((c as any).snapshotScope) continue;
    if (c instanceof Computation) {
      c.inSnapshot = false;
      if (c.snapshotStale) (c.snapshotStale = false), c.mark(DIRTY);
      const on = (c as any).onRelease;
      if (on) ((c as any).onRelease = null), on();
    }
    releaseScope(c);
  }
}
/** Every snapshot dropped, capture off: signals read as they are again. */
export function clearSnapshots() {
  if (snapshotSources) for (const s of snapshotSources) s.snap = NONE;
  snapshotSources = null;
  for (const clear of snapshotClears) clear();
  snapshotClears.clear();
  snapshotCapture = false;
}
/** What else keeps snapshots (a store's written keys): dropped with them. */
const snapshotClears = new Set<() => void>();
/** Whether snapshots are taken now; `onClear` drops what the caller keeps when they are cleared. */
export function takingSnapshots(onClear?: () => void): boolean {
  if (snapshotCapture && onClear) snapshotClears.add(onClear);
  return snapshotCapture;
}
/** A kept value read: served to a reader in a snapshot scope (stale when it moved on), else null. */
export function servedSnapshot(current: unknown, snap: unknown): [unknown] | null {
  if (!snapshotCapture || !listener?.inSnapshot) return null;
  if (!Object.is(current, snap)) listener.snapshotStale = true;
  return [snap];
}
/** Never settles: a node not asked yet waits on it. */
const UNASKED = { then() {} };
/** Whether the hydrating pass is over, as a node made now sees it: false in its snapshot scope, true once released. */
export function hydrationFlag(): () => boolean {
  const hydrated = new Signal(false, { ownedWrite: true });
  (hydrated as any).snapshots = true;
  hydrated.snapshot();
  hydrated.write(true);
  return () => hydrated.read();
}

/** The hydrating pass begins: its root is found at its first computation. */
export const openHydrationScope = () => void (snapshotRoot = null);
/** The hydrating pass ends: its root's scope released. */
export function closeHydrationScope() {
  const o = snapshotRoot;
  snapshotRoot = null;
  if (o) releaseSnapshotScope(o);
}
function inSnapshotScope(o: Owner | null): boolean {
  for (; o; o = o.parent) if ((o as any).snapshotScope) return true;
  return false;
}

/** A mount's window in which a render effect waiting with no Loading above is said (once per window, dev only). */
let enforcing = false;
let saidUnhandled = false;
/** Opens or closes that window (for a mount that has no root boundary of its own). */
export function enforceLoadingBoundary(on: boolean) {
  enforcing = on;
  if (on) saidUnhandled = false;
}
function unhandledAsync(c: Computation<any>) {
  if (process.env.NODE_ENV !== "production" && !saidUnhandled) {
    saidUnhandled = true;
    diagnose(
      {
        code: "ASYNC_OUTSIDE_LOADING_BOUNDARY",
        kind: "async",
        severity: "warn",
        message: "[ASYNC_OUTSIDE_LOADING_BOUNDARY] An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles.",
        ownerName: c.name,
      } as any,
      c,
    );
  }
}
/** The computation tracking reads now, or null. */
export const getObserver = () => listener;

/** Whether `o` has been disposed. */
export const isDisposed = (o: Owner) => o.disposed;

/** A new owner under the current one, for code that builds outside a computation. */
export function createOwner(options?: { transparent?: boolean; id?: string }): Owner {
  return new Root(owner, options);
}

/** A new owner under `parent`. @internal */
export function ownerUnder(parent: Owner | null, options?: { transparent?: boolean; id?: string }): Owner {
  return new Root(parent, options);
}

/** Where an error was thrown: the innermost owner whose scope it escaped (a not-ready read is no failure). */
const throwers = new WeakMap<object, Owner>();
function stampThrower(error: unknown, o: Owner | null) {
  if (o === null || error === null || (typeof error !== "object" && typeof error !== "function") || error instanceof NotReadyError) return;
  if (!throwers.has(error as object)) throwers.set(error as object, o);
}
/** The owner `error` was thrown under, if it escaped one. */
export const throwerOf = (error: unknown): Owner | undefined =>
  error !== null && (typeof error === "object" || typeof error === "function") ? throwers.get(error as object) : undefined;

export function runWithOwner<T>(o: Owner | null, fn: () => T): T {
  if (process.env.NODE_ENV !== "production" && o && (o as any).disposed)
    reportDiagnostic(
      emitDiagnostic(
        { code: "RUN_WITH_DISPOSED_OWNER", kind: "owner", severity: "warn", message: "[RUN_WITH_DISPOSED_OWNER] runWithOwner called with a disposed owner. Children created inside will never be disposed.", ownerId: o.id, ownerName: (o as any).name },
        o,
      ),
    );
  return runOwned(o, fn as any);
}
/** runWithOwner, `fn` given its arguments (no closure needed to pass them). */
export function runOwned<A, B, T>(o: Owner | null, fn: (a: A, b: B) => T, a?: A, b?: B): T {
  const prevOwner = owner;
  const prevListener = listener;
  owner = o;
  listener = null;
  try {
    return fn(a!, b!);
  } catch (e) {
    stampThrower(e, o);
    throw e;
  } finally {
    owner = prevOwner;
    listener = prevListener;
  }
}

export function onCleanup<T extends () => void>(fn: T): T {
  if (inSettled) {
    const message = "[CLEANUP_IN_FORBIDDEN_SCOPE] Cannot use onCleanup inside createTrackedEffect or onSettled; return a cleanup function instead";
    if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "CLEANUP_IN_FORBIDDEN_SCOPE", kind: "lifecycle", severity: "error", message, ownerId: owner?.id, ownerName: (owner as any)?.name });
    throw new Error(message);
  }
  if (owner) (owner.cleanups ??= []).push(fn);
  else
    if (process.env.NODE_ENV !== "production") reportDiagnostic(
      emitDiagnostic({ code: "NO_OWNER_CLEANUP", kind: "lifecycle", severity: "warn", message: "[NO_OWNER_CLEANUP] onCleanup called outside a reactive context will never be run" }),
    );
  return fn;
}

/** A scope of its own, owned by the current one: disposed with it, or by the function `fn` is given. */
export function createRoot<T>(fn: (dispose: () => void) => T, options?: { id?: string; transparent?: boolean }): T {
  const root = new Root(owner, options);
  // (Development: a top-level root is where a walk of the live graph starts.)
  if (process.env.NODE_ENV !== "production" && !root.parent) liveRoots.add(root);
  return runWithOwner(root, () =>
    fn(() => {
      dispose(root);
      if (process.env.NODE_ENV !== "production") liveRoots.delete(root);
      if (root.parent?.owned) remove(root.parent.owned, root);
    }),
  );
}
/** The top-level roots alive now (development: the attribution engine's graph walk starts there). */
const liveRoots = new Set<Owner>();

/** What the attribution engine reads of the core (development tooling): a node's sources, readers and value, a
 * transaction's nodes and what it waits on. Read-only. */
export const attributionCore = {
  sources: (n: any): Node<any>[] => (n instanceof Computation ? (n.sources as Node<any>[]) : []),
  readers: (n: any): Computation<any>[] => (Array.isArray(n.observers) ? n.observers : [...n.observers]),
  /** Its value as the engine compares it: a staged one, else the committed one. */
  value: (n: any): unknown => (n.staged !== NONE ? n.staged : n.value),
  committed: (n: any): unknown => n.value,
  isComputation: (n: any): boolean => n instanceof Computation,
  isEffect: (n: any): boolean => n instanceof Computation && n.kind !== MEMO,
  owned: (o: any): any[] => o.owned ?? [],
  isPlumbing: (n: any): boolean => !!n.plumbing,
  isVerdict: (n: any): boolean => !!n.verdictReader || !!n._devWindows,
  /** A node showing a guess that is not one written (a lane's derivation). */
  isCompanion: (n: any): boolean => n.override !== NONE && !n.guessed,
  laneGuesses: (t: any): Node<any>[] => (t.lane ? [...t.lane.guessed.keys()] : t.parentTx ? [...t.guessed.keys()] : []),
  marks: (t: any): Node<any>[] | null => t.marks ?? null,
  blockers: (t: any): Iterable<Computation<any>> => t.flights,
  nodes: (t: any): Iterable<Node<any>> => t.nodes,
  open: (t: any): number => t.open,
  /** What moves each time it commits a value (the engine's "did it land" check). */
  time: (n: any): number => n.version,
  liveRoots: (): Owner[] => [...liveRoots].filter((r) => !(r as any).disposed),
  /** The node behind an accessor (a memo's, a signal's), or what was given. */
  nodeOf: (target: unknown): any => (typeof target === "function" ? (accessors.get(target as any) ?? target) : target),
};

/** `item` out of `list`; the ends first, as lists are let go of in order or in reverse (no scan per item). */
/** The first owner not disposed in `list` from `i` on. */
/** (Newest first, as Solid links them.) */
function liveFrom(list: Owner[] | null, i: number): Owner | null {
  if (!list) return null;
  // (A lazy memo read once and read by nothing now is off the chain until read again.)
  const off = (o: Owner) => o instanceof Computation && o.lazy && !o.attached && o.ranAt !== -1;
  for (; i >= 0; i--) if (!list[i]!.disposed && !off(list[i]!)) return list[i]!;
  return null;
}

function remove<T>(list: T[], item: T) {
  const last = list.length - 1;
  if (list[last] === item) return void list.pop();
  if (list[0] === item) return void list.shift();
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

/**
 * `fn` run with nothing tracked. `strictReadLabel` (a component body, `<Name>`): a reactive value read directly in it
 * will not update, and says so.
 */
export function untrack<T>(fn: () => T, strictReadLabel?: string): T {
  // (An external reactive library's reads are untracked with it.)
  if (externalSource) {
    const inner = fn;
    fn = () => externalSource!.untrack(inner);
  }
  // (Development, an async compute in flight: an explicit untrack is a read meant untracked — counted, not said.)
  const counted = process.env.NODE_ENV !== "production" && tailFlights.size > 0;
  if (!listener && !strictRead && !strictReadLabel && !counted) return fn();
  const prev = listener;
  const prevStrict = strictRead;
  const prevOuter = untrackedBy;
  if (prev) untrackedBy = prev;
  listener = null;
  strictRead = strictReadLabel || false;
  if (counted) untrackDepth++;
  try {
    return fn();
  } finally {
    if (counted) untrackDepth--;
    listener = prev;
    strictRead = prevStrict;
    untrackedBy = prevOuter;
  }
}
/** The computation whose run an untrack() is inside: what a held value read untracked there is judged by. */
let untrackedBy: Computation<any> | null = null;

/** The strict-read scope we are in (a component body's label), or none. */
let strictRead: string | false = false;
/** A read outside tracking in a strict scope: reported (a store's property read too). */
export function checkStrictRead(n: { name?: string; store?: boolean }) {
  if (strictRead && !listener) strictReadUntracked(n as Node<any>);
}
function pendingUntrackedRead(n: Node<any>): never {
  const message =
    `[PENDING_ASYNC_UNTRACKED_READ] Reading a pending async value directly in ${strictRead}. ` +
    `Async values must be read within a tracking scope (JSX, a memo, or an effect's compute function).`;
  emitDiagnostic({ code: "PENDING_ASYNC_UNTRACKED_READ", kind: "async", severity: "error", message, data: { strictRead }, nodeName: n.name } as any);
  throw new Error(message);
}
function strictReadUntracked(n: Node<any>) {
  // Named when the name says something (the defaults would only restate "reactive value").
  const named = n.name !== undefined && n.name !== "signal" && n.name !== "computed";
  if (process.env.NODE_ENV !== "production") diagnose({
    code: "STRICT_READ_UNTRACKED",
    kind: "strict-read",
    severity: "warn",
    message:
      `[STRICT_READ_UNTRACKED] Reactive value${named ? ` "${n.name}"` : ""} read directly in ` +
      `${strictRead} will not update. ` +
      `Move it into a tracking scope (JSX, a memo, or an effect's compute function).`,
    // (A store's property read: the property, as Solid's store reports it.)
    data: (n as any).store ? { strictRead, property: n.name, source: "store" } : { strictRead },
    ownerName: (owner as any)?.name,
    nodeName: n.name,
  }, owner);
}

// ---------------------------------------------------------------- nodes

type Equals<T> = false | ((a: T, b: T) => boolean);
const NONE: unique symbol = Symbol("none");
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

/** Ticks with every change: a memo nothing subscribes to is still valid if it ran at this tick. */
let clock = 0;
let ids = 0;

export type SignalOptions<T> = { equals?: Equals<T>; unobserved?: () => void; ownedWrite?: boolean; name?: string; lazy?: boolean; defer?: boolean; schedule?: boolean; transparent?: boolean; loadingValue?: T };

/** Thrown by a read of a value that has never been ready (an async memo's first load): Loading catches it. */
const noop = () => {};

/** Rendering on a server: promises that settled are remembered, and read again they answer at once. */
let serverRender = false;
/** The server render an owner was made in (its context), found up its chain; null with none. */
export function renderContextOf(o: Owner | null): any {
  for (; o; o = o.parent) {
    const c = (o as any).renderCtx;
    if (c) return c;
  }
  return null;
}
const answered = new WeakMap<object, [boolean, unknown]>();
/** Server mode on or off; answers what it was. */
const SERVER_COMPONENT_SCOPE = Symbol.for("twist.ssr.server-component");
const LIVE_SERVER_COMPONENT_SCOPE = Symbol.for("twist.ssr.live-server-component");
const LIVE_SOURCE = Symbol.for("solid.LiveSource");
const LIVE_RESUME_FROM = Symbol.for("solid.LiveResumeFrom");
const UNDECLARED_LIVE_SOURCE_MS = 5000;

/** The hold a server component's pump keeps its response open with; in a document, a warning once it has run long. */
function openPumpHold(ctx: any, node: Owner, alive: () => boolean): () => void {
  const hold: (() => void) | undefined = ctx.hold?.();
  let released = false;
  let cap: any;
  if (ctx.document) {
    cap = setTimeout(() => {
      cap = undefined;
      if (released || !alive()) return;
      if (process.env.NODE_ENV !== "production") reportDiagnostic(emitDiagnostic(
        {
          code: "SSR_UNDECLARED_LIVE_SOURCE",
          kind: "ssr",
          severity: "warn",
          message:
            `[SSR_UNDECLARED_LIVE_SOURCE] An async iterable read in a server component is still producing ${UNDECLARED_LIVE_SOURCE_MS / 1000}s into a document render: the document stays open for as long as it does. Declare the server function live(...) so the document takes the source's first value and the client connects for the rest, or bound the source.`,
          data: { afterMs: UNDECLARED_LIVE_SOURCE_MS },
        },
        node,
      ));
    }, UNDECLARED_LIVE_SOURCE_MS);
    cap.unref?.();
  }
  return () => {
    if (released) return;
    released = true;
    if (cap !== undefined) clearTimeout(cap);
    hold?.();
  };
}

/** Whether a server render is under way. */
export const isServerRender = () => serverRender;
export const setServerRender = (on: boolean) => {
  const was = serverRender;
  serverRender = on;
  return was;
};
/** The server render under way (its key), and how to enter it again: a computation made in it runs in it. */
type ServerScope = { key: object; enter: <T>(fn: () => T) => T };
let serverScope: ServerScope | null = null;
export const setServerScope = (s: ServerScope | null) => {
  const was = serverScope;
  serverScope = s;
  return was;
};
/** The render under way on a server: what its async nodes answered, by id (a retry's node of the same id takes it). */
let serverAnswers: Map<string, [boolean, unknown]> | null = null;
export const setServerAnswers = (m: Map<string, [boolean, unknown]> | null) => void (serverAnswers = m);
/** Told of each async node's answer as a server render asks for it (to send it to the client). */
let serverFly: ((node: unknown, answer: unknown) => void) | null = null;

type Tee<T> = [AsyncIterable<T>, AsyncIterable<T>, () => void];
/** An answer that may be a source: the stream stays open until the source has ended, not only until it answered. */
export const SOURCE_ANSWER = Symbol("twist.source-answer");
const sourceAnswer = <P extends object>(p: P) => (((p as any)[SOURCE_ANSWER] = true), p);
/** A server render's sharer: one pump per async source, a seat for each reader. */
let serverSharer: ((source: AsyncIterable<any>) => AsyncIterable<any>) | null = null;
export const setServerSharer = (fn: typeof serverSharer) => void (serverSharer = fn);
/** A source others can read too (one that makes a new iterator each time), through the shared pump. */
const shared = <T>(v: AsyncIterable<T>): AsyncIterable<T> => (serverSharer && typeof (v as any).next !== "function" ? serverSharer(v) : v);
/** A source an async answer gave, split once: the same split however many passes read it. */
const sourceTees = new WeakMap<object, Tee<any>>();
const teeOf = (v: AsyncIterable<any>) => {
  let t = sourceTees.get(v);
  if (!t) sourceTees.set(v, (t = teeSource(v)));
  return t;
};
/** What the client is sent for an answer: each async source in it (at any depth of plain objects and arrays) as the
 * client's reader of its split. */
function clientCopy(v: any, seen = new Map<object, any>()): any {
  if (!v || typeof v !== "object") return v;
  if (typeof v[Symbol.asyncIterator] === "function" && typeof v.then !== "function") return teeOf(v)[1];
  if (seen.has(v)) return seen.get(v);
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v;
  let copy: any = null;
  const keys = Object.keys(v);
  for (const k of keys) {
    const x = v[k];
    const c = x && typeof x === "object" ? clientCopy(x, seen) : x;
    if (c !== x) (copy ??= Array.isArray(v) ? [...v] : { ...v })[k] = c;
  }
  seen.set(v, copy ?? v);
  return copy ?? v;
}
/**
 * Two readers of one async source: each value kept for the reader behind, the source asked once per value. A reader
 * let go of stops reading; the source is returned when both are, or when `close` is called.
 */
/** How a derived store's patch batch applies (the store module's, registered there). */
let patchApply: ((state: any, patches: any[]) => void) | null = null;
export const setPatchApply = (fn: typeof patchApply) => void (patchApply = fn);
const cloneState = (v: any) => (v === undefined || v === null || typeof v !== "object" ? v : typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
/** A source's reader whose steps already buffered (a serialized stream's replay) answer at once, as sync thenables. */
function bufferedReader(source: any): AsyncIterator<any> {
  if (!source || source.__SEROVAL_STREAM__ !== true || typeof source.on !== "function") return source[Symbol.asyncIterator]();
  const queue: IteratorResult<any>[] = [];
  let failed: { e: unknown } | null = null;
  let wake: (() => void) | null = null;
  const push = (r: IteratorResult<any>) => (queue.push(r), wake && (wake(), (wake = null)));
  source.on({
    next: (value: any) => push({ done: false, value }),
    throw: (e: unknown) => ((failed = { e }), wake && (wake(), (wake = null))),
    return: () => push({ done: true, value: undefined }),
  });
  const answer = (): any => {
    if (queue.length) {
      const r = queue[0]!.done ? queue[0]! : queue.shift()!;
      return { then: (ok: any) => (ok ? ok(r) : r) };
    }
    if (failed) {
      const e = failed.e;
      return { then: (_ok: any, fail: any) => (fail ? fail(e) : Promise.reject(e)) };
    }
    return null;
  };
  return {
    next: () => answer() ?? new Promise((ok) => (wake = () => ok(undefined))).then(() => answer()),
    return: (v?: any) => Promise.resolve({ done: true, value: v }),
  } as AsyncIterator<any>;
}
/**
 * A stream taking over from the server's answer: its first step answers `quiet` at once (nothing changes), its first
 * yield — the server's answer again — answers `quiet` too, then `activate` runs (a store's writes go live).
 */
export function firstYieldDropped<T>(iterable: AsyncIterable<T>, activate: (() => void) | undefined, quiet: unknown): AsyncIterable<T> {
  const it = iterable[Symbol.asyncIterator]();
  let step = 0;
  let started: any;
  const self: any = {
    [Symbol.asyncIterator]: () => self,
    next(): any {
      if (step === 0) {
        step = 1;
        // (Started now, in the run: what it reads before its first await is tracked.)
        started = it.next();
        const r = { done: false, value: quiet };
        return { then: (ok: any) => (ok ? ok(r) : r) };
      }
      const p = step === 1 ? started : it.next();
      if (step !== 1) return p;
      step = 2;
      return Promise.resolve(p).then((r) => (activate?.(), r.done ? r : { done: false, value: quiet }));
    },
    return: (v?: any) => (it.return ? it.return(v) : Promise.resolve({ done: true, value: v })),
  };
  return self;
}
/** A step's result if it answered at once (a bare result, or a thenable that calls back while asked): [ok, value]. */
function answeredNow(r: any): [boolean, any] | null {
  if (!r || typeof r.then !== "function") return [true, r];
  let out: [boolean, any] | null = null;
  r.then(
    (x: any) => void (out = [true, x]),
    (e: any) => void (out = [false, e]),
  );
  return out;
}
/** `it` with each run of results it answers at once given as their last (an already-buffered backlog: one update). */
function conflated<T>(it: AsyncIterator<T>): AsyncIterator<T> {
  let carry: any = null;
  let ended = false;
  return {
    next(): any {
      if (ended) return { done: true, value: undefined };
      if (carry) {
        const c = carry;
        carry = null;
        return c;
      }
      let last: IteratorResult<T> | null = null;
      for (;;) {
        let r: any;
        try {
          r = it.next();
        } catch (e) {
          if (!last) throw e;
          carry = Promise.reject(e);
          return last;
        }
        const now = answeredNow(r);
        // (Waiting, or failed: what came before first.)
        if (!now || !now[0]) {
          if (!last) return r;
          carry = r;
          return last;
        }
        if (now[1]?.done) {
          if (!last) return now[1];
          ended = true;
          return last;
        }
        last = now[1];
      }
    },
    return: (v?: any) => (it.return ? it.return(v) : Promise.resolve({ done: true, value: v })) as any,
  };
}
/** A snapshot-then-patches stream as whole states (each a copy of its own: what is reconciled in is never changed). */
function statesOf(source: AsyncIterable<any>, apply: (state: any, patches: any[]) => void): AsyncIterable<any> {
  let state: any;
  let first = true;
  const it = bufferedReader(source);
  const step = (r: IteratorResult<any>): IteratorResult<any> => {
    if (r.done) return r;
    if (first) (first = false), (state = cloneState(r.value));
    else apply(state, r.value);
    return { done: false, value: cloneState(state) };
  };
  const self: any = {
    [Symbol.asyncIterator]: () => self,
    // (A step answered at once — a buffered stream's — stays answered at once: hydration claims with it.)
    next: () => {
      const r: any = it.next();
      if (!r || typeof r.then !== "function") return step(r);
      return { then: (ok: any, fail: any) => r.then((x: any) => (ok ? ok(step(x)) : step(x)), fail) };
    },
    return: (v?: any) => (it.return ? it.return(v) : Promise.resolve({ done: true, value: v })),
  };
  return self;
}
/** `source` with its first step already asked (now, by the caller): the same values, its marks kept. */
function primed<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const it = source[Symbol.asyncIterator]();
  let first: any = it.next();
  const self: any = {
    [Symbol.asyncIterator]: () => self,
    next(...a: any[]) {
      if (!first) return (it.next as any)(...a);
      const f = first;
      first = null;
      return f;
    },
    return: (v?: any) => ((first = null), it.return ? it.return(v) : Promise.resolve({ done: true, value: v })),
  };
  if (it.throw) self.throw = (e?: any) => ((first = null), it.throw!(e));
  for (const k of Object.getOwnPropertySymbols(source)) if (k !== Symbol.asyncIterator) self[k] = (source as any)[k];
  return self;
}

export function teeSource<T>(source: AsyncIterable<T>): Tee<T> {
  const it = source[Symbol.asyncIterator]();
  const kept: { r?: IteratorResult<T>; e?: unknown }[][] = [[], []];
  const gone = [false, false];
  let asking: Promise<void> | null = null;
  let ended = false;
  const ask = () =>
    (asking ??= Promise.resolve(it.next()).then(
      (r) => {
        asking = null;
        if (r.done) ended = true;
        for (let i = 0; i < 2; i++) if (!gone[i]) kept[i]!.push({ r });
      },
      (e) => {
        asking = null;
        ended = true;
        // (Not ready is the render's to wait on, never sent: the client's reader ends there.)
        for (let i = 0; i < 2; i++) if (!gone[i]) kept[i]!.push(i === 1 && e instanceof NotReadyError ? { r: { done: true, value: undefined } } : { e });
      },
    ));
  const close = () => {
    gone[0] = gone[1] = true;
    if (ended) return;
    ended = true;
    try {
      void Promise.resolve(it.return?.()).catch(noop);
    } catch {
      // (A source whose return throws: let go of all the same.)
    }
  };
  const reader = (i: number): AsyncIterable<T> => {
    const self: AsyncIterator<T> & AsyncIterable<T> = {
      [Symbol.asyncIterator]: () => self,
      async next() {
        while (!kept[i]!.length) {
          if (gone[i] || (ended && !asking)) return { done: true, value: undefined };
          await ask();
        }
        const k = kept[i]!.shift()!;
        if ("e" in k) throw k.e;
        return k.r!;
      },
      async return(value?: any) {
        gone[i] = true;
        kept[i]!.length = 0;
        if (gone[0] && gone[1]) close();
        return { done: true, value };
      },
    };
    return self;
  };
  // (The client's reader: what the stream stays open for, see awaitData.)
  return [reader(0), sourceAnswer(reader(1)), close];
}
export const setServerFly = (fn: typeof serverFly) => void (serverFly = fn);

/** What a not-ready read waits on: the flight of the node it read, upstream of it, or nothing known. */
/** A client-only compute on a server: it waits on what never comes there. */
const CLIENT_ONLY = { clientOnly: true };
function clientOnly(): never {
  throw new NotReadyError(CLIENT_ONLY);
}
/** A client-only source read on a server: not ready — or, outside every <Loading> and with no loading value shown in
 * its place, an error (nothing owns its position). */
function clientHoleRead() {
  if (!insideLoading(listener ?? owner) && !listener?.loadingWindow) {
    const message =
      `[ASYNC_OUTSIDE_LOADING_BOUNDARY] ssrSource: "client" read during SSR outside a <Loading> boundary — the server cannot ` +
      `run this source, so a boundary must own the position's fallback. Wrap the read in <Loading>, or declare a ` +
      `loadingValue/seedLoadingValue to render a provisional value instead.`;
    if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "ASYNC_OUTSIDE_LOADING_BOUNDARY", kind: "async", severity: "error", message, data: { side: "server" } } as any);
    throw new Error(message);
  }
}
/** Whether a server render is inside a <Loading> now (the server's renderer says). */
let insideLoading: (o: Owner | null) => boolean = () => true;
export const setInsideLoading = (fn: (o: Owner | null) => boolean) => void (insideLoading = fn);
/** Whether what is not ready is client-only content (the client renders it; nothing on the server will settle it). */
export function isClientOnly(e: NotReadyError): boolean {
  const seen = new Set<unknown>();
  const find = (n: any): boolean => {
    if (!n || seen.has(n)) return false;
    seen.add(n);
    if (n === CLIENT_ONLY || n.ssrSource === "client") return true;
    if (n.waitsFor && find(n.waitsFor.source)) return true;
    for (const s of n.sources ?? []) if (find(s)) return true;
    return false;
  };
  return find(e.source);
}

export function settlesOf(e: NotReadyError): Promise<void> | null {
  const seen = new Set<unknown>();
  const find = (n: any): Promise<void> | null => {
    if (!n || seen.has(n)) return null;
    seen.add(n);
    // A promise named by the error itself (user code throwing NotReadyError(promise)).
    if (typeof n.then === "function") return Promise.resolve(n).then(noop, noop);
    if (n.flight && n.settles) return n.settles;
    if (n.waitsFor && n.waitsFor.source !== n) {
      const p = find(n.waitsFor.source);
      if (p) return p;
    }
    for (const s of n.sources ?? []) {
      const p = find(s);
      if (p) return p;
    }
    return null;
  };
  // (Nothing found along what it read: the next of the flights in progress to settle.)
  return find(e.source) ?? (flights.size ? Promise.race([...flights].map((f) => f.settles ?? new Promise<void>(noop))) : null);
}

/** Whether what a not-ready read waits on holds a stream's shell (a module loading, data marked deferStream). */
export function holdsShell(e: NotReadyError): boolean {
  const seen = new Set<unknown>();
  const find = (n: any): boolean => {
    if (!n || seen.has(n) || typeof n.then === "function") return false;
    seen.add(n);
    // (Marked deferStream and waiting: on its own answer, or on what it reads.)
    if (n.deferStream && (n.flight || !n.ready)) return true;
    if (n.waitsFor && n.waitsFor.source !== n && find(n.waitsFor.source)) return true;
    return (n.sources ?? []).some(find);
  };
  return find(e.source);
}

export class NotReadyError extends Error {
  constructor(public source?: unknown) {
    super("Value not ready");
  }
}

/** A hold: writes and what they led to, kept off screen until its last flight lands. */
export class Transaction {
  done = false;
  nodes = new Set<Node>();
  effects = new Set<Computation<any>>();
  flights = new Set<Computation<any>>();
  /** Actions still running in it (it cannot commit before they end). */
  open = 0;
  /** What runs when it commits (optimistic values revert). */
  ends: (() => void)[] = [];
  /** Render effects that showed the committed frame over what it holds: run again when it commits. */
  stale = new Set<Computation<any>>();
  merged: Transaction | null = null;
  /** A lane: the sub-frame a guess opens in this transaction (its own holds, revealed on its own, ended with this). */
  lane: Transaction | null = null;
  /** For a lane: the transaction it is a lane of, and the nodes guessed in it. */
  parentTx: Transaction | null = null;
  guessed = new Map<Node, unknown>();
  get root(): Transaction {
    let t: Transaction = this;
    while (t.merged) t = t.merged;
    return t;
  }
}
const transactions = new Set<Transaction>();
/** The flush that is running, or the one to come (what happens between flushes is the next one's). */
const cycle = () => (flushing ? flushes : flushes + 1);
/** Flushes run so far. */
let flushes = 0;

/** What signals and computations share: a committed value, a staged one, and who reads them. */
/** A node's readers: a short list (most nodes have one or two), a set past a few. */
type Readers = Computation<any>[] | Set<Computation<any>>;
// (The graph's lists are the kernel's, shared with the React side's signals.)
const NO_OBSERVERS = NO_READERS as unknown as Readers;
/** A change reaching very many readers: said (development). */
function fanOut(n: Node) {
  const count = readersOf(n);
  if (count >= GRAPH_SIZE_WARN_AT) noteFanOut(n, count);
}
export const readersOf = (n: Node): number => kernelReaders(n);

abstract class Node<T = any> {
  // (Assigned, not class fields: a define on every node made is slower.)
  constructor() {
    this.value = undefined as T;
    this.staged = NONE;
    this.tx = null;
    this.observers = NO_OBSERVERS;
    this.height = 0;
    this.version = 0;
  }
  /** Its name (the `name` option, a store key): what diagnostics call it. */
  declare name?: string;
  declare value: T;
  declare staged: T | typeof NONE;
  declare tx: Transaction | null;
  /** Who reads it (one shared empty set until the first: most nodes never have one). */
  declare observers: Readers;
  declare height: number;
  get _name(): string {
    return this.name ?? (this instanceof Computation ? (this.kind === MEMO ? "computed" : "effect") : "signal");
  }
  /** Labelled as an owner is (a component's root labels itself so): its name. */
  set _name(name: string) {
    this.name = name;
  }
  /** Counts its changes: a reader compares it with the count it saw. */
  declare version: number;
  declare unobserved?: () => void;
  /** An optimistic value shown over the truth until its transaction commits (or its flush ends). */
  declare override: T | typeof NONE;
  /** The value in the world being read: an optimistic override, else staged while a pass runs, else committed. */
  current(): T {
    // (Its own truth landed over a guess: derivations and latest() read the truth; the screen keeps the guess.)
    if (this.override !== NONE && (this as any).truthLanded && (verdictReading || listener?.kind === MEMO)) return (this.staged !== NONE ? this.staged : this.value) as T;
    if (this.override !== NONE && !authoritative) {
      // (Development, an attribution engine installed: a run that read a guess is optimistic work.)
      if (listener !== null && attrHooks !== null) (listener as any).devGuess = true;
      const lane = (this as any).laneTx as Transaction | undefined;
      if (lane && !lane.done && listener) {
        // A derivation reading the guess is the lane's work; an effect reads the screen: not the guess until the lane
        // is revealed (then it runs again).
        // (Guesses of two lanes read by one derivation: one reveal unit, the lanes merged, A15.)
        if (listener.kind === MEMO) {
          const p = listener.passLane;
          listener.passLane = p && !p.done && p.root !== lane.root ? mergeTx(lane, p) : lane;
        } else {
          lane.stale.add(listener);
          listener.staleRead = true;
          return (!inPass || this.staged === NONE ? this.value : this.staged) as T;
        }
      }
      // (Development, an attribution engine installed: a guess read where it shows — a person saw it.)
      if (process.env.NODE_ENV !== "production" && attrHooks !== null && listener !== null && (!lane || lane.done)) (this as any).devGuessShown = true;
      return this.override as T;
    }
    // A derivation a lane re-ran, read by an effect: the effect runs again at the lane's reveal.
    const work = (this as any).passLane as Transaction | null | undefined;
    if (work && listener && listener.kind !== MEMO && !work.done) work.stale.add(listener);
    // A direct read sees a lane's work (as it sees its guess).
    if (!listener && this.staged !== NONE && this.tx && !this.tx.root.done && this.tx.root.parentTx) return this.staged as T;
    if (!inPass || this.staged === NONE) return this.value;
    if (!this.tx) {
      // (An action's write not yet held, read through latest(): on that action's lane as a held one is.)
      const by = listener ? ((this as any).writtenIn as Transaction | null | undefined)?.root : null;
      // (A first pass a lane's pass made: the screen — the action's write as committed — until that action commits.)
      if (by && !by.done && madeByLane(listener!, by)) return by.stale.add(listener!), (listener!.staleRead = true), ((listener as any).screenPass = true), this.value;
      const w = verdictReading ? by : null;
      return (w && !w.done ? heldRead(this, w) : this.staged) as T;
    }
    return heldRead(this);
  }
  /** A new value staged: committed at the flush's end, or held by a transaction. */
  stage(next: T) {
    this.staged = next;
    clock++;
    (this as any).stagedAt = clock;
    if (!this.tx) staged.push(this);
    // (A write to a node a transaction holds enters it: the round's plain writes go with it, A34.)
    else if (!(this instanceof Computation) && !this.tx.root.done) {
      enteredTx ??= this.tx.root;
      // (Development, an attribution engine installed: this flush holds that transaction too.)
      if (process.env.NODE_ENV !== "production" && attrHooks !== null && flushing && !heldThisFlush.has(this.tx.root)) pendingHolds.add(this.tx.root);
    }
    // Shown through a guess: its readers see the guess, not this (no change for them); the guess's end tells them if
    // the truth differs. Its own answer landing ends the guess for derivations (A18): they derive from the truth now.
    if (this.override !== NONE) {
      // (What asks the truth beneath the guess — an until() — hears it change.)
      for (const o of this.observers) if ((o as any).asksTruth) o.mark(DIRTY);
      // (One equal to the guess confirms it: nothing to re-derive.)
      if (landing && this instanceof Computation && !(this.equals !== false && this.equals(this.override as T, next))) {
        if (process.env.NODE_ENV !== "production" && attrHooks !== null && (this as any).devGuessShown) ((this as any).devGuessShown = false), attrHooks.optimisticReverted(this, this.override, next, "superseded");
        (this as any).truthLanded = true;
        this.version++;
        // (A guess never shown is voided with its lane, which re-derives what read it.)
        if ((this as any).laneTx?.done !== false) for (const o of this.observers) if (o.kind === MEMO) o.mark(DIRTY);
      }
      return;
    }
    this.version++;
    // Lane work: derivations follow now; effects at the lane's reveal.
    const lane = this.tx && !this.tx.root.done && this.tx.root.parentTx ? this.tx.root : null;
    // (A snapshot's readers in their scope read the snapshot: not run again until the scope is released.)
    const snapped = snapshotCapture && (this as any).snap !== undefined && (this as any).snap !== NONE;
    if (process.env.NODE_ENV !== "production") fanOut(this);
    for (const o of this.observers) {
      if (snapped && o.inSnapshot) o.snapshotStale = true;
      else lane && o.kind !== MEMO && !o.verdict?.has(this) ? lane.stale.add(o) : o.mark(DIRTY);
    }
  }
  /** The staged value made the committed one. */
  promote() {
    if (this.staged !== NONE) (this.value = this.staged as T), ((this as any).committed = true), (this as any).sources && ((this as any).frameSources = (this as any).sources);
    if (this.staged !== NONE) this.staged = NONE;
    if (this.tx) this.tx = null;
    if ((this as any).writtenIn) (this as any).writtenIn = null;
    if ((this as any).bornHeld) (this as any).bornHeld = false;
  }
  subscribe(o: Computation<any>) {
    addReader(this, o);
  }
  unsubscribe(o: Computation<any>) {
    dropReader(this, o);
    if (!readersOf(this)) this.unobserved?.();
  }
  /** Changed in place (a store key): its readers told. */
  bump() {
    this.version++;
    clock++;
    if (process.env.NODE_ENV !== "production") fanOut(this);
    for (const o of this.observers) o.mark(DIRTY);
  }
}

export class Signal<T> extends Node<T> {
  /** A write waiting for the next flush. */
  declare pending: T | typeof NONE;
  declare equals: Equals<T>;
  declare ownedWrite: boolean;
  constructor(value: T, options?: SignalOptions<T>) {
    super();
    this.value = value;
    this.pending = NONE;
    this.writtenIn = null;
    this.equals = options?.equals ?? Object.is;
    if (options?.unobserved) this.unobserved = options.unobserved;
    this.ownedWrite = !!options?.ownedWrite;
    if (options?.name) this.name = options.name;
  }
  read(): T {
    if (listener) listener.track(this);
    else {
      if (strictRead) strictReadUntracked(this);
      if (foreignRead) foreignRead(this);
      if (process.env.NODE_ENV !== "production" && tailFlights.size) postAwaitRead(this, this, undefined, this.name, false);
    }
    if (this.snap !== NONE && listener?.inSnapshot && snapshotCapture) {
      if (!Object.is(this.current(), this.snap)) listener.snapshotStale = true;
      return this.snap as T;
    }
    return this.current();
  }
  /** Its value when the hydrating pass first saw it (a user signal, while snapshots are taken). */
  declare snap: T | typeof NONE;
  /** The value it has now kept as its snapshot (once). */
  snapshot() {
    if (this.snap !== NONE) return;
    this.snap = this.current();
    snapshotSources!.add(this);
  }
  write(next: T) {
    guardWrite(this.ownedWrite, this);
    // (Told where it is made — its interaction or navigation still open — when it changes what the node would hold; a
    // store's key nodes are told by the store, where its writes are staged.)
    if (process.env.NODE_ENV !== "production" && attrHooks !== null && (this as any).record === undefined) {
      const now = (this.pending !== NONE ? this.pending : this.staged !== NONE ? this.staged : this.value) as T;
      if (this.equals === false || !this.equals(now, next)) attrHooks.write(this, now, next);
    }
    if (snapshotCapture && (this as any).snapshots) this.snapshot();
    if (halted) notifyHalted();
    if (this.pending === NONE) writes.push(this);
    this.pending = next;
    if (acting) this.writtenIn = acting.tx;
    else if (inPass && listener) this.writtenBy = listener;
    else if (!flushing) tickWrites.add(this);
    schedule();
  }
  /** The action whose transaction this write belongs to (held with it until the action ends). */
  declare writtenIn: Transaction | null;
  /** The computation whose compute made this write (held with it, if its run is). */
  declare writtenBy: Computation<any> | null;
  /** The pending write dropped (a subclass commits it its own way). */
  settle() {
    this.pending = NONE;
  }
  /** The pending write staged, if it changes the value. */
  commit() {
    // (Committed already, in the pass that wrote it.)
    if (this.pending === NONE) return;
    const next = this.pending as T;
    this.pending = NONE;
    const now = this.staged !== NONE ? (this.staged as T) : this.value;
    if (this.equals !== false && this.equals(now, next)) {
      // (Repeating a value a transaction holds is a proposal too: its tick enters that hold, A34.)
      if (this.staged !== NONE && this.tx && !this.tx.root.done) enteredTx ??= this.tx.root;
      return;
    }
    this.stage(next);
  }
}
Object.assign(Signal.prototype, { snap: NONE, snapshots: false });

/** A re-armed boundary making its fallback: what it reads directly must be ready. */
let fallbackFresh = 0;
/** Inside until()'s predicate: the authoritative reader, which never sees optimism (A17). */
let authoritative = 0;
export const isAuthoritative = () => authoritative > 0;

/** Whether a flush is running (a write staged now is promoted by it). */
export const isFlushing = () => flushing > 0;
/** Whether an action's step is running (its writes are held with its transaction). */
export const isActing = () => !!acting;

/** `n` tracked by what reads now, its value not read (a store key shown through an optimistic overlay). */
/** Whether an isPending()/latest() probe is reading. */
export const isVerdictReading = () => verdictReading > 0;

export function trackNode(n: Node<any>) {
  if (!listener) return;
  listener.track(n);
  // (Like a verdict read: what it shows is not the held write, so it joins no hold.)
  (listener.verdict ??= new Set()).add(n);
}

/** Whether something tracks what is read now. */
export const isTracking = () => listener !== null;

/** What another reactive system is told of a node read outside every computation here (how it follows Twist's). */
let foreignRead: ((node: { read(): unknown }) => void) | null = null;
export const setForeignRead = (fn: typeof foreignRead) => void (foreignRead = fn);
/** A store setter's write: the same guard as a signal's. */
export const guardStoreWrite = () => guardWrite(false);

/** What refresh() re-runs for a target that is not a memo's accessor (a derived store's proxy, say). */
const refreshables = new WeakMap<object, () => () => unknown>();
export const refreshTarget = (target: object, memo: () => () => unknown) => void refreshables.set(target, memo);

/** Writes in a reactive scope (a component body, a memo, a root being built) throw: they would re-run what read. */
function guardWrite(allowed: boolean, node?: { name?: string }) {
  if (allowed || !owner || (owner as any).allowWrites) return;
  if (process.env.NODE_ENV !== "production") emitDiagnostic(
    { code: "REACTIVE_WRITE_IN_OWNED_SCOPE", kind: "write", severity: "error", message: OWNED_WRITE_MESSAGE, ownerId: owner.id, ownerName: (owner as any).name, nodeName: node?.name, data: { operation: "setSignal" } },
    owner,
  );
  throw new Error(ownedWriteMessage(owner));
}

// ---------------------------------------------------------------- computations

const MEMO = 0;
const EFFECT = 1;
const RENDER = 2;

type Source = Node<any>;
const accessors = new WeakMap<Function, Computation<any>>();
/** Whether `f` reads a signal or memo of its own (not a plain function). */
export const isAccessor = (f: unknown) => typeof f === "function" && accessors.has(f);

/** The equals verdict a compute reached on what it answers (take() asks it once). */
let comparedBy: Computation<any> | null = null;
let comparedNow: unknown;
let comparedNext: unknown;
let comparedSame = false;

export class Computation<T> extends Node<T> implements Owner {
  declare parent: Owner | null;
  declare owned: Owner[] | null;
  declare cleanups: (() => void)[] | null;
  // (Set by a server component's scope; see server-internal.)
  declare context: Record<symbol, unknown> | null;
  declare disposed: boolean;
  /** Its place in the order computations run in (creation order). */
  declare order: number;
  declare id?: string;
  declare childCount: number;
  declare transparent?: boolean;
  declare kind: number;
  declare fn: (prev?: T) => T;
  declare state: number;
  // (These three are made anew by its first run: until then, one shared empty list.)
  declare sources: Source[];
  /** The transaction whose held values its last run read: what it computed is held in it. */
  declare readHeld: Transaction | null;
  /** The flush it was made in (made in this one: a first mount, no reveal). */
  declare born: number;
  /** What its last run read (while it runs again). */
  declare before: Source[];
  /** It asks isPending: it reads the screen, like a render effect. */
  declare verdictReader: boolean;
  /** The version of each source when it was read. */
  declare seen: number[];
  /** Sources read only through isPending/latest: what is shown ahead of a hold (they do not hold this). */
  declare verdict: Set<Source> | null;
  declare attached: boolean;
  declare ranAt: number;
  declare equals: Equals<T>;
  declare lazy: boolean;
  /** Has had a value (an async compute's first load has not). */
  declare ready: boolean;
  /** The flight in progress (its promise), and whether it is a quiet re-ask (refresh). */
  declare flight: object | null;
  declare quiet: boolean;
  /** Why its last run failed (an error read rethrows it). */
  declare error: unknown;
  /** The lane this pass is work of (it read a guess in an unrevealed lane), else null. */
  declare passLane: Transaction | null;
  /** The parent whose lane's reveal runs it next (and, while that run lasts, `revealing`). */
  declare revealOf: Transaction | null;
  /** The lane whose reveal runs it next, and the one it is running for. */
  declare laneOf: Transaction | null;
  declare revealingLane: Transaction | null;
  declare revealing: Transaction | null;
  /** This pass read the frame under a hold or an unrevealed lane (it runs again when that lands). */
  declare staleRead: boolean;
  declare heldOnly: boolean;
  /** An effect's apply half, what it last applied, and the cleanup it gave back. */
  declare apply?: (value: T, prev?: T) => void | (() => void);
  declare applied: T | typeof NONE;
  declare cleanup?: () => void;
  declare onError?: (err: unknown, cleanup: () => void) => void;
  /** An effect whose compute gave a new value: its apply is due. */
  declare due: boolean;
  /** A tracked effect (createTrackedEffect): its single function runs in the effect phase. */
  declare tracked: boolean;
  /** Its tracker of an external reactive library (enableExternalSource). */
  declare ext: ExternalSource | null;
  /** Made in a snapshot scope: it reads snapshots until the scope is released. */
  declare inSnapshot: boolean;
  /** It read a snapshot that has moved on: it runs again when its scope is released. */
  declare snapshotStale: boolean;
  constructor(kind: number, fn: (prev?: T) => T, options?: SignalOptions<T>) {
    ownerCreations++;
    super();
    if ((owner as any)?.tracked) {
      const message = "Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled";
      if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "PRIMITIVE_IN_FORBIDDEN_SCOPE", kind: "lifecycle", severity: "error", message: "[PRIMITIVE_IN_FORBIDDEN_SCOPE] " + message, ownerId: owner!.id, ownerName: (owner as any).name });
      throw new Error(message);
    }
    if (inEffectCallback && !owner) primitiveInEffectCallback();
    this.parent = owner;
    this.context = owner?.context ?? null;
    this.order = ids++;
    this.kind = kind;
    this.fn = fn;
    if (snapshotCapture) {
      if (!snapshotRoot && sharedConfig.hydrating && owner) {
        let top = owner;
        while (top.parent) top = top.parent;
        markSnapshotScope((snapshotRoot = top));
      }
      if (inSnapshotScope(owner)) this.inSnapshot = true;
    }
    if (externalSource) {
      const ext = (this.ext = externalSource.factory(fn, () => void (!this.disposed && (this.mark(DIRTY), schedule()))));
      this.fn = ext.track;
    }
    this.state = DIRTY;
    this.sources = this.before = NOTHING_YET as Source[];
    this.born = flushes;
    this.seen = NOTHING_YET as number[];
    this.attached = false;
    this.ranAt = -1;
    this.ready = false;
    if (owner) owner.owned ? owner.owned.push(this) : (owner.owned = [this]);
    if ((options as any)?.transparent && !this.transparent) this.transparent = true;
    if (options?.name) this.name = options.name;
    if ((options as any)?.id != null) this.id = (options as any).id;
    else giveId(this, owner);
    if (options?.equals !== undefined) this.equals = options.equals;
    if (options?.lazy) this.lazy = true;
    if ((options as any)?.sync) (this as any).sync = true;
    // (Development tools' marks: HMR plumbing, wide by construction, superseding its own flights by design.)
    if (process.env.NODE_ENV !== "production" && options) {
      if ((options as any)._plumbing) ((this as any).plumbing = true), (this.name = undefined);
      if ((options as any)._wide) (this as any).wide = true;
      if ((options as any)._rows) (this as any).rows = true;
      if ((options as any)._supersedes) (this as any).supersedes = true;
    }
    if ((options as any)?.deferStream) (this as any).deferStream = true;
    if ((options as any)?.sourceFn) (this as any).sourceFn = (options as any).sourceFn;
    if ((options as any)?.ssrSource) (this as any).ssrSource = (options as any).ssrSource;
    // Client-only, on a server: never ready there (its boundary hands it to the client).
    if (serverRender && (options as any)?.ssrSource === "client") this.fn = clientOnly;
    // Client-only, hydrating: not asked until the pass ends (the server rendered its loading value, or a fallback).
    else if (kind === MEMO && (options as any)?.ssrSource === "client" && sharedConfig.hydrating && this.inSnapshot && hydratesUnder(owner)) {
      const hydrated = hydrationFlag();
      const inner = this.fn;
      this.fn = (prev) => (hydrated() ? inner(prev) : (UNASKED as T));
    }
    // Its compute writes (a store's derive): not run while it takes the server's answer.
    if ((options as any)?.writes) (this as any).writes = true;
    // (What it does with each answer, and what a client is sent for one: set before its first run.)
    if ((options as any)?.onTake) this.onTake = (options as any).onTake;
    if ((options as any)?.answerOf) (this as any).answerOf = (options as any).answerOf;
    if (options?.unobserved) this.unobserved = options.unobserved;
    if (serverScope) this.scope = serverScope;
    if (serverRender) this.renderCtx = sharedConfig.context;
    // A declared first paint: born committed with it; its first flight is quiet (never pending, never held).
    if (options && "loadingValue" in options) {
      (this as any).declaredLoading = true;
      (this as any).committed = true;
      this.value = options.loadingValue as T;
      this.ready = true;
      this.loadingWindow = true;
    }
    DEV?.hooks.onOwner?.(this);
  }
  get _config() {
    return this.transparent ? CONFIG_TRANSPARENT : 0;
  }
  get _context() {
    return toolContext(this);
  }
  set _context(c) {
    this.context = c;
  }
  /** (Solid's parked frame as its tools read it: the first child and the cleanups a held rerun kept.) */
  get _x() {
    const p = (this as any).parked as Owner[] | null | undefined;
    return p?.length ? { _pendingFirstChild: liveFrom(p[0]!.owned, 0), _pendingDisposal: p[0]!.cleanups } : undefined;
  }
  /** (Solid's owner tree as its tools walk it: first child, next sibling; disposed ones skipped.) */
  get _firstChild(): Owner | null {
    return liveFrom(this.owned, (this.owned?.length ?? 0) - 1);
  }
  get _parent(): Owner | null {
    return this.parent;
  }
  get _nextSibling(): Owner | null {
    const o = this.parent?.owned;
    return o ? liveFrom(o, o.indexOf(this as any) - 1) : null;
  }
  /** Settles when the answer in flight lands or fails (what a server render waits on). */
  declare settles: Promise<void> | null;
  /** Its answers come from an async iterator: shown as they land, never revealed as one. */
  declare streaming: boolean;
  /** Its stream has answered in this flight (what shows is that answer, not a question still open). */
  declare streamed: boolean;
  /** It had an error and now has a value again (a change, whatever the value). */
  declare recovered: boolean;
  /** Serving its loading value until its first answer lands. */
  declare loadingWindow: boolean;
  /** Its value is a loading window's first answer, to the question its inputs ask now (until it runs again). */
  declare windowAnswer: boolean;
  /** Told each value it takes (a derived store reconciles an async answer into itself). */
  declare onTake?: (v: T) => void;
  /**
   * Autodisposed: a memo nothing owns, or a lazy one that lost its last reader. Read with nothing subscribed, it is
   * worked out again from scratch once anything has changed since it ran.
   */
  get autodispose() {
    return this.kind === MEMO && (this.lazy || !this.parent) && !readersOf(this);
  }
  track(source: Source) {
    if (verdictReading) (this.verdict ??= new Set()).add(source);
    if (!noteRead(this, source)) return;
    if (source.height >= this.height) this.height = source.height + 1;
    if (this.attached && !this.relinking?.has(source)) source.subscribe(this);
  }
  /** While it runs again: the sources it was subscribed to (kept when read again, let go after). */
  declare relinking: Set<Source> | null;
  /** In a parked frame: shown as it is, not run again. */
  declare dormant: boolean;
  /** The transaction holding the write this memo last ran for, if any (its frame is then a held pass). */
  declare heldPass: Transaction | null;
  /** The flush it failed in (a reader new to it in a later one tries it again). */
  declare erredAt: number;
  /** Its Loading boundary, once looked up (null: none). */
  declare boundary?: LoadingState | null;
  override subscribe(o: Computation<any>) {
    addReader(this, o);
    if (!this.attached) this.attach();
  }
  override unsubscribe(o: Computation<any>) {
    dropReader(this, o);
    if (readersOf(this)) return;
    this.unobserved?.();
    // A lazy memo with no reader left is torn down as the flush ends (unless read again by then); an unowned one whose
    // last reader was released goes with it.
    if (this.lazy) unread.add(this), schedule();
    else if (releasing && this.kind === MEMO && !this.parent) release(this);
  }
  /** Released: subscribed to nothing, built again from scratch when next read. */
  declare released: boolean;
  /** Holds state across runs (a mapped list): never released. */
  declare kept: boolean;
  attach() {
    this.attached = true;
    if (this.ranAt !== clock && this.state === CLEAN) this.state = CHECK;
    for (const s of this.sources) s.subscribe(this);
  }
  detach() {
    this.attached = false;
    for (const s of this.sources) s.unsubscribe(this);
  }
  /** Disposes what it owns, and itself unless `self` is false. */
  dispose(self = true) {
    if (!self) return disposeOwned(this);
    dispose(this);
    if (this.parent?.owned) remove(this.parent.owned, this);
  }
  /** Disposed: its subscriptions, its flight and its effect's cleanup let go. */
  end() {
    const close = this.closeStream;
    if (close) (this.closeStream = null), close();
    if (this.attached) this.detach();
    this.sources = NOTHING_YET as Source[];
    this.seen = NOTHING_YET as number[];
    if (this.flight) (this.flight = null), flights.delete(this);
    const c = this.cleanup;
    if (c) (this.cleanup = undefined), c();
    if (this.ext) this.ext.dispose(), (this.ext = null);
  }
  /** Something it read changed (DIRTY), or may have through a memo (CHECK): queued, and its readers told. */
  mark(state: number) {
    if (this.state >= state || this.disposed || this.dormant) return;
    const was = this.state;
    this.state = state;
    if (was !== CLEAN) return;
    if (!(this.lazy && !readersOf(this))) queue(this);
    // (A derived store's derive answers the same each run: its readers hear of its writes through the keys, of a
    // failure when it fails.)
    if (!(this as any).writes) for (const o of this.observers) o.mark(CHECK);
  }
  /** The commit epoch of the frame render it last computed in (a later epoch computes it again: Solid's per-commit cache). */
  declare epoch: number | undefined;
  read(): T {
    if (strictRead && !listener) strictReadUntracked(this);
    if (this.epoch !== undefined && this.state === CLEAN && !this.flight) {
      const at = this.renderCtx?.commitEpoch?.();
      if (at !== undefined && at !== this.epoch) this.state = DIRTY;
    }
    if (!this.disposed) {
      // Failed in an earlier flush, read by a reader new to it: tried again (not for untracked reads or probes).
      if (this.error !== NONE && listener && !verdictReading && this.kind === MEMO && this.erredAt !== cycle() && !listener.before.includes(this)) {
        this.error = NONE;
        this.state = DIRTY;
      }
      // Released at a flush (read with nothing subscribed): built again from scratch.
      // (Nothing changed since it ran: subscribed again as it was.)
      if (this.released) {
        this.released = false;
        if (this.ranAt === clock && this.state !== DIRTY) this.attach();
        else this.state = DIRTY;
      }
      flewBefore = !!this.flight;
      this.update();
      // An unowned memo read outside any computation, with nothing subscribed: released at the next flush.
      if (!listener && this.kind === MEMO && !this.parent && !readersOf(this)) untrackedReads.add(this);
    }
    if (listener) {
      // A render effect first to observe a flight whose question a transaction holds: the transaction waits on it.
      const first = this.flight && this.ready && !(this as any).bornHeld && listener.kind === RENDER && !rendered(this);
      listener.track(this);
      if (first) for (const s of this.sources) if (s.tx && !s.tx.done) s.tx.root.flights.add(this);
      // (Read by what a held pass made: the transaction that holds it waits on it too.)
      if (!this.streaming && !this.loadingWindow && !verdictReading && (this.flight || (!this.ready && inFlight(this)))) {
        const t = heldAbove(listener);
        if (t && !t.flights.has(this)) t.flights.add(this), heldReads.add(this), statusChanged();
      }
    } else {
      if (foreignRead) foreignRead(this);
      // (One never loaded throws instead, and is reported when it does; a derived store's own derive is not its state.)
      if (process.env.NODE_ENV !== "production" && tailFlights.size && !(this as any).writes) postAwaitRead(this, this, undefined, this.name, !this.ready && this.override === NONE);
    }

    if (this.error !== NONE) throw this.error;
    // Refetching, read directly in a strict scope (a component body), in the browser: an error saying so — what it
    // shows now is about to change, and nothing there would show the change.
    if (this.flight && this.ready && !this.streaming && this.override === NONE && strictRead && !listener && !verdictReading && !serverRender && process.env.NODE_ENV !== "production") pendingUntrackedRead(this);
    // An authoritative reader asks the truth: a refetch with nothing landed for its question has none yet (A17).
    if (authoritative && !this.loadingWindow && this.flight && this.ready && !this.streaming && this.staged === NONE && this.override === NONE) throw new NotReadyError(this);
    // A re-armed boundary's fallback, made now, reading a refetch: not ready (its swap waits for it, the content stays).
    if (fallbackFresh && !listener && this.flight && this.ready && !this.streaming && this.override === NONE) throw new NotReadyError(this);
    // Never had a value (a first load, or waiting on one): not ready. (Read directly in a strict scope, in the
    // browser: an error saying so — nothing would show it when it lands.)
    if (!this.ready && !(inPass && this.staged !== NONE) && this.override === NONE) {
      if (serverRender && (this as any).ssrSource === "client") clientHoleRead();
      if (strictRead && !listener && !serverRender && process.env.NODE_ENV !== "production") pendingUntrackedRead(this);
      throw new NotReadyError(this);
    }
    // A fresh derivation reading a flight a transaction waits on suspends on it (A15).
    // (A resolve() reading one this read itself set off, or a quiet re-ask its action marked: its last answer, stale
    // while it revalidates — the mark still gates the commit.)
    // (A first pass shown under a Loading that has not shown its content: the boundary catches it, its fallback shows.)
    if (listener && (listener.kind === MEMO || ((listener as any).resolving && flewBefore && !(this.quiet && (this as any).affected)) || (listener.kind === RENDER && freshBoundary(listener))) && listener.ranAt === -1 && !verdictReading && this.flight && this.override === NONE && !this.loadingWindow && !this.streaming) throw new NotReadyError(this);
    // Born held: nothing committed to serve outside a pass.
    if ((this as any).bornHeld && !inPass && this.override === NONE) throw new NotReadyError(this);
    return this.current();
  }
  /** Brought up to date: run again if something it read changed (memos it read brought up to date first). */
  update() {
    if (this.tracked && this.state !== CLEAN) {
      if (this.state === CHECK) {
        for (let i = 0; i < this.sources.length; i++) {
          const s = this.sources[i]!;
          if (s instanceof Computation) s.update();
          if (s.version !== this.seen[i]) {
            this.state = DIRTY;
            break;
          }
        }
        if (this.state === CHECK) return void (this.state = CLEAN);
      }
      if (!this.due) (this.due = true), applies[EFFECT].push(this);
      return;
    }
    if (this.state === CHECK) {
      for (let i = 0; i < this.sources.length; i++) {
        const s = this.sources[i]!;
        if (s instanceof Computation) s.update();
        // An effect reading a guess or lane work: it runs at the lane's reveal.
        // (Read through latest() or isPending: it sees the lane now.)
        const lane = this.kind === MEMO || this.verdict?.has(s) ? null : s.override !== NONE ? unrevealed((s as any).laneTx) : s.tx && unrevealed(s.tx.root.parentTx ? s.tx.root : null);
        if (lane && s.version !== this.seen[i]) {
          lane.stale.add(this);
          continue;
        }
        if (s.version !== this.seen[i]) {
          this.state = DIRTY;
          break;
        }
      }
      if (this.state === CHECK) (this.state = CLEAN), (this.ranAt = clock);
    }
    if (this.state === DIRTY) this.run();
  }
  /** The server render it was made in (it runs in it again when a landing re-runs it outside). */
  declare scope: ServerScope | null;
  /** The render context it was made in (a frame render's: an answer landing there is a commit the response sends on). */
  declare renderCtx: any;
  run() {
    const s = this.scope;
    if (s && serverScope?.key !== s.key) s.enter(() => this.runIn());
    else this.runIn();
    // An effect's last frame goes once its new pass ran — unless the pass is held: then at the round. A pass over an
    // answer just landed may be held by the round: its frame goes once the round decided, before the new side effects.
    // (A render effect that left a hold showed the committed frame: its pass replaces the one shown.)
    const left = (this as any).leftHold;
    if (this.kind === MEMO || !(this as any).parked || this.tx || !((!this.readHeld && !this.staleRead) || left)) return;
    if (left || this.sources.some((s) => s instanceof Computation && (s.staged !== NONE || s.flight))) effectDrains.push(this);
    else drainParked(this as any);
  }
  runIn() {
    // (Development, an attribution engine installed: told when it starts — its sources still the last run's — and ends.)
    const h = process.env.NODE_ENV !== "production" ? attrHooks : null;
    if (h === null) return this.runBody();
    const create = this.ranAt === -1;
    (this as any).devChanged = false;
    (this as any).devGuess = false;
    (this as any)._devWindows = 0;
    h.recomputeStart(this, create);
    try {
      this.runBody();
    } finally {
      // (A derived store's derive does its work on the store: never an unchanged run.)
      h.recomputeEnd(this, create, !!(this as any).devChanged || !!(this as any).writes, !!(this as any).devGuess || !!this.passLane || !!this.revealingLane, !!this.tx || !!this.readHeld, !!this.tx);
    }
  }
  runBody() {
    if (TRACE && ++runs % 100000 === 0) trace(`runs ${runs} kind ${this.kind} order ${this.order}`);
    if (this.passLane) this.passLane = null;
    if (this.revealing !== this.revealOf) this.revealing = this.revealOf;
    if (this.revealOf) this.revealOf = null;
    if (this.revealingLane !== this.laneOf) this.revealingLane = this.laneOf;
    if (this.laneOf) this.laneOf = null;
    if (this.staleRead) this.staleRead = false;
    if ((this as any).readGuess) (this as any).readGuess = false;
    // Run again only for what a hold or a guess changed (nothing on screen moved)?
    const heldOnly = this.sources.length > 0 && this.sources.every((s, i) => s.version === this.seen[i] || s.override !== NONE || (!!s.tx && !s.tx.root.done) || ((s as any).writtenIn && !(s as any).writtenIn.root.done));
    if (heldOnly !== this.heldOnly) this.heldOnly = heldOnly;
    // (Run again by the pending status alone — not a lane's reveal: an effect showing the same value applies nothing.)
    const fromCommit = (this as any).fromCommit;
    if (fromCommit) (this as any).fromCommit = false;
    const statusOnly = this.kind !== MEMO && !fromCommit && !this.revealing && !this.revealingLane && this.sources.length > 0 && this.sources.every((s, i) => s === status || s.version === this.seen[i]);
    if (statusOnly !== (this as any).statusOnly) (this as any).statusOnly = statusOnly;
    // (A quiet re-ask overtaken by a new question: the new one is not quiet.)
    if (this.quiet && this.sources.some((s, i) => s.version !== this.seen[i])) this.quiet = false;
    // A render effect a transaction holds, run again by a change outside it: it leaves the hold and shows the committed
    // frame now (A26), running again at the commit.
    if (this.kind === RENDER && this.tx && !this.tx.root.done && !heldOnly) {
      const t = this.tx.root;
      t.nodes.delete(this);
      t.effects.delete(this);
      t.stale.add(this);
      this.tx = null;
      (this as any).leftHold = true;
      if (this.staged !== NONE) this.staged = NONE as any;
      // (Its held apply was taken off the queue: what it computes now is queued afresh.)
      if (this.due) this.due = false;
    }
    // (The answer it waited on is stale now: one its cleanups give changes nothing.)
    if (this.flight && !this.streaming) (this.flight = null), flights.delete(this);
    // (Run again for a held write: the committed frame parked, rendering until the commit; a held pass's own frame,
    // or any other, let go now.)
    if (flushing) {
      // (A pass not committed yet — staged, or held — made what it owns: that goes now; the frame shown stays parked.)
      if ((this as any).parked || this.staged !== NONE) disposeOwned(this);
      else if (this.owned || this.cleanups) parkFrame(this), swaps.push(this);
      else if ((this as any)._signals) (this as any)._signals = undefined;
    } else disposeOwned(this);
    if (this.childCount) this.childCount = 0;
    // (Run again: the stream it read is let go.)
    const close = this.closeStream;
    if (close) (this.closeStream = null), close();
    // Its old sources stay subscribed through the run (a lazy memo read again keeps its reader); the rest let go after.
    const relinking = this.attached && this.sources.length ? new Set(this.sources) : null;
    if (relinking) this.relinking = relinking;
    this.before = this.sources;
    const seenBefore = this.seen;
    this.sources = NOTHING_YET as Source[];
    if (this.windowAnswer) this.windowAnswer = false;
    if (this.readHeld) this.readHeld = null;
    this.seen = NOTHING_YET as number[];
    if (this.verdict) this.verdict = null;
    if (!this.attached) this.attached = true;
    const prevOwner = owner;
    const prevListener = listener;
    const prevStrict = strictRead;
    owner = this;
    listener = this;
    strictRead = false;
    // (Its own reads are its own: a status probe that pulled it does not make them status reads.)
    const prevVerdict = verdictReading;
    verdictReading = 0;
    inPass++;
    let next: T;
    let threw: unknown = NONE;
    try {
      // Hydrating: what the server sent under this node's id is its first answer (hydrate() installs this).
      const sent = hydrationRuns ? hydrationRuns.sent(this) : NONE;
      if (sent !== NONE) {
        next = hydrationRuns!.adopt(this, sent);
      } else {
        const handoff = (this as any).handoff;
        if (this.ranAt !== -1) (this as any).live = true;
        next = this.fn(this.current());
        if ((this as any).sync && process.env.NODE_ENV !== "production" && next && (typeof (next as any).then === "function" || typeof (next as any)[Symbol.asyncIterator] === "function")) syncGotAsync(this, typeof (next as any).then === "function");
        // (Taking over the server's stream: its first yield repeats the server's answer, and is dropped.)
        if (handoff) {
          (this as any).handoff = false;
          if (!(this as any).writes && next && typeof (next as any)[Symbol.asyncIterator] === "function" && typeof (next as any).then !== "function") next = hydrationRuns!.dropFirst(next as any, this.current()) as T;
        }
        // (A live source taking over from the server's answer: it resumes from what shows.)
        if ((this as any).liveTakeover) {
          (this as any).liveTakeover = false;
          if (next && typeof next === "object" && (next as any)[LIVE_SOURCE]) (next as any)[LIVE_RESUME_FROM] = this.current();
        }
        // (An async iterable's first step runs here: what it reads before its first await is tracked.)
        // (On a server, a slot answered on an earlier pass is not started again.)
        if (next && typeof (next as any)[Symbol.asyncIterator] === "function" && typeof (next as any).then !== "function" && !(serverRender && (sourceTees.has(next as any) || (serverAnswers && (this as any).id != null && serverAnswers.has((this as any).id))))) next = primed((serverRender ? shared(next as any) : next) as any) as T;
      }
      // Its equals comparator is part of the compute: a throw there is the compute's error (A3), not the flush's.
      if (this.ready && typeof this.equals === "function" && !(next && typeof (next as any).then === "function")) {
        const now = this.staged !== NONE ? (this.staged as T) : this.value;
        comparing = this;
        const same = this.equals(now, next!);
        comparing = null;
        (comparedBy = this), (comparedNow = now), (comparedNext = next!), (comparedSame = same);
      }
    } catch (e) {
      threw = e;
      stampThrower(e, this);
    } finally {
      owner = prevOwner;
      listener = prevListener;
      strictRead = prevStrict;
      verdictReading = prevVerdict;
      inPass--;
      if (relinking) this.relinking = null;
      if (relinking) {
        const dropped = [...relinking].filter((s) => !this.sources.includes(s));
        // (A memo run in a flush that may hold it: whether its committed frame still follows what it read is decided at
        // the round's end — kept until the commit if held, A30.)
        if (dropped.length && this.kind !== EFFECT && flushing) trims.push([this, dropped, dropped.map((d) => seenBefore[this.before.indexOf(d)]!)]);
        else for (const s of dropped) s.unsubscribe(this);
      }
    }
    // (A first pass joining a hold makes the pass that created it part of the hold: membership is the tick's.)
    const firstPass = this.ranAt === -1;
    if (this.readHeld && firstPass && prevListener === this.parent && prevListener && !prevListener.tx && !prevListener.readHeld) prevListener.readHeld = this.readHeld;
    this.state = CLEAN;
    this.ranAt = clock;
    // (A list's rows memo reads each item by construction: the insert that resolves them is the fan-in told.)
    if (process.env.NODE_ENV !== "production" && this.sources.length >= GRAPH_SIZE_WARN_AT && !(this as any).rows) noteFanIn(this, this.sources.length);
    if (threw !== NONE) {
      // Waiting on a first load upstream: still not ready (its readers wait too); the Loading above shows its fallback.
      if (threw instanceof NotReadyError) {
        // (A retry of a settled error, parked: that error stays the answer until the retry lands.)
        if (!((this as any).declaredLoading && this.error !== NONE)) this.error = NONE;
        // (What it waits on, for a server render to wait too.)
        (this as any).waitsFor = threw;
        if (this.kind === MEMO) (this as any).pendingPass = true;
        // Waiting on a promise its code named: run again when it settles.
        const p = threw.source as any;
        if (p && typeof p.then === "function") {
          const at = this.ranAt;
          const again = () => !this.disposed && this.ranAt === at && (this.mark(DIRTY), schedule());
          p.then(again, again);
        } else if (p instanceof Computation && p !== this && !this.sources.includes(p)) {
          // Waiting on one it read untracked: run again when that one answers.
          (p.untrackedReaders ??= new Map()).set(this, this.ranAt);
        }
        if (this.kind !== MEMO) {
          const b = boundaryOf(this);
          // (Under a boundary that has shown its content, waiting on a refetch a transition waits on: the pass is that
          // transition's — it runs again at the commit, and no fallback shows, #3540.)
          const t = b && !b.fresh ? waitedRefetch(threw.source) : null;
          if (t) {
            t.stale.add(this), (this.staleRead = true);
            // (Made by the pass running now: that pass is the transition's too.)
            if (firstPass && prevListener === this.parent && prevListener && !prevListener.tx && !prevListener.readHeld) prevListener.readHeld = t;
          } else if (b) b.wait(this);
          else if (this.kind === RENDER && enforcing) unhandledAsync(this);
        }
        return;
      }
      this.error = threw;
      this.erredAt = cycle();
      this.version++;
      if ((this as any).writes) for (const o of this.observers) o.mark(DIRTY);
      // Failed: no longer waiting (the Loading above lets the error through to whatever catches it).
      boundaryOf(this)?.ready(this);
      if (this.kind !== MEMO) handleError(this, threw);
      // (Its comparator threw: the boundary it is made under hears it at once, before what made it runs again.)
      else if (comparing === this) (comparing = null), boundaryCatches(this, threw);
      return;
    }
    // (Answered after a pending pass: the frame it kept shown goes at the round.)
    if ((this as any).pendingPass) ((this as any).pendingPass = false), (this as any).parked && swaps.push(this);
    // Recovered from an error: a value again is a change, even the one it had before.
    if (this.error !== NONE) (this.error = NONE), (this.recovered = true);
    // (The boundary that caught its error shows its content again, #2949.)
    const recover = (this as any).recoverTo;
    if (recover) ((this as any).recoverTo = null), recover();
    boundaryOf(this)?.ready(this);
    // An async answer: in flight, its old value kept meanwhile.
    if (next! && typeof (next as any).then === "function") return this.fly(next as any);
    if (next! && typeof (next as any)[Symbol.asyncIterator] === "function") {
      // (On a server, its first value is the answer: a render tried again reads it like a promise's.)
      if (serverRender) return serverHooks!.stream(this, next as any);
      return this.stream(next as any);
    }
    if (this.flight) (this.flight = null), flights.delete(this);
    this.take(next!);
    // (After its own staging ticked the clock: it is current.)
    this.ranAt = clock;
    // In a frame render: computed for this commit epoch.
    if (this.kind === MEMO && this.renderCtx?.commitEpoch) this.epoch = this.renderCtx.commitEpoch();
    this.wake();
  }
  /** Taking a value threw: that is its error now, its readers told. */
  takeFailed(e: unknown) {
    stampThrower(e, this);
    this.error = e;
    this.erredAt = cycle();
    this.version++;
    clock++;
    for (const o of this.observers) o.mark(DIRTY);
    statusChanged();
  }
  /** A value it computed or that landed: staged (or committed outside a flush), its readers told if it changed. */
  take(next: T) {
    // A loading window's first answer is a first load: committed on arrival, whatever holds what re-asked it.
    if (this.loadingWindow) {
      this.loadingWindow = false;
      (this as any).revealNow = true;
      this.windowAnswer = true;
      if (this.tx) this.tx.nodes.delete(this), (this.tx = null);
    }
    if (this.onTake)
      try {
        this.onTake(next);
      } catch (e) {
        // (What it does with the value threw: its error, as the compute's would be.)
        return this.takeFailed(e);
      }
    const first = !this.ready;
    const now = this.staged !== NONE ? (this.staged as T) : this.value;
    // (Compared already by the compute that made it: once.)
    const compared = comparedBy === this && comparedNow === now && comparedNext === next;
    comparedBy = null;
    let changed: boolean;
    try {
      changed = first || this.recovered || this.equals === false || !(compared ? comparedSame : this.equals(now, next));
    } catch (e) {
      // (Its comparator threw on what landed: its error, A3.)
      return this.takeFailed(e);
    }
    this.ready = true;
    if (this.recovered) this.recovered = false;
    if (process.env.NODE_ENV !== "production" && attrHooks !== null) (this as any).devChanged = changed;
    if (this.kind !== MEMO) {
      // (An effect applies whenever its compute ran again: it ran because something it read changed.)
      // (A pass that read the frame and found what it shows already applies nothing: it runs again at the reveal.)
      const shown = this.staleRead && this.heldOnly && this.applied !== NONE && this.equals !== false && this.equals(this.applied as T, next);
      if (!shown && (changed || this.applied === NONE || (this.equals === Object.is && !(this as any).statusOnly))) {
        // (An until() of an action reads the held world and answers now: never held itself.)
        // (One showing a store's guess shows it now: the guess is not held.)
        const joins = this.readHeld && !this.tx && !(this as any).insideTx && !showsGuess(this) ? this.readHeld : null;
        // (Nothing reads an effect: staged only for a transaction to hold.)
        if (this.tx || joins || (flushing && transactions.size)) this.staged = next;
        else this.value = next;
        if (flushing && !this.tx && !joins && transactions.size) staged.push(this);
        if (!this.due) (this.due = true), applies[this.kind as 1 | 2].push(this);
        if (joins) hold(this, joins);
      }
      return;
    }
    // (Served a held world, even to the same value: it enters that hold, and the write that ran it with it, A29.)
    if (!changed) return void (this.readHeld && !this.tx && !this.readHeld.root.done && flushing && hold(this, this.readHeld));
    // (A memo's new value: a cause for what reads it, chained to what changed before it.)
    if (process.env.NODE_ENV !== "production" && attrHooks !== null && !first) attrHooks.derivedChanged(this);
    // Lane work: held in its lane (revealed with it).
    if (this.passLane && !this.passLane.done && !this.tx) hold(this, this.passLane);
    // Derived from a held world: held with it (born held when it never committed a value).
    if (this.readHeld && !this.tx) hold(this, this.readHeld), first && ((this as any).bornHeld = true);
    if (flushing || this.tx) this.stage(next);
    else (this.value = next), this.version++, clock++, ((this as any).committed = true), ((this as any).frameSources = this.sources);
    // (Its first answer, come at once: what waited on it untracked runs again, as for an answer that landed.)
    if (first && this.untrackedReaders) this.rerunReaders();
  }
  /**
   * An answer still to come: in flight until it lands. A thenable that answers while `then` is called (a sync
   * thenable) is not in flight at all: its value is taken at once.
   */
  fly(p: PromiseLike<T>, streamed = false): void {
    // (On a server: what the render already knows, and what the client is sent — the server entry's.)
    if (serverRender && serverHooks!.preFly(this, p, streamed)) return;
    const flight = {};
    this.streaming = false;
    this.settles = serverRender ? serverHooks!.settles(this, p) : Promise.resolve(p).then(noop, noop);
    let sync = true;
    let early: [boolean, unknown] | null = null;
    this.flight = flight;
    if (process.env.NODE_ENV !== "production" && attrHooks !== null) attrHooks.flightStart(this, p as object);
    (process.env.NODE_ENV !== "production" && !serverRender ? watchAsyncTail(this, flight, p) : p).then(
      (v) => (sync ? (early = [true, v]) : this.flight === flight && this.land(v)),
      (e) => (sync ? (early = [false, e]) : this.flight === flight && this.fail(e)),
    );
    sync = false;
    if (early) {
      this.flight = null;
      const [ok, v] = early as [boolean, unknown];
      // (Answered at once with an async source: read as it comes.)
      if (ok && !serverRender && v && typeof v === "object" && typeof (v as any)[Symbol.asyncIterator] === "function" && typeof (v as any).then !== "function") return this.stream(v as any);
      if (ok) return this.take(v as T);
      return this.failNow(v);
    }
    flights.add(this);
    // (A first run's flight outside every transition: the mount frame's, decided at the flush.)
    if (!this.ready && !this.tx && !this.passLane && !acting && !serverRender && !(this as any).writes) mountFlights.push(this);
    // Asked again by an action (a refresh there): the action's transaction waits for this answer.
    const joins = (this as any).joins as Transaction | undefined;
    if (joins && !joins.done) joins.flights.add(this), ((this as any).joins = undefined);
    // Lane work in flight: its lane waits for it.
    if (this.passLane && !this.passLane.done) {
      if (!this.ready) (this as any).bornHeld = true;
      hold(this, this.passLane), this.passLane.flights.add(this);
    } else if (this.readHeld && !this.readHeld.root.done && !this.tx && this.ready) {
      // Asked again from a held world: the transaction holding it waits for the answer (a first load never holds it).
      hold(this, this.readHeld), this.readHeld.root.flights.add(this);
    }
    statusChanged();
  }
  /** Lets go of the iterator a stream reads (when it is disposed). */
  declare closeStream: (() => void) | null;
  /** Values to come from an async iterator: each taken when it lands (at once, when it answers synchronously). */
  stream(iterable: AsyncIterable<T>) {
    const flight = {};
    this.flight = flight;
    this.streaming = true;
    // (A stream is no first answer a mount frame waits on.)
    for (const t of transactions) if ((t as any).mount) t.flights.delete(this);
    let first = noop;
    this.settles = new Promise<void>((r) => (first = r));
    let it = iterable[Symbol.asyncIterator]();
    // (Let go: what the iterator still answers is stale, its return() answering included.)
    let stopped = false;
    this.closeStream = () => ((stopped = true), void Promise.resolve(it.return?.()).catch(noop));
    let yielded = false;
    this.streamed = false;
    let inRun = true;
    const step = () => {
      let sync = true;
      let early: [boolean, unknown] | null = null;
      const onValue = (r: IteratorResult<T>) => {
        first();
        if (this.flight !== flight || stopped) return;
        if (r.done) {
          this.flight = null;
          flights.delete(this);
          if (!yielded) inRun ? this.take(undefined as T) : landings.push([this, undefined]);
          statusChanged();
          landNow();
          const after = (this as any).afterStream;
          if (after) ((this as any).afterStream = null), after();
          return;
        }
        yielded = this.streamed = true;
        // (A lazy memo nothing reads any more: the stream it kept open is closed as its value comes, nothing more pulled.)
        if (!inRun && this.lazy && !readersOf(this)) {
          this.flight = null;
          flights.delete(this);
          this.closeStream?.();
          this.closeStream = null;
          this.state = DIRTY;
          return statusChanged();
        }
        if (inRun) this.take(r.value);
        else landings.push([this, r.value]), landNow(), this.wake();
        // (Hydrating from the server's stream: only its first value in this pass.)
        if (inRun && (this as any).sentStream) {
          (this as any).sentStream = false;
          // (What it buffered after lands as one update: its latest.)
          it = conflated(it);
          return void queueMicrotask(step);
        }
        step();
      };
      const onError = (e: unknown) => {
        first();
        if (this.flight !== flight || stopped) return;
        this.flight = null;
        flights.delete(this);
        inRun ? this.failNow(e) : this.fail(e);
      };
      // (A next() may answer a bare result, or throw: taken at once.)
      let next: any;
      try {
        next = it.next();
      } catch (e) {
        early = [false, e];
      }
      if (!early && next && typeof next.then === "function")
        next.then(
          (r: IteratorResult<T>) => (sync ? (early = [true, r]) : onValue(r)),
          (e: unknown) => (sync ? (early = [false, e]) : onError(e)),
        );
      else early ??= [true, next];
      sync = false;
      if (early) {
        const [ok, v] = early as [boolean, unknown];
        const land = () => (ok ? onValue(v as IteratorResult<T>) : onError(v));
        // (A loading window hydrating: the server drew the loading value, so the claim does too; the value lands after.)
        inRun && claimLater ? queueMicrotask(land) : land();
      }
    };
    const claimLater = this.loadingWindow && sharedConfig.hydrating;
    step();
    inRun = false;
    if (this.flight === flight) flights.add(this), statusChanged();
  }
  /** Failed while running: the error is its value's reason (readers rethrow it). */
  failNow(e: unknown) {
    this.error = e;
    this.erredAt = cycle();
    this.version++;
    if (this.kind !== MEMO) handleError(this, e);
  }
  land(v: T) {
    // (A source split for a server render: read as its stream, in that render.)
    const tee = v && typeof v === "object" ? sourceTees.get(v as object) : undefined;
    if (tee) return void (this.scope ? this.scope.enter(() => serverHooks!.stream(this, v as any, tee)) : serverHooks!.stream(this, v as any, tee));
    // (Answered with an async source: its values are the answer, read as they come.)
    if (!serverRender && v && typeof v === "object" && typeof (v as any)[Symbol.asyncIterator] === "function" && typeof (v as any).then !== "function") {
      const close = this.closeStream;
      if (close) (this.closeStream = null), close();
      return void this.stream(v as any);
    }
    this.flight = null;
    flights.delete(this);
    landings.push([this, v]);
    statusChanged();
    this.rerunReaders();
    landNow();
    this.wake();
    this.renderCtx?.commit?.();
  }
  fail(e: unknown) {
    // Rejected with a read not ready: pending again when it reads that source (its settling runs it again); a source
    // first read after an `await` it does not track, and nothing would ever run it again — an error, said plainly.
    if (e instanceof NotReadyError) {
      const src = e.source as any;
      if (src && this.sources.includes(src)) {
        this.flight = null;
        flights.delete(this);
        statusChanged();
        return;
      }
      e = new Error(
        "Read of an unresolved async source after an `await`. Reads inside async computations only register as dependencies before the first `await`; a source first read after it cannot retry when it settles. Read it before the first `await` (or restructure so the value is an input).",
      );
    }
    stampThrower(e, this);
    this.flight = null;
    flights.delete(this);
    this.error = e;
    this.erredAt = cycle();
    this.version++;
    clock++;
    for (const o of this.observers) o.mark(DIRTY);
    statusChanged();
    this.rerunReaders();
    landNow();
    this.wake();
  }
  /**
   * Computations that read it untracked while it had no answer (waiting, not subscribed): run again in the flush its
   * answer lands in, once.
   */
  declare untrackedReaders: Map<Computation<any>, number> | null;
  rerunReaders() {
    const readers = this.untrackedReaders;
    if (!readers) return;
    this.untrackedReaders = null;
    for (const [r, at] of readers) if (!r.disposed && r.ranAt === at) r.mark(DIRTY);
  }
  /** Who waits for its next answer (a refresh's promise): each told, those still waiting kept. */
  declare waiters: (() => boolean)[] | null;
  wake() {
    const w = this.waiters;
    if (!w) return;
    this.waiters = null;
    const rest = w.filter((f) => !f());
    if (rest.length) (this.waiters ??= []).push(...rest);
  }
  /** An effect's apply half, untracked and unowned, after its last cleanup. */
  runApply() {
    if (!this.due || this.disposed) return;
    // (Behind a fallback, after its first: it waits for the reveal.)
    // (A first apply too, when the pass that made it waits there: it shows with it.)
    const p = this.parent;
    if (!this.tracked && (this.applied !== NONE || this.kind === EFFECT || (p instanceof Computation && p.due))) {
      const b = behindFallback(this);
      if (b && (this.applied !== NONE || this.kind === EFFECT || b.heldRuns.has(p as Computation<any>))) return void b.heldRuns.add(this);
    }
    if (this.tracked) {
      this.due = false;
      this.state = DIRTY;
      this.run();
      this.due = false;
      remove(applies[EFFECT], this);
      return;
    }
    this.due = false;
    // (Render effects its pass made, their first apply deferred to the flush: before it, as made.)
    if (this.kind === RENDER && this.owned) applyMadeFirst(this);
    this.promote();
    const prev = this.applied === NONE ? undefined : this.applied;
    this.applied = this.value as T;
    const c = this.cleanup;
    if (c) this.cleanup = undefined;
    let done: unknown;
    const wasIn = inEffectCallback;
    const prevOwner = owner;
    const prevListener = listener;
    inEffectCallback = true;
    const prevStrict = strictRead;
    const h = process.env.NODE_ENV !== "production" ? attrHooks : null;
    if (h !== null) h.effectRunStart(this);
    try {
      c?.();
      // (Unowned and untracked: what it reads there will not make it run again.)
      owner = listener = null;
      strictRead = "an effect callback";
      done = this.apply!(this.value as T, prev);
    } catch (e) {
      // The effect's own code threw: not its error handler's (that is for its compute) — the nearest boundary, else
      // the system halts (A5).
      escalate(this, e);
    } finally {
      owner = prevOwner;
      listener = prevListener;
      inEffectCallback = wasIn;
      strictRead = prevStrict;
      if (h !== null) h.effectRunEnd(this);
    }
    if (done !== undefined && typeof done !== "function") throw new Error("effect callback returned an invalid cleanup value. Return a cleanup function or undefined.");
    if (done || this.cleanup) this.cleanup = done as (() => void) | undefined;
  }
}
// (What most computations never set: one default for all, an own field only once set.)
Object.assign(Computation.prototype, { inSnapshot: false, snapshotStale: false, ext: null, readHeld: null, verdictReader: false, verdict: null, quiet: false, error: NONE, passLane: null, revealOf: null, revealing: null, laneOf: null, revealingLane: null, staleRead: false, heldOnly: false, statusOnly: false, applied: NONE, due: false, tracked: false, settles: null, streaming: false, streamed: false, recovered: false, loadingWindow: false, windowAnswer: false, relinking: null, released: false, kept: false, scope: null, renderCtx: null, untrackedReaders: null, dormant: false, heldPass: null, applyFirst: false, erredAt: -1, closeStream: null, waiters: null, owned: null, cleanups: null, disposed: false, childCount: 0, flight: null, equals: Object.is, lazy: false });
(Node.prototype as any).override = NONE;

function noOwnerEffect(effectType: string) {
  if (process.env.NODE_ENV !== "production") diagnose({ code: "NO_OWNER_EFFECT", kind: "lifecycle", severity: "warn", message: "[NO_OWNER_EFFECT] Effects created outside a reactive context will never be disposed", data: { effectType } });
}

function applyMadeFirst(o: Owner, by = o as Computation<any>) {
  for (const k of o.owned!) {
    if (!(k instanceof Computation)) k.owned && applyMadeFirst(k, by);
    else if ((k as any).applyFirst) {
      (k as any).applyFirst = false;
      // (Run again since it was made, a reader of what then changed: it takes its turn with the rest.)
      if (k.ranAt > by.ranAt) applies[RENDER].push(k);
      else k.runApply();
    }
  }
}

function primitiveInEffectCallback(): never {
  if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "PRIMITIVE_IN_EFFECT_CALLBACK", kind: "lifecycle", severity: "error", message: PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE });
  throw new Error(PRIMITIVE_IN_EFFECT_CALLBACK_MESSAGE);
}

/** Lazy memos left with no reader: torn down as the flush ends, unless read again by then. */
const unread = new Set<Computation<any>>();
function dropUnread() {
  while (unread.size) {
    const m = unread.values().next().value!;
    unread.delete(m);
    if (m.disposed || readersOf(m)) continue;
    // (In flight: its answer counts as a reader — kept, and let go of once it lands with nothing reading it.)
    if (m.flight && !m.streaming) {
      (m as any).dropOnLanding = true;
      continue;
    }
    m.detach();
    // (A stream it reads is ended: nothing consumes it; read again, it starts anew.)
    const close = m.closeStream;
    if (close) (m.closeStream = null), close();
    m.state = DIRTY;
    drainParked(m as any);
  }
}

/** Unowned memos read outside any computation since the last flush. */
const untrackedReads = new Set<Computation<any>>();
let releasing = false;

/** An unowned memo nothing reads let go of its sources (they may go too): dormant until read again. */
function release(m: Computation<any>) {
  if (m.released || m.kept || m.disposed || readersOf(m)) return;
  m.released = true;
  const was = releasing;
  releasing = true;
  try {
    if (m.attached) m.detach();
  } finally {
    releasing = was;
  }
}

/** At a flush's start: the unowned memos read since the last one, with nothing subscribed, released. */
function sweepUntracked() {
  if (!untrackedReads.size) return;
  for (const m of [...untrackedReads]) release(m);
  untrackedReads.clear();
}

/** An effect's compute threw: its error handler, the nearest boundary's, or the flush throws it. */
function handleError(c: Computation<any>, e: unknown) {
  if (c.onError) {
    const handler = c.onError;
    // (A handler that throws escalates: the nearest boundary, else the system halts.)
    const run = () =>
      void pendingErrors.push(() => {
        try {
          handler(e, () => c.cleanup?.());
        } catch (e2) {
          escalate(c, e2);
        }
      });
    // (Raised in a held world: it fires when that transition commits, as the effect arm would.)
    const heldBy = (s: Node) => [s.tx, (s as any).writtenIn as Transaction | null].find((t) => t && !t.root.done);
    const tx = c.readHeld ?? c.tx ?? c.sources.map(heldBy).find(Boolean);
    const held = tx && !tx.root.done ? tx.root : null;
    return void (held ? endWith(held, run) : run());
  }
  // A plain effect's compute failing, with nothing to handle it: logged, the run skipped, the app goes on.
  if (c.kind === EFFECT && !c.tracked && !boundaryCatches(c, e)) return void console.error(e);
  if (c.kind === EFFECT && !c.tracked) return;
  escalate(c, e);
}

/** The nearest error boundary takes `e`; whether one did. */
function boundaryCatches(c: Computation<any>, e: unknown): boolean {
  for (let o: Owner | null = c.parent; o; o = o.parent) {
    const catcher = (o as any).catch as ((e: unknown, from: Computation<any>) => boolean) | undefined;
    if (catcher && catcher(e, c)) return true;
  }
  return false;
}

/** To the nearest boundary, else uncaught: the flush throws it and the system halts. */
function escalate(c: Computation<any>, e: unknown) {
  if (boundaryCatches(c, e)) return;
  effectFailed = true;
  // (Made outside a flush — a render effect created by a root: the error halts now, thrown to what made it.)
  if (!flushing) {
    halt(e);
    throw e;
  }
  uncaught.push(e);
}
/** An error nothing caught: the system stops (an effect's error) and what was queued is dropped. */
function halt(e: unknown) {
  (halted = true), (haltNotified = false);
  if (effectFailed) {
    effectFailed = false;
    stopped = true;
    // Said once, and the cause handed to the platform where it takes one.
    const msg =
      "[REACTIVITY_HALTED] An uncaught error halted the reactive system. No further updates will be processed. Handle errors with <Errored> or treat this as a crash.";
    if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "REACTIVITY_HALTED", kind: "error", severity: "error", message: msg });
    // The cause beside it, or to the platform where it takes one.
    const report = (globalThis as any).reportError;
    if (typeof report === "function") console.error(msg), report(e);
    else console.error(msg, e);
  }
  writes.splice(0);
  dirty = [];
  staged = [];
  applies[RENDER].splice(0);
  applies[EFFECT].splice(0);
}

// ---------------------------------------------------------------- scheduling

/** Signals written since the last flush, in order. */
const writes: Signal<any>[] = [];
/** Flights first runs started since the last flush (the mount frame's). */
const mountFlights: Computation<any>[] = [];
/**
 * The mount frame decided: its flights that something on screen waits on (not a fresh Loading's, which catches its
 * own) are one transition — each answer held there until all have landed.
 */
function mountFrame() {
  let t: Transaction | null = null;
  for (const c of mountFlights.splice(0)) {
    if (!c.flight || c.disposed || c.tx || flightHolder(c) || !mountShown(c)) continue;
    (t ??= newTransaction()).flights.add(c);
    (t as any).mount = true;
  }
}
/** Whether a reader outside every fresh Loading waits on `c` (directly or through memos). */
function mountShown(c: Computation<any>, seen = new Set<Computation<any>>()): boolean {
  if (seen.has(c)) return false;
  seen.add(c);
  for (const o of c.observers) {
    if (o.kind === MEMO) {
      // (One showing its loading value meanwhile: nothing past it waits.)
      if (!o.loadingWindow && mountShown(o, seen)) return true;
      continue;
    }
    const b = boundaryOf(o);
    if (!b || b.mountRoot || !b.fresh) return true;
  }
  return false;
}
/** Async values that landed outside a hold: staged at the next flush. */
const landings: [Computation<any>, any][] = [];
/** Computations to bring up to date. */
let dirty: Computation<any>[] = [];
/** Nodes staged in this round and not held: committed (or held) at its end. */
let staged: Node[] = [];
/** Computations with a flight in progress. */
const flights = new Set<Computation<any>>();
/** Effects whose apply half is due: [unused, effects, render effects]. */
const applies: [null, Computation<any>[], Computation<any>[]] = [null, [], []];
const pendingErrors: (() => void)[] = [];
const uncaught: unknown[] = [];

const queue = (c: Computation<any>) => (dirty.push(c), schedule());

let scheduled = false;
let flushing = 0;
let halted = false;
/** The first write after a halt said so. */
let haltNotified = false;
function notifyHalted() {
  if (haltNotified) return;
  haltNotified = true;
  console.error(process.env.NODE_ENV !== "production" ? "[REACTIVITY_HALTED] Update ignored: the reactive system was halted by an earlier uncaught error." : "[REACTIVITY_HALTED]");
}

function schedule() {
  if (scheduled || flushing || halted) return;
  scheduled = true;
  if (TRACE && ++microFlushes % 10000 === 0) trace(`scheduled flushes ${microFlushes} writes ${writes.length} dirty ${dirty.length} landings ${landings.length} guesses ${guesses.length}/${guessWork.length} ambient ${ambient.length}/${ambientEnds.length} status ${statusMoved}`);
  queueMicrotask(() => {
    scheduled = false;
    if (!halted && !flushing) flush();
  });
}

/** An async answer landed: applied at once (in the microtask it arrived in), or by the flush under way. */
function landNow() {
  if (flushing || halted) return schedule();
  flush();
}

/** An uncaught error stopped the scheduler (flush threw it): let it run again. */
/** An effect's function threw during this flush, with nothing to handle it. */
let effectFailed = false;
/** Stopped by such an error: flush does nothing until resetErrorHalt(). */
let stopped = false;

export function resetErrorHalt() {
  halted = false;
  haltNotified = false;
  stopped = false;
}

const byOrder = (a: Computation<any>, b: Computation<any>) => a.height - b.height || a.order - b.order;
/** Effects apply in the order they were made, as Solid's queue keeps them. */
const byCreation = (a: Computation<any>, b: Computation<any>) => a.order - b.order;

/** The computations that own `c`, brought up to date first (top-down): one that runs again disposes `c`. */
function ownersFirst(c: Computation<any>) {
  let chain: Computation<any>[] | null = null;
  for (let o = c.parent; o; o = o.parent) if (o instanceof Computation && o.state !== CLEAN) (chain ??= []).push(o);
  if (chain) for (let i = chain.length - 1; i >= 0; i--) if (!chain[i]!.disposed) chain[i]!.update();
}

/** Flights a held pass's work read: the transaction waits on them while they, or what they wait on, are out. */
const heldReads = new WeakSet<Computation<any>>();
/** A transaction's flight still out: its own, or (read by a held pass) one upstream it waits on. */
// (A stream counts as landed from its first value.)
const outstanding = (f: Computation<any>) => !f.disposed && ((!!f.flight && !(f.streaming && f.streamed)) || (heldReads.has(f) && inFlight(f)));

/** The transaction holding a computation `c` was made under (an owner of it held), if any. */
function heldAbove(c: Computation<any>): Transaction | null {
  for (let o: Owner | null = c.parent; o; o = o.parent) if (o instanceof Computation && o.tx && !o.tx.done) return o.tx.root;
  return null;
}

/** What isPending()/latest() readers follow: told whenever a hold or a flight starts or ends. */
const status = new (class extends Node<number> {})();
status.value = 0;
let statusMoved = false;
function statusChanged() {
  if (flushing) statusMoved = true;
  else status.bump();
}
/** Readers of pending status told, once per round. */
function tellStatus() {
  if (!statusMoved) return;
  statusMoved = false;
  status.bump();
}

/** Whether `n`, or something it was derived from, is in flight (and has a value to show meanwhile) or held. */
function waiting(n: Node, seen = new Set<Node>()): boolean {
  if (seen.has(n)) return false;
  seen.add(n);
  // (Never committed a value, a first load or born in a hold: nothing stale is shown.)
  if (n instanceof Computation && (!n.ready || (n as any).bornHeld) && n.override === NONE) return false;
  // (A guess its own truth beneath already equals: final, A24.)
  if (n.override !== NONE) {
    const truth = truthOf(n);
    if (truth !== NONE && ((n as any).equals?.(truth, n.override) ?? Object.is(truth, n.override))) return false;
  }
  // A derived store's compute: store-wide pending is only its own async work; held for what is downstream, each leaf
  // it wrote answers for itself (A22).
  // (Held by an action still running: what it shows is not final either.)
  if ((n as any).writes) return n instanceof Computation && (asyncWork(n, n) || (!!n.tx && !n.tx.root.done && n.tx.root.open > 0 && n.staged !== NONE));
  // Held by a transaction still waiting on a flight (one with none left commits this round).
  // (A held truth equal to what shows is no change in flight, A24.)
  if (n.tx && n.staged !== NONE && !committableTx(n.tx) && n.tx.root !== pendingInside && !(n instanceof Signal && Object.is(n.staged, n.value))) return true;
  // (A mark its own action made: asked from inside that action, its world.)
  if ((n as any).affected && !pendingInside) return true;
  if (n instanceof Computation) {
    // (A stream between its values is settled on the last one: not pending.)
    if (n.flight && n.ready && !n.quiet && !n.loadingWindow && !n.streaming && !(pendingInside && flightHolder(n)?.root === pendingInside)) return true;
    // (A source showing an optimistic override: what was read from it is what shows, its own pending aside.)
    // (A declared loading value whose answer is an error, its retry parked: quiet — the error is what shows.)
    if (!n.windowAnswer && !((n as any).declaredLoading && n.error !== NONE)) for (const s of n.sources) if (s.override === NONE && waiting(s, seen)) return true;
  }
  return false;
}

/** Async work at `n` or upstream of it that changes what it shows (a quiet re-ask only once a new question holds it). */
function asyncWork(n: Computation<any>, at: Computation<any>, seen = new Set<Node>()): boolean {
  if (seen.has(n)) return false;
  seen.add(n);
  if (n.flight && n.ready && !n.loadingWindow && !n.streaming) {
    if (!n.quiet) return true;
    if (n.tx && n.staged !== NONE && !committableTx(n.tx)) return true;
  }
  if ((n as any).affected) return true;
  for (const s of n.sources) if (s instanceof Computation && asyncWork(s, at, seen)) return true;
  return false;
}

/** A flight in progress at `n` or upstream of it, if any. */
function flightAt(n: Computation<any>, seen = new Set<Node>()): Computation<any> | null {
  if (seen.has(n)) return null;
  seen.add(n);
  if (n.flight && !n.streaming) return n;
  for (const s of n.sources) if (s instanceof Computation) {
    const f = flightAt(s, seen);
    if (f) return f;
  }
  return null;
}

/** Whether a flight is in progress at `n` or upstream of it. */
function inFlight(n: Node, seen = new Set<Node>()): boolean {
  if (seen.has(n)) return false;
  seen.add(n);
  if (n instanceof Computation) {
    if (n.flight) return true;
    for (const s of n.sources) if (inFlight(s, seen)) return true;
  }
  return false;
}

/**
 * What a staged node leads to: the computations downstream of it, not through readers that only probe it
 * (isPending/latest show ahead of a hold).
 */
function downstream(n: Node, out = new Set<Computation<any>>()): Set<Computation<any>> {
  for (const o of n.observers) {
    if (out.has(o)) continue;
    if (o.verdict?.has(n) && !o.sources.some((s) => s === n && !o.verdict!.has(s))) continue;
    out.add(o);
    downstream(o, out);
  }
  return out;
}

/** The transaction waiting on `c`'s flight, if any. */
function flightHolder(c: Computation<any>): Transaction | null {
  for (const t of transactions) if (t.flights.has(c)) return t;
  return null;
}
/**
 * The transition a pending read waits out, if any: one waiting on a refetch `n` waits on (through what it waits for),
 * or one a first load born in it belongs to (that load is then part of what the transition waits for).
 */
function waitedRefetch(n: unknown, seen = new Set<Computation<any>>()): Transaction | null {
  if (!(n instanceof Computation) || seen.has(n)) return null;
  seen.add(n);
  if (n.flight) {
    if (n.ready) {
      const t = flightHolder(n);
      if (t && !t.root.done) return t.root;
    } else {
      // (A first load born in a transition, or reading what one waits on.)
      let t = (n.tx ?? n.readHeld)?.root ?? null;
      for (let i = 0; !t && i < n.sources.length; i++) t = waitedRefetch(n.sources[i], seen);
      if (t && !t.done) return t.flights.add(n), t;
    }
  }
  return waitedRefetch((n as any).waitsFor?.source, seen);
}
/** The transition waiting on the flight of the computation behind `read`, if any. */
export function flightTransaction(read: unknown): Transaction | null {
  const c = accessors.get(read as any);
  const t = c?.flight ? flightHolder(c)?.root : null;
  // (A plain transition: one an action runs in, or with a guess's lane, keeps its own rules.)
  return t && !t.done && !t.open && !t.lane && !t.parentTx ? t : null;
}

/** An effect's pass read a store's optimistic value: what it shows is the guess, not a held write. */
export function noteGuessRead(tx: Transaction | null) {
  const l = listener;
  // (A bare guess only — one riding its store's refetch, no action's lane to wait for.)
  if (l && l.kind !== MEMO && !(l as any).readGuess && (tx?.root as any)?.bare) (l as any).readGuess = true;
}
/** An effect showing a store's guess, over nothing held but derived stores' own computes: it shows now. */
const showsGuess = (c: Computation<any>) => !!(c as any).readGuess && !c.sources.some((s) => s.tx && !s.tx.root.done && !(s as any).writes);
/** The transaction whose held world the running computation derives in, if any. */
export function heldPassTx(): Transaction | null {
  const l = listener;
  // (A first run has nothing committed to keep showing: its writes are its first answer.)
  if (!l || l.ranAt === -1) return null;
  const t = (l.readHeld ?? l.tx)?.root;
  // (The mount frame holds first loads, not writes: what they make shows with them.)
  if (t && !t.done && !(t as any).mount) return t;
  // (Or one reading a write of this tick, which the tick's open action will hold.)
  const tick = tickTx && !tickTx.done && tickTx.root.open > 0 ? tickTx.root : null;
  return tick && l.sources.some((s) => tickWrites.has(s)) ? tick : null;
}
/** Whether a derivation's pass is running now (it reads the staged world; an effect shows the screen). */
export const inPassNow = () => inPass > 0 && (listener ?? untrackedBy)?.kind === MEMO;
/** Whether the computation running now derives in `t`'s held world (what `t` commits to). */
export function derivesIn(t: Transaction | null | undefined): boolean {
  if (!t || t.done || !inPass) return false;
  const l = listener ?? untrackedBy;
  return !!l && (l.readHeld?.root === t.root || l.tx?.root === t.root);
}

/** A write over a derivation another transaction holds is not a proposal: the derivation runs again over it (#3612). */
export function rederiveHeld(read: unknown) {
  const c = accessors.get(read as any);
  // (A derive's own node answers the same each run: held is what it read.)
  const t = c && [c.staged !== NONE ? c.tx : null, ...c.sources.map((s) => s.tx)].find((t) => t && !t.root.done);
  if (!c || !t) return;
  // (A write inside that transaction is a proposal, and so is every later one over it.)
  if (acting && acting.tx.root === t.root) (c as any).proposedIn = t.root;
  else if ((c as any).proposedIn !== t.root) c.mark(DIRTY), schedule();
}

/** This round's staged nodes committed, or held where they lead to a flight that something renders. */
function settleRound() {
  const now = staged;
  staged = [];
  let tx: Transaction | null = null;
  const held = new Set<Node>();
  try {
    settleRoundIn(now, held, (t) => (tx = t));
  } finally {
    if (swaps.length) decideSwaps();
    if (trims.length) decideTrims(tx);
    // The transaction this flush parked into (what a guess made in it is optimistic over).
    if (tx) frameTx = (tx as Transaction).root;
    awaitingRound.clear();
  }
}

/** The computation whose equals comparator runs now (a throw from it is a comparator's). */
let comparing: Computation<any> | null = null;

/** A landing is being taken (an async answer, not a compute). */
let landing = false;

/** Sources a memo stopped reading this round, kept until the round decides whether a transaction holds it. */
let trims: [Computation<any>, Node[], number[]][] = [];
function decideTrims(parked: Transaction | null) {
  const list = trims;
  trims = [];
  for (const [c, dropped, versions] of list) {
    if (c.disposed) continue;
    // (Held itself, or the flush it ran in parked: the committed frame stays as it was until that commits — its
    // inputs among its sources, as seen then.)
    const t = c.tx && !c.tx.root.done ? c.tx.root : parked && !parked.root.done ? parked.root : null;
    if (!t) {
      for (const d of dropped) c.sources.includes(d) || d.unsubscribe(c);
      continue;
    }
    // (Only what the committed frame read: a source of a pass held in between, never shown, is let go.)
    const frame = (c as any).frameSources as Node[] | undefined;
    const keep = dropped.filter((d) => !c.sources.includes(d) && (!frame || frame.includes(d)));
    for (const d of dropped) if (!keep.includes(d) && !c.sources.includes(d)) d.unsubscribe(c);
    c.sources = [...c.sources, ...keep];
    c.seen = [...c.seen, ...keep.map((d) => versions[dropped.indexOf(d)]!)];
  }
}

/** The transaction a write this round entered (a write to a node it holds). */
let enteredTx: Transaction | null = null;

/** The transaction the running flush parked into, if any (reset when the outermost flush ends). */
let frameTx: Transaction | null = null;
/** The first action opened since the last flush: guesses written outside an action in that tick join it. */
let tickTx: Transaction | null = null;
/** The hold the passes outside a flush in this tick joined (one per tick: what a later one reads merges into it). */
let passTx: Transaction | null = null;
/** Signals written in this tick, outside any flush or action: the tick's first action holds them with it. */
const tickWrites = new Set<Node>();
/** Ticks so far (one ends with each outer flush). */
let tickNo = 0;
/** The tick now, for what records its own tick writes (a store's records). */
export const currentTick = () => tickNo;
/** A store key node whose record was written in this tick (installed by the store). */
let storeTickWrite: ((n: Node) => boolean) | null = null;
export const setStoreTickWrite = (f: (n: Node) => boolean) => void (storeTickWrite = f);
/** Guesses written outside an action and over no hold yet: decided once the flush has parked (or not). */
const frameGuesses: [Node, unknown][] = [];

/** Frame guesses installed over the transaction their flush parked into, or void (lane contract 2). */
function settleFrameGuesses() {
  for (const [n, v] of frameGuesses.splice(0)) {
    // (A node already guessed over a transaction still running: a new guess replaces it, in that transaction.)
    const guessed = (n as any).guessTx as Transaction | null | undefined;
    const t = (frameTx && !frameTx.done ? frameTx : null) ?? (tickTx && !tickTx.done ? tickTx : null) ?? (guessed && !guessed.done ? guessed.root : null) ?? (n.tx && !n.tx.done ? n.tx.root : null);
    if (t) installGuess(n, v, t);
  }
}

/** `v` shown over `n` until `t` lands; then the truth (a truth equal to the guess changes nothing on screen). */
function installGuess(n: Node, v: unknown, t: Transaction) {
  // (Guessed by another action still running: this one, holding writes of its own, merges into it.)
  const owner = (n as any).guessTx as Transaction | null | undefined;
  if (owner && !owner.done && !t.parentTx && !owner.root.parentTx && owner.root.open && t.root.nodes.size) t = mergeTx(t, owner);
  const was = n.override;
  n.override = v as any;
  (n as any).guessTx = t;
  (n as any).guessedIn = cycle();
  // Its lane: the parent's (one per parent while it is not yet revealed).
  const lane = t.lane && !t.lane.done ? t.lane : (t.lane = newLane(t));
  (n as any).laneTx = lane;
  if (!lane.guessed.has(n)) lane.guessed.set(n, truthOf(n));
  // (Development, an attribution engine installed: the truth the guess was made over.)
  if (process.env.NODE_ENV !== "production" && attrHooks !== null && was === NONE) (n as any).devTruthAtGuess = truthOf(n);
  // It ends with the parent the lanes are of.
  let base = t;
  while (base.parentTx) base = base.parentTx.root;
  // (Overlapping actions guessing it: the truth shows once the last of them ends.)
  const bases: Set<Transaction> = ((n as any).guessBases ??= new Set());
  if (!bases.has(base)) {
    bases.add(base);
    base.ends.push(() => {
      bases.delete(base);
      if (bases.size) return;
      (n as any).guessTx = null;
      if (n.override === NONE) return;
      const guess = n.override;
      n.override = NONE;
      (n as any).truthLanded = false;
      const differs = !(n as any).equals?.(n.value, guess);
      if (process.env.NODE_ENV !== "production" && attrHooks !== null && (n as any).devGuessShown) {
        // (Reverted: the truth is what it was when guessed; superseded: it moved meanwhile.)
        const truth = n.staged !== NONE ? n.staged : n.value;
        const eq = (a: unknown, b: unknown) => (typeof (n as any).equals === "function" ? (n as any).equals(a, b) : Object.is(a, b));
        if (!eq(truth, guess)) attrHooks.optimisticReverted(n, guess, truth, eq(truth, (n as any).devTruthAtGuess) ? "reverted" : "superseded");
      }
      (n as any).devGuessShown = false;
      if (differs) n.bump();
    });
  }
  // What reads it: derivations re-run in the lane now; effects at the lane's reveal (none when what shows is the same).
  const shown = was !== NONE ? was : n.value;
  if (typeof (n as any).equals === "function" ? (n as any).equals(shown, v) : Object.is(shown, v)) return;
  clock++;
  for (const o of n.observers) o.kind === MEMO ? o.mark(DIRTY) : lane.stale.add(o);
}

/** `from` joins `into`: what it holds commits with it, once both have ended. */
function mergeTx(from: Transaction, into: Transaction): Transaction {
  from = from.root;
  into = into.root;
  if (from === into || from.done || into.done) return into;
  if (process.env.NODE_ENV !== "production" && attrHooks !== null) attrHooks.transitionMerged(into, from);
  from.merged = into;
  for (const n of from.nodes) into.nodes.add(n);
  for (const e of from.effects) into.effects.add(e);
  for (const c of from.flights) into.flights.add(c);
  for (const e of from.stale) into.stale.add(e);
  into.ends.push(...from.ends.splice(0));
  into.open += from.open;
  from.open = 0;
  const held = heldBoundaries.get(from);
  if (held) {
    heldBoundaries.delete(from);
    for (const b of held) b.heldBy.delete(from), b.holdOn(into);
  }
  if (tickTx === from) tickTx = into;
  return into;
}

/** `t`, or the transaction it is a lane of. */
const outOfLane = (t: Transaction): Transaction => (t.parentTx && !t.parentTx.root.done ? t.parentTx.root : t);
/** Two actions' guesses on one key: their transactions settle together (#2899). */
export function entangle(a: Transaction, b: Transaction) {
  mergeTx(outOfLane(a), outOfLane(b));
}

/** Transactions with work that has not had a round yet (a new lane's, a voided lane's parent's): not committable while it waits to run. */
const awaitingRound = new Set<Transaction>();

/** `l` if it is a lane not yet revealed. */
const unrevealed = (l: Transaction | null | undefined) => (l && !l.done ? l : null);

/** A lane of `t`: a transaction of its own (not merged with `t`), which `t` waits for. */
function newLane(t: Transaction): Transaction {
  const l = newTransaction();
  l.parentTx = t;
  awaitingRound.add(l);
  return l;
}

function settleRoundIn(now: Node[], held: Set<Node>, setTx: (t: Transaction) => void) {
  // (Nothing in flight and no transaction: nothing can hold.)
  if (!flights.size && !transactions.size) {
    for (const n of now) {
      if ((n as any).revealNow) (n as any).revealNow = false;
      if (!n.tx) n.promote();
    }
    return;
  }
  let tx: Transaction | null = null;
  /** The transaction this round parked into (new or joined). */
  let parked: Transaction | null = enteredTx;
  // (An action opened in this tick and still running: the writes made in the tick before the flush are its too.)
  const tick = tickTx && !tickTx.done && tickTx.root.open > 0 ? tickTx.root : null;
  enteredTx = null;
  for (const n of now) {
    // (A loading window's first answer: committed whatever holds.)
    if ((n as any).revealNow) {
      (n as any).revealNow = false;
      if (!n.tx) n.promote();
      continue;
    }
    if (n.tx || held.has(n)) continue;
    const lane = n instanceof Computation && n.passLane && !n.passLane.done ? n.passLane : null;
    if (lane) {
      hold(n, lane);
      held.add(n);
      continue;
    }
    const below = downstream(n);
    let holds = false;
    let nav = false;
    let joins: Transaction | null = null;
    const revealed: Computation<any>[] = [];
    const made: Computation<any>[] = [];
    for (const c of below) {
      // (Lane work leads to the lane's parent: a plain write is never part of a guess's frame.)
      if (c.tx) joins = outOfLane(c.tx.root);
      if (c.flight && !c.loadingWindow && (c.kind !== MEMO ? !hidden(c) : rendered(c))) {
        if (c.ready) holds = true;
        // (A navigation to a flight with no answer yet: its readers ran against it already, and run again.)
        else if (shownInitialized(c)) holds = nav = true;
      }
      // A reveal: what the write brings on screen reads a flight already up — the write waits for its answer.
      // (Nothing shown yet, a first mount, is no reveal.)
      if (c.kind !== MEMO ? c.applied !== NONE && !hidden(c) : rendered(c)) {
        const reveal = (r: Computation<any>, fresh: boolean) => {
          for (const s of r.sources) {
            if (!(s instanceof Computation && (s.flight || (fresh && !s.ready && inFlight(s))) && !s.streaming && !s.loadingWindow && !below.has(s) && !r.before.includes(s) && (fresh || r.born !== flushes))) continue;
            // (A flight another reveal already waits on: this one joins it, all complete at the landing; one a shown
            // reader waits on is carved out.)
            const by = flightHolder(s);
            if (by) {
              if ((by.root as any).byReveal) joins = by.root;
              continue;
            }
            (holds = true), revealed.push(s);
          }
          // (What its pass made just now is part of the reveal: a child born this flush reading a flight.)
          const walk = (o: Owner) => {
            if (o.owned)
              for (const k of o.owned)
                // (A fresh boundary catches what is under it: its fallback shows instead.)
                if (k.disposed || (k as any).loading?.fresh || (k as any).shows?.fresh) continue;
                else if (!(k instanceof Computation)) walk(k);
                else if (k.born === flushes) made.push(k), reveal(k, true);
          };
          walk(r);
        };
        // (Under a boundary this write re-arms: it catches the flight, its fallback shows; the write is not held.)
        const b = ((c as any).loading as LoadingState | undefined) ?? boundaryOf(c);
        if (!(b?.watch && below.has(b.watch))) reveal(c, false);
      }
    }
    // Reading a node a transaction holds joins it; an action's write is its transaction's.
    // (A render effect showed the frame of what it holds: it runs again at the commit instead.)
    // (A first pass a fresh boundary caught read the committed world: it is the boundary's, not the tick's.)
    if (n instanceof Computation && !(n.staleRead && !n.readHeld && n.kind === MEMO))
      for (const s of n.sources) {
        // (A derived store's own compute, read to bring it up to date: its keys are what is read.)
        if (!s.tx || n.verdict?.has(s) || (n as any).insideTx || (s as any).writes) continue;
        // (One never applied, made by a pass the transaction holds, has no frame to show: born held with it.)
        if (n.kind === RENDER && !(s as any).bornHeld && !n.readHeld && !(n.applied === NONE && madeByHeld(n, s.tx.root))) s.tx.root.stale.add(n);
        else joins = outOfLane(s.tx.root);
      }
    // (An effect never applied, made by a pass a transaction holds: it has no frame to show — born held with it.)
    if (n instanceof Computation && n.kind !== MEMO && n.applied === NONE && !joins) {
      let p: Owner | null = n.parent;
      while (p && !(p instanceof Computation)) p = p.parent;
      const pt = (p as Computation<any> | null)?.tx?.root;
      if (pt && !pt.done && !pt.parentTx) joins = pt;
    }
    const by = (n as any).writtenIn as Transaction | null;
    if (by && !by.done) joins = by.root;
    // A memo below reading what another transaction holds entangles them: the two settle as one (A15).
    for (const c of below) {
      if (c.kind !== MEMO) continue;
      for (const s of c.sources) {
        const st = (s.tx ?? (s instanceof Computation && s.flight ? flightHolder(s) : null))?.root;
        // (A reveal's hold is not a transition: what reads its flight waits on its own.)
        if (!st || st.done || st.parentTx || (st as any).byReveal || (c as any).insideTx) continue;
        joins = joins && joins !== st && !joins.parentTx ? mergeTx(st, joins) : (joins ?? st);
      }
    }
    if (!holds && !joins) continue;
    // (Held with the reveal: what its pass made just now.)
    for (const k of made) below.add(k);
    const t: Transaction = joins ?? (tx ??= newTransaction());
    if (revealed.length && !joins) (t as any).byReveal = true;
    setTx(t);
    parked ??= t.root;
    hold(n, t);
    held.add(n);
    for (const s of revealed) t.flights.add(s), heldReads.add(s);
    for (const c of below) {
      // (An effect that read only overrides shows them: a guess is not held. An until() of this action answers it now.)
      if ((c as any).insideTx?.root === t.root) continue;
      if (nav && (c.staged !== NONE || c.due) && c.kind === RENDER && !t.open && !t.parentTx && c.ranAt !== -1) {
        // (A render effect that ran against the write before it was held: run again, showing the frame it holds.)
        if (c.due) (c.due = false), remove(applies[c.kind as 1 | 2], c);
        c.staged = NONE as any;
        c.state = CLEAN;
        c.mark(DIRTY);
        continue;
      }
      // (Made this flush by a pass of one of its lanes: the lane's work, revealed with it.)
      if (c.born === flushes && c.kind === MEMO && laneMade(c, t)) continue;
      if ((c.staged !== NONE || c.due) && (c.kind === MEMO || (!c.sources.every((s) => s.override !== NONE) && !showsGuess(c)))) hold(c, t);
      if (c.flight) t.flights.add(c);
    }
  }
  // The tick entangles: a round that parked holds its plain writes with it.
  if ((parked && !parked.done) || tick)
    for (const n of now) {
      if (n.tx || !(n instanceof Signal)) continue;
      const into = parked && !parked.done ? parked : tickWrites.has(n) || storeTickWrite?.(n) ? tick : null;
      if (!into) continue;
      // (A write back to the committed value, or one no reader changed with, proposes nothing.)
      if (n.staged === NONE || (n.equals !== false && n.equals(n.value, n.staged as any))) continue;
      const below = downstream(n);
      // (A tick write one asks whether it is pending is seen: held with the action, it is.)
      if (readersOf(n) && ![...below].some((c) => !c.tx && (c.staged !== NONE || c.due || (c as any).writes)) && !(into === tick && [...n.observers].some((o) => o.verdict?.has(n)))) continue;
      hold(n, into);
      held.add(n);
      for (const c of below) {
        if (c.tx || (c.staged === NONE && !c.due)) continue;
        if (c.kind === MEMO) hold(c, into);
        else {
          // (A reader that saw the write before it was held: run again, against the held world.)
          if (c.due) (c.due = false), remove(applies[c.kind as 1 | 2], c);
          c.staged = NONE as any;
          c.state = CLEAN;
          c.mark(DIRTY);
        }
      }
    }
  // A write from a compute this round held joins its hold.
  for (const n of now) {
    const by = n instanceof Signal ? n.writtenBy : null;
    if (!by) continue;
    (n as Signal<any>).writtenBy = null;
    // (Its writer held, or reading what this round held.)
    const t = [by.tx, ...by.sources.map((s) => s.tx)].find((t) => t && !t.root.done);
    if (n.tx || !t || n.staged === NONE) continue;
    const into = t.root;
    hold(n, into);
    held.add(n);
    for (const c of downstream(n)) {
      if (c.tx || (c.staged === NONE && !c.due)) continue;
      if (c.kind === MEMO) hold(c, into);
      else {
        if (c.due) (c.due = false), remove(applies[c.kind as 1 | 2], c);
        c.staged = NONE as any;
        c.state = CLEAN;
        c.mark(DIRTY);
      }
    }
  }
  for (const n of now) if (!n.tx) n.promote();
  if (held.size) statusChanged();
}

/**
 * A pass reading a value a transaction holds. Frame readers (a tracked effect, an isPending probe, a render effect
 * outside that transaction) see the committed value; a render effect re-runs when the transaction commits. Others
 * (memos, effects) derive from the held world and join the hold. A node born held has no committed value: every
 * pass reader joins it.
 */
function heldRead<T>(n: Node<T>, held?: Transaction): T {
  const t = held ?? n.tx!.root;
  if (t.done) return n.staged as T;
  // (Read untracked in a pass: as the computation running sees it.)
  const l = listener ?? (inPass ? untrackedBy : null);
  if (!l) return n.staged as T;
  if (l.tracked) return n.value;
  const born = (n as any).bornHeld;
  if (verdictReading) {
    // An isPending probe sees the frame; latest() sees the newest world without joining it.
    if (!born && !l.attached) return n.value;
    // latest() of a held write: the write is its own override, read on the transaction's lane — a derivation is
    // the lane's work; an effect shows what is on screen until the lane reveals.
    if (!(l as any).viaLatest && !(n instanceof Computation) && !t.parentTx) {
      // (Its lane revealed this very write: shown.)
      const m = n as any;
      const at = m.stagedAt;
      if (m.latestLane?.done) {
        if (m.latestAt === at) return n.staged as T;
        // (A newer write: what the revealed lane showed stays on screen until its own lane reveals.)
        (m.revealed = m.latestVal), (m.revealedIn = t);
      }
      const lane = t.lane && !t.lane.done ? t.lane : (t.lane = newLane(t));
      (m.latestLane = lane), (m.latestAt = at), (m.latestVal = n.staged);
      if (l.kind === MEMO) l.passLane = lane;
      // (A lane with nothing out reveals now: the write is what shows.)
      else if (!lane.flights.size && !lane.nodes.size) return n.staged as T;
      else {
        lane.stale.add(l);
        l.staleRead = true;
        return m.revealedIn === t ? m.revealed : n.value;
      }
    }
    return n.staged as T;
  }
  // (A lane's pass reading a plain write its parent transaction holds: the committed value — the guess shows over the
  // world as committed; it derives again when that write commits.)
  if (!(n instanceof Computation) && l.passLane && !l.passLane.done && l.passLane.root.parentTx?.root === t) return t.stale.add(l), n.value;
  // A first pass is its creator's (ruling A): made by a lane's pass, it sees the screen — the lane's parent's held
  // write as committed — and derives again at that commit.
  if (madeByLane(l, t)) {
    t.stale.add(l);
    l.staleRead = true;
    (l as any).screenPass = true;
    return n.value;
  }
  // A first pass under a Loading that has not shown its content (a fresh mount): the boundary catches the hold —
  // its fallback shows, its content at the hold's commit (A29's boundary exemption).
  if (l.ranAt === -1 && !l.tx) {
    const b = ((l as any).loading as LoadingState | undefined) ?? boundaryOf(l);
    if (b?.fresh) {
      b.holdOn(t);
      // (Not joined, and pending: the committed value would tear; it runs again at the commit.)
      t.stale.add(l);
      l.staleRead = true;
      throw new NotReadyError(n);
    }
  }
  // (A lane's reveal shows what it derived, whichever transaction holds it.)
  if (l.revealingLane && n instanceof Computation && n.passLane === l.revealingLane) return n.staged as T;
  // (A lane's reveal shows its derivations over the parent's committed writes.)
  const outside = l.revealing === t ? !(n instanceof Computation) : l.tx?.root !== t;
  // (A re-armed boundary's fallback follows its frame: what reads it computes with it now and shows it at the commit.)
  if (!born && (l.kind === RENDER || l.verdictReader) && outside && !(l.ranAt === -1 && l.tx) && !(n as any).followsFrame) {
    t.stale.add(l);
    l.staleRead = true;
    return n.value;
  }
  // (A pass outside a flush: the tick is one frame — a second hold it reads merges into the first, A29.)
  if (!flushing && !t.parentTx) {
    const p = passTx && !passTx.done ? passTx.root : null;
    passTx = p && p !== t ? mergeTx(t, p) : t;
    l.readHeld = passTx;
    return n.staged as T;
  }
  l.readHeld = t;
  return n.staged as T;
}

/** Whether `c` was made by a pass of one of `t`'s lanes (through what it was made under this flush). */
function laneMade(c: Computation<any>, t: Transaction): boolean {
  // (A guess's lane: a verdict's lane makes mainline mounts.)
  const laneOf = (x: Transaction | null | undefined) => !!x && !x.done && x.root.parentTx?.root === t.root && x.root.guessed.size > 0;
  for (let p = c.parent; p; p = p.parent) {
    if (!(p instanceof Computation)) continue;
    if (laneOf(p.passLane) || laneOf(p.readHeld) || laneOf(p.tx)) return true;
    if (p.born !== flushes) return false;
  }
  return false;
}
/** Whether `l` is a first pass made by a pass of one of `t`'s lanes (a first pass is its creator's, ruling A). */
function madeByLane(l: Computation<any>, t: Transaction): boolean {
  if (l.ranAt !== -1 || l.tx || !t.lane) return false;
  const laneOf = (x: Transaction | null | undefined) => (x && !x.done && x.root.parentTx?.root === t && x.root.guessed.size > 0 ? x : null);
  for (let p = l.parent; p; p = p.parent) {
    if (!(p instanceof Computation)) continue;
    if (laneOf(p.passLane) || laneOf(p.readHeld) || laneOf(p.tx)) return true;
    if (p.ranAt !== -1) return false;
  }
  return false;
}

/** Whether `c` was made by a computation `t` holds. */
function madeByHeld(c: Computation<any>, t: Transaction): boolean {
  let p: Owner | null = c.parent;
  while (p && !(p instanceof Computation)) p = p.parent;
  return !!p && (p as Computation<any>).tx?.root === t;
}

/** Whether a computation's value reaches the screen: an effect reads it, directly or through memos. */
function rendered(c: Computation<any>, seen = new Set<Computation<any>>()): boolean {
  if (seen.has(c)) return false;
  seen.add(c);
  for (const o of c.observers) {
    // (A memo that only asks whether it is pending derives from its status, not its value.)
    if (o.kind === MEMO && o.verdict?.has(c)) continue;
    if (o.kind !== MEMO ? !hidden(o) : !hidden(o) && rendered(o, seen)) return true;
  }
  return false;
}

/**
 * A flight with no answer yet that a boundary already showing its content reads (a navigation to it): the old view
 * holds until it lands (A19), where a boundary that has shown nothing would catch it.
 */
function shownInitialized(c: Computation<any>): boolean {
  if (c.kind !== MEMO) return false;
  for (const o of c.observers) {
    // (A reader that has shown something: a memo with a value, an effect that applied one.)
    if (!(o instanceof Computation) || (o.kind === MEMO ? !o.ready : o.applied === NONE)) continue;
    const b = ((o as any).loading as LoadingState | undefined) ?? boundaryOf(o);
    if (b && !b.fresh) return true;
  }
  return false;
}

/** A held node's flight that keeps its transaction: one something on screen reads (an effect's, or a memo's that an
 * effect not behind a fallback reads; a memo nothing reads holds nothing). */
const shownFlight = (n: Computation<any>) => n.kind !== MEMO || rendered(n);

/** The boundary showing its fallback that `c` is behind, if any (the nearest that is). */
function behindFallback(c: Computation<any>): FallbackHold | null {
  for (let o: Owner | null = c.parent; o; o = o.parent) {
    const b = ((o as any).loading ?? (o as any).erroredHold) as FallbackHold | undefined;
    if (b?.onFallback && !b.mountRoot) return b;
  }
  return null;
}
/** What holds effect runs behind a fallback (a Loading's, an Errored's): applied when the content shows again. */
type FallbackHold = { onFallback: boolean; mountRoot: boolean; heldRuns: Set<Computation<any>>; reveal(): void };

/** Under a Loading boundary showing its fallback: not on screen, so it holds nothing. */
function hidden(c: Computation<any>): boolean {
  // (In a frame a rerun parked: what it shows is on its way out, not what this round decides.)
  if (c.dormant) return true;
  // (A fresh boundary's output showing its fallback: what it reads is not on screen; the boundary catches it.)
  if ((c as any).shows?.onFallback && (c as any).shows.fresh) return true;
  for (let o: Owner | null = c; o; o = o.parent) {
    if ((o as any).loading?.onFallback) return true;
    // (A boundary's output is on screen, showing the fallback; only what it made is not.)
    if (o !== c && (o as any).shows?.onFallback) return true;
  }
  return false;
}

/**
 * `n` held in `t` after readers may already have computed against its staged value this round: what derives from it is
 * held with it, and an effect that ran against it runs again (showing the frame).
 */
function holdLate(n: Node, t: Transaction) {
  hold(n, t);
  for (const o of downstream(n)) {
    if (o.tx || (o as any).insideTx) continue;
    if (o.kind === MEMO) {
      if (o.staged !== NONE) hold(o, t);
      continue;
    }
    if (o.staged === NONE && !o.due) continue;
    if (o.due) (o.due = false), remove(applies[o.kind as 1 | 2], o);
    o.staged = NONE as any;
    o.state = CLEAN;
    o.mark(DIRTY);
  }
}

function newTransaction() {
  const t = new Transaction();
  transactions.add(t);
  return t;
}

function hold(n: Node, t: Transaction) {
  t = t.root;
  // (A transaction already committed holds nothing more.)
  if (t.done) return;
  if (process.env.NODE_ENV !== "production" && attrHooks !== null && flushing && !heldThisFlush.has(t)) pendingHolds.add(t);
  if (n.tx === t) return;
  n.tx = t;
  t.nodes.add(n);
  // (A memo's first answer, held: nothing committed to serve outside the transaction until it commits.)
  if (n instanceof Computation && n.kind === MEMO && !(n as any).committed && n.staged !== NONE) (n as any).bornHeld = true;
  if (n instanceof Computation && n.due) {
    t.effects.add(n);
    remove(applies[n.kind as 1 | 2], n);
  }
}

/** Transactions a flush has told the attribution engine it holds, and those to tell once the round has decided
 * (development). */
const heldThisFlush = new Set<Transaction>();
const pendingHolds = new Set<Transaction>();
/** Whether a transaction is ready to commit (nothing in flight, no action still running in it). */
function committable() {
  for (const t of transactions) if (committableTx(t)) return true;
  return false;
}

/**
 * `t`'s lane, not yet revealed, keeps it, unless a truth arrived that its guess never showed. A transaction ending (not
 * a lane) also ends a guess its truth does not confirm. Either way the guess is void.
 */
function laneBlocks(t: Transaction): boolean {
  const l = t.lane;
  if (!l || l.done || superseded(l)) return false;
  if (t.parentTx) return true;
  for (const n of l.guessed.keys()) {
    if (n.override === NONE) continue;
    const truth = truthOf(n);
    if (truth !== NONE && !((n as any).equals?.(truth, n.override) ?? truth === n.override)) return false;
  }
  return true;
}

/** What a node is under its guess (NONE while it is still to come). */
function truthOf(n: Node): unknown {
  if (n instanceof Computation && (n.flight || n.state === DIRTY)) return NONE;
  return n.staged !== NONE ? n.staged : n.value;
}

/** A truth arrived since the guess, and it is not the guess. */
function superseded(l: Transaction): boolean {
  for (const [n, before] of l.guessed) {
    if (n.override === NONE) continue;
    const truth = truthOf(n);
    // (A truth of the guess's own batch is what it was written over: the newer intent is the guess.)
    if ((n as any).guessedIn === cycle()) {
      l.guessed.set(n, truth);
      continue;
    }
    if (truth === NONE || truth === before) continue;
    if (!((n as any).equals?.(truth, n.override) ?? truth === n.override)) return true;
  }
  return false;
}

/** A blocked lane whose guess the truth superseded: it never showed, so it is void (its work re-derives from the truth). */
function voidLane(l: Transaction) {
  l.done = true;
  transactions.delete(l);
  awaitingRound.delete(l);
  for (const n of l.nodes) {
    n.tx = null;
    // (A guessed node's own landing is the correction: its truth stays, the parent's.)
    if (l.guessed.has(n) && n.staged !== NONE) {
      for (const o of n.observers) o.mark(DIRTY);
      continue;
    }
    n.staged = NONE as any;
    if (n instanceof Computation && !n.disposed) (n.flight = null), flights.delete(n), n.mark(DIRTY);
  }
  // The truth under each guess is the parent's: held with it.
  const parent = l.parentTx!.root;
  awaitingRound.add(parent);
  for (const n of l.guessed.keys()) {
    // (A committed truth too: a superseded read is the parent's whether its truth is staged or not, A18 (c).)
    if (n.staged === NONE && !n.tx && !parent.done && n.override !== NONE) n.staged = n.value;
    if (n.staged !== NONE && !n.tx && !parent.done) hold(n, parent);
    if (n.override === NONE) continue;
    n.override = NONE as any;
    (n as any).truthLanded = false;
    // (Effects never showed the guess: nothing changes for them; lane work re-derives.)
    for (const o of n.observers) if (o.kind === MEMO) o.mark(DIRTY);
  }
  statusChanged();
}

/** A transaction with no flight left (and no action open): it commits this round. */
function committableTx(t: Transaction) {
  // (A lane: a flight nothing shows any more holds nothing, as commitTransactions prunes it.)
  return !t.merged && !t.open && !(awaitingRound.has(t) && dirty.length) && !laneBlocks(t) && ![...t.flights].some((f) => outstanding(f) && !(t.parentTx && f.kind === MEMO && !rendered(f))) && ![...t.nodes].some((n) => n instanceof Computation && n.flight && !(n.streaming && n.streamed) && shownFlight(n));
}

/** Transactions whose flights have all landed (and whose actions ended): committed, their effects applied. */
function commitTransactions() {
  // A truth arriving that differs from a guess its blocked lane never showed: the guess is void.
  for (const l of [...transactions]) if (l.parentTx && !l.done && superseded(l)) voidLane(l);
  for (const t of [...transactions]) {
    if (t.merged) {
      transactions.delete(t);
      continue;
    }
    // A flight nothing shows any more (its readers moved on) holds nothing.
    // (A bare guess rides its refetch to the landing, shown or not.)
    for (const f of t.flights) if (!outstanding(f) || (f.kind === MEMO && !rendered(f) && !(t as any).bare)) t.flights.delete(f);
    // A flight in progress at any node it holds keeps it.
    // (And its guesses' own sources refetching: the guess lives until its own truth lands.)
    for (const src of (t as any).guessSources ?? []) {
      const c = accessors.get(src);
      if (!c || c.disposed || c.streaming) continue;
      const f = flightAt(c);
      if (f) t.flights.add(f);
    }
    for (const n of t.nodes) if (n instanceof Computation && n.flight && !(n.streaming && n.streamed) && shownFlight(n)) t.flights.add(n);
    // A first load made by a pass it holds (a memo the held pass created): what that pass shows waits on it.
    for (const n of t.nodes) {
      if (!(n instanceof Computation) || !n.owned) continue;
      for (const o of n.owned) if (o instanceof Computation && o.kind === MEMO && !o.ready && outstanding(o)) t.flights.add(o);
    }
    if (t.flights.size || t.open || (awaitingRound.has(t) && dirty.length)) continue;
    // (A guess written in it still to install.)
    if (guesses.some((g) => g[2]?.root === t)) continue;
    if (laneBlocks(t)) continue;
    // (Its lane voided: its work re-derives under it first.)
    if (t.lane && !t.lane.done && (voidLane(t.lane), dirty.length)) continue;
    // A node still loading that nothing on screen reads (behind a fallback) leaves the hold: its answer commits on its
    // own when it lands.
    for (const n of t.nodes) if (n instanceof Computation && n.flight && !shownFlight(n)) (t.nodes.delete(n), (n.tx = null));
    if (process.env.NODE_ENV !== "production" && attrHooks !== null) attrHooks.transitionSettled(t);
    transactions.delete(t);
    t.done = true;
    for (const b of heldBoundaries.get(t) ?? []) b.release(t);
    heldBoundaries.delete(t);
    for (const n of t.nodes) n.promote();
    for (const end of t.ends.splice(0)) end();
    if ((t as any).mount && heldSettled.length && !mountLoading()) settledQueue.push(...heldSettled.splice(0));
    // (An effect that also read this frame stale runs again now: what it held is dropped, one frame shows.)
    for (const e of t.effects) if (e.due && !t.stale.has(e)) applies[e.kind as 1 | 2].push(e);
    for (const e of t.stale) {
      if (e.disposed) continue;
      // (Held by another transaction too, still open: it shows this commit's world now, and that one's at its commit.)
      const other = e.tx && !e.tx.root.done && e.tx.root !== t && !t.parentTx ? e.tx.root : null;
      if (other) other.nodes.delete(e), other.effects.delete(e), (e.tx = null), other.stale.add(e);
      e.due && !e.tracked && ((e.due = false), (e.staged = NONE as any)), e.mark(DIRTY), ((e as any).fromCommit = true);
      // A lane revealed: its effects show it over the parent's world as committed (the parent's commit runs them again).
      if (t.parentTx && e.kind !== MEMO) (e.revealOf = t.parentTx.root), (e.laneOf = t);
    }
    statusChanged();
  }
}

/** Writes committed and everything brought up to date, until nothing is left to do. */
function drain() {
  for (let rounds = 0; settledQueue.length || pendingErrors.length || effectDrains.length || statusMoved || writes.length || landings.length || guesses.length || frameGuesses.length || guessWork.length || committable() || ambient.length || ambientEnds.length || dirty.length || applies[RENDER].length || applies[EFFECT].length || readersOf(status) && statusDirty(); rounds++) {
    if (rounds > 1e5) throw new Error("Potential infinite loop detected.");
    if (TRACE && rounds && rounds % 10000 === 0) trace(`round ${rounds} writes ${writes.length} dirty ${dirty.length} tx ${transactions.size}`);
    if (writes.length) for (const s of writes.splice(0)) s.commit();
    if (landings.length)
      for (const [c, v] of landings.splice(0)) {
        if (c.disposed) continue;
        landing = true;
        // (An answer of the mount frame: held with the frame's other answers.)
        const mount = flightHolder(c);
        const h = process.env.NODE_ENV !== "production" ? attrHooks : null;
        const before = h !== null ? (c.staged !== NONE ? c.staged : c.value) : undefined;
        if (h !== null) h.asyncStart(c);
        try {
          c.take(v);
        } finally {
          landing = false;
        }
        if (h !== null) h.asyncEnd(c, before, v, true);
        const lr = (c as any).landRelease as (() => void)[] | undefined;
        if (lr) ((c as any).landRelease = undefined), lr.forEach((f) => f());
        if (mount && (mount as any).mount && !mount.done && !c.streaming && c.staged !== NONE && !c.tx) (hold(c, mount), ((c as any).bornHeld = true));
        if ((c as any).dropOnLanding) ((c as any).dropOnLanding = false), readersOf(c) || unread.add(c);
        // (Its answer in: the frame it kept shown goes at the round.)
        if ((c as any).parked && c.kind === MEMO && !c.flight) swaps.push(c);
      }
    if (guesses.length) installGuesses();
    if (guessWork.length)
      for (const [install, tx, source] of guessWork.splice(0)) {
        // (A guess over a source of its own: the action's end waits for that source's answer in flight, A18.)
        if (tx && !tx.done && source) ((tx.root as any).guessSources ??= new Set()).add(source);
        install(tx && !tx.done ? tx : tickTx && !tickTx.done ? tickTx : source ? overFlight(accessors.get(source)) : null);
      }
    for (let passes = 0; dirty.length; passes++) {
      if (passes > 1e5) throw new Error("Potential infinite loop detected.");
      const now = dirty.sort(byOrder);
      dirty = [];
      for (const c of now) if (!c.disposed && !c.released) ownersFirst(c), c.disposed || c.dormant || c.update();
    }
    settleRound();
    if (frameGuesses.length) settleFrameGuesses();
    commitTransactions();
    // (What the round left holding: told before its effects run — its writes all in it by now.)
    if (process.env.NODE_ENV !== "production" && pendingHolds.size) {
      for (const t of pendingHolds) if (!t.done && !t.merged && !heldThisFlush.has(t) && attrHooks !== null) heldThisFlush.add(t), attrHooks.holdStart(t);
      pendingHolds.clear();
    }
    tellStatus();
    if (uncaught.length) throw uncaught.splice(0)[0];
    if (pendingErrors.length) for (const f of pendingErrors.splice(0)) f();
    // (Status readers told this round compute again first: one apply, with the verdict as it ends.)
    // (Effects' replaced frames go once the round decided what holds, before the new frames' side effects.)
    if (effectDrains.length && !dirty.length)
      for (const c of effectDrains.splice(0)) {
        const left = (c as any).leftHold;
        if (left) (c as any).leftHold = false;
        if ((c as any).parked && (!c.tx || left)) drainParked(c as any);
      }
    if (applies[RENDER].length && !dirty.length) for (const e of applies[RENDER].splice(0).sort(byCreation)) e.runApply();
    if (applies[EFFECT].length && !writes.length && !dirty.length) for (const e of applies[EFFECT].splice(0).sort(byCreation)) e.runApply();
    // (In the effects' phase, after them: a write an effect just made is not settled yet, and not seen.)
    if (settledQueue.length && !dirty.length && !applies[RENDER].length && !applies[EFFECT].length) {
      // (A mount still loading what it shows is not settled: its onSettled runs once that lands.)
      if (mountLoading()) heldSettled.push(...settledQueue.splice(0));
      else for (const f of settledQueue.splice(0)) f();
    }
    // Optimistic values written outside an action: shown for this flush, then the truth again.
    if ((ambient.length || ambientEnds.length) && !writes.length && !dirty.length && !applies[RENDER].length && !applies[EFFECT].length) {
      for (const n of ambient.splice(0)) n.override !== NONE && ((n.override = NONE), n.bump());
      for (const end of ambientEnds.splice(0)) end();
    }
  }
  if (mountFlights.length) mountFrame();
  dropUnread();
  // (An effect's own code that threw in the last round.)
  if (uncaught.length) throw uncaught.splice(0)[0];
}
const statusDirty = () => false;

/**
 * The queued writes applied and everything brought up to date now. Given a function, it runs first, and its writes
 * are drained before flush returns (at each level, when nested). Called while flushing, it drains what is queued.
 */
export function flush<T>(fn?: () => T): T {
  if (inSettled) throw new Error("Cannot call flush() from inside onSettled or createTrackedEffect. flush() is not reentrant there.");
  let result!: T;
  // From an effect callback: the flush running it carries on with what it writes; this one does nothing.
  if (flushing && inEffectCallback) {
    if (process.env.NODE_ENV !== "production") diagnose({
      code: "FLUSH_IN_EFFECT_CALLBACK",
      kind: "lifecycle",
      severity: "warn",
      message:
        "[FLUSH_IN_EFFECT_CALLBACK] flush() called from inside an effect callback is a no-op: the flush that runs effects is already in progress. " +
        "Writes made here are processed in the same flush's continuation; to force a drain afterwards, defer it: queueMicrotask(() => flush()).",
    });
    return fn ? fn() : result;
  }
  // From an action's body: its writes are its transaction's until it settles; a drain here would leak them.
  if (acting) {
    if (process.env.NODE_ENV !== "production") {
      const message = "[FLUSH_IN_ACTION] flush() cannot be called inside an action body: its writes are held until the action settles. Yield instead, or flush after the action.";
      emitDiagnostic({ code: "FLUSH_IN_ACTION", kind: "write", severity: "error", message });
      throw new Error(message);
    }
    return fn ? fn() : result;
  }
  // Stopped by an effect's uncaught error: nothing runs until resetErrorHalt().
  if (stopped) return fn ? untrack(fn) : result;
  if (!flushing) flushes++;
  const outer = !flushing && process.env.NODE_ENV !== "production" ? attrHooks : null;
  flushing++;
  try {
    if (fn) result = fn();
    sweepUntracked();
    const told = outer !== null && (writes.length > 0 || landings.length > 0 || dirty.length > 0 || applies[RENDER].length > 0 || applies[EFFECT].length > 0 || guesses.length > 0 || guessWork.length > 0 || effectDrains.length > 0 || settledQueue.length > 0 || transactions.size > 0);
    if (told) outer!.flushStart();
    drain();
    if (outer !== null) {
      if (heldThisFlush.size) heldThisFlush.clear(), outer.holdEnd();
      if (told) outer.flushEnd();
    }
  } catch (e) {
    halt(e);
    throw e;
  } finally {
    flushing--;
    if (!flushing) (frameTx = tickTx = passTx = null), tickWrites.clear(), tickNo++;
    if (!flushing) DEV?.hooks.onUpdate?.();
    // A refresh counts for the flush it was asked in.
    if (!flushing) for (const c of refreshedNow.splice(0)) (c as any).refreshed = false;
  }
  return result;
}

const refreshedNow: Computation<any>[] = [];

// ---------------------------------------------------------------- the API

type Accessor<T> = () => T;
type Setter<T> = (next: T | ((prev: T) => T)) => T;
export type SourceAccessor<T> = Accessor<T>;

export function createSignal<T>(value: T | ((prev?: T) => T), options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  if (typeof value === "function") return writableMemo(value as (prev?: T) => T, options);
  const s = new Signal(value as T, options);
  // (A user's signal: what the hydrating pass reads of it is kept.)
  (s as any).snapshots = true;
  if (snapshotCapture) s.snapshot();
  registerGraph(s, owner);
  const set: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(s.pending !== NONE ? (s.pending as T) : s.staged !== NONE ? (s.staged as T) : s.value) : next;
    s.write(v);
    return v;
  };
  const read = () => s.read();
  accessors.set(read, s as any);
  return [read, set];
}

/** A value worked out from what it reads, that can also be set: a write stays until what it reads changes. */
function writableMemo<T>(fn: (prev?: T) => T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  const written = new Signal<{ v: T; rederive?: boolean } | null>(null, { ownedWrite: options?.ownedWrite, equals: false });
  let seen: { v: T; rederive?: boolean } | null = null;
  /** Whether what it shows now is a write (not a derivation). */
  let manual = false;
  // Each source's version at the last run: a write holds only while none of them moved (and no refresh asked).
  let versions: [Source, number][] = [];
  const m = new Computation<T>(
    MEMO,
    (prev) => {
      const w = written.read();
      const moved = (m as any).refreshed || versions.some(([s, v]) => (s instanceof Computation && s.update(), (s as any).version !== v));
      let out: T;
      if (w !== seen) {
        seen = w;
        // (A write over a derivation another transaction holds is not a proposal: that derivation runs again over it.)
        if (w && !moved && !w.rederive) {
          // The write holds: still subscribed to what the last run read.
          for (const [s] of versions) m.track(s as any);
          manual = true;
          return w.v;
        }
        out = fn(w ? w.v : prev);
      } else out = fn(prev);
      manual = false;
      versions = m.sources.filter((s) => s !== written).map((s) => [s, (s as any).version]);
      return out;
    },
    options,
  );
  // (The function it wraps, for what is asked of its shape: an async generator's stream hands off to the client.)
  (m as any).sourceFn = fn;
  if (!m.lazy) m.run();
  const set: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(m.current() as T) : next;
    // (In its loading window, its first answer still on the way: one more committed value inside the window — the
    // answer lands after it all the same.)
    if (m.loadingWindow && m.flight) {
      guardWrite(!!options?.ownedWrite);
      m.value = v;
      m.bump();
      schedule();
      return v;
    }
    const held = m.tx && !m.tx.root.done && m.staged !== NONE && !manual && !(acting && acting.tx.root === m.tx.root);
    written.write(held ? { v, rederive: true } : { v });
    return v;
  };
  const read = () => m.read();
  accessors.set(read, m);
  return [read, set];
}

export function createMemo<T>(fn: (prev?: T) => T, options?: SignalOptions<T>): Accessor<T> {
  const m = new Computation<T>(MEMO, fn, options);
  if (!m.lazy) m.run();
  const read = () => m.read();
  accessors.set(read, m);
  return read;
}

/** A memo that holds state across its runs (its rows): never released when read untracked. */
export function keepMemo<T>(read: Accessor<T>): Accessor<T> {
  const m = accessors.get(read);
  if (m) m.kept = true;
  return read;
}

type EffectBundle<T> = { effect: (value: T, prev?: T) => void | (() => void); error?: (err: unknown, cleanup: () => void) => void };

function effectOf<T>(kind: 1 | 2, compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  if (!owner && !inEffectCallback) noOwnerEffect("effect");
  // Hydrating: a client-only effect neither computes nor applies until the pass ends.
  let active = true;
  if (sharedConfig.hydrating && (options as any)?.ssrSource === "client" && !(options as any)?.transparent && hydratesUnder(owner)) {
    const hydrated = hydrationFlag();
    const inner = compute;
    active = false;
    compute = (prev) => (hydrated() ? ((active = true), inner(prev)) : (prev as T));
  }
  const e = new Computation<T>(kind, compute, options);
  // (Hydrating, a user's effect: what the server sent under its id is its first value.)
  if (sharedConfig.hydrating && !(options as any)?.transparent && (options as any)?.ssrSource !== "client") (e as any).adopts = true;
  const effect = typeof apply === "function" ? apply : apply?.effect;
  if (apply && typeof apply !== "function") e.onError = apply.error;
  e.apply = !effect ? () => {} : active ? effect : (v, prev) => (active ? effect(v, prev) : undefined);
  startEffect(e, options);
}

/** A made effect run: its first value applied now if it renders (the DOM is built with it), else at the flush. */
export function startEffect<T>(e: Computation<T>, options?: SignalOptions<T>) {
  const kind = e.kind as 1 | 2;
  e.run();
  // Deferred: what it computed first is its baseline, not a change to apply.
  if (options?.defer && e.due) {
    e.due = false;
    remove(applies[kind], e);
    e.applied = e.current() as T;
    e.promote();
  }
  // (Unless scheduled, or made by a flush's pass while something could hold it: it applies with that flush.)
  if (kind === RENDER && !options?.schedule && e.due && !e.tx && e.error === NONE) {
    // (A first pass that read only the screen applies as made.)
    // (Made by a pass replacing a frame still shown: after that frame goes, as its parent applies.)
    if (flushing && (((flights.size || transactions.size) && !madeByLeaver(e) && !(e as any).screenPass) || madeOverFrame(e))) (e as any).applyFirst = true;
    else remove(applies[RENDER], e), e.runApply();
  }
  schedule();
}
/** An effect whose first run read nothing and left nothing to undo: written once, out of the graph (a constant hole). */
export function releaseIfConstant(e: Computation<any>) {
  if (e.sources !== NOTHING_YET || e.due || e.tx || e.flight || e.error !== NONE || e.owned || e.cleanups || e.ext || e.state !== CLEAN || (e as any).applyFirst) return;
  const p = e.parent;
  if (p?.owned) remove(p.owned, e);
  e.disposed = true;
}
/** Made by a render effect's pass that left a hold: it shows the committed frame, applied as made. */
/** Made by a render effect's pass while its last frame is still parked with cleanups of its owners not run yet. */
function madeOverFrame(e: Computation<any>) {
  if (!parkedRenders) return false;
  let p: Owner | null = e.parent;
  while (p && !(p instanceof Computation)) p = p.parent;
  const parked = p && (p as Computation<any>).kind === RENDER ? ((p as any).parked as Owner[] | null) : null;
  const cleans = (o: Owner): boolean => !!o.cleanups?.length || !!o.owned?.some(cleans);
  return !!parked?.some(cleans);
}
function madeByLeaver(e: Computation<any>) {
  let p: Owner | null = e.parent;
  while (p && !(p instanceof Computation)) p = p.parent;
  return !!(p as any)?.leftHold;
}
export const RENDER_EFFECT = RENDER;

export function createEffect<T>(compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  if (process.env.NODE_ENV !== "production" && apply === undefined) {
    const message =
      "[MISSING_EFFECT_FN] createEffect requires both a compute function and an effect function. " +
      "Use `createEffect(() => signal(), value => doWork(value))`. " +
      "If you want a derived value, use `createMemo`. " +
      "If you want a one-shot side effect, just call the function directly.";
    emitDiagnostic({ code: "MISSING_EFFECT_FN", kind: "lifecycle", severity: "error", message });
    throw new Error(message);
  }
  effectOf(EFFECT, compute, apply, options);
}

export function createRenderEffect<T>(compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  effectOf(RENDER, compute, apply, options);
}

// ---------------------------------------------------------------- isPending, latest, refresh, resolve

/** Reading through isPending()/latest(): what is read is shown ahead of any hold. */
let verdictReading = 0;

/** Whether a change to what `fn` reads is on its way (in flight, or held), its value shown meanwhile. */
export function isPending(fn: () => unknown): boolean {
  const reads: Node[] = [];
  // (A probe, not a primitive: fine in an effect callback.)
  const wasIn = inEffectCallback;
  inEffectCallback = false;
  const probe = new Computation<unknown>(MEMO, () => undefined);
  inEffectCallback = wasIn;
  probe.attached = false;
  const viaLatest = new Set<Node>();
  (probe as any).viaLatest = viaLatest;
  // (Asked inside latest(): it sees the staged world, so only work still out is pending.)
  const ahead = latestDepth > 0;
  const outer = listener;
  if (outer) outer.track(status), (outer.verdictReader = true);
  // (Development, an attribution engine installed: this run asked isPending — window 1.)
  if (process.env.NODE_ENV !== "production" && outer && attrHooks !== null) (outer as any)._devWindows = ((outer as any)._devWindows ?? 0) | 1;
  // (Asked outside tracking in a strict scope: what it answers will not update there.)
  else if (strictRead) strictReadUntracked({ name: "isPending" } as Node<any>);
  verdictReading++;
  listener = probe;
  try {
    fn();
  } catch (e) {
    // Never loaded: loading, not pending. Inside an owner (a component body too, #2928) it suspends like any read;
    // outside one it never throws. An error is no pending (#2790: an Errored fallback asking of the failed source).
    if ((outer || owner) && e instanceof NotReadyError) throw e;
  } finally {
    listener = outer;
    verdictReading--;
  }
  reads.push(...probe.sources);
  if (outer) {
    verdictReading++;
    for (const s of reads) outer.track(s);
    verdictReading--;
  }
  // (Asked by a reader inside an action: that action's own held writes are its world, not pending.)
  const was = pendingInside;
  pendingInside = ((outer as any)?.insideTx as Transaction | null | undefined)?.root ?? null;
  try {
    const r = reads.some((s) => (ahead || viaLatest.has(s) ? ownWork(s) : waiting(s)));
    return r;
  } finally {
    pendingInside = was;
  }
}
/** Work latest() would show: an answer still out at a computation or upstream (a held write is shown, not waited on). */
function ownWork(n: Node, seen = new Set<Node>()): boolean {
  if (!(n instanceof Computation) || seen.has(n)) return false;
  seen.add(n);
  if (n.flight && n.ready && !n.quiet && !n.loadingWindow && !n.streaming) return true;
  for (const s of n.sources) if (ownWork(s, seen)) return true;
  return false;
}
/** Whether the memo being read had a flight up before the read brought it up to date. */
let flewBefore = false;
/** The transaction whose held writes an isPending asked from inside it does not count. */
let pendingInside: Transaction | null = null;

/** `fn` read in the newest world: what is staged in a hold or in flight, ahead of what is shown. */
export function latest<T>(fn: () => T): T {
  latestCalls++;
  // (Development, an attribution engine installed: this run asked latest — window 2.)
  if (process.env.NODE_ENV !== "production" && listener !== null && attrHooks !== null) (listener as any)._devWindows = ((listener as any)._devWindows ?? 0) | 2;
  verdictReading++;
  inPass++;
  latestDepth++;
  // (Inside isPending: what it reads here is asked for its own work only.)
  const via: Set<Node> | undefined = (listener as any)?.viaLatest;
  const at = via ? listener!.sources.length : 0;
  try {
    return fn();
  } finally {
    inPass--;
    verdictReading--;
    latestDepth--;
    if (via) for (let i = at; i < listener!.sources.length; i++) via.add(listener!.sources[i]!);
  }
}

/** latest() calls so far (a Loading `on` that reads ahead shows its fallback now). */
let latestCalls = 0;
/** latest() windows open now (an isPending inside one asks every read for its own work). */
let latestDepth = 0;

/** Run a derived value again (an async one re-asks quietly: isPending stays false). */
/** The computation behind an accessor or a refreshable store. */
const sourceOf = (target: unknown) => (typeof target === "function" ? accessors.get(target as any) : undefined) ?? (typeof target === "object" && target ? accessors.get(refreshableOf(target)?.() as any) : undefined);
/** A refreshable store's memo: the store's, or that of the store a nested node lies under. */
function refreshableOf(target: object) {
  const own = refreshables.get(target);
  if (own || !storeAncestorsHook) return own;
  for (const p of storeAncestorsHook(target)) {
    const m = refreshables.get(p);
    if (m) return m;
  }
  return undefined;
}
let storeAncestorsHook: ((p: object) => Iterable<object>) | null = null;
export const setStoreAncestors = (f: (p: object) => Iterable<object>) => void (storeAncestorsHook = f);

export function refresh<T>(target: (() => T) | object): Promise<T> {
  const c = sourceOf(target);
  if (!c && (typeof target !== "function" || !accessors.has(target))) {
    const message =
      "[INVALID_REFRESH_TARGET] refresh() expects a Solid source accessor or refreshable store. " +
      "Pass the original source target, not a wrapper function or derived property read.";
    if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "INVALID_REFRESH_TARGET", kind: "write", severity: "error", message });
    throw new Error(message);
  }
  if (!c || !(c instanceof Computation)) return Promise.resolve(typeof target === "function" ? untrack(target as () => T) : (target as T));
  // Asked again from inside an owned scope (a component, a computation): not allowed, as a write there is not.
  if (process.env.NODE_ENV !== "production" && owner && !(owner as any).allowWrites && !(owner as any).tracked && !(c as any).ownedWrite) {
    emitDiagnostic({ code: "REACTIVE_WRITE_IN_OWNED_SCOPE", kind: "write", severity: "error", message: OWNED_REFRESH_MESSAGE, ownerId: owner.id, ownerName: (owner as any).name, nodeName: c.name, data: { operation: "refresh" } });
    throw new Error(OWNED_REFRESH_MESSAGE);
  }
  // (A reload declared with affects() is not quiet: its readers pend.)
  // (A re-ask over a question still unanswered stays as loud as that question.)
  c.quiet = !(c as any).declared && !(c.flight && !c.quiet);
  (c as any).declared = false;
  (c as any).refreshed = true;
  refreshedNow.push(c);
  if (acting) (c as any).joins = acting.tx;
  c.mark(DIRTY);
  if (process.env.NODE_ENV !== "production" && attrHooks !== null) attrHooks.refreshed(c);
  // Settled when its new answer lands, in the world it lands in (an action's, still open): not when that commits.
  const answer = () => (typeof target === "function" ? (c.staged !== NONE ? c.staged : c.value) : target) as T;
  // (Disposed: nothing to ask again; its last value is the answer.)
  if (c.disposed) return Promise.resolve(answer());
  const p = new Promise<T>((ok, fail) => {
    const settled = () => {
      if (c.disposed) return ok(answer()), true;
      // (A stream settles at its fresh iteration's first value; its flight stays up while it streams.)
      if ((c.flight && !(c.streaming && c.streamed)) || c.state !== CLEAN) return false;
      if (c.error !== NONE) fail(c.error);
      else ok(answer());
      return true;
    };
    (c.waiters ??= []).push(settled);
    // In an action: asked again now, so its answer is the action's transaction's to wait for.
    if (acting) {
      try {
        untrack(() => c.read());
      } catch {}
      if (settled()) remove(c.waiters!, settled);
    }
    // Read once nothing else asks for it (a lazy memo with no reader): the re-ask still happens.
    queueMicrotask(() => {
      if (c.state !== CLEAN && !c.flight && c.waiters?.includes(settled)) {
        try {
          untrack(() => c.read());
        } catch {}
        c.wake();
      }
    });
  });
  p.catch(noop);
  return p;
}

/** A promise for `fn`'s first settled value (not in flight, not held). */
export function resolve<T>(fn: () => T): Promise<T> {
  if (listener) throw new Error("Cannot call resolve inside a reactive scope; it only resolves the current value and does not track updates.");
  // (In an action: what it reads in that action's held world answers now, as until()'s does.)
  const tx = acting?.tx ?? null;
  return new Promise<T>((ok, fail) => {
    createRoot((dispose) => {
      createEffect(
        () => {
          (listener as any).insideTx = tx;
          (listener as any).resolving = true;
          const v = fn();
          return { v, settled: !isPending(() => fn()) };
        },
        {
          effect: ({ v, settled }) => {
            if (!settled) return;
            dispose();
            ok(v);
          },
          error: (e) => (dispose(), fail(e)),
        },
      );
    });
  });
}

// ---------------------------------------------------------------- context

export type Context<T> = ((props: { value: T; children?: any }) => any) & { id: symbol; defaultValue: T | undefined };

export function createContext<T>(defaultValue?: T, options?: { name?: string }): Context<T> {
  const id = Symbol(options?.name ?? "context");
  const Provider = ((props: { value: T; children?: any }) => {
    // On its own owner (its own scope), and on the component's (what it returns is rendered there, as when hydrating).
    if (owner?.transparent) owner.context = { ...owner.context, [id]: props.value };
    const o = new Root(owner);
    o.context = { ...o.context, [id]: props.value };
    return runWithOwner(o, () => children(() => props.children));
  }) as Context<T>;
  Provider.id = id;
  Provider.defaultValue = defaultValue;
  // (Solid-style: a React tree meeting it mounts it as such.)
  (Provider as any)[Symbol.for("twist.component")] = true;
  return Provider;
}

export class ContextNotFoundError extends Error {
  constructor() {
    super("Context value not found: wrap this part in its Provider.");
  }
}

export function useContext<T>(context: Context<T>): T {
  const ctx = owner?.context;
  if (ctx && context.id in ctx) return ctx[context.id] as T;
  if (context.defaultValue === undefined) throw notFound(context, ctx);
  return context.defaultValue;
}

export function getContext<T>(context: Context<T>, o: Owner | null = owner): T {
  if (!o) throw new NoOwnerError();
  const ctx = o.context;
  if (ctx && context.id in ctx) return ctx[context.id] as T;
  if (context.defaultValue === undefined) throw notFound(context, ctx);
  return context.defaultValue;
}

/** A context with no value where it is read (inside a server component: why, and what to do instead). */
function notFound(context: Context<any>, ctx: Record<symbol, unknown> | null | undefined): Error {
  if (!ctx?.[SERVER_COMPONENT_SCOPE]) return new ContextNotFoundError();
  const name = context.id.description !== "context" ? context.id.description : undefined;
  return new Error(
    `Context${name ? ` "${name}"` : ""} cannot be read inside a server component. ` +
      "Server components render standalone on refetches and mutations, so app-level providers do not cross the boundary. " +
      "Pass the value as an argument, render the provider inside the server component, or read per-request state via getRequestEvent().",
  );
}

export function setContext<T>(context: Context<T>, value?: T, o: Owner | null = owner) {
  if (!o) throw new NoOwnerError();
  // (No value: its default.)
  o.context = { ...o.context, [context.id]: value === undefined ? context.defaultValue : value };
}

export class NoOwnerError extends Error {
  constructor() {
    super("No owner: this needs to run inside a reactive scope.");
  }
}

/** Children resolved: accessors called, arrays flattened. */
export function children<T>(fn: () => T): Accessor<any> & { toArray: () => any[] } {
  const memo = createMemo(() => resolveChildren(fn())) as Accessor<any> & { toArray: () => any[] };
  // (Solid's: the resolved children always as a list.)
  memo.toArray = () => {
    const v = memo();
    return Array.isArray(v) ? v : v != null ? [v] : [];
  };
  return memo;
}
function resolveChildren(v: any): any {
  if (typeof v === "function" && v.length === 0) return resolveChildren(v());
  if (Array.isArray(v)) {
    const out: any[] = [];
    for (const x of v) {
      const r = resolveChildren(x);
      Array.isArray(r) ? out.push(...r) : out.push(r);
    }
    return out;
  }
  return v;
}

// ---------------------------------------------------------------- actions

/** The action whose body is running now: its writes are held in its transaction. */
let acting: { tx: Transaction } | null = null;

/**
 * An async mutation: a generator (or async generator) whose writes are held together (their effects wait) until the
 * body ends and what it set off lands. Yielding a promise waits for it; the action answers a promise of the result.
 */
export function action<A extends unknown[], R>(gen: (...args: A) => Generator<any, R, any> | AsyncGenerator<any, R, any>): (...args: A) => Promise<R> {
  return (...args: A) => {
    // Invoking an action opens a transaction: like a write, not inside an owned scope.
    if (owner && !inSettled && !(owner as any).tracked) {
      if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "ACTION_CALLED_IN_OWNED_SCOPE", kind: "write", severity: "error", message: ACTION_IN_OWNED_SCOPE_MESSAGE, ownerId: owner.id, ownerName: (owner as any).name });
      throw new Error(ACTION_IN_OWNED_SCOPE_MESSAGE);
    }
    return new Promise<R>((ok, fail) => {
      const tx = newTransaction();
      if (!acting && !flushing) tickTx ??= tx;
      tx.open++;
      const me = { tx };
      const it = gen(...args);
      // (As Solid's: its end schedules a flush and answers, then the step's own flush commits it.)
      const end = (f: () => void) => {
        tx.root.open--;
        schedule();
        f();
        settleStep();
      };
      // Each step of the body ends with a flush (what it wrote shows, or reverts, as it returns).
      const settleStep = () => {
        // (Inside another action's body: its flush is that action's step end.)
        if (!flushing && !halted && !acting) flush();
        else schedule();
      };
      let first = true;
      const step = (method: "next" | "throw", input?: unknown) => {
        let r: IteratorResult<any, R> | Promise<IteratorResult<any, R>>;
        const was = acting;
        // (An action's body is no computation's: untracked, whoever resumed it.)
        const wasListener = listener;
        acting = me;
        listener = null;
        const h = process.env.NODE_ENV !== "production" ? attrHooks : null;
        if (h !== null) h.actionStepStart(it, gen.name || undefined);
        try {
          r = (it as any)[method](input);
        } catch (e) {
          acting = was;
          listener = wasListener;
          if (h !== null) h.actionStepEnd(it);
          return end(() => fail(e));
        }
        acting = was;
        listener = wasListener;
        if (h !== null) h.actionStepEnd(it);
        // (The first step runs inside its caller: its writes show at the caller's flush.)
        if (r && !(r as any).done && typeof (r as any).then !== "function") first ? schedule() : settleStep();
        first = false;
        if (r && typeof (r as any).then === "function" && !("done" in (r as any))) {
          return void (r as Promise<IteratorResult<any, R>>).then(after, (e) => end(() => fail(e)));
        }
        after(r as IteratorResult<any, R>);
      };
      const after = (r: IteratorResult<any, R>) => {
        if (r.done) return end(() => ok(r.value));
        const v = r.value;
        // (As await: a then getter or call that throws is thrown back in at the yield; one already answered stays.)
        let settled = false;
        try {
          const then = v && (typeof v === "object" || typeof v === "function") ? v.then : undefined;
          if (typeof then !== "function") return step("next", v);
          then.call(
            v,
            (x: unknown) => !settled && ((settled = true), step("next", x)),
            (e: unknown) => !settled && ((settled = true), step("throw", e)),
          );
        } catch (e) {
          if (!settled) (settled = true), step("throw", e);
        }
      };
      step("next");
    });
  };
}

/** Thrown by until() when its timeout passes. */
export class TimeoutError extends Error {
  constructor() {
    super("until() timed out");
    this.name = "TimeoutError";
  }
}

/** A promise for the first time `fn` settles truthy (with that value). */
export function until<T>(fn: () => T, options?: { timeout?: number; signal?: AbortSignal }): Promise<NonNullable<T>> {
  // (Awaited by a computation, it would run again with each pass: it belongs in an action or an event.)
  if (listener && process.env.NODE_ENV !== "production") throw new Error("[UNTIL_IN_REACTIVE_SCOPE] until() cannot be called inside a reactive scope; await it in an action or an event handler.");
  // (Aborted already: no wait at all.)
  if (options?.signal?.aborted) return Promise.reject(options.signal.reason);
  // Awaited in an action: the landing that satisfies it is that action's (held in its transaction, #3164).
  const tx = acting?.tx ?? null;
  return new Promise((ok, fail) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = createRoot((dispose) => {
      createEffect(
        () => {
          const me = listener!;
          (me as any).insideTx = tx;
          (me as any).asksTruth = true;
          authoritative++;
          try {
            const v = fn();
            if (v && tx && !tx.done)
              for (const s of me.sources) {
                if (s.staged === NONE) continue;
                if (!s.tx) holdLate(s, tx);
                // (Confirming another action's wait too: the two settle jointly.)
                else if (s.tx.root !== tx.root && !s.tx.root.done && !s.tx.root.parentTx) mergeTx(tx, s.tx);
              }
            return { v, ok: true };
          } catch (e) {
            if (e instanceof NotReadyError) return { v: undefined, ok: false };
            throw e;
          } finally {
            authoritative--;
          }
        },
        {
          effect: ({ v, ok: ready }) => {
            if (!ready || !v) return;
            done();
            ok(v as NonNullable<T>);
          },
          error: (e) => (done(), fail(e)),
        },
      );
      return dispose;
    });
    const done = () => {
      if (timer) clearTimeout(timer);
      queueMicrotask(stop);
    };
    if (options?.timeout != null) timer = setTimeout(() => (done(), fail(new TimeoutError())), options.timeout);
    options?.signal?.addEventListener("abort", () => (done(), fail(options.signal!.reason)));
  });
}

// ---------------------------------------------------------------- boundaries

/** A Loading boundary's state: the computations under it waiting on a first load. */
/** The fresh boundaries each running transaction holds at their fallback (released at its commit). */
const heldBoundaries = new Map<Transaction, Set<LoadingState>>();

class LoadingState {
  waiting = new Set<Computation<any>>();
  /** It has not shown its content yet (a hold met by its first pass is its own: see the held read). */
  fresh = true;
  /** The transactions it waits out at its fallback. */
  heldBy = new Set<Transaction>();
  holdOn(t: Transaction) {
    if (this.heldBy.has(t)) return;
    this.heldBy.add(t);
    let set = heldBoundaries.get(t);
    if (!set) heldBoundaries.set(t, (set = new Set()));
    set.add(this);
    this.count.bump();
  }
  release(t: Transaction) {
    if (this.heldBy.delete(t)) this.count.bump();
  }
  /** Its last pass showed the fallback: what is under it is not on screen. */
  onFallback = false;
  count = new (class extends Node<number> {})();
  /** A mount's own boundary (render()'s): a wait reaching it was outside every Loading. */
  mountRoot = false;
  /** Effect runs queued behind its fallback, applied at the reveal. */
  heldRuns = new Set<Computation<any>>();
  /** Its fallback gone: what waited behind it applies now. */
  reveal() {
    if (!this.heldRuns.size) return;
    for (const e of this.heldRuns) if (!e.disposed && e.due) applies[e.kind as 1 | 2].push(e);
    this.heldRuns.clear();
    schedule();
  }
  /** What its `on` reads, tracked (a change re-arms it). */
  watch: Computation<any> | null = null;
  private warned = false;
  wait(c: Computation<any>) {
    if (this.waiting.has(c)) return;
    this.waiting.add(c);
    this.count.bump();
    if (this.mountRoot && !this.warned) {
      this.warned = true;
      if (process.env.NODE_ENV !== "production") diagnose(
        {
          code: "ASYNC_OUTSIDE_LOADING_BOUNDARY",
          kind: "async",
          severity: "warn",
          message:
            "[ASYNC_OUTSIDE_LOADING_BOUNDARY] An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles.",
          ownerName: c.name,
        },
        c,
      );
    }
  }
  ready(c: Computation<any>) {
    if (this.waiting.delete(c)) this.count.bump();
  }
}

/** (Solid's owner context as its tools read it: the Loading boundary an owner is under, its readers those waiting.) */
const BOUNDARY_KEY = Symbol("loading");
function toolContext(o: Owner): Record<PropertyKey, unknown> | null {
  for (let p: Owner | null = o; p; p = p.parent) {
    const b = (p as any).loading as LoadingState | undefined;
    if (b) return { ...o.context, [BOUNDARY_KEY]: { _readers: b.waiting } };
  }
  return o.context;
}

/** Under a Loading that has not shown its content (a fresh one, not a mount's own). */
function freshBoundary(c: Computation<any>): boolean {
  const b = boundaryOf(c);
  return !!b && b.fresh && !b.mountRoot;
}

/** The Loading boundary a computation is under (found once: a boundary is set before what is under it is made). */
function boundaryOf(c: Computation<any>): LoadingState | null {
  if (c.boundary !== undefined) return c.boundary;
  let found: LoadingState | null = null;
  for (let o: Owner | null = c.parent; o; o = o.parent) {
    const b = (o as any).loading as LoadingState | undefined;
    if (b) {
      found = b;
      break;
    }
    // (A computation above that looked already: its answer is this one's.)
    if (o instanceof Computation && o.boundary !== undefined) {
      found = o.boundary;
      break;
    }
  }
  return (c.boundary = found);
}

/** `fn`'s value, or `fallback()` while what is under it waits on a first load. */
// ---------------------------------------------------------------- reads after an await (development)

// An async compute's promise is consumed by a uniquely named async function, so the engine's async stack carries a
// `__solidAsyncCompute_<id>` frame on every read in the compute's continuation: a read there with no owner, of what
// the computation did not read before its first await, will not re-run it — said once per computation and source.
let tailFlightId = 0;
const tailFlights = new Map<number, { c: WeakRef<Computation<any>>; flight: WeakRef<object> }>();
const warnedTailReads = new WeakMap<object, WeakMap<object, Set<PropertyKey | undefined>>>();
const TAIL_FRAME = /^__solidAsyncCompute_(\d+)$/;
let nextTailSweep = 64;
let disposalDepth = 0;
let untrackDepth = 0;
let disposalHealQueued = false;
let windowFlight: number | undefined;

type TailRunner = (p: PromiseLike<unknown>, done: () => void, ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise<unknown>;
/** The awaiting function for an id, named for it. (Compiled once per id: some engines name an async frame only by a
 * function's declared name, not a computed one; ids come back once their flight settles.) */
const tailRunners: TailRunner[] = [];
const freeTailIds: number[] = [];
function tailRunner(id: number): TailRunner {
  let run = tailRunners[id];
  if (run) return run;
  const name = `__solidAsyncCompute_${id}`;
  try {
    run = new Function(`return async function ${name}(p, done, ok, fail) { let v; try { v = await p; } catch (e) { done(); return fail(e); } done(); return ok(v); }`)() as TailRunner;
  } catch {
    // (No code made at run time here: a computed name, which engines that read it still see.)
    run = ({
      async [name](p: PromiseLike<unknown>, done: () => void, ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) {
        let v: unknown;
        try {
          v = await p;
        } catch (e) {
          done();
          return fail(e);
        }
        done();
        return ok(v);
      },
    } as any)[name] as TailRunner;
  }
  return (tailRunners[id] = run);
}
function watchAsyncTail<T>(c: Computation<any>, flight: object, p: PromiseLike<T>): PromiseLike<T> {
  if (!(p instanceof Promise) || p.constructor !== Promise) return p;
  return {
    then(onFulfilled: (v: T) => unknown, onRejected: (e: unknown) => unknown) {
      const id = freeTailIds.pop() ?? ++tailFlightId;
      // (Retired before settling: what the landing itself reads stays quiet; the id free again.)
      const done = () => void (tailFlights.delete(id), freeTailIds.push(id));
      if (tailFlights.size >= nextTailSweep) sweepTailFlights();
      tailFlights.set(id, { c: new WeakRef(c), flight: new WeakRef(flight) });
      tailRunner(id)(p, done, onFulfilled as (v: unknown) => unknown, onRejected);
      return undefined as any;
    },
  } as PromiseLike<T>;
}
function sweepTailFlights() {
  for (const [id, { c, flight }] of tailFlights) {
    const node = c.deref();
    const current = flight.deref();
    if (!node || !current || node.flight !== current) tailFlights.delete(id);
  }
  nextTailSweep = Math.max(64, tailFlights.size * 2);
}
/** Whether an async compute is in flight (development): only then are reads after an await looked for. */
export const watchingTails = () => tailFlights.size > 0;
/** An untracked read: said when it runs in an async compute's continuation, after its await. */
export function postAwaitRead(dep: object | undefined, holder: object, key: PropertyKey | undefined, nodeName: string | undefined, throwsPending: boolean) {
  // (A continuation resumes with no owner; what Solid runs on its stack — effect callbacks, cleanups, an action's
  // body — reads imperatively by design.)
  if (!tailFlights.size || owner !== null || inEffectCallback || acting || untrackDepth !== 0) return;
  if (disposalDepth !== 0) {
    if (!disposalHealQueued) (disposalHealQueued = true), queueMicrotask(() => ((disposalHealQueued = false), (disposalDepth = 0)));
    return;
  }
  // (One stack capture per microtask window answers "none on the stack"; a found one is captured afresh each read.)
  let id = windowFlight;
  if (id === undefined) (id = windowFlight = attributedFlight()), queueMicrotask(() => void (windowFlight = undefined));
  else if (id !== 0) id = attributedFlight();
  if (id === 0) return;
  const entry = tailFlights.get(id);
  const c = entry?.c.deref();
  if (!c || throwsPending || c === dep) return;
  const flight = entry!.flight.deref();
  if (!flight || c.flight !== flight) return;
  if (dep !== undefined && c.sources.includes(dep as Source)) return;
  let byHolder = warnedTailReads.get(c);
  if (!byHolder) warnedTailReads.set(c, (byHolder = new WeakMap()));
  let keys = byHolder.get(holder);
  if (!keys) byHolder.set(holder, (keys = new Set()));
  if (keys.has(key)) return;
  keys.add(key);
  reportDiagnostic(
    emitDiagnostic(
      {
        code: "UNTRACKED_READ_AFTER_AWAIT",
        kind: "async",
        severity: "warn",
        message:
          `[UNTRACKED_READ_AFTER_AWAIT] ${nodeName ? `"${nodeName}"` : "A reactive value"} was ` +
          `first read after an \`await\` in an async computation, so it is not a dependency: ` +
          `the computation will not re-run when it changes. Read it before the first \`await\`, ` +
          `or wrap the read in untrack() if a one-time value is intended.`,
        ownerId: c.id,
        ownerName: c.name,
        nodeName,
      },
      c,
    ),
  );
}
/** The innermost compute continuation on the async stack (its tail flight's id), or 0. */
function attributedFlight(): number {
  const E = Error as any;
  if (!E.captureStackTrace) return 0;
  const prevPrepare = E.prepareStackTrace;
  const prevLimit = E.stackTraceLimit;
  const target: { stack?: unknown } = {};
  let sites: unknown;
  E.prepareStackTrace = (_: unknown, callSites: unknown) => callSites;
  E.stackTraceLimit = 50;
  try {
    E.captureStackTrace(target, attributedFlight);
    sites = target.stack;
  } finally {
    E.prepareStackTrace = prevPrepare;
    E.stackTraceLimit = prevLimit;
  }
  if (!Array.isArray(sites)) return 0;
  for (const site of sites) {
    const match = TAIL_FRAME.exec(site.getFunctionName?.() ?? "");
    if (match) return +match[1]!;
  }
  return 0;
}

/** A computation made `sync: true` that answered with a promise or an async iterable: refused, said. */
function syncGotAsync(c: Computation<any>, thenable: boolean): never {
  const message =
    `[SYNC_NODE_RECEIVED_ASYNC] A computed/effect created with \`sync: true\` returned ` +
    `${thenable ? "a Promise" : "an AsyncIterable"}. The value would be stored as-is and ` +
    `never awaited in production; remove \`sync: true\` to use async-aware behavior, or ` +
    `unwrap the value before returning.`;
  emitDiagnostic({ code: "SYNC_NODE_RECEIVED_ASYNC", kind: "lifecycle", severity: "error", message, ownerId: c.id, ownerName: c.name });
  throw new Error(message);
}
/** A boundary made with no owner: said (it is never disposed). */
function noOwnerBoundary(boundaryType: "loading" | "error") {
  if (process.env.NODE_ENV !== "production" && !owner)
    reportDiagnostic(
      emitDiagnostic({ code: "NO_OWNER_BOUNDARY", kind: "lifecycle", severity: "warn", message: "[NO_OWNER_BOUNDARY] Boundaries created outside a reactive context will never be disposed.", data: { boundaryType } }),
    );
}
export function createLoadingBoundary<T, F>(fn: () => T, fallback: () => F, options?: { on?: () => unknown }): () => T | F {
  noOwnerBoundary("loading");
  const state = new LoadingState();
  state.mountRoot = !!(options as any)?.mountRoot;
  state.count.value = 0;
  // A slot of the reveal order around it, if any: what the order forces on it (gated, collapsed) until it has shown
  // its content.
  const order = (owner?.context?.[REVEAL] as RevealOrderController | undefined) ?? null;
  const slot: Slot = { gated: false, collapsed: false, owner: null, draw: new (class extends Node<number> {})(), ready: () => false };
  slot.draw.value = 0;
  // Its ids, as Solid's: the boundary takes one (X); its fallback's are X's own, `on` takes X00, its content the next
  // (X00, or X01 after `on`), and what the content resolves to the one after.
  const X = owner && idOwner(owner).id != null ? getNextChildId(owner) : undefined;
  let idAt = 0;
  const idUnder = () => (X === undefined ? undefined : X + "0" + (idAt++).toString(36));
  // `on`: what it reads, tracked outside the boundary (as a condition around it would be). A change after the first
  // re-arms it once the flush ends: something it shows still loading, its fallback shows again until that lands.
  let armed = false;
  let arming = false;
  let readAhead = false;
  if (options?.on) {
    const on = options.on;
    let first = true;
    // What it read last time: each node's version, and which were loading (a source going pending re-arms too).
    let seen = new Map<Node, [number, boolean, unknown]>();
    // (Transparent, as `shown`: a boundary takes one id, its content's, as the server's does.)
    const watch = new Computation<void>(MEMO, () => {
      listener!.track(status);
      const calls = latestCalls;
      try {
        on();
      } catch (e) {
        if (!(e instanceof NotReadyError)) throw e;
      }
      const now = new Map<Node, [number, boolean, unknown]>();
      let changed = false;
      for (const src of watch.sources) {
        if (src === status) continue;
        const was = seen.get(src);
        const entry: [number, boolean, unknown] = [src.version, waiting(src), src.override];
        now.set(src, entry);
        if (!was || was[0] !== entry[0] || was[2] !== entry[2] || (entry[1] && !was[1])) changed = true;
      }
      if (now.size !== seen.size) changed = true;
      seen = now;
      if (first) first = false;
      else if (changed) {
        // Written inside an action still running: the fallback is that action's frame's (staged in its transaction,
        // shown when it commits, cleared if what it shows lands first). Otherwise it shows now.
        // (Read through latest(): ahead of the frame, by choice; the fallback shows now.) Several changes in one
        // flush re-arm it once.
        // (A guess it reads — an optimistic write — is ahead of the frame too: shown now.)
        if (latestCalls !== calls || watch.sources.some((s) => s.override !== NONE)) readAhead = true;
        if (arming) return;
        arming = true;
        endWith(null, () => {
          arming = false;
          const ahead = readAhead;
          readAhead = false;
          if (content.disposed || !(pendingUnder(content) || pendingUnder(shown))) return;
          armed = true;
          // The frame the change is in, as it stands now that the flush has held what it holds.
          let frame: Transaction | null = null;
          // (A plain write's frame only when what holds it derives from what `on` read: a write that merely joined the
          // round's transaction leaves the fallback to show now, #3575.)
          if (!ahead) for (const src of watch.sources) if (src.tx && !src.tx.done && (src.tx.root.open || derivesFrom(src.tx.root.flights, watch.sources))) frame = src.tx.root;
          const inside = (o: Owner | null) => {
            for (; o; o = o.parent) if (o === content || o === shown || o === watch) return true;
            return false;
          };
          if (frame) {
            hold(shown, frame), ((shown as any).followsFrame = true), endWith(frame, () => ((shown as any).followsFrame = false));
            // The frame no longer waits on what only its content reads: the boundary does (its fallback shows meanwhile).
            for (const f of frame.flights) if ([...f.observers].every((o) => inside(o))) frame.flights.delete(f);
          }
          // (Development: what it waits on holds the frame from outside it too — its fallback can never be seen.)
          if (process.env.NODE_ENV !== "production" && frame) {
            let same: Computation<any> | null = null;
            const outsideRead = (n: Computation<any>) => !!n.flight && !n.disposed && [...n.observers].some((o) => !inside(o)) && !!(same = n);
            someUpstream(content, outsideRead) || someUpstream(shown, outsideRead);
            const name = (same as Computation<any> | null)?.name ?? "an async value";
            if (same)
              diagnose({
                code: "LOADING_ON_OUTSIDE_HOLD",
                kind: "async",
                severity: "warn",
                message: `[LOADING_ON_OUTSIDE_HOLD] A Loading boundary re-armed by its \`on\` waits on \`${name}\`, but \`${name}\` is also read outside it and holds the frame: the frame waits for it, so the fallback can never be seen. Move the outside read under the boundary. (Reading \`latest()\` in \`on\` shows the fallback now, beside the frame still held.)`,
                data: { source: name },
              });
          }
          slot.draw.bump();
          schedule();
        });
      }
    }, { transparent: true, id: idUnder() } as any);
    state.watch = watch;
    watch.run();
  }
  // The content: built once under the boundary (what under it waits on a first load tells the boundary), built
  // again only when what it reads changes.
  const NOT_READY = {};
  const content: Computation<T | typeof NOT_READY> = new Computation<T | typeof NOT_READY>(MEMO, () => {
    try {
      return fn();
    } catch (e) {
      // Waiting: the pass is the boundary's (its fallback shows), not held with what it read.
      // (Shown its content before, not re-armed: what waits now is held — its last content stays, A33.)
      if (e instanceof NotReadyError && !state.fresh && !armed && content.ranAt !== -1) throw e;
      if (e instanceof NotReadyError) return (content.readHeld = null), NOT_READY;
      throw e;
    }
  }, { id: idUnder() } as any);
  (content as any).loading = state;
  // Only boundaries made directly under a reveal order are its members: not those inside this one.
  if (content.context?.[REVEAL]) content.context = { ...content.context, [REVEAL]: undefined };
  content.run();
  // Ready: its content made, nothing under it waiting.
  slot.ready = () =>
    untrack(() => {
      if (content.read() === NOT_READY) return false;
      for (const w of state.waiting) if (w.disposed || w.dormant) state.waiting.delete(w);
      return !state.waiting.size && !state.heldBy.size;
    });
  // The fallback, made once each time it shows (under an owner of its own, kept across the passes that show it).
  const outer = owner;
  let shownFallback: { value: F; dispose: () => void } | null = null;
  // (Development, an attribution engine installed: told when its fallback starts and stops showing.)
  let devShowing = false;
  let devStaged = false;
  const showFallback = (): F => {
    if (process.env.NODE_ENV !== "production" && attrHooks !== null && !devShowing) {
      // (Staged with a frame: shown from its commit, if it is still there then.)
      const frame = (shown as any).followsFrame && shown.tx && !shown.tx.root.done ? shown.tx.root : null;
      if (frame) {
        if (!devStaged)
          (devStaged = true),
            endWith(frame, () => {
              devStaged = false;
              if (shownFallback && !devShowing && attrHooks !== null) (devShowing = true), attrHooks.boundaryFallback(state, content, true, null);
            });
      } else {
        devShowing = true;
        attrHooks.boundaryFallback(state, content, true, null);
        if (!flushing) schedule();
      }
    }
    if (!shownFallback)
      runWithOwner(outer, () =>
        createRoot((dispose) => {
          fallbackFresh++;
          try {
            shownFallback = { value: untrack(fallback), dispose };
          } catch (e) {
            dispose();
            throw e;
          } finally {
            fallbackFresh--;
          }
        }, X === undefined ? undefined : { id: X }),
      );
    return shownFallback!.value;
  };
  const dropFallback = () => {
    shownFallback?.dispose();
    shownFallback = null;
  };
  if (owner) onCleanup(dropFallback);
  // (Fallback to content, or back, is a change even when both show the same value: what it shows is told then.)
  const sameSide = (a: unknown, b: unknown) => a === b && state.onFallback === (shown as any).nextFallback;
  // What shows: the fallback while something under it waits, else the content (its accessors read here, so a
  // change inside it never builds the content again). Held by a reveal order: its fallback (or nothing, collapsed).
  const shown = new Computation<T | F>(MEMO, () => {
    listener!.track(state.count);
    listener!.track(slot.draw);
    const c = content.read();
    for (const w of state.waiting) if (w.disposed || w.dormant) state.waiting.delete(w);
    // Its readiness may have changed: the order looks again.
    if (slot.owner) slot.owner.evaluate();
    (shown as any).nextFallback = true;
    // (A boundary that has not shown its content, or was reset, catches what waits now: its fallback shows at once.)
    if (state.fresh) state.onFallback = true;
    if (slot.owner && slot.gated) return slot.collapsed ? (dropFallback(), undefined as any) : showFallback();
    // (A mount, once on screen, never goes back: what waits under it later is held, not hidden.)
    if (c === NOT_READY || (!(state.mountRoot && !state.fresh) && (state.waiting.size || state.heldBy.size))) return showFallback();
    try {
      const v = resolveChildren(c);
      // Re-armed: the fallback until what it shows has landed (looked at again whenever something stops loading: an
      // answer equal to the last changes nothing it reads). What it shows is made by now (lazy children are made
      // here, owned by this pass), so all of it is looked at.
      if (armed) {
        listener!.track(status);
        // (Re-armed: its fallback shows now, with the change that re-armed it.)
        if (pendingUnder(content) || pendingUnder(shown)) return (state.onFallback = true), showFallback();
        armed = false;
      }
      (shown as any).nextFallback = false;
      state.fresh = false;
      if (process.env.NODE_ENV !== "production" && devShowing) (devShowing = false), attrHooks?.boundaryFallback(state, content, false);
      dropFallback();
      // Content shown: the slot leaves the order (shown is shown); the order looks again.
      if (slot.owner) {
        const o = slot.owner;
        slot.owner = null;
        o.evaluate();
      }
      return v;
    } catch (e) {
      if (e instanceof NotReadyError) return showFallback();
      throw e;
    }
    // (Wide by construction: it resolves each child it shows, #3739.)
  }, X === undefined ? ({ transparent: true, equals: sameSide, _wide: true } as any) : ({ id: idUnder(), equals: sameSide, _wide: true } as any));
  if (order) {
    order.add(slot);
    if (owner) onCleanup(() => order.remove(slot));
  }
  // What it makes (lazy children) is behind its fallback too, when that shows.
  (shown as any).shows = state;
  // (Showing its fallback once what it shows is committed: a held pass that would show it changes nothing on screen.)
  const promote = shown.promote;
  shown.promote = function (this: Computation<any>) {
    promote.call(this);
    state.onFallback = (this as any).nextFallback;
    if (!state.onFallback) state.reveal();
  };
  shown.run();
  state.onFallback = (shown as any).nextFallback;
  if (!state.onFallback) state.reveal();
  const read = () => shown.read();
  accessors.set(read, shown);
  return read;
}

/**
 * Whether something `root` shows is still loading: an async node in flight among what it, or anything it owns,
 * reads (upstream through memos).
 */
/** Whether one of `flights` reads one of `sources`, directly or through memos. */
function derivesFrom(flights: Set<Computation<any>>, sources: Node<any>[]): boolean {
  const seen = new Set<Node<any>>();
  const up = (n: Node<any>): boolean => {
    if (seen.has(n)) return false;
    seen.add(n);
    if (sources.includes(n)) return true;
    return n instanceof Computation && n.sources.some(up);
  };
  for (const f of flights) if (up(f)) return true;
  return false;
}

function pendingUnder(root: Computation<any>): boolean {
  return someUpstream(root, (n) => !!n.flight && !n.disposed);
}

/** Whether `test` holds for a computation among what `root`, or anything it owns, reads (upstream through memos). */
function someUpstream(root: Computation<any>, test: (n: Computation<any>) => boolean): boolean {
  const seen = new Set<Node<any>>();
  const upstream = (n: Node<any>): boolean => {
    if (seen.has(n)) return false;
    seen.add(n);
    if (!(n instanceof Computation)) return false;
    if (test(n)) return true;
    for (const src of n.sources) if (upstream(src)) return true;
    return false;
  };
  const owners: Owner[] = [root];
  while (owners.length) {
    const o = owners.pop()!;
    if (o instanceof Computation && upstream(o)) return true;
    if (o.owned) owners.push(...o.owned);
  }
  return false;
}

// ---------------------------------------------------------------- reveal order

const REVEAL = Symbol("reveal order");

/** A Loading boundary as a reveal order sees it. */
type Slot = {
  /** Forced to its fallback by the order. */
  gated: boolean;
  /** Forced to nothing (a collapsed sequential tail). */
  collapsed: boolean;
  /** The order that still owns it (null once it has shown its content). */
  owner: RevealOrderController | null;
  /** Bumped to make the boundary decide again what it shows. */
  draw: Node<number>;
  /** Its content made and nothing under it waiting. */
  ready: () => boolean;
};
type Member = Slot | RevealOrderController;
export type RevealOrder = "sequential" | "together" | "natural";

const isOrder = (m: Member): m is RevealOrderController => m instanceof RevealOrderController;
const memberReady = (m: Member): boolean => (isOrder(m) ? m.allReady() : m.ready());
const memberSomeReady = (m: Member): boolean => (isOrder(m) ? m.someReady() : m.ready());

/** What the order forces on a member: a boundary decides again; a nested order passes it on to its own. */
function force(m: Member, by: RevealOrderController, gated: boolean, collapsed: boolean) {
  if (isOrder(m)) {
    m.gated = gated;
    m.collapsed = collapsed;
    m.evaluate();
    // Released and ready (all of its own shown), a nested order leaves its parent, as a boundary that showed.
    if (!gated && m.wasReady && m.parent === by) m.parent = null;
    return;
  }
  if (m.gated !== gated || m.collapsed !== collapsed) {
    m.gated = gated;
    m.collapsed = collapsed;
    m.draw.bump();
  }
}

/**
 * The order in which the Loading boundaries made directly under it (its members; a nested order is one member) show
 * their content: sequential (front to back: the first not ready shows its fallback, those behind it theirs, or nothing
 * when collapsed), together (all once each can show something), natural (each when it is ready). A member leaves the
 * order once it has shown its content.
 */
class RevealOrderController {
  members: Member[] = [];
  /** The order gating this one, until it releases it. */
  parent: RevealOrderController | null = null;
  /** What a parent forces on this whole group. */
  gated = false;
  collapsed = false;
  wasReady = true;
  wasSomeReady = true;
  private busy = false;
  constructor(
    public order: () => RevealOrder,
    public collapse: () => boolean,
  ) {}
  /** A member that has left: a boundary that showed its content, a nested order that is ready. */
  gone(m: Member) {
    return (isOrder(m) ? m.parent : m.owner) !== this;
  }
  /** `fn` for each member still owned, in order; false as soon as one says false. */
  each(fn: (m: Member) => boolean | void) {
    for (const m of this.members) if (!this.gone(m) && fn(m) === false) return false;
    return true;
  }
  allReady(): boolean {
    return this.each((m) => memberReady(m));
  }
  /** Something to show under its own order (what an enclosing `together` waits for). */
  someReady(): boolean {
    const order = untrack(this.order);
    const ms = this.members;
    if (!ms.length) return true;
    if (order === "sequential") return this.gone(ms[0]!) || memberSomeReady(ms[0]!);
    for (const m of ms) {
      const r = this.gone(m) || memberSomeReady(m);
      if (order === "natural" ? r : !r) return order === "natural";
    }
    return order !== "natural";
  }
  add(m: Member) {
    if (this.members.includes(m)) return;
    this.members.push(m);
    // Gated from the start (nothing, in a collapsed sequential tail); evaluating releases what the order allows.
    const collapsed = untrack(this.order) === "sequential" && !!untrack(this.collapse);
    if (isOrder(m)) {
      m.parent = this;
      m.gated = true;
      m.collapsed = collapsed;
      m.evaluate();
    } else {
      m.owner = this;
      m.gated = true;
      m.collapsed = collapsed;
    }
    untrack(() => this.evaluate());
  }
  remove(m: Member) {
    const at = this.members.indexOf(m);
    if (at >= 0) this.members.splice(at, 1);
    untrack(() => this.evaluate());
  }
  /** The order applied to the members still owned (or a parent's state forced on all of them). */
  evaluate() {
    if (this.busy) return;
    this.busy = true;
    const wasReady = this.wasReady;
    const wasSomeReady = this.wasSomeReady;
    try {
      const order = untrack(this.order);
      const tail = order === "sequential" && !!untrack(this.collapse);
      if (this.gated) this.each((m) => force(m, this, true, this.collapsed));
      else if (order === "natural") this.each((m) => force(m, this, isOrder(m) ? false : !m.ready(), false));
      else if (order === "together") {
        const all = this.each(memberSomeReady);
        this.each((m) => force(m, this, !all, false));
      } else {
        let frontier = false;
        this.each((m) => {
          if (frontier) return force(m, this, true, tail);
          if (memberReady(m)) return force(m, this, false, false);
          frontier = true;
          // The frontier shows its fallback; a nested order at the frontier runs its own.
          force(m, this, !isOrder(m), false);
        });
      }
    } finally {
      this.wasReady = this.allReady();
      this.wasSomeReady = this.someReady();
      this.busy = false;
    }
    if (this.parent && (wasReady !== this.wasReady || wasSomeReady !== this.wasSomeReady)) this.parent.evaluate();
  }
}

/**
 * The order in which the Loading boundaries `fn` makes directly show their content (`<Reveal>`'s primitive).
 * `order`: "sequential" (default), "together" or "natural"; `collapsed`: in a sequential order, those behind the
 * first not ready show nothing rather than their fallbacks.
 */
export function createRevealOrder<T>(fn: () => T, options?: { order?: () => RevealOrder; collapsed?: () => boolean }): T {
  const o = createOwner();
  const outer = (o.context?.[REVEAL] as RevealOrderController | undefined) ?? null;
  const ctrl = new RevealOrderController(options?.order ?? (() => "sequential"), options?.collapsed ?? (() => false));
  o.context = { ...o.context, [REVEAL]: ctrl };
  return runWithOwner(o, () => {
    const out = fn();
    // The order and collapse options tracked: a change applies the order again.
    const watch = new Computation<void>(MEMO, () => {
      ctrl.order();
      ctrl.collapse();
      ctrl.evaluate();
    });
    watch.run();
    if (outer) {
      outer.add(ctrl);
      onCleanup(() => outer.remove(ctrl));
    }
    return out;
  });
}

/** `fn`'s value, or `fallback(error, reset)` once something under it throws. */
/** Whether what is made under `o` hydrates with ids (an owner with one, outside NoHydration). */
const hydratesUnder = (o: Owner | null) => o?.id != null && !o.context?.[Symbol.for("twist.no-hydrate")];

/** A computation that failed run again, with what failed upstream of it (asked again: a source that fails anew shows
 * its error). */
export function runAgain(c: Computation<any>) {
  if (c.disposed) return;
  someUpstream(c, (n) => (n !== c && n.error !== NONE && n.mark(DIRTY), false));
  c.mark(DIRTY);
  schedule();
}
export function createErrorBoundary<T, F>(fn: () => T, fallback: (error: () => unknown, reset: () => void) => F): () => T | F {
  noOwnerBoundary("error");
  // Hydrating where the server caught an error: its content throws that error first (the server's fallback shows).
  if (sharedConfig.hydrating && hydratesUnder(owner)) {
    const sc = sharedConfig as any;
    const id = peekNextChildId(owner!);
    const err = sc.has?.(id) ? sc.load(id) : undefined;
    if (err !== undefined) {
      const inner = fn;
      let first = true;
      fn = () => {
        if (!first) return inner();
        first = false;
        throw err;
      };
    }
  }
  const failed = new Signal<unknown>(NONE, { ownedWrite: true, equals: false });
  // Reset: a write (an action holds it like any other), done by the boundary's next run — the content made again, and
  // what failed upstream of it asked again (a source that fails anew shows its error).
  const resets = new Signal(0, { ownedWrite: true });
  let resetCount = 0;
  let resetSeen = 0;
  const reset = () => resets.write(++resetCount);
  // What threw below it: a reset runs these again (as Solid's), the content staying alive behind the fallback; the
  // content is made again only when it failed itself, or nothing below is known to have thrown.
  const failedBelow = new Set<Computation<any>>();
  const doReset = () => {
    failed.value = NONE;
    view?.dispose();
    view = null;
    caughtBelow = false;
    const again = content.error !== NONE || !failedBelow.size ? [content] : [...failedBelow];
    failedBelow.clear();
    for (const c of again) runAgain(c);
  };
  let caughtBelow = false;
  // The boundary: what under it throws comes here. Transparent, as its content takes the id it would.
  const boundary = new Root(owner, { transparent: true });
  (boundary as any).catch = (e: unknown, from?: Computation<any>) => {
    if (from) failedBelow.add(from);
    // (What threw it, once it runs cleanly again: the error is over, the content shows again.)
    if (from)
      (from as any).recoverTo = () => {
        if (failed.value !== e || !caughtBelow) return;
        failed.value = NONE;
        caughtBelow = false;
        failed.bump();
      };
    // (Already showing an error: the latest one shown instead.)
    if (failed.value === e) return true;
    failed.value = e;
    caughtBelow = true;
    showError(e);
    failed.bump();
    reportCaught(e, m);
    return true;
  };
  // Only boundaries made directly under a reveal order are its members: not those inside this one.
  if (boundary.context?.[REVEAL]) boundary.context = { ...boundary.context, [REVEAL]: undefined };
  // The content: made once (again only when what its making reads changes, or at a reset), apart from what it shows.
  const content: Computation<T> = runWithOwner(boundary, () => new Computation<T>(MEMO, () => fn(), { name: "children" }));
  // (What the content made waits behind the fallback: its effects apply when it shows again.)
  const held: FallbackHold = {
    onFallback: false,
    mountRoot: false,
    heldRuns: new Set(),
    reveal() {
      this.onFallback = false;
      if (!this.heldRuns.size) return;
      for (const e of this.heldRuns) if (!e.disposed && e.due) applies[e.kind as 1 | 2].push(e);
      this.heldRuns.clear();
      schedule();
    },
  };
  (content as any).erroredHold = held;
  // (What the server sent under its id is the boundary's error, not a value of the content.)
  (content as any).ownValue = true;
  // What the fallback shows: built once per show under the boundary (a later error reaches it through its `error`
  // accessor), kept current with what it reads.
  let view: Computation<F> | null = null;
  // (The error the fallback shows, apart: a new one reaches it without running the boundary again.)
  const shownError = new Signal<unknown>(NONE, { ownedWrite: true, equals: false });
  const showError = (e: unknown) => void ((shownError.value = e), shownError.bump());
  const error = () => shownError.read();
  // (Owned by the boundary, not by what shows it: that one runs again each time the view changes, and would dispose it.)
  const showFallback = (): F => {
    held.onFallback = true;
    if (!view || view.disposed) {
      view?.dispose();
      view = runWithOwner(boundary, () => new Computation<F>(MEMO, () => resolveChildren(fallback(error, reset))));
      view.run();
    }
    return view.read();
  };
  const m: Computation<T | F> = runWithOwner(boundary, () => new Computation<T | F>(MEMO, (): T | F => {
    const r = resets.read();
    if (r !== resetSeen) (resetSeen = r), doReset();
    failed.read();
    // An error something under it threw (an effect): shown until reset.
    if (failed.value !== NONE && caughtBelow) return showFallback();
    // Otherwise the content is tried, failed or not (tracked through what it reads): once what failed recovers, it shows.
    try {
      const v = resolveChildren(content.read());
      if (failed.value !== NONE) (failed.value = NONE), (view = null);
      if (held.onFallback) held.reveal();
      return v;
    } catch (e) {
      if (e instanceof NotReadyError) throw e;
      const by = throwerOf(e);
      if (by instanceof Computation && by !== content) failedBelow.add(by);
      if (failed.value !== e) (failed.value = e), showError(e), reportCaught(e, m);
      return showFallback();
    }
  }, { transparent: true } as any));
  content.run();
  m.run();
  const read = () => m.read();
  accessors.set(read, m);
  return read;
}

/** A value with what is under it resolved: accessors called, nested arrays flattened. */
// (Ported from Solid's flatten: `skipNonRendered` drops null, booleans and ""; `doNotUnwrap` leaves accessors in, the
// answer then a function resolving them.)
type FlattenOptions = { skipNonRendered?: boolean; doNotUnwrap?: boolean };
export function flatten(children: any, options?: FlattenOptions): any {
  if (typeof children === "function" && !children.length) {
    if (options?.doNotUnwrap) return children;
    do children = children();
    while (typeof children === "function" && !children.length);
  }
  if (options?.skipNonRendered && (children == null || children === true || children === false || children === "")) return;
  if (!Array.isArray(children)) return children;
  const results: any[] = [];
  if (!flattenArray(children, results, options)) return results;
  return () => {
    const nested: any[] = [];
    flattenArray(results, nested, { ...options, doNotUnwrap: false });
    return nested;
  };
}
function flattenArray(children: any[], results: any[], options?: FlattenOptions): boolean {
  let notReady: NotReadyError | null = null;
  let needsUnwrap = false;
  for (let child of children) {
    try {
      if (typeof child === "function" && !child.length) {
        if (options?.doNotUnwrap) {
          results.push(child);
          needsUnwrap = true;
          continue;
        }
        do child = child();
        while (typeof child === "function" && !child.length);
      }
      if (Array.isArray(child)) needsUnwrap = flattenArray(child, results, options) || needsUnwrap;
      else if (!(options?.skipNonRendered && (child == null || child === true || child === false || child === ""))) results.push(child);
    } catch (e) {
      if (!(e instanceof NotReadyError)) throw e;
      notReady = e;
    }
  }
  if (notReady) throw notReady;
  return needsUnwrap;
}

// ---------------------------------------------------------------- optimistic values

/** Optimistic writes waiting for the next flush: [node, value, the action's transaction or null]. */
const guesses: [Node, unknown, Transaction | null][] = [];
/** Overrides installed outside an action: reverted at the end of their flush. */
const ambient: Node[] = [];
/** What undoes optimistic store writes made outside an action, at the end of their flush. */
const ambientEnds: (() => void)[] = [];

/** `end` run when the optimistic writes being made now are undone: at their action's end, or at the flush's. */
export function onGuessEnd(end: () => void) {
  const tx = acting?.tx.root;
  if (tx && !tx.done) tx.ends.push(end);
  else ambientEnds.push(end), schedule();
}

/** Outside an action: the hold already on `n`, or its own refetch still unanswered (a guess shown until it lands). */
function overFlight(n: Node | undefined): Transaction | null {
  if (!n) return null;
  if (n.tx && !n.tx.done) return n.tx.root;
  if (n instanceof Computation && (n.flight || n.state === DIRTY)) {
    if (n.state === DIRTY) n.update();
    if (n.flight && !n.streamed) {
      const tx = newTransaction();
      tx.flights.add(n);
      // (A bare guess riding a refetch: no action made it.)
      (tx as any).bare = true;
      return tx;
    }
  }
  return null;
}

function installGuesses() {
  for (let [n, v, tx] of guesses.splice(0)) {
    // Outside an action: over the hold already on the node, or over its own refetch (shown until that answer lands).
    if (!tx || tx.done) tx = overFlight(n);
    // Nothing held yet: the frame decides (what this flush parks into), once it has settled.
    if (!tx || tx.done) {
      frameGuesses.push([n, v]);
      continue;
    }
    installGuess(n, v, tx);
  }
}

/** An optimistic write to `n`: shown from the next flush until the action that made it ends. */
export function guess(n: Node, v: unknown) {
  // Written in a lane's own pass: the lane is its parent.
  const l = listener;
  const lane = l ? unrevealed(l.passLane) ?? unrevealed(l.readHeld?.root.parentTx ? l.readHeld.root : null) : null;
  guesses.push([n, v, acting?.tx ?? lane]);
  schedule();
}

/**
 * A signal whose writes are optimistic: shown at once (from the next flush), over the truth, until the action that
 * wrote them ends; given a function, the truth is derived from what it reads.
 */
export function createOptimistic<T>(value: T | ((prev?: T) => T), options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  const n: Node<T> =
    typeof value === "function"
      ? (() => {
          const m = new Computation<T>(MEMO, value as (prev?: T) => T, options);
          if (!m.lazy) m.run();
          return m;
        })()
      : new Signal(value as T, { ...options, ownedWrite: true });
  if (n instanceof Signal) registerGraph(n, owner);
  const read = n instanceof Computation ? () => n.read() : () => (n as Signal<T>).read();
  accessors.set(read, n as any);
  const set: Setter<T> = (next) => {
    if (typeof next !== "function") return guess(n, next), next;
    // The updater sees this tick's own last guess, else what shows.
    let prev: T = n.override !== NONE ? (n.override as T) : n.value;
    for (let i = guesses.length - 1; i >= 0; i--) if (guesses[i]![0] === n) {
      prev = guesses[i]![1] as T;
      break;
    }
    const v = (next as (prev: T) => T)(prev);
    guess(n, v);
    return v;
  };
  return [read, set];
}

/** Callbacks for the next flush, once everything else in it is done. */
const settledQueue: (() => void)[] = [];
/** onSettled callbacks waiting for a mount's first loads. */
const heldSettled: (() => void)[] = [];
/** Whether a mount frame is still loading what something on screen waits on. */
function mountLoading(): boolean {
  for (const c of mountFlights) if (c.flight && !c.disposed && !c.tx && !flightHolder(c) && mountShown(c)) return true;
  for (const t of transactions) if ((t as any).mount && !t.done) return true;
  return false;
}
/** Inside an onSettled or tracked-effect callback: flush() and onCleanup() are not allowed there. */
let inSettled = 0;

/**
 * `fn` run once the next flush has settled: untracked, but if it reads something not ready yet it runs again when that
 * lands. What it returns runs when its owner ends (an error with no owner to bind it to).
 */
export function onSettled(fn: () => void | (() => void)) {
  const o = owner;
  let ended = false;
  let clean: (() => void) | undefined;
  if (o) (o.cleanups ??= []).push(() => ((ended = true), clean?.()));
  // Waiting on what was not ready: a computation that runs the callback again when it lands.
  const waiter = new Computation<void>(EFFECT, () => {});
  waiter.parent = null;
  waiter.apply = () => {};
  const attempt = () => {
    if (ended) return;
    let done: unknown;
    inSettled++;
    try {
      done = runWithOwner(null, fn);
    } catch (e) {
      if (!(e instanceof NotReadyError)) {
        // (The error boundary above the owner that asked for it takes it.)
        for (let x: Owner | null = o; x; x = x.parent) {
          const catcher = (x as any).catch as ((e: unknown) => boolean) | undefined;
          if (catcher && catcher(e)) return;
        }
        throw e;
      }
      const source = e.source as Node | undefined;
      if (source) {
        waiter.fn = () => {
          (source as any).read?.call(source);
        };
        waiter.sources = NOTHING_YET as Source[];
        waiter.seen = NOTHING_YET as number[];
        waiter.attached = true;
        waiter.track(source);
        waiter.fn = () => void settledQueue.push(attempt);
        waiter.state = CLEAN;
      }
      return;
    } finally {
      inSettled--;
    }
    if (done === undefined) return;
    if (typeof done !== "function") throw new Error("onSettled callback returned an invalid cleanup value. Return a cleanup function or undefined.");
    if (!o || o.disposed) {
      const message =
        "[SETTLED_CLEANUP_UNOWNED] onSettled returned a cleanup in an unowned scope; a cleanup can only be honored under an owner. Call your setup helper from an owned scope (e.g. the component body) instead of from inside an event handler, tracked effect, or another onSettled.";
      if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "SETTLED_CLEANUP_UNOWNED", kind: "lifecycle", severity: "error", message });
      throw new Error(message);
    }
    clean?.();
    clean = done as () => void;
  };
  settledQueue.push(attempt);
  schedule();
}

/**
 * A single-function effect: it runs at the flush, tracked (it may write), runs again when what it read changes, and
 * what it returns runs before the next run and when it ends.
 */
export function createTrackedEffect(fn: () => void | (() => void)) {
  let clean: void | (() => void);
  const e = new Computation<void>(EFFECT, () => {
    if (typeof clean === "function") clean();
    inSettled++;
    try {
      const done = fn();
      if (done !== undefined && typeof done !== "function") throw new Error("trackedEffect callback returned an invalid cleanup value. Return a cleanup function or undefined.");
      clean = done;
    } finally {
      inSettled--;
    }
  });
  (e as any).allowWrites = true;
  // It runs in the effect phase (after render effects apply), tracked: its run is its apply.
  e.tracked = true;
  e.apply = () => {};
  e.state = DIRTY;
  queue(e);
  onCleanup(() => typeof clean === "function" && clean());
}

/** Declares that the work in progress will change `target`: it reads as pending until that work lands. */
export function affects(target: unknown, key?: PropertyKey) {
  if (arguments.length > 2)
    invalidAffects('affects() takes a single optional key — extra keys are not a path. Mark each slot with its own affects(record, key) call, or pass the nested record itself: affects(state.user, "name").');
  const tx = acting?.tx;
  // A store: the slot's node, or the record and every node under it (store.ts says which).
  const marked = storeMarks?.(target, key);
  const c = sourceOf(target);
  if (marked) {
    // A derived store as a whole: its derive, which everything read through it (and through stores derived from it)
    // depends on; its next refresh, outside an action, a declared reload.
    if (c && key === undefined) {
      // (Outside an action, its declared reload's flight holds the slots' marks.)
      if (!tx) return ((c as any).declared = true), markAffected(marked, null, c);
      marked.push(c);
    }
    return markAffected(marked, tx ?? null);
  }
  if (!c) return invalidAffects("affects() expects a Solid source accessor or a store. Pass the store proxy (optionally with a property key) or the original accessor, not a wrapper function or an already-read value.");
  if (key !== undefined) invalidAffects("affects() keys are only valid on store targets. An accessor is a single slot — pass it alone, or target the store record that owns the property.");
  // Outside an action: the next refresh of it is a declared reload.
  if (!tx) (c as any).declared = true;
  markAffected([c], tx ?? null);
}
/** Nodes declared affected: their readers pend until the action's transaction ends (outside one, the flush). */
function markAffected(nodes: Node[], tx: Transaction | null, holder?: Node) {
  for (const n of nodes) (n as any).affected = ((n as any).affected ?? 0) + 1;
  statusChanged();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const n of nodes) (n as any).affected--;
    statusChanged();
  };
  if (tx) return endWith(tx, release);
  // Outside an action: to the flush's end, or (a marked node's answer in flight: a declared reload) to its landing.
  endWith(null, () => {
    const flying = [holder, ...nodes].find((n) => n instanceof Computation && n.flight) as Computation<any> | undefined;
    if (!flying?.settles) return release();
    // (Released as the answer lands, in that flush; the promise covers a failure.)
    ((flying as any).landRelease ??= []).push(release);
    flying.settles.then(release, release);
  });
}
function invalidAffects(detail: string): never {
  const message = "[INVALID_AFFECTS_TARGET] " + detail;
  if (process.env.NODE_ENV !== "production") emitDiagnostic({ code: "INVALID_AFFECTS_TARGET", kind: "write", severity: "error", message });
  throw new Error(message);
}
/** What a store target marks (given by store.ts when its first record is made: none, and there is no store). */
let storeMarks: ((target: unknown, key: PropertyKey | undefined) => Node[] | null) | null = null;
export const useStoreMarks = (f: typeof storeMarks) => void (storeMarks = f);

// ---------------------------------------------------------------- the client error hook, ids, reactions

/** Where a root keeps its own error hook (ahead of configureClientErrors'). */
export const ROOT_ERROR_HOOK = Symbol("root-error-hook");
type ErrorHook = (error: unknown, info: { ownerPath?: string[]; boundaryPath?: string[] }) => void;
let clientHook: ErrorHook | undefined;
const told = new WeakSet<object>();

/** The hook told whenever an Errored boundary catches something (once per error object). */
export function configureClientErrors(options: { onError?: ErrorHook }) {
  if (options.onError !== undefined && typeof options.onError !== "function") throw new TypeError("configureClientErrors: onError must be a function");
  clientHook = options.onError;
}

function reportCaught(e: unknown, boundary: Owner) {
  if (e && typeof e === "object") {
    if (told.has(e)) return;
    told.add(e);
  }
  let hook: ErrorHook | undefined;
  for (let o: Owner | null = boundary; o && !hook; o = o.parent) hook = (o as any)[ROOT_ERROR_HOOK];
  hook ??= clientHook;
  if (!hook) return;
  try {
    // (Where it was thrown, and the boundary that met it: labelled owners only, each path only when there is one.)
    const context: { ownerPath?: string[]; boundaryPath?: string[] } = {};
    const thrown = ownerPath(throwerOf(e) ?? boundary);
    const met = ownerPath(boundary);
    if (thrown) context.ownerPath = thrown;
    if (met) context.boundaryPath = met;
    hook(e, context);
  } catch (err) {
    console.error(err);
  }
}

let idCount = 0;
/**
 * An id unique on this page: rendered on a server, or hydrating, its owner's next child id (the same on both sides);
 * made on the client alone, a counter's.
 */
export function createUniqueId(): string {
  if (serverRender || sharedConfig.hydrating) {
    if (!owner) throw new Error("createUniqueId cannot be used outside of a reactive context");
    // (Under NoHydration nothing hydrates: no id is taken.)
    if (sharedConfig.hydrating && owner.context?.[Symbol.for("twist.no-hydrate")]) return undefined as any;
    return getNextChildId(owner);
  }
  return "cl-" + idCount++;
}

/** `onChange` called once, the first time what the returned tracker's function reads changes. */
export function createReaction(onChange: () => void) {
  let stop: (() => void) | null = null;
  return (fn: () => void) => {
    stop?.();
    // (Its first run arms it; any later run is a change: told once, then disarmed.)
    let runs = 0;
    stop = createRoot((dispose) => {
      createEffect(
        () => (fn(), ++runs),
        (n) => {
          if (n === 1) return;
          dispose();
          const done = (onChange as () => unknown)();
          if (done !== undefined && typeof done !== "function") throw new Error("Reaction callback returned an invalid cleanup value. Return a cleanup function or undefined.");
        },
      );
      return dispose;
    });
  };
}

/** Hydration (a server's HTML adopted): Twist renders on the client only, for now. */
export const sharedConfig: { hydrating: boolean; context: unknown; completed?: WeakSet<Element> | null } = { hydrating: false, context: null };

/** A promise that never settles: what `fetch` and `Promise` give while a compute runs only for what it reads. */
class Stalled {
  then() {
    return new Stalled();
  }
  catch() {
    return new Stalled();
  }
  finally() {
    return new Stalled();
  }
  static withResolvers() {
    return { promise: new Stalled(), resolve() {}, reject() {} };
  }
}
for (const k of ["all", "allSettled", "any", "race", "reject", "resolve", "try"]) (Stalled as any)[k] = () => new Stalled();

/**
 * A compute run for what it reads, its answer set aside (the server's is used): no request goes out and nothing after
 * its first await runs, as `fetch` and `Promise` never settle meanwhile (as Solid does).
 */
/** A compute run only for what it reads (its answer the server's): what it writes is dropped. */
let tracing = false;
export const isTracing = () => tracing;

function traceOnly(fn: (prev: any) => any, prev: any): unknown {
  const g = globalThis as any;
  const fetchWas = g.fetch;
  const PromiseWas = g.Promise;
  const wasTracing = tracing;
  tracing = true;
  try {
    g.fetch = () => new Stalled();
    g.Promise = Stalled;
    const r = fn(prev);
    // An async generator runs to its first await too.
    if (r && typeof r.next === "function" && typeof r[Symbol.asyncIterator] === "function") {
      const it = r[Symbol.asyncIterator]();
      if (it === r) it.next().then?.(undefined, noop);
    }
    if (r && typeof r.then === "function") r.then(undefined, noop);
    return r;
  } catch (e) {
    // What it read before it threw is tracked; the answer is the server's either way — unless a read is not ready: the
    // trace waits for it.
    if (e instanceof NotReadyError) throw e;
  } finally {
    g.fetch = fetchWas;
    g.Promise = PromiseWas;
    tracing = wasTracing;
  }
}

/** The value the server sent for an async node (by its id, through the hydration's `has`/`load`), or NONE. */
function serverSent(n: { id?: string; kind: number }): unknown {
  const sc = sharedConfig as any;
  // (A transparent node takes its parent's id: nothing was sent for it.)
  if (n.id == null || (n as any).transparent || (n.kind !== MEMO && !(n as any).adopts) || (n as any).ownValue || !sc.has?.(n.id)) return NONE;
  const v = sc.load(n.id);
  // ("$$f": a boundary's mark that its content is the client's, not an answer.)
  return v !== "$$f" ? v : NONE;
}
/**
 * Run again while hydration still claims what the server drew (or a boundary above it waits on the server): a node
 * that took the server's answer keeps it — the page claimed is the server's — and runs live once hydration ends.
 */
function latchedSent(c: Computation<any>): unknown {
  const sc = sharedConfig as any;
  const held = () => {
    for (let o: any = c.parent; o; o = o.parent) if (o._hp) return true;
    return false;
  };
  if (sc.done || !((sharedConfig.hydrating && (!sc.isClaiming || sc.isClaiming())) || held())) return void ((c as any).latched = false), NONE;
  const sent = serverSent(c) as any;
  // (Only a value already there is kept: an answer still to come is the node's own flight.)
  if (sent === NONE || (sent && typeof sent === "object" && (typeof sent.then === "function" || typeof sent[Symbol.asyncIterator] === "function") && sent.s !== 1)) return NONE;
  if (!(c as any).diverged) {
    (c as any).diverged = true;
    const again = () => !c.disposed && (((c as any).latched = false), c.mark(DIRTY), schedule());
    sc.onHydrationEnd ? sc.onHydrationEnd(again) : queueMicrotask(again);
  }
  return sent;
}
export const isHydrating = () => sharedConfig.hydrating && (!(sharedConfig as any).isClaiming || (sharedConfig as any).isClaiming());
export { enableHydration } from "./hydration.ts";

/** Optimistic store work waiting for the next flush, with the transaction of the action that made it. */
const guessWork: [(tx: Transaction | null) => void, Transaction | null, (() => unknown) | undefined][] = [];

/** `install` run at the next flush with the transaction the optimistic write belongs to (null outside an action). */
export function queueGuess(install: (tx: Transaction | null) => void, source?: () => unknown) {
  guessWork.push([install, acting?.tx ?? null, source]);
  schedule();
}

/** `end` run when `tx` commits, or (outside an action) at the end of the flush. */
export function endWith(tx: Transaction | null, end: () => void) {
  if (tx && !tx.done) tx.ends.push(end);
  else ambientEnds.push(end), schedule();
}

/**
 * On a server, an async iterable answers with its first value. Rendering a response that stays open (a frame's: its
 * context commits), the values after it are taken too, each a commit the response sends on.
 */
function serverStreamOf<T>(c: Computation<T>, iterable: AsyncIterable<T>, tee?: Tee<T>): void {
  const ctx = sharedConfig.context as any;
  // (A render tried again: the source, or the slot, answered on an earlier pass — its first value, its client
  // reader sent then.)
  const answers = serverAnswers;
  const id = (c as any).id as string | undefined;
  const known = !tee ? (answered.get(iterable as object) ?? (answers && id != null ? answers.get(id) : undefined)) : undefined;
  if (known) return known[0] ? c.take(known[1] as T) : c.failNow(known[1]);
  // As Solid reads a source on a server: in a live server component, or declared live outside a pumping scope, the
  // first value and the source closed (the client connects for the rest); in a server component of a response that
  // stays open, every value, each a commit; else the first value here, every value to the client.
  const scoped = !!c.context?.[SERVER_COMPONENT_SCOPE];
  const liveScope = !!c.context?.[LIVE_SERVER_COMPONENT_SCOPE];
  const pumps = !!ctx?.commit && scoped && !liveScope;
  // (A derived store's generator keeps its own way: its values are reconciled into the store, not sent as a source.)
  const live = liveScope || pumps || !!(iterable as any)[LIVE_SOURCE] || !!(c as any).writes;
  // (A plain one: two readers of the source, c render's and the client's. Already split when a promise answered
  // with it: the client's reader went out then.)
  // (Split already, the client's reader gone out in an answer it was nested in: the same split.)
  tee ??= live ? undefined : sourceTees.get(iterable as object);
  const sent = !!tee;
  // (A plain source read once more: through the render's shared pump, with every other reader of it here.)
  const source = !tee ? shared(iterable) : iterable;
  const split = live ? null : (tee ?? teeSource(source));
  if (live && tee) void tee[1][Symbol.asyncIterator]().return?.();
  const it = (split ? split[0] : (tee?.[0] ?? source))[Symbol.asyncIterator]();
  // (A first step reading what is not ready: waited for, then failed not-ready — the render tries again with a fresh source.)
  const first = it.next().then(undefined, (e) => (e instanceof NotReadyError ? (settlesOf(e) ?? Promise.resolve()).then(() => Promise.reject(e)) : Promise.reject(e)));
  const close = () => void Promise.resolve(it.return?.()).catch(noop);
  c.closeStream = split ? () => (close(), split[2]()) : close;
  if (liveScope || ((iterable as any)[LIVE_SOURCE] && !pumps)) {
    first.then((r) => !r.done && close(), noop);
    return c.fly(first.then((r: IteratorResult<T>) => r.value));
  }
  if (pumps) {
    // The response stays open while the source can still yield (in a document, said after a while: it is live).
    const release = openPumpHold(ctx, c, () => !c.disposed);
    c.closeStream = () => (release(), close());
    const pump = () =>
      it.next().then(
        (r) => {
          if (c.disposed) return;
          if (r.done) return release();
          landings.push([c, r.value]);
          landNow();
          ctx.commit();
          pump();
        },
        (e) => !c.disposed && (c.fail(e), ctx.commit(), release()),
      );
    first.then((r) => (r.done || c.disposed ? release() : pump()), release);
    return c.fly(first.then((r: IteratorResult<T>) => r.value));
  }
  // (A streaming derived store: its later values landed too, each a patch batch to the client, until it ends.)
  if ((c as any).answerStream) {
    const pump = () =>
      it.next().then(
        (r) => {
          if (c.disposed || r.done) return void (c as any).answerEnd?.();
          landings.push([c, r.value]);
          landNow();
          pump();
        },
        () => (c as any).answerEnd?.(),
      );
    first.then((r) => (r.done ? (c as any).answerEnd?.() : pump()), () => (c as any).answerEnd?.());
  }
  // (Not split: read as before, its first value the answer.)
  if (!split) return c.fly(first.then((r: IteratorResult<T>) => r.value));
  // The client gets every value (its reader is the hydration record); c render, the first.
  if (!sent) serverFly?.(c, split[1]);
  first.then(close, noop);
  first.then((r) => void answered.set(iterable as object, [true, r.value]), (e) => void answered.set(iterable as object, [false, e]));
  return c.fly(first.then((r: IteratorResult<T>) => r.value), true);
}

/** On a server, before a flight: an answer an earlier pass got is taken (true: nothing flies); what the client is sent
 * for this one goes out. */
function serverPreFly(c: Computation<any>, p: PromiseLike<any>, streamed: boolean): boolean {
  const answers = serverAnswers;
  const id = (c as any).id as string | undefined;
  const known = serverRender && !streamed ? answered.get(p as object) ?? (answers && id != null ? answers.get(id) : undefined) : undefined;
  if (known) {
    if (serverFly) {
      // (A failure sent as a rejected promise, handled here so nothing reports it as unhandled.)
      const failed = known[0] ? null : Promise.reject(known[1]);
      failed?.catch(noop);
      serverFly(c, failed ?? known[1]);
    }
    // (A source answered on an earlier pass: read as the stream it is, its client reader sent then.)
    const tee = !streamed && known[0] && known[1] && typeof known[1] === "object" ? sourceTees.get(known[1] as object) : undefined;
    if (tee) return serverStreamOf(c, known[1] as any, tee), true;
    return known[0] ? c.take(known[1] as any) : c.failNow(known[1]), true;
  }
  // (On a server, an answer that is an async source streams: split now, the client's reader sent in its place.)
  // (A derived store's answer is reconciled into it: sent as the store's state once it lands.)
  if (serverRender && !streamed && (c as any).writes) {
    // (Streaming: its snapshot, then a patch batch per change, as a source the response stays open for.)
    const trail = (c as any).answerStream as AsyncIterable<unknown> | undefined;
    const answerOf = (c as any).answerOf as ((v: unknown) => unknown) | undefined;
    const answer = trail ?? (answerOf ? Promise.resolve(p).then(answerOf) : p);
    if (answerOf && !trail) (answer as Promise<unknown>).catch(noop);
    serverFly?.(c, answer);
  }
  else if (serverRender && !streamed) {
    const answer = sourceAnswer(Promise.resolve(p).then((v: any) => clientCopy(v)));
    // (Its failure is the flight's, handled there: c copy is only what the client is sent.)
    answer.catch(noop);
    serverFly?.(c, answer);
  }
  return false;
}
/** On a server, when a flight settles: its answer kept for a retried render (by promise, and by the node's id). */
function serverSettles(c: Computation<any>, p: PromiseLike<any>): Promise<void> {
  const answers = serverAnswers;
  const id = (c as any).id as string | undefined;
  return Promise.resolve(p).then(
    // (A derived store's slot remembers its state, not the step's value: a re-created one adopts that.)
    (v) => void (answered.set(p as object, [true, v]), answers && id != null && answers.set(id, [true, (c as any).writes && (c as any).answerOf ? (c as any).answerOf(v) : v])),
    (e) => void (answered.set(p as object, [false, e]), answers && id != null && answers.set(id, [false, e])),
  );
}

/** The server's part of a computation's async work (installed by the server entry: a client bundle never carries it). */
let serverHooks: { preFly: typeof serverPreFly; stream: typeof serverStreamOf; settles: typeof serverSettles } | null = null;
export function installServerStreams() {
  serverHooks = { preFly: serverPreFly, stream: serverStreamOf, settles: serverSettles };
}

/** Hydrating: what the server sent for `c` (NONE: nothing — it computes). */
function hydrationSent(c: Computation<any>): unknown {
  // Hydrating: what the server sent under the node's id is its first answer. Its compute still runs, for what it
  // reads (so it runs again when that changes); what it answers now is set aside.
  // (An adoption whose trace waited: the answer kept from the first run, taken now.)
  const kept = (c as any).keptSent;
  if (kept !== undefined) (c as any).keptSent = undefined;
  // (Never answered yet, hydration still going: what the server sent may have arrived since its first run.)
  const sent = kept !== undefined ? kept : c.ranAt === -1 ? (sharedConfig.hydrating ? serverSent(c) : NONE) : (c as any).latched ? latchedSent(c) : !c.ready && (sharedConfig as any).isHydrationInProgress?.() ? serverSent(c) : NONE;
  if (sent !== NONE && c.ranAt !== -1 && !c.ready) (c as any).latched = true;
  return sent;
}
/** The server's answer `sent` taken by `c` as its first, its compute traced for what it reads. */
function hydrationAdopt(c: Computation<any>, sent: unknown): any {
  let next: any;
  const ref = sent as any;
  // (A stream the client goes on with runs here itself; anything else — "hybrid" of another shape is "server" —
  // is traced for what it reads.)
  let traced: unknown;
  try {
    traced = traceOnly(c.fn, c.current());
  } catch (e) {
    // (What it reads is not ready: it waits, and takes the server's answer when it runs again.)
    (c as any).keptSent = sent;
    throw e;
  }
  // ("hybrid" whose source is a stream: the client goes on with it once the server's answer is in.)
  const handsOff = (c as any).ssrSource === "hybrid" && !!traced && typeof (traced as any)[Symbol.asyncIterator] === "function" && typeof (traced as any).then !== "function";
  if (c.ranAt === -1 && !handsOff) (c as any).latched = true;
  // A live source: the server's answer now; once hydration ends, the source itself, from that answer on.
  if (traced && typeof traced === "object" && (traced as any)[LIVE_SOURCE]) {
    const takeOver = () => !c.disposed && (((c as any).liveTakeover = true), c.mark(DIRTY), schedule());
    const onEnd = (sharedConfig as any).onHydrationEnd;
    onEnd ? onEnd(takeOver) : queueMicrotask(takeOver);
  }
  if (ref && typeof ref === "object" && ref.s === 2) {
    if (typeof ref.then === "function") ref.then(undefined, noop);
    throw ref.v;
  }
  // (A loading window's streamed answer: the server drew the loading value, so the claim does too; the answer
  // lands after, as a promise.)
  next = ref && typeof ref === "object" && ref.s === 1 && !(c.loadingWindow && typeof ref.then === "function") ? ref.v : ref;
  // (The server's stream: its first value is what the server drew; what it buffered after comes later.)
  if (next && typeof (next as any)[Symbol.asyncIterator] === "function" && typeof (next as any).then !== "function") (c as any).sentStream = true;
  // (A derived store's stream: its snapshot, then patch batches — each made a whole state again.)
  if ((c as any).writes && patchApply && next && ((next as any).__SEROVAL_STREAM__ === true || (typeof (next as any)[Symbol.asyncIterator] === "function" && typeof (next as any).then !== "function"))) next = statesOf(next as any, patchApply) as any;
  // A stream the client goes on with ("hybrid"): once the server's answer has landed, its compute runs here,
  // quietly (its first yield repeats that answer).
  // (When the pass that claims it ends: its snapshot scope released.)
  if (handsOff) {
    // (Not when it went live already: a change it read ran the client source first.)
    const takeOver = () => !c.disposed && !(c as any).live && (((c as any).handoff = true), (c.quiet = true), c.mark(DIRTY), schedule());
    // (An answer landing later — still to come, or deferred by a loading window: the handoff follows its landing.)
    if (ref && typeof ref.then === "function" && (ref.s !== 1 || c.loadingWindow)) ref.then(() => queueMicrotask(takeOver), noop);
    // (A streamed answer: once the server's stream has landed whole.)
    else if ((c as any).sentStream) (c as any).afterStream = takeOver;
    else if (c.inSnapshot && snapshotCapture) (c as any).onRelease = takeOver;
    else queueMicrotask(takeOver);
  }
  return next;
}
/** A hydrating computation's part (installed by hydrate(): a client that only renders never carries it). */
let hydrationRuns: { sent: typeof hydrationSent; adopt: typeof hydrationAdopt; dropFirst: (it: AsyncIterable<any>, quiet: unknown) => AsyncIterable<any> } | null = null;
export function installHydrationRuns() {
  hydrationRuns ??= { sent: hydrationSent, adopt: hydrationAdopt, dropFirst: (it, quiet) => firstYieldDropped(it, undefined, quiet) };
}
