// The wire both peers of a server function call agree on: addresses, headers, body formats, chunk framing, the
// single-flight envelope's delivery, and the codec's stream form. (Solid's server-functions/shared, byte for byte.)
// @ts-nocheck
import { getServerFunctionMetadata, isServerFunction } from "./registry.ts";
import { REVALIDATE_HEADER } from "../response.ts";
import type { JSONCodecOptions } from "../serialization.ts";

export {
  LIVE_LOCAL,
  LIVE_RESUME_FROM,
  LIVE_SOURCE,
  SERVER_FUNCTION_INVOKE,
  SERVER_FUNCTION_METADATA,
  getServerFunctionMetadata,
  getServerFunctionRPC,
  invoke,
  isServerFunction,
  provideServerFunctionRPC,
  withMeta,
} from "./registry.ts";
export type { InvokeOptions, ServerFunction, ServerFunctionInvoker, ServerFunctionMetadata, ServerFunctionRPC } from "./registry.ts";
export { FLASH_COOKIE, clearFlashCookie, hasFlashCookie, matchFlashCookie } from "../response.ts";

export interface SingleFlightPayload<T = unknown, D = unknown> {
  value: T;
  data: D;
}
export interface FlightDataContext {
  response: Response;
}
export type FlightDataConsumer<D = unknown> = (data: D | undefined, context: FlightDataContext) => void | Promise<void>;

// ---------------------------------------------------------------- codec options (both peers must agree)

const codecConfig: { codec: JSONCodecOptions | undefined } = { codec: undefined };
export function configureServerFunctionsCodec(codec: JSONCodecOptions | undefined) {
  codecConfig.codec = codec;
}
export function getServerFunctionsCodec(): JSONCodecOptions | undefined {
  return codecConfig.codec;
}

// ---------------------------------------------------------------- single-flight consumers (keyed by source id)

const UNNAMED_FLIGHT_SOURCE = "true";
const flightConfig = { consumers: new Map<string, FlightDataConsumer>() };

/** A source id must ride a comma-separated header: not empty, no comma, not the reserved "true". */
export function assertFlightSource(source: string) {
  if (source === UNNAMED_FLIGHT_SOURCE || source === "" || source.includes(","))
    throw new TypeError(
      `Invalid flight data source id "${source}": ids ride the ` +
        `${SINGLE_FLIGHT_HEADER} header as a comma-separated list, and "true" is ` +
        `reserved for the unnamed registration (the bare consumer/hook signatures).`,
    );
}

/** Where the client delivers single-flight data (one consumer per source; the unnamed one is "true"). */
export function subscribeFlightData<D = unknown>(sourceOrConsumer: string | FlightDataConsumer<D>, maybeConsumer?: FlightDataConsumer<D>): () => void {
  const named = typeof sourceOrConsumer === "string";
  if (named) assertFlightSource(sourceOrConsumer);
  const source = named ? sourceOrConsumer : UNNAMED_FLIGHT_SOURCE;
  const consumer = (named ? maybeConsumer : sourceOrConsumer) as FlightDataConsumer;
  flightConfig.consumers.set(source, consumer);
  return () => {
    if (flightConfig.consumers.get(source) === consumer) flightConfig.consumers.delete(source);
  };
}
export function getFlightDataConsumer(source?: string): FlightDataConsumer | undefined {
  return flightConfig.consumers.get(source === undefined ? UNNAMED_FLIGHT_SOURCE : source);
}
export function getFlightDataSourceIds(): string[] {
  return [...flightConfig.consumers.keys()];
}

/** A redirect or revalidation keys on a response: every consumer hears of it, folded or not. */
export function hasFlightMetadata(response: Response): boolean {
  return response.headers.has(REDIRECT_HEADER) || response.headers.has(REVALIDATE_HEADER);
}

/** Each consumer given its slice of a single-flight envelope's `data`, in order, once the slices have settled. */
export async function deliverFlightData(response: Response, data: any) {
  if (data) await Promise.allSettled(Object.values(data).flatMap((s: any) => (s && typeof s == "object" ? Object.values(s) : [])));
  const folded = (response.headers.get(SINGLE_FLIGHT_HEADER) || "").split(",");
  const metadata = hasFlightMetadata(response);
  for (const source of getFlightDataSourceIds()) {
    if (!metadata && !folded.includes(source)) continue;
    const consumer = getFlightDataConsumer(source);
    if (consumer) await consumer(data ? data[source] : undefined, { response });
  }
}

// ---------------------------------------------------------------- addresses

/** A server-component call's address: its id, and a realm-stable hash of its arguments when it has any. */
export function frameAddress(id: string, args?: readonly unknown[]): string {
  return args && args.length ? id + ":" + hashArguments(args) : id;
}
function hashArguments(args: readonly unknown[]) {
  let hash = 0;
  const text = stableString(args);
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}
function stableString(value: any, seen?: Set<unknown>): string {
  if (value === null || typeof value !== "object") return typeof value === "bigint" ? value + "n" : String(value);
  if (value instanceof Date) return "Date:" + value.getTime();
  seen ||= new Set();
  if (seen.has(value)) return "~";
  seen.add(value);
  if (value instanceof Map) {
    const entries: string[] = [];
    for (const [k, v] of value) entries.push(stableString(k, seen) + "=>" + stableString(v, seen));
    return "Map{" + entries.sort().join(",") + "}";
  }
  if (value instanceof Set) {
    const members: string[] = [];
    for (const v of value) members.push(stableString(v, seen));
    return "Set{" + members.sort().join(",") + "}";
  }
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) out += (i ? "," : "") + stableString(value[i], seen);
    return out + "]";
  }
  const keys = Object.keys(value).sort();
  let out = "{";
  for (let i = 0; i < keys.length; i++) out += (i ? "," : "") + keys[i] + ":" + stableString(value[keys[i]], seen);
  return out + "}";
}

const mountOf = (endpoint: string) => (endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint);
/** The plain-HTTP address of a function (forms, hand-made calls): `<endpoint>/<id>`. */
export function serverFunctionAddress(endpoint: string, id: string): string {
  return `${mountOf(endpoint)}/${encodeURIComponent(id)}`;
}
/** A scripted call's address: `<endpoint>/data/<id>` (its answers are the codec's). */
export function serverFunctionDataAddress(endpoint: string, id: string): string {
  return `${mountOf(endpoint)}/data/${encodeURIComponent(id)}`;
}
/** A live call's address: `<endpoint>/live/<id>` (an event stream). */
export function serverFunctionLiveAddress(endpoint: string, id: string): string {
  return `${mountOf(endpoint)}/live/${encodeURIComponent(id)}`;
}
/** An address read back into its id and caller kind; anything else is null. */
export function parseServerFunctionAddress(pathname: string, endpoint: string): { id: string; data: boolean; live: boolean } | null {
  const mount = mountOf(endpoint);
  if (!pathname.startsWith(mount)) return null;
  const rest = pathname.slice(mount.length);
  if (!rest.startsWith("/")) return null;
  let segment = rest.slice(1);
  let data = false;
  let live = false;
  if (segment.startsWith("data/")) {
    segment = segment.slice(5);
    data = true;
  } else if (segment.startsWith("live/")) {
    segment = segment.slice(5);
    live = true;
  }
  if (!segment || segment.includes("/")) return null;
  try {
    return { id: decodeURIComponent(segment), data, live };
  } catch {
    return null;
  }
}

/** Longer than this, a GET() call goes out as a POST. */
export const MAX_GET_URL_LENGTH = 2000;

function urlTargetId(target: any, helper: string) {
  if (typeof target === "string") return target;
  if (isServerFunction(target) && typeof target.id === "string") return target.id;
  throw new Error(`${helper} expects a server function reference (or its id).`);
}

/** A function's plain-HTTP address with its bound arguments (JSON only: a form post has no codec). */
export function serverFunctionActionUrlFor(endpoint: string, target: any, boundArgs: readonly unknown[]): string {
  const address = serverFunctionAddress(endpoint, urlTargetId(target, "serverFunctionActionUrl"));
  if (!boundArgs.length) return address;
  if (!isJSONSafe(boundArgs))
    throw new Error(
      "Bound arguments in an action url must be JSON-safe: the server reads them the way it " +
        "reads a form post's, and that convention has no codec. Pass the value through the " +
        "function's body, or call the reference instead of rendering a url for it.",
    );
  return `${address}?args=${encodeURIComponent(JSON.stringify(boundArgs))}`;
}

/** The url a GET() reference's call requests (the live address for a live one). */
export function serverFunctionUrlFor(endpoint: string, fn: any, args: readonly unknown[]): string {
  if (!isServerFunction(fn) || typeof fn.id !== "string") throw new Error("serverFunctionUrl expects a server function reference.");
  const metadata = getServerFunctionMetadata(fn);
  if (!metadata || metadata.method !== "GET")
    throw new Error(
      `serverFunctionUrl: "${fn.id}" is not a declared read. A call over the default ` +
        "transport is a POST — its arguments travel in the body, so no url describes it. " +
        "Declare the function with GET(fn) for a cacheable read that has a url, or start " +
        'the call itself: invoke(fn, { priority: "low" }, ...args).',
    );
  const address = metadata.live ? serverFunctionLiveAddress(endpoint, fn.id) : serverFunctionDataAddress(endpoint, fn.id);
  if (!args.length) return address;
  if (!isJSONSafe(args))
    throw new Error(
      "Arguments in a server function url must be JSON-safe: the transport encodes anything " +
        "else through the codec asynchronously, and a url rendered as a value cannot wait for " +
        "it. Pass JSON-safe arguments, or call the reference instead of rendering a url for it.",
    );
  const url = `${address}?args=${encodeURIComponent(JSON.stringify(args))}`;
  const length = new URL(url, globalThis.location?.href || "http://localhost").href.length;
  if (length > MAX_GET_URL_LENGTH)
    throw new Error(
      `serverFunctionUrl: the url for "${fn.id}" with these arguments is ${length} characters; ` +
        `past ${MAX_GET_URL_LENGTH} the call dispatches over POST (a cache miss rather than a ` +
        "414), so no url describes it. Shorten the arguments, or call the reference instead.",
    );
  return url;
}

// ---------------------------------------------------------------- headers

/** A thrown error's message (latin1 as it is, anything else percent-encoded behind a marker). */
export const ERROR_HEADER = "X-Server-Function-Error";
const ERROR_HEADER_MARKER = "=?1?";
const NEEDS_ENCODING = /[^\x20-\x7e\xa0-\xff]/;
export function encodeErrorHeaderValue(value: string): string {
  let stripped = String(value).replace(/[\r\n]+/g, "");
  if (!NEEDS_ENCODING.test(stripped) && !stripped.startsWith(ERROR_HEADER_MARKER) && stripped === stripped.trim()) return stripped;
  stripped =
    typeof (stripped as any).toWellFormed === "function"
      ? (stripped as any).toWellFormed()
      : stripped.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  return ERROR_HEADER_MARKER + encodeURIComponent(stripped);
}
export function decodeErrorHeaderValue(value: string): string {
  if (typeof value !== "string" || !value.startsWith(ERROR_HEADER_MARKER)) return value;
  try {
    return decodeURIComponent(value.slice(ERROR_HEADER_MARKER.length));
  } catch {
    return value;
  }
}

/** The body's format (a `BodyFormat`). */
export const BODY_FORMAT_HEADER = "X-Server-Function-Format";
/** Where a live loop reconnects from. */
export const LAST_EVENT_ID_HEADER = "Last-Event-ID";
/** The live loop's per-iteration slot in its invoke options. */
export const LIVE_WIRE = Symbol("solid.LiveWire");
/** An id this deployment does not know (version skew). */
export const UNKNOWN_HEADER = "X-Server-Function-Unknown";
/** A redirect for scripted callers: `<status> <absolute url>`. */
export const REDIRECT_HEADER = "X-Server-Function-Redirect";

/** The status and absolute http(s) target of a redirect header; anything else is undefined. */
export function decodeRedirectHeaderValue(value: string | null | undefined): { status: number; url: string } | undefined {
  if (typeof value !== "string") return undefined;
  const at = value.indexOf(" ");
  if (at < 0) return undefined;
  const status = Number(value.slice(0, at));
  const url = value.slice(at + 1);
  if (!Number.isInteger(status) || !url) return undefined;
  if (status !== 301 && status !== 302 && status !== 303 && status !== 307 && status !== 308) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return { status, url };
}

/** The single-flight protocol: on a request, the sources it can take; on a response, the ones folded in. */
export const SINGLE_FLIGHT_HEADER = "X-Single-Flight";
/** The FormData key a lone File argument rides under. */
export const FILE_FORM_KEY = "__server_function_file__";

export const BodyFormat = {
  Serialized: "0",
  String: "1",
  FormData: "2",
  URLSearchParams: "3",
  Blob: "4",
  File: "5",
  ArrayBuffer: "6",
  Uint8Array: "7",
  Json: "8",
  Void: "9",
};
export type BodyFormatValue = (typeof BodyFormat)[keyof typeof BodyFormat];

// ---------------------------------------------------------------- JSON-safe values (the fast path)

const JSON_SAFE_DEPTH_LIMIT = 4096;
const EXIT = {};
/** Whether `JSON.stringify` round-trips `value` exactly (else it needs the codec). Never throws. */
export function isJSONSafe(value: unknown): boolean {
  const stack: unknown[] = [value];
  const ancestors = new Set<unknown>();
  while (stack.length) {
    const v: any = stack.pop();
    if (v === EXIT) {
      ancestors.delete(stack.pop());
      continue;
    }
    if (v === null) continue;
    const t = typeof v;
    if (t === "string" || t === "boolean") continue;
    if (t === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0)) return false;
      continue;
    }
    if (t !== "object") return false;
    if (ancestors.has(v) || ancestors.size >= JSON_SAFE_DEPTH_LIMIT) return false;
    ancestors.add(v);
    stack.push(v, EXIT);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push(v[i]);
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false;
      if (Symbol.asyncIterator in v || Symbol.iterator in v) return false;
      for (const k in v) {
        // (Through the descriptor: a getter is not run here.)
        const descriptor = Object.getOwnPropertyDescriptor(v, k);
        if (descriptor === undefined || !("value" in descriptor)) return false;
        stack.push(descriptor.value);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------- bodies

/** The direct HTTP encoding of a value that has one (string, FormData, File, Blob, …), else undefined. */
export function getHeadersAndBody(body: any): { headers?: Record<string, string>; body: BodyInit } | undefined {
  switch (true) {
    case typeof body === "string":
      return { headers: { "Content-Type": "text/plain", [BODY_FORMAT_HEADER]: BodyFormat.String }, body };
    case body instanceof FormData:
      return { headers: { [BODY_FORMAT_HEADER]: BodyFormat.FormData }, body };
    case body instanceof URLSearchParams:
      return { headers: { "Content-Type": "application/x-www-form-urlencoded", [BODY_FORMAT_HEADER]: BodyFormat.URLSearchParams }, body };
    case typeof File !== "undefined" && body instanceof File: {
      const formData = new FormData();
      formData.append(FILE_FORM_KEY, body, body.name);
      return { headers: { [BODY_FORMAT_HEADER]: BodyFormat.File }, body: formData };
    }
    case body instanceof Blob:
      return { headers: { ...(body.type ? { "Content-Type": body.type } : {}), [BODY_FORMAT_HEADER]: BodyFormat.Blob }, body };
    case body instanceof ArrayBuffer:
      return { headers: { [BODY_FORMAT_HEADER]: BodyFormat.ArrayBuffer }, body };
    case body instanceof Uint8Array:
      return { headers: { [BODY_FORMAT_HEADER]: BodyFormat.Uint8Array }, body: new Uint8Array(body) };
    default:
      return undefined;
  }
}

/** A body read by its format tag (or, for a form post, its content type). Consumes `source`. */
export async function extractBody(source: Request | Response, codecOptions?: JSONCodecOptions, wire?: any): Promise<unknown> {
  const contentType = source.headers.get("content-type");
  const format = source.headers.get(BODY_FORMAT_HEADER);
  switch (true) {
    case format === BodyFormat.Serialized:
      return await deserializeStream(source, codecOptions, wire);
    case format === BodyFormat.Json:
      return JSON.parse(await source.text());
    case format === BodyFormat.String:
      return await source.text();
    case format === BodyFormat.File: {
      const formData = await source.formData();
      return formData.get(FILE_FORM_KEY);
    }
    case format === BodyFormat.FormData:
    case contentType && contentType.startsWith("multipart/form-data"):
      return await source.formData();
    case format === BodyFormat.URLSearchParams:
    case contentType && contentType.startsWith("application/x-www-form-urlencoded"):
      return new URLSearchParams(await source.text());
    case format === BodyFormat.Blob: {
      const blob = await source.blob();
      return blob.type || !contentType ? blob : new Blob([blob], { type: contentType });
    }
    case format === BodyFormat.ArrayBuffer:
      return await source.arrayBuffer();
    case format === BodyFormat.Uint8Array:
      return new Uint8Array(await source.arrayBuffer());
  }
  return undefined;
}

// ---------------------------------------------------------------- framing: `;0x<8 hex digits>;` + UTF-8 payload

const CHUNK_ENCODER = /* @__PURE__ */ new TextEncoder();
const CHUNK_DECODER = /* @__PURE__ */ new TextDecoder("utf-8", { fatal: true });
const MAX_CHUNK_BYTES = 0xffffffff;
const RETAINED_STORE_BYTES = 64 * 1024;
const DONE = { done: true, value: undefined };
const malformedStream = () => new Error("Malformed server function stream.");

/** One payload framed for the wire. */
export function createChunk(data: string): Uint8Array {
  const encodeData = CHUNK_ENCODER.encode(data);
  const bytes = encodeData.length;
  if (bytes > MAX_CHUNK_BYTES) throw new RangeError("Server function chunk is too large to frame.");
  const chunk = new Uint8Array(12 + bytes);
  chunk.set(CHUNK_ENCODER.encode(`;0x${bytes.toString(16).padStart(8, "0")};`));
  chunk.set(encodeData, 12);
  return chunk;
}

/** Framed payloads read back one at a time (`next()`), whatever the network's read boundaries. */
export class ChunkReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  store = new Uint8Array(0);
  buffer = this.store;
  done = false;
  cancelled = false;
  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }
  /** One read into the buffer (growth amortized: append, compact, or double); whether the read was cancelled. */
  async readChunk() {
    const chunk = await this.reader.read();
    if (chunk.done) {
      this.done = true;
      return this.cancelled;
    }
    const incoming = chunk.value;
    const store = this.store;
    const start = this.buffer.byteOffset;
    const end = start + this.buffer.length;
    const needed = this.buffer.length + incoming.length;
    if (end + incoming.length <= store.length) {
      store.set(incoming, end);
      this.buffer = store.subarray(start, end + incoming.length);
    } else if (needed <= store.length) {
      store.copyWithin(0, start, end);
      store.set(incoming, this.buffer.length);
      this.buffer = store.subarray(0, needed);
    } else {
      const grown = new Uint8Array(Math.max(needed, store.length * 2));
      grown.set(this.buffer);
      grown.set(incoming, this.buffer.length);
      this.store = grown;
      this.buffer = grown.subarray(0, needed);
    }
    return this.cancelled;
  }
  async next(): Promise<{ done: boolean; value: string | undefined }> {
    if (this.cancelled) return DONE;
    while (this.buffer.length < 12) {
      if (this.done) {
        if (this.buffer.length === 0) return DONE;
        throw malformedStream();
      }
      if (await this.readChunk()) return DONE;
    }
    const header = String.fromCharCode(...this.buffer.subarray(0, 12));
    if (!/^;0x[\dA-Fa-f]{8};$/.test(header)) throw malformedStream();
    const bytes = parseInt(header.slice(3, 11), 16);
    while (bytes > this.buffer.length - 12) {
      if (this.done) throw malformedStream();
      if (await this.readChunk()) return DONE;
    }
    let partial: string;
    try {
      partial = CHUNK_DECODER.decode(this.buffer.subarray(12, 12 + bytes));
    } catch {
      throw malformedStream();
    }
    this.buffer = this.buffer.subarray(12 + bytes);
    // A large store shrinks to what is left to read once a frame is out.
    if (this.store.length > RETAINED_STORE_BYTES && this.buffer.length <= RETAINED_STORE_BYTES) this.store = this.buffer = this.buffer.slice();
    return { done: false, value: partial };
  }
  async drain(interpret: (chunk: string) => void) {
    try {
      while (true) {
        const result = await this.next();
        if (result.done) break;
        interpret(result.value!);
      }
    } catch (error) {
      this.cancel(error).catch(() => {});
      throw error;
    }
  }
  /** The read ended: the body cancelled, a pending `next()` done. */
  cancel(reason?: unknown) {
    this.cancelled = true;
    return this.reader.cancel(reason);
  }
}

/** One payload framed as a server-sent event (a live address's framing). */
export function createEventChunk(data: string, id?: string): Uint8Array {
  let event = id !== undefined && !id.includes("\0") ? `id: ${id}\n` : "";
  for (const line of data.split(/\r\n|\r|\n/)) event += `data: ${line}\n`;
  return CHUNK_ENCODER.encode(event + "\n");
}
/** What a live response writes while idle. */
export const EVENT_STREAM_HEARTBEAT = /* @__PURE__ */ new TextEncoder().encode(":\n\n");

export function isEventStream(source: Request | Response): boolean {
  const contentType = source.headers.get("content-type");
  return !!contentType && contentType.startsWith("text/event-stream");
}

/** Events read back one at a time, each event's id kept as the live loop's position. */
export class EventStreamReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder = new TextDecoder();
  buffer = "";
  done = false;
  data: string[] | null = null;
  id: string | undefined = undefined;
  constructor(
    stream: ReadableStream<Uint8Array>,
    public wire?: any,
  ) {
    this.reader = stream.getReader();
  }
  async read() {
    const chunk = await this.reader.read();
    if (chunk.done) {
      this.done = true;
      this.buffer += this.decoder.decode();
    } else this.buffer += this.decoder.decode(chunk.value, { stream: true });
  }
  /** The next whole line (CR, LF or CRLF; a CR at the end waits for what follows it), or null. */
  takeLine() {
    const buffer = this.buffer;
    const cr = buffer.indexOf("\r");
    const lf = buffer.indexOf("\n");
    const end = cr < 0 ? lf : lf < 0 ? cr : Math.min(cr, lf);
    if (end < 0) return null;
    let skip = 1;
    if (buffer[end] === "\r") {
      if (end + 1 === buffer.length) {
        if (!this.done) return null;
      } else if (buffer[end + 1] === "\n") skip = 2;
    }
    this.buffer = buffer.slice(end + skip);
    return buffer.slice(0, end);
  }
  async next(): Promise<{ done: boolean; value: string | undefined }> {
    while (true) {
      const line = this.takeLine();
      if (line === null) {
        if (this.done) return { done: true, value: undefined };
        await this.read();
        continue;
      }
      if (line === "") {
        const data = this.data;
        const id = this.id;
        this.data = null;
        this.id = undefined;
        if (data === null) continue;
        if (id !== undefined && this.wire) this.wire.position = id;
        return { done: false, value: data.join("\n") };
      }
      if (line[0] === ":") continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value[0] === " ") value = value.slice(1);
      if (field === "data") (this.data ??= []).push(value);
      else if (field === "id" && !value.includes("\0")) this.id = value;
    }
  }
  async drain(interpret: (chunk: string) => void) {
    while (true) {
      const result = await this.next();
      if (result.done) break;
      interpret(result.value!);
    }
  }
  cancel(reason?: unknown) {
    return this.reader.cancel(reason);
  }
}

/** A JSON-safe value's digest (the live loop's position for a value it yields); undefined for anything else. */
export function positionDigest(value: unknown): string | undefined {
  if (value === undefined || !isJSONSafe(value)) return undefined;
  const text = JSON.stringify(value);
  if (typeof text !== "string") return undefined;
  return textDigest(text);
}
/** FNV-1a in two 32-bit lanes: 16 hex digits. */
export function textDigest(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- the codec's stream form

/** A frame opening with `!` is an error after the head was sent: `!{name?, message}`. */
const ERROR_TRAILER_PREFIX = "!";
export function encodeErrorTrailer(error: unknown): string {
  const shaped = error instanceof Error ? error : new Error(String(error));
  return ERROR_TRAILER_PREFIX + JSON.stringify(shaped.name && shaped.name !== "Error" ? { name: shaped.name, message: shaped.message } : { message: shaped.message });
}
function errorFromTrailer(payload: string) {
  let shape: any;
  try {
    shape = JSON.parse(payload.slice(1));
  } catch {
    shape = null;
  }
  const error = new Error(shape && typeof shape.message === "string" ? shape.message : "Server function result could not be delivered.");
  if (shape && typeof shape.name === "string") error.name = shape.name;
  return error;
}

/** `value` as framed node trees; the stream stays open until what it waits for has landed. */
export function serializeStream(value: unknown, codecOptions?: JSONCodecOptions): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const { serializeJSON } = await import("../serialization.ts");
      serializeJSON(value, {
        ...codecOptions,
        onParse(node) {
          controller.enqueue(createChunk(JSON.stringify(node)));
        },
        onDone() {
          controller.close();
        },
        onError(error) {
          controller.error(error);
        },
      });
    },
  });
}
/** `serializeStream` read to the end, as text. */
export async function serializeString(value: unknown, codecOptions?: JSONCodecOptions): Promise<string> {
  return await new Response(serializeStream(value, codecOptions)).text();
}

/** A framed body's value (its first frame); later frames settle what it waits for. */
export async function deserializeStream(source: Request | Response, codecOptions?: JSONCodecOptions, wire?: any): Promise<any> {
  if (!source.body) throw new Error("missing body");
  const reader = wire && isEventStream(source) ? wire.open(source.body) : new ChunkReader(source.body);
  try {
    const result = await reader.next();
    if (!result.done) {
      if (result.value.startsWith(ERROR_TRAILER_PREFIX)) throw errorFromTrailer(result.value);
      const { createJSONDeserializer } = await import("../serialization.ts");
      const deserializeChunk = createJSONDeserializer(codecOptions);
      const interpretChunk = (chunk: string) => {
        if (chunk.startsWith(ERROR_TRAILER_PREFIX)) throw errorFromTrailer(chunk);
        return deserializeChunk(JSON.parse(chunk));
      };
      // The body's end: what still waits is failed, or, for a live loop, told (it decides).
      const connection = wire && wire.connection;
      let endConnection: (v: unknown) => void;
      if (connection) connection.ended = new Promise((resolve) => (endConnection = resolve));
      const end = (error: unknown) => {
        const sweep = () => deserializeChunk.abort(error);
        if (connection) endConnection({ open: deserializeChunk.open(), error, sweep, close: () => deserializeChunk.close() });
        else sweep();
      };
      reader.drain(interpretChunk).then(
        () => end(new Error("Server function stream ended unexpectedly.")),
        (error: unknown) => end(error),
      );
      return interpretChunk(result.value);
    }
  } catch (error) {
    reader.cancel(error).catch(() => {});
    throw error;
  }
}
export async function deserializeString(text: string, codecOptions?: JSONCodecOptions) {
  return await deserializeStream(new Response(text), codecOptions);
}

/** A response's body as a value (read from a clone), with the configured codec; undefined when it has none. */
export async function decodeResponse(response: Response, codecOptions?: JSONCodecOptions) {
  if (!response.body) return undefined;
  return await extractBody(response.clone(), codecOptions === undefined ? codecConfig.codec : codecOptions);
}
/** `decodeResponse`, with a single-flight envelope split into `{ value, flightData }`. */
export async function decodeResponsePayload(response: Response, codecOptions?: JSONCodecOptions) {
  const decoded: any = await decodeResponse(response, codecOptions);
  if (decoded !== undefined && response.headers.has(SINGLE_FLIGHT_HEADER)) return { value: decoded.value, flightData: decoded.data };
  return { value: decoded };
}
