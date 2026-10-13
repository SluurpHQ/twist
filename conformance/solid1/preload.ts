// Solid 1's tests in a DOM (happy-dom, as jsdom runs them), with Vitest's globals.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const platform = ["Request", "Response", "Headers", "fetch", "ReadableStream", "AbortController", "AbortSignal", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"].map((k) => [k, (globalThis as any)[k]]);
GlobalRegistrator.register({ url: "http://localhost/" });
for (const [k, v] of platform) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
delete (globalThis as any).reportError;
(globalThis as any).__DEV__ = true;
import { expect, vi } from "../solid/vitest.ts";
import * as bunTest from "bun:test";
(globalThis as any).vi = vi;
(globalThis as any).expect = expect;
for (const [k, f] of Object.entries(vi)) if (!(k in bunTest.vi) || k === "fn" || k === "spyOn" || k === "restoreAllMocks" || k === "useFakeTimers" || k === "useRealTimers") (bunTest.vi as any)[k] = f;
for (const k of ["describe", "it", "test", "expect", "beforeAll", "beforeEach", "afterAll", "afterEach"] as const) (globalThis as any)[k] ??= bunTest[k];
import { resetErrorHalt } from "../../src/twist/signals.ts";
try {
  bunTest.afterEach(() => resetErrorHalt());
} catch {}
