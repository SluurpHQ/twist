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
  useFakeTimers: () => jest.useFakeTimers(),
  useRealTimers: () => jest.useRealTimers(),
  advanceTimersByTime: (ms: number) => jest.advanceTimersByTime(ms),
  runAllTimers: () => jest.runAllTimers(),
  clearAllMocks: () => jest.clearAllMocks(),
  restoreAllMocks() {
    jest.restoreAllMocks();
    while (accessors.length) accessors.pop()!();
  },
  // As Vitest's: a millisecond at a time, the promise work each timer releases run before the next.
  async advanceTimersByTimeAsync(ms: number) {
    await settle();
    for (let i = 0; i < ms; i++) jest.advanceTimersByTime(1), await settle();
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
const stubbed = new Map<string, PropertyDescriptor | undefined>();
/** The promise work queued now, and what it queues, run. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
