/**
 * Types for `@sluurp/twist/signals`: signals, and the work that follows them.
 */

/** A value that notifies when it changes. Read it by calling it. */
export interface Signal<T> {
  (): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  /** Read without subscribing. */
  peek(): T;
  readonly isSignal: true;
}

/** A signal, or a plain value, or a function returning one. */
export type Reactive<T> = T | Signal<T> | (() => T);

export function signal<T>(initial: T): Signal<T>;
export function signal<T = undefined>(): Signal<T | undefined>;

/**
 * A signal derived from others, recomputed only when they change. With
 * `equals`, a result the same as the last keeps the old value and wakes
 * nothing.
 */
export function computed<T>(fn: () => Promise<T>, options?: { equals?: (previous: T, next: T) => boolean; lazy?: boolean }): Derived<T | undefined>;
export function computed<T>(fn: () => T, options?: { equals?: (previous: T, next: T) => boolean; lazy?: boolean }): Derived<T>;

/**
 * A computed. When its function returns a promise, reads give the last
 * answer while a new one is on its way.
 */
export interface Derived<T> extends Signal<T> {
  /** A new answer is on its way. */
  pending(): boolean;
  /** Why the last answer failed, if it did. */
  error(): unknown;
  /** Whether there has been any answer yet. */
  ready(): boolean;
  /** Ask again now; what is shown stays until the new answer comes. */
  refresh(): void;
}

/** Thrown by an async computed read before its first answer while a `Loading` builds. */
export class NotReady extends Error {
  source: unknown;
}
/** Run `build`, noting the async computeds it reads; see `Loading`. */
export function discover<T>(build: () => T): { value: T | undefined; sources: Derived<unknown>[]; ready: boolean };

/** Whether a new answer to a computed is on its way. */
export function isPending(source: unknown): boolean;

/** A value shown ahead of the server; see `optimistic` in the source. */
export interface Optimistic<T> extends Derived<T> {
  apply<R>(change: (current: T) => T, promise: Promise<R> | R): Promise<R>;
}
export function optimistic<T>(source: () => T): Optimistic<T>;
/** An async function with its state: pending, its error, what it gave. Called as the function it wraps. */
export function action<A extends any[], R>(fn: (...args: A) => R | Promise<R>): ((...args: A) => Promise<R>) & { pending: () => boolean; error: () => unknown; result: () => R | undefined };

/** Run what is queued now instead of on the next microtask. */
export function flush(): void;
/** For a renderer: `hold` says whether a flush on its own microtask waits now (the renderer flushes after). */
export function holdFlushes(hold: () => boolean): void;
/** A renderer told when a round of effects begins and ends (to commit what it drew in the round once). */
export function onBatch(begin: () => void, end: () => void): void;
/** Arrays holding the same items in the same order (by `Object.is`). */
export function sameItems(a: unknown, b: unknown): boolean;

/** Run now, and again whenever a signal it read changes. Returns a disposer. */
export function effect(fn: () => void, options?: { owns?: boolean }): () => void;
/**
 * Split: `compute` is what is watched; `apply(value, previous)` does the
 * work and reads nothing reactively.
 */
export function effect<T>(compute: () => T, apply: (value: T, previous: T | undefined) => void): () => void;
/**
 * An effect as its node, for a runtime that keeps many (one a component): `fn` runs as the node's method, so one
 * function can serve them all, reading what it is for from `this.of`. `endEffect(node)` ends it.
 */
export function effectNode<O>(fn: (this: EffectNode<O>) => void, owns?: boolean, of?: O): EffectNode<O>;
/** An effect made by `effectNode` ended. */
export function endEffect(node: EffectNode<any>): void;
export interface EffectNode<O> {
  readonly of: O;
}

/**
 * Run `fn`, collecting every effect it creates, and hand back a disposer
 * alongside its result. What keeps a removed subtree from going on
 * reacting.
 */
export function collect<T>(fn: () => T): [T, () => void];

/** Run `fn` when whatever is building this is taken apart: its owning effect running again, or ending. */
export function onCleanup(fn: () => void): void;
/**
 * Run `fn` once what is being built is on the page, untracked. A function it returns runs when
 * the component ends.
 */
export function onMount(fn: () => void | (() => void)): void;
/** Who owns what is built now, to build something later as part of it (`runWithOwner`). */
export function getOwner(): unknown;
/** Run `fn` as part of `owner` (from `getOwner`): what it makes ends with that. */
export function runWithOwner<T>(owner: unknown, fn: () => T): T;
/** Whether something is tracking what is read now (an effect or a computed running). */
export function listening(): boolean;
/** What another reactive system is told of a signal read outside every computation here: the node, for `followNode`. */
export function setForeignRead(fn: ((node: object) => void) | null): void;
/** A node `setForeignRead` gave, read here and tracked (a computed brought up to date first). */
export function followNode(node: object): void;
/** A computed without loading state: worked out when read, again once what it read changes. */
export function memo<T>(fn: () => T): () => T;
/** Read without subscribing, for a value that is needed but not watched. */
/** Whether `source` equals a key, read per key: a change wakes only what read the old key and the new one. */
export function selector<T>(source: () => T): (key: T) => boolean;
export function untrack<T>(fn: () => T): T;
/** Run `fn` without subscribing, and say how many signals it read (none: what it answers never changes). */
export function readCount<T>(fn: () => T): { value: T; count: number };

/** State that is an object, tracked property by property; changed on a draft. */
export function store<T extends object>(initial: T): [T, (change: ((draft: T) => void | Partial<T>) | Partial<T>) => void];
/** A store derived from other signals: `fn` changes a draft whenever what it read changes. */
export function projection<T extends object>(fn: (draft: T) => void, initial?: T): T;

/** A signal backed by `sessionStorage`, for state that should survive a reload. */
export function persisted<T>(key: string, initial: T): Signal<T>;
