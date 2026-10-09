// What react-redux's tests take from vitest, on bun:test: the same functions, and `vi` as Bun's jest object with
// the few vitest-only helpers they use.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it as bunIt, jest, test as bunTest } from "bun:test";

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

/** vitest's it.for / test.for: one test per case, the case passed as the argument. */
const withFor = (t: any) => {
  const f: any = (...a: any[]) => t(...a);
  Object.assign(f, t);
  f.for = (cases: any[]) => (name: string, fn: (c: any) => any) =>
    cases.forEach((c, i) => t(name.replace(/%[sdiojO]|\$\w+/, () => (typeof c === "object" ? JSON.stringify(c) : String(c))) + (name.includes("%") ? "" : ` [${i}]`), () => fn(c)));
  return f;
};
const it = withFor(bunIt);
const test = withFor(bunTest);

export { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test };
