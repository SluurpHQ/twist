// Twist's diagnostics channel, Solid 2's OBSERVE: structured findings (a code, a severity, a message, where it
// happened) to listeners and captures, and a console report per finding. The same shape and behaviour as Solid's, so
// tools and tests built on OBSERVE work on Twist.
declare const process: { env: Record<string, string | undefined> };

export type Diagnostic = {
  code: string;
  kind?: string;
  severity: "error" | "warn" | "info";
  message: string;
  ownerPath?: string[];
  sequence: number;
  [k: string]: unknown;
};
type Listener = (event: Diagnostic, subject?: unknown) => void;

const listeners = new Set<Listener>();
const captures = new Set<Diagnostic[]>();
let sequence = 0;

/** Owners an observer living inside the app marked: excluded (true) or included back (false); the nearest decides. */
const marked = new WeakMap<object, boolean>();
let anyMarked = false;
const suppressed = new WeakSet<Diagnostic>();
const subjects = new WeakMap<Diagnostic, any>();

/** The owner a subject is or belongs to (a signal: the owner it was made under). */
const ownerOf = (subject: any) => (subject && ("parent" in subject || "owned" in subject) ? subject : (subject?.owner ?? subject?._owner ?? null));
/** What a finding with no subject given is about: the owner running now (set by the reactive core). */
let ambient: () => unknown = () => null;
export const setAmbientSubject = (fn: () => unknown) => void (ambient = fn);

/** Whether an observer has excluded anything at all (the engine's cheap pre-check). */
export const anyExcluded = () => anyMarked;
/** Whether a finding was suppressed (made under an excluded owner). */
export const isSuppressed = (entry: object) => suppressed.has(entry as Diagnostic);
export function isExcluded(subject: any): boolean {
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
  const path: string[] = [];
  for (let o = ownerOf(subject); o; o = o.parent) {
    // (A label given the way a component owner gets one, `_name`, counts too.)
    const name = o.name ?? (Object.hasOwn(o, "_name") ? o._name : undefined);
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

/** The footer added to each code's first console report (a pointer to more guidance), and the codes that had it. */
let consoleFooter: ((event: Diagnostic) => string | undefined) | undefined;
const footered = new Set<string>();
/** Sets the console footer (undefined: none, and every code may have it again). */
export function setConsoleFooter(footer: ((event: Diagnostic) => string | undefined) | undefined) {
  consoleFooter = footer;
  footered.clear();
}
/** The footer for this code's first report, once. */
function takeFooter(entry: Diagnostic): string | undefined {
  if (!consoleFooter || footered.has(entry.code)) return undefined;
  footered.add(entry.code);
  return consoleFooter(entry);
}

/** A finding on the structured channel (listeners, captures); returned, for the console step. */
export function emitDiagnostic(event: Omit<Diagnostic, "sequence">, subject: unknown = ambient()): Diagnostic {
  const entry = { sequence: ++sequence, ...event } as Diagnostic;
  if (isExcluded(subject)) {
    suppressed.add(entry);
    return entry;
  }
  if (entry.ownerPath === undefined) {
    const path = ownerPath(subject);
    if (path) entry.ownerPath = path;
  }
  if (subject != null) subjects.set(entry, subject);
  for (const l of listeners) l(entry, subject ?? undefined);
  for (const c of captures) c.push(entry);
  // (An error thrown rather than reported: its footer follows it on the console, a microtask later.)
  if (entry.severity === "error" && consoleFooter && !footered.has(entry.code))
    queueMicrotask(() => {
      const footer = takeFooter(entry);
      if (footer) console.warn(footer);
    });
  return entry;
}

/** A finding on the console: its message and where (\`in A › B\`); errors as errors, the rest as warnings. */
export function reportDiagnostic(entry: Diagnostic) {
  if (suppressed.has(entry)) return;
  let text = entry.message;
  if (entry.ownerPath) text += `\n  in ${entry.ownerPath.join(" › ")}`;
  const footer = takeFooter(entry);
  if (footer) text += `\n${footer}`;
  const element = subjects.get(entry)?._devElement;
  const args = element !== undefined ? [text, element] : [text];
  entry.severity === "error" ? console.error(...args) : console.warn(...args);
}

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

const diagnostics = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  emit(event: Omit<Diagnostic, "sequence">, subject: unknown = null) {
    return emitDiagnostic(event, subject);
  },
  capture() {
    const events: Diagnostic[] = [];
    captures.add(events);
    return {
      get events() {
        return events;
      },
      clear() {
        events.length = 0;
      },
      stop() {
        captures.delete(events);
        return [...events];
      },
    };
  },
};

/** Typed records (one channel per page, shared through a global as Solid's). */
const RECORDS = /* @__PURE__ */ Symbol.for("@solidjs/signals/observe/records");
function records() {
  const g = globalThis as any;
  if (g[RECORDS]) return g[RECORDS];
  const byType = new Map<string, Function[]>();
  const wantBodies = new Map<string, Set<Function>>();
  return (g[RECORDS] = {
    subscribe(type: string, listener: Function, options?: { bodies?: boolean }) {
      const now = byType.get(type);
      if (!now || !now.includes(listener)) {
        byType.set(type, now ? [...now, listener] : [listener]);
        if (options?.bodies) {
          let set = wantBodies.get(type);
          if (!set) wantBodies.set(type, (set = new Set()));
          set.add(listener);
        }
      }
      return () => {
        const list = byType.get(type);
        if (!list || !list.includes(listener)) return;
        const next = list.filter((l) => l !== listener);
        next.length ? byType.set(type, next) : byType.delete(type);
        const set = wantBodies.get(type);
        if (set && set.delete(listener) && !set.size) wantBodies.delete(type);
      };
    },
    observed(type: string, facet?: string) {
      return facet === "bodies" ? wantBodies.has(type) : byType.has(type);
    },
    emit(type: string, event: unknown, live?: unknown) {
      for (const l of byType.get(type) ?? []) {
        try {
          l(event, live);
        } catch (e) {
          console.error(e);
        }
      }
    },
  });
}

/** Attribution: an engine may be installed (attribution/); without one, the wrappers just run what they are given. */
import { attrHooks } from "./attribution/attribution-hooks.ts";
/** Where a server render takes the route a router declares (the render running now's), if one listens. */
let routeDeclarer: (() => ((ref: unknown) => void) | undefined) | null = null;
export const setRouteDeclarer = (fn: typeof routeDeclarer) => void (routeDeclarer = fn);

const attributionSlot = {
  get installed() {
    return attrHooks;
  },
  withInteraction<T>(ref: unknown, fn: () => T): T {
    const h = attrHooks as any;
    if (!h) return fn();
    h.interactionStart(ref);
    let returned: any;
    try {
      return (returned = fn());
    } finally {
      h.interactionEnd(returned);
    }
  },
  withOrigin<T>(ref: unknown, fn: () => T): T {
    const h = attrHooks as any;
    if (!h) {
      // (On a server: a router's first declaration names the render it runs in.)
      const r = ref as { kind?: string; initial?: boolean } | null;
      if (r?.kind === "navigation" && r.initial) routeDeclarer?.()?.(r);
      return fn();
    }
    h.originStart(ref);
    try {
      return fn();
    } finally {
      h.originEnd();
    }
  },
  currentOrigin() {
    return attrHooks?.currentOrigin();
  },
};

/** Solid's observe surface (none in production, as Solid's). */
export const OBSERVE = process.env.NODE_ENV === "production" ? undefined : {
  diagnostics,
  records: records(),
  attribution: attributionSlot,
  server: {},
  exclude(owner: object) {
    marked.set(owner, true);
    anyMarked = true;
  },
  include(owner: object) {
    marked.set(owner, false);
  },
  isExcluded,
  ownerPath,
};
