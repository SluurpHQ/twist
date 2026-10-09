// What react-redux's tests take from vitest, on bun:test: the same functions, and `vi` as Bun's jest object with
// the few vitest-only helpers they use.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest, test } from "bun:test";

const stubbed = new Map<string, string | undefined>();
export const vi: any = Object.assign(Object.create(jest), {
  fn: jest.fn,
  spyOn: jest.spyOn,
  mock: jest.mock ?? (() => {}),
  clearAllMocks: jest.clearAllMocks ?? (() => {}),
  restoreAllMocks: jest.restoreAllMocks ?? (() => {}),
  useFakeTimers: jest.useFakeTimers,
  useRealTimers: jest.useRealTimers,
  stubEnv(name: string, value: string) {
    if (!stubbed.has(name)) stubbed.set(name, process.env[name]);
    process.env[name] = value;
  },
  unstubAllEnvs() {
    for (const [k, v] of stubbed) v === undefined ? delete process.env[k] : (process.env[k] = v);
    stubbed.clear();
  },
});

export { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test };
