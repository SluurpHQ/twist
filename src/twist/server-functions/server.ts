// The server half of server functions: compiled `"use server"` output registers each function
// (`registerServerReference`) and references it (`createServerReference`: during SSR the function runs in-process
// under a per-call request event). `handleServerFunctionRequest` is the web-standard HTTP handler. (Solid's
// server-functions/server.)
// @ts-nocheck
import { NULL_BODY_STATUSES, RESPONSE_HEADER_VALUE_LIMIT, REVALIDATE_HEADER, COMPOSED_BODY_FRAMING, isHttpNavigationTarget, isResponseEnvelope, isSafeError } from "../response.ts";
import { RequestContext, commitEventResponse, getRequestEvent, reportServerError, requestErrorHook, emitFinding, errorText } from "../request.ts";
import { observeInvocation } from "../observe.ts";
import { encodeFlashCookie, setFlashSecret } from "./flash.ts";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  LIVE_SOURCE,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SERVER_FUNCTION_METADATA,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  assertFlightSource,
  configureServerFunctionsCodec,
  decodeResponse,
  deserializeString,
  encodeErrorHeaderValue,
  extractBody,
  getHeadersAndBody,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  isJSONSafe,
  isServerFunction,
  parseServerFunctionAddress,
  provideServerFunctionRPC,
  serverFunctionActionUrlFor,
  serverFunctionAddress,
  serverFunctionUrlFor,
  createChunk,
  createEventChunk,
  EVENT_STREAM_HEARTBEAT,
  LAST_EVENT_ID_HEADER,
  positionDigest,
  encodeErrorTrailer,
  withMeta,
} from "./shared.ts";

export {
  ChunkReader,
  ERROR_HEADER,
  FLASH_COOKIE,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  clearFlashCookie,
  createChunk,
  createEventChunk,
  decodeErrorHeaderValue,
  decodeRedirectHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  encodeErrorHeaderValue,
  frameAddress,
  getServerFunctionMetadata,
  hasFlashCookie,
  invoke,
  isServerFunction,
  serializeStream,
  subscribeFlightData,
  textDigest,
  withMeta,
} from "./shared.ts";
export { decodeFlashCookie, encodeFlashCookie } from "./flash.ts";

const config: any = {
  provideEvent: undefined,
  wrapInvocation: undefined,
  collectFlightData: undefined,
  transformResult: undefined,
  transformFlightResult: undefined,
  transformDirectResult: undefined,
  handleNoJS: undefined,
  endpoint: "/_server",
  csrf: true,
  bodySizeLimit: 1_048_576,
  maxArguments: 1000,
  chaosReconnectEvery: 0,
};

/** The server runtime's settings (once, at startup): event provider, invocation wrap, hooks, endpoint, CSRF, codec, limits, secret. */
export function configureServerFunctionsServer({
  provideEvent,
  wrapInvocation,
  collectFlightData,
  transformResult,
  transformFlightResult,
  transformDirectResult,
  handleNoJS,
  endpoint,
  csrf,
  codec,
  bodySizeLimit,
  maxArguments,
  secret,
  chaosReconnectEvery,
}: any = {}) {
  if (provideEvent !== undefined) config.provideEvent = provideEvent;
  if (wrapInvocation !== undefined) config.wrapInvocation = wrapInvocation;
  if (collectFlightData !== undefined) config.collectFlightData = collectFlightData;
  if (transformResult !== undefined) config.transformResult = transformResult;
  if (transformFlightResult !== undefined) config.transformFlightResult = transformFlightResult;
  if (transformDirectResult !== undefined) config.transformDirectResult = transformDirectResult;
  if (handleNoJS !== undefined) config.handleNoJS = handleNoJS;
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (csrf !== undefined) config.csrf = csrf;
  if (codec !== undefined) configureServerFunctionsCodec(codec);
  if (bodySizeLimit !== undefined) config.bodySizeLimit = bodySizeLimit;
  if (maxArguments !== undefined) config.maxArguments = maxArguments;
  if (secret !== undefined) setFlashSecret(secret);
  if (chaosReconnectEvery !== undefined) config.chaosReconnectEvery = chaosReconnectEvery;
}

// Named single-flight sources (beside the unnamed `collectFlightData`, a router's).
const flightSources = new Map();
/** A named single-flight data source (the server half of `subscribeFlightData(source, consumer)`). */
export function registerFlightDataSource(source: string, hook: Function) {
  assertFlightSource(source);
  flightSources.set(source, hook);
  return () => {
    if (flightSources.get(source) === hook) flightSources.delete(source);
  };
}

function resolveWrapInvocation(hook) {
  if (hook === undefined || typeof hook === "function") return hook;
  throw new Error(
    `Invalid wrapInvocation: expected a function, received ${hook === null ? "null" : typeof hook}. A hook that is not callable cannot wrap the call - configure a function, or leave ` +
      `wrapInvocation undefined.`,
  );
}

function provideEvent(event, fn) {
  if (config.provideEvent) return config.provideEvent(event, fn);
  const ctx = globalThis[RequestContext];
  if (ctx) return ctx.run(event, fn);
  throw new Error("No request event provider. Configure one with configureServerFunctionsServer({ provideEvent }).");
}

const PROVIDE_EVENT_TWICE =
  "provideEvent invoked the server function callback more than once: a second invocation " +
  "would commit the call's side effects twice. The hook must call fn exactly once and return " +
  "its result.";
const PROVIDE_EVENT_NEVER =
  "provideEvent returned without invoking the server function callback: the call would have " +
  "answered as a void success without running the function. The hook must call fn exactly once " +
  "and return its result.";

/** The provider's contract enforced: the callback runs exactly once (a second run is refused before it starts). */
function provideEventOnce(provide, event, run) {
  let invocations = 0;
  const settle = () => {
    if (invocations !== 1) throw new Error(invocations === 0 ? PROVIDE_EVENT_NEVER : PROVIDE_EVENT_TWICE);
  };
  const result = provide(event, () => {
    if (++invocations > 1) throw new Error(PROVIDE_EVENT_TWICE);
    return run();
  });
  const promised = nativePromise(result);
  if (promised)
    return promised.then((value) => {
      settle();
      return value;
    });
  settle();
  return result;
}

// ---------------------------------------------------------------- deferred bodies keep their call's event

/** A result whose work runs later (a promise's continuation, a stream, a generator), bound to the call's scope; one container down too. */
function scopeDeferredResult(value, scope) {
  const bound = bindDeferredBody(value, scope);
  if (bound !== value || value === null || typeof value !== "object") return bound;
  return scopeDeferredContents(value, scope);
}

class ScopeFrame {
  i = 0;
  changed = false;
  constructor(
    public value,
    public next,
    public keys,
    public descriptors,
  ) {}
}
function enterScopeCarrier(value, state) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  if (state.seen.has(value)) {
    state.cyclic.add(value);
    return state.seen.get(value);
  }
  const bound = bindDeferredBody(value, state.scope);
  if (bound !== value) {
    state.seen.set(value, bound);
    return bound;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (Object.isFrozen(value)) {
      state.seen.set(value, value);
      return value;
    }
    const next = value.slice();
    state.seen.set(value, next);
    return new ScopeFrame(value, next, null, null);
  }
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Object.isFrozen(value)) {
    state.seen.set(value, value);
    return value;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const next = Object.create(prototype, descriptors);
  state.seen.set(value, next);
  return new ScopeFrame(value, next, Object.keys(value), descriptors);
}
/** (Iterative: a deep result must not overflow the stack.) */
function scopeDeferredContents(root, scope) {
  const state = { seen: new Map(), cyclic: new Set(), scope };
  const entered = enterScopeCarrier(root, state);
  if (!(entered instanceof ScopeFrame)) return entered;
  const stack = [entered];
  let delivered = NOTHING;
  for (;;) {
    const top = stack[stack.length - 1];
    const length = top.keys ? top.keys.length : top.value.length;
    let pushed = null;
    while (top.i < length) {
      const i = top.i;
      let original;
      let writable = true;
      if (top.keys) {
        const descriptor = top.descriptors[top.keys[i]];
        writable = "value" in descriptor && descriptor.writable === true;
        original = writable ? descriptor.value : undefined;
      } else original = top.value[i];
      if (!writable) {
        top.i++;
        continue;
      }
      let bound;
      if (delivered !== NOTHING) {
        bound = delivered;
        delivered = NOTHING;
      } else {
        bound = enterScopeCarrier(original, state);
        if (bound instanceof ScopeFrame) {
          pushed = bound;
          break;
        }
      }
      if (bound !== original) {
        if (top.keys) top.next[top.keys[i]] = bound;
        else top.next[i] = bound;
        top.changed = true;
      }
      top.i++;
    }
    if (pushed !== null) {
      stack.push(pushed);
      continue;
    }
    stack.pop();
    let out;
    if (top.changed || state.cyclic.has(top.value)) out = top.next;
    else {
      state.seen.set(top.value, top.value);
      out = top.value;
    }
    if (stack.length === 0) return out;
    delivered = out;
  }
}
function bindDeferredBody(value, scope) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const promised = scope(() => nativePromise(value));
  if (promised) return promised.then((result) => scope(() => scopeDeferredResult(result, scope)));
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    let reader;
    return new ReadableStream(
      {
        async pull(controller) {
          try {
            const step = await scope(() => {
              if (!reader) reader = value.getReader();
              return reader.read();
            });
            if (step.done) controller.close();
            else controller.enqueue(step.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return scope(() => (reader ? reader.cancel(reason) : value.cancel(reason)));
        },
      },
      { highWaterMark: 0 },
    );
  }
  const scopedIterator = (symbol) => ({
    [symbol]() {
      const iterator = scope(() => value[symbol]());
      return new Proxy(iterator, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          return typeof member === "function" && (property === "next" || property === "return" || property === "throw") ? (...args) => scope(() => member.apply(target, args)) : member;
        },
      });
    },
  });
  if (typeof value[Symbol.asyncIterator] === "function") return scopedIterator(Symbol.asyncIterator);
  if (typeof value[Symbol.iterator] === "function" && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !ArrayBuffer.isView(value)) return scopedIterator(Symbol.iterator);
  return value;
}

// ---------------------------------------------------------------- the registry (process-wide, through registered symbols)

function processState(key, create) {
  const slot = Symbol.for(key);
  return globalThis[slot] || (globalThis[slot] = create());
}
const REGISTRATIONS = processState("solid.ServerFunctionRegistrations", () => new Map());
/** id → the function a GET() grant was made about. */
const METHODS = processState("solid.ServerFunctionMethods", () => new Map());
/** reference → the function it names. */
const REFERENCE_BINDINGS = processState("solid.ServerFunctionReferenceBindings", () => new WeakMap());
/** Ids whose grant was carried across a development rebind: dispatch only, origin gate still on. */
const CARRIED = processState("solid.ServerFunctionCarriedGrants", () => new Set());

/** Whether the id's current binding is the function its GET() grant was made about. */
function declaresRead(id) {
  const granted = METHODS.get(id);
  return granted !== undefined && granted === REGISTRATIONS.get(id);
}
/** In-flight invocations, by the request event the call runs under. */
const INVOCATIONS = new WeakMap();

let rpcProvided = false;
function provideRPC() {
  if (rpcProvided) return;
  rpcProvided = true;
  provideServerFunctionRPC({ GET, decodeResponse });
}

/** A function in the dispatch registry under `id` (a different function under the id revokes its GET grant). */
export function registerServerFunction(id, callback) {
  provideRPC();
  if (REGISTRATIONS.get(id) !== callback) {
    if (DEV && declaresRead(id)) {
      METHODS.set(id, callback);
      CARRIED.add(id);
    } else {
      METHODS.delete(id);
      CARRIED.delete(id);
    }
  }
  REGISTRATIONS.set(id, callback);
  return callback;
}
export function getServerFunction(id) {
  const fn = REGISTRATIONS.get(id);
  if (fn) return fn;
  throw new Error("invalid server function: " + id);
}

/** Compiler ABI: registers a compiled server function (it must be a function). */
export function registerServerReference(id, fn, name?) {
  if (typeof fn !== "function")
    throw new Error(
      `Server function${name ? ` \`${name}\`` : ""} (${id}) is not a function: a module-level ` +
        `"use server" export must evaluate to a server function (got ${fn === null ? "null" : typeof fn}). Move non-function exports out of the directive module.`,
    );
  registerServerFunction(id, fn);
  return { id, fn, name };
}

/** In-process `invoke`: a `signal` rejects the caller; the work runs on, as behind HTTP. */
function inProcessInvoker(call) {
  return (args, options) => {
    const signal = options && options.signal;
    if (!signal) return call(...args);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      let result;
      try {
        result = call(...args);
      } catch (error) {
        signal.removeEventListener("abort", onAbort);
        return reject(error);
      }
      Promise.resolve(result).then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  };
}

/** Compiler ABI: the server-side callable. Called during SSR it runs in-process under a per-call event (locals copied). */
export function createServerReference({ id, fn, name }) {
  if (typeof fn !== "function") throw new Error("Export from a 'use server' module must be a function");
  provideRPC();
  const metadata = name === undefined ? {} : { name };
  const invokeChannel = inProcessInvoker((...args) => proxy(...args));
  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === "id") return id;
      if (prop === "url") return serverFunctionAddress(config.endpoint, id);
      if (prop === SERVER_FUNCTION_METADATA) return metadata;
      if (prop === SERVER_FUNCTION_INVOKE) return invokeChannel;
      return target[prop];
    },
    apply(target, thisArg, args) {
      const ogEvt = getRequestEvent();
      if (!ogEvt) throw new Error("Cannot call server function outside of a request");
      // Locals copied per call (reads see the render's; writes stay the call's); the response head stays shared.
      const evt: any = { ...ogEvt, locals: { ...ogEvt.locals } };
      INVOCATIONS.set(evt, { id, live: false });
      evt.serverOnly = true;
      const scope = (run) => provideEvent(evt, run);
      const wrap = resolveWrapInvocation(config.wrapInvocation);
      const hook = requestErrorHook(ogEvt);
      let result = provideEventOnce(provideEvent, evt, () => {
        const run = () => fn.apply(thisArg, args);
        return observeInvocation({ id, direct: true, event: evt, args }, () => reportDirectFailure(() => (wrap ? wrap(run, { id, args, event: evt, direct: true }) : run()), id, hook));
      });
      result = scopeDeferredResult(result, scope);
      const transform = config.transformDirectResult;
      if (transform && result && typeof result.then === "function") return result.then((value) => scopeDeferredResult(transform(value, { id, args, event: evt }), scope));
      return transform ? scopeDeferredResult(transform(result, { id, args, event: evt }), scope) : result;
    },
  });
  REFERENCE_BINDINGS.set(proxy, fn);
  return proxy;
}

/** A server function callable over GET (a safe read: no origin gate, cacheable). The grant is about the function, not the id. */
export function GET(fn) {
  if (!isServerFunction(fn) || typeof fn.id !== "string") throw new Error("GET expects a server function reference");
  const id = fn.id;
  const binding = REFERENCE_BINDINGS.has(fn) ? REFERENCE_BINDINGS.get(fn) : REGISTRATIONS.get(id);
  const existing = METHODS.get(id);
  if (existing !== undefined && existing !== binding) {
    if (CARRIED.has(id)) return fn;
    if (DEV)
      throw new Error(
        `GET() would rebind the existing grant for server function "${id}" to a different ` +
          `function. A GET declaration is made about a function, not an id - two references ` +
          `sharing one id cannot both hold it. Give the functions distinct ids, or drop the ` +
          `stale declaration.`,
      );
    METHODS.delete(id);
    return fn;
  }
  METHODS.set(id, binding);
  CARRIED.delete(id);
  const reference = withMeta(fn, { method: "GET" });
  guardDeclaredMethod(getServerFunctionMetadata(reference), id);
  return reference;
}
/** A grant's metadata cannot be rewritten into something else (dev throws; prod revokes the grant). */
function guardDeclaredMethod(metadata, id) {
  let declared = metadata.method;
  Object.defineProperty(metadata, "method", {
    configurable: true,
    enumerable: true,
    get: () => declared,
    set(next) {
      if (next === declared) return;
      if (DEV)
        throw new Error(
          `withMeta({ method }) cannot change the GET() declaration of server function ` +
            `"${id}". The method is declaration-scoped: it was granted about the function ` +
            `by GET(fn), and a metadata write cannot re-shape the wire grant.`,
        );
      METHODS.delete(id);
      declared = next;
    },
  });
}

/** A value-shaped live source: its in-process answer is branded (`LIVE_SOURCE`); dispatch is unchanged. */
export function live(fn) {
  if (!isServerFunction(fn) || typeof fn.id !== "string") throw new Error("live expects a server function reference");
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const wrapped: any = async (...args) => brandLive(await fn(...args));
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = inProcessInvoker(wrapped);
  wrapped.id = fn.id;
  Object.defineProperty(wrapped, "url", { get: () => fn.url, configurable: true });
  return wrapped;
}
function brandLive(answer) {
  if (typeof answer === "function" || (answer !== null && typeof answer === "object" && answer[Symbol.asyncIterator])) answer[LIVE_SOURCE] = true;
  return answer;
}

/** The server function call in flight for the current request event. */
export function getServerFunctionInvocation() {
  return getEventServerFunctionInvocation(getRequestEvent());
}
export function getEventServerFunctionInvocation(event) {
  return event && INVOCATIONS.get(event);
}

const resolveAddress = (url) => parseServerFunctionAddress(url.pathname, config.endpoint);

// ---------------------------------------------------------------- arguments

const DECODE_DEPTH_LIMIT = 64;
/** (The codec caps its depth; bare JSON gets the same cap.) */
function assertDecodeDepth(value) {
  let level = [value];
  for (let depth = 0; level.length > 0; depth++) {
    if (depth > DECODE_DEPTH_LIMIT) throw new TypeError("Server function arguments exceed the decode depth limit");
    const next = [];
    for (const node of level) {
      if (node === null || typeof node !== "object") continue;
      if (Array.isArray(node)) for (const child of node) next.push(child);
      else for (const key of Object.keys(node)) next.push(node[key]);
    }
    level = next;
  }
}

const UNSAFE_ARGUMENT_KEYS = ["__proto__", "constructor", "prototype"];
/** Prototype-mutating keys removed from decoded arguments, in place. */
function stripUnsafeArgumentKeys(value) {
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    for (const key of UNSAFE_ARGUMENT_KEYS) delete v[key];
    for (const key of Object.keys(v)) stack.push(v[key]);
    if (v instanceof Map) for (const [k, entry] of v) stack.push(k, entry);
    else if (v instanceof Set) for (const member of v) stack.push(member);
  }
  return value;
}

/** A POST body read up to `limit` bytes (counted as they arrive); null past it. */
async function bufferBodyWithin(request, limit) {
  const reader = request.body.getReader();
  const signal = request.signal;
  const chunks = [];
  let total = 0;
  const onAbort = () => {
    reader.cancel(signal.reason).catch(() => {});
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
/** The request rebuilt from its parts around the buffered bytes. */
const withBufferedBody = (request, body) => new Request(request.url, { method: request.method, headers: request.headers, signal: request.signal, body });

const KNOWN_BODY_FORMATS = new Set(Object.values(BodyFormat));
const FORMAT_SKEW = Symbol("solid.serverFunction.formatSkew");
function unknownFormatError(tag) {
  const error = new TypeError(
    `Server function body carries an unrecognized ${BODY_FORMAT_HEADER} tag ("${tag}"): the ` +
      "caller encodes a newer wire format than this build can decode (version skew), or an " +
      "intermediary duplicated the header. The body was refused rather than reinterpreted.",
  );
  error[FORMAT_SKEW] = true;
  return error;
}

/** The call's arguments: bound ones from `?args=`, a read's form fields, then the body. */
async function parseArguments(request, url, scripted, codec) {
  const parsed = [];
  const bodyFormat = request.method === "POST" ? request.headers.get(BODY_FORMAT_HEADER) : null;
  const args = url.searchParams.get("args");
  if (args && (!scripted || request.method === "GET" || bodyFormat !== BodyFormat.Serialized)) {
    let result;
    if (args.startsWith(";0x")) result = await deserializeString(args, codec);
    else {
      result = JSON.parse(args);
      assertDecodeDepth(result);
    }
    if (!Array.isArray(result)) throw new TypeError("Server function arguments must encode an array");
    stripUnsafeArgumentKeys(result);
    for (const arg of result) parsed.push(arg);
  } else if (!args && url.search && (request.method === "GET" || request.method === "HEAD")) parsed.push(url.searchParams);
  if (request.method === "POST" && request.body !== null) {
    if (bodyFormat !== null && !KNOWN_BODY_FORMATS.has(bodyFormat)) throw unknownFormatError(bodyFormat);
    const body = request.clone();
    const decoded = await extractBody(body, codec);
    if (bodyFormat === BodyFormat.Serialized || bodyFormat === BodyFormat.Json) {
      if (bodyFormat === BodyFormat.Json) assertDecodeDepth(decoded);
      if (!Array.isArray(decoded)) throw new TypeError("Server function arguments must encode an array");
      return stripUnsafeArgumentKeys(decoded);
    }
    if (decoded === undefined) {
      if (bodyFormat === null && (await body.arrayBuffer()).byteLength === 0) return parsed;
      throw new TypeError("Server function body carries no usable encoding");
    }
    parsed.push(decoded);
  }
  return parsed;
}

// ---------------------------------------------------------------- single flight

/** The hooks' data folded into `{ value, data }` (keyed by source), the header naming what folded. */
async function foldFlightData(hooks, event, headers, outcome, context: any = {}) {
  if (outcome.value instanceof Response && outcome.value.body) return outcome.value;
  digestOutcome(event, outcome);
  const folded = [];
  for (const [source, hook] of hooks) {
    try {
      const slice = await hook(event, outcome);
      if (slice !== undefined) folded.push([source, slice]);
    } catch (error) {
      console.error(`Error collecting flight data for source "${source}"`, error);
    }
  }
  if (folded.length === 0) return outcome.value;
  const data = Object.fromEntries(folded);
  headers.set(SINGLE_FLIGHT_HEADER, folded.map(([source]) => source).join(","));
  if (context.transformFlightResult) {
    const transformed = await context.transformFlightResult(event, { value: outcome.value, data }, context);
    if (transformed !== undefined) {
      const owned = ownResponse(transformed);
      for (const cookie of headers.getSetCookie()) owned.headers.append("Set-Cookie", cookie);
      headers.forEach((value, key) => {
        if (key !== "set-cookie" && !owned.headers.has(key)) owned.headers.set(key, value);
      });
      owned.headers.set(SINGLE_FLIGHT_HEADER, headers.get(SINGLE_FLIGHT_HEADER));
      return owned;
    }
  }
  return outcome.value === undefined ? { data } : { value: outcome.value, data };
}
/** revalidateKeys, foldedHeaders (cookies after the mutation), targetUrl (where the page will be). */
function digestOutcome(event, outcome) {
  const { request, response } = outcome;
  outcome.revalidateKeys = response?.headers.get(REVALIDATE_HEADER)?.split(",");
  outcome.foldedHeaders = foldSetCookies(request.headers, [...(event.response?.headers?.getSetCookie() ?? []), ...(response?.headers?.getSetCookie() ?? [])]);
  try {
    const referrer = request.headers.get("referer");
    if (referrer) {
      const location = response?.headers.get("Location");
      const target = location ? new URL(location, request.url) : new URL(referrer);
      if (target.origin === new URL(request.url).origin) outcome.targetUrl = target.toString();
    }
  } catch {}
}
function parseSetCookie(setCookie) {
  const [pair, ...attributes] = setCookie.split(";");
  const eq = pair.indexOf("=");
  if (eq < 0) return undefined;
  const parsed: any = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
  for (const attribute of attributes) {
    const attrEq = attribute.indexOf("=");
    const key = (attrEq < 0 ? attribute : attribute.slice(0, attrEq)).trim().toLowerCase();
    const value = attrEq < 0 ? "" : attribute.slice(attrEq + 1).trim();
    if (key === "max-age") parsed.maxAge = Number(value);
    else if (key === "expires") parsed.expires = new Date(value);
  }
  return parsed;
}
/** Request headers with Set-Cookies applied to the Cookie header, as the browser would (later wins, deletions honoured). */
export function foldSetCookies(headers: Headers, setCookies: readonly string[]): Headers {
  const folded = new Headers(headers);
  if (!setCookies.length) return folded;
  const cookies = {};
  for (const pair of folded.get("cookie")?.split(";") ?? []) {
    const eq = pair.indexOf("=");
    if (eq > -1) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  for (const setCookie of setCookies) {
    const parsed = parseSetCookie(setCookie);
    if (!parsed) continue;
    if ((parsed.maxAge != null && parsed.maxAge <= 0) || (parsed.expires != null && parsed.expires.getTime() <= Date.now())) delete cookies[parsed.name];
    else cookies[parsed.name] = parsed.value;
  }
  folded.delete("cookie");
  const serialized = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (serialized) folded.set("cookie", serialized);
  return folded;
}

/** A response's headers onto another set (each Set-Cookie on its own; body framing not carried). */
function mergeResponseHeaders(target, source) {
  source.forEach((value, key) => {
    if (key !== "set-cookie" && !COMPOSED_BODY_FRAMING.has(key)) target.append(key, value);
  });
  if (source.getSetCookie) for (const cookie of source.getSetCookie()) target.append("Set-Cookie", cookie);
  else if (source.has("set-cookie")) target.append("Set-Cookie", source.get("set-cookie"));
}

const validRedirectStatuses = new Set([301, 302, 303, 307, 308]);
/** A redirect for a scripted caller: 200 with `<status> <resolved target>` in the redirect header (fetch would follow a 3xx). */
function maskRedirect(headers, response, requestUrl) {
  const target = response.headers && response.headers.get("Location");
  if (target) headers.set(REDIRECT_HEADER, `${response.status} ${new URL(target, requestUrl)}`);
  headers.delete("Location");
}

/** Composed navigation headers: bounded in size, http(s) targets only; refused (never trimmed) otherwise. */
const BOUNDED_COMPOSED_HEADERS = [REDIRECT_HEADER, "Location", REVALIDATE_HEADER];
function enforceComposedHeaderInvariants(response) {
  for (const name of BOUNDED_COMPOSED_HEADERS) {
    const value = response.headers.get(name);
    if (value === null) continue;
    if (value.length > RESPONSE_HEADER_VALUE_LIMIT)
      return refuseComposedHeader(
        response,
        name,
        `${name} response header refused at ${value.length} characters`,
        DEV
          ? `The ${name} response header is ${value.length} characters; past ` +
              `${RESPONSE_HEADER_VALUE_LIMIT} it would overflow receivers (an 8 KiB proxy ` +
              `buffer holds the whole header block) and the response dies at the socket after ` +
              `the mutation committed. Refused rather than trimmed: a cut redirect target is a ` +
              `different address, a dropped revalidate key is a silently stale cache. The ` +
              `redirect()/reload() helpers enforce this bound with the full reasoning at the ` +
              `call site.`
          : null,
      );
    if (name === REVALIDATE_HEADER) continue;
    const target = name === REDIRECT_HEADER ? value.slice(value.indexOf(" ") + 1) : value;
    if (!isHttpNavigationTarget(target))
      return refuseComposedHeader(
        response,
        name,
        `${name} response header refused: non-http(s) navigation target`,
        DEV
          ? `The ${name} response header carries a navigation target with a non-http(s) ` +
              `scheme ("${target.slice(0, 64)}"). A javascript: target is same-origin script ` +
              `execution in any integration that navigates to it, so only http(s) and ` +
              `relative targets leave this transport. If the target came from request data ` +
              `(?next= and friends), validate it against your own origin before redirecting.`
          : null,
      );
  }
  return response;
}
function refuseComposedHeader(response, name, headerMessage, body) {
  if (response.body) {
    try {
      const cancelled = response.body.cancel();
      if (cancelled && typeof cancelled.then === "function") cancelled.then(undefined, () => {});
    } catch {}
  }
  const headers = new Headers();
  headers.set(ERROR_HEADER, boundedErrorHeaderValue(DEV ? headerMessage : GENERIC_SERVER_ERROR_MESSAGE));
  return new Response(body, { status: 500, headers });
}

/** (A scripted 304 answers a question nobody asked: the call resolves to undefined.) */
function warnScripted304(functionId) {
  if (DEV)
    console.warn(
      `Server function "${functionId}" answered a scripted call with 304 Not Modified. ` +
        `The client transport sends no conditional headers, so nothing was asked to be ` +
        `revalidated: the call resolves to undefined, not "unchanged". For conditional ` +
        `reads, declare the function GET and set ETag/Cache-Control response headers - ` +
        `the browser owns that exchange and replays its cached answer on a 304.`,
    );
}

/** The no-JS form convention: redirect back (303, or the result's own) with the outcome in a flash cookie. */
export function createNoJSHandler({ base = "" } = {}) {
  return async function handleNoJS(result, request, args, thrown?) {
    const url = new URL(request.url);
    let back = new URL(base || "/", url.origin).toString();
    try {
      const referer = request.headers.get("referer");
      if (referer) back = new URL(referer).toString();
    } catch {}
    let status = 303;
    let headers;
    if (result instanceof Response) {
      headers = new Headers();
      mergeResponseHeaders(headers, result.headers);
      if (result.headers.has("Location")) {
        headers.set("Location", new URL(result.headers.get("Location"), url.origin + base).toString());
        if (validRedirectStatuses.has(result.status)) status = result.status;
      } else headers.set("Location", back);
      headers.delete("Content-Type");
      headers.delete("Content-Length");
    } else headers = new Headers({ Location: back });
    if (result !== undefined && !(result instanceof Response)) {
      const flash = await encodeFlashCookie(url.pathname, result, args, thrown);
      if (flash !== null) headers.append("Set-Cookie", flash);
    }
    return new Response(null, { status, headers });
  };
}
let defaultNoJSHandler;
/** A browser form post: POST, a form content type, no format tag. */
function isFormPost(request) {
  if (request.method !== "POST" || request.headers.has(BODY_FORMAT_HEADER)) return false;
  const type = request.headers.get("content-type") || "";
  return type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");
}

// ---------------------------------------------------------------- the result graph's channels, sanitized and torn down

const NOTHING = Symbol();
const ARRAY = 0;
const MAP = 1;
const SET = 2;
const OBJECT = 3;
class Frame {
  i = 0;
  changed = false;
  accessorRead = -1;
  accessorValue = undefined;
  pendingKey = undefined;
  constructor(
    public kind,
    public value,
    public next,
    public items,
    public descriptors,
  ) {}
}
const guardOperation = (state, run) => (state.scope ? state.scope(run) : run());

/**
 * The result walked before the codec sees it: every channel (promise, async iterable, stream) wrapped so a failure
 * through it is sanitized, and (with `state.gate`) its pulls follow the response's demand and close at teardown.
 * Containers are rebuilt only where something changed; getters are read once and kept as data. Iterative.
 * @internal
 */
export function guardFailures(value, state?) {
  if (!state) state = { seen: new WeakMap(), cyclic: new WeakSet() };
  const entered = enterGuard(value, state);
  if (!(entered instanceof Frame)) return entered;
  const stack = [entered];
  let delivered = NOTHING;
  for (;;) {
    const top = stack[stack.length - 1];
    const items = top.items;
    let pushed = null;
    while (top.i < items.length) {
      const i = top.i;
      let original;
      if (top.kind === OBJECT) {
        const descriptor = top.descriptors[items[i]];
        if ("value" in descriptor) original = descriptor.value;
        else if (typeof descriptor.get === "function") {
          if (top.accessorRead !== i) {
            try {
              top.accessorValue = descriptor.get.call(top.value);
            } catch (error) {
              throw wireServerFunctionError(error, "channel");
            }
            top.accessorRead = i;
          }
          original = top.accessorValue;
        } else {
          top.i++;
          continue;
        }
      } else original = items[i];
      let guarded;
      if (delivered !== NOTHING) {
        guarded = delivered;
        delivered = NOTHING;
      } else {
        guarded = enterGuard(original, state);
        if (guarded instanceof Frame) {
          pushed = guarded;
          break;
        }
      }
      if (top.kind === ARRAY) {
        if (guarded !== original) {
          top.next[i] = guarded;
          top.changed = true;
        }
      } else if (top.kind === MAP) {
        if ((i & 1) === 0) top.pendingKey = guarded;
        else top.next.set(top.pendingKey, guarded);
        if (guarded !== original) top.changed = true;
      } else if (top.kind === SET) {
        top.next.add(guarded);
        if (guarded !== original) top.changed = true;
      } else if (guarded !== original || top.accessorRead === i) {
        Object.defineProperty(top.next, items[i], { value: guarded, writable: true, configurable: true, enumerable: top.descriptors[items[i]].enumerable });
        top.changed = true;
      }
      top.i++;
    }
    if (pushed !== null) {
      stack.push(pushed);
      continue;
    }
    stack.pop();
    const out = keepGuarded(top.value, top.next, top.changed, state);
    if (stack.length === 0) return out;
    delivered = out;
  }
}

function enterGuard(value, state) {
  if (value === null || typeof value !== "object") return value;
  if (state.seen.has(value)) {
    state.cyclic.add(value);
    return state.seen.get(value);
  }
  // (Before the async-iterable branch: a ReadableStream is async-iterable on servers.)
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    let reader;
    const gate = state.gate;
    let finished = false;
    const close = () => {
      if (finished) return;
      finished = true;
      try {
        const cancelled = guardOperation(state, () => (reader ? reader.cancel() : value.cancel()));
        if (cancelled && typeof cancelled.then === "function") cancelled.then(undefined, () => {});
      } catch {}
    };
    const guardedStream = new ReadableStream({
      async pull(controller) {
        try {
          if (gate && !finished && !gate.wantsMore()) await gate.awaitDemand();
          if (finished) {
            controller.close();
            return;
          }
          if (!reader) reader = guardOperation(state, () => value.getReader());
          const { done, value: chunk } = await guardOperation(state, () => reader.read());
          done ? controller.close() : controller.enqueue(guardOperation(state, () => guardFailures(chunk, state)));
        } catch (error) {
          controller.error(guardOperation(state, () => wireServerFunctionError(error, "channel")));
        }
      },
      cancel(reason) {
        finished = true;
        return guardOperation(state, () => (reader ? reader.cancel(reason) : value.cancel(reason)));
      },
    });
    if (gate) gate.onOpen(close);
    state.seen.set(value, guardedStream);
    return guardedStream;
  }
  if (typeof value.then === "function") {
    const guardedPromise = Promise.resolve(value).then(
      (resolved) => guardOperation(state, () => guardFailures(resolved, state)),
      (error) => {
        throw guardOperation(state, () => wireServerFunctionError(error, "channel"));
      },
    );
    guardedPromise.catch(() => {});
    state.seen.set(value, guardedPromise);
    return guardedPromise;
  }
  if (typeof value[Symbol.asyncIterator] === "function") {
    const source = value;
    const gate = state.gate;
    const guardedIterable = {
      [Symbol.asyncIterator]() {
        const iterator = guardOperation(state, () => source[Symbol.asyncIterator]());
        let finished = false;
        const close = () => {
          if (finished) return;
          finished = true;
          try {
            const returned = iterator.return && guardOperation(state, () => iterator.return());
            if (returned && typeof returned.then === "function") returned.then(undefined, () => {});
          } catch {}
        };
        if (gate) gate.onOpen(close);
        const step = () =>
          finished
            ? Promise.resolve({ done: true, value: undefined })
            : guardOperation(state, () => iterator.next()).then(
                (step) => {
                  if (step.done) {
                    finished = true;
                    return step;
                  }
                  return { done: false, value: guardOperation(state, () => guardFailures(step.value, state)) };
                },
                (error) => {
                  throw guardOperation(state, () => wireServerFunctionError(error, "channel"));
                },
              );
        return {
          next: () => (finished || !gate || gate.wantsMore() ? step() : gate.awaitDemand().then(step)),
          return: () => {
            close();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    state.seen.set(value, guardedIterable);
    return guardedIterable;
  }
  if (state.scope && typeof value[Symbol.iterator] === "function" && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !ArrayBuffer.isView(value)) {
    const scopedIterable = scopeDeferredResult(value, state.scope);
    state.seen.set(value, scopedIterable);
    return scopedIterable;
  }
  if (Array.isArray(value)) {
    const next = value.slice();
    state.seen.set(value, next);
    return new Frame(ARRAY, value, next, value, null);
  }
  if (value instanceof Map) {
    const next = new Map();
    state.seen.set(value, next);
    const items = [];
    for (const entry of value) items.push(entry[0], entry[1]);
    return new Frame(MAP, value, next, items, null);
  }
  if (value instanceof Set) {
    const next = new Set();
    state.seen.set(value, next);
    return new Frame(SET, value, next, [...value], null);
  }
  // Errors descend (their own properties are encoded); other class instances are left as they are.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !(value instanceof Error)) {
    state.seen.set(value, value);
    return value;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    descriptors[key].configurable = true;
    if ("value" in descriptors[key]) descriptors[key].writable = true;
  }
  const next = Object.create(prototype, descriptors);
  state.seen.set(value, next);
  // (An Error's hidden data slots are encoded too: walked; hidden accessors are the codec's.)
  const children = !(value instanceof Error)
    ? Object.keys(value)
    : Object.getOwnPropertyNames(value).filter((key) => {
        const descriptor = descriptors[key];
        return descriptor.enumerable || "value" in descriptor;
      });
  return new Frame(OBJECT, value, next, children, descriptors);
}
function keepGuarded(value, next, changed, state) {
  if (changed || state.cyclic.has(value)) return next;
  state.seen.set(value, value);
  return value;
}

/**
 * The codec stream for a response, torn down with the request: an abort or a cancel stops serialization and closes
 * every source in the graph; pulls follow the reader's demand. `live` frames it as server-sent events.
 */
export function serializeResponseStream(value, codecOptions, signal?, scope?, live?) {
  let closed = false;
  const frame = live
    ? (payload) => {
        const id = live.pending;
        live.pending = undefined;
        return createEventChunk(payload, id);
      }
    : createChunk;
  let stopLive = null;
  const stopHeartbeat = () => {
    if (stopLive !== null) {
      stopLive();
      stopLive = null;
    }
  };
  let streamController = null;
  let demandWaiters = null;
  const wantsMore = () => streamController !== null && streamController.desiredSize > 0;
  const awaitDemand = () => new Promise((resolve) => (demandWaiters ??= []).push(resolve));
  const supplyDemand = () => {
    const resolvers = demandWaiters;
    demandWaiters = null;
    if (resolvers) for (const resolve of resolvers) resolve();
  };
  const sourceClosers = new Set<() => void>();
  const gate = {
    wantsMore,
    awaitDemand,
    onOpen(close) {
      if (closed) close();
      else sourceClosers.add(close);
    },
  };
  const guardState = { seen: new WeakMap(), cyclic: new WeakSet(), gate, scope };
  value = guardOperation(guardState, () => guardFailures(value, guardState));
  let cancelSerialize = null;
  let onAbort = null;
  const finishSource = () => {
    for (const close of sourceClosers) close();
    sourceClosers.clear();
    supplyDemand();
  };
  const teardown = () => {
    if (closed) return;
    closed = true;
    stopHeartbeat();
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (cancelSerialize) cancelSerialize();
    finishSource();
  };
  return new ReadableStream({
    async start(controller) {
      streamController = controller;
      if (live) stopLive = armLiveBody(controller, teardown);
      if (signal) {
        if (signal.aborted) {
          teardown();
          controller.close();
          return;
        }
        onAbort = () => {
          const alreadyClosed = closed;
          teardown();
          if (!alreadyClosed)
            try {
              controller.error(signal.reason || new Error("The operation was aborted."));
            } catch {}
        };
        signal.addEventListener("abort", onAbort);
      }
      const { serializeJSON } = await import("../serialization.ts");
      if (closed) {
        try {
          controller.close();
        } catch {}
        return;
      }
      cancelSerialize = serializeJSON(value, {
        ...codecOptions,
        onParse(node) {
          if (!closed) controller.enqueue(frame(JSON.stringify(node)));
        },
        onDone() {
          if (closed) return;
          closed = true;
          stopHeartbeat();
          if (onAbort) signal.removeEventListener("abort", onAbort);
          finishSource();
          controller.close();
        },
        onError(error) {
          if (closed) return;
          closed = true;
          stopHeartbeat();
          if (onAbort) signal.removeEventListener("abort", onAbort);
          finishSource();
          // The head is sent: the failure travels in band, as a terminal error frame.
          try {
            const delivered = wireServerFunctionError(DEV && error instanceof Error ? new Error(`Server function result could not be encoded: ${error.message}`) : error, "channel");
            controller.enqueue(frame(encodeErrorTrailer(delivered)));
            controller.close();
          } catch {
            try {
              controller.error(error);
            } catch {}
          }
        },
      });
    },
    pull() {
      supplyDemand();
    },
    cancel() {
      teardown();
    },
  });
}
function serializedResponse(value, headers, codec, signal, scope) {
  headers.set(BODY_FORMAT_HEADER, BodyFormat.Serialized);
  headers.set("Content-Type", "text/plain");
  return new Response(serializeResponseStream(value, codec, signal, scope), { headers });
}

const LIVE_HEARTBEAT_INTERVAL = 20000;
/** A live body's heartbeat (every 20 s while open) and, in development, the chaos knob; returns the disarm. */
export function armLiveBody(controller, teardown) {
  let stopped = false;
  const heartbeat: any = setInterval(() => {
    if (stopped) return;
    try {
      controller.enqueue(EVENT_STREAM_HEARTBEAT);
    } catch {}
  }, LIVE_HEARTBEAT_INTERVAL);
  if (typeof heartbeat === "object" && heartbeat && typeof heartbeat.unref === "function") heartbeat.unref();
  let chaos: any = null;
  if (DEV && config.chaosReconnectEvery > 0) {
    chaos = setTimeout(() => {
      if (stopped) return;
      teardown();
      try {
        controller.error(new Error("Live response ended by the chaos knob."));
      } catch {}
    }, config.chaosReconnectEvery);
    if (typeof chaos === "object" && chaos && typeof chaos.unref === "function") chaos.unref();
  }
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    if (chaos !== null) clearTimeout(chaos);
  };
}

/** Each yield's digest parked for its event id; a first yield equal to Last-Event-ID is skipped (the client has it). */
function liveSource(value, lastEventId, position, scope) {
  const digestOf = (v) => (scope ? scope(() => positionDigest(v)) : positionDigest(v));
  if (value === null || typeof value !== "object" || typeof value[Symbol.asyncIterator] !== "function") {
    const digest = digestOf(value);
    if (digest !== undefined && digest === lastEventId) return (async function* () {})();
    position.pending = digest;
    return value;
  }
  const source = value;
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let first = true;
      const step = () =>
        iterator.next().then((result) => {
          if (result.done) return result;
          const digest = digestOf(result.value);
          if (first) {
            first = false;
            if (digest !== undefined && digest === lastEventId) return step();
          }
          position.pending = digest;
          return result;
        });
      return {
        next: step,
        return: (v) => (iterator.return ? iterator.return(v) : Promise.resolve({ done: true, value: v })),
        throw: (e) => (iterator.throw ? iterator.throw(e) : Promise.reject(e)),
      };
    },
  };
}
/** What a live address answers: the codec records as an event stream, no-store, unbuffered. */
function encodeLiveResult(value, headers, status, codec, request, scope) {
  if (NULL_BODY_STATUSES.has(status) || value === undefined || getHeadersAndBody(value)) return encodeResult(value, headers, status, codec, request.signal, scope);
  const position = { pending: undefined };
  const source = liveSource(value, request.headers.get(LAST_EVENT_ID_HEADER), position, scope);
  headers.set(BODY_FORMAT_HEADER, BodyFormat.Serialized);
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");
  try {
    return new Response(serializeResponseStream(source, codec, request.signal, scope, position), { status, headers });
  } catch (error) {
    throw DEV && error instanceof Error ? new Error(`Server function result could not be encoded: ${error.message}`) : error;
  }
}

/** A result's body: void, a natural HTTP encoding, JSON when it round-trips, else the codec stream. */
function encodeResult(value, headers, status, codec, signal?, scope?) {
  if (NULL_BODY_STATUSES.has(status)) {
    if (value === undefined || value === null) {
      headers.set(BODY_FORMAT_HEADER, BodyFormat.Void);
      return new Response(null, { status, headers });
    }
    const error = new Error(
      `Server function answered status ${status}, which forbids a response body, with a value. ` +
        `Return respond(undefined, { status: ${status} }) for a bodiless answer, or drop the ` +
        `status to send the value.`,
    );
    headers.set(ERROR_HEADER, encodeErrorHeaderValue(error.message));
    return encodeResult(error, headers, 500, codec, signal, scope);
  }
  const direct = getHeadersAndBody(value);
  if (direct) {
    for (const [key, val] of Object.entries(direct.headers || {})) headers.set(key, val);
    return new Response(direct.body, { status, headers });
  }
  if (value === undefined) {
    headers.set(BODY_FORMAT_HEADER, BodyFormat.Void);
    return new Response(null, { status, headers });
  }
  try {
    const jsonSafe = scope ? scope(() => isJSONSafe(value)) : isJSONSafe(value);
    if (jsonSafe) {
      headers.set(BODY_FORMAT_HEADER, BodyFormat.Json);
      headers.set("Content-Type", "application/json");
      const body = scope ? scope(() => JSON.stringify(value)) : JSON.stringify(value);
      return new Response(body, { status, headers });
    }
  } catch {}
  try {
    const response = serializedResponse(value, headers, codec, signal, scope);
    return status === 200 ? response : new Response(response.body, { status, headers });
  } catch (error) {
    throw DEV && error instanceof Error ? new Error(`Server function result could not be encoded: ${error.message}`) : error;
  }
}

/** The error header is a label (the error is in the body): bounded to 1 KiB encoded, by shrinking the source. */
const ERROR_HEADER_VALUE_LIMIT = 1024;
function boundedErrorHeaderValue(message) {
  let label = message.length > 256 ? message.slice(0, 256) : message;
  let encoded = encodeErrorHeaderValue(label);
  while (encoded.length > ERROR_HEADER_VALUE_LIMIT && label.length > 1) {
    label = label.slice(0, Math.ceil(label.length / 2));
    encoded = encodeErrorHeaderValue(label);
  }
  return encoded;
}

export const GENERIC_SERVER_ERROR_MESSAGE = "Internal Server Error";

/** The development build's fidelity (off when run from source: errors sanitized, bodies bare). */
let DEV = false;
/** For harnesses that cannot select the development build. */
export function setServerFunctionsDev(dev: boolean) {
  DEV = !!dev;
}

const REQUEST_ERROR_HOOKS = new WeakMap();
function siteFor(handling, event, direct) {
  const invocation = event ? INVOCATIONS.get(event) : undefined;
  const site: any = { kind: "server-function", handling, direct };
  if (invocation) site.functionId = invocation.id;
  if (event) site.event = event;
  return site;
}
/** A failure's wire value: the hook's mapping, else the sanitized value. */
function wireServerFunctionError(value, handling, event = currentEvent()) {
  const report = reportServerError(value, siteFor(handling, event, false), null, event ? REQUEST_ERROR_HOOKS.get(event) : undefined);
  return report.mapped ? report.value : sanitizeServerError(value);
}
function currentEvent() {
  const store = globalThis[RequestContext];
  return store ? store.getStore() : undefined;
}
/** A direct call's failure reported as the function's, the original rethrown (the render contains it). */
function reportDirectFailure(run, id, hook) {
  const report = (error) => {
    reportServerError(error, { kind: "server-function", handling: "thrown", functionId: id, direct: true }, null, hook);
    throw error;
  };
  let result;
  try {
    result = run();
  } catch (error) {
    report(error);
  }
  return result && typeof result.then === "function" ? result.then(undefined, report) : result;
}

/** Outside development a thrown value becomes a generic Error (unless marked safe): its message and properties stay on the server. */
export function sanitizeServerError(value) {
  if (DEV) return value;
  if (isSafeError(value)) return value;
  const wire = new Error(GENERIC_SERVER_ERROR_MESSAGE);
  emitFinding(
    {
      code: "SERVER_ERROR_SANITIZED",
      kind: "ssr",
      severity: "error",
      message: `[SERVER_ERROR_SANITIZED] Server function error replaced with a generic Error before serialization: ${errorText(value)}`,
      data: { source: "server-function", error: value, wire },
    },
    null,
  );
  return wire;
}

export function serverFunctionUrl(fn, ...args) {
  return serverFunctionUrlFor(config.endpoint, fn, args);
}
export function serverFunctionActionUrl(fn, ...boundArgs) {
  return serverFunctionActionUrlFor(config.endpoint, fn, boundArgs);
}
export function parseServerFunctionActionUrl(url) {
  const parsed = parseServerFunctionAddress(new URL(url, "http://localhost").pathname, config.endpoint);
  return parsed && parsed.id;
}

// ---------------------------------------------------------------- origin gate and CORS

async function matchesOrigin(origin, request, matcher) {
  if (matcher === undefined) return origin === new URL(request.url).origin;
  if (typeof matcher === "function") return (await matcher(origin, request)) === true;
  return Array.isArray(matcher) ? matcher.includes(origin) : origin === matcher;
}
/** false refuses; true admits; an origin string admits a listed cross-origin caller (echoed in Allow-Origin). */
async function allowsServerFunctionRequest(request, options) {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "same-origin") return true;
  if (fetchSite === "none") return false;
  const origin = request.headers.get("Origin");
  if (fetchSite === "same-site" || fetchSite === "cross-site") {
    if (origin === null || options.origin === undefined) return false;
    return (await matchesOrigin(origin, request, options.origin)) ? origin : false;
  }
  if (origin !== null) {
    if (!(await matchesOrigin(origin, request, options.origin))) return false;
    return origin === new URL(request.url).origin ? true : origin;
  }
  const referer = request.headers.get("Referer");
  if (referer !== null) {
    try {
      return matchesOrigin(new URL(referer).origin, request, options.origin);
    } catch {
      return false;
    }
  }
  return options.allowRequestsWithoutOriginCheck === true;
}
const CSRF_VARY = ["Sec-Fetch-Site", "Origin", "Referer"];
function appendVary(headers, names) {
  const current = headers.get("Vary");
  if (current === "*") return;
  const values = current ? current.split(",").map((value) => value.trim()) : [];
  const seen = new Set(values.map((value) => value.toLowerCase()));
  for (const name of names) if (!seen.has(name.toLowerCase())) values.push(name);
  headers.set("Vary", values.join(", "));
}
/** `write` applied to the response's headers (onto a copy when they are immutable). */
function withHeaders(response, write) {
  try {
    write(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    write(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
const withCSRFVary = (response) => withHeaders(response, (headers) => appendVary(headers, CSRF_VARY));

const TRANSPORT_REQUEST_HEADERS = ["Content-Type", BODY_FORMAT_HEADER, SINGLE_FLIGHT_HEADER].join(", ");
const PREFLIGHT_MAX_AGE = "600";
const CORS_SAFELISTED_RESPONSE_HEADERS = new Set(["cache-control", "content-language", "content-length", "content-type", "expires", "last-modified", "pragma"]);
/** The CORS answer for an admitted cross-origin caller, on every response it gets. */
function withCORS(response, cors) {
  if (cors === null) return response;
  return withHeaders(response, (headers) => {
    headers.set("Access-Control-Allow-Origin", cors.origin);
    if (cors.credentials) headers.set("Access-Control-Allow-Credentials", "true");
    const exposed = [];
    for (const name of headers.keys()) {
      if (CORS_SAFELISTED_RESPONSE_HEADERS.has(name) || name === "set-cookie" || name === "vary" || name.startsWith("access-control-")) continue;
      exposed.push(name);
    }
    if (exposed.length > 0) headers.set("Access-Control-Expose-Headers", exposed.join(", "));
    appendVary(headers, ["Origin"]);
  });
}
function preflightResponse(request) {
  const requested = request.headers.get("Access-Control-Request-Headers");
  const response = new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, GET, HEAD",
      "Access-Control-Allow-Headers": requested !== null && requested.trim() !== "" ? requested : TRANSPORT_REQUEST_HEADERS,
      "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
      "Cache-Control": "no-store",
    },
  });
  appendVary(response.headers, ["Access-Control-Request-Method", "Access-Control-Request-Headers"]);
  return response;
}
const forbiddenResponse = () => withCSRFVary(new Response(DEV ? "Forbidden" : null, { status: 403, headers: { "Cache-Control": "no-store" } }));

function nativePromise(value) {
  if (value instanceof Promise) return value;
  try {
    if (Object.prototype.toString.call(value) === "[object Promise]") return Promise.prototype.then.call(value, (value) => value);
  } catch {}
}

// ---------------------------------------------------------------- the HTTP handler

/**
 * The web-standard handler for server function calls (mounted on the endpoint, `/_server` by default): the origin
 * gate, the method allowlist (POST; GET/HEAD for declared reads), bounded argument decoding, the call under its
 * request event, and the result encoded by the address's caller kind (data: codec, live: event stream, bare: HTTP).
 */
export async function handleServerFunctionRequest(request: Request, options: any = {}) {
  const codec: any = { ...(options.codec !== undefined ? options.codec : getServerFunctionsCodec()) };
  codec.serializeErrorStacks ??= DEV;
  const url = new URL(request.url);
  const method = request.method;
  const address = resolveAddress(url);
  const functionId = address && address.id;
  const declaredRead = (method === "GET" || method === "HEAD") && functionId !== null && declaresRead(functionId);
  const csrf = options.csrf !== undefined ? options.csrf : config.csrf;
  const protectsRequest = csrf !== false && (!declaredRead || CARRIED.has(functionId) || (typeof csrf === "object" && csrf.protectDeclaredReads === true));
  const csrfOptions = csrf === true ? {} : csrf;
  let verdict: boolean | string = true;
  let readVariesByOrigin = false;
  if (protectsRequest) verdict = await allowsServerFunctionRequest(request, csrfOptions);
  else if (csrfOptions !== false && csrfOptions.origin !== undefined) {
    readVariesByOrigin = true;
    const admitted = await allowsServerFunctionRequest(request, csrfOptions);
    if (typeof admitted === "string") verdict = admitted;
  }
  const cors = typeof verdict === "string" ? { origin: verdict, credentials: csrfOptions.allowCredentials === true } : null;
  const finish = (response) => {
    const finalized = withCORS(finalizeTransportResponse(response, method), cors);
    return readVariesByOrigin && cors === null ? withHeaders(finalized, (headers) => appendVary(headers, ["Origin"])) : finalized;
  };
  if (cors !== null && method === "OPTIONS" && request.headers.has("Access-Control-Request-Method")) return finish(preflightResponse(request));
  // An unknown id is labelled (version skew), ahead of the origin gate's refusal.
  let serverFunction;
  if (functionId) {
    try {
      serverFunction = getServerFunction(functionId);
    } catch {
      return finish(new Response(DEV ? `Unknown server function: ${functionId}` : null, { status: 404, headers: { [UNKNOWN_HEADER]: "true" } }));
    }
  }
  if (verdict === false) return finish(forbiddenResponse());
  if (!functionId) {
    const response = new Response(DEV ? "Server function not found" : null, { status: 404 });
    return finish(protectsRequest ? withCSRFVary(response) : response);
  }
  const scripted = address.data || address.live;
  const live = address.live;
  if (method !== "POST" && !declaredRead) {
    const response = new Response(DEV ? `Method not allowed for server function: ${functionId}` : null, {
      status: 405,
      headers: { Allow: declaresRead(functionId) ? "POST, GET, HEAD" : "POST" },
    });
    return finish(protectsRequest ? withCSRFVary(response) : response);
  }
  const bodySizeLimit = options.bodySizeLimit !== undefined ? options.bodySizeLimit : config.bodySizeLimit;
  const argsEncoding = url.searchParams.get("args");
  if (argsEncoding !== null && argsEncoding.length > bodySizeLimit) {
    const response = new Response(DEV ? "Server function arguments exceed the configured bodySizeLimit" : null, { status: 413 });
    return finish(protectsRequest ? withCSRFVary(response) : response);
  }
  if (method === "POST" && request.body !== null && bodySizeLimit !== Infinity) {
    // A declaration over the limit is refused unread; the limit itself is counted on what arrives.
    const raw = request.headers.get("content-length");
    const declared = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (declared > bodySizeLimit) {
      const response = new Response(DEV ? "Server function request body exceeds the configured bodySizeLimit" : null, { status: 413 });
      return finish(protectsRequest ? withCSRFVary(response) : response);
    }
    let buffered;
    try {
      buffered = await bufferBodyWithin(request, bodySizeLimit);
    } catch {
      const response = new Response(DEV ? "Malformed server function arguments" : null, { status: 400 });
      return finish(protectsRequest ? withCSRFVary(response) : response);
    }
    if (buffered === null) {
      const response = new Response(DEV ? "Server function request body exceeds the configured bodySizeLimit" : null, { status: 413 });
      return finish(protectsRequest ? withCSRFVary(response) : response);
    }
    request = withBufferedBody(request, buffered);
  }
  let event;
  try {
    event = options.createEvent ? options.createEvent(request) : { request, locals: {} };
    const promised = nativePromise(event);
    if (promised) event = await promised;
  } catch (error) {
    const safe = sanitizeServerError(error);
    const message = safe instanceof Error ? safe.message : String(safe);
    const headers = new Headers();
    headers.set(ERROR_HEADER, boundedErrorHeaderValue(message));
    const response = scripted ? encodeResult(safe, headers, 500, codec, request.signal) : new Response(DEV ? message : null, { status: 500 });
    return finish(protectsRequest ? withCSRFVary(response) : response);
  }
  // From here every exit folds the event's response head.
  const refuseCommitted = (raw) => {
    const response = commitEventResponse(raw, event);
    return finish(protectsRequest ? withCSRFVary(response) : response);
  };
  const provide = options.provideEvent || provideEvent;
  const scope = (run) => provide(event, run);
  if (options.onError !== undefined) REQUEST_ERROR_HOOKS.set(event, options.onError);
  const flightHook = options.collectFlightData !== undefined ? options.collectFlightData : config.collectFlightData;
  const transformResult = options.transformResult !== undefined ? options.transformResult : config.transformResult;
  const wrapInvocation = resolveWrapInvocation(options.wrapInvocation !== undefined ? options.wrapInvocation : config.wrapInvocation);
  const transformFlightResult = options.transformFlightResult !== undefined ? options.transformFlightResult : config.transformFlightResult;
  // The no-JS convention is for form navigations; a script's form-shaped fetch to the bare address is refused.
  let handleNoJS = options.handleNoJS !== undefined ? options.handleNoJS : config.handleNoJS;
  if (handleNoJS === undefined && !scripted && isFormPost(request)) {
    const fetchMode = request.headers.get("Sec-Fetch-Mode");
    if (fetchMode === null || fetchMode === "navigate") handleNoJS = defaultNoJSHandler || (defaultNoJSHandler = createNoJSHandler());
    else {
      const response = new Response(
        DEV
          ? "The bare server-function address answers form navigations with the " +
              "no-JS redirect convention. Scripted callers use the data address " +
              `(…/data/${functionId}) or send the ${BODY_FORMAT_HEADER} tag.`
          : null,
        { status: 400 },
      );
      return refuseCommitted(response);
    }
  }
  // Single flight: a scripted POST naming the sources it can take (deduped); only those run.
  const flightHeader = scripted && method === "POST" ? request.headers.get(SINGLE_FLIGHT_HEADER) : null;
  const flightHooks = flightHeader
    ? [...new Set(flightHeader.split(","))].flatMap((source) => {
        const hook = source === "true" ? flightHook : flightSources.get(source);
        return hook ? [[source, hook]] : [];
      })
    : [];
  const collectsFlight = flightHooks.length > 0;
  let parsed;
  try {
    parsed = await parseArguments(request, url, scripted, codec);
  } catch (error) {
    const skewed = error !== null && typeof error === "object" && error[FORMAT_SKEW] === true;
    const response = new Response(DEV ? (skewed ? error.message : "Malformed server function arguments") : null, { status: 400 });
    return refuseCommitted(response);
  }
  const maxArguments = options.maxArguments !== undefined ? options.maxArguments : config.maxArguments;
  if (parsed.length > maxArguments) {
    const response = new Response(DEV ? "Server function call exceeds the configured maxArguments" : null, { status: 400 });
    return refuseCommitted(response);
  }
  const flightContext = { id: functionId, args: parsed, request, collectsFlight, codec, transformFlightResult };
  const headers = new Headers();
  const dispatch = async () => {
    try {
      const invokeOnce = async () => {
        INVOCATIONS.set(event, { id: functionId, live: !!live });
        const run = () => serverFunction(...parsed);
        return observeInvocation({ id: functionId, direct: false, event, request, args: parsed }, () =>
          wrapInvocation ? wrapInvocation(run, { id: functionId, args: parsed, event, request, direct: false }) : run(),
        );
      };
      let result = await provideEventOnce(provide, event, invokeOnce);
      if (transformResult) result = await transformResult(event, result, flightContext);
      let status = 200;
      let metadata;
      if (isResponseEnvelope(result)) {
        const { response, value } = result;
        if (!scripted && !handleNoJS && response && response.body) return response;
        if (response && response.headers) mergeResponseHeaders(headers, response.headers);
        if (response && response.status && (!scripted || !validRedirectStatuses.has(response.status))) status = response.status;
        else if (response && response.status) maskRedirect(headers, response, request.url);
        metadata = response;
        result = value;
      } else if (result instanceof Response) {
        if (result.headers && result.headers.has("X-Content-Raw")) return result;
        if (scripted) {
          if (result.headers) mergeResponseHeaders(headers, result.headers);
          if (result.status && !validRedirectStatuses.has(result.status)) status = result.status;
          else if (result.status) maskRedirect(headers, result, request.url);
          metadata = result;
          if (result.body == null) result = null;
        }
      }
      if (collectsFlight) {
        result = await foldFlightData(flightHooks, event, headers, { id: functionId, value: result, response: metadata, request, thrown: false }, flightContext);
        if (result instanceof Response && result.headers.has("X-Content-Raw")) return result;
      }
      if (!scripted) {
        if (handleNoJS) return handleNoJS(result == null && metadata !== undefined ? metadata : result, request, parsed);
        if (result instanceof Response) return result;
        return encodeResult(result, headers, status, codec, request.signal, scope);
      }
      if (status === 304) warnScripted304(functionId);
      if (live) return encodeLiveResult(result, headers, status, codec, request, scope);
      return encodeResult(result, headers, status, codec, request.signal, scope);
    } catch (x) {
      const respondThrown = (value) => {
        const safe = wireServerFunctionError(value, "thrown", event);
        if (!scripted) {
          if (handleNoJS) return handleNoJS(safe, request, parsed, true);
          const message = safe instanceof Error ? safe.message : String(safe);
          return new Response(DEV ? message : null, { status: 500 });
        }
        const error = safe instanceof Error ? safe.message : typeof safe === "string" ? safe : "true";
        headers.set(ERROR_HEADER, boundedErrorHeaderValue(error));
        return encodeResult(safe, headers, 500, codec, request.signal, scope);
      };
      // The result policy sees thrown outcomes too.
      if (transformResult) {
        try {
          x = await transformResult(event, x, { ...flightContext, thrown: true });
        } catch (hookError) {
          return respondThrown(hookError);
        }
      }
      if (x instanceof Response || isResponseEnvelope(x)) {
        let status = 200;
        let metadata;
        if (isResponseEnvelope(x)) {
          const { response, value } = x;
          if (response && response.headers) mergeResponseHeaders(headers, response.headers);
          if (response && response.status && (!scripted || !validRedirectStatuses.has(response.status))) status = response.status;
          else if (response && response.status) maskRedirect(headers, response, request.url);
          metadata = response;
          x = value;
        } else if (x instanceof Response) {
          if (x.headers) mergeResponseHeaders(headers, x.headers);
          if (x.status && (!scripted || !validRedirectStatuses.has(x.status))) status = x.status;
          else if (x.status) maskRedirect(headers, x, request.url);
          metadata = x;
          if (x.body == null) x = null;
        }
        if (collectsFlight) {
          x = await foldFlightData(flightHooks, event, headers, { id: functionId, value: x, response: metadata, request, thrown: true }, flightContext);
          if (x instanceof Response && x.headers.has("X-Content-Raw")) {
            x = ownResponse(x);
            x.headers.set(ERROR_HEADER, "true");
            return x;
          }
        }
        headers.set(ERROR_HEADER, "true");
        if (!scripted) {
          if (handleNoJS) return handleNoJS(x ?? metadata, request, parsed, true);
          if (x instanceof Response) return x;
        }
        if (scripted && status === 304) warnScripted304(functionId);
        return encodeResult(x, headers, status, codec, request.signal, scope);
      }
      return respondThrown(x);
    }
  };
  // (Owned before the tail writes to it: the application may serve the same Response again.)
  const response = commitEventResponse(enforceComposedHeaderInvariants(ownResponse(await dispatch())), event);
  return finish(protectsRequest ? withCSRFVary(response) : response);
}

/** A fresh Response around the same body (mutable headers). */
function ownResponse(response) {
  try {
    return new Response(response.body, response);
  } catch {
    return response;
  }
}

/** Every response: `Cache-Control: no-store` unless set (not on a 304), and no body for HEAD. */
function finalizeTransportResponse(response, method) {
  const stripBody = method === "HEAD" && response.body !== null;
  const defaultsCache = !response.headers.has("Cache-Control") && response.status !== 304;
  if (stripBody || defaultsCache) {
    try {
      if (defaultsCache) response.headers.set("Cache-Control", "no-store");
      if (!stripBody) return response;
      response.body.cancel().catch(() => {});
      return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch {
      const headers = new Headers(response.headers);
      if (defaultsCache && !headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
      if (stripBody) response.body.cancel().catch(() => {});
      return new Response(stripBody ? null : response.body, { status: response.status, statusText: response.statusText, headers });
    }
  }
  return response;
}
