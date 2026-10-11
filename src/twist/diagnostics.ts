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

/** The owner a subject is or belongs to. */
const ownerOf = (subject: any) => (subject && ("parent" in subject || "owned" in subject) ? subject : (subject?.owner ?? null));

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
    const name = o.name;
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

/** A finding on the structured channel (listeners, captures); returned, for the console step. */
export function emitDiagnostic(event: Omit<Diagnostic, "sequence">, subject: unknown = null): Diagnostic {
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
  return entry;
}

/** A finding on the console: its message and where (\`in A › B\`); errors as errors, the rest as warnings. */
export function reportDiagnostic(entry: Diagnostic) {
  if (suppressed.has(entry)) return;
  let text = entry.message;
  if (entry.ownerPath) text += `\n  in ${entry.ownerPath.join(" › ")}`;
  const element = subjects.get(entry)?._devElement;
  const args = element !== undefined ? [text, element] : [text];
  entry.severity === "error" ? console.error(...args) : console.warn(...args);
}

/** Emitted and reported: the common case. */
export const diagnose = (event: Omit<Diagnostic, "sequence">, subject: unknown = null) => {
  const entry = emitDiagnostic(event, subject);
  if (entry.severity !== "info") reportDiagnostic(entry);
  return entry;
};

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

/** Attribution: an engine may be installed; without one, the wrappers just run what they are given. */
let attribution: any = null;
export const setAttributionHooks = (hooks: any) => void (attribution = hooks);
const attributionSlot = {
  get installed() {
    return attribution;
  },
  withInteraction<T>(ref: unknown, fn: () => T): T {
    const h = attribution;
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
    const h = attribution;
    if (!h) return fn();
    h.originStart(ref);
    try {
      return fn();
    } finally {
      h.originEnd();
    }
  },
  currentOrigin() {
    return attribution?.currentOrigin();
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
