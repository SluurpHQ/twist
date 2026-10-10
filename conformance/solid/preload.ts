// What Solid's tests import, redirected to Twist: the public API to ours, vitest to Bun's runner, the DOM from
// happy-dom. A test file reaching into Solid's internals (src/core/…, attribution, dev, server) cannot run against
// another implementation: its import fails and run.ts counts the file as not ours.
import { plugin } from "bun";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The platform's fetch family stays (jsdom brings none: Solid's tests use Node's Request, Response, Headers, fetch).
const platform = ["Request", "Response", "Headers", "fetch", "FormData", "Blob", "File", "ReadableStream", "AbortController", "AbortSignal"].map((k) => [k, (globalThis as any)[k]]);
// As jsdom runs Solid's tests: a page URL, and nothing fetched (no CSS, scripts or frames loaded).
GlobalRegistrator.register({ url: "http://localhost/", settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true, handleDisabledFileLoadingAsSuccess: true } as any });
for (const [k, v] of platform) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
// Solid's tests run in jsdom, which has no reportError (Bun and happy-dom do): an uncaught error's cause is logged.
delete (globalThis as any).reportError;
// Vitest's globals, as Solid's tests use them without importing.
import { vi } from "./vitest.ts";
(globalThis as any).vi = vi;
// And on Bun's own vi, which a test file may be given instead.
import { vi as bunVi } from "bun:test";
for (const [k, f] of Object.entries(vi)) if (!(k in bunVi)) (bunVi as any)[k] = f;
const src = join(import.meta.dir, "..", "..", "src");
const solid = join(src, "twist", "index.ts");

plugin({
  name: "twist",
  setup(b) {
    // The package by name (../src/index.js is a file prepare.ts writes).
    b.onResolve({ filter: /^(solid-js|@solidjs\/signals)$/ }, () => ({ path: solid }));
    b.onResolve({ filter: /^vitest$/ }, () => ({ path: join(import.meta.dir, "vitest.ts") }));
  },
});

// A halt (an uncaught effect error) ends with its test: it does not leak into the next one.
import { afterEach as eachDone } from "bun:test";
import { resetErrorHalt } from "../../src/twist/signals.ts";
// (Only under the test runner: this file also preloads plain bun runs.)
try {
  eachDone(() => resetErrorHalt());
} catch {}
