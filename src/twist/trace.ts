// A request's trace (W3C `traceparent` / `tracestate` / `baggage`): continued from the incoming headers or
// originated, merged with an installed provider's answer (`OBSERVE.server.trace`), told to the browser in
// `Server-Timing` and `<meta>` tags only when something records it. With the server work recorded for the request
// (invocations, boundaries, the shell), projected as `Server-Timing` metrics. (Solid's web/src/trace.)
// @ts-nocheck

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentId?: string;
  sampled?: boolean;
  state?: string;
  baggage?: string;
  entries: Record<string, string>;
}
export interface TraceRecord {
  context: TraceContext;
  /** Whether the browser is told (a sampled upstream trace, or a provider that answered). */
  emit: boolean;
  timing: { type: "invocation" | "boundary"; event: any }[];
  render?: any;
}

const SERVER_SLOTS = Symbol.for("solid-js/observe/server");
const PROVIDER = Symbol.for("solid-js/observe/server/provider");

/** `OBSERVE.server`: the process-wide trace-provider slot, made once whichever copy asks first. */
export function serverSlots() {
  const g = globalThis as any;
  if (g[SERVER_SLOTS]) return g[SERVER_SLOTS];
  const trace: any = {
    provide(provider: Function) {
      trace[PROVIDER] = provider;
      return () => {
        if (trace[PROVIDER] === provider) trace[PROVIDER] = undefined;
      };
    },
  };
  return (g[SERVER_SLOTS] = { trace });
}
const currentProvider = () => (globalThis as any)[SERVER_SLOTS]?.trace?.[PROVIDER];

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = "00000000000000000000000000000000";
const ZERO_SPAN = "0000000000000000";

function parseTraceparent(value: string | null) {
  if (!value) return undefined;
  const m = TRACEPARENT.exec(value.trim());
  if (!m) return undefined;
  const [, version, traceId, parentId, flags, rest] = m;
  if (version === "ff") return undefined;
  if (version === "00" && rest !== undefined) return undefined;
  if (traceId === ZERO_TRACE || parentId === ZERO_SPAN) return undefined;
  return { traceId, parentId, sampled: (parseInt(flags, 16) & 1) === 1 };
}
function randomHex(bytes: number) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = "";
  for (let i = 0; i < buffer.length; i++) out += (buffer[i] < 16 ? "0" : "") + buffer[i].toString(16);
  return out;
}
function randomTraceId() {
  let id = randomHex(16);
  while (id === ZERO_TRACE) id = randomHex(16);
  return id;
}
function randomSpanId() {
  let id = randomHex(8);
  while (id === ZERO_SPAN) id = randomHex(8);
  return id;
}
export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled === true ? "01" : "00"}`;
}

const RECORDS_KEY = Symbol.for("@solidjs/web/trace/records");
function records(): WeakMap<object, TraceRecord> {
  const g = globalThis as any;
  return g[RECORDS_KEY] || (g[RECORDS_KEY] = new WeakMap());
}

/** The trace record for `key`, derived once. */
export function traceFor(key: object, request: Request | undefined): TraceRecord {
  const store = records();
  let record = store.get(key);
  if (record) return record;
  const headers = request ? request.headers : undefined;
  const incoming = headers ? parseTraceparent(headers.get("traceparent")) : undefined;
  const context: TraceContext = { traceId: incoming ? incoming.traceId : randomTraceId(), spanId: randomSpanId(), entries: {} };
  if (incoming) {
    context.parentId = incoming.parentId;
    context.sampled = incoming.sampled;
  }
  if (headers) {
    const state = headers.get("tracestate");
    if (state) context.state = state;
    const baggage = headers.get("baggage");
    if (baggage) context.baggage = baggage;
  }
  let answered = false;
  let providedEntries: Record<string, string> | undefined;
  const provider = currentProvider();
  if (provider) {
    let answer: Partial<TraceContext> | undefined;
    try {
      answer = provider(request);
    } catch (error) {
      console.error(error);
    }
    if (answer !== undefined && answer !== null) {
      answered = true;
      if (answer.traceId !== undefined) context.traceId = answer.traceId;
      if (answer.spanId !== undefined) context.spanId = answer.spanId;
      if (answer.parentId !== undefined) context.parentId = answer.parentId;
      if (answer.sampled !== undefined) context.sampled = answer.sampled;
      if (answer.state !== undefined) context.state = answer.state;
      if (answer.baggage !== undefined) context.baggage = answer.baggage;
      providedEntries = answer.entries;
    }
  }
  context.entries.traceparent = formatTraceparent(context);
  if (providedEntries) Object.assign(context.entries, providedEntries);
  record = { context, emit: (incoming !== undefined && incoming.sampled) || answered, timing: [] };
  store.set(key, record);
  return record;
}
/** A request event's trace (keyed on its request, which derived events share). */
export function traceForEvent(event: { request?: Request }): TraceRecord {
  return traceFor(event.request || event, event.request);
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** A Server-Timing list split on the commas outside quoted strings. */
function splitServerTiming(value: string) {
  const entries: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      entries.push(value.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(value.slice(start));
  return entries;
}
const metricName = (entry: string) => entry.split(";")[0].trim().toLowerCase();
function namesOnServerTiming(headers: Headers) {
  const names = new Set<string>();
  const existing = headers.get("server-timing");
  if (existing)
    for (const entry of splitServerTiming(existing)) {
      const name = metricName(entry);
      if (name) names.add(name);
    }
  return names;
}
/** A desc as a quoted string a header can carry (controls dropped, non-ASCII as `?`). */
const quoteDesc = (value: string) =>
  value
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\"]/g, (m) => "\\" + m);
const shellMs = (record: TraceRecord) => (record.render !== undefined ? record.render.shellMs : undefined);

export function hasServerTiming(record: TraceRecord): boolean {
  return record.emit || record.timing.length > 0 || shellMs(record) !== undefined;
}

/** The record as Server-Timing metrics: trace entries (when told; names not repeated), the shell, then the work. */
export function appendTraceServerTiming(headers: Headers, record: TraceRecord) {
  if (record.emit) {
    const entries = record.context.entries;
    let present: Set<string> | undefined;
    for (const name in entries) {
      if (!TOKEN.test(name)) continue;
      if (!present) present = namesOnServerTiming(headers);
      if (present.has(name.toLowerCase())) continue;
      headers.append("Server-Timing", `${name};desc="${quoteDesc(entries[name])}"`);
      present.add(name.toLowerCase());
    }
  }
  const shell = shellMs(record);
  if (shell !== undefined) headers.append("Server-Timing", formatMetric("solid-shell", shell));
  for (const work of record.timing) headers.append("Server-Timing", metricOf(work));
}
function metricOf(work: { type: string; event: any }) {
  if (work.type === "invocation") return formatMetric("solid-invocation", work.event.durationMs, work.event.id);
  const boundary = work.event;
  return formatMetric("solid-boundary", boundary.durationMs, boundary.ownerPath !== undefined ? boundary.ownerPath.join(" > ") : boundary.id);
}
function formatMetric(name: string, dur: number, desc?: string) {
  let out = `${name};dur=${Math.round(dur * 10) / 10}`;
  if (desc) out += `;desc="${quoteDesc(desc)}"`;
  return out;
}

/** A Server-Timing value folded onto `target` entry by entry, names `target` had already skipped. */
export function mergeServerTiming(target: Headers, value: string) {
  const present = namesOnServerTiming(target);
  for (const entry of splitServerTiming(value)) {
    const trimmed = entry.trim();
    const name = metricName(trimmed);
    if (!name || present.has(name)) continue;
    target.append("Server-Timing", trimmed);
  }
}

const escapeAttr = (value: string) => value.replace(/[&"<>]/g, (c) => (c === "&" ? "&amp;" : c === '"' ? "&quot;" : c === "<" ? "&lt;" : "&gt;"));
/** The entries as `<meta>` tags for the HTML shell (none when the browser is not told). */
export function traceMetaMarkup(record: TraceRecord): string {
  if (!record.emit) return "";
  let markup = "";
  const entries = record.context.entries;
  for (const name in entries) {
    if (!TOKEN.test(name)) continue;
    markup += `<meta name="${name}" content="${escapeAttr(entries[name])}">`;
  }
  return markup;
}
