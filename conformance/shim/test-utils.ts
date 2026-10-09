// React's internal-test-utils, for a runtime that renders synchronously on microtasks: `act` and the waits drain
// everything pending (updates, effects after paint, settled promises), then the log is checked as React's tests do.
import { flushPassiveEffects, flushScheduled, flushSync, flushTransitions, onUncaught, performWork, setTransitionScheduler, setWorkScheduler } from "../../src/core.ts";

// Transitions wait for the test to flush them (act and waitForAll do; waitForPaint stops before them), as with
// React's mock scheduler.
setTransitionScheduler(() => {});
// A concurrent render waits for the test too: act and the waits run it, waitFor only until its log is there.
setWorkScheduler(() => {});
import { logLength, unstable_clearLog } from "./scheduler.ts";

/**
 * Until nothing more happens: updates and effects flushed, between turns of microtasks (promises settling). No
 * timers: tests fake them (Bun fakes even ones kept earlier), and React's act does not wait on them either.
 */
async function drain(transitions = true) {
  for (let i = 0; i < 30; i++) {
    flushSync();
    flushPassiveEffects();
    if (transitions) flushTransitions();
    await Promise.resolve();
  }
  flushSync();
  flushPassiveEffects();
}

/** Runs `fn` and everything it sets off; an error no boundary caught is thrown from here, as React's act does. */
export async function act<T>(fn: () => T | Promise<T>): Promise<T> {
  const errors: unknown[] = [];
  const off = onUncaught((e) => errors.push(e));
  let out: T;
  try {
    out = await fn();
    await drain();
  } finally {
    off();
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors);
  return out;
}
export const serverAct = act;

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
  await drain(false);
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
  try {
    await drain();
  } catch (e: any) {
    if (expected == null || e === expected || e?.message === expected || (expected as any)?.message === e?.message) return e;
    throw e;
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
    seen[kind]!.push(args.map(String).join(" "));
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

export async function simulateEventDispatch(node: Node, type: string) {
  node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  await drain();
}
export const getDebugInfo = () => null;
