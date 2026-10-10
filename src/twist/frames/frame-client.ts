// Ported from Solid's frames/src/frame-client.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
// @ts-nocheck
/** Client frame runtime — the consumer side of a frame stream. */

// The module's one import, and only for the dev-tier integrity check
import { DEV, OBSERVE } from "../index.ts";

/** One transport chunk of a frame stream, addressed by frame `id`. */
export type FrameChunk = (
  | { type: "start"; id: string; version: number }
  | {
      type: "html";
      id: string;
      version: number;
      html: string;
      /** Server-minted digest of the root's skeleton (RFC 11 §9.5, Hole hashes). */
      digest?: string;
      /** Digests of the live holes inside the html, by ledger key (`lh:N`, `lha:N`). */
      holes?: Record<string, string>;
    }
  | {
      type: "fragment";
      id: string;
      version: number;
      key: string;
      html: string;
      digest?: string;
      holes?: Record<string, string>;
    }
  | {
      type: "hole";
      id: string;
      version: number;
      key: string;
      html: string;
      digest?: string;
      holes?: Record<string, string>;
    }
  | {
      type: "attr";
      id: string;
      version: number;
      key: string;
      attrs: string;
      removed?: string[];
      digest?: string;
    }
  | {
      type: "reveal";
      id: string;
      version: number;
      keys: string[];
      waitForStyles?: boolean;
      fallback?: boolean;
    }
  | {
      type: "data";
      id: string;
      version: number;
      key?: string;
      node?: unknown;
      initial?: boolean;
      /** Eval-style hydration script — only when produced with the hydration serializer. */
      payload?: string;
    }
  | {
      type: "assets";
      id: string;
      version: number;
      key: string;
      modules?: string[];
      styles?: string[];
      inlineStyles?: { id: string; content?: string; attrs?: Record<string, string> }[];
      preloads?: { href?: string; attrs: Record<string, string> }[];
    }
  | { type: "slot"; id: string; version: number; key: string; args: Record<string, unknown> }
  | {
      /** One server sweep's re-emissions as one unit (RFC 11 addendum, C13): */
      type: "ops";
      id: string;
      version: number;
      ops: (
        | { type: "hole"; key: string; html: string; digest?: string }
        | { type: "attr"; key: string; attrs: string; removed?: string[]; digest?: string }
      )[];
    }
  | {
      type: "complete";
      id: string;
      version: number;
      /** Present when the producer ended a plain (non-`live`) response at */
      bound?: "yields" | "time";
    }
  | { type: "error"; id: string; version: number; key?: string; error: unknown }
) &
  TierAnnouncement;

/** The in-band tier announcement (frames savings pass §2; additive — RFC 11 */
export interface TierAnnouncement {
  tiers?: string[];
}

/** One store write applied to a frame: `r` maps record keys to values */
export interface FrameWrite {
  version: number;
  r: Record<string, unknown>;
}

/** Context passed to a slot callback. */
export interface SlotContext {
  /** True only for the hydration-attach invocation of an adopted */
  adopted?: boolean;
  /** Whether this occurrence is a render-prop CALL (the producer placed it */
  invoked?: boolean;
  /** Register cleanup for when this occurrence's range is removed from the */
  onCleanup(fn: () => void): void;
  /** Live-props opt-in: a binding that registers here receives the */
  onUpdate(fn: (props: Record<string, unknown>) => void): void;
  /** The range's current interior — server-rendered client content on an */
  existing: ChildNode[];
  /** The range's own marker comments, when the occurrence has a placed range */
  range?: { start: Comment; end: Comment };
}

/** Client content for a server-declared slot. */
export type Slot = (props: Record<string, unknown>, ctx: SlotContext) => void;

/** @experimental */
export interface Frame {
  /** Merge a write into the store and flush (morph/reveal/slot sync). */
  apply(write: FrameWrite): void;
  /** The active version, or undefined before the first apply. */
  readonly version: number | undefined;
  /** Read-only view of the resident record store. */
  readonly store: Readonly<Record<string, unknown>>;
  /** The stream's error record, if an `error` chunk arrived. */
  readonly error: unknown;
  /** Re-key this live frame to a different boundary id (the mount-preserving */
  rebind(id: string): void;
  /** Push a staged response's slot args into the live occurrences they @internal */
  preview?(records: Record<string, unknown>): void;
  /** Tear down: slot cleanups cascade, later chunks are ignored. Idempotent. */
  dispose(): void;
}

/** Routes a flat stream of addressed chunks to frames by id, buffering chunks */
export interface FrameHost {
  register(id: string, frame: Frame): void;
  /** Remove one frame (or all frames of the id when `frame` is omitted). */
  unregister(id: string, frame?: Frame): void;
  apply(chunk: FrameChunk): void;
  /** The reactive half of a staged response (see @internal */
  preview?(chunk: FrameChunk): void;
  /** The first registered frame under the id, if any. */
  get(id: string): Frame | undefined;
  /** The address as an async source: its first landing is the first flush of */
  landing(id: string): Promise<void> | undefined;
  serialize(value: unknown): { $ref: string };
  /** See FrameHostOptions.revive. */
  revive?(value: unknown, claiming?: boolean): unknown;
}

/** Options for `createFrameHost`. */
export interface FrameHostOptions {
  /** Backs `{$ref}` slot args (typically a codec data table's `resolve`). */
  resolve?(ref: { $ref: string }, frameId: string, version: number, current?: number): unknown;
  /** Test/host-side counterpart of `resolve`. */
  serialize?(value: unknown): { $ref: string };
  /** Receives each `data` chunk whole. */
  applyData?(chunk: Extract<FrameChunk, { type: "data" }>, current?: number): void;
  /** The response (one version of one id) has ended — its `complete`, or */
  closeData?(frameId: string, version: number, error?: unknown): void;
  /** A lazily-loaded deserializer's load, awaited by the transport before it */
  prepareData?(): Promise<unknown>;
  /** Revive protocol markers inside LITERAL slot args (values that are */
  revive?(value: unknown, claiming?: boolean): unknown;
}

/** Options for `createFrame` / `createFrameElement`. */
export interface FrameOptions {
  /** Register with this host under `id`, receiving routed/buffered chunks. */
  host?: FrameHost;
  id?: string;
  /** Client content keyed by prop name (occurrences resolve by prop). */
  slots?: Record<string, Slot>;
  /** Adopt existing server-rendered DOM: the first apply morphs against it, */
  adopt?: boolean;
  /** Called after each apply flush (tests/telemetry). */
  onApply?(info: { version: number; reason: "materialize" | "morph" | "reveal" | "error" }): void;
  /** Wraps element-claim sweeps (`a[href]`/`form[action]` in materialized */
  ownerScope?<T>(fn: () => T): T;
  /** Boundary-driven segment reveal. */
  reveal?(seam: { before: Node; fallback: Node[]; content: () => Node | DocumentFragment }): void;
  /** Adopt path only. */
  hold?(): () => void;
}
/** Client frame runtime — the consumer side of the frame stream (port of the */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

// === Element claims for server content ===
const CLAIM_SEAM = Symbol.for("solid.element-claims");
const CLAIMED_ELEMENTS = "a[href], form[action]";

/** The live consumer list (undefined when dormant — the one check sweeps pay). */
function claimHandlers() {
  const handlers = globalThis[CLAIM_SEAM];
  return handlers !== undefined && handlers.length !== 0 ? handlers : undefined;
}

/** Fire every handler on one element unconditionally. */
function claimNode(handlers, el) {
  for (let i = 0; i < handlers.length; i++) handlers[i](el);
}

const claimedAttr = name => name === "href" || name === "action";

/** Sweep `root` (element or fragment) and its claimable interior. */
function claimTree(handlers, root) {
  const isElement = root.nodeType === ELEMENT_NODE;
  if (!isElement && root.nodeType !== 11 /* DOCUMENT_FRAGMENT_NODE */) return;
  if (isElement && root.matches(CLAIMED_ELEMENTS)) claimNode(handlers, root);
  const found = root.querySelectorAll(CLAIMED_ELEMENTS);
  for (let i = 0; i < found.length; i++) claimNode(handlers, found[i]);
}

/** Fragment placeholder start: `<template id="pl-KEY">` (content = fallback). */
const placeholderId = name => `pl-${name}`;

const SLOT_START = /^slot:(.+):start$/;
const SLOT_END = /^slot:(.+):end$/;
const slotEnd = id => `slot:${id}:end`;

// === Binding slots (principles §9.2.3: a slot read at positions of server markup) ===
/** @internal (the bind tier's own copy — see bind-tier.ts) */
export const SLOT_MARKER = "_s:";
/** @internal (the bind tier's own copy — see bind-tier.ts) */
export const SLOT_TEXT = SLOT_MARKER + "t=";
const SLOT_TEXT_END = "/" + SLOT_MARKER + "t";

const isTextStart = n => n.nodeType === COMMENT_NODE && n.data.startsWith(SLOT_TEXT);

/** Whether an element carries any `_s:*` marker (the detection alone; the */
function hasSlotMarker(el) {
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) if (attrs[i].name.startsWith(SLOT_MARKER)) return true;
  return false;
}

/** Whether a slot arg value is an async value passed whole (a promise or an @internal */
export function isAsyncValue(v: any): boolean {
  return (
    v !== null &&
    typeof v === "object" &&
    (typeof v.then === "function" || typeof v[Symbol.asyncIterator] === "function")
  );
}

/** A value's shape, as the binding-slot shape findings name it. @internal */
export function shapeOf(v: unknown): string {
  return v === null
    ? "null"
    : typeof Node === "function" && v instanceof Node
      ? "a DOM node"
      : Array.isArray(v)
        ? "an array"
        : isAsyncValue(v)
          ? "an async value"
          : typeof v;
}

/** Dev finding (`BINDING_SLOT_POSITION`): the client side of a binding slot @internal */
export function slotShapeFinding(data: Record<string, string>, message: string) {
  DEV!.report(
    OBSERVE!.diagnostics.emit(
      { code: "BINDING_SLOT_POSITION", kind: "render", severity: "warn", message, data },
      null
    )
  );
} /**
 * Maps a wire chunk onto resident-store record writes. `data` chunks map to
 * no records — they are response-scoped and the host applies them through
 * its data hook.
 * @experimental
 */
export function chunkToRecords(chunk: FrameChunk): Record<string, unknown>;

/** Map a wire chunk onto resident-store record writes. */
export function chunkToRecords(chunk) {
  switch (chunk.type) {
    case "start":
    case "data":
      return {};
    // Content records carry the server's digests through (see the ledger
    case "html":
      return { "": { kind: "html", value: chunk.html, digest: chunk.digest, holes: chunk.holes } };
    case "fragment":
      return {
        [`seg:${chunk.key}`]: {
          kind: "html",
          value: chunk.html,
          digest: chunk.digest,
          holes: chunk.holes
        }
      };
    case "reveal": {
      const records = {};
      const gate = chunk.fallback ? "fallback" : "reveal";
      for (const key of chunk.keys) records[`seg:${key}:${gate}`] = true;
      return records;
    }
    case "assets":
      return { [`seg:${chunk.key}:assets`]: chunk };
    case "slot":
      // A named slot invocation: the client render function for `key` is
      return { [`slot:${chunk.key}`]: { kind: "slot", args: chunk.args } };
    case "hole":
      // A live-hole re-emission: the re-resolved HTML for a marked content
      return {
        [`hole:${chunk.key}`]: {
          kind: "html",
          value: chunk.html,
          digest: chunk.digest,
          holes: chunk.holes
        }
      };
    case "attr":
      // A live attr-hole re-emission: rebuilt attribute text for the
      return {
        [`attr:${chunk.key}`]: {
          kind: "attrs",
          value: chunk.attrs,
          removed: chunk.removed,
          digest: chunk.digest
        }
      };
    case "ops":
      // One sweep's members as one write: the records merge into one map
      return Object.assign({}, ...chunk.ops.map(chunkToRecords));
    case "complete":
      // `:bound` beside `:complete` — the producer's streaming bound when
      return { ":complete": true, ":bound": chunk.bound };
    case "error":
      // Keyed errors scope to what the key names: a hole key (`lh:N`) is a
      if (!chunk.key) return { ":error": chunk.error };
      return {
        [`${/^lha?:/.test(chunk.key) ? "hole" : "seg"}:${chunk.key}:error`]: chunk.error
      };
    default:
      return {};
  }
} /** @experimental */
export function createFrameHost(options?: FrameHostOptions): FrameHost;

/** Routes a flat stream of addressed chunks to the right frame in a (possibly */
export function createFrameHost(options = {}) {
  // One logical stream may feed several mounted boundaries (the same server
  const frames = new Map();
  // Resident stores, keyed by id — in the transport's usage an ADDRESS, the
  const stores = new Map();
  const storeFor = id => {
    let store = stores.get(id);
    if (!store) stores.set(id, (store = { version: undefined, records: {} }));
    return store;
  };
  // Landings awaited per address (see `landing`): the promise handed out
  const landings = new Map();
  const lands = records => "" in records || ":error" in records || ":complete" in records;
  // One write's fan-out: every frame mounted under the id applies it.
  const applyTo = (id, version, r) => {
    const set = frames.get(id);
    if (set) for (const frame of set) frame.apply({ version, r });
  };
  // Mirrors FrameImpl.apply's version policy (policy A): stale writes drop,
  const write = (store, version, records) => {
    if (store.version !== undefined && version < store.version) return false;
    if (store.version === undefined || version > store.version) {
      store.version = version;
      store.records = {};
    }
    // Root assets reuse one key for the shell and late chunks.
    const assets = records["seg::assets"];
    const previous = assets && store.records["seg::assets"];
    if (!previous || previous === assets) {
      Object.assign(store.records, records);
    } else {
      for (const name in assets) {
        const values = assets[name];
        if (Array.isArray(values)) {
          previous[name] ? previous[name].push(...values) : (previous[name] = values);
        }
      }
    }
    return true;
  };
  /** Settle the record's `{$ref}` args into client values through the */
  const settleArgs = (store, recordKey, record, chunk) => {
    const args = record.args;
    const out = {};
    let regions, decoded;
    const settle = () => {
      if (!--record.pending && store.records[recordKey] === record)
        applyTo(chunk.id, store.version, { [recordKey]: record });
    };
    for (const key in args) {
      const value = args[key];
      if (value && typeof value.$ref === "string") {
        const resolved = (out[key] =
          options.resolve && options.resolve(value, chunk.id, chunk.version, store.version));
        (decoded ??= {})[key] = true;
        // `instanceof` before the mark: a decoded value may be a live
        if (resolved instanceof Promise && resolved.s === 0) {
          record.pending = (record.pending || 0) + 1;
          resolved.c.push(settle);
        }
      } else {
        if (value && typeof value.$frame === "string") (regions ??= {})[key] = value.$frame;
        out[key] = value;
      }
    }
    record.args = out;
    record.regions = regions;
    record.decoded = decoded;
  };
  return {
    register(id, frame) {
      let set = frames.get(id);
      if (!set) frames.set(id, (set = new Set()));
      set.add(frame);
      const store = stores.get(id);
      if (store && store.version !== undefined) {
        // ONE apply for the whole seed: per-record applies flush (and sync
        if (!store.open) frame.apply({ version: store.version, r: store.records });
        else if (store.shown) frame.apply({ version: store.shownVersion, r: store.shown });
      }
    },
    /** Remove a frame (or, with no frame argument, every frame) under an id. */
    unregister(id, frame) {
      const set = frames.get(id);
      if (set && frame) set.delete(frame);
      if (!set || !frame || !set.size) {
        frames.delete(id);
        // A document-adopted boundary's content never rode chunks (it was
        if (frame && frame.contentHTML) {
          const store = storeFor(id);
          if (!store.records[""]) {
            const html = frame.contentHTML();
            if (html != null) {
              store.records[""] = { kind: "html", value: html };
              if (store.version === undefined) store.version = 0;
              // The capture is the document's landing (version 0): what a
              store.shown = store.records;
              store.shownVersion = store.version;
            }
          }
        }
      }
      if (!frame) {
        stores.delete(id);
        landings.delete(id);
      }
    },
    apply(chunk) {
      // Data payloads are response-scoped: they go to the data hook, not
      if (chunk.type === "data") {
        const store = stores.get(chunk.id);
        const current = store && store.version;
        // (`n < undefined` is false: a store with no version yet, or a chunk
        if (store && chunk.version < current) return;
        options.applyData && options.applyData(chunk, current);
        return;
      }
      // Write through to the resident store first: the store version-guards
      const records = chunkToRecords(chunk);
      const store = storeFor(chunk.id);
      if (!write(store, chunk.version, records)) return;
      // The record's refs resolve through ITS response's data — the table
      if (chunk.type === "slot") {
        const key = `slot:${chunk.key}`;
        settleArgs(store, key, records[key], chunk);
      }
      // The producer cut a plain response at its streaming bound: what the
      if ("_SOLID_DEV_" && chunk.type === "complete" && chunk.bound) {
        console.warn(
          `Server component "${chunk.id}" kept streaming past the server's ${chunk.bound} ` +
            `bound and was cut off (complete.bound: "${chunk.bound}"); its content is the last ` +
            `value the server sent, not a settled one. A source meant to keep streaming is ` +
            `declared with live(): wrap the server function (live(fn)) so the client holds a ` +
            `standing connection instead.`
        );
      }
      let r = records;
      // The address as a source: `start` opens a flight; the write that
      if (chunk.type === "start") store.open = true;
      else if (lands(records)) {
        store.open = false;
        store.shown = r = store.records;
        store.shownVersion = chunk.version;
        const landed = landings.get(chunk.id);
        if (landed && !(":complete" in records && ":error" in r)) {
          landings.delete(chunk.id);
          ":error" in records ? landed.j(records[":error"]) : landed.r();
        }
      }
      applyTo(chunk.id, chunk.version, r);
      // The response's end: a key it never delivered never comes, and every
      if (":complete" in records || ":error" in records)
        options.closeData && options.closeData(chunk.id, chunk.version, records[":error"]);
    },
    landing(id) {
      const store = stores.get(id);
      // Nothing to wait for: nothing has begun for the address, or it has a
      if (!store || (!store.open && !store.shown)) return undefined;
      if (store.shown && !(":error" in store.shown)) return undefined;
      let wait = landings.get(id);
      if (!wait) {
        landings.set(id, (wait = {}));
        wait.p = new Promise((r, j) => ((wait.r = r), (wait.j = j)));
      }
      return wait.p;
    },
    preview(chunk) {
      if (chunk.type !== "slot") return;
      const set = frames.get(chunk.id);
      if (!set) return;
      const records = chunkToRecords(chunk);
      const key = `slot:${chunk.key}`;
      // Through the STAGED response's table (its version's): a key it has
      settleArgs(storeFor(chunk.id), key, records[key], chunk);
      for (const frame of set) frame.preview && frame.preview(records);
    },
    get(id) {
      const set = frames.get(id);
      return set && set.values().next().value;
    },
    serialize(value) {
      if (!options.serialize) throw new Error("host has no serializer");
      return options.serialize(value);
    },
    revive: options.revive,
    prepareData: options.prepareData
  };
}

/** The bubbling DOM event a frame dispatches from its parent element after */
export const FRAME_APPLIED_EVENT = "frame:applied";

// === Tiers (frames savings pass §2: the server-announced tier mechanism) ===
/** A frames-client tier's module, as its loader resolves it: its exports are */
export interface TierModule {
  install?(): void;
  [applier: string]: unknown;
}
export const tierLoaders: Record<string, () => Promise<TierModule>> = {};
// `name -> the load`, a promise stamped `r` with the MODULE once it has
/** @internal */
export const tierLoads: Record<string, Promise<void> & { r?: any }> = {};
// Every live frame, so an install can wake them all: a frame whose sync
const liveFrames = new Set();

/** Start (or join) a tier's load. @internal */
export function prepareTier(name: string): Promise<void> & { r?: any };

export function prepareTier(name) {
  let load = tierLoads[name];
  if (!load) {
    const loader = tierLoaders[name];
    tierLoads[name] = load = loader
      ? loader().then(module => {
          // The install: the module is the resident stamp (its exports are
          load.r = module;
          module.install?.();
          for (const frame of liveFrames) frame.apply({ version: frame.version, r: {} });
        })
      : Promise.resolve();
  }
  return load;
}

/** Whether a tier's code is resident — eager (no loader: `true`), or */
const tierReady = name => !tierLoaders[name] || prepareTier(name).r;

// The regions tier's reason to wait (frames savings pass §1, "regions"; §3
const needsRegions = record => record.regions && !tierReady("regions");

// The traces tier's reason to hold (frames savings pass §1, "traces"): a
const carriesTrace = value =>
  value != null &&
  typeof value === "object" &&
  (value.$tr != null || Object.values(value).some(carriesTrace));
const needsTrace = args => !tierLoads.trace?.r && carriesTrace(args) && !tierReady("trace");

class FrameImpl {
  // A frame renders INTO an element: the boundary / region element is the
  #element;
  #options;
  // The frame this one is a region OF (`options.parent`, set by the regions
  #outer;
  #version;
  #store = Object.create(null);
  // The applied state is keyed by RECORD identity (frames-rulings 2.1,
  #appliedRoot;
  #appliedError;
  #hasContent = false;
  // The rest of the applied state, one map: store key -> the record this
  #appliedHoles = new Map();
  // The have-list (RFC 11 §9.5) — what this mount currently shows, by the
  #slots;
  #mountedSlots = new Set();
  #slotCleanups = new Map();
  #slotArgs = new Map();
  #slotUpdaters = new Map();
  // No region state here: a frame's nested server-content regions — the
  #hold;
  // Adopt path: the record an unmounted occurrence was first HELD with (for
  #heldRecords = new Map();
  #disposed = false;

  // Element-claim sweep for one materialized/morph-touched subtree, run
  #claimTree = (node, direct) => {
    const handlers = claimHandlers();
    if (!handlers) return;
    this.#scoped(() => (direct ? claimNode(handlers, node) : claimTree(handlers, node)));
  };

  /** Run `fn` under the creator's `ownerScope` (when provided). */
  #scoped(fn) {
    const scope = this.#options.ownerScope;
    return scope ? scope(fn) : fn();
  }

  constructor(element, options = {}) {
    this.#element = element;
    this.#options = options;
    this.#slots = options.slots;
    this.#outer = options.parent;
    // Enumerable for a tier's install (see `prepareTier`), until disposal.
    liveFrames.add(this);
    // Adopt: the boundary already holds server-rendered content, so the first
    if (options.adopt) {
      this.#hasContent = true;
      this.#claimContent();
    }
    // Register last, after all fields are initialized: registration may flush
    if (options.host && options.id !== undefined) {
      options.host.register(options.id, this);
    }
    // Hydration attach: an adopted document-SSR boot may never receive a
    if (options.adopt && this.#version === undefined) this.#syncSlots();
  }

  /** Server content landed: caller hook + the bubbling document notification. */
  #applied(version, reason) {
    this.#options.onApply?.({ version, reason });
    const parent = this.#element;
    // Construct from the element's own realm — a cross-realm CustomEvent
    const Ev = parent && (parent.ownerDocument || parent).defaultView?.CustomEvent;
    if (Ev) {
      parent.dispatchEvent(
        new Ev(FRAME_APPLIED_EVENT, {
          bubbles: true,
          detail: { id: this.#options.id, version, reason }
        })
      );
    }
  }

  get version() {
    return this.#version;
  }

  get store() {
    return this.#store;
  }

  /** The stream's error record, if an `error` chunk arrived (else undefined). */
  get error() {
    return this.#store[":error"];
  }

  apply(write) {
    if (this.#disposed) return;
    const v = write.version;
    if (this.#version === undefined) {
      this.#version = v;
    } else if (v < this.#version) {
      // Stale write for an older invocation: no live store to land in.
      return;
    } else if (v > this.#version) {
      // Policy A: version only guards against stale (older) writes.
      this.#version = v;
      this.#resetStreamState();
    }

    for (const key in write.r) this.#store[key] = write.r[key];
    this.#flush();
  }

  /** The reactive half of a staged response (see FrameHost.preview): each */
  preview(records, inherited?) {
    const adopted = new Set<string>();
    if (this.#disposed) return adopted;
    const R = tierLoads.regions?.r;
    for (const key in records) {
      const record = records[key];
      if (!record || record.kind !== "slot" || !key.startsWith("slot:")) continue;
      if (inherited && key in this.#store) continue;
      const occurrence = key.slice(5);
      const update = this.#mountedSlots.has(occurrence) && this.#slotUpdaters.get(occurrence);
      // A record that adds a region to the occurrence or renames one of its
      if (!update || (R ? R.changed(this, occurrence, record) : record.regions)) continue;
      this.#slotArgs.set(occurrence, record);
      adopted.add(key);
      update(this.#resolveArgs(occurrence, record));
    }
    if (R)
      for (const frame of R.frames(this))
        for (const key of frame.preview(records, true)) adopted.add(key);
    if (!inherited) for (const key of adopted) this.#store[key] = records[key];
    return adopted;
  }

  /** The applied state is one version's (frames-rulings 2.1): the version */
  #resetStreamState() {
    this.#store = Object.create(null);
    this.#appliedRoot = this.#appliedError = undefined;
    this.#appliedHoles.clear();
  }

  #flush() {
    if (this.#disposed) return;
    const version = this.#version;

    const root = this.#store[""];
    if (root && root.kind === "html" && root !== this.#appliedRoot) {
      const reason = this.#hasContent ? "morph" : "materialize";
      this.#applyRoot(root.value);
      this.#appliedRoot = root;
      // The root resets the ledger: everything shown is now this root.
      this.#recordHave("", root);
      this.#applied(version, reason);
    }

    // An error record is an APPLY too: a consumer gating on first apply (a
    const error = this.#store[":error"];
    if (error && error !== this.#appliedError) {
      this.#appliedError = error;
      this.#applied(version, "error");
    }

    // Asset records (`seg:<k>:assets`, the root's `seg::assets`): module
    for (const key in this.#store) {
      const record = this.#store[key];
      if (!key.endsWith(":assets") || !record || this.#appliedHoles.get(key) === record) continue;
      const tier = tierReady("assets");
      if (!tier) break;
      this.#appliedHoles.set(key, record);
      tier.apply(record);
    }

    // Segments: every content record the store holds whose placeholder is
    this.#revealSegments();

    // Live-hole records, one pass: range morphs (`hole:`), element attr
    let morphed = false;
    for (const key in this.#store) {
      const record = this.#store[key];
      if (!record || this.#appliedHoles.get(key) === record) continue;
      if (key.startsWith("hole:")) {
        if (key.endsWith(":error")) {
          this.#appliedHoles.set(key, record);
          if ("_SOLID_DEV_")
            console.error(`Live hole ${key.slice(5, -6)} failed on the server; latched:`, record);
        } else if (this.#applyHole(key.slice(5), record.value)) {
          this.#appliedHoles.set(key, record);
          this.#recordHave(key.slice(5), record);
          morphed = true;
        }
      } else if (key.startsWith("attr:")) {
        if (this.#applyAttrs(key.slice(5), record.value, record.removed)) {
          this.#appliedHoles.set(key, record);
          this.#recordHave("lha:" + key.slice(5), record);
          morphed = true;
        }
      }
    }
    if (morphed) this.#applied(version, "morph");

    this.#syncSlots();
  }

  /** Resolve a slot callback by prop: this frame's slots, then ancestors'. */
  #resolveSlot(prop) {
    return this.#slots?.[prop] ?? (this.#outer && this.#outer.#resolveSlot(prop));
  }

  /** Resolve a slot occurrence's args record: this frame's store, then */
  #resolveSlotRecord(occurrence) {
    const record = this.#store[`slot:${occurrence}`];
    if (record !== undefined) return record;
    return this.#outer && this.#outer.#resolveSlotRecord(occurrence);
  }

  /** Delete an occurrence's args record from the store that OWNS it. */
  #removeSlotRecord(occurrence) {
    const key = `slot:${occurrence}`;
    if (key in this.#store) {
      if (!this.#mountedSlots.has(occurrence)) delete this.#store[key];
    } else this.#outer && this.#outer.#removeSlotRecord(occurrence);
  }

  // `root`, when given, scopes discovery to a detached fragment instead of the
  #syncSlots(root) {
    if (!this.#slots && !this.#outer) return;

    // Range-driven discovery: find every server-owned slot occurrence in this
    const found: Map<any, any> & { b?: boolean } = new Map();
    if (root) collectSlots(root.firstChild, null, found, found);
    else this.#collectSlots(found, found);
    // Whether this sync leaves an occurrence WAITING to mount — for its
    let waiting = false;
    // The regions and bind tiers' appliers, if resident (an install cannot
    const R = tierLoads.regions?.r;
    const B = tierLoads.bind?.r;

    for (const [occurrence, start] of found) {
      const callback = this.#resolveSlot(propOf(occurrence));
      const consumers = Array.isArray(start) ? start : null;
      if (!callback) {
        // No client impl for this prop up the tree.
        if ("_SOLID_DEV_" && consumers) devSlotOrphan(this, occurrence, consumers, "fill");
        continue;
      }
      const record = this.#resolveSlotRecord(occurrence);
      // A mounted occurrence is one this frame invoked and has not unmounted;
      const mounted = this.#mountedSlots.has(occurrence);
      // The occurrence's name decides its class: the producer mints every
      if (record === undefined && isCalled(occurrence)) {
        waiting ||= !mounted;
        if ("_SOLID_DEV_" && consumers && !mounted && !this.#options.adopt)
          devSlotOrphan(this, occurrence, consumers, "record");
        continue;
      }
      // A record's args are client values by the time it is here: the host
      if (
        !mounted &&
        record &&
        (record.pending || needsRegions(record) || needsTrace(record.args))
      ) {
        waiting = true;
        // Remember what the adopted interior was rendered from.
        if (this.#options.adopt && !consumers)
          this.#heldRecords.has(occurrence) || this.#heldRecords.set(occurrence, record);
        continue;
      }
      if (!mounted) {
        // Direct-insert occurrences have no `slot:<id>` record and mount with
        const held = this.#heldRecords.get(occurrence);
        this.#heldRecords.delete(occurrence);
        const mountRecord = held || record;
        this.#invokeSlot(occurrence, callback, mountRecord, start, this.#options.adopt);
        // A data occurrence's consumer set is handed to the tier (`sync`),
        if (consumers) B.sync(this, occurrence, consumers);
        this.#mountedSlots.add(occurrence);
        // Bind the occurrence's regions (the tier): a frame over each region
        R?.bind(this, occurrence);
        if (mountRecord === record || !record || record.kind !== "slot") continue;
      }
      // A mounted data occurrence whose CONSUMERS changed — a morph replaced
      if (consumers) B.sync(this, occurrence, consumers);
      if (record !== this.#slotArgs.get(occurrence)) {
        // A new record that names a region while the regions tier is absent
        if (needsRegions(record) || needsTrace(record.args)) continue;
        // A re-sent record, live binding (the mount registered
        const update = this.#slotUpdaters.get(occurrence);
        if (update) {
          // One record shape (A5): every transport's record carries ALL of
          const props = this.#resolveArgs(occurrence, record);
          this.#slotArgs.set(occurrence, record);
          update(props);
          R?.bind(this, occurrence);
          continue;
        }
        // Args changed (incl.
        this.#invokeSlot(occurrence, callback, record, start);
        R?.bind(this, occurrence);
      }
    }

    // The bind tier's wait (frames savings pass §1, "bind"; §3 row C6): the
    if (found.b && !tierReady("bind")) waiting = true;

    // Unmount occurrences whose range has disappeared from the server content
    if (!root) {
      for (const occurrence of [...this.#mountedSlots]) {
        if (!found.has(occurrence)) this.#unmountSlot(occurrence);
      }
      // The frame's hold (frames-rulings 3.2): ONE registration with the
      if (waiting && !this.#hold) this.#hold = this.#options.hold?.();
      else if (!waiting && this.#hold) this.#releaseHold();
    }
  }

  #releaseHold() {
    const release = this.#hold;
    this.#hold = undefined;
    release && release();
  }

  /** Invoke a slot occurrence's callback with resolved props. */
  #invokeSlot(occurrence, callback, record, start, adopted) {
    // A (re-)call replaces the occurrence's binding wholesale: drop the old
    this.#slotUpdaters.delete(occurrence);
    const cleanups = this.#slotCleanups.get(occurrence) ?? [];
    // One walk yields both the interior and the end marker.
    let existing = [];
    let end = null;
    // A data occurrence's node is its consumer list: no interior to collect,
    const positions = Array.isArray(start) ? start : undefined;
    if (start && !positions) end = eachInRange(start, occurrence, n => existing.push(n));
    const ctx = {
      // Identity for hydration-claim scoping: consumers derive the same
      frame: this.#options.claimScope ?? this.#options.id,
      key: occurrence,
      // True ONLY for the hydration-attach sync of an adopted document
      adopted: !!adopted,
      // Whether this occurrence is a render-prop CALL (the producer placed
      invoked: !!(record && record.kind === "slot"),
      onCleanup: fn => cleanups.push(fn),
      // Live-props opt-in: a binding that registers here receives re-resolved
      onUpdate: fn => this.#slotUpdaters.set(occurrence, fn),
      existing,
      // The range's own markers, when it has them: the fill places or binds
      range: end ? { start, end } : undefined,
      // Binding slot (§9.2.3): the positions of server markup that read this
      positions,
      onRebind: positions ? fn => tierLoads.bind.r.rebinder(this, occurrence, fn) : undefined
    };
    // One record shape (A5): the t=0 record carries used regions as
    const props =
      record && record.kind === "slot" ? this.#resolveArgs(occurrence, record, adopted, start) : {};
    // Run under the boundary's owner (when the creator provided one): slot
    this.#scoped(() => callback(props, ctx));
    this.#slotArgs.set(occurrence, record);
    if (cleanups.length) this.#slotCleanups.set(occurrence, cleanups);
  }

  #unmountSlot(key) {
    this.#mountedSlots.delete(key);
    // Long-session hygiene: an occurrence gone from the stream releases its
    this.#slotArgs.delete(key);
    this.#slotUpdaters.delete(key);
    this.#heldRecords.delete(key);
    this.#removeSlotRecord(key);
    this.#runSlotCleanups(key);
    // The occurrence's regions (the tier's): their frames dispose, the
    tierLoads.regions?.r?.unmount(this, key);
    tierLoads.bind?.r?.unmount(this, key);
  }

  #runSlotCleanups(key) {
    const cleanups = this.#slotCleanups.get(key);
    if (!cleanups) return;
    this.#slotCleanups.delete(key);
    for (const fn of cleanups) fn();
  }

  /** The frame's options, for the regions tier: a nested region frame @internal */
  get options() {
    return this.#options;
  }

  /** Resolve a slot record's args into client-facing props. */
  #resolveArgs(slotKey, record, claiming, start) {
    const { args, regions, decoded } = record;
    const revive = this.#options.host && this.#options.host.revive;
    const props = {};
    for (const key in args) {
      if (regions && key in regions) continue;
      const value = args[key];
      props[key] = revive && !(decoded && key in decoded) ? revive(value, claiming) : value;
    }
    if (regions) tierLoads.regions.r.resolve(this, slotKey, regions, props, claiming && start);
    return props;
  }

  /** Collect this frame's own top-level slot ranges (bounded to its content), */
  #collectSlots(found, elements) {
    collectSlots(this.#element.firstChild, null, found, elements);
  }

  /** The `pl-<name>` template in `root` (a segment's content being */
  #findPlaceholder(name, root) {
    return findPlaceholder((root || this.#element).firstChild, null, placeholderId(name));
  }

  /** For the host's last-unmount capture (see host.unregister): an element */
  contentHTML() {
    if (this.#disposed || !this.#hasContent) return null;
    return this.#element.innerHTML;
  }

  /** Re-bind this live mount's pull to a different address's store — the */
  rebind(id) {
    if (this.#disposed || id === this.#options.id) return;
    const { host, id: oldId } = this.#options;
    if (host && oldId !== undefined) host.unregister(oldId, this);
    // Copy-on-rebind: the options object belongs to the creator.
    this.#options = { ...this.#options, id };
    if (this.#element && this.#element.nodeType === ELEMENT_NODE) {
      this.#element.setAttribute(FRAME_ID_ATTR, id);
    }
    this.#version = undefined;
    // The applied state leaves with the old address (see #resetStreamState):
    this.#resetStreamState();
    if (host) host.register(id, this);
  }

  /** Ledger upkeep for an applied content record — the live wire tier's */
  #recordHave(key, record) {
    tierLoads.wire?.r?.have(this, key, record);
  }

  dispose() {
    if (this.#disposed) return;
    // Unregister FIRST: a last-unmount may capture this boundary's interior
    const { host, id } = this.#options;
    if (host && id !== undefined) host.unregister(id, this);
    this.#disposed = true;
    liveFrames.delete(this);
    this.#releaseHold();
    for (const key of [...this.#slotCleanups.keys()]) this.#runSlotCleanups(key);
    // Release this frame's occurrences' records from the store that owns them
    for (const key of this.#mountedSlots) this.#removeSlotRecord(key);
    // Every region bound under this frame disposes with it (the tier's).
    tierLoads.regions?.r?.unmount(this);
    this.#mountedSlots.clear();
  }

  #applyRoot(html) {
    const fragment = parseFragment(html);
    const parent = this.#element;
    if (!this.#hasContent) {
      parent.textContent = "";
      // Claim before insertion empties the fragment — matching compiled
      this.#claimTree(fragment);
      parent.appendChild(fragment);
      this.#hasContent = true;
    } else {
      // #claimTree self-gates on registered nav-claim handlers, so it
      const claim = this.#claimTree;
      // Frame-wide displaced-range index.
      const ranges = new Map();
      this.#collectSlots(ranges);
      // Identity-first (DR-5): the reconcile resolves every incoming marker
      const grafts = [];
      reconcileChildren(parent, fragment, null, null, claim, ranges, grafts);
      if (ranges.size) for (const root of grafts) flushGrafts(root, ranges);
    }
  }

  /** Morph a live hole's marked range (`<!--lh:N-->…<!--lh:/N-->`, marker = */
  #applyHole(marker, html) {
    if (!this.#hasContent) return false;
    const open = findLiveTarget(
      this.#element.firstChild,
      null,
      n => n.nodeType === COMMENT_NODE && n.data === marker
    );
    if (!open) return false;
    const close = rangeClose(open, "lh:/" + marker.slice(3));
    if (!close) {
      if ("_SOLID_DEV_") {
        console.error(
          `Live hole "${marker}" is missing its closing comment; update dropped. ` +
            `Likely an HTML-rewriting layer stripped it.`,
          open
        );
      }
      return false;
    }
    reconcileChildren(open.parentNode, parseFragment(html), open, close, this.#claimTree);
    return true;
  }

  /** Apply a live attr-hole re-emission: find the element addressed */
  #applyAttrs(addr, text, removed) {
    if (!this.#hasContent) return false;
    const el = findLiveTarget(
      this.#element.firstChild,
      null,
      n => n.nodeType === ELEMENT_NODE && n.getAttribute("data-lha") === addr
    );
    if (!el) return false;
    const parsed = parseFragment(`<i${text}></i>`).firstChild;
    const keepOpen = preservesOpen(el);
    // Binding-slot positions the rebuilt text marks stay the client's, as in
    const owned = parsed ? ownedPositions(parsed) : null;
    const current = el.attributes;
    for (let i = current.length - 1; i >= 0; i--) {
      const name = current[i].name;
      if (name === "data-lha" || (keepOpen && name === "open")) continue;
      if (!parsed || !parsed.hasAttribute(name)) {
        if (applyOwned(el, name, "", owned) !== undefined) continue;
        el.removeAttribute(name);
      }
    }
    if (parsed) {
      for (let i = 0; i < parsed.attributes.length; i++) {
        const { name, value } = parsed.attributes[i];
        if (keepOpen && name === "open") continue;
        if (applyOwned(el, name, value, owned) !== undefined) continue;
        if (el.getAttribute(name) !== value) el.setAttribute(name, value);
      }
    }
    if (removed)
      for (const name of removed) {
        if (keepOpen && name === "open") continue;
        if (applyOwned(el, name, "", owned) !== undefined) continue;
        el.removeAttribute(name);
      }
    return true;
  }

  /** Sweep-claim the frame's existing content (the adoption path). */
  #claimContent() {
    for (let n = this.#element.firstChild; n; n = n.nextSibling) this.#claimTree(n);
  }

  /** Apply the store's segment records against a range: reveal every */
  #revealSegments(root) {
    const version = this.#version;
    for (const key in this.#store) {
      const record = this.#store[key];
      const name = segmentName(key);
      if (name === null || !record || this.#appliedHoles.get(key) === record) continue;
      if (this.#segmentReady(name, root)) {
        this.#appliedHoles.set(key, record);
        this.#revealSegment(name, root);
        this.#applied(version, "reveal");
      }
    }
    for (const key in this.#store) {
      const m = /^seg:([^:]+):fallback$/.exec(key);
      if (!m || this.#appliedHoles.has(key) || this.#appliedHoles.has(`seg:${m[1]}`)) continue;
      if (this.#showFallback(m[1], root)) {
        this.#appliedHoles.set(key, this.#store[key]);
        this.#applied(version, "reveal");
      }
    }
  }

  #segmentReady(name, root) {
    const content = this.#store[`seg:${name}`];
    if (!content || content.kind !== "html") return false;
    // Reveal gate must be present and truthy.
    if (!this.#store[`seg:${name}:reveal`]) return false;
    // Style gate: the segment's streamed stylesheets must be loaded before it
    const assets = this.#store[`seg:${name}:assets`];
    if (
      assets &&
      (assets.styles || assets.inlineStyles) &&
      !tierReady("assets")?.gate(assets.styles || [], this)
    )
      return false;
    // Structural prerequisite: the placeholder must exist in the range.
    return !!this.#findPlaceholder(name, root);
  }

  /** Reveal a segment into its placeholder range ($df semantics): remove any */
  #revealSegment(name, root) {
    const tpl = this.#findPlaceholder(name, root);
    if (!tpl) return;
    // The segment's inline styles rode its assets record and landed in the
    const content = this.#store[`seg:${name}`];
    const closing = rangeClose(tpl, placeholderId(name));
    // A placeholder without its closing comment is not a range: nothing
    if (!closing) {
      if ("_SOLID_DEV_")
        console.error(
          `Frame fragment placeholder "${name}" is missing its closing comment ` +
            `(<!--${placeholderId(name)}-->); the segment is not revealed. Likely an ` +
            `HTML-rewriting layer stripped the comment, or invalid nesting split the ` +
            `placeholder range.`,
          tpl
        );
      return;
    }
    // Clear the current range interior (a materialized fallback, if #showFallback
    removeUntil(tpl.parentNode, tpl.nextSibling, closing);

    // Boundary-driven reveal (the ratified "per-`<Loading>`" model): the
    const fallbackFrag = tpl.content.cloneNode(true);
    this.#claimTree(fallbackFrag);
    (this.#options.reveal || revealAtOnce)({
      before: closing,
      fallback: [...fallbackFrag.childNodes],
      content: () => {
        const materialized = this.#materialize(content);
        this.#syncSlots(materialized);
        this.#claimTree(materialized);
        this.#revealSegments(materialized);
        return materialized;
      }
    });
    tpl.remove();
    this.#recordHave(name, content);
  }

  /** Materialize the placeholder template's own content into the range */
  #showFallback(name, root) {
    const tpl = this.#findPlaceholder(name, root);
    if (!tpl) return false;
    const closing = rangeClose(tpl, placeholderId(name));
    if (!closing) return false;
    const fallback = tpl.content.cloneNode(true);
    this.#claimTree(fallback);
    closing.parentNode.insertBefore(fallback, closing);
    return true;
  }

  /** Materialize a content record into nodes (HTML fragments — the v1 and */
  #materialize(record) {
    return record.kind === "html" ? parseFragment(record.value) : parseFragment("");
  }
} /**
 * A frame rendering into an EXISTING element boundary. Pass `adopt: true` for
 * the document-SSR path: the element already holds server-rendered content,
 * so the first apply morphs against it and slots sync immediately (hydration
 * attach), claiming their server-rendered DOM — a document boot needs no
 * chunk.
 * @experimental
 */
export function createFrame(boundary: Element, options?: FrameOptions): Frame;

export function createFrame(boundary, options) {
  return new FrameImpl(boundary, options);
}

// The boundary/region element vocabulary — the DOM contract the producer
export const FRAME_TAG = "solid-frame";
export const FRAME_ID_ATTR = "data-fid"; /**
 * Create a boundary/region ELEMENT and bind a host-registered frame to it.
 * The frame mounts INTO the element (server content is its children, morphed
 * in place). Because the boundary is a real node, `insert` places the
 * returned `element` in any position — single, array, or fragment — with no
 * special-casing. One frame per element; lifecycle belongs to the creator via
 * `dispose()` (register it with your owner's cleanup).
 * @experimental
 */
export function createFrameElement(options: FrameOptions): {
  readonly element: Element;
  readonly frame: Frame;
  dispose(): void;
};

/** Create a boundary/region element and bind a frame to it (element mode). */
export function createFrameElement(options) {
  const el = makeFrameElement(options.id);
  const frame = new FrameImpl(el, options);
  return {
    element: el,
    frame,
    dispose() {
      frame.dispose();
      el.remove();
    }
  };
}

/** Create a bare boundary/region element (no frame bound yet). @internal */
export function makeFrameElement(id) {
  const el = document.createElement(FRAME_TAG);
  el.style.display = "contents";
  if (id !== undefined) el.setAttribute(FRAME_ID_ATTR, id);
  return el;
}

/** Whether `node` is a frame boundary/region element (carries our id attr). @internal */
export function isFrameElement(node) {
  return node.nodeType === ELEMENT_NODE && node.hasAttribute(FRAME_ID_ATTR);
}

/** Returns the segment name for a `seg:<name>` content key, else `null`. */
function segmentName(key) {
  const m = /^seg:([^:]+)$/.exec(key);
  return m ? m[1] : null;
}

/** The prop name for a slot occurrence id: `comment#0` -> `comment`, `x` -> `x`. */
function propOf(occurrence) {
  const hash = occurrence.indexOf("#");
  return hash === -1 ? occurrence : occurrence.slice(0, hash);
}

/** Whether an occurrence id names a render-prop CALL (`prop#n`, minted with */
function isCalled(occurrence) {
  return occurrence.indexOf("#") !== -1;
}

/** The default reveal seam (`FrameOptions.reveal` omitted): the segment's */
function revealAtOnce(seam) {
  seam.before.parentNode.insertBefore(seam.content(), seam.before);
  seam.before.remove();
}

/** Remove siblings from `n` (inclusive) up to `stop` (exclusive). */
function removeUntil(parent, n, stop) {
  while (n && n !== stop) {
    const next = n.nextSibling;
    parent.removeChild(n);
    n = next;
  }
}

/** Parse an HTML string into a document fragment, preserving comments. */
function parseFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

/** Whether `node` is the `<template id="pl-KEY">` placeholder start marker. */
function isPlaceholderStart(node, id) {
  return node.tagName === "TEMPLATE" && node.id === id;
}

/** The `<!--pl-KEY-->` comment closing a placeholder range, or null. */
function rangeClose(start, id) {
  let n = start.nextSibling;
  while (n) {
    if (n.nodeType === COMMENT_NODE && n.data === id) return n;
    n = n.nextSibling;
  }
  return null;
}

/** Depth-first search among the siblings `[n, end)` for a live-hole target — */
function findLiveTarget(n, end, test) {
  while (n && n !== end) {
    if (n.nodeType === ELEMENT_NODE) {
      const fid = isFrameElement(n) ? n.getAttribute(FRAME_ID_ATTR) : null;
      if (fid === null || fid.includes(".")) {
        if (test(n)) return n;
        const found = findLiveTarget(n.firstChild, null, test);
        if (found) return found;
      }
    } else if (test(n)) return n;
    n = n.nextSibling;
  }
  return null;
}

/** Depth-first search among the siblings `[n, end)` for a placeholder */
function findPlaceholder(n, end, id) {
  while (n && n !== end) {
    if (isPlaceholderStart(n, id)) return n;
    if (n.nodeType === ELEMENT_NODE) {
      const found = findPlaceholder(n.firstChild, null, id);
      if (found) return found;
    }
    n = n.nextSibling;
  }
  return null;
}

/** Collect slot ranges (`slot:<key>:start`) among the siblings `[n, end)` into */
function collectSlots(n, end, out, elements) {
  while (n && n !== end) {
    const id = slotStartId(n);
    if (id !== null) {
      if ("_SOLID_DEV_") devCheckRange(n, id);
      if (!out.has(id)) out.set(id, n);
      n = afterRange(n, id);
      continue;
    }
    // Binding-slot markers (`_s:*`), when the caller wants them — the slot
    if (elements !== undefined && isTextStart(n)) {
      const B = tierLoads.bind?.r;
      B ? B.text(n, elements) : (elements.b = true);
    }
    if (n.nodeType === ELEMENT_NODE && !isFrameElement(n)) {
      if (elements !== undefined && n.hasAttributes()) {
        const B = tierLoads.bind?.r;
        B ? B.positions(n, elements) : hasSlotMarker(n) && (elements.b = true);
      }
      collectSlots(n.firstChild, null, out, elements);
    }
    n = n.nextSibling;
  }
}

/** Walk a slot range's interior — every node between `start` and the range's @internal */
export function eachInRange(start, key, cb) {
  const end = slotEnd(key);
  let n = start.nextSibling;
  while (n && !(n.nodeType === COMMENT_NODE && n.data === end)) {
    const next = n.nextSibling;
    cb(n);
    n = next;
  }
  return n;
}

// --- Morph -----------------------------------------------------------------

/** If `node` is a `slot:<id>:start` comment, return its id; else `null`. */
function slotStartId(node) {
  if (node.nodeType !== COMMENT_NODE) return null;
  const m = SLOT_START.exec(node.data);
  return m ? m[1] : null;
}

/** Whether `node` is any slot marker (start or end). */
function isSlotMarker(node) {
  if (node.nodeType !== COMMENT_NODE) return false;
  const data = node.data;
  return SLOT_START.test(data) || SLOT_END.test(data);
}

// Identity-first at the element level (DR-5's last rung): server markup can
function compatible(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === ELEMENT_NODE)
    return a.nodeName === b.nodeName && a.getAttribute("_key") === b.getAttribute("_key");
  return a.nodeType === TEXT_NODE || a.nodeType === COMMENT_NODE;
}

// Live-state the server can't know: `open` on <details>/<dialog> IS the
function preservesOpen(el) {
  const t = el.tagName;
  return t === "DETAILS" || t === "DIALOG";
}

// Binding-slot ownership (principles §9.2.3).
/** The incoming element's owned positions, or null (none, or the tier */
const ownedPositions = el => {
  const B = tierLoads.bind?.r;
  return B ? B.owned(el) : null;
};
/** Apply the server's value for `name` (null: absent) to an element with */
const applyOwned = (oldEl, name, value, owned) =>
  owned === null ? undefined : tierLoads.bind.r.apply(oldEl, name, value, owned);

function morphAttributes(oldEl, newEl, claim) {
  let reclaim = false;
  let changed = false;
  const keepOpen = preservesOpen(oldEl);
  const owned = ownedPositions(newEl);
  const oldAttrs = oldEl.attributes;
  for (let i = oldAttrs.length - 1; i >= 0; i--) {
    const name = oldAttrs[i].name;
    if (keepOpen && name === "open") continue;
    if (!newEl.hasAttribute(name)) {
      const handled = applyOwned(oldEl, name, "", owned);
      if (handled !== undefined) {
        changed = handled || changed;
        continue;
      }
      oldEl.removeAttribute(name);
      changed = true;
      reclaim ||= claimedAttr(name);
    }
  }
  const newAttrs = newEl.attributes;
  for (let i = 0; i < newAttrs.length; i++) {
    const attr = newAttrs[i];
    const name = attr.name;
    if (keepOpen && name === "open") continue;
    const handled = applyOwned(oldEl, name, attr.value, owned);
    if (handled !== undefined) {
      changed = handled || changed;
      continue;
    }
    if (oldEl.getAttribute(name) !== attr.value) {
      oldEl.setAttribute(name, attr.value);
      changed = true;
      reclaim ||= claimedAttr(name);
    }
  }
  // The morph is the only write path for server-owned elements, and it makes
  if (claim && (reclaim || (changed && oldEl.matches(CLAIMED_ELEMENTS)))) claim(oldEl, true);
}

/** Morph `oldNode` in place to match `newNode` (assumed `compatible`). */
function morphNode(oldNode, newNode, claim, ranges, grafts) {
  if (oldNode.nodeType === ELEMENT_NODE) {
    // Escape hatch (the claim contract's analogue): an element the author
    if (oldNode.hasAttribute("data-preserve")) return;
    morphAttributes(oldNode, newNode, claim);
    reconcileChildren(oldNode, newNode, null, null, claim, ranges, grafts);
  } else if (oldNode.data !== newNode.data) {
    oldNode.data = newNode.data;
  }
}

/** The sibling immediately after the `slot:<id>:end` marker for `start`. */
const afterRange = (start, id) => afterMarker(start, slotEnd(id));
/** The sibling after a text position's end marker. */
const afterText = start => afterMarker(start, SLOT_TEXT_END);

/** The sibling immediately after the first `end` comment following `start` */
function afterMarker(start, end) {
  let n = start.nextSibling;
  while (n) {
    if (n.nodeType === COMMENT_NODE && n.data === end) return n.nextSibling;
    n = n.nextSibling;
  }
  return null;
}

/** Dev: a binding-slot occurrence's marked positions cannot bind — no */
let slotOrphans;
function devSlotOrphan(frame, occurrence, consumers, why) {
  if (!"_SOLID_DEV_") return;
  let seen = (slotOrphans ??= new WeakMap()).get(frame);
  if (!seen) slotOrphans.set(frame, (seen = new Set()));
  if (seen.has(occurrence)) return;
  seen.add(occurrence);
  const prop = propOf(occurrence);
  const positions = new Set();
  for (const c of consumers) for (const p of c.positions) positions.add(p.pos);
  const where = `${consumers.length} element${consumers.length === 1 ? "" : "s"} (positions: ${[...positions].join(", ")})`;
  DEV.report(
    OBSERVE.diagnostics.emit(
      {
        code: "BINDING_SLOT_POSITION",
        kind: "render",
        severity: "warn",
        message:
          why === "fill"
            ? `[BINDING_SLOT_POSITION] Server markup binds \`${occurrence}\` at ${where}, but no client fill ` +
              `resolves for slot \`${prop}\` — those positions never bind and the elements are inert. ` +
              `Pass \`${prop}\` to the server component on the client (a function returning the object the ` +
              `markup reads), or check that the prop name matches on both sides.`
            : `[BINDING_SLOT_POSITION] Server markup binds \`${occurrence}\` at ${where}, but no args record ` +
              `for it arrived and none can — the fill mounts with empty args. A called slot always emits its ` +
              `record ahead of the markup that reads it, so this is the frame protocol out of step, not the fill: ` +
              `a client and server from different builds (a stale dev prebundle, a cached asset), or a runtime ` +
              `bug minting the marker and the record under different ids.`,
        data: { reason: "orphan", why, occurrence, elements: consumers.map(c => c.element) }
      },
      null
    )
  );
}

/** Dev-only range integrity check: a slot start marker whose end marker is not */
function devCheckRange(start, id) {
  if (!"_SOLID_DEV_") return;
  const end = slotEnd(id);
  let n = start.nextSibling;
  while (n) {
    if (n.nodeType === COMMENT_NODE && n.data === end) return;
    n = n.nextSibling;
  }
  // A finding on the one channel (`FRAME_MARKER_CORRUPTED`) and its console
  DEV.report(
    OBSERVE.diagnostics.emit(
      {
        code: "FRAME_MARKER_CORRUPTED",
        kind: "ssr",
        severity: "error",
        message:
          `[FRAME_MARKER_CORRUPTED] Frame slot range "${id}" is missing its end marker (<!--${end}-->) among its start ` +
          `marker's siblings. Slots after it in this content cannot be discovered. Likely causes: ` +
          `invalid HTML nesting split the range during parsing (e.g. a block element inside <p>), ` +
          `or an HTML-rewriting layer (CDN/minifier/translator) removed or moved the comment — ` +
          `serve frame documents with Cache-Control: no-transform.`,
        data: { slot: id, end }
      },
      null
    )
  );
}

/** Find a `slot:<id>:start` comment among siblings in `[from, bound)`. */
function findRangeStart(from, id, bound) {
  const target = `slot:${id}:start`;
  let n = from;
  while (n && n !== bound) {
    if (n.nodeType === COMMENT_NODE && n.data === target) return n;
    n = n.nextSibling;
  }
  return null;
}

/** Move the range `[start .. slot:<id>:end]` to before `ref` within `parent`. */
function moveRangeBefore(parent, start, id, ref) {
  const end = slotEnd(id);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    parent.insertBefore(n, ref);
    if (isEnd) break;
    n = next;
  }
}

/** Place a live range — a stashed fragment or an attached start marker — */
function placeRange(parent, range, id, ref) {
  if (range.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE: stashed range */) {
    parent.insertBefore(range, ref);
  } else {
    moveRangeBefore(parent, range, id, ref);
  }
}

/** Move an incoming slot range from the source into `parent` before */
function adoptRange(parent, start, id, ref, claim) {
  const end = slotEnd(id);
  let n = start;
  let after = null;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    parent.insertBefore(n, ref);
    // Fresh server-sent placeholder content: claim indiscriminately (the
    if (claim) claim(n);
    if (isEnd) {
      after = next;
      break;
    }
    n = next;
  }
  return after;
}

/** Reconcile the children of `parent` toward the children of `source`, reusing */
function reconcileChildren(
  parent,
  source,
  boundStart = null,
  boundEnd = null,
  claim = null,
  ranges = null,
  grafts = null
) {
  let oldChild = boundStart ? boundStart.nextSibling : parent.firstChild;
  let newChild = source.firstChild;

  while (newChild) {
    const nextNew = newChild.nextSibling;
    const pid = slotStartId(newChild);
    // Treat reaching the upper bound as "no more old nodes".
    const old = oldChild === boundEnd ? null : oldChild;

    if (
      old &&
      isTextStart(newChild) &&
      old.nodeType === COMMENT_NODE &&
      old.data === newChild.data
    ) {
      // The same binding-slot text position: its interior is the client's
      oldChild = afterText(old);
      newChild = afterText(newChild);
      continue;
    }
    if (pid !== null) {
      if (old && slotStartId(old) === pid) {
        // Same slot already here: preserve its live interior untouched
        oldChild = afterRange(old, pid);
        newChild = afterRange(newChild, pid);
      } else {
        // Prefer the frame-wide index (relocations from ANY parent — a
        const displaced = ranges && ranges.get(pid);
        const existing = displaced || findRangeStart(old, pid, boundEnd);
        if (existing) {
          if (ranges) ranges.delete(pid);
          // Relocate the existing client-owned range into position.
          placeRange(parent, existing, pid, old ?? boundEnd);
          newChild = afterRange(newChild, pid);
        } else {
          // New slot: adopt the server-sent placeholder range as-is.
          newChild = adoptRange(parent, newChild, pid, old ?? boundEnd, claim);
        }
      }
      continue;
    }

    if (!old) {
      parent.insertBefore(newChild, boundEnd);
      if (claim) claim(newChild);
      if (grafts) grafts.push(newChild);
      newChild = nextNew;
      continue;
    }
    if (isSlotMarker(old)) {
      // Old slot anchor: flow new server content in front of it without
      parent.insertBefore(newChild, old);
      if (claim) claim(newChild);
      if (grafts) grafts.push(newChild);
      newChild = nextNew;
      continue;
    }
    if (compatible(old, newChild)) {
      morphNode(old, newChild, claim, ranges, grafts);
      oldChild = old.nextSibling;
      newChild = nextNew;
      continue;
    }
    // Incompatible here — but a compatible element may sit further along:
    if (newChild.nodeType === 1) {
      let ahead = old.nextSibling;
      while (ahead && ahead !== boundEnd && !compatible(ahead, newChild)) {
        const aheadPid = slotStartId(ahead);
        ahead = aheadPid !== null ? afterRange(ahead, aheadPid) : ahead.nextSibling;
      }
      if (ahead && ahead !== boundEnd) {
        parent.insertBefore(ahead, old);
        morphNode(ahead, newChild, claim, ranges, grafts);
        newChild = nextNew;
        continue;
      }
    }
    // No match anywhere: place the new node and leave the old one for later
    parent.insertBefore(newChild, old);
    if (claim) claim(newChild);
    if (grafts) grafts.push(newChild);
    newChild = nextNew;
  }

  while (oldChild && oldChild !== boundEnd) {
    const next = oldChild.nextSibling;
    // A leftover range still in the index hasn't been matched YET — its new
    const pid = ranges ? slotStartId(oldChild) : null;
    if (pid !== null && ranges.get(pid) === oldChild) {
      const frag = document.createDocumentFragment();
      const after = stashRange(frag, oldChild, pid);
      ranges.set(pid, frag);
      oldChild = after;
      continue;
    }
    parent.removeChild(oldChild);
    oldChild = next;
  }
}

/** Identity-first grafting (DR-5): a wholesale-inserted source subtree (a */
function flushGrafts(node, ranges) {
  if (node.nodeType !== ELEMENT_NODE || isFrameElement(node)) return;
  let n = node.firstChild;
  while (n) {
    const id = slotStartId(n);
    if (id !== null) {
      const next = afterRange(n, id);
      const displaced = ranges.get(id);
      if (displaced) {
        ranges.delete(id);
        placeRange(node, displaced, id, n);
        // Detach the fresh (bare) marker pair the source shipped.
        stashRange(document.createDocumentFragment(), n, id);
      }
      n = next;
      continue;
    }
    flushGrafts(n, ranges);
    n = n.nextSibling;
  }
}

/** Detach the range `[start .. */
function stashRange(frag, start, id) {
  const end = slotEnd(id);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    frag.appendChild(n);
    if (isEnd) return next;
    n = next;
  }
  return null;
}
