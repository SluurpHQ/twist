// The server's request layer: the request event in scope (`getRequestEvent`, `provideRequestEvent`), the response
// head a render and handlers write to (a stub, committed once as it leaves), middleware, the server error hook and
// the request's trace. Web-standard Request/Response only. (Solid's web/src/server request half, and its server
// error reporting.)
// @ts-nocheck
import { getOwner, onCleanup, throwerOf, verdictOf } from "./server/signals.ts";
import { renderContextOf } from "./server/twist.ts";
import { emitDiagnostic, ownerPath, reportDiagnostic } from "./diagnostics.ts";
import { COMPOSED_BODY_FRAMING, REVALIDATE_HEADER } from "./response.ts";
import { appendTraceServerTiming, hasServerTiming, mergeServerTiming, traceForEvent } from "./trace.ts";

import { RequestContext } from "./response.ts";
export { RequestContext };

export interface ResponseStub {
  status?: number;
  statusText?: string;
  headers: Headers;
  committed: boolean;
}
export interface RequestEvent {
  request: Request;
  locals: Record<string | symbol, any>;
  response?: ResponseStub;
}

export { renderContextOf };

/** The request event in scope (undefined outside one, and on the client). */
export function getRequestEvent(): RequestEvent | undefined {
  const store = (globalThis as any)[RequestContext];
  if (!store) return undefined;
  const event = store.getStore();
  if (event) return event;
  const ctx = renderContextOf(getOwner());
  return (
    (ctx && ctx.event) ||
    console.warn(
      "RequestEvent is missing. This is most likely due to accessing `getRequestEvent` non-managed async scope in a partially polyfilled environment. Try moving it above all `await` calls.",
    )
  );
}
/** The request scope's event, silently (no fallback, no warning). */
export function peekRequestEvent(): RequestEvent | undefined {
  const store = (globalThis as any)[RequestContext];
  return store ? store.getStore() : undefined;
}

/** Everything `cb` runs (across awaits) sees `init` as its request event. */
export function provideRequestEvent<T extends RequestEvent, U>(init: T, cb: () => U): U {
  if (typeof window !== "undefined" && typeof (globalThis as any).Bun === "undefined" && typeof process === "undefined")
    throw new Error("Attempting to use server context in non-server build");
  const g = globalThis as any;
  const ctx = (g[RequestContext] ||= new (requireAsyncLocalStorage())());
  return ctx.run(init, cb);
}
let AsyncLocalStorageClass: any;
function requireAsyncLocalStorage() {
  if (AsyncLocalStorageClass) return AsyncLocalStorageClass;
  AsyncLocalStorageClass = (globalThis as any).AsyncLocalStorage ?? (process as any).getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage;
  if (!AsyncLocalStorageClass) throw new Error("provideRequestEvent needs AsyncLocalStorage (node:async_hooks)");
  return AsyncLocalStorageClass;
}

/** The trace the current request belongs to (or, outside one, the caller's render's). */
export function getTraceContext() {
  const event = peekRequestEvent();
  if (event) return traceForEvent(event).context;
  const ctx = renderContextOf(getOwner());
  return ctx && ctx.trace ? ctx.trace.context : undefined;
}

// ---------------------------------------------------------------- the server error hook

const SAFE_ERROR = Symbol.for("solid.SafeError");
const SERVER_ERRORS = Symbol.for("solid-js/server/errors");
const GENERIC_SERVER_ERROR_MESSAGE = "Internal Server Error";
const IS_DEV = process.env.NODE_ENV !== "production";

export interface ServerErrorSite {
  kind: "render" | "server-function" | "request";
  handling: "fallback" | "client" | "failed" | "serialize" | "thrown" | "channel";
  boundary?: string;
  ownerPath?: string[];
  boundaryPath?: string[];
  functionId?: string;
  direct?: boolean;
  event?: unknown;
}
export type ServerErrorHook = (error: unknown, context: ServerErrorSite) => unknown | void;

// (One verdict per error, the server layer's: a failure its boundaries met and one met here are heard once.)
type Verdict = NonNullable<ReturnType<typeof verdictOf>>;
const isObject = (value: unknown): value is object => value !== null && (typeof value === "object" || typeof value === "function");
const ambientServerErrorHook = (): ServerErrorHook | undefined => (globalThis as any)[SERVER_ERRORS]?.hook;

/** The process-wide server error hook: hears every failure the runtime handles, once per error; its return is the wire value. */
export function configureServerErrors(config: { onError?: ServerErrorHook }) {
  if (config && config.onError !== undefined && typeof config.onError !== "function") throw new TypeError(`Invalid onError: expected a function, received ${typeof config.onError}.`);
  ((globalThis as any)[SERVER_ERRORS] ||= {}).hook = config ? config.onError : undefined;
}

/** How a render error was handled, as its finding says it. */
const HANDLED: Record<string, string> = {
  fallback: "Render error caught by <Errored>",
  client: "Render error in a <Loading> fragment — the fragment rejected and the client re-renders it",
  failed: "Render error outside any boundary — the request failed",
};
/** A render error the server contained, recorded where it was thrown (the boundary that met it beside). */
function renderErrorFinding(value: unknown, site: ServerErrorSite, subject: unknown) {
  const handling = site.handling as string;
  const boundaryPath = subject ? ownerLabels(subject) : undefined;
  const at = handling === "failed" ? null : (throwerOf(value) ?? subject ?? null);
  const data: Record<string, unknown> = { handling, error: value };
  if (boundaryPath) data.boundaryPath = boundaryPath;
  if ((site as any).boundary !== undefined) data.boundary = (site as any).boundary;
  const entry = emitDiagnostic({ code: "SSR_RENDER_ERROR_CONTAINED", kind: "ssr", severity: "error", message: `[SSR_RENDER_ERROR_CONTAINED] ${HANDLED[handling] ?? "Render error"}: ${errorText(value)}`, data }, at);
  // (A failed render is the caller's to report: recorded only.)
  if (IS_DEV && handling !== "failed") reportDiagnostic(entry);
}

/** Root-first component labels up an owner chain. */
function ownerLabels(subject: any): string[] | undefined {
  if (!subject || !("_parent" in subject)) return undefined;
  const path = ownerPath(subject);
  return path && path.length ? path : undefined;
}

/** Tells the hook (the request's, else the ambient one) about `value` once; `{ mapped, value }` when it gave a wire value. */
export function reportServerError(value: unknown, site: ServerErrorSite, subject?: unknown, hook?: ServerErrorHook): { mapped: boolean; value?: unknown; heard?: boolean } {
  const verdict = verdictOf(value);
  if (verdict !== undefined && verdict.reported) return verdict.decided ? { mapped: true, value: verdict.wire } : { mapped: false, heard: true };
  if (verdict !== undefined) verdict.reported = true;
  if (site.kind === "render") renderErrorFinding(value, site, subject);
  const target = hook ?? ambientServerErrorHook();
  if (target === undefined) return { mapped: false };
  const context: ServerErrorSite = { ...site };
  const boundary = subject ? ownerLabels(subject) : undefined;
  if (context.ownerPath === undefined) {
    const thrower = throwerOf(value);
    const path = (thrower !== undefined ? ownerLabels(thrower) : undefined) ?? boundary;
    if (path !== undefined) context.ownerPath = path;
  }
  if (context.boundaryPath === undefined && boundary !== undefined) context.boundaryPath = boundary;
  if (context.event === undefined) {
    const event = peekRequestEvent();
    if (event !== undefined) context.event = event;
  }
  let mapped: unknown;
  try {
    mapped = target(value, context);
  } catch (hookError) {
    console.error(hookError);
    return { mapped: false, heard: true };
  }
  if (mapped === undefined || site.handling === "failed") return { mapped: false, heard: true };
  if (verdict !== undefined) {
    verdict.decided = true;
    verdict.wire = mapped;
  }
  return { mapped: true, value: mapped };
}

/** What the client may see in place of a render failure: the hook's mapping, else itself (dev, or marked safe), else a generic Error. */
export function ssrSanitizeError(value: unknown, subject?: unknown, site?: ServerErrorSite, hook?: ServerErrorHook): unknown {
  const verdict = verdictOf(value);
  if (site !== undefined) {
    const report = reportServerError(value, site, subject, hook);
    if (report.mapped) return recordSanitized(value, report.value, verdict, subject);
  }
  if (verdict !== undefined && verdict.decided) return verdict.wire;
  const wire = IS_DEV || (isObject(value) && (value as any)[SAFE_ERROR]) ? value : new Error(GENERIC_SERVER_ERROR_MESSAGE);
  if (verdict !== undefined) {
    verdict.decided = true;
    verdict.wire = wire;
  }
  return recordSanitized(value, wire, verdict, subject);
}
function recordSanitized(value: unknown, wire: unknown, verdict: Verdict | undefined, subject: unknown) {
  if (wire === value || (verdict !== undefined && verdict.recorded)) return wire;
  if (verdict !== undefined) verdict.recorded = true;
  emitFinding(
    { code: "SERVER_ERROR_SANITIZED", kind: "ssr", severity: "info", message: `[SERVER_ERROR_SANITIZED] Render error replaced before reaching the client: ${errorText(value)}`, data: { source: "ssr", error: value, wire } },
    subject === undefined ? getOwner() : subject,
  );
  return wire;
}

/** A failure that fails the request outside any render or server function (a middleware throw). */
export function reportRequestFailure(error: unknown, event: RequestEvent) {
  reportServerError(error, { kind: "request", handling: "failed", event }, null);
  if (ambientServerErrorHook() === undefined) console.error(error);
}

const REQUEST_ERROR_HOOK = Symbol.for("solid-js/server/request-error-hook");
const requestHooks = (): WeakMap<object, ServerErrorHook> => ((globalThis as any)[REQUEST_ERROR_HOOK] ||= new WeakMap());
/** A render's `onError`, filed as the hook of the request it serves. */
export function setRequestErrorHook(event: object, hook: ServerErrorHook | undefined) {
  if (hook !== undefined) requestHooks().set(event, hook);
}
export function requestErrorHook(event: object | undefined): ServerErrorHook | undefined {
  return event === undefined ? undefined : requestHooks().get(event);
}

// ---------------------------------------------------------------- findings

/** A finding recorded (and reported on the console). */
export function emitFinding(finding: any, subject: unknown = getOwner()) {
  const entry = emitDiagnostic(finding, subject as any);
  reportDiagnostic(entry);
}
/** A development check's finding. */
export const devCheck = (finding: any, subject?: unknown) => emitFinding(finding, subject);
/** A finding recorded only (its site throws the message). */
export function recordFinding(finding: any, subject: unknown = getOwner()) {
  emitDiagnostic(finding, subject as any);
}
/** `Name: message` for an Error, `String(value)` otherwise. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  return String(error);
}

// ---------------------------------------------------------------- the response head

/** A fresh, uncommitted response head. */
export function createResponseStub(): ResponseStub {
  return { status: undefined, statusText: undefined, headers: new Headers(), committed: false };
}
/** An HTTP handler's request event: the request, a `locals` bag, a response head; `init` spread over them. */
export function createRequestEvent(request: Request, init?: object) {
  return { request, locals: {}, response: createResponseStub(), ...init };
}

function reportLostHeaderWrite(method: string, name: unknown) {
  const message =
    `[LATE_HEADER_WRITE] Response header write dropped: headers.${method}(${JSON.stringify(String(name))}) ` +
    "ran after the response head was sent. Write headers before the shell flushes " +
    "(or before the handler returns).";
  recordFinding({ code: "LATE_HEADER_WRITE", kind: "head", severity: "error", message, data: { method, name: String(name) } });
  if (IS_DEV) throw new Error(message);
  console.error(message);
}

/** The stub's head as it freezes: its trace's Server-Timing written, later header writes failing loudly. */
export function commitResponseStub(stub: ResponseStub, { allowLateLocation = false, event }: { allowLateLocation?: boolean; event?: RequestEvent } = {}) {
  if (!stub || stub.committed) return stub;
  const headers = stub.headers;
  if (headers && typeof headers.append === "function") {
    const trace = traceForStub(stub, event);
    if (trace) appendTraceServerTiming(headers, trace);
  }
  stub.committed = true;
  if (!headers || typeof headers.set !== "function") return stub;
  for (const method of ["set", "append", "delete"]) {
    const original = headers[method].bind(headers);
    headers[method] = function (name: string, ...rest: any[]) {
      if (allowLateLocation && method === "set" && String(name).toLowerCase() === "location") return original(name, ...rest);
      reportLostHeaderWrite(method, name);
    };
  }
  return stub;
}
function traceForStub(stub: ResponseStub, event?: RequestEvent) {
  if (!event) {
    event = peekRequestEvent();
    if (!event || event.response !== stub) return undefined;
  }
  return traceForEvent(event);
}

const validRedirectStatuses = /*#__PURE__*/ new Set([301, 302, 303, 307, 308]);
/** A redirect's status: the stub's when it is one, else 302. */
export function getExpectedRedirectStatus(response: ResponseStub) {
  if (response.status && validRedirectStatuses.has(response.status)) return response.status;
  return 302;
}

/** Headers copied with each Set-Cookie kept apart. */
export function copyInitHeaders(init?: any) {
  if (!init || !init.getSetCookie) return new Headers(init);
  const headers = new Headers();
  init.forEach((value: string, key: string) => key !== "set-cookie" && headers.append(key, value));
  for (const cookie of init.getSetCookie()) headers.append("Set-Cookie", cookie);
  return headers;
}
export function mergeStubHeaders(target: Headers, stub?: ResponseStub) {
  if (!stub) return target;
  stub.headers.forEach((value, key) => {
    if (key === "server-timing") mergeServerTiming(target, value);
    else if (key !== "set-cookie") target.set(key, value);
  });
  for (const cookie of stub.headers.getSetCookie ? stub.headers.getSetCookie() : []) target.append("set-cookie", cookie);
  return target;
}

// The protocol's own headers never come from the stub (they describe this response's encoding).
let stubGapFillExcluded: Set<string> | undefined;
const isStubGapFillExcluded = (key: string) =>
  (stubGapFillExcluded ||= new Set(
    ["X-Server-Function-Error", "X-Server-Function-Format", "X-Single-Flight", REVALIDATE_HEADER, "X-Server-Function-Redirect", "Location", ...COMPOSED_BODY_FRAMING].map((h) => h.toLowerCase()),
  )).has(key);
function fillsStubGap(key: string, headers: Headers, response: Response) {
  if (key === "set-cookie" || isStubGapFillExcluded(key)) return false;
  if (response.body === null && (key === "content-type" || key === "content-length")) return false;
  return !headers.has(key);
}

/** A response leaving through the request's head: cookies appended, gaps filled, the stub committed. */
export function commitEventResponse(response: Response, event = getRequestEvent()) {
  const stub = event && event.response;
  if (!stub || !stub.headers || stub.committed) {
    if (!event || stub) return response;
    const trace = traceForEvent(event);
    if (!hasServerTiming(trace)) return response;
    const headers = copyInitHeaders(response.headers);
    appendTraceServerTiming(headers, trace);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const cookies = stub.headers.getSetCookie ? stub.headers.getSetCookie() : [];
  commitResponseStub(stub, { event });
  let hasGaps = false;
  stub.headers.forEach((value, key) => {
    if (fillsStubGap(key, response.headers, response)) hasGaps = true;
  });
  const timing = stub.headers.get("server-timing");
  const mergesTiming = timing !== null && response.headers.has("server-timing");
  if (!cookies.length && !hasGaps && !mergesTiming) return response;
  // (Always onto a rebuilt Response: the application's object may be served again.)
  const headers = copyInitHeaders(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  stub.headers.forEach((value, key) => {
    if (fillsStubGap(key, headers, response)) headers.set(key, value);
  });
  if (mergesTiming) mergeServerTiming(headers, timing);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The head a page response derives from the stub (body framing dropped: the runtime writes the body). */
export function deriveHead(stub?: ResponseStub, responseInit: any = {}) {
  const headers = mergeStubHeaders(copyInitHeaders(responseInit.headers), stub);
  for (const header of COMPOSED_BODY_FRAMING) headers.delete(header);
  const status = (stub && stub.status) || responseInit.status || 200;
  const statusText = (stub && stub.statusText) || responseInit.statusText || undefined;
  return { status, statusText, headers };
}

/** Fetch-style middleware, `(request, next) => Response`, composed into one of the same shape. */
export function composeMiddleware(middlewares: ((request: Request, next: (request?: Request) => Promise<Response>) => Response | Promise<Response>)[]) {
  return function run(request: Request, next: (request?: Request) => Response | Promise<Response>) {
    let index = -1;
    function dispatch(i: number, req: Request): Promise<Response> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"));
      index = i;
      if (i === middlewares.length) return Promise.resolve(next(req));
      return Promise.resolve(middlewares[i](req, (override) => dispatch(i + 1, override || req)));
    }
    return dispatch(0, request);
  };
}

type Ledger<T> = { base: T; live: { value: any; append?: boolean }[] };
const statusLedgers = new WeakMap<ResponseStub, Ledger<{ status?: number; statusText?: string }>>();
const headerLedgers = new WeakMap<ResponseStub, Map<string, Ledger<any>>>();

/**
 * The response's status, declared by what renders: the latest still mounted wins; one disposed before the response
 * leaves gives way to the one before it (or to what the response had).
 */
export function httpStatus(code: number, text?: string) {
  const response = getRequestEvent()?.response;
  if (!response || response.committed) return;
  let ledger = statusLedgers.get(response);
  if (!ledger) statusLedgers.set(response, (ledger = { base: { status: response.status, statusText: response.statusText }, live: [] }));
  const mine = { value: { status: code, statusText: text } };
  ledger.live.push(mine);
  response.status = code;
  response.statusText = text;
  onCleanup(() => {
    if (response.committed || !drop(ledger!, mine)) return;
    const now = ledger!.live.length ? ledger!.live[ledger!.live.length - 1]!.value : ledger!.base;
    response.status = now.status;
    response.statusText = now.statusText;
    if (!ledger!.live.length) statusLedgers.delete(response);
  });
}

/** A response header, declared as `httpStatus` is (set, or appended; undone when what declared it goes). */
export function httpHeader(name: string, value: string, options?: { append?: boolean }) {
  const response = getRequestEvent()?.response;
  if (!response || response.committed) return;
  const headers = response.headers;
  const key = name.toLowerCase();
  const cookie = key === "set-cookie";
  let ledgers = headerLedgers.get(response);
  if (!ledgers) headerLedgers.set(response, (ledgers = new Map()));
  let ledger = ledgers.get(key);
  if (!ledger) ledgers.set(key, (ledger = { base: cookie ? headers.getSetCookie() : headers.get(name), live: [] }));
  const mine = { value, append: !!options?.append };
  ledger.live.push(mine);
  mine.append ? headers.append(name, value) : headers.set(name, value);
  onCleanup(() => {
    if (response.committed || !drop(ledger!, mine)) return;
    headers.delete(name);
    if (cookie) for (const c of ledger!.base) headers.append(name, c);
    else if (ledger!.base !== null) headers.set(name, ledger!.base);
    for (const d of ledger!.live) d.append ? headers.append(name, d.value) : headers.set(name, d.value);
    if (!ledger!.live.length) ledgers!.delete(key);
  });
}

/** A declaration out of its ledger: whether it was there. */
function drop(ledger: Ledger<any>, mine: object): boolean {
  const i = ledger.live.indexOf(mine as any);
  if (i < 0) return false;
  ledger.live.splice(i, 1);
  return true;
}
