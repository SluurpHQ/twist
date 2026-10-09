// Before React's tests: a DOM (happy-dom), the globals they expect, and their imports pointed at @sluurp/dom and
// the shims (scheduler, internal-test-utils).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { join } from "node:path";

import "./gates.ts";

GlobalRegistrator.register({ url: "http://localhost/" });
// React's tests run in jsdom, where an element turned into a string is "[object HTMLDivElement]" (happy-dom prints
// its markup).
// jsdom focuses only focusable elements (happy-dom any): focus() on a plain <div> does nothing there.
{
  const focus = HTMLElement.prototype.focus;
  const focusable = (el: Element) => {
    if (el.hasAttribute("tabindex") || (el as any).isContentEditable || el.getAttribute("contenteditable") != null) return true;
    switch (el.localName) {
      case "a":
      case "area":
        return el.hasAttribute("href");
      case "input":
        return !(el as HTMLInputElement).disabled && (el as HTMLInputElement).type !== "hidden";
      case "select":
      case "textarea":
      case "button":
        return !(el as HTMLButtonElement).disabled && !el.closest("fieldset[disabled]");
      case "iframe":
        return true;
      case "summary":
        return el.parentElement?.localName === "details";
    }
    return false;
  };
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (focusable(this)) return focus.call(this, options);
  };
}
// jsdom's style keeps no priority ("display: none", not "display: none !important"), as React's tests expect.
{
  const proto: any = (globalThis as any).CSSStyleDeclaration?.prototype;
  const set = proto?.setProperty;
  if (set) proto.setProperty = function (name: string, value: string) {
    return set.call(this, name, value);
  };
}
for (const proto of [globalThis.Element?.prototype, globalThis.Node?.prototype]) {
  if (proto) Object.defineProperty(proto, "toString", { value: function (this: any) { return `[object ${this.constructor?.name ?? "Object"}]`; }, configurable: true, writable: true });
}

// jsdom runs a page's inline scripts (the streamed HTML's) with vm.runInContext, which Bun refuses for jsdom's window
// ("Proxy is not allowed in the global prototype chain"): run them against that window with `with` instead.
{
  const vm: any = await import("node:vm");
  const target = vm.default ?? vm;
  const run = target.runInContext;
  target.runInContext = (code: string, context: any, options?: any) => {
    // jsdom's global proxy: Bun's differs from the window jsdom set up (its events then refuse the window), so the
    // window itself, as Node gives for a DONT_CONTEXTIFY context.
    if (code === "this") return context;
    try {
      return run.call(target, code, context, options);
    } catch (e: any) {
      if (!/Proxy is not allowed in the global prototype chain/.test(String(e?.message))) throw e;
      return new Function("__window", `with (__window) {\n${code}\n}`)(context);
    }
  };
}

const g = globalThis as any;
g.__realSetTimeout = setTimeout;
// Some tests put their own jsdom in place (global.window = …): these must be writable, as they are under Jest.
for (const k of ["window", "document", "navigator", "location", "self"]) {
  const v = g[k];
  try {
    Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true, enumerable: true });
  } catch {}
}
// Modules stay loaded between tests (Bun has no registry reset); each test still gets its own container and root.
const bunJest: any = (await import("bun:test")).jest;
// Jest's expect takes a function for .rejects/.resolves and calls it; Bun's wants the promise.
const bunExpect: any = (await import("bun:test")).expect;
/** An inline snapshot as Jest stores it: its first and last line dropped, its common indent removed. */
const dedent = (snap: string) => {
  const lines = String(snap ?? "").replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
};
const isDomNode = (v: any) => v != null && typeof v === "object" && typeof v.nodeType === "number" && typeof v.nodeName === "string";
const expectLikeJest: any = (value: any, ...rest: any[]) => {
  // A DOM node against an inline snapshot: compared as Jest's DOM printer writes it.
  if (isDomNode(value)) {
    const m = bunExpect(value, ...rest);
    return new Proxy(m, {
      get: (t, k) => (k === "toMatchInlineSnapshot" ? (snap: string) => bunExpect(g.__printDomNode(value, "")).toBe(dedent(snap)) : Reflect.get(t, k)),
    });
  }
  const m = bunExpect(value, ...rest);
  if (typeof value !== "function") return m;
  return new Proxy(m, {
    get: (t, k) => (k === "rejects" || k === "resolves" ? bunExpect((async () => value())(), ...rest)[k] : Reflect.get(t, k)),
  });
};
for (const k of Object.getOwnPropertyNames(bunExpect)) if (!(k in Function.prototype)) expectLikeJest[k] = bunExpect[k];
g.expect = expectLikeJest;

// React's tests load React afresh for each test, so a warning given once is given again: our dedupe reset likewise.
const { resetWarnings } = await import("../src/warnings.ts");
(await import("bun:test")).beforeEach(() => resetWarnings());
// And a fresh Scheduler log and console record per test, as React's runner has.
{
  const { resetLog } = await import("./shim/scheduler.ts");
  const { resetConsole } = await import("./shim/test-utils.ts");
  (await import("bun:test")).beforeEach(() => (resetLog(), resetConsole()));
}
// React's jest config fakes timers in every test (fakeTimers.enableGlobally); react-redux's vitest does not.
if (!process.argv.some((a) => a.includes("redux-tests"))) {
  const t = await import("bun:test");
  t.beforeEach(() => t.jest.useFakeTimers());
  t.afterEach(() => t.jest.useRealTimers());
}

// @testing-library/jest-dom's matchers, which react-redux's tests use (toBeInTheDocument…).
{
  const matchers = await import("@testing-library/jest-dom/matchers");
  (await import("bun:test")).expect.extend(matchers as any);
}

// vitest's globals as react-redux's tests use them: `vi` with its helpers, it.for / test.for.
{
  const t: any = await import("bun:test");
  const { vi, forCases } = await import("./shim/vitest.ts");
  // Bun gives each test file its own `vi` binding: the helpers go onto that object.
  for (const k of ["stubEnv", "unstubAllEnvs"]) t.vi[k] ??= vi[k];
  for (const fn of [t.it, t.test]) fn.for = forCases(fn);
}

// DOM nodes in snapshots printed as Jest's DOMElement plugin prints them (Bun would walk the node's internals).
{
  const printNode = (n: any, indent: string): string => {
    if (n.nodeType === 3) return indent + n.data;
    if (n.nodeType === 8) return `${indent}<!--${n.data}-->`;
    if (n.nodeType === 11) return [...n.childNodes].map((c: any) => printNode(c, indent)).join("\n");
    const tag = n.tagName.toLowerCase();
    const attrs = [...n.attributes].map((a: any) => [a.name, a.value]).sort((a: any, b: any) => (a[0] < b[0] ? -1 : 1));
    const open = attrs.length ? `${indent}<${tag}\n${attrs.map(([k, v]: any) => `${indent}  ${k}="${v}"`).join("\n")}\n${indent}` : `${indent}<${tag}`;
    const kids = [...n.childNodes];
    if (!kids.length) return `${open}${attrs.length ? "/>" : " />"}`;
    return `${open}>\n${kids.map((c: any) => printNode(c, indent + "  ")).join("\n")}\n${indent}</${tag}>`;
  };
  g.__printDomNode = printNode;
  // expect(x).toMatchInlineSnapshot(…), as prepare.ts rewrites it.
  g.__inlineSnapshot = (value: any) => (snap?: string) =>
    isDomNode(value) ? bunExpect(printNode(value, "")).toBe(dedent(snap ?? "")) : bunExpect(value).toMatchInlineSnapshot(snap);
}

// React's toMatchRenderedOutput: a noop root (or the noop renderer) drawn as the JSX expected.
(await import("bun:test")).expect.extend({
  toMatchRenderedOutput(root: any, expected: any) {
    const actual = root.getChildrenAsJSX();
    const pass = (this as any).equals(actual, expected);
    return { pass, message: () => `expected rendered output ${JSON.stringify(actual)} to ${pass ? "not " : ""}equal ${JSON.stringify(expected)}` };
  },
});

// As React's setupTests has them, for development.
const spyOn = (obj: any, key: string) => bunJest.spyOn(obj, key);
g.spyOn = spyOn;
g.spyOnDev = spyOn;
g.spyOnDevAndProd = spyOn;
g.spyOnProd = () => {};
g.__EXTENSION__ = false;
g.__REACT_ROOT_PATH_TEST__ = import.meta.dir;
for (const j of [bunJest, g.jest].filter(Boolean)) {
  j.resetModules ??= () => {};
  j.isolateModules ??= (fn: () => void) => fn();
  j.unmock ??= () => {};
  j.dontMock ??= () => {};
}

const src = join(import.meta.dir, "..", "src");
const shim = join(import.meta.dir, "shim");
const ours: Record<string, string> = {
  react: join(src, "react.ts"),
  "react/jsx-runtime": join(src, "jsx-runtime.ts"),
  "react/jsx-dev-runtime": join(src, "jsx-runtime.ts"),
  "react-dom": join(src, "react-dom.ts"),
  "react-dom/client": join(src, "client.ts"),
  "react-dom/server": join(src, "server.ts"),
  "react-dom/server.browser": join(src, "server.ts"),
  "react-dom/server.node": join(src, "server.ts"),
  "react-dom/server.edge": join(src, "server.ts"),
  "react-dom/static": join(src, "server.ts"),
  "react-dom/test-utils": join(shim, "test-utils.ts"),
  scheduler: join(shim, "scheduler.ts"),
  "scheduler/unstable_mock": join(shim, "scheduler.ts"),
  "internal-test-utils": join(shim, "test-utils.ts"),
  "react-noop-renderer": join(shim, "noop.ts"),
  "react-reconciler/constants": join(shim, "reconciler-constants.ts"),
};

plugin({
  name: "sluurp-dom-conformance",
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|scheduler|internal-test-utils|react-noop-renderer|react-reconciler)(\/.*)?$/ }, (a) => {
      const to = ours[a.path];
      return to ? { path: to } : undefined;
    });
  },
});
