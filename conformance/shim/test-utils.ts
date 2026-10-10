// React's internal-test-utils, for a runtime that renders synchronously on microtasks: `act` and the waits drain
// everything pending (updates, effects after paint, settled promises), then the log is checked as React's tests do.
import { commits, flushPassiveEffects,flushScheduled, flushSync, flushTransitions, onUncaught, performWork, setTransitionScheduler, setWorkScheduler, somethingPending } from "../../src/core.ts";

// Transitions wait for the test to flush them (act and waitForAll do; waitForPaint stops before them), as with
// React's mock scheduler.
setTransitionScheduler(() => {});
// A concurrent render waits for the test too: act and the waits run it, waitFor only until its log is there.
setWorkScheduler(() => {});
import { logLength, unstable_clearLog } from "./scheduler.ts";
import { jest as bunJest } from "bun:test";
import { streamsStarting } from "../../src/server.ts";

/**
 * Until nothing more happens: updates and effects flushed, between turns of microtasks (promises settling). No
 * timers: tests fake them (Bun fakes even ones kept earlier), and React's act does not wait on them either.
 */
/** What is scheduled drawn, as the scheduler would (not as flushSync: a transition stays one). */
const flushAll = () => (flushScheduled(), performWork());

async function drain(transitions = true) {
  // At least a few turns (promises settling), then on while work is left (effects updating, as React's act flushes).
  for (let i = 0; i < 30 || (somethingPending() && i < 1000); i++) {
    flushAll();
    flushPassiveEffects();
    if (transitions) flushTransitions();
    await Promise.resolve();
  }
  flushAll();
  flushPassiveEffects();
}

/** One real turn of the event loop (setImmediate may be faked in the test). */
const realTurn = () => new Promise<void>((r) => ((globalThis as any).__realSetImmediate ?? setImmediate)(r));

/** Runs `fn` and everything it sets off; an error no boundary caught is thrown from here, as React's act does. */
export async function act<T>(fn: () => T | Promise<T>): Promise<T> {
  const errors: unknown[] = [];
  const off = onUncaught((e) => errors.push(e));
  let out: T;
  try {
    out = await fn();
    await drain();
    // As React's act: once nothing else is left, the pending (fake) timers run, and again while they set off more.
    for (let i = 0; i < 20; i++) {
      let count = 0;
      try {
        count = (bunJest as any).getTimerCount?.() ?? 0;
      } catch {}
      if (!(count > 0)) break;
      (bunJest as any).runAllTicks?.();
      (bunJest as any).runOnlyPendingTimers();
      await drain();
    }
    // A server render starts on setImmediate: faked in a node-environment file (act runs it), else one real turn.
    for (let i = 0; i < 10 && streamsStarting(); i++) {
      if ((bunJest as any).getTimerCount?.() > 0) (bunJest as any).runOnlyPendingTimers();
      // A real turn either way: what the render wrote reaches a Node stream's listeners on the next tick.
      await realTurn();
      await drain();
    }
  } finally {
    off();
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors);
  return out;
}
/** React's serverAct: the scope run after a tick, then pending (fake) timers run until none are left, as the
 * server's work is scheduled on setImmediate. */
export function serverAct<T>(fn: () => T | Promise<T>): Promise<T> {
  // (A rejection the test awaits later is not an unhandled one, as under Jest.)
  const result = serverActNow(fn);
  result.catch(() => {});
  return result;
}
async function serverActNow<T>(fn: () => T | Promise<T>): Promise<T> {
  const j: any = bunJest;
  const timers = async () => {
    for (let i = 0; i < 100; i++) {
      // A real turn too (the server's start, where setImmediate is not faked).
      await realTurn();
      await Promise.resolve();
      // (Without fake timers there are none to run.)
      let count = 0;
      try {
        count = j?.getTimerCount?.() ?? 0;
      } catch {}
      if (!(count > 0)) break;
      j.runOnlyPendingTimers();
    }
  };
  await Promise.resolve();
  const p: any = fn();
  if (p && typeof p.catch === "function") p.catch(() => {});
  await timers();
  const out = await p;
  await timers();
  return out;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function assertLog(expected: unknown[]) {
  const actual = unstable_clearLog();
  if (!same(actual, expected)) throw new Error(`Expected log ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export async function waitForAll(expected: unknown[]) {
  await drain();
  assertLog(expected);
}
/** What React draws before it yields to paint: the urgent updates and their effects, not transitions. */
export async function waitForPaint(expected: unknown[]) {
  // Nothing urgent to paint: the next task runs, whatever its lane (React's scheduler goes on until a paint).
  const before = commits();
  await drain(false);
  for (let i = 0; i < 100 && commits() === before && flushTransitions(); i++) await drain(false);
  assertLog(expected);
}
export const waitForDiscrete = waitForAll;
export async function waitFor(expected: unknown[]) {
  // What is scheduled started, then the work loop run until what is expected has been logged (React's waitFor
  // stops the scheduler there); without a concurrent render, everything pending.
  flushScheduled();
  if (!performWork(() => logLength() >= expected.length)) await drain();
  const actual = unstable_clearLog();
  if (!same(actual.slice(0, expected.length), expected)) throw new Error(`Expected log to start ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
export async function waitForMicrotasks() {
  await Promise.resolve();
}
export async function waitForThrow(expected: unknown) {
  // An error no boundary caught comes out of the work loop, as React's Scheduler.flush throws it.
  const uncaught: unknown[] = [];
  const off = onUncaught((e) => uncaught.push(e));
  try {
    await drain();
    if (uncaught.length) throw uncaught[0];
  } catch (e: any) {
    if (expected == null || e === expected || e?.message === expected || (expected as any)?.message === e?.message) return e;
    throw e;
  } finally {
    off();
  }
  throw new Error("Expected something to throw");
}
export const unstable_waitForExpired = waitForAll;

// Console assertions: what was printed since the last check, compared exactly. React's development warnings are
// React's own texts; a runtime that does not print them fails these on purpose.
const seen: Record<string, string[]> = { error: [], warn: [], log: [] };
for (const kind of ["error", "warn", "log"] as const) {
  const original = console[kind].bind(console);
  console[kind] = (...args: any[]) => {
    // jsdom's own note about CSS it cannot parse (React's jsdom does not print it): not React's output.
    if (kind === "error" && String(args[0]).includes("Could not parse CSS stylesheet")) return;
    // What React's console mock leaves out (its shouldIgnoreConsoleError): an error logged with an addendum, as
    // the default onCaughtError/onUncaughtError log it.
    if (kind === "error" && typeof args[0] === "string") {
      const rest = args[0].startsWith("%c%s") ? args.slice(4) : args.slice(1);
      const first = rest[0];
      if (
        first != null &&
        ((typeof first === "object" && typeof first.message === "string" && typeof first.stack === "string" && !args[0].includes("Failed to serialize an action")) ||
          (typeof first === "string" && first.indexOf("An error occurred in ") === 0))
      ) {
        original(...args);
        return;
      }
    }
    // A format string's %s filled with the arguments after it, as the console prints it.
    if (typeof args[0] === "string" && args.length > 1 && args[0].includes("%s")) {
      let i = 1;
      const text = args[0].replace(/%s/g, () => (i < args.length ? String(args[i++]) : "%s"));
      seen[kind]!.push([text, ...args.slice(i).map(String)].join(" "));
    } else seen[kind]!.push(args.map(String).join(" "));
    if (kind !== "log") original(...args);
  };
}
/** Each test starts with nothing printed, as React's runner checks every test's console on its own (setup.ts). */
export function resetConsole() {
  for (const kind of ["error", "warn", "log"]) seen[kind]!.length = 0;
}
function consoleAssertion(kind: "error" | "warn" | "log") {
  return (expected: unknown[]) => {
    const actual = seen[kind]!.splice(0);
    const want = expected.map((e) => (Array.isArray(e) ? e[0] : e)) as string[];
    const ok = actual.length === want.length && actual.every((a, i) => a.includes(String(want[i]).split("\n")[0]!.replace(/%s/g, "")));
    if (!ok) throw new Error(`Expected console.${kind} ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  };
}
export const assertConsoleErrorDev = consoleAssertion("error");
export const assertConsoleWarnDev = consoleAssertion("warn");
export const assertConsoleLogDev = consoleAssertion("log");

/**
 * An event dispatched as a browser dispatches a real one (React's simulateBrowserEventDispatch): each listener along
 * the path in turn, and the microtasks queued run after each, as they do between a browser's own listener calls.
 */
export async function simulateEventDispatch(node: Node, type: string) {
  for (let n: Node | null = node; n !== document; n = n.parentNode) if (!n) return;
  const PS: any = await import("happy-dom/lib/PropertySymbol.js" as any);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: node });
  const path: any[] = [];
  for (let n: any = node; n; n = n.parentNode) path.push(n);
  path.push(window);
  let stopped = false, stoppedNow = false;
  const stop = event.stopPropagation.bind(event), stopNow = event.stopImmediatePropagation.bind(event);
  event.stopPropagation = () => ((stopped = true), stop());
  event.stopImmediatePropagation = () => ((stopped = stoppedNow = true), stopNow());
  const run = async (at: any, phase: "capturing" | "bubbling", eventPhase: number) => {
    const listeners: any[] = at[PS.listeners]?.[phase]?.get(type)?.slice() ?? [];
    for (const listener of listeners) {
      Object.defineProperty(event, "currentTarget", { value: at, configurable: true });
      Object.defineProperty(event, "eventPhase", { value: eventPhase, configurable: true });
      const was = (window as any).event;
      (window as any).event = event;
      try {
        listener.handleEvent ? listener.handleEvent.call(listener, event) : listener.call(at, event);
      } catch (e) {
        (window as any)[PS.dispatchError]?.(e);
      } finally {
        (window as any).event = was;
      }
      if (stoppedNow) return;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
  };
  for (const at of [...path].reverse()) {
    if (stopped) break;
    await run(at, "capturing", at === node ? 2 : 1);
  }
  for (const at of path) {
    if (stopped) break;
    await run(at, "bubbling", at === node ? 2 : 3);
  }
  await drain();
}
export const getDebugInfo = () => null;
