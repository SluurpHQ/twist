// Twist's reactive core: signals, memos, split effects, owners. Written from Solid 2's public design (its RFCs and
// tests), not its code. Writes are queued: reads return the committed value until the queue is flushed (the next
// microtask, or flush()). A flush commits the writes, then runs what depends on them in dependency order (height, then
// creation), pulling memos as they are read, then render effects' apply halves, then the other effects'.

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

// ---------------------------------------------------------------- signals

type Equals<T> = false | ((a: T, b: T) => boolean);
const NONE: unique symbol = Symbol("none");
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

/** Ticks with every committed change: a memo nothing subscribes to is still valid if it ran at this tick. */
let clock = 0;
let ids = 0;

export type SignalOptions<T> = { equals?: Equals<T>; unobserved?: () => void; ownedWrite?: boolean; name?: string; lazy?: boolean };

export class Signal<T> {
  value: T;
  /** A write waiting for the next flush. */
  pending: T | typeof NONE = NONE;
  observers: Computation<any>[] = [];
  equals: Equals<T>;
  unobserved?: () => void;
  ownedWrite: boolean;
  height = 0;
  /** Counts its changes: a reader compares it with the count it saw. */
  version = 0;
  constructor(value: T, options?: SignalOptions<T>) {
    this.value = value;
    this.equals = options?.equals ?? Object.is;
    this.unobserved = options?.unobserved;
    this.ownedWrite = !!options?.ownedWrite;
  }
  read(): T {
    if (listener) listener.track(this);
    return this.value;
  }
  write(next: T) {
    guardWrite(this.ownedWrite);
    if (this.pending === NONE) writes.push(this);
    this.pending = next;
    schedule();
  }
  /** The pending write applied: its observers go dirty if the value changed. */
  commit() {
    const next = this.pending as T;
    this.pending = NONE;
    if (this.equals !== false && this.equals(this.value, next)) return;
    this.value = next;
    this.version++;
    clock++;
    for (const o of this.observers) o.mark(DIRTY);
  }
  subscribe(o: Computation<any>) {
    this.observers.push(o);
  }
  unsubscribe(o: Computation<any>) {
    remove(this.observers, o);
    if (!this.observers.length) this.unobserved?.();
  }
}

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

type Source = Signal<any> | Computation<any>;

export class Computation<T> implements Owner {
  parent: Owner | null;
  owned: Owner[] | null = null;
  cleanups: (() => void)[] | null = null;
  context: Record<symbol, unknown> | null;
  disposed = false;
  id = ids++;
  height = 0;
  kind: number;
  fn: (prev?: T) => T;
  value: T | undefined = undefined;
  state = DIRTY;
  sources: Source[] = [];
  /** The version of each source when it was read. */
  seen: number[] = [];
  version = 0;
  observers: Computation<any>[] = [];
  /** Subscribed to its sources (a memo nothing reads, unowned or lazy, lets go of them and checks the clock instead). */
  attached = false;
  ranAt = -1;
  equals: Equals<T>;
  lazy: boolean;
  unobserved?: () => void;
  /** An effect's apply half, what it last applied, and the cleanup it gave back. */
  apply?: (value: T, prev?: T) => void | (() => void);
  applied: T | typeof NONE = NONE;
  cleanup?: () => void;
  onError?: (err: unknown, cleanup: () => void) => void;
  /** An effect whose compute gave a new value: its apply is due. */
  due = false;
  constructor(kind: number, fn: (prev?: T) => T, options?: SignalOptions<T>) {
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
    if (this.sources.includes(source)) return;
    this.sources.push(source);
    this.seen.push(source.version);
    if (source.height >= this.height) this.height = source.height + 1;
    if (this.attached) source.subscribe(this);
  }
  subscribe(o: Computation<any>) {
    this.observers.push(o);
    if (!this.attached) this.attach();
  }
  unsubscribe(o: Computation<any>) {
    remove(this.observers, o);
    if (this.observers.length) return;
    this.unobserved?.();
    // A lazy memo with no reader left is torn down (an unowned one stays subscribed: it is eager).
    if (this.lazy) this.detach(), (this.state = DIRTY);
  }
  /** Subscribed again to what it read; stale if anything changed since it ran. */
  attach() {
    this.attached = true;
    if (this.ranAt !== clock && this.state === CLEAN) this.state = CHECK;
    for (const s of this.sources) s.subscribe(this);
  }
  detach() {
    this.attached = false;
    for (const s of this.sources) s.unsubscribe(this);
  }
  /** Disposed: its subscriptions and its effect's cleanup let go. */
  end() {
    if (this.attached) this.detach();
    this.sources = [];
    this.seen = [];
    this.attached = false;
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
    // Every dirty node runs in the flush, in dependency order (a lazy memo nothing reads waits to be read).
    if (!(this.lazy && !this.observers.length)) queue(this);
    for (const o of this.observers) o.mark(CHECK);
  }
  read(): T {
    if (!this.disposed) {
      // Autodisposed and read with nothing subscribed: from scratch, if anything changed since it ran.
      if (!listener && this.autodispose && this.ranAt !== clock) this.state = DIRTY;
      this.update();
    }
    if (listener) listener.track(this);
    return this.value as T;
  }
  /** Brought up to date: run again if something it read changed (memos it read brought up to date first). */
  update() {
    if (this.state === CHECK) {
      // Each source brought up to date in turn: the first that changed since it was read makes this run again.
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
    this.attached = true;
    const prevOwner = owner;
    const prevListener = listener;
    owner = this;
    listener = this;
    let next: T;
    try {
      next = this.fn(this.value);
    } finally {
      owner = prevOwner;
      listener = prevListener;
    }
    this.state = CLEAN;
    this.ranAt = clock;
    const first = this.applied === NONE && this.kind !== MEMO;
    const changed = first || this.equals === false || !this.equals(this.value as T, next);
    this.value = next;
    if (!changed) return;
    if (this.kind === MEMO) {
      this.version++;
    } else if (!this.due) {
      this.due = true;
      applies[this.kind as 1 | 2].push(this);
    }
  }
  /** An effect's apply half, untracked and unowned, after its last cleanup. */
  runApply() {
    if (!this.due || this.disposed) return;
    this.due = false;
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

// ---------------------------------------------------------------- scheduling

/** Signals written since the last flush, in order. */
const writes: Signal<any>[] = [];
/** Computations to bring up to date: effects, and memos nothing reads (memos are eager unless lazy). */
let dirty: Computation<any>[] = [];
/** Effects whose apply half is due: [unused, effects, render effects]. */
const applies: [null, Computation<any>[], Computation<any>[]] = [null, [], []];

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

/** Writes committed and everything brought up to date, until nothing is left to do. */
function drain() {
  for (let rounds = 0; writes.length || dirty.length || applies[RENDER].length || applies[EFFECT].length; rounds++) {
    if (rounds > 1e5) throw new Error("Potential infinite loop detected.");
    if (writes.length) for (const s of writes.splice(0)) s.commit();
    while (dirty.length) {
      const now = dirty.sort(byOrder);
      dirty = [];
      for (const c of now) if (!c.disposed) c.update();
    }
    if (applies[RENDER].length) for (const e of applies[RENDER].splice(0).sort(byOrder)) e.runApply();
    if (applies[EFFECT].length && !writes.length && !dirty.length) for (const e of applies[EFFECT].splice(0).sort(byOrder)) e.runApply();
  }
}

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

export function createSignal<T>(value: T | ((prev?: T) => T), options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  if (typeof value === "function") return writableMemo(value as (prev?: T) => T, options);
  const s = new Signal(value as T, options);
  const set: Setter<T> = (next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(s.pending === NONE ? s.value : (s.pending as T)) : next;
    s.write(v);
    return v;
  };
  return [() => s.read(), set];
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
    const v = typeof next === "function" ? (next as (prev: T) => T)(m.value as T) : next;
    written.write({ v });
    return v;
  };
  return [() => m.read(), set];
}

export function createMemo<T>(fn: (prev?: T) => T, options?: SignalOptions<T>): Accessor<T> {
  const m = new Computation<T>(MEMO, fn, options);
  if (!m.lazy) m.run();
  return () => m.read();
}

type EffectBundle<T> = { effect: (value: T, prev?: T) => void | (() => void); error?: (err: unknown, cleanup: () => void) => void };

function effectOf<T>(kind: 1 | 2, compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  const e = new Computation<T>(kind, compute, options);
  if (typeof apply === "function") e.apply = apply;
  else if (apply) (e.apply = apply.effect), (e.onError = apply.error);
  else e.apply = () => {};
  e.run();
  schedule();
}

export function createEffect<T>(compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  effectOf(EFFECT, compute, apply, options);
}

export function createRenderEffect<T>(compute: (prev?: T) => T, apply?: ((value: T, prev?: T) => void | (() => void)) | EffectBundle<T>, options?: SignalOptions<T>) {
  effectOf(RENDER, compute, apply, options);
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
