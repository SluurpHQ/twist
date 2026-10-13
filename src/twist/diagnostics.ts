// Twist's findings on Solid's diagnostics channel (the core's OBSERVE: one channel, records and console for the
// browser's runtime and the server's). The server's reactive scopes are Twist's own: their owner paths and exclusions
// are read here, the core's from the core.
declare const process: { env: Record<string, string | undefined> };
import {
  OBSERVE as CORE_OBSERVE,
  emitDiagnostic as coreEmit,
  reportDiagnostic as coreReport,
  ownerPath as coreOwnerPath,
  isExcluded as coreExcluded,
  isSuppressed as coreSuppressed,
  anyExcluded as coreAnyExcluded,
  setConsoleFooter as coreFooter,
  type DiagnosticEvent,
} from "./core/core/dev.ts";

export type Diagnostic = DiagnosticEvent & { [k: string]: unknown };

/** Whether a subject is the core's (an owner or node of src/twist/core: its links are its own fields, not getters). */
const isCore = (subject: any) => !!subject && typeof subject === "object" && (Object.hasOwn(subject, "_parent") || Object.hasOwn(subject, "_owner"));
/** The server kernel's owner a subject is or belongs to (a signal: the owner it was made under). */
const ownerOf = (subject: any) => (subject && ("parent" in subject || "owned" in subject) ? subject : (subject?.owner ?? null));
/** What a finding with no subject given is about: the owner running now (set by the server's reactive core). */
let ambient: () => unknown = () => null;
export const setAmbientSubject = (fn: () => unknown) => void (ambient = fn);

/** Owners of the server's kernel an observer excluded (true) or included back (false); the nearest decides. */
const marked = new WeakMap<object, boolean>();
let anyMarked = false;
export const anyExcluded = () => anyMarked || coreAnyExcluded();
/** Findings about an excluded scope of the server's kernel: made, told to nobody. */
const suppressed = new WeakSet<object>();
export const isSuppressed = (entry: object) => suppressed.has(entry) || coreSuppressed(entry as DiagnosticEvent);
export function isExcluded(subject: any): boolean {
  if (isCore(subject)) return coreExcluded(subject);
  if (!anyMarked || !subject) return false;
  for (let o = ownerOf(subject); o; o = o.parent) {
    const m = marked.get(o);
    if (m !== undefined) return m;
  }
  return false;
}

/** The names of the owners down to `subject` (components and named nodes), outermost first. */
export function ownerPath(subject: any): string[] | undefined {
  if (!subject) return undefined;
  if (isCore(subject)) return coreOwnerPath(subject);
  const path: string[] = [];
  for (let o = ownerOf(subject); o; o = o.parent) {
    // (A label given the way a component owner gets one, `_name`, counts too.)
    const name = o.name ?? (Object.hasOwn(o, "_name") ? o._name : undefined);
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

export const setConsoleFooter = (footer: ((event: Diagnostic) => string | undefined) | undefined) => coreFooter(footer as any);

/** A finding on the structured channel (listeners, captures); returned, for the console step. */
export function emitDiagnostic(event: Omit<Diagnostic, "sequence">, subject: unknown = ambient()): Diagnostic {
  if (isCore(subject) || subject == null) return coreEmit(event as any, subject as any) as Diagnostic;
  if (isExcluded(subject)) {
    const entry = { sequence: 0, ...event } as Diagnostic;
    suppressed.add(entry);
    return entry;
  }
  const path = event.ownerPath ?? ownerPath(subject);
  return coreEmit((path ? { ...event, ownerPath: path } : event) as any, subject as any) as Diagnostic;
}

/** A finding on the console: its message and where (`in A › B`); errors as errors, the rest as warnings. */
export const reportDiagnostic = (entry: Diagnostic) => void (suppressed.has(entry) || coreReport(entry));

/** Graph-size warnings: from this many subscribers (or sources) up, again each time it has grown by the step. */
export const GRAPH_SIZE_WARN_AT = 2000;
export const GRAPH_SIZE_WARN_EVERY = 500;
const graphSizeWarnedAt = new WeakMap<object, number>();
function shouldWarnGraphSize(node: object, count: number) {
  const last = graphSizeWarnedAt.get(node);
  if (last !== undefined && count < last + GRAPH_SIZE_WARN_EVERY) return false;
  graphSizeWarnedAt.set(node, count);
  return true;
}
/** A change about to run `count` subscribers again (said once per node, until it grows). */
export function noteFanOut(node: { name?: string }, count: number, write?: string) {
  if (!shouldWarnGraphSize(node, count)) return;
  const name = node.name;
  const message =
    `[HUGE_FAN_OUT] ${name ? `Signal "${name}"` : "A signal"} changed with ${count} subscribers — ` +
    `every one re-runs this flush. If many independent computations read the same value ` +
    `(for example every row of a list comparing against one selected id), prefer a per-key ` +
    `store or projection so only the items whose result flipped update.`;
  reportDiagnostic(emitDiagnostic({ code: "HUGE_FAN_OUT", kind: "graph", severity: "warn", message, nodeName: name, ownerName: name, data: write === undefined ? { count } : { count, write } }, node));
}
/** A run that tracked `count` distinct sources (said once per node, until it grows). */
export function noteFanIn(node: { name?: string }, count: number) {
  if (!shouldWarnGraphSize(node, count)) return;
  const name = node.name;
  const message =
    `[HUGE_FAN_IN] ${name ? `Computation "${name}"` : "A computation"} tracked ${count} sources. ` +
    `It will re-run when any of them change. Narrow the read or split the derivation so each ` +
    `computation tracks only what it needs.`;
  reportDiagnostic(emitDiagnostic({ code: "HUGE_FAN_IN", kind: "graph", severity: "warn", message, nodeName: name, ownerName: name, data: { count } }, node));
}

/** Emitted and reported: the common case. */
export function diagnose(event: Omit<Diagnostic, "sequence">, subject: unknown = null) {
  const entry = emitDiagnostic(event, subject);
  if (entry.severity !== "info") reportDiagnostic(entry);
  return entry;
}

/** Where a server render takes the route a router declares (the render running now's), if one listens. */
let routeDeclarer: (() => ((ref: unknown) => void) | undefined) | null = null;
export const setRouteDeclarer = (fn: typeof routeDeclarer) => void (routeDeclarer = fn);

/** Solid's observe surface (none in production): the core's, told of the server kernel's owners too. */
export const OBSERVE = CORE_OBSERVE;
if (OBSERVE) {
  // (On a server, with no engine installed: a router's first declaration names the render it runs in.)
  const slot = OBSERVE.attribution;
  const withOrigin = slot.withOrigin;
  slot.withOrigin = function <T>(ref: any, fn: () => T): T {
    if (slot.installed === null && ref?.kind === "navigation" && ref.initial) routeDeclarer?.()?.(ref);
    return withOrigin.call(slot, ref, fn) as T;
  };
}
