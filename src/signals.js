/**
 * Signals: values that say when they change, and the work that follows them.
 *
 *     import { signal, computed, effect } from "@sluurp/twist/signals";
 *
 *     const name = signal("Edna");
 *     const loud = computed(() => name().toUpperCase());
 *     effect(() => console.log(loud()));
 *     name.set("Seymour"); // logs SEYMOUR
 *
 * Nothing here knows about the DOM: a store, a client cache or a worker can
 * be reactive without loading a renderer, and the renderers build on this.
 *
 * Signals are called rather than read — `name()` not `name` — because with
 * no build step there is no compiler to rewrite a plain read into a
 * subscription.
 *
 * Push, then pull, as the TC39 proposal, Solid and Vue all have it: a write
 * only marks what depends on it as stale; a computed works its value out when
 * it is read, and only if something it read really changed, so a read is
 * always current and a computed nobody reads does nothing. Effects run on the
 * next microtask, once per batch of writes, oldest first, each after what it
 * reads is up to date: no effect sees a new value beside an old one.
 */

/**
 * The state every copy of this module on the page shares: a hot update or a second bundle loads another copy, and
 * a signal made by one is read inside another's computed. One state, so the reads are recorded where they are asked.
 */
import { NO_READERS, NOTHING_YET, addReader, dropReader, noteRead, seenAt } from "./kernel.js";

const S = (globalThis[Symbol.for("sluurp.signals")] ??= {
  /** What is running now (a computed or an effect), so reads can record themselves. */
  listener: null,
  owner: null,
  queue: new Set(),
  booked: false,
  made: 0,
  collecting: null,
  nodes: new WeakMap(),
  views: new WeakMap(),
  drafts: new WeakMap(),
});

/**
 * The scope effects created right now belong to, if any.
 *
 * Without this, an effect outlives the DOM it was made for. A keyed list that
 * replaces its rows removes their nodes and leaves their effects subscribed:
 * the signal they watch keeps waking them, they keep writing attributes onto
 * elements nobody can see, and the cost of every future write grows with
 * every list the page has ever shown. It is a leak of memory and of time at
 * once, and nothing about it is visible in the DOM.
 */

const SIGNAL = 0;
const COMPUTED = 1;
const EFFECT = 2;

/** Effects to run, by when they were made; and whether a run is booked. */

/** An error from an effect run on its own: said, without stopping the others. */
function report(error) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  else console.error(error);
}

/**
 * Run what is queued now, rather than on the next microtask: for a test, or
 * a measurement that must see the DOM after a write. Writes are batched on
 * their own; this is only for reading the result straight away.
 */
export function flush() {
  for (let rounds = 0; S.queue.size; rounds++) {
    if (rounds > 1000) {
      S.queue.clear();
      report(new Error("effects kept waking each other: stopped after 1000 rounds"));
      return;
    }
    const batch = [...S.queue].sort((a, b) => a.id - b.id);
    S.queue.clear();
    S.batchBegin?.();
    try {
      for (const e of batch) {
        try {
          update(e);
        } catch (error) {
          report(error);
        }
      }
    } finally {
      S.batchEnd?.();
    }
  }
}

/** A renderer told when a round of effects begins and ends: what it draws in one round, it commits once. */
export function onBatch(begin, end) {
  S.batchBegin = begin;
  S.batchEnd = end;
}

function book() {
  if (S.booked) return;
  S.booked = true;
  queueMicrotask(() => {
    S.booked = false;
    // A renderer in the middle of its commit takes the flush itself when that ends (a microtask run early, as
    // Safari does from inside some DOM calls, must not draw half way).
    if (S.hold?.()) return;
    flush();
  });
}

/** `hold` answers whether a flush on its own microtask waits now: its caller flushes once it no longer does. */
export function holdFlushes(hold) {
  S.hold = hold;
}

/** What depends on `node`, marked stale; the effects among them queued. */
function mark(node) {
  for (const o of node.observers) {
    if (o.kind === COMPUTED) {
      if (!o.stale) {
        o.stale = true;
        // Worked out again at once, read or not: one that answers with promises (what it loads stays
        // current), and one that built something it owns (a subtree replaced is a subtree disposed: left
        // waiting for a reader that may never come, it would go on running behind the page).
        if (o.loads || o.children.length) S.queue.add(o);
        mark(o);
      }
    } else if (!o.disposed) {
      S.queue.add(o);
    }
  }
}

/** Shared by nodes that own nothing: never written (an owner gets its own list). */
const NONE = Object.freeze([]);

/** `source` read by what is running now: noted, with the version it had. */
function track(source) {
  const l = S.listener;
  if (!l) {
    // Read where another reactive system is tracking (Twist, through its bridge): told, so it can follow this.
    if (S.foreign) S.foreign(source);
    return;
  }
  if (noteRead(l, source)) addReader(source, l);
}

/** Whether anything `node` read last time has changed since (computeds among them brought up to date first). */
function changed(node) {
  const sources = node.sources;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (source.kind === COMPUTED) refresh(source);
    if (source.version !== seenAt(node, i)) return true;
  }
  return false;
}

/** Dispose what `node` created on its last run. */
function endChildren(node) {
  const ending = node.children;
  if (!ending.length) return;
  node.children = [];
  for (const off of ending) off();
}

/** Its cleanups run (and gone). */
function endCleanups(node) {
  if (node.cleanups.length) for (const off of node.cleanups.splice(0)) off();
}

/** Run `node.fn` noting what it reads; what it stopped reading lets go of it. Answers what it returned. */
function run(node) {
  endChildren(node);
  endCleanups(node);
  const before = node.sources;
  node.sources = NOTHING_YET;
  node.seen = NOTHING_YET;
  const previous = S.listener;
  const previousOwner = S.owner;
  S.listener = node;
  if (node.owns) S.owner = node.children;
  try {
    return node.fn();
  } finally {
    S.listener = previous;
    S.owner = previousOwner;
    if (before !== NOTHING_YET) for (const source of before) if (!node.sources.includes(source)) dropReader(source, node);
  }
}

/** Unsubscribed from its dependencies, its children disposed. */
function detach(node) {
  node.disposed = true;
  S.queue.delete(node);
  for (const source of node.sources) dropReader(source, node);
  node.sources = NOTHING_YET;
  node.seen = NOTHING_YET;
  endChildren(node);
  endCleanups(node);
}

/**
 * A value that notifies when it changes.
 *
 * Read by calling it; write with `.set(next)` or `.update(fn)`.
 */
export function signal(initial) {
  const node = { kind: SIGNAL, value: initial, version: 0, observers: NO_READERS };
  const read = () => {
    track(node);
    return node.value;
  };
  read.set = (next) => {
    // Object.is so that setting NaN or -0 behaves, and so an unchanged value
    // costs nothing.
    if (Object.is(node.value, next)) return;
    node.value = next;
    node.version++;
    mark(node);
    book();
  };
  read.update = (fn) => read.set(fn(node.value));
  read.peek = () => node.value;
  read.isSignal = true;
  read.node = node;
  return read;
}

/** A computed brought up to date: recomputed only if something it read has changed. */
function refresh(c) {
  if (c.disposed || !c.stale) return;
  if (c.ran && !changed(c)) {
    c.stale = false;
    return;
  }
  c.stale = false;
  c.ran = true;
  let next;
  try {
    next = run(c);
  } catch (error) {
    if (error instanceof NotReady) throw error;
    // Kept, and thrown to whoever reads it, until what it read changes.
    c.error = error;
    c.version++;
    return;
  }
  c.error = undefined;
  if (!c.light && next && typeof next.then === "function") {
    c.ask(next);
    return;
  }
  c.asked++;
  c.failed.set(undefined);
  c.take(next);
  c.settled.set(true);
  c.busy.set(false);
}

/**
 * A signal derived from others, computed when read, and only again once
 * something it read has changed.
 *
 * `equals` decides whether a new result is the same as the last one; when
 * it is, the old value is kept and nothing reading it runs again. The
 * default is `Object.is`, which is right for numbers and strings; a
 * computed that builds a fresh array or object each time is always "new"
 * unless it is given a comparison of what is inside:
 *
 *     computed(() => rooms().filter(isRequest), { equals: sameItems })
 *
 * A computed may answer with a promise: the last answer stays what reads
 * give until the next comes, and `pending()`, `error()` and `ready()` say
 * where it is. Nothing is asked until something reads it (`lazy`, once an
 * option, is how every computed works now).
 */
export function computed(fn, { equals } = {}) {
  const c = {
    kind: COMPUTED, id: S.made++, loads: false, fn, value: undefined, version: 0, observers: NO_READERS, sources: NOTHING_YET, seen: NOTHING_YET,
    stale: true, ran: false, disposed: false, owns: true, children: [], cleanups: [], error: undefined,
    busy: signal(false), failed: signal(undefined), settled: signal(false), asked: 0, first: true,
  };
  const again = signal(0);
  c.fn = () => (again(), fn());
  c.take = (next) => {
    if (!c.first && (equals ? equals(c.value, next) : Object.is(c.value, next))) return;
    c.first = false;
    c.value = next;
    c.version++;
  };
  // An answer on its way. The last one stays shown until it comes — a person
  // page does not go blank while the next person loads — and an answer
  // overtaken by a newer question is dropped.
  c.ask = (promise) => {
    c.loads = true;
    const mine = ++c.asked;
    c.busy.set(true);
    promise.then(
      (value) => {
        if (mine !== c.asked || c.disposed) return;
        c.failed.set(undefined);
        const was = c.version;
        c.take(value);
        if (c.version !== was) {
          mark(c);
          book();
        }
        c.settled.set(true);
        c.busy.set(false);
      },
      (error) => {
        if (mine !== c.asked || c.disposed) return;
        c.failed.set(error);
        c.settled.set(true);
        c.busy.set(false);
      },
    );
  };
  const current = () => {
    refresh(c);
    if (c.error !== undefined) throw c.error;
    return c.value;
  };
  // Read through a boundary's eyes: noted, and — with no answer yet — thrown
  // past whatever was being built, to the boundary that is waiting.
  const read = () => {
    refresh(c);
    track(c);
    if (S.collecting) {
      S.collecting.add(read);
      if (!c.settled.peek()) {
        c.settled();
        throw new NotReady(read);
      }
    }
    if (c.error !== undefined) throw c.error;
    return c.value;
  };
  Object.assign(read, {
    // A known answer put in at once; what it read changing works it out again.
    set: (next) => {
      refresh(c);
      if (Object.is(c.value, next)) return;
      c.value = next;
      c.first = false;
      c.version++;
      mark(c);
      book();
    },
    update: (f) => read.set(f(untrack(current))),
    peek: () => untrack(current),
    isSignal: true,
    /** A new answer is on its way (the old one is still what reads return). */
    pending: () => (untrack(() => refresh(c)), c.busy()),
    /** Why the last answer failed, if it did. */
    error: () => (untrack(() => refresh(c)), c.failed()),
    /** Whether there has been any answer yet, value or error. */
    ready: () => (untrack(() => refresh(c)), c.settled()),
    /**
     * Ask again now: after a change made here, say. What is shown stays until
     * the new answer comes. (`.set(value)` puts a known answer in at once.)
     */
    refresh: () => again.set(again.peek() + 1),
  });
  // Whoever is building this is responsible for taking it apart.
  if (S.owner) S.owner.push(() => detach(c));
  return read;
}

/**
 * What an async computed throws when it is read, before its first answer,
 * while a `Loading` is building what it will show: the boundary catches it,
 * shows its fallback, and builds again once that answer is in. Outside a
 * boundary nothing is thrown — the read gives `undefined`, as it always did.
 */
export class NotReady extends Error {
  constructor(source) {
    super("not ready");
    this.source = source;
  }
}

/** The sources a boundary is collecting, while it builds; null otherwise. */

/**
 * Run `build`, noting every async computed it reads. Returns what it built,
 * or `NotReady` if one had no answer yet, and the sources either way — what
 * a `Loading` waits on without being told.
 */
export function discover(build) {
  const previous = S.collecting;
  const found = new Set();
  S.collecting = found;
  try {
    return { value: build(), sources: [...found], ready: true };
  } catch (error) {
    if (error instanceof NotReady) return { value: undefined, sources: [...found], ready: false };
    throw error;
  } finally {
    S.collecting = previous;
  }
}

/**
 * Whether a new answer to a computed is on its way. Reading its value still
 * gives the last one: this is for dimming what is shown, not hiding it.
 */
export function isPending(source) {
  return typeof source?.pending === "function" ? source.pending() : false;
}

/**
 * A value shown ahead of the server: `apply` changes what is shown at once
 * and hands back the change's promise; when it settles the guess is dropped,
 * because by then the real value has arrived (or the change failed, and the
 * old value is right again).
 *
 *     const shown = optimistic(reactions);
 *     shown.apply((list) => [...list, mine], save(mine));
 */
export function optimistic(source) {
  const guesses = signal([]);
  const shown = computed(() => {
    let value = source();
    for (const guess of guesses()) value = guess.change(value);
    return value;
  });
  shown.apply = (change, promise) => {
    const guess = { change };
    guesses.set([...guesses.peek(), guess]);
    const drop = () => guesses.set(guesses.peek().filter((g) => g !== guess));
    // Done: the guess kept until the real value arrives (the source changes — a row over sync comes
    // a moment after the call), or a second at most; failed: dropped at once, the old value right again.
    const settle = () => {
      const was = source.peek ? source.peek() : untrack(source);
      let stop = () => {};
      const timer = setTimeout(() => { stop(); drop(); }, 1000);
      stop = effect(() => {
        const now = source();
        if (!Object.is(now, was)) untrack(() => { clearTimeout(timer); queueMicrotask(() => stop()); drop(); });
      });
    };
    return Promise.resolve(promise).then(
      (value) => { settle(); return value; },
      (error) => { drop(); throw error; },
    );
  };
  return shown;
}

/**
 * Something done on the server (or anywhere async), with what a person needs
 * to see while it happens: whether it is on its way, why it failed, what it
 * gave back. Call it as the function it wraps.
 *
 *     const save = action(saveNote);        // a "use server" function, say
 *     <Button disabled={save.pending} onClick={() => save(text())}>Save</Button>
 *     {() => save.error()?.message}
 *
 * With `optimistic` for what is shown meanwhile:
 *
 *     notes.apply((list) => [...list, draft], save(draft));
 */
export function action(fn) {
  const going = signal(0);
  const failed = signal(null);
  const gave = signal(undefined);
  const go = async (...args) => {
    going.set(going.peek() + 1);
    failed.set(null);
    try {
      const out = await fn(...args);
      gave.set(out);
      return out;
    } catch (error) {
      failed.set(error);
      throw error;
    } finally {
      going.set(going.peek() - 1);
    }
  };
  go.pending = () => going() > 0;
  go.error = () => failed();
  go.result = () => gave();
  return go;
}

/** Arrays holding the same items in the same order (by `Object.is`). */
export function sameItems(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, i) => Object.is(item, b[i]));
}

/** An effect run again, if something it read really changed; a disposed one never. A loading computed, refreshed. */
function update(e) {
  if (e.kind === COMPUTED) return refresh(e);
  if (e.disposed || !changed(e)) return;
  run(e);
}

/**
 * Run `fn` now, and again whenever a signal it read changes.
 *
 * Returns a dispose function. Dependencies are re-collected on every run, so
 * a branch that stops reading a signal stops depending on it. A run that
 * throws is reported (`reportError`), and the other effects still run; the
 * first run's error is thrown to whoever made the effect.
 */
export function effect(fn, second = {}) {
  // Split: `effect(compute, apply)`. What is read is `compute`'s alone;
  // `apply` does the work, reads nothing reactively, and so can write the
  // very signals it was told about without waking itself.
  if (typeof second === "function") {
    const apply = second;
    let previous;
    let started = false;
    return effect(() => {
      const value = fn();
      const before = previous;
      previous = value;
      const was = started;
      started = true;
      untrack(() => apply(value, was ? before : undefined));
    });
  }
  // With `owns`, what a run creates — the effects and computeds of a subtree
  // it builds — belongs to that run, and ends when the next run starts or
  // this effect ends. A plain effect does not, because an effect that starts
  // something long-lived once, behind a flag, is an ordinary thing to write
  // and would lose it on its next run.
  const e = effectNode(fn, second.owns === true);
  return () => detach(e);
}

/**
 * An effect as its node, for a runtime that keeps many (one a component): `fn` runs as the node's method, so one
 * function can serve them all, reading what it is for from `this.of`. `endEffect(node)` ends it.
 */
export function effectNode(fn, owns = false, of = null) {
  const e = {
    kind: EFFECT, id: S.made++, fn, sources: NOTHING_YET, seen: NOTHING_YET, observers: null,
    disposed: false, owns, children: owns ? [] : NONE, cleanups: NONE, of,
  };
  let ran = false;
  try {
    run(e);
    ran = true;
  } finally {
    // Whoever is building this subtree is responsible for taking it apart. One that read nothing and
    // made nothing can never run again, and is not kept: the compiler wraps every expression that
    // might change, and most of them read no signal at all.
    if (ran && !e.sources.length && !e.children.length && !e.cleanups.length) e.disposed = true;
    else if (S.owner) S.owner.push(() => detach(e));
  }
  return e;
}

/** An effect made by `effectNode` ended. */
export function endEffect(node) {
  detach(node);
}

/**
 * Run `fn`, collecting every effect it creates, and hand back a disposer.
 *
 * Dynamic scoping rather than an explicit owner argument, because the effects
 * being collected are created several layers down — inside `renderInto`,
 * inside `wire`, inside `applyAttribute` — and threading an owner through all
 * of them would mean every one of those has to remember to pass it on.
 */
export function collect(fn) {
  const previous = S.owner;
  const own = [];
  S.owner = own;
  try {
    const value = fn();
    return [
      value,
      () => {
        for (const off of own.splice(0)) off();
      },
    ];
  } finally {
    S.owner = previous;
  }
}

/**
 * Run `fn` when the current owner is disposed: the effect that
 * owns it running again, or ending. For what a component made outside its
 * own element — a dialog at the end of the body, a listener on the window —
 * which nothing else would think to remove.
 */
export function onCleanup(fn) {
  if (S.owner) S.owner.push(fn);
}

/**
 * Run `fn` once what is being built is on the page: after this build, untracked. What it returns,
 * if a function, runs when the component ends, as `onCleanup`'s does.
 *
 *     onMount(() => {
 *       const tick = setInterval(update, 1000);
 *       return () => clearInterval(tick);
 *     });
 */
export function onMount(fn) {
  const own = S.owner;
  let ended = false;
  if (own) own.push(() => (ended = true));
  queueMicrotask(() => {
    if (ended) return;
    const done = untrack(fn);
    if (typeof done === "function") {
      if (own) own.push(done);
    }
  });
}

/** Who owns what is built now: for building later, as part of it (`runWithOwner`). */
export function getOwner() {
  return S.owner;
}

/** Whether something is tracking what is read now (an effect or a computed running), as Solid's `getListener`. */
export function listening() {
  return S.listener !== null;
}

/** Run `fn` as part of `scope` (from `getOwner`): what it creates is disposed with it. */
export function runWithOwner(scope, fn) {
  const previous = S.owner;
  S.owner = scope;
  try {
    return fn();
  } finally {
    S.owner = previous;
  }
}

const QUIET = { set() {} };

/**
 * A computed without the loading machinery (no `pending`, `error`, `ready`; a promise is a value
 * like any other): what a component's props are kept in. Light enough to make one per prop.
 */
export function memo(fn) {
  const c = {
    kind: COMPUTED, id: S.made++, loads: false, light: true, fn, value: undefined, version: 0, observers: NO_READERS,
    sources: NOTHING_YET, seen: NOTHING_YET, stale: true, ran: false, disposed: false, owns: true, children: [], cleanups: [],
    error: undefined, busy: QUIET, failed: QUIET, settled: QUIET, asked: 0, first: true,
  };
  c.take = (next) => {
    if (!c.first && Object.is(c.value, next)) return;
    c.first = false;
    c.value = next;
    c.version++;
  };
  if (S.owner) S.owner.push(() => detach(c));
  return () => {
    refresh(c);
    track(c);
    if (c.error !== undefined) throw c.error;
    return c.value;
  };
}

/** Read without subscribing, for when a value is needed but not watched. */
/**
 * Whether `source` equals a key, read per key: when it changes, only what read the old key and the new one is woken
 * (one row's selection, of a thousand). `is(key)` reads like a signal.
 */
export function selector(source) {
  const keys = new Map();
  let was;
  effect(() => {
    const now = source();
    untrack(() => {
      keys.get(was)?.set(false);
      keys.get(now)?.set(true);
    });
    was = now;
  });
  return (key) => {
    let s = keys.get(key);
    if (!s) keys.set(key, (s = signal(Object.is(untrack(source), key))));
    return s();
  };
}

/**
 * What another reactive system is told of a signal read outside every computation here (`node`, for
 * `followNode`): how Twist follows Sluurp's signals. One at a time.
 */
export function setForeignRead(fn) {
  S.foreign = fn;
}

/** `node` (as `setForeignRead` gave it) read here, tracked: a computed brought up to date first. */
export function followNode(node) {
  if (node.kind === COMPUTED) refresh(node);
  track(node);
}

export function untrack(fn) {
  const previous = S.listener;
  S.listener = null;
  try {
    return fn();
  } finally {
    S.listener = previous;
  }
}

/**
 * Run `fn` without subscribing what is running now, and say how many signals it read: none means what it answers
 * never changes, which is how a caller tells a function of signals from one that is not.
 */
export function readCount(fn) {
  const previous = S.listener;
  const probe = { sources: NOTHING_YET, seen: NOTHING_YET };
  S.listener = probe;
  try {
    const value = fn();
    return { value, count: probe.sources.length };
  } finally {
    S.listener = previous;
    for (const source of probe.sources) dropReader(source, probe);
  }
}

/** Run `fn` noting what it reads (not subscribed): the value, the nodes read, and the version each had. */
export function readsOf(fn) {
  const previous = S.listener;
  const probe = { sources: NOTHING_YET, seen: NOTHING_YET };
  S.listener = probe;
  try {
    const value = fn();
    const sources = probe.sources === NOTHING_YET ? [] : [...probe.sources];
    return { value, sources, versions: sources.map((s) => s.version) };
  } finally {
    S.listener = previous;
    for (const source of probe.sources) dropReader(source, probe);
  }
}

/* ------------------------------------------------------------------ stores */

// A store is a plain object read through a proxy that tracks each property
// on its own, and written through a draft: `setState(d => { d.todos[2].done
// = true })` notifies what read `todos[2].done`, and nothing that read anything
// else. The objects stay plain — the proxies are views of them.

const KEYS = Symbol("keys");
const RAW = Symbol("raw");

const wrappable = (v) =>
  v !== null && typeof v === "object" && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);
const unwrap = (v) => (v && v[RAW]) || v;

function node(target, key) {
  let map = S.nodes.get(target);
  if (!map) S.nodes.set(target, (map = new Map()));
  let n = map.get(key);
  if (!n) map.set(key, (n = signal(0)));
  return n;
}
function bump(target, key) {
  const n = S.nodes.get(target)?.get(key);
  if (n) n.set(n.peek() + 1);
}

function view(target) {
  let proxy = S.views.get(target);
  if (proxy) return proxy;
  proxy = new Proxy(target, {
    get(t, key) {
      if (key === RAW) return t;
      if (typeof key === "symbol") return Reflect.get(t, key);
      // An array's methods read through the view too, so `map` tracks
      // every index it touches and `length`.
      if (S.listener) node(t, key)();
      const value = Reflect.get(t, key);
      return wrappable(value) ? view(value) : value;
    },
    has(t, key) {
      if (S.listener) node(t, KEYS)();
      return Reflect.has(t, key);
    },
    ownKeys(t) {
      if (S.listener) node(t, KEYS)();
      return Reflect.ownKeys(t);
    },
    set() {
      throw new Error("a store is changed through its setter, on a draft");
    },
    deleteProperty() {
      throw new Error("a store is changed through its setter, on a draft");
    },
  });
  S.views.set(target, proxy);
  return proxy;
}

function draft(target) {
  let proxy = S.drafts.get(target);
  if (proxy) return proxy;
  proxy = new Proxy(target, {
    get(t, key) {
      if (key === RAW) return t;
      const value = Reflect.get(t, key);
      return wrappable(value) ? draft(value) : value;
    },
    set(t, key, value) {
      const had = Object.prototype.hasOwnProperty.call(t, key);
      const before = t[key];
      const length = Array.isArray(t) ? t.length : 0;
      value = unwrap(value);
      if (had && Object.is(before, value)) return true;
      t[key] = value;
      bump(t, key);
      if (!had) bump(t, KEYS);
      if (Array.isArray(t) && t.length !== length) {
        bump(t, "length");
        bump(t, KEYS);
      }
      return true;
    },
    deleteProperty(t, key) {
      if (!Object.prototype.hasOwnProperty.call(t, key)) return true;
      delete t[key];
      bump(t, key);
      bump(t, KEYS);
      return true;
    },
  });
  S.drafts.set(target, proxy);
  return proxy;
}

/**
 * State that is an object, tracked property by property, as Solid 2.0's
 * stores are.
 *
 *     const [state, setState] = store({ todos: [] });
 *     setState((d) => { d.todos.push({ title: "milk", done: false }); });
 *     setState((d) => { d.todos[0].done = true; });   // notifies only `done` readers
 *
 * The setter hands over a draft to change as a plain object — no copying,
 * no spreading. Given an object instead, its keys are merged in.
 */
export function store(initial) {
  const root = unwrap(initial);
  const setState = (change) => {
    const d = draft(root);
    if (typeof change === "function") {
      const replaced = change(d);
      if (replaced && typeof replaced === "object") Object.assign(d, replaced);
    } else if (change && typeof change === "object") {
      Object.assign(d, change);
    }
  };
  return [view(root), setState];
}

/**
 * A store derived from other signals: `fn` is handed a draft and changes
 * it, and runs again whenever what it read changes. Only what it changed
 * notifies anyone.
 *
 *     const selected = projection((d) => { d.id = chosen(); d.name = byId(chosen())?.name; }, {});
 */
export function projection(fn, initial = {}) {
  const [state] = store(initial);
  const target = unwrap(initial);
  effect(() => {
    // The draft's reads are untracked: only the signals `fn` reads outside
    // the store make it run again.
    fn(draft(target));
  });
  return state;
}

/**
 * A signal whose value survives a reload.
 *
 * Hot reload replaces the page, which is the right behaviour for a source
 * change but loses everything held in memory. Anything a developer would be
 * annoyed to retype — an open tab, a filter, a half-filled form — is worth
 * declaring persistent; the rest is not.
 *
 * Storage is per tab and best-effort: a private window that refuses it simply
 * gets an ordinary signal.
 */
export function persisted(key, initial) {
  const storageKey = `sluurp.ui.${key}`;
  let start = initial;
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved !== null) start = JSON.parse(saved);
  } catch {
    /* unavailable or corrupt: fall back to the initial value */
  }

  const inner = signal(start);
  effect(() => {
    const value = inner();
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* nothing to do; the signal still works for this page */
    }
  });
  return inner;
}

