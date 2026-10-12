// The client half of server functions: a compiled `"use server"` reference is `createServerReference(id)`, a fetch
// to the server's handler. `GET(fn)` makes a cacheable read, `live(fn)` a reconnecting source. (Solid's
// server-functions/client.)
// @ts-nocheck
import { REVALIDATE_HEADER } from "../response.ts";
import { observeCall } from "../observe.ts";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ERROR_HEADER,
  EventStreamReader,
  LAST_EVENT_ID_HEADER,
  LIVE_LOCAL,
  LIVE_RESUME_FROM,
  LIVE_SOURCE,
  LIVE_WIRE,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SERVER_FUNCTION_METADATA,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  configureServerFunctionsCodec,
  decodeResponse,
  deliverFlightData,
  extractBody,
  getFlightDataSourceIds,
  getHeadersAndBody,
  hasFlightMetadata,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  isJSONSafe,
  isServerFunction,
  MAX_GET_URL_LENGTH,
  parseServerFunctionAddress,
  positionDigest,
  provideServerFunctionRPC,
  serverFunctionActionUrlFor,
  serverFunctionAddress,
  serverFunctionDataAddress,
  serverFunctionLiveAddress,
  serverFunctionUrlFor,
  withMeta,
} from "./shared.ts";

export {
  ChunkReader,
  ERROR_HEADER,
  EVENT_STREAM_HEARTBEAT,
  EventStreamReader,
  FLASH_COOKIE,
  LAST_EVENT_ID_HEADER,
  LIVE_WIRE,
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
  deliverFlightData,
  deserializeStream,
  encodeErrorHeaderValue,
  frameAddress,
  getFlightDataConsumer,
  getFlightDataSourceIds,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  hasFlashCookie,
  hasFlightMetadata,
  invoke,
  isEventStream,
  isServerFunction,
  positionDigest,
  serializeString,
  subscribeFlightData,
  withMeta,
} from "./shared.ts";
export { REVALIDATE_HEADER } from "../response.ts";

/** Development builds: warnings about open live connections over HTTP/1. */
const IS_DEV = process.env.NODE_ENV !== "production";
/** The call's observation rides the per-call options to the send (lifted off before the init is built). */
const CALL_OBSERVATION = Symbol("solid.CallObservation");

const config: any = {
  endpoint: "/_server",
  fetch: undefined,
  prepareRequest: undefined,
  responseHandler: undefined,
  serializeArgs: undefined,
};

/** The url a `GET()` reference's call requests (to preload or fetch by hand). */
export function serverFunctionUrl(fn, ...args) {
  return serverFunctionUrlFor(config.endpoint, fn, args);
}
/** A function's plain-HTTP address (a form's action), with bound arguments. */
export function serverFunctionActionUrl(fn, ...boundArgs) {
  return serverFunctionActionUrlFor(config.endpoint, fn, boundArgs);
}
/** The function id out of a rendered action url, or null. */
export function parseServerFunctionActionUrl(url) {
  const parsed = parseServerFunctionAddress(new URL(url, globalThis.location?.href || "http://localhost").pathname, config.endpoint);
  return parsed && parsed.id;
}

function serializeArguments(args) {
  if (!config.serializeArgs)
    throw new Error(
      "Server function arguments are sent as JSON by default and these " +
        "arguments are not JSON-serializable. Call enableRichArguments() " +
        '(from "@solidjs/web/server-functions/rich-args") once at startup ' +
        "to send Dates, Maps, Sets, typed arrays, etc. through the codec — " +
        "or pass a single Blob/FormData/File argument, which has a native " +
        "HTTP encoding.",
    );
  return config.serializeArgs(args);
}

/** The transport's settings: endpoint, codec, fetch, the `prepareRequest` hook, the response handler, arguments' encoder. */
export function configureServerFunctionsClient({ endpoint, codec, fetch, prepareRequest, responseHandler, serializeArgs } = {}) {
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (codec !== undefined) configureServerFunctionsCodec(codec);
  if (fetch !== undefined) config.fetch = fetch;
  if (prepareRequest !== undefined) config.prepareRequest = prepareRequest;
  if (responseHandler !== undefined) config.responseHandler = responseHandler;
  if (serializeArgs !== undefined) config.serializeArgs = serializeArgs;
}

// The RPC seam filled when the first reference is made (not at module scope).
let rpcProvided = false;
function provideRPC() {
  if (rpcProvided) return;
  rpcProvided = true;
  provideServerFunctionRPC({ GET, decodeResponse });
}

/** A rendered plain address's sibling of another kind (`data`, `live`): the kind's segment before the id. */
function siblingAddressFor(base, kind) {
  const splitAt = base.search(/[?#]/);
  const path = splitAt < 0 ? base : base.slice(0, splitAt);
  const rest = splitAt < 0 ? "" : base.slice(splitAt);
  const slash = path.lastIndexOf("/");
  if (path.endsWith(`/${kind}/`, slash + 1)) return base;
  return `${path.slice(0, slash + 1)}${kind}/${path.slice(slash + 1)}${rest}`;
}
const dataAddressFor = (base) => siblingAddressFor(base, "data");
const liveAddressFor = (base) => siblingAddressFor(base, "live");

/** The error a failed call throws: the server's, or one naming the status; status and Retry-After on it. */
function serverFunctionFailure(response, value) {
  const unknown = response.headers.get(UNKNOWN_HEADER) !== null;
  const error =
    value ?? new Error(unknown ? "Server function is not part of the deployment that answered (version skew or removed function)" : `Server function call failed with status ${response.status}`);
  if (error instanceof Error && !("status" in error)) {
    error.status = response.status;
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
  }
  if (unknown && error instanceof Error) error.unknownFunction = true;
  return error;
}
function parseRetryAfter(header) {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** A read (GET, or declared `read: true`): no single-flight collection. */
function isReadCall(options) {
  return !!options.read || (!!options.method && options.method.toUpperCase() === "GET");
}

async function createRequest(base, id, options, meta) {
  const headers = { ...options.headers };
  // A live reconnect says where it left off (only to the live address, which nothing caches).
  const wire = options[LIVE_WIRE];
  if (wire) {
    options = { ...options };
    delete options[LIVE_WIRE];
    if (wire.position !== undefined) headers[LAST_EVENT_ID_HEADER] = wire.position;
    if (wire.headers) Object.assign(headers, wire.headers);
  }
  const observation = options[CALL_OBSERVATION];
  if (observation) {
    options = { ...options };
    delete options[CALL_OBSERVATION];
  }
  // A mutation asks for the sources the page can take (a read carries no header of the transport's own).
  const flightSources = getFlightDataSourceIds();
  if (flightSources.length > 0 && !isReadCall(options)) headers[SINGLE_FLIGHT_HEADER] = flightSources.join(",");
  let init = { method: "POST", ...options, headers };
  if (config.prepareRequest) {
    const prepared = await config.prepareRequest(init, { id, meta });
    // (A returned init without the transport's method would send the call without its payload.)
    if (prepared && prepared !== init) {
      if (typeof prepared !== "object")
        throw new Error(
          "prepareRequest must return (or mutate and return) the RequestInit it received; " +
            `it returned a ${typeof prepared}. Spread the init: ` +
            "init => ({ ...init, headers: { ...init.headers, ... } })",
        );
      if (typeof prepared.method !== "string" || prepared.method.toUpperCase() !== init.method.toUpperCase())
        throw new Error(
          `prepareRequest returned an init without the transport's ${init.method} method, ` +
            "which would send the call without its payload or protocol. Spread the init it " +
            "received: init => ({ ...init, headers: { ...init.headers, ... } })",
        );
    }
    init = prepared || init;
  }
  if (observation) observation.request(base, init);
  const send = config.fetch || fetch;
  return send(base, init);
}

/** The request for these arguments: none; one with an HTTP encoding as it is; JSON; bound + natural; else the codec. */
async function initializeResponse(base, id, options, args, meta) {
  if (args.length === 0) return createRequest(base, id, options, meta);
  if (args.length === 1) {
    const result = getHeadersAndBody(args[0]);
    if (result) return createRequest(base, id, { ...options, body: result.body, headers: { ...options.headers, ...result.headers } }, meta);
  }
  try {
    if (isJSONSafe(args))
      return createRequest(base, id, { ...options, body: JSON.stringify(args), headers: { ...options.headers, "Content-Type": "application/json", [BODY_FORMAT_HEADER]: BodyFormat.Json } }, meta);
  } catch {}
  // Bound arguments then a natural body (a form action with bound values): the leading ones ride the url.
  if (args.length > 1) {
    try {
      const last = args[args.length - 1];
      const trailing = typeof last !== "string" && getHeadersAndBody(last);
      const leading = args.slice(0, -1).map((arg) => (arg === undefined ? null : arg));
      if (trailing && isJSONSafe(leading)) {
        const target = base + (base.includes("?") ? "&" : "?") + "args=" + encodeURIComponent(JSON.stringify(leading));
        return createRequest(target, id, { ...options, body: trailing.body, headers: { ...options.headers, ...trailing.headers } }, meta);
      }
    } catch {}
  }
  return createRequest(
    base,
    id,
    { ...options, body: await serializeArguments(args), headers: { ...options.headers, "Content-Type": "text/plain", [BODY_FORMAT_HEADER]: BodyFormat.Serialized } },
    meta,
  );
}

/** The call, observed (`"request"` at the send, `"call"` at settle) when anything listens. */
async function fetchServerFunction(base, id, options, args, meta, callArgs = args) {
  const observation = observeCall(id, options.method && options.method.toUpperCase() === "GET" ? "GET" : "POST", callArgs, meta && meta.name);
  if (!observation) return dispatchServerFunction(base, id, options, args, meta, callArgs);
  let result;
  try {
    result = await dispatchServerFunction(base, id, options, args, meta, callArgs, observation);
  } catch (error) {
    observation.settle("error", error);
    throw error;
  }
  observation.settle("ok", result);
  return result;
}

async function dispatchServerFunction(base, id, options, args, meta, callArgs = args, observation?) {
  // Captured at the call site (before any await): ambient call context is still live.
  const handler = config.responseHandler;
  const context = handler && handler.capture ? handler.capture({ id, meta }) : undefined;
  const sent = options;
  // Its own controller (unless the caller brought a signal): ending a streamed result ends the call.
  const controller = options.signal ? undefined : new AbortController();
  if (controller) options = { ...options, signal: controller.signal };
  if (observation) options = { ...options, [CALL_OBSERVATION]: observation };

  const response = await initializeResponse(base, id, options, args, meta);
  if (observation) observation.response(response);

  if (handler) {
    const ctx = { id, meta, args: callArgs, context, retry: () => fetchServerFunction(base, id, sent, args, meta, callArgs) };
    if (options[LIVE_WIRE]) ctx[LIVE_WIRE] = options[LIVE_WIRE];
    const handled = handler.handle(response, ctx);
    if (handled !== undefined) return handled;
  }

  // 400 and up without a body format: the peer refused (its body is not ours to decode).
  if (response.status >= 400 && !response.headers.has(BODY_FORMAT_HEADER)) throw serverFunctionFailure(response, undefined);
  const failed = response.headers.has(ERROR_HEADER);

  // A mutation with flight consumers: they get the folded data and the response's metadata; the caller the value.
  if (!isReadCall(options) && getFlightDataSourceIds().length > 0) {
    const folded = response.headers.has(SINGLE_FLIGHT_HEADER);
    const metadata = hasFlightMetadata(response);
    if (metadata || folded) {
      const decoded = response.body ? await extractBody(response, getServerFunctionsCodec()) : undefined;
      const enveloped = folded && decoded !== undefined;
      const value = enveloped ? decoded.value : decoded;
      await deliverFlightData(response, enveloped ? decoded.data : undefined);
      if (failed && !metadata) throw serverFunctionFailure(response, value);
      return value;
    }
  }

  // What an integration must see whole (redirects, revalidation, single-flight, a peer's 3xx): handed back as it is.
  if (
    response.headers.has(REDIRECT_HEADER) ||
    response.headers.has(REVALIDATE_HEADER) ||
    response.headers.has(SINGLE_FLIGHT_HEADER) ||
    (response.status >= 300 && response.status < 400 && response.status !== 304)
  )
    return response;

  // A success the runtime did not write (a portal, a CDN page): not our server.
  if (response.status < 300 && !response.headers.has(BODY_FORMAT_HEADER) && !response.headers.has("X-Content-Raw"))
    throw serverFunctionFailure(
      response,
      new Error(
        `Server function response carries no recognized encoding (status ${response.status}` +
          `${response.headers.get("Content-Type") ? `, content-type ${response.headers.get("Content-Type")}` : ""}): answered by something other than the server function runtime`,
      ),
    );

  const result = response.body ? await extractBody(response, getServerFunctionsCodec(), options[LIVE_WIRE]) : undefined;
  if (failed) throw serverFunctionFailure(response, result);
  // A streamed result: stopping the iteration stops the call.
  if (controller && result?.[Symbol.asyncIterator])
    return {
      [Symbol.asyncIterator]() {
        const it = result[Symbol.asyncIterator]();
        return { next: () => it.next(), return: (value) => (controller.abort(), Promise.resolve({ done: true, value })) };
      },
    };
  return result;
}

/** The callable for a server function id (compiler ABI): `id`, `url`, and calls over the data address. */
export function createServerReference(id, name, base) {
  provideRPC();
  const metadata = name === undefined ? {} : { name };
  // One body for `fn(...args)` and `invoke(fn, options, ...args)`.
  const run = (args, invokeOptions) => {
    const send = () => fetchServerFunction(base ? dataAddressFor(base) : serverFunctionDataAddress(config.endpoint, id), id, invokeOptions ? { ...invokeOptions } : {}, args, metadata);
    // An integration holding the answer already answers now (synchronously).
    const handler = config.responseHandler;
    if (handler && handler.intercept && !adoptedCall(invokeOptions)) {
      const hit = handler.intercept({ id, meta: metadata, args, retry: send });
      if (hit !== undefined) return localOrSend(hit, send);
    }
    return send();
  };
  const fn = (...args) => run(args);
  fn[SERVER_FUNCTION_METADATA] = metadata;
  fn[SERVER_FUNCTION_INVOKE] = run;
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "id") return id;
      if (prop === "url") return base || serverFunctionAddress(config.endpoint, id);
      return target[prop];
    },
  });
}

/** A server function called over GET (arguments in the query): cacheable. A safety assertion: reads only. */
export function GET(fn) {
  if (!isServerFunction(fn)) throw new Error("GET expects a server function reference");
  provideRPC();
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn) };
  const run = async (args, invokeOptions) => {
    const handler = config.responseHandler;
    if (handler && handler.intercept && !adoptedCall(invokeOptions)) {
      const retry = () => send(args, invokeOptions);
      const hit = handler.intercept({ id, meta: metadata, args, retry });
      if (hit !== undefined) return localOrSend(hit, retry);
    }
    return send(args, invokeOptions);
  };
  const send = async (args, invokeOptions) => {
    const opts = invokeOptions || {};
    const address = opts[LIVE_WIRE] ? serverFunctionLiveAddress(config.endpoint, id) : serverFunctionDataAddress(config.endpoint, id);
    if (!args.length) return fetchServerFunction(address, id, { ...opts, method: "GET" }, [], metadata, args);
    const encoded = isJSONSafe(args) ? JSON.stringify(args) : await serializeArguments(args);
    const url = `${address}?args=${encodeURIComponent(encoded)}`;
    const absolute = new URL(url, globalThis.location?.href || "http://localhost").href;
    // Too long for a url: a POST that stays a read (a cache miss, not a 414).
    if (absolute.length > MAX_GET_URL_LENGTH) return fetchServerFunction(address, id, { ...opts, read: true }, args, metadata);
    return fetchServerFunction(url, id, { ...opts, method: "GET" }, [], metadata, args);
  };
  const wrapped: any = (...args) => run(args);
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = run;
  wrapped.id = id;
  Object.defineProperty(wrapped, "url", { get: () => serverFunctionAddress(config.endpoint, id), configurable: true });
  return withMeta(wrapped, { method: "GET" });
}

// Development: open live connections by id (six per origin over HTTP/1.1 block the page's other requests).
const openLiveConnections = IS_DEV ? new Map() : undefined;
let warnedHttp1 = false;
function trackLiveConnection(id, open) {
  const count = openLiveConnections.get(id) || 0;
  if (open) openLiveConnections.set(id, count + 1);
  else if (count > 1) openLiveConnections.set(id, count - 1);
  else openLiveConnections.delete(id);
  if (!open || warnedHttp1) return;
  let total = 0;
  for (const n of openLiveConnections.values()) total += n;
  if (total <= 5) return;
  const navigation = typeof performance !== "undefined" && typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("navigation")[0] : undefined;
  const protocol = navigation && navigation.nextHopProtocol;
  if (typeof protocol !== "string" || !/^http\/1(\.[01])?$/.test(protocol)) return;
  warnedHttp1 = true;
  const names = [...openLiveConnections].map(([fnId, n]) => (n > 1 ? `${fnId} ×${n}` : fnId));
  console.warn(
    `live: ${total} live connections are open (${names.join(", ")}) and this page was served ` +
      `over ${protocol}. Browsers allow six connections per origin under HTTP/1.1, so the next ` +
      `request to this origin — a navigation, a fetch, an image — waits behind them. live ` +
      `requires HTTP/2: the dev server speaks it with \`server.https\`; production hosts do by default.`,
  );
}

/** A local hit: the answer, or (a promise) the answer when it lands, the wire if it lands on nothing. */
function localOrSend(hit, send) {
  if (hit === null || typeof hit.then !== "function") return hit;
  return hit.then((answer) => (answer === undefined ? send() : answer));
}
/** A live connect after the document's answer was yielded: not answered locally again. */
function adoptedCall(options) {
  const wire = options && options[LIVE_WIRE];
  return !!(wire && wire.adopted);
}

/**
 * A value-shaped live source: calls give an iterable that survives its connection (deaths reconnect with backoff,
 * a first-connect failure rejects, `break` ends the request). Wire state on the iterable's `onstatus`.
 */
export function live(fn) {
  if (!isServerFunction(fn)) throw new Error("live expects a server function reference");
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const makeIterable = (args, invokeOptions) => {
    const handler = config.responseHandler;
    handler && handler.onLive && handler.onLive();
    const local = handler && handler.intercept ? handler.intercept({ id, meta: metadata, args }) : undefined;
    const iterable: any = {
      [LIVE_SOURCE]: true,
      [Symbol.asyncIterator]() {
        let it;
        let connected = false;
        let attempts = 0;
        let stopped = false;
        let closed = false;
        let ended;
        let timer, wake;
        const DONE = { done: true, value: undefined };
        const invokeSignal = invokeOptions && invokeOptions.signal;
        const controller = new AbortController();
        // Where it resumes from (the value the page was served with), and the document's own answer: yielded first.
        let resume = iterable[LIVE_RESUME_FROM];
        let seed = iterable[LIVE_LOCAL];
        const wire: any = {
          position: resume !== undefined ? positionDigest(resume) : undefined,
          connection: undefined,
          adopted: resume !== undefined,
          open: (body) => new EventStreamReader(body, wire),
        };
        // Ends of connections that died while the iteration goes on: settled by how it finally ends.
        const ends = [];
        const settle = (end, error?) => {
          try {
            error !== undefined ? end.sweep() : end.close();
          } catch {}
        };
        const settleAll = (error) => {
          while (ends.length) settle(ends.pop(), error);
        };
        const wireOptions = { ...invokeOptions, [LIVE_WIRE]: wire, signal: invokeSignal ? AbortSignal.any([invokeSignal, controller.signal]) : controller.signal };
        // The caller's signal rejects the pull at once; what is nested hears it when the body ends.
        let callerLeft;
        const unlessAborted = (p) => {
          if (!invokeSignal) return p;
          callerLeft ??= new Promise((_, reject) => {
            if (invokeSignal.aborted) reject(invokeSignal.reason);
            else invokeSignal.addEventListener("abort", () => reject(invokeSignal.reason), { once: true });
          });
          callerLeft.catch(() => {});
          return Promise.race([p, callerLeft]);
        };
        const emit = (state, error?) => {
          try {
            iterable.onstatus && iterable.onstatus(state, error);
          } catch {}
        };
        let counted = false;
        const track = (open) => {
          if (!IS_DEV || open === counted) return;
          counted = open;
          trackLiveConnection(id, open);
        };
        const emitClosed = (error?) => {
          track(false);
          settleAll(error);
          if (ended) ended.then((end) => settle(end, error));
          if (closed) return;
          closed = true;
          emit("closed", error);
        };
        const closeIt = (value?) => {
          track(false);
          const current = it;
          it = undefined;
          if (current) {
            try {
              const r = current.return && current.return(value);
              if (r && typeof r.then === "function") r.then(undefined, () => {});
            } catch {}
          }
        };
        const callOnce = () => {
          const handler = config.responseHandler;
          if (handler && handler.resume) {
            const from = handler.resume({ id, meta: metadata, args });
            wire.headers = from ? from.headers : undefined;
            if (from && from.position !== undefined) wire.position = from.position;
          }
          if (metadata.method === "GET") return fn[SERVER_FUNCTION_INVOKE](args, wireOptions);
          if (handler && handler.intercept && !wire.adopted) {
            const hit = handler.intercept({ id, meta: metadata, args });
            if (hit !== undefined) return hit;
          }
          return fetchServerFunction(liveAddressFor(fn.url), id, { ...wireOptions, read: true }, args, metadata, args);
        };
        const pull = async () => {
          if (resume !== undefined) {
            const value = resume;
            resume = undefined;
            if (!stopped) return { done: false, value };
          }
          if (seed !== undefined) {
            const value = typeof seed.then === "function" ? await seed : seed;
            seed = undefined;
            if (value !== undefined) {
              wire.adopted = true;
              if (!stopped) return { done: false, value };
            }
          }
          while (!stopped) {
            try {
              if (!it) {
                const connection = (wire.connection = { ended: undefined });
                const result = await callOnce();
                connected = true;
                ended = connection.ended;
                it =
                  result !== null && typeof result === "object" && result[Symbol.asyncIterator]
                    ? result[Symbol.asyncIterator]()
                    : (async function* () {
                        yield result;
                      })();
                if (stopped) {
                  closeIt();
                  controller.abort();
                  return DONE;
                }
                track(true);
                emit("connected");
              }
              // The answer lives as long as its response: a body ending on open deferreds is a death.
              const r = await unlessAborted(ended ? Promise.race([it.next(), ended.then((end) => ({ end }))]) : it.next());
              if (r.end || r.done) {
                const end = r.end || (ended && (await ended));
                if (end && end.open > 0) {
                  ends.push(end);
                  throw end.error;
                }
                if (end) settle(end);
                emitClosed();
                return DONE;
              }
              if (stopped) return DONE;
              attempts = 0;
              return r;
            } catch (error) {
              if (stopped) return DONE;
              if (!connected) throw error;
              if (invokeSignal && invokeSignal.aborted) {
                stopped = true;
                emitClosed(error);
                throw error;
              }
              // A definite rejection (4xx, but not 408/425/429 or one naming a Retry-After) ends it.
              if (
                error !== null &&
                typeof error === "object" &&
                typeof error.status === "number" &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 408 &&
                error.status !== 425 &&
                error.status !== 429 &&
                typeof error.retryAfter !== "number"
              ) {
                stopped = true;
                emitClosed(error);
                throw error;
              }
              closeIt();
              emit("reconnecting", error);
              await new Promise((resolve) => {
                wake = resolve;
                const named = error !== null && typeof error === "object" && typeof error.retryAfter === "number" ? Math.min(error.retryAfter * 1000, 60000) : undefined;
                timer = setTimeout(resolve, named ?? Math.min(500 * 2 ** attempts++, 10000));
                if (typeof addEventListener === "function") addEventListener("online", resolve, { once: true });
                if (invokeSignal) invokeSignal.addEventListener("abort", resolve, { once: true });
              });
              clearTimeout(timer);
              if (typeof removeEventListener === "function") removeEventListener("online", wake);
              if (invokeSignal) invokeSignal.removeEventListener("abort", wake);
              timer = wake = undefined;
            }
          }
          return DONE;
        };
        return {
          next: () => pull(),
          return(value) {
            stopped = true;
            if (timer !== undefined) clearTimeout(timer);
            if (wake) wake();
            closeIt(value);
            controller.abort();
            emitClosed();
            return Promise.resolve({ done: true, value });
          },
        };
      },
    };
    if (local !== undefined) iterable[LIVE_LOCAL] = local;
    return iterable;
  };
  const wrapped: any = (...args) => makeIterable(args);
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = makeIterable;
  wrapped.id = id;
  Object.defineProperty(wrapped, "url", { get: () => fn.url, configurable: true });
  return wrapped;
}

/** Compiler ABI for the server build only. */
export function registerServerReference() {
  throw new Error("registerServerReference must not be called in the client build");
}
/** No call is ever in flight on the client. */
export function getServerFunctionInvocation() {
  return undefined;
}
