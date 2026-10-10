// Vitest's API on Bun's test runner, as far as Solid's tests use it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest, mock, spyOn, test } from "bun:test";

export { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test };
export const vi = {
  fn: (impl?: (...a: any[]) => any) => mock(impl ?? (() => {})),
  spyOn,
  useFakeTimers: () => jest.useFakeTimers(),
  useRealTimers: () => jest.useRealTimers(),
  advanceTimersByTime: (ms: number) => jest.advanceTimersByTime(ms),
  runAllTimers: () => jest.runAllTimers(),
  clearAllMocks: () => jest.clearAllMocks(),
  restoreAllMocks: () => jest.restoreAllMocks(),
  // Microtasks and timers run on: what a test awaits runs.
  advanceTimersByTimeAsync: async (ms: number) => (jest.advanceTimersByTime(ms), await Promise.resolve()),
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
const stubbed = new Map<string, PropertyDescriptor | undefined>();
