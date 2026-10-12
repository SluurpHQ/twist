// Vitest's API on Bun's test runner, as far as Solid's tests use it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect as bunExpect, it, jest, mock, spyOn, test } from "bun:test";

export { afterAll, afterEach, beforeAll, beforeEach, describe, it, test };
// (`.rejects`/`.resolves` await, as Vitest's: Bun's drain the microtasks inside the matcher, so a rejection the test
// handles on its next line counts as unhandled there.)
const settledFirst = (actual: any, kind: "rejects" | "resolves", negate = false): any =>
  new Proxy(
    {},
    {
      get(_, name) {
        if (name === "then") return undefined;
        if (name === "not") return settledFirst(actual, kind, !negate);
        return async (...args: any[]) => {
          let ok = true;
          let value: any;
          try {
            value = await (typeof actual === "function" ? actual() : actual);
          } catch (error) {
            ok = false;
            value = error;
          }
          let e: any;
          if (ok !== (kind === "resolves")) e = (bunExpect(ok ? Promise.resolve(value) : Promise.reject(value)) as any)[kind];
          else e = bunExpect(/^toThrow/.test(String(name)) ? () => { throw value; } : value);
          return (negate ? e.not : e)[name](...args);
        };
      },
    },
  );
export const expect: typeof bunExpect = new Proxy(bunExpect, {
  apply(target, self, args) {
    const e = Reflect.apply(target, self, args);
    return new Proxy(e, {
      get(t, key) {
        if (key === "rejects" || key === "resolves") return settledFirst(args[0], key);
        const v = Reflect.get(t, key, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  },
});
// expect.soft: as expect (the first failure ends the test).
(expect as any).soft ??= expect;
export const vi = {
  // As Vitest's: the callback tried until it does not throw (or its promise does not reject), then its value.
  async waitFor<T>(callback: () => T | Promise<T>, options?: number | { timeout?: number; interval?: number }): Promise<T> {
    const timeout = typeof options === "number" ? options : (options?.timeout ?? 1000);
    const interval = typeof options === "number" ? 50 : (options?.interval ?? 50);
    const end = Date.now() + timeout;
    for (;;) {
      try {
        return await callback();
      } catch (e) {
        if (Date.now() >= end) throw e;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
  },
  // (Vitest's `mock.instances` holds each call's `this`; Bun's only for `new`: its `contexts` are that.)
  fn(impl?: (...a: any[]) => any) {
    const m: any = mock(function (this: any, ...a: any[]) {
      if (!new.target) m.mock.instances.push(this);
      return impl?.apply(this, a);
    });
    return m;
  },
  // (An accessor, as Vitest's: a mock in place of its getter or setter, the original until mocked.)
  spyOn(target: any, prop: PropertyKey, access?: "get" | "set") {
    if (!access) return spyOn(target, prop as any);
    let owner = target;
    let d: PropertyDescriptor | undefined;
    while (owner && !(d = Object.getOwnPropertyDescriptor(owner, prop))) owner = Object.getPrototypeOf(owner);
    const original = d?.[access];
    const m = mock(function (this: any, ...a: any[]) {
      return original?.apply(this, a);
    });
    const own = Object.getOwnPropertyDescriptor(target, prop);
    Object.defineProperty(target, prop, { configurable: true, enumerable: d?.enumerable ?? true, get: d?.get, set: d?.set, [access]: m });
    accessors.push(() => (own ? Object.defineProperty(target, prop, own) : delete target[prop]));
    return m;
  },
  // (setImmediate faked too, as Vitest's default: Bun's fake timers leave it real.)
  useFakeTimers(config?: { toFake?: string[] }) {
    // (As Vitest's: with \`toFake\`, only what it names is faked — performance.now stays real unless it is named.)
    // (Bun fakes the clock natively — performance.now, hrtime — but not Date.now: the real one is read through it.)
    const base = performance.now();
    const baseDate = Date.now();
    const realNow = config?.toFake && !config.toFake.includes("performance") ? () => base + (Date.now() - baseDate) : null;
    jest.useFakeTimers();
    if (realNow) {
      nowBefore ??= Object.getOwnPropertyDescriptor(performance, "now")!;
      Object.defineProperty(performance, "now", { value: realNow, configurable: true, writable: true });
    }
    if (!realImmediate) {
      realImmediate = [globalThis.setImmediate, globalThis.clearImmediate];
      (globalThis as any).setImmediate = (fn: (...a: any[]) => void, ...a: any[]) => setTimeout(fn, 0, ...a);
      (globalThis as any).clearImmediate = (t: any) => clearTimeout(t);
    }
  },
  useRealTimers() {
    jest.useRealTimers();
    if (nowBefore) Object.defineProperty(performance, "now", nowBefore), (nowBefore = null);
    if (realImmediate) [globalThis.setImmediate, globalThis.clearImmediate] = realImmediate as any, (realImmediate = null);
  },
  advanceTimersByTime: (ms: number) => jest.advanceTimersByTime(ms),
  runAllTimers: () => jest.runAllTimers(),
  clearAllMocks: () => jest.clearAllMocks(),
  restoreAllMocks() {
    jest.restoreAllMocks();
    while (accessors.length) accessors.pop()!();
  },
  // As Vitest's: a millisecond at a time, the promise work each timer releases run before the next.
  // (And, as Vitest's, a turn of the real event loop after each: a macrotask the code took before the clock was faked
  // runs too.)
  async advanceTimersByTimeAsync(ms: number) {
    await settle();
    for (let i = 0; i < ms; i++) jest.advanceTimersByTime(1), await settle(), await realTurn();
  },
  runAllTimersAsync: async () => (jest.runAllTimers(), await Promise.resolve()),
  // A global replaced until unstubAllGlobals() puts each back as it was (absent ones removed).
  stubGlobal(name: string, value: unknown) {
    if (!stubbed.has(name)) stubbed.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
    return vi;
  },
  unstubAllGlobals() {
    for (const [name, d] of stubbed) d ? Object.defineProperty(globalThis, name, d) : delete (globalThis as any)[name];
    stubbed.clear();
    return vi;
  },
};
const accessors: (() => void)[] = [];
let realImmediate: [typeof setImmediate, typeof clearImmediate] | null = null;
let nowBefore: PropertyDescriptor | null = null;
const loadImmediate = globalThis.setImmediate;
const realTurn = () => new Promise<void>((ok) => loadImmediate(() => ok()));
const stubbed = new Map<string, PropertyDescriptor | undefined>();
/** The promise work queued now, and what it queues, run. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
