// Ported from Solid's frames/src/frame-container-plugin.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
// @ts-nocheck
/** The container tier at the slot border: reactive containers (projections) */
import { DESCEND, rewriteTree } from "./tree-rewrite.ts";

/** A container's border serialization: one subscribe() per consumer. */
export interface ContainerTrace {
  subscribe(): AsyncIterable<any>;
  /** Whether the container's root is an array — the consumer's seed shape. */
  array: boolean;
}

/** The eval-face wire literal a trace decodes to before materialization. */
export interface ContainerTraceMarker {
  $tr: AsyncIterable<any>;
  $ta?: number;
}
// The container tier at the slot border (DR-2 case 3): a reactive container

// Hook state is shared ACROSS MODULE COPIES, like the TRACE symbol below:
/** @type {{ */
const STATE = Symbol.for("solid.container-trace-state");
const state =
  globalThis[STATE] ||
  (globalThis[STATE] = {
    materialized: new WeakMap(),
    materializedValues: new WeakSet()
  }); /** Server half: install the reactive core's trace resolver. */
export function setContainerTraceResolver(fn: (value: unknown) => ContainerTrace | undefined): void;

/** Server half: install the reactive core's trace resolver. */
export function setContainerTraceResolver(fn) {
  state.resolveTrace = fn;
} /** Server half: install the reactive core's async-iterable sharer. */
export function setAsyncIterableSharer(
  fn: (source: AsyncIterable<any>) => AsyncIterable<any>
): void;

/** Server half: install the reactive core's async-iterable sharer (solid: */
export function setAsyncIterableSharer(fn) {
  state.shareIterable = fn;
} /** Client half: install the reactive core's trace materializer. */
export function setContainerTraceMaterializer(
  fn: (marker: ContainerTraceMarker, claiming?: boolean) => unknown
): void;

/** Client half: install the reactive core's trace materializer. */
export function setContainerTraceMaterializer(fn) {
  state.materializeTrace = fn;
}

/** Serializer half: install the async-iterable → raw-seroval-stream mint */
export function setContainerTraceStreamMint(fn) {
  state.streamOf = fn;
} /** Whether a value is a traced container (server side; WeakMap probe, trap-safe). */
export function isContainerTraced(value: unknown): boolean;

/** Whether a value is a traced container (server side). */
export function isContainerTraced(value) {
  const resolve = state.resolveTrace;
  return !!(resolve && value && typeof value === "object" && resolve(value));
}

// The envelope: what actually crosses the serializer.
const TRACE = Symbol.for("solid.container-trace"); /**
 * A value's form at the serialization border (copy-on-write): traced
 * containers become envelopes, async iterables become seats on a shared
 * multicast. What a face passes to the serializer — seroval's own
 * classification (constructor reads, array claims) runs before plugins, so
 * raw containers can't be intercepted reliably, and a generator handed to
 * seroval raw is consumed by seroval alone.
 */
export function toBorderForm(value: unknown, envelopeContainers: boolean): unknown;

/** A value's form at the serialization border. */
export function toBorderForm(value, envelopeContainers) {
  if (value == null || typeof value !== "object") return value;
  const resolve = envelopeContainers ? state.resolveTrace : undefined;
  const share = state.shareIterable;
  if (!resolve && !share) return value;
  return rewriteTree(
    value,
    v => {
      if (resolve) {
        const trace = resolve(v);
        if (trace) return { [TRACE]: trace };
      }
      // Before the plain-object walk: an iterable spelled as a literal
      if (share && isShareableIterable(v)) return share(v);
      return DESCEND;
    },
    false
  );
}

// An async iterable the sharer may take over: not one of seroval's own
function isShareableIterable(value) {
  try {
    if (value.__SEROVAL_STREAM__ === true) return false;
    if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return false;
    return typeof value[Symbol.asyncIterator] === "function";
  } catch {
    return false;
  }
}

// One live container per trace, however many places reference it: seroval's
function materialize(marker, claiming) {
  let value = state.materialized.get(marker.$tr);
  if (value === undefined) {
    value = state.materializeTrace(marker, claiming);
    state.materialized.set(marker.$tr, value);
    if (value !== null && typeof value === "object") state.materializedValues.add(value);
  }
  return value;
} /**
 * Whether a value is a container this module materialized (client side;
 * WeakSet probe, trap-safe — a pending container's property reads throw
 * not-ready, so classify with this BEFORE any async probe or compare).
 */
export function isMaterializedContainer(value: unknown): boolean;

/** Whether a value is a container this module materialized (client side). */
export function isMaterializedContainer(value) {
  return value !== null && typeof value === "object" && state.materializedValues.has(value);
} /** Whether a decoded value is a trace marker (client side, eval face). */
export function isContainerTraceMarker(value: unknown): value is ContainerTraceMarker;

/** Whether a decoded value is a trace marker: the eval face serializes a */
export function isContainerTraceMarker(value) {
  if (value == null || typeof value !== "object" || value.$tr == null) return false;
  const tr = value.$tr;
  return tr.__SEROVAL_STREAM__ === true || typeof tr[Symbol.asyncIterator] === "function";
} /** Deep-revive trace markers inside a decoded value (document-face slot args). */
export function reviveContainerTraces(value: unknown, claiming?: boolean): unknown;

/** Deep-revive trace markers inside a decoded value (document-face slot args */
export function reviveContainerTraces(value, claiming) {
  if (!state.materializeTrace || value == null || typeof value !== "object") return value;
  if (isContainerTraceMarker(value)) return materialize(value, claiming);
  // Plain containers only — anything exotic was either produced by the
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = reviveContainerTraces(value[i], claiming);
  } else if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) value[key] = reviveContainerTraces(value[key], claiming);
  }
  return value;
}

// The subscription crosses as a RAW seroval stream when the mint is
function parseTrace(value, ctx) {
  const trace = value[TRACE];
  const sub = trace.subscribe();
  return { a: trace.array ? 1 : 0, i: ctx.parse(state.streamOf ? state.streamOf(sub) : sub) };
}

/** Seroval plugin carrying reactive containers across the slot border as */
export const ContainerTracePlugin = {
  tag: "solid/container-trace",
  test(value) {
    // Matches the ENVELOPE, never a raw container (see TRACE above).
    return value != null && typeof value === "object" && TRACE in value;
  },
  parse: {
    sync() {
      // A trace is a stream; a sync parse has nowhere to put its later
      throw new Error("A reactive container can only be serialized by a streaming serializer.");
    },
    async async(value, ctx) {
      const trace = value[TRACE];
      const sub = trace.subscribe();
      return {
        a: trace.array ? 1 : 0,
        i: await ctx.parse(state.streamOf ? state.streamOf(sub) : sub)
      };
    },
    stream: parseTrace
  },
  serialize(node, ctx) {
    // Eval face: a marker literal, revived at the arg-read site (see
    return "{$tr:" + ctx.serialize(node.i) + ",$ta:" + node.a + "}";
  },
  deserialize(node, ctx) {
    const iterable = ctx.deserialize(node.i);
    const marker = { $tr: iterable, $ta: node.a };
    // Codec face: the decode runs where the materializer is resident — the
    return state.materializeTrace ? materialize(marker) : marker;
  }
};
