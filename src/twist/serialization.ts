// Values over the wire (JSON node trees, read without eval) and into pages (script): Solid's serialization API on
// our serializer, with the web platform's values as plugins.
// @ts-nocheck
import { ContainerTracePlugin, setContainerTraceStreamMint } from "./frames/frame-container-plugin.ts";
import {
  Feature,
  Serializer,
  createPlugin as createPluginImpl,
  createStream,
  OpaqueReference as OpaqueReferenceImpl,
  crossHeader,
  fromCrossJSON,
  toCrossJSONStream,
} from "../serial.js";
import {
  AbortSignalPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLPlugin,
  URLSearchParamsPlugin,
} from "./web-plugins.ts";

export interface SerovalNode {
  t: number;
  i?: number | undefined;
  [key: string]: unknown;
}
export interface SerializerPlugin<Value = any, Info = any> {
  tag: string;
  extends?: SerializerPlugin[];
  test(value: unknown): boolean;
  parse: { sync?: (value: Value, ctx: any, data: { id: number }) => Info; async?: (value: Value, ctx: any, data: { id: number }) => Promise<Info>; stream?: (value: Value, ctx: any, data: { id: number }) => Info };
  serialize(node: Info, ctx: { serialize(node: SerovalNode): string }, data: { id: number }): string;
  deserialize(node: Info, ctx: { deserialize<T>(node: SerovalNode): T }, data: { id: number }): Value;
}
export interface JSONCodecOptions {
  plugins?: SerializerPlugin[];
  disabledFeatures?: number;
  depthLimit?: number;
  serializeErrorStacks?: boolean;
}

/** The web platform's values every serializer knows. */
export const DEFAULT_WEB_PLUGINS = /* @__PURE__ */ Object.freeze([
  AbortSignalPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLSearchParamsPlugin,
  URLPlugin,
  // Projections across a frame's border as traces: protocol, so in every serializer's set (inert without a peer).
  ContainerTracePlugin,
]);

// A trace crosses as a raw seroval stream, its snapshot replayed synchronously where it is decoded.
setContainerTraceStreamMint((iterable: AsyncIterable<unknown>) => {
  const stream = createStream();
  (async () => {
    try {
      for await (const value of iterable) stream.next(value);
      stream.return(undefined);
    } catch (error) {
      stream.throw(error);
    }
  })();
  return stream;
});

/** `customPlugins` ahead of the defaults (so they can take a value a default would). */
export function resolveSerializerPlugins(customPlugins?: SerializerPlugin[]): SerializerPlugin[] {
  return customPlugins ? [...customPlugins, ...DEFAULT_WEB_PLUGINS] : [...DEFAULT_WEB_PLUGINS];
}

const JSON_CODEC_DEPTH_LIMIT = 64;
/** The codec's options with their defaults: no RegExp (a peer may be anyone), depth 64. Both peers must agree. */
export function resolveCodecOptions({ plugins, disabledFeatures, depthLimit, serializeErrorStacks }: JSONCodecOptions = {}) {
  return {
    plugins: resolveSerializerPlugins(plugins),
    disabledFeatures: disabledFeatures === undefined ? Feature.RegExp : disabledFeatures,
    depthLimit: depthLimit === undefined ? JSON_CODEC_DEPTH_LIMIT : depthLimit,
    serializeErrorStacks,
  };
}

/** Error stacks leave only while developing (or when asked): they show server paths. */
const serializeOnlyDisabledFeatures = (serializeErrorStacks?: boolean) =>
  (serializeErrorStacks === undefined ? process.env.NODE_ENV === "development" : serializeErrorStacks) ? 0 : Feature.ErrorPrototypeStack;

/** Reads what `serializeJSON` wrote, one node tree at a time; every tree of one stream through the same reader. */
export function createJSONDeserializer(options?: JSONCodecOptions) {
  const refs = new Map();
  const resolved = resolveCodecOptions(options);
  // Promises it makes are owned here (a peer's rejected promise nobody awaits must not end the process); deferreds a
  // later tree may settle are counted (open()).
  let owned = 0;
  const pendingResolvers = new Set<any>();
  const streams = new Set<any>();
  const STREAM = 1;
  const RESOLVER = 2;
  const classify = (value: any) => {
    if (value === null || typeof value !== "object") return 0;
    try {
      if (value.__SEROVAL_STREAM__) return STREAM;
      if (typeof value.s === "function" && typeof value.f === "function" && value.p instanceof Promise) return RESOLVER;
    } catch {}
    return 0;
  };
  const ownDecodedPromises = () => {
    if (refs.size === owned) return;
    let index = 0;
    for (const value of refs.values()) {
      if (index++ < owned) continue;
      if (value instanceof Promise) value.then(undefined, () => {});
      else {
        const kind = classify(value);
        if (kind === STREAM) streams.add(value);
        else if (kind === RESOLVER) {
          pendingResolvers.add(value);
          const settled = () => pendingResolvers.delete(value);
          value.p.then(settled, settled);
        }
      }
    }
    owned = refs.size;
  };
  const isOpenStream = (stream: any) => {
    let alive = true;
    const close = () => void (alive = false);
    const off = stream.on({ next() {}, throw: close, return: close });
    if (typeof off === "function") off();
    return alive;
  };
  function deserializeJSONChunk(node: SerovalNode) {
    try {
      return fromCrossJSON(node, { refs, ...resolved });
    } finally {
      ownDecodedPromises();
    }
  }
  /** Every value still waiting on trees that will not come: failed with `error`. */
  deserializeJSONChunk.abort = (error: unknown) => {
    for (const value of refs.values()) {
      const kind = classify(value);
      if (kind === STREAM) value.throw(error);
      else if (kind === RESOLVER) {
        value.p.then(undefined, () => {});
        value.f(error);
      }
    }
  };
  /** Every open stream ended as complete (promises left as they are). */
  deserializeJSONChunk.close = () => {
    for (const value of refs.values()) if (classify(value) === STREAM) value.return(undefined);
  };
  /** How many deferreds still wait on later trees. */
  deserializeJSONChunk.open = () => {
    let count = pendingResolvers.size;
    for (const stream of streams) {
      if (isOpenStream(stream)) count++;
      else streams.delete(stream);
    }
    return count;
  };
  return deserializeJSONChunk;
}

/** Keyed records from `createJSONSerializer` read into a table; `resolve({ $ref })` reads one (pending until it comes). */
export function createJSONDataTable(options?: JSONCodecOptions) {
  const deserialize = createJSONDeserializer(options);
  const table = new Map();
  const waits = new Map<string, any>();
  const settle = (w: any, s: number, value: unknown) => {
    const p = w.p;
    p.s = s;
    p.v = value;
    s === 1 ? w.r(value) : w.j(value);
    for (const c of p.c) c();
  };
  return {
    apply(record: { key?: string; node?: unknown; initial?: boolean }) {
      const value = deserialize(record.node as SerovalNode);
      if (record.initial) {
        table.set(record.key, value);
        const w = waits.get(record.key!);
        if (w) {
          waits.delete(record.key!);
          settle(w, 1, value);
        }
      }
    },
    get(key: string) {
      return table.get(key);
    },
    resolve(ref: { $ref: string }) {
      const key = ref.$ref;
      if (table.has(key)) return table.get(key);
      let w = waits.get(key);
      if (!w) {
        waits.set(key, (w = {}));
        const p: any = (w.p = new Promise((r, j) => ((w.r = r), (w.j = j))));
        p.s = 0;
        p.c = [];
        p.then(undefined, () => {});
      }
      return w.p;
    },
    close(error?: unknown) {
      for (const [key, w] of waits) settle(w, 2, error || new Error(`Stream ended without delivering {$ref: "${key}"}`));
      waits.clear();
    },
  };
}

export const createPlugin = createPluginImpl as <Value, Info>(plugin: SerializerPlugin<Value, Info>) => SerializerPlugin<Value, Info>;
export const OpaqueReference: { new <V, R = undefined>(value: V, replacement?: R): { readonly value: V; readonly replacement?: R } } = OpaqueReferenceImpl;

export interface WebSerializerOptions {
  globalIdentifier: string;
  scopeId?: string;
  disabledFeatures?: number;
  serializeErrorStacks?: boolean;
  plugins?: SerializerPlugin[];
  onData: (result: string) => void;
  onError?: (error: unknown) => void;
  onDone?: () => void;
}

/** A script serializer with the web plugins: values written under `globalIdentifier` as they land. */
export function createSerializer(options: WebSerializerOptions) {
  return new Serializer({
    ...options,
    plugins: resolveSerializerPlugins(options.plugins),
    disabledFeatures:
      (options.disabledFeatures === undefined ? Feature.AggregateError | Feature.BigIntTypedArray : options.disabledFeatures) | serializeOnlyDisabledFeatures(options.serializeErrorStacks),
  });
}

/** The serializer server rendering writes hydration data with (`_$HY.r`). */
export function createHydrationSerializer({ onData, onDone, scopeId, onError, plugins }: Omit<WebSerializerOptions, "globalIdentifier" | "disabledFeatures">) {
  return createSerializer({ scopeId, plugins, globalIdentifier: "_$HY.r", onData, onDone, onError });
}

/** The script that sets up a render scope's references, ahead of its data. */
export function getLocalHeaderScript(id?: string): string {
  return crossHeader(id) + ";";
}

/** `value` as node trees, given to `onParse(node, initial)`: the value, then what it waits for as it lands. */
export function serializeJSON(value: unknown, { onParse, onDone, onError, ...codecOptions }: JSONCodecOptions & { onParse: (node: SerovalNode, initial: boolean) => void; onError?: (e: unknown) => void; onDone?: () => void }) {
  const resolved = resolveCodecOptions(codecOptions);
  return toCrossJSONStream(value, {
    onParse,
    onDone,
    onError,
    ...resolved,
    disabledFeatures: resolved.disabledFeatures | serializeOnlyDisabledFeatures(resolved.serializeErrorStacks),
  });
}

/** Keyed records sharing one reference space: `write(key, value)`, `flush()` when no more come, `close()` to stop. */
export function createJSONSerializer({ onData, onDone, onError, plugins, disabledFeatures, depthLimit, serializeErrorStacks }: JSONCodecOptions & { onData: (record: { key: string; node: SerovalNode; initial: boolean }) => void; onError?: (e: unknown) => void; onDone?: () => void }) {
  const resolved = resolveCodecOptions({ plugins, disabledFeatures, depthLimit, serializeErrorStacks });
  const refs = new Map();
  const cancels = new Set<() => void>();
  let pendingWrites = 0;
  let flushed = false;
  let done = false;
  const maybeDone = () => {
    if (flushed && pendingWrites === 0 && !done) {
      done = true;
      onDone?.();
    }
  };
  return {
    write(key: string, value: unknown) {
      if (flushed) return;
      pendingWrites++;
      let settled = false;
      let cancel: (() => void) | null = null;
      const stop = toCrossJSONStream(value, {
        refs,
        plugins: resolved.plugins,
        disabledFeatures: resolved.disabledFeatures | serializeOnlyDisabledFeatures(resolved.serializeErrorStacks),
        onParse(node: SerovalNode, initial: boolean) {
          onData({ key, node, initial });
        },
        onError,
        onDone() {
          settled = true;
          if (cancel) cancels.delete(cancel);
          pendingWrites--;
          maybeDone();
        },
      });
      if (!settled) cancels.add((cancel = stop));
    },
    /** Values still being written (streams of values in flight). */
    get pending() {
      return pendingWrites;
    },
    flush() {
      flushed = true;
      maybeDone();
    },
    close() {
      flushed = true;
      for (const cancel of cancels) cancel();
      cancels.clear();
    },
  };
}
