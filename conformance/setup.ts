// Before React's tests: a DOM (happy-dom), the globals they expect, and their imports pointed at @sluurp/dom and
// the shims (scheduler, internal-test-utils).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { isAbsolute, join } from "node:path";
import "./gates.ts";

// jsdom loads no frames (React's tests render <iframe src="https://…">), and has `nonce` on every element.
// (Inline scripts run, as under Jest's jsdom, which runs them dangerously.)
GlobalRegistrator.register({ url: "http://localhost/", settings: { disableIframePageLoading: true, enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
// happy-dom tells the console a frame or script it did not load; jsdom says nothing.
{
  const { default: Context } = await import("happy-dom/lib/window/WindowBrowserContext.js" as any);
  const page: any = new Context(window).getBrowserPage();
  if (page?.console) {
    const real = page.console;
    page.console = new Proxy(real, {
      get: (t, k) => (k === "error" ? (...a: any[]) => (/loading is disabled/.test(String(a[0]?.message ?? a[0])) ? undefined : t.error(...a)) : Reflect.get(t, k)),
    });
  }
}
// An image button adds name.x and name.y when it submits, and nothing otherwise (happy-dom adds its name and value).
{
  const Native = globalThis.FormData;
  globalThis.FormData = class FormData extends Native {
    constructor(form?: any, submitter?: any) {
      super(form, submitter);
      if (!form?.elements) return;
      for (const el of Array.from(form.elements) as any[]) {
        if (el.localName !== "input" || el.type !== "image" || !el.name) continue;
        // (Only the image's own entry: others of the same name stay.)
        const entries = [...this.entries()];
        const at = entries.findIndex(([k, v]) => k === el.name && v === (el.value ?? ""));
        if (at >= 0) {
          entries.splice(at, 1);
          for (const k of new Set(entries.map(([k]) => k).concat(el.name))) this.delete(k);
          for (const [k, v] of entries) this.append(k, v as any);
        }
        if (el === submitter) this.append(el.name + ".x", "0"), this.append(el.name + ".y", "0");
      }
    }
  } as any;
}
// jsdom reflects defaultValue and defaultChecked into their attributes internally; happy-dom calls the element's own
// setAttribute, which React's tests spy on.
{
  const proto: any = HTMLInputElement.prototype;
  const set = Element.prototype.setAttribute;
  const remove = Element.prototype.removeAttribute;
  Object.defineProperty(proto, "defaultValue", {
    configurable: true,
    get(this: Element) {
      return this.attributes.getNamedItem("value")?.value ?? "";
    },
    set(this: any, v: string) {
      set.call(this, "value", String(v));
    },
  });
  Object.defineProperty(proto, "defaultChecked", {
    configurable: true,
    get(this: Element) {
      return this.attributes.getNamedItem("checked") !== null;
    },
    set(this: any, v: boolean) {
      v ? set.call(this, "checked", "") : remove.call(this, "checked");
    },
  });
  const type = Object.getOwnPropertyDescriptor(proto, "type")!;
  Object.defineProperty(proto, "type", {
    configurable: true,
    get: type.get,
    set(this: any, v: string) {
      set.call(this, "type", String(v));
    },
  });
}
// A textarea's defaultValue and value are strings of what is given (happy-dom drops 0 and false).
for (const key of ["defaultValue", "value"]) {
  const proto: any = HTMLTextAreaElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, key);
  if (d?.set) Object.defineProperty(proto, key, { ...d, set(this: any, v: any) { d.set!.call(this, v === null ? "" : String(v)); } });
}
// A clone keeps a checkbox's or radio's checkedness when it was set (its dirty checked flag), as the HTML spec has it.
{
  const PS: any = await import("happy-dom/lib/PropertySymbol.js" as any);
  const proto: any = HTMLInputElement.prototype;
  const clone = proto.cloneNode;
  proto.cloneNode = function (this: any, deep?: boolean) {
    const copy = clone.call(this, deep);
    copy[PS.checked] = this[PS.checked];
    return copy;
  };
}
// The HTML parser's input preprocessing (CR and CRLF become LF) and its NULLs (U+FFFD in attribute values, dropped
// from text), which happy-dom skips.
const asParsed = (html: string) =>
  html
    .replace(/\r\n?/g, "\n")
    .replace(/="[^"]*"|='[^']*'/g, (m) => m.replace(/\0/g, "�"))
    .replace(/\0/g, "");
for (const [proto, key] of [[Element.prototype, "innerHTML"], [Element.prototype, "outerHTML"], [(globalThis as any).ShadowRoot?.prototype, "innerHTML"]] as const) {
  const d = proto && Object.getOwnPropertyDescriptor(proto, key);
  if (!d?.set) continue;
  Object.defineProperty(proto, key, {
    ...d,
    set(this: any, html: string) {
      d.set!.call(this, typeof html === "string" ? asParsed(html) : html);
    },
  });
}
// An exception thrown in an event listener reported as jsdom reports it (React's suite runs in jsdom): an `error` event
// on the window, then, unless a listener prevented it, the console's "unhandled exception" with the error as detail.
{
  const PS: any = await import("happy-dom/lib/PropertySymbol.js" as any);
  const { default: BrowserWindow }: any = await import("happy-dom/lib/window/BrowserWindow.js" as any);
  BrowserWindow.prototype[PS.dispatchError] = function (this: any, error: any) {
    const ev = new this.ErrorEvent("error", { message: error?.message, error, cancelable: true });
    if (this.dispatchEvent(ev)) console.error(Object.assign(new Error(`Uncaught [${error}]`), { type: "unhandled exception", detail: error }));
  };
}
// The old initMouseEvent, which jsdom has and happy-dom does not.
{
  const proto: any = MouseEvent.prototype;
  proto.initMouseEvent ??= function (this: any, type: string, bubbles: boolean, cancelable: boolean, view: any, detail: number, screenX: number, screenY: number, clientX: number, clientY: number, ctrlKey: boolean, altKey: boolean, shiftKey: boolean, metaKey: boolean, button: number, relatedTarget: any) {
    this.initEvent(type, bubbles, cancelable);
    const set = { view, detail, screenX, screenY, clientX, clientY, ctrlKey, altKey, shiftKey, metaKey, button, relatedTarget };
    for (const [k, v] of Object.entries(set)) Object.defineProperty(this, k, { value: v, configurable: true });
  };
  // document.createEvent("MouseEvents") makes a MouseEvent (happy-dom makes a plain Event).
  let docProto: any = document;
  while (docProto && !Object.hasOwn(docProto, "createEvent")) docProto = Object.getPrototypeOf(docProto);
  const createEvent = docProto.createEvent;
  docProto.createEvent = function (this: Document, kind: string) {
    return /^MouseEvents?$/i.test(kind) ? new MouseEvent("") : createEvent.call(this, kind);
  };
}
// Which tags are unknown elements, as browsers (and jsdom) have it: happy-dom calls some obsolete ones unknown and
// some unknown ones known.
{
  const KNOWN = new Set("font frame frameset marquee dir acronym basefont big center nobr noembed noframes plaintext rb rtc strike tt xmp listing".split(" "));
  const UNKNOWN = new Set("applet bgsound blink isindex keygen menuitem multicol nextid spacer".split(" "));
  const is = Function.prototype[Symbol.hasInstance].bind(HTMLUnknownElement);
  Object.defineProperty(HTMLUnknownElement, Symbol.hasInstance, {
    value: (el: any) => {
      const name = el?.namespaceURI === "http://www.w3.org/1999/xhtml" ? el.localName : null;
      if (name && KNOWN.has(name)) return false;
      if (name && UNKNOWN.has(name)) return true;
      return is(el);
    },
  });
}
// document.open() leaves no doctype, as in browsers (happy-dom adds one); a written <!doctype> still brings its own.
{
  let proto: any = document.implementation.createHTMLDocument("");
  while (!Object.hasOwn(proto, "open")) proto = Object.getPrototypeOf(proto);
  const open = proto.open;
  proto.open = function (this: Document, ...args: any[]) {
    const r = open.apply(this, args);
    for (const n of [...this.childNodes]) if (n.nodeType === 10) this.removeChild(n);
    return r;
  };
}
// Node's abort() with no reason gives "This operation was aborted" (Bun's says "signal is aborted without reason").
{
  const abort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (this: AbortController, reason?: any) {
    return abort.call(this, reason === undefined ? new DOMException("This operation was aborted", "AbortError") : reason);
  };
}
if (!("nonce" in HTMLElement.prototype)) {
  for (const proto of [HTMLElement.prototype, (globalThis as any).SVGElement?.prototype].filter(Boolean))
    Object.defineProperty(proto, "nonce", {
      configurable: true,
      get(this: Element) {
        return (this as any).__nonce ?? this.attributes.getNamedItem("nonce")?.value ?? "";
      },
      set(this: any, v: string) {
        this.__nonce = String(v);
        Element.prototype.setAttribute.call(this, "nonce", String(v));
      },
    });
}
// jsdom reflects `autofocus` on every HTML element.
if (!("autofocus" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "autofocus", {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute("autofocus");
    },
    set(this: Element, v: boolean) {
      v ? this.setAttribute("autofocus", "") : this.removeAttribute("autofocus");
    },
  });
}
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
g.__realSetImmediate = setImmediate;
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
    // Jest compares DOM nodes with isEqualNode (Bun would walk all their properties, fibers included).
    const equalNode = (other: any) => bunExpect(isDomNode(other) ? value === other || value.isEqualNode(other) : false).toBe(true);
    return new Proxy(m, {
      get: (t, k) =>
        k === "toMatchInlineSnapshot" ? (snap: string) => bunExpect(g.__printDomNode(value, "")).toBe(dedent(snap)) : k === "toEqual" || k === "toStrictEqual" ? equalNode : Reflect.get(t, k),
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
  const { resetAct } = await import("../src/core.ts");
  const { resetStreams } = await import("../src/server.ts");
  // (A test's fresh copy of React listens on the document again: jest.resetModules gives it new markers.)
  const { forgetDocuments } = await import("../src/events.ts");
  (await import("bun:test")).beforeEach(() => (resetLog(), resetConsole(), resetAct(), resetStreams(), forgetDocuments()));
}
// React's jest config fakes timers in every test (fakeTimers.enableGlobally); react-redux's vitest does not.
if (!process.argv.some((a) => a.includes("redux-tests"))) {
  const t = await import("bun:test");
  // In a file run in Jest's node environment, setImmediate is faked with the rest (the jsdom environment keeps its
  // own real one): React's server starts its work in one, and those tests run it with jest.runAllTimers().
  const file = process.argv.find((a) => /-test\.js$/.test(a));
  let nodeEnv = false;
  try {
    nodeEnv = !!file && /@jest-environment node\b/.test((await Bun.file(isAbsolute(file) ? file : join(import.meta.dir, file)).text()).slice(0, 2000));
  } catch {}
  const realImmediate = globalThis.setImmediate;
  const realClear = globalThis.clearImmediate;
  // Jest fakes the timers once for the file, so a file that turns them off at its top level keeps real ones.
  let inTest = false;
  let fileReal = false;
  const useReal = t.jest.useRealTimers.bind(t.jest);
  (t.jest as any).useRealTimers = (...a: any[]) => {
    if (!inTest) fileReal = true;
    return useReal(...a);
  };
  t.beforeEach(() => {
    inTest = true;
    if (fileReal) return;
    t.jest.useFakeTimers();
    if (nodeEnv) {
      (globalThis as any).setImmediate = (fn: (...a: any[]) => void, ...args: any[]) => setTimeout(fn, 0, ...args);
      (globalThis as any).clearImmediate = (id: any) => clearTimeout(id);
    }
  });
  t.afterEach(() => {
    useReal();
    inTest = false;
    (globalThis as any).setImmediate = realImmediate;
    (globalThis as any).clearImmediate = realClear;
  });
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
  // Plain values as Jest's pretty-format prints them (escapeString and printBasicPrototype off, as React's config):
  // Bun's printer puts a multi-line string in an array on a line of its own.
  const plain = (v: any): boolean =>
    v === null || ["string", "number", "boolean", "undefined"].includes(typeof v) || (Array.isArray(v) && v.every(plain)) || (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(plain));
  const printPlain = (v: any, indent: string): string => {
    if (typeof v === "string") return `"${v}"`;
    if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => `${indent}  ${printPlain(x, indent + "  ")},`).join("\n")}\n${indent}]` : "[]";
    if (v && typeof v === "object") {
      const keys = Object.keys(v).sort();
      return keys.length ? `{\n${keys.map((k) => `${indent}  "${k}": ${printPlain(v[k], indent + "  ")},`).join("\n")}\n${indent}}` : "{}";
    }
    return String(v);
  };
  g.__inlineSnapshot = (value: any) => (snap?: string) =>
    isDomNode(value)
      ? bunExpect(printNode(value, "")).toBe(dedent(snap ?? ""))
      : Array.isArray(value) && value.some((x) => typeof x === "string" && x.includes("\n")) && plain(value)
        ? bunExpect(printPlain(value, "")).toBe(dedent(snap ?? ""))
        : bunExpect(value).toMatchInlineSnapshot(snap);
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
  // A getter or setter spied on (spyOn(obj, key, "get")), which Bun's spyOn does not do: the accessor replaced by a
  // mock function calling the original, put back by mockRestore.
  const spy = j.spyOn;
  if (spy && !spy.__accessors) {
    j.spyOn = Object.assign(
      (obj: any, key: string, access?: "get" | "set") => {
        if (access !== "get" && access !== "set") return spy.call(j, obj, key);
        let owner = obj;
        while (owner && !Object.getOwnPropertyDescriptor(owner, key)) owner = Object.getPrototypeOf(owner);
        const d = Object.getOwnPropertyDescriptor(owner ?? obj, key) ?? { configurable: true };
        const fn = bunJest.fn(d[access] ? function (this: any, ...a: any[]) { return d[access]!.apply(this, a); } : undefined);
        Object.defineProperty(obj, key, { configurable: true, enumerable: d.enumerable, get: d.get, set: d.set, [access]: fn });
        const mockRestore = () => {
          if (owner === obj) Object.defineProperty(obj, key, d);
          else delete obj[key];
        };
        // (Bun's mock functions are read-only: mockRestore given through a proxy.)
        return new Proxy(fn, { get: (t, k) => (k === "mockRestore" ? mockRestore : Reflect.get(t, k)) });
      },
      { __accessors: true },
    );
  }
  // The module itself, past a mock of it (our copy for React's packages).
  j.requireActual ??= (id: string) => require(ours[id] ?? id);
  // An automock (no factory) of one of React's internal modules: none of ours uses them, so nothing to do.
  const mock = j.mock;
  if (mock && !j.mock.__automock) {
    j.mock = Object.assign((id: string, factory?: () => any, options?: any) => (factory ? mock.call(j, id, factory, options) : undefined), { __automock: true });
  }
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
  "react-dom/server.browser": join(src, "server.browser.ts"),
  "react-dom/server.node": join(src, "server.ts"),
  "react-dom/server.edge": join(src, "server.browser.ts"),
  "react-dom/static": join(src, "server.ts"),
  "react-dom/static.browser": join(src, "server.ts"),
  "react-dom/static.edge": join(src, "server.ts"),
  "react-dom/test-utils": join(shim, "test-utils.ts"),
  scheduler: join(shim, "scheduler.ts"),
  "scheduler/unstable_mock": join(shim, "scheduler.ts"),
  "internal-test-utils": join(shim, "test-utils.ts"),
  "react-noop-renderer": join(shim, "noop.ts"),
  "react-reconciler/constants": join(shim, "reconciler-constants.ts"),
};

// (A package that is not installed is not resolved through the plugin: given as a module.)
(await import("bun:test")).mock.module("web-streams-polyfill/ponyfill/es6", () => ({ ReadableStream, WritableStream, TransformStream }));
(await import("bun:test")).mock.module("dom-event-testing-library", () => require(join(import.meta.dir, "react-tests", "dom-event-testing-library", "index.js")));
(await import("bun:test")).mock.module("react-dom-bindings/src/client/ReactDOMSelection", () => require(join(src, "dom-selection.ts")));
(await import("bun:test")).mock.module("react-dom-bindings/src/client/HTMLNodeType", () => ({ ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_TYPE_NODE: 10, DOCUMENT_FRAGMENT_NODE: 11 }));

plugin({
  name: "sluurp-dom-conformance",
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|scheduler|internal-test-utils|react-noop-renderer|react-reconciler|web-streams-polyfill)(\/.*)?$/ }, (a) => {
      const to = ours[a.path];
      return to ? { path: to } : undefined;
    });
  },
});

// A file in Jest's node environment has no DOM: `window`, by which libraries tell (canUseDOM), taken away again. The
// rest stays: our renderer draws even a noop root into DOM nodes.
{
  const file = process.argv.find((a) => /-test(\.internal)?\.js$/.test(a));
  let nodeEnv = false;
  try {
    nodeEnv = !!file && /@jest-environment node\b/.test((await Bun.file(isAbsolute(file) ? file : join(import.meta.dir, file)).text()).slice(0, 2000));
  } catch {}
  if (nodeEnv) delete (globalThis as any).window;
}
