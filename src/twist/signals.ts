// Twist's reactive core: signals, memos, split effects, owners, async. Written from Solid 2's public design (its RFCs,
// its async spec's statements, its tests), not its code.
//
// Writes are queued: reads return the committed value until a flush. A flush stages the writes, re-runs what depends
// on them in dependency order (height, then creation) against the staged world, then commits. When something a write
// leads to is still loading (an async memo in flight), the write and everything downstream of it are held in a
// transaction instead: what is on screen keeps the committed values, and the transaction commits as one when its last
// flight lands. Writes on graphs no flight touches commit at once.

// ---------------------------------------------------------------- owners

export interface Owner {
  parent: Owner | null;
  owned: Owner[] | null;
  cleanups: (() => void)[] | null;
  context: Record<symbol, unknown> | null;
  disposed: boolean;
}

let owner: Owner | null = null;
let listener: Computation<any> | null = null;
/** Running a computation (or a latest() read): reads see the staged world. */
let inPass = 0;

class Root implements Owner {
  owned: Owner[] | null = null;
  cleanups: (() => void)[] | null = null;
  context: Record<symbol, unknown> | null;
  disposed = false;
  constructor(public parent: Owner | null) {
    this.context = parent?.context ?? null;
    if (parent) (parent.owned ??= []).push(this);
  }
}

/** What `o` owns disposed: its children first (last made first), then its cleanups (last registered first). */
function disposeOwned(o: Owner) {
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
  disposeOwned(o);
  if (o instanceof Computation) o.end();
}

export function getOwner(): Owner | null {
  return owner;
}

/** Whether `o` has been disposed. */
export const isDisposed = (o: Owner) => o.disposed;

/** A new owner under the current one (or under `parent`), for code that builds outside a computation. */
export function createOwner(parent: Owner | null = owner): Owner {
  return new Root(parent);
}

export function runWithOwner<T>(o: Owner | null, fn: () => T): T {
  const prevOwner = owner;
  const prevListener = listener;
  owner = o;
  listener = null;
  try {
    return fn();
  } finally {
    owner = prevOwner;
    listener = prevListener;
  }
}

export function onCleanup<T extends () => void>(fn: T): T {
  if (owner) (owner.cleanups ??= []).push(fn);
  return fn;
}

/** A scope of its own, owned by the current one: disposed with it, or by the function `fn` is given. */
export function createRoot<T>(fn: (dispose: () => void) => T, _options?: { id?: string }): T {
  const root = new Root(owner);
  return runWithOwner(root, () =>
    fn(() => {
      dispose(root);
      if (root.parent?.owned) remove(root.parent.owned, root);
    }),
  );
}

function remove<T>(list: T[], item: T) {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

export function untrack<T>(fn: () => T): T {
  if (!listener) return fn();
  const prev = listener;
  listener = null;
  try {
    return fn();
  } finally {
    listener = prev;
  }
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

export type SignalOptions<T> = { equals?: Equals<T>; unobserved?: () => void; ownedWrite?: boolean; name?: string; lazy?: boolean };

/** Thrown by a read of a value that has never been ready (an async memo's first load): Loading catches it. */
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
  merged: Transaction | null = null;
  get root(): Transaction {
    let t: Transaction = this;
    while (t.merged) t = t.merged;
    return t;
  }
}
const transactions = new Set<Transaction>();

/** What signals and computations share: a committed value, a staged one, and who reads them. */
abstract class Node<T = any> {
  value!: T;
  staged: T | typeof NONE = NONE;
  tx: Transaction | null = null;
  observers: Computation<any>[] = [];
  height = 0;
  /** Counts its changes: a reader compares it with the count it saw. */
  version = 0;
  unobserved?: () => void;
  /** An optimistic value shown over the truth until its transaction commits (or its flush ends). */
  override: T | typeof NONE = NONE;
  /** The value in the world being read: an optimistic override, else staged while a pass runs, else committed. */
  current(): T {
    if (this.override !== NONE) return this.override as T;
    return inPass && this.staged !== NONE ? (this.staged as T) : this.value;
  }
  /** A new value staged: committed at the flush's end, or held by a transaction. */
  stage(next: T) {
    this.staged = next;
    this.version++;
    clock++;
    if (!this.tx) staged.push(this);
    for (const o of this.observers) o.mark(DIRTY);
  }
  /** The staged value made the committed one. */
  promote() {
    if (this.staged !== NONE) this.value = this.staged as T;
    this.staged = NONE;
    this.tx = null;
    (this as any).writtenIn = null;
  }
  subscribe(o: Computation<any>) {
    this.observers.push(o);
  }
  unsubscribe(o: Computation<any>) {
    remove(this.observers, o);
    if (!this.observers.length) this.unobserved?.();
  }
  /** Changed in place (a store key): its readers told. */
  bump() {
    this.version++;
    clock++;
    for (const o of this.observers) o.mark(DIRTY);
  }
}

export class Signal<T> extends Node<T> {
  /** A write waiting for the next flush. */
  pending: T | typeof NONE = NONE;
  equals: Equals<T>;
  ownedWrite: boolean;
  constructor(value: T, options?: SignalOptions<T>) {
    super();
    this.value = value;
    this.equals = options?.equals ?? Object.is;
    this.unobserved = options?.unobserved;
    this.ownedWrite = !!options?.ownedWrite;
  }
  read(): T {
    if (listener) listener.track(this);
    return this.current();
  }
  write(next: T) {
    guardWrite(this.ownedWrite);
    if (this.pending === NONE) writes.push(this);
    this.pending = next;
    if (acting) this.writtenIn = acting.tx;
    schedule();
  }
  /** The action whose transaction this write belongs to (held with it until the action ends). */
  writtenIn: Transaction | null = null;
  /** The pending write dropped (a subclass commits it its own way). */
  settle() {
    this.pending = NONE;
  }
  /** The pending write staged, if it changes the value. */
  commit() {
    const next = this.pending as T;
    this.pending = NONE;
    const now = this.staged !== NONE ? (this.staged as T) : this.value;
    if (this.equals !== false && this.equals(now, next)) return;
    this.stage(next);
  }
}

/** Whether something tracks what is read now. */
export const isTracking = () => listener !== null;
/** A store setter's write: the same guard as a signal's. */
export const guardStoreWrite = () => guardWrite(false);

/** What refresh() re-runs for a target that is not a memo's accessor (a derived store's proxy, say). */
const refreshables = new WeakMap<object, () => () => unknown>();
export const refreshTarget = (target: object, memo: () => () => unknown) => void refreshables.set(target, memo);

/** Writes in a reactive scope (a component body, a memo, a root being built) throw: they would re-run what read. */
function guardWrite(allowed: boolean) {
  if (allowed || !owner) return;
  throw new Error(
    "[REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope is not allowed. Write in an event handler, an effect's apply half, or untracked code; or create the signal with { ownedWrite: true }.",
  );
}

// ---------------------------------------------------------------- computations

const MEMO = 0;
const EFFECT = 1;
const RENDER = 2;

type Source = Node<any>;
const accessors = new WeakMap<Function, Computation<any>>();

export class Computation<T> extends Node<T> implements Owner {
  parent: Owner | null;
  owned: Owner[] | null = null;
  cleanups: (() => void)[] | null = null;
  context: Record<symbol, unknown> | null;
  disposed = false;
  id = ids++;
  kind: number;
  fn: (prev?: T) => T;
  state = DIRTY;
  sources: Source[] = [];
  /** The version of each source when it was read. */
  seen: number[] = [];
  /** Sources read only through isPending/latest: what is shown ahead of a hold (they do not hold this). */
  verdict: Set<Source> | null = null;
  attached = false;
  ranAt = -1;
  equals: Equals<T>;
  lazy: boolean;
  /** Has had a value (an async compute's first load has not). */
  ready = false;
  /** The flight in progress (its promise), and whether it is a quiet re-ask (refresh). */
  flight: object | null = null;
  quiet = false;
  /** Why its last run failed (an error read rethrows it). */
  error: unknown = NONE;
  /** An effect's apply half, what it last applied, and the cleanup it gave back. */
  apply?: (value: T, prev?: T) => void | (() => void);
  applied: T | typeof NONE = NONE;
  cleanup?: () => void;
  onError?: (err: unknown, cleanup: () => void) => void;
  /** An effect whose compute gave a new value: its apply is due. */
  due = false;
  constructor(kind: number, fn: (prev?: T) => T, options?: SignalOptions<T>) {
    super();
    this.kind = kind;
    this.fn = fn;
    this.parent = owner;
    this.context = owner?.context ?? null;
    if (owner) (owner.owned ??= []).push(this);
    this.equals = options?.equals ?? Object.is;
    this.lazy = !!options?.lazy;
    this.unobserved = options?.unobserved;
  }
  /**
   * Autodisposed: a memo nothing owns, or a lazy one that lost its last reader. Read with nothing subscribed, it is
   * worked out again from scratch once anything has changed since it ran.
   */
  get autodispose() {
    return this.kind === MEMO && (this.lazy || !this.parent) && !this.observers.length;
  }
  track(source: Source) {
    if (verdictReading) (this.verdict ??= new Set()).add(source);
    if (this.sources.includes(source)) return;
    this.sources.push(source);
    this.seen.push(source.version);
    if (source.height >= this.height) this.height = source.height + 1;
    if (this.attached) source.subscribe(this);
  }
  override subscribe(o: Computation<any>) {
    this.observers.push(o);
    if (!this.attached) this.attach();
  }
  override unsubscribe(o: Computation<any>) {
    remove(this.observers, o);
    if (this.observers.length) return;
    this.unobserved?.();
    // A lazy memo with no reader left is torn down (an unowned one stays subscribed: it is eager).
    if (this.lazy) this.detach(), (this.state = DIRTY);
  }
  attach() {
    this.attached = true;
    if (this.ranAt !== clock && this.state === CLEAN) this.state = CHECK;
    for (const s of this.sources) s.subscribe(this);
  }
  detach() {
    this.attached = false;
    for (const s of this.sources) s.unsubscribe(this);
  }
  /** Disposed: its subscriptions, its flight and its effect's cleanup let go. */
  end() {
    if (this.attached) this.detach();
    this.sources = [];
    this.seen = [];
    this.attached = false;
    this.flight = null;
    flights.delete(this);
    const c = this.cleanup;
    this.cleanup = undefined;
    c?.();
  }
  /** Something it read changed (DIRTY), or may have through a memo (CHECK): queued, and its readers told. */
  mark(state: number) {
    if (this.state >= state || this.disposed) return;
    const was = this.state;
    this.state = state;
    if (was !== CLEAN) return;
    if (!(this.lazy && !this.observers.length)) queue(this);
    for (const o of this.observers) o.mark(CHECK);
  }
  read(): T {
    if (!this.disposed) {
      if (!listener && this.autodispose && this.ranAt !== clock) this.state = DIRTY;
      this.update();
    }
    if (listener) listener.track(this);
    if (this.error !== NONE) throw this.error;
    // Never had a value (a first load, or waiting on one): not ready.
    if (!this.ready && !(inPass && this.staged !== NONE) && this.override === NONE) throw new NotReadyError(this);
    return this.current();
  }
  /** Brought up to date: run again if something it read changed (memos it read brought up to date first). */
  update() {
    if (this.state === CHECK) {
      for (let i = 0; i < this.sources.length; i++) {
        const s = this.sources[i]!;
        if (s instanceof Computation) s.update();
        if (s.version !== this.seen[i]) {
          this.state = DIRTY;
          break;
        }
      }
      if (this.state === CHECK) (this.state = CLEAN), (this.ranAt = clock);
    }
    if (this.state === DIRTY) this.run();
  }
  run() {
    disposeOwned(this);
    if (this.attached) for (const s of this.sources) s.unsubscribe(this);
    this.sources = [];
    this.seen = [];
    this.verdict = null;
    this.attached = true;
    const prevOwner = owner;
    const prevListener = listener;
    owner = this;
    listener = this;
    inPass++;
    let next: T;
    let threw: unknown = NONE;
    try {
      next = this.fn(this.current());
    } catch (e) {
      threw = e;
    } finally {
      owner = prevOwner;
      listener = prevListener;
      inPass--;
    }
    this.state = CLEAN;
    this.ranAt = clock;
    if (threw !== NONE) {
      // Waiting on a first load upstream: still not ready (its readers wait too); the Loading above shows its fallback.
      if (threw instanceof NotReadyError) {
        this.error = NONE;
        if (this.kind !== MEMO || !this.ready) boundaryOf(this)?.wait(this);
        return;
      }
      this.error = threw;
      this.version++;
      if (this.kind !== MEMO) handleError(this, threw);
      return;
    }
    this.error = NONE;
    boundaryOf(this)?.ready(this);
    // An async answer: in flight, its old value kept meanwhile.
    if (next! && typeof (next as any).then === "function") return this.fly(next as any);
    if (next! && typeof (next as any)[Symbol.asyncIterator] === "function") return this.stream(next as any);
    this.flight = null;
    flights.delete(this);
    this.take(next!);
    // (After its own staging ticked the clock: it is current.)
    this.ranAt = clock;
  }
  /** A value it computed or that landed: staged (or committed outside a flush), its readers told if it changed. */
  take(next: T) {
    const first = !this.ready;
    this.ready = true;
    const now = this.staged !== NONE ? (this.staged as T) : this.value;
    const changed = first || this.equals === false || !this.equals(now, next);
    if (this.kind !== MEMO) {
      if (changed || this.applied === NONE) {
        if (flushing || this.tx) this.staged = next;
        else this.value = next;
        if (flushing && !this.tx) staged.push(this);
        if (!this.due) (this.due = true), applies[this.kind as 1 | 2].push(this);
      }
      return;
    }
    if (!changed) return;
    if (flushing || this.tx) this.stage(next);
    else (this.value = next), this.version++, clock++;
  }
  fly(p: PromiseLike<T>) {
    const flight = {};
    this.flight = flight;
    flights.add(this);
    statusChanged();
    p.then(
      (v) => this.flight === flight && this.land(v),
      (e) => this.flight === flight && this.fail(e),
    );
  }
  async stream(it: AsyncIterable<T>) {
    const flight = {};
    this.flight = flight;
    flights.add(this);
    statusChanged();
    try {
      for await (const v of it) {
        if (this.flight !== flight) return;
        landings.push([this, v]);
        schedule();
      }
    } catch (e) {
      if (this.flight === flight) this.fail(e);
      return;
    }
    if (this.flight === flight) (this.flight = null), flights.delete(this), statusChanged();
  }
  land(v: T) {
    this.flight = null;
    flights.delete(this);
    landings.push([this, v]);
    statusChanged();
    schedule();
  }
  fail(e: unknown) {
    this.flight = null;
    flights.delete(this);
    this.error = e;
    this.version++;
    clock++;
    for (const o of this.observers) o.mark(DIRTY);
    statusChanged();
    schedule();
  }
  /** An effect's apply half, untracked and unowned, after its last cleanup. */
  runApply() {
    if (!this.due || this.disposed) return;
    this.due = false;
    this.promote();
    const prev = this.applied === NONE ? undefined : this.applied;
    this.applied = this.value as T;
    const c = this.cleanup;
    this.cleanup = undefined;
    c?.();
    const done = runWithOwner(null, () => this.apply!(this.value as T, prev));
    if (done !== undefined && typeof done !== "function") throw new Error("effect callback returned an invalid cleanup value. Return a cleanup function or undefined.");
    this.cleanup = done as (() => void) | undefined;
  }
}

/** An effect's compute threw: its error handler, the nearest boundary's, or the flush throws it. */
function handleError(c: Computation<any>, e: unknown) {
  if (c.onError) {
    const handler = c.onError;
    return void (pendingErrors.push(() => handler(e, () => c.cleanup?.())));
  }
  for (let o: Owner | null = c.parent; o; o = o.parent) {
    const catcher = (o as any).catch as ((e: unknown) => boolean) | undefined;
    if (catcher && catcher(e)) return;
  }
  uncaught.push(e);
}

// ---------------------------------------------------------------- scheduling

/** Signals written since the last flush, in order. */
const writes: Signal<any>[] = [];
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

function schedule() {
  if (scheduled || flushing || halted) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (!halted && !flushing) flush();
  });
}

/** An uncaught error stopped the scheduler (flush threw it): let it run again. */
export function resetErrorHalt() {
  halted = false;
}

const byOrder = (a: Computation<any>, b: Computation<any>) => a.height - b.height || a.id - b.id;

/** What isPending()/latest() readers follow: told whenever a hold or a flight starts or ends. */
const status = new (class extends Node<number> {})();
status.value = 0;
function statusChanged() {
  status.bump();
}

/** Whether `n`, or something it was derived from, is in flight (and has a value to show meanwhile) or held. */
function waiting(n: Node, seen = new Set<Node>()): boolean {
  if (seen.has(n)) return false;
  seen.add(n);
  if (n.tx && n.staged !== NONE) return true;
  if ((n as any).affected) return true;
  if (n instanceof Computation) {
    if (n.flight && n.ready && !n.quiet) return true;
    for (const s of n.sources) if (waiting(s, seen)) return true;
  }
  return false;
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

/** This round's staged nodes committed, or held where they lead to a flight that something renders. */
function settleRound() {
  const now = staged;
  staged = [];
  let tx: Transaction | null = null;
  const held = new Set<Node>();
  for (const n of now) {
    if (n.tx || held.has(n)) continue;
    const below = downstream(n);
    let holds = false;
    let joins: Transaction | null = null;
    for (const c of below) {
      if (c.tx) joins = c.tx.root;
      if (c.flight && c.ready && (c.kind !== MEMO || rendered(c))) holds = true;
    }
    // Reading a node a transaction holds joins it; an action's write is its transaction's.
    if (n instanceof Computation) for (const s of n.sources) if (s.tx && !n.verdict?.has(s)) joins = s.tx.root;
    const by = (n as any).writtenIn as Transaction | null;
    if (by && !by.done) joins = by.root;
    if (!holds && !joins) continue;
    const t: Transaction = joins ?? (tx ??= newTransaction());
    hold(n, t);
    held.add(n);
    for (const c of below) {
      if (c.staged !== NONE || c.due) hold(c, t);
      if (c.flight) t.flights.add(c);
    }
  }
  for (const n of now) if (!n.tx) n.promote();
  if (held.size) statusChanged();
}

/** Whether a computation's value reaches the screen: an effect reads it, directly or through memos. */
function rendered(c: Computation<any>, seen = new Set<Computation<any>>()): boolean {
  if (seen.has(c)) return false;
  seen.add(c);
  for (const o of c.observers) if (o.kind !== MEMO || rendered(o, seen)) return true;
  return false;
}

function newTransaction() {
  const t = new Transaction();
  transactions.add(t);
  return t;
}

function hold(n: Node, t: Transaction) {
  if (n.tx === t) return;
  n.tx = t;
  t.nodes.add(n);
  if (n instanceof Computation && n.due) {
    t.effects.add(n);
    remove(applies[n.kind as 1 | 2], n);
  }
}

/** Transactions whose flights have all landed (and whose actions ended): committed, their effects applied. */
function commitTransactions() {
  for (const t of [...transactions]) {
    if (t.merged) {
      transactions.delete(t);
      continue;
    }
    for (const f of t.flights) if (!f.flight || f.disposed) t.flights.delete(f);
    // A flight in progress at any node it holds keeps it.
    for (const n of t.nodes) if (n instanceof Computation && n.flight) t.flights.add(n);
    if (t.flights.size || t.open) continue;
    transactions.delete(t);
    t.done = true;
    for (const n of t.nodes) n.promote();
    for (const end of t.ends.splice(0)) end();
    for (const e of t.effects) if (e.due) applies[e.kind as 1 | 2].push(e);
    statusChanged();
  }
}

/** Writes committed and everything brought up to date, until nothing is left to do. */
function drain() {
  for (let rounds = 0; writes.length || landings.length || guesses.length || ambient.length || ambientEnds.length || dirty.length || applies[RENDER].length || applies[EFFECT].length || status.observers.length && statusDirty(); rounds++) {
    if (rounds > 1e5) throw new Error("Potential infinite loop detected.");
    if (writes.length) for (const s of writes.splice(0)) s.commit();
    if (landings.length) for (const [c, v] of landings.splice(0)) if (!c.disposed) c.take(v);
    if (guesses.length) installGuesses();
    while (dirty.length) {
      const now = dirty.sort(byOrder);
      dirty = [];
      for (const c of now) if (!c.disposed) c.update();
    }
    settleRound();
    commitTransactions();
    if (uncaught.length) throw uncaught.splice(0)[0];
    if (pendingErrors.length) for (const f of pendingErrors.splice(0)) f();
    if (applies[RENDER].length) for (const e of applies[RENDER].splice(0).sort(byOrder)) e.runApply();
    if (applies[EFFECT].length && !writes.length && !dirty.length) for (const e of applies[EFFECT].splice(0).sort(byOrder)) e.runApply();
    // Optimistic values written outside an action: shown for this flush, then the truth again.
    if ((ambient.length || ambientEnds.length) && !writes.length && !dirty.length && !applies[RENDER].length && !applies[EFFECT].length) {
      for (const n of ambient.splice(0)) n.override !== NONE && ((n.override = NONE), n.bump());
      for (const end of ambientEnds.splice(0)) end();
    }
  }
}
const statusDirty = () => false;

/**
 * The queued writes applied and everything brought up to date now. Given a function, it runs first, and its writes
 * are drained before flush returns (at each level, when nested). Called while flushing, it drains what is queued.
 */
export function flush<T>(fn?: () => T): T {
  let result!: T;
  flushing++;
  try {
    if (fn) result = fn();
    drain();
  } catch (e) {
    halted = true;
    writes.splice(0);
    dirty = [];
    staged = [];
    applies[RENDER].splice(0);
    applies[EFFECT].splice(0);
    throw e;
  } finally {
    flushing--;
  }
  return result;
}

// ---------------------------------------------------------------- the API

type Accessor<T> = () => T;
type Setter<T> = (next: T | ((prev: T) => T)) => T;
export type SourceAccessor<T> = Accessor<T>;

export function createSignal<T>(value: T | ((prev?: T) => T), options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  if (typeof value === "function") return writableMemo(value as (prev?: T) => T, options);
  const s = new Signal(value as T, options);
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
  const written = new Signal<{ v: T } | null>(null, { ownedWrite: options?.ownedWrite, equals: false });
  let seen: { v: T } | null = null;
  const m = new Computation<T>(
    MEMO,
    (prev) => {
      const w = written.read();
      if (w !== seen) {
        seen = w;
        if (w) return w.v;
      }
      return fn(prev);
    },
    options,
  );
  if (!m.lazy) m.run();
  const set: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(m.current() as T) : next;
    written.write({ v });
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

type EffectBundle<T> = { effect: (value: T, prev?: T) => void | (() => void); error?: (err: unknown, cleanup: () => void) => void };

function effectOf<T>(kind: 1 | 2, compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  const e = new Computation<T>(kind, compute, options);
  if (typeof apply === "function") e.apply = apply;
  else if (apply) (e.apply = apply.effect), (e.onError = apply.error);
  else e.apply = () => {};
  e.run();
  // A render effect applies its first value as it is made (the DOM is built with it); others at the flush.
  if (kind === RENDER && e.due && !e.tx && e.error === NONE) {
    remove(applies[RENDER], e);
    e.runApply();
  }
  schedule();
}

export function createEffect<T>(compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
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
  const probe = new Computation<unknown>(MEMO, () => undefined);
  probe.attached = false;
  const outer = listener;
  if (outer) outer.track(status);
  verdictReading++;
  listener = probe;
  try {
    fn();
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
  return reads.some((s) => waiting(s));
}

/** `fn` read in the newest world: what is staged in a hold or in flight, ahead of what is shown. */
export function latest<T>(fn: () => T): T {
  verdictReading++;
  inPass++;
  try {
    return fn();
  } finally {
    inPass--;
    verdictReading--;
  }
}

/** Run a derived value again (an async one re-asks quietly: isPending stays false). */
export function refresh<T>(target: (() => T) | object): Promise<T> {
  const c = (typeof target === "function" ? accessors.get(target) : undefined) ?? (typeof target === "object" && target ? accessors.get(refreshables.get(target)?.() as any) : undefined);
  if (typeof target !== "function" && !c) throw new Error("refresh() expects a refreshable source (a memo, a derived signal or store)");
  if (!c || !(c instanceof Computation)) return Promise.resolve(typeof target === "function" ? untrack(target as () => T) : (target as T));
  c.quiet = true;
  c.mark(DIRTY);
  return resolve(() => (typeof target === "function" ? (target as () => T)() : (target as T)));
}

/** A promise for `fn`'s first settled value (not in flight, not held). */
export function resolve<T>(fn: () => T): Promise<T> {
  if (listener) throw new Error("resolve() cannot be called inside a reactive scope");
  return new Promise<T>((ok, fail) => {
    createRoot((dispose) => {
      createEffect(
        () => {
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

export function createContext<T>(defaultValue?: T, _options?: { name?: string }): Context<T> {
  const id = Symbol("context");
  const Provider = ((props: { value: T; children?: any }) => {
    const o = new Root(owner);
    o.context = { ...o.context, [id]: props.value };
    return runWithOwner(o, () => children(() => props.children));
  }) as Context<T>;
  Provider.id = id;
  Provider.defaultValue = defaultValue;
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
  if (context.defaultValue === undefined) throw new ContextNotFoundError();
  return context.defaultValue;
}

export function getContext<T>(context: Context<T>, o: Owner | null = owner): T | undefined {
  const ctx = o?.context;
  return ctx && context.id in ctx ? (ctx[context.id] as T) : context.defaultValue;
}

export function setContext<T>(context: Context<T>, value: T, o: Owner | null = owner) {
  if (!o) throw new NoOwnerError();
  o.context = { ...o.context, [context.id]: value };
}

export class NoOwnerError extends Error {
  constructor() {
    super("No owner: this needs to run inside a reactive scope.");
  }
}

/** Children resolved: accessors called, arrays flattened. */
export function children<T>(fn: () => T): Accessor<any> {
  return createMemo(() => resolveChildren(fn()));
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
  return (...args: A) =>
    new Promise<R>((ok, fail) => {
      const tx = newTransaction();
      tx.open++;
      const me = { tx };
      const it = gen(...args);
      const end = (f: () => void) => {
        tx.open--;
        f();
        schedule();
      };
      const step = (method: "next" | "throw", input?: unknown) => {
        let r: IteratorResult<any, R> | Promise<IteratorResult<any, R>>;
        const was = acting;
        acting = me;
        try {
          r = (it as any)[method](input);
        } catch (e) {
          acting = was;
          return end(() => fail(e));
        }
        acting = was;
        if (r && typeof (r as any).then === "function" && !("done" in (r as any))) {
          return void (r as Promise<IteratorResult<any, R>>).then(after, (e) => end(() => fail(e)));
        }
        after(r as IteratorResult<any, R>);
      };
      const after = (r: IteratorResult<any, R>) => {
        if (r.done) return end(() => ok(r.value));
        const v = r.value;
        if (v && typeof v.then === "function") v.then((x: unknown) => step("next", x), (e: unknown) => step("throw", e));
        else step("next", v);
      };
      step("next");
    });
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
  return new Promise((ok, fail) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = createRoot((dispose) => {
      createEffect(
        () => {
          try {
            return { v: fn(), ok: true };
          } catch (e) {
            if (e instanceof NotReadyError) return { v: undefined, ok: false };
            throw e;
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
class LoadingState {
  waiting = new Set<Computation<any>>();
  count = new (class extends Node<number> {})();
  wait(c: Computation<any>) {
    if (this.waiting.has(c)) return;
    this.waiting.add(c);
    this.count.bump();
  }
  ready(c: Computation<any>) {
    if (this.waiting.delete(c)) this.count.bump();
  }
}

function boundaryOf(c: Computation<any>): LoadingState | null {
  for (let o: Owner | null = c.parent; o; o = o.parent) {
    const b = (o as any).loading as LoadingState | undefined;
    if (b) return b;
  }
  return null;
}

/** `fn`'s value, or `fallback()` while what is under it waits on a first load. */
export function createLoadingBoundary<T, F>(fn: () => T, fallback: () => F, _options?: { on?: () => unknown }): () => T | F {
  const state = new LoadingState();
  state.count.value = 0;
  const m = new Computation<T | F>(MEMO, () => {
    (m as any).loading = state;
    listener!.track(state.count);
    let v: T;
    try {
      v = fn();
    } catch (e) {
      if (e instanceof NotReadyError) return untrack(fallback);
      throw e;
    }
    for (const c of state.waiting) if (c.disposed) state.waiting.delete(c);
    return state.waiting.size ? untrack(fallback) : resolveChildren(v);
  });
  m.run();
  const read = () => m.read();
  accessors.set(read, m);
  return read;
}

/** `fn`'s value, or `fallback(error, reset)` once something under it throws. */
export function createErrorBoundary<T, F>(fn: () => T, fallback: (error: () => unknown, reset: () => void) => F): () => T | F {
  const failed = new Signal<unknown>(NONE, { ownedWrite: true, equals: false });
  const m = new Computation<T | F>(MEMO, () => {
    (m as any).catch = (e: unknown) => {
      if (failed.value !== NONE) return false;
      failed.value = e;
      failed.bump();
      reportCaught(e, m);
      return true;
    };
    const err = failed.read();
    if (err !== NONE) return untrack(() => fallback(() => failed.value, () => ((failed.value = NONE), failed.bump())));
    try {
      return resolveChildren(fn());
    } catch (e) {
      if (e instanceof NotReadyError) throw e;
      failed.value = e;
      reportCaught(e, m);
      return untrack(() => fallback(() => failed.value, () => ((failed.value = NONE), failed.bump())));
    }
  });
  m.run();
  const read = () => m.read();
  accessors.set(read, m);
  return read;
}

/** A value with what is under it resolved: accessors called, nested arrays flattened. */
export const flatten = (v: unknown) => resolveChildren(v);

// ---------------------------------------------------------------- optimistic values

/** Optimistic writes waiting for the next flush: [node, value, the action's transaction or null]. */
const guesses: [Node, unknown, Transaction | null][] = [];
/** Overrides installed outside an action: reverted at the end of their flush. */
const ambient: Node[] = [];
/** What undoes optimistic store writes made outside an action, at the end of their flush. */
const ambientEnds: (() => void)[] = [];

/** `end` run when the optimistic writes being made now are undone: at their action's end, or at the flush's. */
export function onGuessEnd(end: () => void) {
  const tx = acting?.tx;
  if (tx && !tx.done) tx.ends.push(end);
  else ambientEnds.push(end), schedule();
}

function installGuesses() {
  for (const [n, v, tx] of guesses.splice(0)) {
    const was = n.override;
    n.override = v as any;
    if (tx && !tx.done) {
      if (was === NONE) tx.ends.push(() => n.override !== NONE && ((n.override = NONE), n.bump()));
    } else if (!ambient.includes(n)) ambient.push(n);
    n.bump();
  }
}

/** An optimistic write to `n`: shown from the next flush until the action that made it ends. */
export function guess(n: Node, v: unknown) {
  guesses.push([n, v, acting?.tx ?? null]);
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
  const read = n instanceof Computation ? () => n.read() : () => (n as Signal<T>).read();
  accessors.set(read, n as any);
  const set: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(n.override !== NONE ? (n.override as T) : n.value) : next;
    guess(n, v);
    return v;
  };
  return [read, set];
}

/** What is being built when `fn` was created (an effect run once what it builds is on the page). */
export function onSettled(fn: () => void | (() => void)) {
  const o = owner;
  let ended = false;
  if (o) (o.cleanups ??= []).push(() => (ended = true));
  queueMicrotask(() => {
    if (ended) return;
    flush();
    const done = runWithOwner(null, fn);
    if (typeof done === "function") {
      if (o && !o.disposed) (o.cleanups ??= []).push(done);
    }
  });
}

/** A single-function effect: it tracks and does its work in the same run (it may run again in async situations). */
export function createTrackedEffect(fn: () => void | (() => void)) {
  let clean: void | (() => void);
  createEffect(
    () => {
      if (typeof clean === "function") clean();
      clean = fn();
    },
    () => {},
  );
  onCleanup(() => typeof clean === "function" && clean());
}

/** Declares that the work in progress will change `target`: it reads as pending until that work lands. */
export function affects(target: unknown, _key?: PropertyKey) {
  const c = typeof target === "function" ? accessors.get(target) : undefined;
  const tx = acting?.tx;
  if (!c || !tx) return;
  (c as any).affected = ((c as any).affected ?? 0) + 1;
  statusChanged();
  tx.ends.push(() => {
    (c as any).affected--;
    statusChanged();
  });
}

// ---------------------------------------------------------------- the client error hook, ids, reactions

/** Where a root keeps its own error hook (ahead of configureClientErrors'). */
export const ROOT_ERROR_HOOK = Symbol("root-error-hook");
type ErrorHook = (error: unknown, info: { ownerPath: string[]; boundaryPath: string[] }) => void;
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
    hook(e, { ownerPath: [], boundaryPath: [] });
  } catch (err) {
    console.error(err);
  }
}

let idCount = 0;
/** An id unique on this page. */
export function createUniqueId(): string {
  return "cl-" + idCount++;
}

/** `onChange` called once, the first time what the returned tracker's function reads changes. */
export function createReaction(onChange: () => void) {
  let stop: (() => void) | null = null;
  return (fn: () => void) => {
    stop?.();
    let first = true;
    stop = createRoot((dispose) => {
      createEffect(
        () => fn(),
        () => {
          if (first) return void (first = false);
          dispose();
          onChange();
        },
      );
      return dispose;
    });
  };
}

/** Hydration (a server's HTML adopted): Twist renders on the client only, for now. */
export const sharedConfig: { hydrating: boolean; context: unknown } = { hydrating: false, context: null };
export const isHydrating = () => sharedConfig.hydrating;
export function enableHydration() {}
