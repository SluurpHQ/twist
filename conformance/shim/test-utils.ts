// React's internal-test-utils, for a runtime that renders synchronously on microtasks: `act` and the waits drain
// everything pending (updates, effects after paint, settled promises), then the log is checked as React's tests do.
import { flushSync } from "../../src/core.ts";
import { unstable_clearLog } from "./scheduler.ts";

const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

/** Until nothing more happens: a few turns of microtasks and tasks, with updates flushed between. */
async function drain() {
  for (let i = 0; i < 6; i++) {
    flushSync();
    await Promise.resolve();
    await macrotask();
  }
  flushSync();
}

export async function act<T>(fn: () => T | Promise<T>): Promise<T> {
  const out = await fn();
  await drain();
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
export const waitForPaint = waitForAll;
export const waitForDiscrete = waitForAll;
export async function waitFor(expected: unknown[]) {
  await drain();
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
