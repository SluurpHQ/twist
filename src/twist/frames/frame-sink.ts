// Ported from Solid's frames/src/frame-sink.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
// @ts-nocheck
/** FrameSink — the frame-chunk side of the renderToStream emission seam. */
import { createOwner, createMemo, getOwner, runWithOwner, NoHydration, Hydration } from "../server-solid.ts";
import {
  sharedConfig,
  runInServerComponentScope,
  ssrHandleError,
  ssrSanitizeError,
  creationStamp,
  shareAsyncIterable
} from "../server-internal.ts";

// EXPERIMENTAL — the frames/server-components surface ships as an
import { FrameChunk } from "./frame-client.ts";

/** Addresses a frame stream: the boundary id and this response's version. */
export interface FrameAddress {
  id: string;
  version: number;
}

/** Options shared by the frame producers. */
export interface FrameStreamOptions {
  /** Boundary address; defaults to `{ id: "", version: 1 }`. */
  frame?: { id?: string; version?: number };
  /** The request's abort: tears the render down as a client disconnect would */
  signal?: AbortSignal;
  /** The call arrived at the live address — a `live` loop is reading */
  live?: boolean;
  /** The plain response's streaming bound, in later yields (frames savings */
  maxYields?: number;
  /** The plain response's streaming bound, in wall-clock milliseconds after */
  maxDurationMs?: number;
  /** A RESUME (RFC 11 §9.5): the have-list the reconnecting client sent — */
  resume?: { have: Record<string, string> };
  /** Remaining `renderToStream` options (plugins, onError, manifest, ...). */
  [key: string]: unknown;
}

/** A produced frame stream: pipe chunks, or await the collected array. */
export interface FrameStream extends PromiseLike<FrameChunk[]> {
  pipe(writable: { write(chunk: FrameChunk): void; end?(): void }): void;
}

const runWithHydrationScope = (id, fn) => runWithOwner(createOwner({ id }), fn);
const ssrAsyncValue = value => createMemo(() => value, { serialize: false });

// The reactive-scope creation stamp (same gate the live-holes engine uses,
const scopeStamp = typeof creationStamp === "function" ? creationStamp : () => 0;

/** Render server-owned output under NoHydration semantics (mimicking solid's */
function serverOwned(render) {
  return NoHydration
    ? NoHydration({
        get children() {
          return render();
        }
      })
    : render();
}

/** The server component's own render runs inside the core's context barrier */
function serverComponentScope(render, live = false) {
  return runInServerComponentScope
    ? runInServerComponentScope(render, live ? { live: true } : undefined)
    : render();
}

// The in-process `live` declaration's brand (a registered symbol, so
const LIVE_SOURCE = Symbol.for("solid.LiveSource");
import {
  renderToStream,
  createLiveHoles,
  CLAIMS_STREAM,
  CLAIMS_DOCUMENT,
  slotValue,
  isSlotValue,
  SLOT_VALUE,
  SLOT_FACE_STREAM,
  SLOT_FACE_DATA,
  SLOT_FACE_MARKUP
} from "../server.ts";
import { devCheck } from "../request.ts";
import { createJSONSerializer } from "../serialization.ts";
import { isContainerTraced, toBorderForm } from "./frame-container-plugin.ts";
import { DESCEND, rewriteTree } from "./tree-rewrite.ts";
import {
  ChunkReader,
  createChunk,
  createEventChunk,
  frameAddress,
  serializeStream,
  textDigest
} from "../server-functions/shared.ts";
import {
  armLiveBody,
  getEventServerFunctionInvocation,
  guardFailures
} from "../server-functions/server.ts";
import { isResponseEnvelope } from "../response.ts";
import { observeFrame } from "../observe.ts";
import {
  FRAME_HAVE_HEADER,
  FRAME_STREAM_HEADER,
  FRAME_TIERS_HEADER,
  decodeHaveList,
  SERVER_COMPONENT,
  SERVER_COMPONENT_ADDRESS,
  SERVER_COMPONENT_SOURCE,
  flightCodec,
  setServerComponentBootstrap
} from "./frame-transport.ts";

// The brands and the codec plugin live with the transport (the client half
export {
  SERVER_COMPONENT,
  SERVER_COMPONENT_SOURCE,
  SERVER_COMPONENT_ADDRESS,
  ServerComponentPlugin
} from "./frame-transport.ts";

function wirePreload(entry) {
  return entry.href ? { href: entry.href, attrs: entry.attrs } : { attrs: entry.attrs };
}

/** The client-side `_$SC` registry as an idempotent expression: evaluates to */
const SERVER_COMPONENT_BOOTSTRAP_EXPR =
  "(self._$SC||(self._$SC={c:{},a:{},b:{},r(i,a){var c=this.c[i]||(this.c[i]=(p,b)=>self._$SC.impl(i,p,b));" +
  "if(!a)return c;this.a[a]=i;this.reg&&this.reg(a,i);" +
  'return this.b[a]||(this.b[a]=Object.assign(p=>c(p,()=>a),{[Symbol.for("solid.component-binding")]:{component:c,address:a}}))}}))';

// Serializer contexts (one per emitted script — see seroval's
const bootstrappedScripts = new WeakSet();
setServerComponentBootstrap(ctx => {
  if (bootstrappedScripts.has(ctx)) return "self._$SC";
  bootstrappedScripts.add(ctx);
  return SERVER_COMPONENT_BOOTSTRAP_EXPR;
});

/** Statement form of the registry bootstrap, for a document shell that wants */
export const SERVER_COMPONENT_BOOTSTRAP = SERVER_COMPONENT_BOOTSTRAP_EXPR + ";"; /**
 * The emission surface `renderToStream` routes through when producing a
 * frame stream instead of a document (see the `sink` render option). Each
 * method emits transport-agnostic chunks; `emit` is the envelope boundary.
 * @internal Compiler/renderer wiring — use `renderToFrameStream` or
 * `renderServerComponent` instead.
 * @experimental
 */
export function createFrameSink(
  emit: (chunk: FrameChunk) => void,
  frame: FrameAddress,
  have?: Record<string, string>
): Record<string, (...args: any[]) => void>;

// ---- hole digests (Stage 8 B4) ----
const HOLE_RANGE = /<!--lh:(\d+)-->([\s\S]*?)<!--lh:\/\1-->/g;
const SLOT_RANGE = /<!--slot:([^>]*?):start-->[\s\S]*?<!--slot:\1:end-->/g;
const ATTR_ADDRESS = / data-lha="([^"]*)"/g;
// The hole's digest is over its marker-FREE html — the same baseline the
const stripHoleMarkers = html => html.replace(/<!--lh:\/?\d+-->/g, "");

/** The root's SKELETON: its html with every live-hole range and slot range */
export function frameSkeleton(html) {
  return html
    .replace(HOLE_RANGE, "<!--lh:$1--><!--lh:/$1-->")
    .replace(SLOT_RANGE, "<!--slot:$1:start--><!--slot:$1:end-->");
}

/** Digests of every live-hole range in `html` (nested included) and of every */
function holeDigests(html, attrText, into = {}) {
  for (const m of html.matchAll(HOLE_RANGE)) {
    into["lh:" + m[1]] = textDigest(stripHoleMarkers(m[2]));
    holeDigests(m[2], null, into);
  }
  if (attrText) {
    for (const m of html.matchAll(ATTR_ADDRESS)) {
      const key = "lha:" + m[1];
      const text = attrText.get(key);
      if (text !== undefined) into[key] = textDigest(text);
    }
  }
  return into;
}

/** Attach a `holes` map to a chunk when it names anything (wire hygiene). */
function withHoles(chunk, holes) {
  for (const _ in holes) {
    chunk.holes = holes;
    break;
  }
  return chunk;
}

/** A sink emitting the transport-agnostic FrameChunk stream. */
export function createFrameSink(write, frame, have, hooks) {
  const { id, version } = frame;
  // The tiers this render has minted (frames savings pass §2, the
  const tiers = new Set();
  let staged = [];
  // Every emission passes here, so a sweep knows whether it produced one,
  const emit = chunk => {
    if (swept) swept.emitted = true;
    if (staged.length) {
      chunk.tiers = staged;
      staged = [];
    }
    write(chunk);
  };
  const needs = name => {
    if (!tiers.has(name)) {
      tiers.add(name);
      staged.push(name);
    }
  };
  // Conditional emission (Stage 8 B4, RFC 11 §9.5 Server face 2).
  let conditional = false;
  const skipped = new Set();
  // Attr-hole baselines by key (`lha:N` → attribute text), registered by
  const attrText = new Map();
  // Emit what differs inside `html` against the have-list: each top-level
  const emitDiffering = html => {
    for (const m of html.matchAll(HOLE_RANGE)) {
      const key = "lh:" + m[1];
      const digest = textDigest(stripHoleMarkers(m[2]));
      if (have[key] === digest) continue;
      emit(
        withHoles({ type: "hole", id, version, key, html: m[2], digest }, holeDigests(m[2], null))
      );
    }
    // (Attr chunks are keyed by the bare address, as the engine emits them;
    for (const m of html.matchAll(ATTR_ADDRESS)) {
      const text = attrText.get("lha:" + m[1]);
      if (text === undefined) continue;
      const digest = textDigest(text);
      if (have["lha:" + m[1]] === digest) continue;
      emit({ type: "attr", id, version, key: m[1], attrs: text, digest });
    }
  };
  // Fragments that streamed styles ahead of a grouped reveal; the group's
  const styledKeys = new Set();
  // The binding ledger (DR-2 case 1): open bindings for re-runnable slot
  const bindings = new Map();
  const sweepMinted = new Set();
  const argRefVersions = new Map();
  let sweepScheduled = false;
  let closed = false;
  // The commit epoch: bumped once per sweep batch, exposed so the reactive
  let epoch = 0;
  // The sweep is one unit on the wire (C13, frames-rulings §"the server
  let swept = null;
  const sweep = () => {
    epoch++;
    const pass = (swept = { ops: [], emitted: false });
    try {
      for (const b of [...bindings.values()]) {
        try {
          b.sweep();
        } catch (_) {
          // A sweep failure (a serializer already closed at the end-of-response
        }
      }
      emitOps(pass.ops);
      // A pass that emitted is one visible commit — one "yield" to the
      if (pass.emitted && hooks && hooks.onYield) hooks.onYield();
    } finally {
      swept = null;
    }
  };
  // Members ride unaddressed (the envelope addresses them); a lone member
  const emitOps = ops => {
    if (ops.length === 1) emit(Object.assign({ type: ops[0].type, id, version }, ops[0]));
    else if (ops.length) emit({ type: "ops", id, version, ops });
  };
  const scheduleSweep = () => {
    if (closed || sweepScheduled || !bindings.size) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      if (!closed) sweep();
    });
  };
  // Fragment keys registered while a REGION (a `{$frame}` slot arg) resolves,
  const regionKeys = new Map();
  const frameOf = key => regionKeys.get(key) || id;
  return {
    // Tag a fragment key to the region resolving around its registration, so
    tagRegion(key, childId) {
      if (!regionKeys.has(key)) regionKeys.set(key, childId);
    },
    shell(html, meta = {}) {
      const digest = textDigest(frameSkeleton(html));
      // A resume whose structure the client already shows: no root, no
      if (have && have[""] === digest) {
        conditional = true;
        emitDiffering(html);
        return;
      }
      // Pre-flush assets (entry modules, hoisted boundary styles) are head
      if ((meta.preloads && meta.preloads.size) || meta.preloadLinks) {
        const chunk = { type: "assets", id, version, key: "" };
        if (meta.preloads && meta.preloads.size) {
          const styles = [];
          const modules = [];
          for (const url of meta.preloads) {
            (url.endsWith(".css") ? styles : modules).push(url);
          }
          if (styles.length) chunk.styles = styles;
          if (modules.length) chunk.modules = modules;
        }
        if (meta.preloadLinks) {
          chunk.preloads = [];
          for (const entry of meta.preloadLinks) {
            chunk.preloads.push(wirePreload(entry));
          }
        }
        needs("assets");
        emit(chunk);
      }
      emit(withHoles({ type: "html", id, version, html, digest }, holeDigests(html, attrText)));
    },
    data(record) {
      // Keyed codec record ({ key, node, initial }) from createJSONSerializer
      if (
        record &&
        typeof record.key === "string" &&
        (record.key.endsWith("_fr") || /^\d+$/.test(record.key))
      ) {
        return;
      }
      if (typeof record === "string") {
        emit({ type: "data", id, version, payload: record });
        scheduleSweep();
      } else {
        emit({
          type: "data",
          id,
          version,
          key: record.key,
          node: record.node,
          initial: record.initial
        });
        if (!sweepMinted.has(record.key)) scheduleSweep();
      }
    },
    fragment(key, value, meta = {}) {
      // meta.styles is the core's { links, inline } split: stylesheet URLs
      const fid = frameOf(key);
      // A resume, and the client shows this fragment revealed: the reveal
      if (conditional && fid === id && have[key] !== undefined) {
        skipped.add(key);
        scheduleSweep();
        // An errored re-render stands behind the content the client keeps;
        if (meta.error) {
          emit({
            type: "error",
            id: fid,
            version,
            key,
            error: { message: String((meta.error && meta.error.message) || meta.error) }
          });
        } else emitDiffering(value);
        return;
      }
      const links = (meta.styles && meta.styles.links) || [];
      const inline = (meta.styles && meta.styles.inline) || [];
      if (links.length || inline.length) {
        if (links.length) styledKeys.add(key);
        const chunk = { type: "assets", id: fid, version, key };
        // Link entries are urls or attributed gate entries; the wire form
        if (links.length) {
          chunk.styles = links.map(e =>
            typeof e === "string" ? e : e.attrs ? { href: e.href, attrs: e.attrs } : e.href
          );
        }
        if (inline.length) {
          chunk.inlineStyles = inline.map(e => ({ id: e.id, content: e.content, attrs: e.attrs }));
        }
        needs("assets");
        emit(chunk);
      }
      emit(
        withHoles(
          { type: "fragment", id: fid, version, key, html: value, digest: textDigest(value) },
          holeDigests(value, attrText)
        )
      );
      // A fragment resolving is a settlement: values its async work produced
      scheduleSweep();
      // A fragment that ERRORED still reveals (its html is the fallback /
      if (meta.error) {
        emit({
          type: "error",
          id: fid,
          version,
          key,
          error: { message: String((meta.error && meta.error.message) || meta.error) }
        });
      }
      // An eagerly-revealed fragment (no reveal group) carries its own
      if (!meta.revealGroup) {
        emit({ type: "reveal", id: fid, version, keys: [key], waitForStyles: !!links.length });
      }
    },
    reveal(keys, meta = {}) {
      // Keys in one reveal group can belong to different frames (a region's
      const byFrame = new Map();
      for (const key of keys) {
        // A resume never reveals over content the client shows — neither
        if (conditional && (skipped.has(key) || (meta.fallback && have[key] !== undefined)))
          continue;
        const fid = frameOf(key);
        let group = byFrame.get(fid);
        if (!group) byFrame.set(fid, (group = []));
        group.push(key);
      }
      for (const [fid, groupKeys] of byFrame) {
        let waitForStyles = false;
        for (const key of groupKeys) if (styledKeys.has(key)) waitForStyles = true;
        const chunk = { type: "reveal", id: fid, version, keys: groupKeys, waitForStyles };
        if (meta.fallback) chunk.fallback = true;
        emit(chunk);
      }
    },
    asset(type, value) {
      // Post-flush styles ride their fragment's assets chunk (fragment() gets
      if (type === "module") {
        needs("assets");
        emit({ type: "assets", id, version, key: "", modules: [value] });
      } else if (type === "preload") {
        needs("assets");
        emit({ type: "assets", id, version, key: "", preloads: [wirePreload(value)] });
      }
    },
    /** End the response: `complete`, with `bound` when the producer cut a */
    end(bound) {
      if (closed) return;
      // The end-of-response latch: one final synchronous sweep so a commit
      if (bindings.size && !swept) sweep();
      closed = true;
      const chunk = { type: "complete", id, version };
      if (bound) chunk.bound = bound;
      emit(chunk);
    },
    error(errorId, error) {
      emit({ type: "error", id, version, key: errorId, error });
    },
    // A named slot invocation from the slot props proxy: the client's
    slot(key, args) {
      emit({ type: "slot", id, version, key, args });
    },
    // A nested server-content region (a `{$frame}` slot arg): its html is a
    region(childId, html) {
      needs("regions");
      emit({ type: "html", id: childId, version, html });
    },
    // A live-hole re-emission (Stage 3): the hole's re-resolved HTML, keyed
    hole(key, html) {
      const op = { type: "hole", key, html, digest: textDigest(html) };
      swept ? swept.ops.push(op) : emitOps([op]);
    },
    // A live attr-hole re-emission: the addressed element's rebuilt
    attr(key, attrs, removed) {
      const op = { type: "attr", key, attrs, digest: textDigest(attrs) };
      if (removed && removed.length) op.removed = removed;
      swept ? swept.ops.push(op) : emitOps([op]);
    },
    // An attr hole's first-render text, keyed by its address — the digest
    attrBaseline(key, text) {
      attrText.set(key, text);
    },
    // ---- the binding ledger (DR-2 case 1) ----
    /** Open a watched-arg binding under its `(occurrence, arg)` key; it */
    openBinding(key, b) {
      bindings.set(key, b);
    },
    /** A real error is terminal for its binding — same as the retry loop. */
    closeBinding(key) {
      bindings.delete(key);
    },
    /** Exclude a sweep-minted data ref's flushes from the commit funnel. */
    mintRef(ref) {
      sweepMinted.add(ref);
    },
    /** Allocate the next versioned-ref number for an arg position. */
    nextArgRef(ledgerKey) {
      const n = (argRefVersions.get(ledgerKey) || 0) + 1;
      argRefVersions.set(ledgerKey, n);
      return n;
    },
    /** An out-of-band commit signal (a pending arg's retry settling). */
    commit: scheduleSweep,
    /** The current commit epoch (see the ledger comment above). */
    get epoch() {
      return epoch;
    },
    // ---- tiers (see `tiers` above) ----
    /** This render needs the named frames-client tier: announced on the */
    needs,
    /** The tiers minted so far, for the response head — every one the sync */
    announce() {
      staged = [];
      return [...tiers];
    }
  };
} /**
 * Render to a FrameChunk stream: the same render core as `renderToStream`
 * with emission swapped to the frame sink and the document writable replaced
 * by a chunk envelope (`start` up front, `complete` at stream end). Data
 * records default to the keyed JSON codec (decode with
 * `createJSONDataTable`).
 * @experimental
 */
export function renderToFrameStream(code: () => unknown, options?: FrameStreamOptions): FrameStream;

/** Render to a FrameChunk stream: the same render core as `renderToStream`, */
export function renderToFrameStream(code, options = {}) {
  return frameStream(() => code, options);
} /**
 * Render a **server component** — a `props => JSX` function, typically
 * returned from a server function — to a FrameChunk stream. `props` is a
 * slot-props proxy, not data:
 *
 * - reading a prop as a child emits a marker range the client fills;
 * - calling a prop as a render function emits a `slot` chunk for a fresh
 *   occurrence (a primitive `$key` arg names it, so client state follows the
 *   entity across responses — the slot-level analogue of For's `keyed`
 *   function; positional otherwise, which is the right default for most
 *   flows);
 * - primitive args ride the chunk; server JSX args stream as nested regions
 *   (`{$frame}` — html once, never data); other values serialize as `{$ref}`
 *   data records with referential dedupe.
 *
 * The props a *client* passes never reach the server — server inputs are the
 * function's arguments.
 * @experimental
 */
export function renderServerComponent(
  component: (props: Record<string, any>) => unknown,
  options?: FrameStreamOptions
): FrameStream;

/** Render a **server component** — a `props => JSX` function, typically */
export function renderServerComponent(component, options = {}) {
  return frameStream((sink, frame) => {
    const props = createSlotProps(sink, frame);
    return () => {
      // The out-of-band commit hook for the binding ledger.
      const ctx = sharedConfig.context;
      if (ctx) {
        ctx.commit = sink.commit;
        // Per-epoch memo caching (the ledger's derivation story): the core
        ctx.commitEpoch = () => sink.epoch;
        // Live markup holes (Stage 3): thunk content holes in this render
        ctx.liveHoles = createLiveHoles(sink);
        // Handler positions: arm the compiled `ssrClaim` guard for the whole
        ctx.claims = CLAIMS_STREAM;
      }
      return serverComponentScope(() => component(props));
    };
  }, options);
}

// The shared chunk envelope: `start` up front, the frame sink for all render
const DEFAULT_MAX_YIELDS = 64;
const DEFAULT_MAX_DURATION_MS = 30_000;
// The abort reason a response's own `cancel` tears its render down with:
const DISCONNECTED = Symbol("solid.frames.disconnected");
// A pipe writable's hook for the tiers the sync render pass minted (see
const ANNOUNCE = Symbol("solid.frames.announce");

function frameStream(makeCode, options) {
  const { id = "", version = 1 } = options.frame || {};
  const frame = { id, version };
  // The plain-response streaming bound.
  const bounded = !options.live;
  const maxYields = bounded ? (options.maxYields ?? DEFAULT_MAX_YIELDS) : 0;
  const maxDurationMs = bounded ? (options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS) : 0;
  function stream(w) {
    // Observe tier: the server half of the `"frame"` record
    const observation = observeFrame(frame);
    // The render's own teardown, chained from the caller's signal: a cut at
    const render = new AbortController();
    const upstream = options.signal;
    let ended = false;
    let flushed = false;
    let yields = 0;
    let timer;
    function finish() {
      if (ended) return;
      ended = true;
      if (timer) clearTimeout(timer);
      if (upstream) upstream.removeEventListener("abort", onSignal);
      w.end && w.end();
    }
    // End a plain response at a bound: the sink's end (the latch sweep,
    function cut(bound) {
      if (ended) return;
      sink.end(bound);
      observation && observation.settle("complete");
      finish();
      render.abort({ quiet: true, bound });
    }
    // The caller's signal (the request's, through `serverComponentResponse`)
    function onSignal() {
      const gone = upstream.reason && upstream.reason[DISCONNECTED];
      if (bounded && flushed && !gone) return cut("time");
      finish();
      render.abort(upstream.reason);
    }
    const emit = chunk => {
      if (observation) observation.chunk(chunk);
      w.write(chunk);
      // First flush: the root's html.
      if (bounded && !flushed && chunk.type === "html" && chunk.id === id) {
        flushed = true;
        if (maxDurationMs > 0 && maxDurationMs !== Infinity)
          timer = setTimeout(() => cut("time"), maxDurationMs);
      }
    };
    const sink = createFrameSink(
      emit,
      frame,
      options.resume && options.resume.have,
      bounded
        ? {
            onYield() {
              if (flushed && maxYields > 0 && ++yields >= maxYields) cut("yields");
            }
          }
        : undefined
    );
    // A `live` response is the wire tier's: the standing connection the
    if (options.live) sink.needs("wire");
    w.write({ type: "start", id, version });
    // A caller already gone has nobody to render for.
    if (upstream && upstream.aborted) return finish();
    if (upstream) upstream.addEventListener("abort", onSignal, { once: true });
    const code = makeCode(sink, frame);
    try {
      // Frames default to the keyed JSON codec for data records (eval-free
      renderToStream(() => serverOwned(code), {
        serializer: createJSONSerializer,
        ...options,
        signal: render.signal,
        sink
      }).pipe({
        // Every document emission is intercepted by the frame sink, so no
        write() {},
        end() {
          if (ended) return;
          sink.end();
          observation && observation.settle("complete");
          finish();
        }
      });
    } catch (err) {
      // A synchronous render failure travels as a structured chunk — the
      const wire = ssrSanitizeError(err, null);
      sink.error("", wire instanceof Error ? wire.message : String(wire));
      sink.end();
      observation && observation.settle("error", err);
      finish();
    }
    // The sync render pass is over: the tiers it minted are what the
    if (w[ANNOUNCE]) w[ANNOUNCE](sink.announce());
  }
  return {
    pipe: stream,
    then(onFulfilled, onRejected) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        try {
          stream({ write: chunk => chunks.push(chunk), end: () => resolve(chunks) });
        } catch (err) {
          reject(err);
        }
      }).then(onFulfilled, onRejected);
    }
  };
}

/** The slot marker range for an occurrence, as a pre-rendered SSR value. */
function slotRange(occurrence) {
  return {
    t: `<!--slot:${occurrence}:start--><!--slot:${occurrence}:end-->`,
    $slot: true,
    $occurrence: occurrence
  };
}

// A slot call's return serves BOTH things a slot can render (principles
const RANGE_KEYS = new Set([
  "t",
  "h",
  "p",
  "then",
  "length",
  "slice",
  "constructor",
  "toString",
  "valueOf",
  "toJSON"
]);
const NODE_KEYS = new Set(["t", "h", "p"]);
/** Whether a string key read off a slot proxy is the range's own (passes */
function isRangeKey(key) {
  const c = key.charCodeAt(0);
  return c === 36 /* $ */ || (c >= 48 && c <= 57) /* index */ || RANGE_KEYS.has(key);
}
// `needs(tier)` is the face's tier announcement (createFrameSink's `needs`
function slotProxy(range, occurrence, face, content, onData, needs) {
  return new Proxy(range, {
    get(target, key, receiver) {
      if (typeof key !== "string" || isRangeKey(key)) return Reflect.get(target, key, receiver);
      // The first property read fixes the proxy's face as DATA (see
      if (onData) onData = void onData();
      // A read off markup binds nothing (a dev finding at the position).
      if (face !== SLOT_FACE_MARKUP) needs("bind");
      return slotValue(occurrence, key, content ? content[key] : undefined, face);
    }
  });
}

/** A slot arg's form at the serialization border: `toBorderForm`, after one */
function argBorderForm(value, key, occurrence, needs) {
  return toBorderForm(withoutStandIns(value, key, occurrence, needs), true);
}

/** A slot arg with every stand-in in it replaced by `undefined` — the same */
function withoutStandIns(value, key, occurrence, needs) {
  return rewriteTree(
    value,
    (v, path) => {
      if (isContainerTraced(v)) {
        needs("trace");
        return v;
      }
      if (Object.getPrototypeOf(v) === Object.prototype && isSlotValue(v)) {
        if ("_SOLID_DEV_") standInArgFinding(v, key, occurrence, path);
        return undefined;
      }
      return DESCEND;
    },
    true
  );
}

function standInArgFinding(sv, key, occurrence, path) {
  if ("_SOLID_DEV_") {
    // Once per (occurrence, arg, path) per render — and a stand-in shared
    const ctx = sharedConfig.context;
    if (ctx) {
      const id = `${occurrence}\u0000${key}${path}\u0000arg`;
      const seen = ctx.slotFindings || (ctx.slotFindings = new Set());
      if (seen.has(id)) return;
      seen.add(id);
    }
    const where = path === "" ? `Arg \`${key}\`` : `Arg \`${key}${path}\``;
    devCheck({
      code: "BINDING_SLOT_POSITION",
      kind: "ssr",
      severity: "warn",
      message:
        `[BINDING_SLOT_POSITION] ${where} of \`${occurrence}\` is another slot's value ` +
        `(\`${sv.k}\` of \`${sv[SLOT_VALUE]}\`). The server does not have it — the client owns ` +
        `it — so it cannot be passed as data; the arg carries \`undefined\` there on both faces. ` +
        `Pass the server's own value, or have the client fill read it from its own state.`,
      data: {
        reason: "arg",
        occurrence,
        key,
        path: path === "" ? undefined : path,
        from: sv[SLOT_VALUE],
        fromKey: sv.k
      }
    });
  }
}

/** Classify a document-face fill's return for property reads: a plain */
function slotFace(range, content) {
  if (content == null) return SLOT_FACE_DATA;
  if (typeof content !== "object" || Array.isArray(content)) return SLOT_FACE_MARKUP;
  if (isServerContent(content)) {
    // An SSR node is `{ t }` (plus `h`/`p`) and nothing else.
    let data = false;
    for (const key in content) {
      if (!NODE_KEYS.has(key)) {
        data = true;
        break;
      }
    }
    if (!data) return SLOT_FACE_MARKUP;
  }
  if ("_SOLID_DEV_") {
    for (const key of Object.keys(content)) {
      if (isRangeKey(key)) {
        devCheck({
          code: "BINDING_SLOT_POSITION",
          kind: "ssr",
          severity: "warn",
          message:
            `[BINDING_SLOT_POSITION] The fill for \`${range.$occurrence}\` returned a key named \`${key}\`, ` +
            `which is reserved (keys beginning with \`$\` or a digit, \`length\`, \`slice\`, the node keys \`t\`/\`h\`/\`p\`, ` +
            `\`then\`, \`constructor\`, \`toString\`, \`valueOf\`, \`toJSON\`): the server reads it as the ` +
            `slot's range, not as a value. Rename it.`,
          data: { reason: "reserved-key", occurrence: range.$occurrence, key }
        });
      }
    }
  }
  return SLOT_FACE_DATA;
}

// Occurrence ids embed user data (`$key`), and they land in contexts with
const OCCURRENCE_UNSAFE = /[^A-Za-z0-9_.-]/g;
function encodeOccurrenceKey(key) {
  return String(key).replace(OCCURRENCE_UNSAFE, c => {
    const code = c.codePointAt(0);
    return "%" + (code < 16 ? "0" : "") + code.toString(16);
  });
}

/** Mint the occurrence id for one render-prop call: `prop#<$key>` when the */
function occurrenceId(prop, raw, counts) {
  const keyed = keyedId(prop, raw);
  if (keyed !== undefined) return keyed;
  const n = counts[prop] || 0;
  counts[prop] = n + 1;
  return `${prop}#${n}`;
}

/** `prop#<$key>` for a call that names its occurrence; `undefined` otherwise. */
function keyedId(prop, raw) {
  const k = raw.$key;
  // Numbers encode too: exponent forms ("1e+21") carry `+`.
  return typeof k === "string" || typeof k === "number"
    ? `${prop}#${encodeOccurrenceKey(k)}`
    : undefined;
}

/** Structural identity of a call's args, for collapsing repeated un-keyed */
function structuralArgsKey(raw) {
  let out = "";
  let ancestors;
  // Length-prefixed strings and keys keep the encoding injective.
  const walk = (v, top) => {
    if (v === null) out += "N";
    else if (typeof v === "string") out += "s" + v.length + ":" + v;
    else if (typeof v === "boolean") out += v ? "T" : "F";
    else if (typeof v === "undefined") out += "U";
    else if (typeof v === "number") out += "n" + v + ";";
    else if (typeof v === "bigint") out += "b" + v + ";";
    else if (typeof v !== "object") return false;
    else {
      const isArray = Array.isArray(v);
      if (!isArray) {
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) return false;
      }
      if (ancestors === undefined) ancestors = new Set();
      else if (ancestors.has(v)) return false;
      ancestors.add(v);
      try {
        if (isArray) {
          out += "[";
          for (const item of v) if (!walk(item)) return false;
          out += "]";
        } else {
          out += "{";
          for (const k of Object.keys(v).sort()) {
            if (top && k === "$key") continue;
            const desc = Object.getOwnPropertyDescriptor(v, k);
            if (desc.get || desc.set) return false;
            out += "k" + k.length + ":" + k;
            if (!walk(desc.value)) return false;
          }
          out += "}";
        }
      } finally {
        ancestors.delete(v);
      }
    }
    return true;
  };
  return walk(raw, true) ? out : undefined;
}

/** One call is one occurrence however many times the render evaluates it. */
function repeatKey(prop, raw) {
  const keyed = keyedId(prop, raw);
  if (keyed !== undefined) return keyed;
  const structural = structuralArgsKey(raw);
  return structural === undefined ? undefined : prop + "\0" + structural;
}

/** An async value in the DR-2 value-tier sense: passed whole, rides the data */
function isAsyncValue(v) {
  return (
    !!v &&
    typeof v === "object" &&
    (typeof v.then === "function" || typeof v[Symbol.asyncIterator] === "function")
  );
}

/** One source, two consumers (document face): the inline read wants the */
function tapFirstYield(iterable) {
  const rest = shareAsyncIterable(iterable);
  const iter = shareAsyncIterable(iterable)[Symbol.asyncIterator]();
  // Normalized: protocol-loose producers may return a bare IteratorResult
  const first = Promise.resolve(iter.next()).then(r => {
    if (!r.done) iter.return?.();
    return r.done ? undefined : r.value;
  });
  return { first, rest };
}

/** Document-mode slot props — the t = 0 counterpart of */
/** Mint-suppress a slot FILL's render (document face): fill content is */
function suppressedFill(render) {
  const live = sharedConfig.context && sharedConfig.context.liveHoles;
  if (!live) return render();
  live.suppressed++;
  try {
    return render();
  } finally {
    live.suppressed--;
  }
} // === Document SSR (t = 0) ===

/** Document-mode slot props — the t = 0 counterpart of */
export function createDocumentSlotProps(
  clientProps: Record<string, unknown>,
  frameId: string
): Record<string, unknown>;

export function createDocumentSlotProps(clientProps, frameId) {
  const counts = Object.create(null);
  const getters = new Map();
  // Repeated calls are one occurrence within a render (see repeatKey).
  const repeats = new Map();
  // `$slot`-tagged like the stream face's slotRange: the engine resolves a
  const range = (occurrence, content) => {
    const r = [
      { t: `<!--slot:${occurrence}:start-->` },
      content,
      { t: `<!--slot:${occurrence}:end-->` }
    ];
    r.$slot = true;
    r.$occurrence = occurrence;
    const face = slotFace(r, content);
    r.$face = face;
    return slotProxy(
      r,
      occurrence,
      face,
      face === SLOT_FACE_DATA ? content : undefined,
      undefined,
      documentNeeds
    );
  };
  // Client content renders under a per-occurrence hydration-key OWNER
  const zoneOwner = getOwner ? getOwner() : null;
  const scoped = (occurrence, render) => {
    const id = `sc-${frameId}-${occurrence}-`;
    const run = () =>
      Hydration
        ? Hydration({
            id,
            get children() {
              return render();
            }
          })
        : runWithHydrationScope(id, render);
    return zoneOwner ? runWithOwner(zoneOwner, run) : run();
  };
  return new Proxy(Object.create(null), {
    has() {
      return true;
    },
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined;
      let fn = getters.get(prop);
      if (!fn) {
        fn = (...callArgs) => {
          // Direct-insert position: the client's content renders inline,
          if (callArgs.length === 0 || callArgs[0] === undefined) {
            // A zero-arg call is the occurrence named by the prop, so a
            const rk = prop + "\0";
            const repeat = repeats.get(rk);
            if (repeat) return repeat;
            // Direct-insert positions are key-scoped like render props —
            const out = suppressedFill(() =>
              scoped(prop, () => {
                const value = clientProps[prop];
                return range(prop, typeof value === "function" ? value() : value);
              })
            );
            if (out.$face === SLOT_FACE_DATA) repeats.set(rk, out);
            return out;
          }
          const raw = callArgs[0];
          const rk = repeatKey(prop, raw);
          const repeat = rk !== undefined && repeats.get(rk);
          if (repeat) return repeat;
          const occurrence = occurrenceId(prop, raw, counts);
          const slot = clientProps[prop];
          if (typeof slot !== "function") return range(occurrence, undefined);
          // The record is DECLARED at the marker (frames A4, S-record): a
          const context = sharedConfig.context;
          const recordKey = `sc:slot:${frameId}:${occurrence}`;
          let settleRecord;
          if (context && context.async) {
            context.serialize(recordKey, new Promise(resolve => (settleRecord = resolve)));
          }
          try {
            const resolved = {};
            // Usage tracking (dispatch case 3, document face): regions ride as
            const liveArgs =
              sharedConfig.context && sharedConfig.context.live && sharedConfig.context.live.args;
            const vals = {};
            const evals = {};
            // Per-key ledger state: `settled` + the equality baseline.
            const states = {};
            // Keys whose evaluation minted reactive scopes (scopeStamp moved):
            const minted = {};
            for (const key of Object.keys(raw)) {
              if (key === "$key") continue;
              const desc = Object.getOwnPropertyDescriptor(raw, key);
              let evaluate = null;
              let value;
              if (desc.get) {
                const get = desc.get;
                evaluate = () => unwrapThunks(get.call(raw));
              } else {
                value = desc.value;
                if (typeof value === "function") {
                  const fn = value;
                  evaluate = () => unwrapThunks(fn);
                }
              }
              if (evaluate) {
                evals[key] = evaluate;
                const stampBefore = scopeStamp();
                try {
                  value = evaluate();
                  states[key] = { settled: true, last: value };
                } catch (err) {
                  const blocked = ssrHandleError && ssrHandleError(err);
                  if (!blocked) throw err;
                  const state = (states[key] = { settled: false, last: undefined });
                  value = retryArgUntilSettled(evaluate, blocked, key, occurrence, v => {
                    state.settled = true;
                    state.last = v;
                    // The settle is a commit: other bindings may read the
                    if (liveArgs) liveArgs.commit();
                  });
                }
                if (scopeStamp() !== stampBefore) minted[key] = true;
              }
              vals[key] = value;
            }
            const regions = [];
            for (const key of Object.keys(vals)) {
              const value = vals[key];
              if (isContainerTraced(value)) {
                // Container tier (DR-2 case 3): a traced container is DATA
                documentNeeds("trace");
                resolved[key] = value;
              } else if (isServerContent(value)) {
                const childId = `${frameId}.${occurrence}.${key}`;
                const region = { key, childId, value, used: false, locked: false };
                regions.push(region);
                // Used or occluded, the record names it `{$frame}`: the
                documentNeeds("regions");
                resolved[key] = () => {
                  // Streaming occlusion lock: the usage flip below runs at the
                  if (region.locked) return [];
                  region.used = true;
                  // A region is a frame ELEMENT the client wrapper adopts —
                  return [{ t: frameElementOpen(childId) }, value, { t: FRAME_ELEMENT_CLOSE }];
                };
              } else if (ssrAsyncValue && isAsyncValue(value)) {
                // DR-2 value tier, document face: the inline fill's read of an
                let readable = value;
                if (typeof value.then !== "function") {
                  const { first, rest } = tapFirstYield(value);
                  readable = first;
                  vals[key] = rest;
                }
                const read = ssrAsyncValue(readable);
                Object.defineProperty(resolved, key, {
                  get: read,
                  enumerable: true,
                  configurable: true
                });
              } else {
                // What hydration will read: a stand-in anywhere in the arg is
                resolved[key] = vals[key] = withoutStandIns(value, key, occurrence, documentNeeds);
              }
            }
            const out = suppressedFill(() =>
              scoped(occurrence, () => range(occurrence, slot(resolved)))
            );
            const unused = regions.filter(r => !r.used);
            if (context) {
              // One record shape (A5, server-components-principles.md): the
              const args = {};
              for (const key of Object.keys(vals)) {
                const value = vals[key];
                const region = regions.find(r => r.key === key);
                if (region) {
                  args[key] = { $frame: region.childId };
                  continue;
                }
                // Container check first for exactness: a store whose STATE has
                if (!isContainerTraced(value) && isServerContent(value)) continue;
                // Containers (at any depth) ride the record as trace envelopes;
                args[key] = argBorderForm(value, key, occurrence, documentNeeds);
              }
              // A CLONE settles the declaration (or IS the record, on a sync
              settleRecord ? settleRecord({ ...args }) : context.serialize(recordKey, { ...args });
              for (const region of unused) {
                // Lock BEFORE returning: the content is now committed to the data
                region.locked = true;
                // Resolve the region's server content through the live render
                context.serialize(
                  `sc:region:${region.childId}`,
                  resolveRegionHtml(context, region.value)
                );
              }
              // The document arg ledger (DR-2 case 1 at t=0): every
              if (liveArgs) {
                for (const key of Object.keys(evals)) {
                  if (regions.some(r => r.key === key)) continue;
                  if (minted[key]) continue; // scope-minting eval: latched
                  const ledgerKey = `${frameId}:${occurrence}:${key}`;
                  openArgBinding(
                    liveArgs,
                    ledgerKey,
                    occurrence,
                    key,
                    evals[key],
                    states[key],
                    value => {
                      args[key] = argBorderForm(value, key, occurrence, documentNeeds);
                      liveArgs.slot(frameId, occurrence, { ...args });
                    }
                  );
                }
              }
            }
            // The fill ran and its return is classified: a keyed call
            if (rk !== undefined && (rk === occurrence || out.$face === SLOT_FACE_DATA))
              repeats.has(rk) || repeats.set(rk, out);
            return out;
          } catch (error) {
            // The fill (or an arg's evaluation) threw: the record has no args to
            settleRecord && settleRecord(undefined);
            throw error;
          }
        };
        // A slot getter placed directly as a child (`{props.children}`) is a
        fn.$lhSkip = true;
        getters.set(prop, fn);
      }
      return fn;
    }
  });
}

// The boundary element vocabulary — the t=0 DOM contract with the client
const FRAME_TAG = "solid-frame";
const FRAME_ID_ATTR = "data-fid";

/** Open tag for a boundary/region element with `id`. */
function frameElementOpen(id) {
  const escaped = sharedConfig.context ? sharedConfig.context.escape(String(id), true) : String(id);
  return `<${FRAME_TAG} ${FRAME_ID_ATTR}="${escaped}" style="display:contents">`;
}
const FRAME_ELEMENT_CLOSE = `</${FRAME_TAG}>`;

/** The document face's live-hole plumbing (Stage 4): one engine per document */
/** The document face's tier announcement (frames savings pass §2): the */
function documentNeeds(name) {
  const ctx = sharedConfig.context;
  const live = ctx && ctx.live;
  if (!live || !ctx.serialize) return;
  const tiers = live.tiers || (live.tiers = []);
  if (tiers.includes(name)) return;
  tiers.push(name);
  ctx.serialize("sc:tiers", tiers.slice());
  const url = live.tierUrls && live.tierUrls[name];
  if (url && ctx.registerAsset) ctx.registerAsset("module", url);
}

function armDocumentLiveHoles(ctx) {
  if (!ctx || ctx.liveHoles !== undefined) return;
  const live = ctx.live;
  // A second server component under a fresh clone: adopt the document's
  if (live && live.holes !== undefined) {
    ctx.liveHoles = live.holes;
    if (live.holes) {
      ctx.commit = live.commit;
      ctx.commitEpoch = live.commitEpoch;
    }
    return;
  }
  // Sync renders (no streaming serializer / no shared slot), noScripts
  if (!live || !ctx.async || !ctx.serialize || typeof ReadableStream !== "function") {
    ctx.liveHoles = null;
    if (live) live.holes = null;
    return;
  }
  const bindings = new Map();
  let epoch = 0;
  let sweepScheduled = false;
  let closed = false;
  // The sweep is one op on the channel (C13 — see the stream sink's
  let swept = null;
  const sweep = () => {
    epoch++;
    const ops = (swept = []);
    try {
      for (const b of [...bindings.values()]) {
        try {
          b.sweep();
        } catch (_) {
          // A sweep failure must not take the document down: the binding's
        }
      }
    } finally {
      swept = null;
    }
    pushOps(ops);
  };
  const pushOps = ops => {
    if (ops.length === 1) push(ops[0]);
    else if (ops.length) push({ type: "ops", ops });
  };
  const scheduleSweep = () => {
    if (closed || sweepScheduled || !bindings.size) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      if (!closed) sweep();
    });
  };
  let channel;
  ctx.serialize(
    "sc:live",
    new ReadableStream({
      start(c) {
        channel = c;
      }
    })
  );
  const push = op => {
    if (!closed) channel.enqueue(op);
  };
  ctx.liveHoles = live.holes = createLiveHoles(
    {
      openBinding(key, b) {
        bindings.set(key, b);
      },
      closeBinding(key) {
        bindings.delete(key);
      },
      // Every emission carries its digest on every face (§9.5, Hole
      hole(key, html) {
        const op = { type: "hole", key, html, digest: textDigest(html) };
        swept ? swept.push(op) : pushOps([op]);
      },
      attr(key, attrs, removed) {
        const op = { type: "attr", key, attrs, digest: textDigest(attrs) };
        if (removed && removed.length) op.removed = removed;
        swept ? swept.push(op) : pushOps([op]);
      },
      error(key, error) {
        push({ type: "error", key, error });
      },
      commit: scheduleSweep,
      get epoch() {
        return epoch;
      }
    },
    /** scoped  true */ true
  );
  ctx.commit = live.commit = scheduleSweep;
  ctx.commitEpoch = live.commitEpoch = () => epoch;
  // The document ARG ledger (DR-2 case 1 at t=0): slot-props invocations
  live.args = {
    openBinding(key, b) {
      bindings.set(key, b);
    },
    closeBinding(key) {
      bindings.delete(key);
    },
    slot(fid, occurrence, args) {
      push({ type: "slot", fid, key: occurrence, args });
    },
    commit: scheduleSweep
  };
  // A failure that escaped a server component on the document face
  live.error = (fid, error) => {
    push({ type: "error", fid, error });
  };
  live.end = () => {
    if (closed) return;
    if (bindings.size) sweep();
    closed = true;
    channel.close();
  };
} /**
 * The in-process mirror of `frameTransformResult` for DOCUMENT SSR: install
 * as `configureServerFunctionsServer({ transformDirectResult })` and a
 * direct (same-process) server-function result that is a function comes back
 * as an inline-renderable server component (frame markers + document
 * slot props), branded with its function id and the call's wire address.
 * Non-function results pass through.
 * @experimental
 */
export function frameTransformDirectResult<T>(
  value: T,
  options: {
    id: string;
    args?: unknown[];
    /** The client chunk URL of each frames-client tier, by tier name (the */
    tierUrls?: Record<string, string>;
  }
): T;

/** The in-process mirror of `frameTransformResult`, for DOCUMENT SSR: */
export function frameTransformDirectResult(value, { id, args, tierUrls }) {
  if (typeof value !== "function") return value;
  const component = value;
  const wrapped = props => [
    { t: frameElementOpen(id) },
    // Slot props are created OUTSIDE the context barrier: their zone owner
    serverOwned(() => {
      const page = sharedConfig.context;
      armDocumentLiveHoles(page);
      // The tier chunk URLs, for the document's `modulepreload` links (see
      if (tierUrls && page && page.live && !page.live.tierUrls) page.live.tierUrls = tierUrls;
      // Handler positions: arm the compiled `ssrClaim` guard — and the
      const ctx = Object.create(page);
      ctx.claims = CLAIMS_DOCUMENT;
      // The frame this scope renders: a failure escaping a boundary inside
      ctx.frameId = id;
      sharedConfig.context = ctx;
      try {
        const slotProps = createDocumentSlotProps(props, id);
        // A `live` answer (the declaration's in-process brand lands on this
        const live = !!wrapped[LIVE_SOURCE];
        if (live) documentNeeds("wire");
        return serverComponentScope(() => component(slotProps), live);
      } finally {
        sharedConfig.context = page;
      }
    }),
    { t: FRAME_ELEMENT_CLOSE }
  ];
  // Branded so the hydration serializer can write it as a reference (see
  wrapped[SERVER_COMPONENT] = id;
  // The wrap is for rendering INLINE in a document.
  wrapped[SERVER_COMPONENT_SOURCE] = component;
  wrapped[SERVER_COMPONENT_ADDRESS] = frameAddress(id, args);
  return wrapped;
}

/** Resolves server content to its final html, riding out async holes: waits */
function resolveRegionHtml(ctx, node) {
  const res = ctx.resolve(node);
  if (!res || !res.t) return String(res ?? "");
  if (!res.h || !res.h.length) return res.t[0];
  return Promise.all(res.p).then(() => {
    let out = Promise.resolve(res.t[0]);
    for (let i = 0; i < res.h.length; i++) {
      const hole = res.h[i];
      const tail = res.t[i + 1];
      out = out.then(acc =>
        Promise.resolve(resolveRegionHtml(ctx, hole)).then(part => acc + part + tail)
      );
    }
    return out;
  });
}

/** The props proxy handed to a server component. */
/** Whether a slot-arg value is server JSX: an SSR template object, or an */
function isServerContent(value) {
  if (value && typeof value === "object") {
    if ("t" in value) return true;
    if (Array.isArray(value) && value.length > 0) {
      for (const item of value) {
        if (!(item && typeof item === "object" && "t" in item)) return false;
      }
      return true;
    }
  }
  return false;
}

/** Bounded thunk unwrap: resolve nested thunks/memos to their value. */
function unwrapThunks(value) {
  for (let d = 0; typeof value === "function" && d < 16; d++) value = value();
  return value;
}

/** The DR-3 rule-1 rejection: async slot args are data-only. */
function contentArgError(key, occurrence) {
  return new Error(
    "Async slot arg resolved to JSX (arg '" +
      key +
      "' of " +
      occurrence +
      "). Async args must resolve to serializable values; render async content through a boundary instead."
  );
}

/** The arg-level markup-hole retry loop (DR-2 value tier): a slot arg whose */
function retryArgUntilSettled(evaluate, blocked, key, occurrence, onSettle) {
  const owner = getOwner();
  return new Promise((resolve, reject) => {
    const retry = () => {
      try {
        const value = owner ? runWithOwner(owner, evaluate) : evaluate();
        if (isServerContent(value)) {
          // DR-3 rule 1: markup emission is long past by the time this
          reject(contentArgError(key, occurrence));
          return;
        }
        if (onSettle) onSettle(value);
        resolve(value);
      } catch (err) {
        const next = ssrHandleError && ssrHandleError(err);
        if (next) next.then(retry, retry);
        else reject(err);
      }
    };
    blocked.then(retry, retry);
  });
}

/** A watched-arg binding (DR-2 case 1): the ledger entry for one re-runnable */
function openArgBinding(sink, ledgerKey, occurrence, key, evaluate, state, emit) {
  const owner = getOwner();
  sink.openBinding(ledgerKey, {
    sweep() {
      if (!state.settled) return;
      let value;
      const stampBefore = scopeStamp();
      try {
        value = owner ? runWithOwner(owner, evaluate) : evaluate();
      } catch (err) {
        const blocked = ssrHandleError && ssrHandleError(err);
        if (!blocked) {
          sink.closeBinding(ledgerKey);
          emit(Promise.reject(err instanceof Error ? err : new Error(String(err))));
          return;
        }
        if (scopeStamp() !== stampBefore) {
          // The re-evaluation minted reactive scopes before blocking: arming
          sink.closeBinding(ledgerKey);
          return;
        }
        state.settled = false;
        emit(
          retryArgUntilSettled(evaluate, blocked, key, occurrence, v => {
            state.settled = true;
            state.last = v;
            sink.commit();
          })
        );
        return;
      }
      if (scopeStamp() !== stampBefore) {
        // Scope-minting evaluation (first render pre-dated the gate, or the
        sink.closeBinding(ledgerKey);
        return;
      }
      if (value === state.last) return;
      state.last = value;
      if (isServerContent(value)) {
        sink.closeBinding(ledgerKey);
        emit(Promise.reject(contentArgError(key, occurrence)));
        return;
      }
      emit(value);
    }
  });
} /**
 * The slot props proxy used by `renderServerComponent`. Every key
 * virtually exists (`in` is always true — a prop is a position the client
 * may fill), enumeration is empty by design, and serialization goes through
 * the live render context, so it must only be used during the frame's
 * render.
 * @internal Exposed for framework bindings composing their own producers.
 * @experimental
 */
export function createSlotProps(
  sink: ReturnType<typeof createFrameSink>,
  frame: FrameAddress
): Record<string, any>;

export function createSlotProps(sink, frame) {
  const counts = Object.create(null);
  const getters = new Map();
  // Repeated calls are one occurrence within a render (see repeatKey).
  const repeats = new Map();
  // The tier announcement (createFrameSink's `needs`); a composed sink
  const needs = sink.needs || (() => {});
  return new Proxy(Object.create(null), {
    // Every key virtually exists — a prop is a *position* the client may
    has() {
      return true;
    },
    get(_, prop) {
      if (typeof prop !== "string") return undefined;
      // `has: true` + callable gets would otherwise make the proxy thenable
      if (prop === "then") return undefined;
      let fn = getters.get(prop);
      if (!fn) {
        fn = (...callArgs) => {
          if (callArgs.length === 0 || callArgs[0] === undefined) {
            return slotProxy(slotRange(prop), prop, SLOT_FACE_STREAM, undefined, undefined, needs);
          }
          const rk = repeatKey(prop, callArgs[0]);
          const repeat = rk !== undefined && repeats.get(rk);
          if (repeat) return repeat;
          // Slot records are emit-once: occurrence identity is positional
          const live = sharedConfig.context && sharedConfig.context.liveHoles;
          if (live) {
            if (live.sweeping) {
              live.gateHit = true;
              return { t: "", $slot: true };
            }
            live.recordStamp++;
          }
          const raw = callArgs[0];
          // Occurrence identity (RFC open question 1): a primitive `$key` arg
          const occurrence = occurrenceId(prop, raw, counts);
          const args = {};
          // Watched-arg bindings to open AFTER the record emits (the ledger
          const opened = [];
          for (const key of Object.keys(raw)) {
            if (key === "$key") continue; // occurrence identity, not client data
            // Region ids derive from occurrence + arg name — stable across
            const childId = `${frame.id}.${occurrence}.${key}`;
            const ctx = sharedConfig.context;
            // A Suspense inside this arg registers its fragment as it renders —
            const origRegister = ctx.registerFragment;
            ctx.registerFragment = (fragKey, fragOptions) => {
              sink.tagRegion(fragKey, childId);
              return origRegister.call(ctx, fragKey, fragOptions);
            };
            try {
              // A function cannot be serialized, so a function-valued arg must
              const desc = Object.getOwnPropertyDescriptor(raw, key);
              let evaluate = null;
              let value;
              // Shared with the retry loop's onSettle and the binding's
              let state = null;
              const stampBefore = scopeStamp();
              try {
                if (desc.get) {
                  const get = desc.get;
                  evaluate = () => unwrapThunks(get.call(raw));
                  value = evaluate();
                } else {
                  value = desc.value;
                  if (typeof value === "function") {
                    const fn = value;
                    evaluate = () => unwrapThunks(fn);
                    value = evaluate();
                  }
                }
              } catch (err) {
                // DR-2 value tier: a not-ready evaluation (an async memo, or a
                const blocked = ssrHandleError && ssrHandleError(err);
                if (!blocked) throw err;
                state = { settled: false, last: undefined };
                const pendingState = state;
                value = retryArgUntilSettled(evaluate, blocked, key, occurrence, v => {
                  pendingState.settled = true;
                  pendingState.last = v;
                  // The settle is a commit: other watched args may read the
                  sink.commit();
                });
              }
              // Snapshot BEFORE classification: resolve/serialize below may
              const mintedEval = scopeStamp() !== stampBefore;
              const t = typeof value;
              if (value == null || t === "string" || t === "number" || t === "boolean") {
                args[key] = value;
                if (evaluate) state = { settled: true, last: value };
              } else if (!isContainerTraced(value) && isServerContent(value)) {
                // Containers fall through to the data path below (their
                const resolved = ctx.resolve(value);
                if (resolved.h.length) {
                  // A Suspense boundary keeps its async out of `h` (it catches,
                  throw new Error(
                    "Async server content in a slot arg needs a boundary (arg '" +
                      key +
                      "' of " +
                      occurrence +
                      "). Wrap the async read in a <Suspense>, or move it above the slot."
                  );
                }
                sink.region(childId, resolved.t[0]);
                args[key] = { $frame: childId };
              } else {
                const ref = `arg:${occurrence}:${key}`;
                // Containers (at any depth) swap for their trace envelopes
                ctx.serialize(ref, argBorderForm(value, key, occurrence, needs));
                args[key] = { $ref: ref };
                if (evaluate && !state) state = { settled: true, last: value };
              }
              // A re-runnable arg that classified as DATA (settled or
              if (evaluate && state && !mintedEval) opened.push({ key, evaluate, state });
            } finally {
              ctx.registerFragment = origRegister;
            }
          }
          // Deliver a CLONE and keep the canonical object for the ledger:
          sink.slot(occurrence, { ...args });
          const ctx = sharedConfig.context;
          for (const b of opened) {
            const key = b.key;
            const ledgerKey = `${occurrence}:${key}`;
            openArgBinding(sink, ledgerKey, occurrence, key, b.evaluate, b.state, value => {
              const t = typeof value;
              if (value == null || t === "string" || t === "number" || t === "boolean") {
                args[key] = value;
              } else {
                const ref = `arg:${occurrence}:${key}@${sink.nextArgRef(ledgerKey)}`;
                sink.mintRef(ref);
                ctx.serialize(ref, argBorderForm(value, key, occurrence, needs));
                args[key] = { $ref: ref };
              }
              sink.slot(occurrence, { ...args });
            });
          }
          // A keyed call registers for repeats at the call; an un-keyed one
          const keyed = rk === occurrence;
          const out = slotProxy(
            slotRange(occurrence),
            occurrence,
            SLOT_FACE_STREAM,
            undefined,
            rk === undefined || keyed ? undefined : () => repeats.has(rk) || repeats.set(rk, out),
            needs
          );
          if (keyed) repeats.set(rk, out);
          return out;
        };
        // A slot getter placed directly as a child (`{props.children}`) is a
        fn.$lhSkip = true;
        getters.set(prop, fn);
      }
      return fn;
    }
  });
}

/** A server component as an HTTP Response: `renderServerComponent`'s chunk */
// Copy a response-init's headers preserving multiple `Set-Cookie` values:
function copyInitHeaders(init) {
  if (!init || !init.getSetCookie) return new Headers(init);
  const headers = new Headers();
  init.forEach((value, key) => {
    if (key !== "set-cookie") headers.append(key, value);
  });
  for (const cookie of init.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
} /**
 * A server component as an HTTP Response: the chunk stream framed with the
 * server-function wire convention — length-prefixed, or as server-sent
 * events when `options.live` says a `live` loop is reading — tagged
 * `X-Frame-Stream: <frame id>` for the client and `X-Content-Raw` so the
 * server-function handler forwards it untouched. `init` (headers/status,
 * e.g. from a `respond()` envelope) merges in; the frame tags win on
 * conflict.
 * @experimental
 */
export function serverComponentResponse(
  component: (props: Record<string, any>) => unknown,
  options?: FrameStreamOptions,
  init?: { headers?: HeadersInit; status?: number }
): Response;

export function serverComponentResponse(component, options = {}, init = {}) {
  const { id = "", version = 1 } = options.frame || {};
  const live = !!options.live;
  const headers = copyInitHeaders(init.headers);
  headers.set(FRAME_STREAM_HEADER, id);
  headers.set("X-Content-Raw", "1");
  // A live loop's answer rides in event-stream framing (the same framing the
  if (live) {
    headers.set("Content-Type", "text/event-stream");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Accel-Buffering", "no");
  } else headers.set("Content-Type", "application/x-frame-stream");
  const frame = live ? createEventChunk : createChunk;
  // The render lives as long as someone reads the response.
  const teardown = new AbortController();
  const disarm = followSignal(options.signal, teardown);
  const stream = renderServerComponent(component, {
    ...options,
    signal: teardown.signal,
    frame: { id, version }
  });
  // Writes after the reader is gone must drop, not throw: an ERR_INVALID_STATE
  let closed = false;
  // The live body's heartbeat and dev chaos (see armLiveBody); disarmed on
  let stopLive = null;
  const body = new ReadableStream({
    start(controller) {
      const end = () => {
        if (closed) return;
        closed = true;
        disarm();
        if (stopLive) stopLive();
        try {
          controller.close();
        } catch (_) {}
      };
      // A request gone before the body was ever read: nothing to render
      if (teardown.signal.aborted) return end();
      // Chaos ends the body as a dying connection would: the render is torn
      if (live)
        stopLive = armLiveBody(controller, () => {
          closed = true;
          disarm();
          teardown.abort();
        });
      stream.pipe({
        write(chunk) {
          if (closed) return;
          try {
            controller.enqueue(frame(JSON.stringify(chunk)));
          } catch (_) {
            closed = true;
          }
        },
        end,
        // The tiers the sync render pass minted, into the response head
        [ANNOUNCE](tiers) {
          if (tiers.length) headers.set(FRAME_TIERS_HEADER, tiers.join(","));
        }
      });
    },
    cancel() {
      closed = true;
      disarm();
      if (stopLive) stopLive();
      // The reader is gone: a death, never a bound (there is nobody to
      teardown.abort({ [DISCONNECTED]: true });
    }
  });
  return new Response(body, { status: init.status || 200, headers });
}

/** Chain an upstream signal (the request's) into a response's own teardown */
function followSignal(upstream, controller) {
  if (!upstream) return () => {};
  if (upstream.aborted) {
    controller.abort(upstream.reason);
    return () => {};
  }
  const forward = () => controller.abort(upstream.reason);
  upstream.addEventListener("abort", forward, { once: true });
  return () => upstream.removeEventListener("abort", forward);
} /**
 * The server-component convention as a `transformResult` policy for
 * `handleServerFunctionRequest`: a function result — or a `respond()`
 * envelope whose value is a function — becomes a frame-stream Response,
 * with the frame id defaulting to the server function's id so repeat calls
 * target the same client boundary. Everything else passes through.
 *
 * @example
 * ```ts
 * handleServerFunctionRequest(request, {
 *   transformResult: frameTransformResult,
 *   provideEvent
 * });
 * ```
 * @experimental
 */
export function frameTransformResult(event: unknown, result: unknown): unknown;

/** The server-component convention as a `transformResult` policy for */
export function frameTransformResult(event, result, context) {
  let init;
  if (isResponseEnvelope(result)) {
    const { response, value } = result;
    if (typeof value !== "function") return result;
    init = response ? { headers: response.headers, status: response.status } : undefined;
    result = value;
  }
  if (typeof result !== "function") return result;
  if (context && context.collectsFlight) return init ? { response: init, value: result } : result;
  const invocation = getEventServerFunctionInvocation(event);
  const live = !!(invocation && invocation.live);
  // A live loop's reconnect names what it holds (the have-list header,
  const have = live ? decodeHaveList(requestHeader(event, FRAME_HAVE_HEADER)) : undefined;
  return serverComponentResponse(
    result,
    {
      frame: { id: (invocation && invocation.id) || "" },
      signal: requestSignal(event),
      // A call at the live address is a `live` loop's: frame the answer as
      live,
      resume: have && { have }
    },
    init
  );
}

/** The request's abort, when the event carries a standards-shaped request. */
function requestSignal(event) {
  const request = event && event.request;
  return request && request.signal instanceof AbortSignal ? request.signal : undefined;
}

/** A request header, when the event carries a standards-shaped request. */
function requestHeader(event, name) {
  const request = event && event.request;
  const headers = request && request.headers;
  return headers && typeof headers.get === "function" ? headers.get(name) : null;
} /**
 * The frame half of single-flight, as a `transformFlightResult` policy for
 * `handleServerFunctionRequest`: when part of what a mutation invalidated is
 * markup (a component-valued flight-data entry), the frame stream carries
 * the whole payload — each component's content as a region addressed by its
 * call, the `{ value, data }` envelope as `outcome` chunks with the
 * component entries serialized as flight references. Returns `undefined`
 * when nothing invalidated is markup (the response stays the plain
 * single-flight envelope).
 * @experimental
 */
export function frameTransformFlightResult(
  event: unknown,
  outcome: { value: unknown; data: unknown },
  context?: unknown
): Promise<Response | undefined>;

/** The frame half of single-flight, as a `transformFlightResult` policy: when */
export async function frameTransformFlightResult(event, outcome, context) {
  const { value, data } = outcome;
  const regions = [];
  let serialized = data;
  if (data && typeof data === "object") {
    serialized = {};
    for (const source of Object.keys(data)) {
      const slice = data[source];
      // Only a keyed map is scanned: a slice can be any codec-serializable
      if (!slice || typeof slice !== "object" || Array.isArray(slice)) {
        serialized[source] = slice;
        continue;
      }
      // Collected entries arrive unresolved (an integration's cache stores
      const keys = Object.keys(slice);
      const settled = await Promise.allSettled(keys.map(key => slice[key]));
      const out = (serialized[source] = {});
      for (let i = 0; i < keys.length; i++) {
        const result = settled[i];
        const entry = result.status === "fulfilled" ? result.value : slice[keys[i]];
        if (typeof entry !== "function") {
          out[keys[i]] = entry;
          continue;
        }
        // A branded component (a direct call's result through
        const address = entry[SERVER_COMPONENT_ADDRESS] || keys[i];
        regions.push({ id: address, component: entry[SERVER_COMPONENT_SOURCE] || entry });
        if (SERVER_COMPONENT in entry) {
          out[keys[i]] = entry;
        } else {
          const reference = () => undefined;
          reference[SERVER_COMPONENT] = keys[i];
          reference[SERVER_COMPONENT_ADDRESS] = address;
          out[keys[i]] = reference;
        }
      }
    }
  }
  const invocation = getEventServerFunctionInvocation(event);
  // The called function's own markup keeps the function id as its address,
  const primary =
    typeof value === "function"
      ? { id: (invocation && invocation.id) || "", component: value }
      : undefined;
  if (!primary && !regions.length) return undefined;
  return frameFlightResponse({
    primary,
    regions,
    outcome: {
      // The mutation's own return value is markup or data, never both: when
      value: primary ? undefined : value,
      data: serialized
    },
    codec: context && context.codec,
    signal: requestSignal(event)
  });
}

/** A framed response carrying several frames and a single-flight outcome: */
export function frameFlightResponse({ primary, regions = [], outcome, codec, signal }, init = {}) {
  const frames = primary ? [primary, ...regions] : regions;
  const headers = copyInitHeaders(init.headers);
  headers.set("Content-Type", "application/x-frame-stream");
  headers.set(FRAME_STREAM_HEADER, primary ? primary.id : "");
  headers.set("X-Content-Raw", "1");
  // The single-flight header is the FOLD's (`foldFlightData`): its value is
  const teardown = new AbortController();
  const disarm = followSignal(signal, teardown);
  let closed = false;
  const body = new ReadableStream({
    async start(controller) {
      const write = chunk => {
        if (closed) return;
        try {
          controller.enqueue(createChunk(JSON.stringify(chunk)));
        } catch (_) {
          closed = true;
        }
      };
      try {
        // Sequential: chunk order matters within a frame, not across them.
        for (const { id, component } of frames) {
          if (teardown.signal.aborted) break;
          // A torn-down render never ends its sink; the abort settles the
          await new Promise(resolve => {
            teardown.signal.addEventListener("abort", resolve, { once: true });
            renderServerComponent(component, {
              frame: { id, version: 1 },
              signal: teardown.signal
            }).pipe({
              write,
              end: () => {
                teardown.signal.removeEventListener("abort", resolve);
                resolve();
              }
            });
          });
        }
        if (teardown.signal.aborted) {
          closed = true;
          try {
            controller.close();
          } catch (_) {}
          return;
        }
        if (outcome) {
          // Component-valued entries serialize as flight references — the
          const reader = new ChunkReader(
            serializeStream(guardFailures(outcome), flightCodec(codec))
          );
          for (let node = await reader.next(); !node.done; node = await reader.next()) {
            write({ type: "outcome", payload: node.value });
          }
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      } catch (err) {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
      } finally {
        disarm();
      }
    },
    cancel() {
      closed = true;
      disarm();
      // The reader is gone: a death for the frame in progress, never a
      teardown.abort({ [DISCONNECTED]: true });
    }
  });
  return new Response(body, { status: init.status || 200, headers });
}
