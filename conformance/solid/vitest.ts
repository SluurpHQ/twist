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
};
