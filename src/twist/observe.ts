// The web layer's records on `OBSERVE.records`: a server-function call from the browser (`"request"` as it leaves,
// `"call"` when it settles) and a frame stream applied (`"frame"`). Reached through the channel's registered symbol, so
// the wire layer needs no import of the core. (Solid's web/src/observe.)
// @ts-nocheck
import { traceForEvent } from "./trace.ts";

const RECORDS = Symbol.for("@solidjs/signals/observe/records");
const ATTRIBUTION = Symbol.for("@solidjs/signals/observe/attribution");

/** `OBSERVE.records`, or undefined where no observing core has loaded. */
export function records() {
  return globalThis[RECORDS];
}
/** The interaction or navigation in effect now, as the attribution engine sees it. */
function currentOrigin() {
  const hooks = globalThis[ATTRIBUTION];
  return hooks === undefined ? undefined : hooks.currentOrigin();
}

/** A promise (from any realm) as one; anything else undefined. */
export function settledPromise(value: unknown): Promise<unknown> | undefined {
  if (value instanceof Promise) return value;
  try {
    if (Object.prototype.toString.call(value) === "[object Promise]") return Promise.prototype.then.call(value, (v: unknown) => v);
  } catch {}
  return undefined;
}

/** A body the caller drives (a stream, an iterator): its work happens after the call. */
export function isDeferredBody(value: any): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return true;
  if (typeof value[Symbol.asyncIterator] === "function") return true;
  return typeof value[Symbol.iterator] === "function" && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !ArrayBuffer.isView(value);
}

/** One chunk counted into a frame record. */
export function frameCensus(event: any, type: string, own: boolean) {
  event.chunks++;
  switch (type) {
    case "html":
      if (!own) event.regions++;
      else if (event.shellMs === undefined) event.shellMs = performance.now() - event.at;
      break;
    case "fragment":
      event.fragments++;
      break;
    case "slot":
      event.slots++;
      break;
    case "error":
      event.errors++;
      break;
  }
}

/**
 * One call from the client, observed: `request(url, init)` at the send, `response(r)` when it arrives, `settle(...)`
 * when the caller has its answer. Undefined when nothing listens (then nothing extra runs). Gates are read once, here.
 */
export function observeCall(id: string, method: "GET" | "POST", args: unknown[], name?: string) {
  const channel = records();
  if (channel === undefined) return undefined;
  const observedCall = channel.observed("call");
  const observedRequest = channel.observed("request");
  if (!observedCall && !observedRequest) return undefined;
  const at = performance.now();
  const bodies = channel.observed("call", "bodies");
  const requestBodies = bodies || channel.observed("request", "bodies");
  const origin = currentOrigin();
  // One live object for both records: identity is the join.
  const live: any = { args };
  let response: Response | undefined;
  let clone: Response | undefined;
  let settled = false;
  return {
    request(url: string, init: RequestInit) {
      const sentAt = observedRequest ? performance.now() : 0;
      if (requestBodies) {
        const request = reconstructRequest(url, init);
        if (request !== undefined) live.request = request;
      }
      if (!observedRequest) return;
      const event: any = { side: "client", id, at: sentAt, method };
      if (name !== undefined) event.name = name;
      if (origin !== undefined) event.origin = origin;
      channel.emit("request", event, live);
    },
    response(r: Response) {
      response = r;
      if (!bodies) return;
      // (An event stream is not cloned: nobody would drain the branch.)
      const type = r.headers.get("content-type");
      if (type !== null && type.startsWith("text/event-stream")) return;
      try {
        clone = r.clone();
      } catch {}
    },
    settle(outcome: "ok" | "error", value: unknown) {
      if (settled) return;
      settled = true;
      const deferred = outcome === "ok" && isDeferredBody(value);
      if (outcome === "ok") live.result = value;
      else live.error = value;
      if (deferred && clone !== undefined) {
        cancelBody(clone);
        clone = undefined;
      }
      if (clone !== undefined) live.response = clone;
      else if (response !== undefined) live.response = response;
      if (!observedCall) return;
      const event: any = { id, at, durationMs: performance.now() - at, method, outcome };
      if (name !== undefined) event.name = name;
      if (response !== undefined) event.status = response.status;
      if (origin !== undefined) event.origin = origin;
      if (deferred) event.deferred = true;
      channel.emit("call", event, live);
    },
  };
}

/** The dispatched request rebuilt for a listener to read (never a throw: undefined when it cannot be). */
function reconstructRequest(url: string, init: RequestInit): Request | undefined {
  try {
    return new Request(new URL(url, globalThis.location?.href), { ...init, body: reconstructableBody(init.body) });
  } catch {
    return undefined;
  }
}
/** A body a second Request can hold without taking it from the send (streams cannot). */
function reconstructableBody(body: any) {
  if (body == null || typeof body === "string") return body;
  if (body instanceof URLSearchParams || (typeof FormData !== "undefined" && body instanceof FormData) || (typeof Blob !== "undefined" && body instanceof Blob) || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body;
  return undefined;
}
function cancelBody(response: Response) {
  try {
    const body = response.body;
    if (body !== null) body.cancel().catch(() => {});
  } catch {}
}

/** One frame-stream response applied on the client: each stream in it a `"frame"` record. */
export function observeFrameApply(response: Response) {
  const channel = records();
  if (channel === undefined || !channel.observed("frame")) return undefined;
  let current: { event: any; applied: string } | undefined;
  const close = (outcome: string, error?: unknown) => {
    const open = current!;
    current = undefined;
    open.event.durationMs = performance.now() - open.event.at;
    open.event.outcome = outcome;
    const live: any = { response };
    if (error !== undefined) live.error = error;
    channel.emit("frame", open.event, live);
  };
  return {
    chunk(chunk: { type: string; id: string; version: number }, wireId: string) {
      if (chunk.type === "start") {
        if (current !== undefined) close("truncated");
        const event: any = { side: "client", id: wireId, version: chunk.version, at: performance.now(), durationMs: 0, outcome: "complete", chunks: 0, fragments: 0, slots: 0, regions: 0, errors: 0 };
        if (chunk.id !== wireId) event.address = chunk.id;
        current = { event, applied: chunk.id };
        return;
      }
      if (current === undefined) return;
      if (chunk.type === "complete") {
        if (chunk.id === current.applied) close("complete");
        return;
      }
      frameCensus(current.event, chunk.type, chunk.id === current.applied);
    },
    end(error?: unknown) {
      if (current !== undefined) close(error !== undefined ? "error" : "truncated", error);
    },
  };
}

// ---------------------------------------------------------------- the server's records

/** Whether the server builds a record of `type` (and its Server-Timing metric): always in development. */
export function timesServerWork(type: "invocation" | "render" | "boundary"): boolean {
  return records() !== undefined;
}

/** A render's `"render"` record, filled as the render goes and delivered when it ends. */
export function observeRender(trace: any, mode: "string" | "stream", event: unknown) {
  if (!timesServerWork("render")) return undefined;
  const record: any = { mode, at: performance.now(), durationMs: 0, boundaries: 0, outcome: "complete" };
  trace.render = record;
  let settled = false;
  let route: any;
  return {
    shell() {
      if (!settled && record.shellMs === undefined) record.shellMs = performance.now() - record.at;
    },
    boundary() {
      if (!settled) record.boundaries++;
    },
    route(ref: any) {
      if (!settled) route = ref;
    },
    settle(outcome: string) {
      if (settled) return;
      settled = true;
      record.durationMs = performance.now() - record.at;
      record.outcome = outcome;
      if (route !== undefined) {
        const r: any = {};
        if (route.name !== undefined) r.name = route.name;
        if (route.to !== undefined) r.to = route.to;
        if (route.params !== undefined) r.params = route.params;
        record.route = r;
      }
      const channel = records();
      if (!channel.observed("render")) return;
      const live: any = { trace: trace.context };
      if (event !== undefined) live.event = event;
      channel.emit("render", record, live);
    },
  };
}

/** A frame stream produced on the server: counted chunk by chunk, delivered when it completes. */
export function observeFrame(frame: { id: string; version: number }) {
  const channel = records();
  if (channel === undefined || !channel.observed("frame")) return undefined;
  const event: any = { side: "server", id: frame.id, version: frame.version, at: performance.now(), durationMs: 0, outcome: "complete", chunks: 0, fragments: 0, slots: 0, regions: 0, errors: 0 };
  let settled = false;
  return {
    chunk(chunk: { type: string; id: string }) {
      if (chunk.type === "complete") return;
      frameCensus(event, chunk.type, chunk.id === frame.id);
    },
    settle(outcome: string, error?: unknown) {
      if (settled) return;
      settled = true;
      event.durationMs = performance.now() - event.at;
      event.outcome = outcome;
      const live: any = {};
      if (outcome === "error") live.error = error;
      channel.emit("frame", event, live);
    },
  };
}

function deliverInvocation(context: any, at: number, boundary: string | undefined, outcome: "ok" | "error", value: unknown) {
  const record: any = { id: context.id, direct: context.direct, at, durationMs: performance.now() - at, outcome };
  if (boundary !== undefined) record.boundary = boundary;
  if (outcome === "ok" && isDeferredBody(value)) record.deferred = true;
  // On the request's Server-Timing, filed before a listener could commit the response.
  traceForEvent(context.event).timing.push({ type: "invocation", event: record });
  const channel = records();
  if (!channel.observed("invocation")) return;
  const live: any = { event: context.event, args: context.args };
  if (context.request !== undefined) live.request = context.request;
  if (outcome === "ok") live.result = value;
  else live.error = value;
  channel.emit("invocation", record, live);
}

/** A server-function execution, run and reported as an `"invocation"` record when it settles. */
export function observeInvocation<T>(context: { id: string; direct: boolean; event: any; request?: Request; args: unknown[]; boundary?: string }, execute: () => T): T {
  if (!timesServerWork("invocation")) return execute();
  const at = performance.now();
  const boundary = context.direct ? context.boundary : undefined;
  let result: T;
  try {
    result = execute();
  } catch (error) {
    deliverInvocation(context, at, boundary, "error", error);
    throw error;
  }
  const promised = settledPromise(result);
  if (promised !== undefined)
    return promised.then(
      (value) => (deliverInvocation(context, at, boundary, "ok", value), value),
      (error) => {
        deliverInvocation(context, at, boundary, "error", error);
        throw error;
      },
    ) as T;
  deliverInvocation(context, at, boundary, "ok", result);
  return result;
}
