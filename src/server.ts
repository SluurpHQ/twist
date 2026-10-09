// Rendering to HTML, on the server or anywhere without a DOM: the same elements and components, hooks answering
// with their first values. Suspense shows its fallback in renderToString; the streams wait for what it waits on.
import { ACTIVITY, CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, SUSPENSE, createElement, invalidType, objectChild, readThenable, unwrapChild } from "./element.ts";
import { client } from "./core.ts";
import { withHooks } from "./hooks.ts";
import { validateProps, validateStyle } from "./validate-props.ts";
import { fieldString } from "./coercion.ts";
import { dev } from "./warnings.ts";
import { styleText } from "./props.ts";
import { assertValidProps, attribute, checkTagName, customAttribute, isCustomElement } from "./attributes.ts";
import { Resources } from "./float-server.ts";
import { type TreeContext, ROOT_TREE, makeId, pushTree } from "./tree-id.ts";
import { warn, warnOnce } from "./warnings.ts";
import { __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as Internals } from "./react-dom.ts";

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "innerHTML"]);

/** Why the server gave a boundary to the client, in its template as React writes it: the digest onError gave, and
 * in development the message (the client reports it). */
const RENDER_TO_STRING_SUSPENSE = 'The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "renderToPipeableStream" which supports Suspense on the server';
const errored = (e: any) => "Switched to client rendering because the server rendering errored:\n\n" + (e?.message ?? String(e));
const aborted = (reason: string) => "Switched to client rendering because the server rendering aborted due to:\n\n" + reason;
function errorTemplate(digest: unknown, message: string, error?: unknown, at?: string) {
  const dgst = typeof digest === "string" ? ` data-dgst="${escape(digest)}"` : "";
  const stack = dev() ? (at ?? (error ? componentStackOf(error) : "")) : "";
  return `<template${dgst}${dev() ? ` data-msg="${escape(message)}"` : ""}${stack ? ` data-cstck="${escape(stack)}"` : ""}></template>`;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#x27" }[c]};`);

function style(s: any) {
  if (s && typeof s === "object") for (const k in s) validateStyle(k, s[k]);
  return styleText(s);
}

type Ctx = {
  values: Map<any, any>;
  ids: number;
  waiting: Promise<any>[];
  svg: boolean;
  select: any;
  lastText: boolean;
  /** The components and elements being rendered, outermost first (React's component stack). */
  stack: string[];
  /** The component stack where the render last suspended (told when its boundary is aborted). */
  suspendedAt?: string;
  /** What a child suspended on while its siblings rendered on: thrown at the boundary around them. */
  suspended?: PromiseLike<any> | null;
  /** Where in the tree rendering is (React's tree context, which useId's ids are made of), and the ids' prefix. */
  tree: TreeContext;
  idPrefix: string;
  /** renderToStaticMarkup: markup no client will hydrate (no separators, no boundary comments). */
  static?: boolean;
  /** Float's resources and hoistables for this render (written into <head>, or before a later chunk). */
  res: Resources;
  /** The enclosing element's tag (null at the top): <html>, <head> and <body> are the document's only at the top. */
  parent: string | null;
  /** Inside a <noscript>, a <picture>, a Suspense fallback: where React renders hoistables in place or drops them. */
  noscript: boolean;
  picture: boolean;
  fallback: boolean;
  /** While streaming: ids and suspended boundaries shared by the shell and every boundary's render. */
  streaming?: { shared: { ids: number; boundaries: Boundary[]; next: number; aborted?: { reason: unknown }; chunk: number; inlined: number }; onError: (e: unknown, at?: string) => any };
};

function attrs(props: any, ctx: Ctx, tag: string) {
  let out = "";
  const put = (name: string, value: string | null) => {
    if (value != null) out += value === "" && !name.includes("-") && !name.includes(":") ? ` ${name}=""` : ` ${name}="${escape(value)}"`;
  };
  for (const k in props) {
    const v = props[k];
    if (SKIP.has(k)) continue;
    if (k[0] === "o" && k[1] === "n" && k.length > 2 && k[2] === k[2]!.toUpperCase()) continue;
    if (k === "style") {
      const css = v == null ? "" : style(v);
      if (css) put("style", css);
      continue;
    }
    if (k === "defaultValue") {
      if (tag === "input" && props.value == null && v != null) put("value", fieldString(v));
      continue;
    }
    if (k === "defaultChecked") {
      if (v && props.checked == null) put("checked", "");
      continue;
    }
    if (k === "value") {
      if (tag !== "textarea" && tag !== "select" && v != null && typeof v !== "function" && typeof v !== "symbol") put("value", fieldString(v));
      continue;
    }
    if (k === "checked" || k === "selected" || k === "muted") {
      if (v && typeof v !== "function" && typeof v !== "symbol") put(k, "");
      continue;
    }
    if (k === "autoFocus") continue;
    if ((k === "action" || k === "formAction") && typeof v === "function") continue;
    const a = isCustomElement(tag, props) ? customAttribute(tag, k, v) : attribute(tag, k, v, ctx.svg);
    if (a) put(a[0], a[1]);
  }
  return out;
}

const NOOP = () => {};
const effectEventOnServer = () => {
  throw new Error("A function wrapped in useEffectEvent can't be called during rendering.");
};

/** browser(): what use() throws on the server, so its boundary is rendered by the client (once per value). */
const RECOVERABLE = Symbol.for("react.recoverable");
const browserErrors = new WeakMap<object, Error>();
function browserOnly(u: any): never {
  throw browserError(u);
}
/** The error a browser() value stands for: "Browser-only rendering was requested", its reason as the cause. */
function browserError(u: any): Error {
  let reason: unknown = u._reason;
  if (typeof reason === "function") {
    try {
      reason = reason();
    } catch {
      reason = "The reason for browser-only rendering could not be determined because its initializer threw.";
    }
  }
  const error: any = new Error("Browser-only rendering was requested by `browser()`.", u._reason === undefined ? undefined : { cause: reason });
  Object.defineProperty(error, RECOVERABLE, { value: true });
  browserErrors.set(u, error);
  return error;
}
/** A browser() bail-out with no Suspense to give to the client: the shell fails with it (React's fatal clone). */
function fatalBrowserError(e: any): Error {
  const fatal: any = new Error(
    "The server render could not complete because client rendering was requested outside a Suspense boundary. See this error's cause for additional details.",
    Object.prototype.hasOwnProperty.call(e, "cause") ? { cause: e.cause } : undefined,
  );
  if (typeof e.stack === "string") fatal.stack = "Error: " + fatal.message + e.stack.slice(e.stack.indexOf("\n") < 0 ? e.stack.length : e.stack.indexOf("\n"));
  return fatal;
}
const isBrowserOnly = (e: any) => !!e && typeof e === "object" && e[RECOVERABLE] === true;

// ---------------------------------------------------------------- hooks while rendering a component on the server

/** The function component rendering now: its hooks, kept across its re-renders (state set while it renders). */
type ServerComponent = { hooks: any[]; at: number; again: boolean; ids: number; pass: number };
let rendering: ServerComponent | null = null;

const INVALID_HOOK =
  "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.";

/** Inside a hook's own code (an initializer, a reducer, a memo): hooks called there are warned about (React's
 * isInHookUserCodeInDev), and still counted as hooks. */
let inHookCode = false;
function inHook<T>(fn: () => T): T {
  const was = inHookCode;
  inHookCode = true;
  try {
    return fn();
  } finally {
    inHookCode = was;
  }
}
function slot<T>(make: () => T): T {
  const c = rendering;
  if (!c) throw new Error(INVALID_HOOK);
  if (inHookCode) warn("Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. You can only call Hooks at the top level of your React function. For more information, see https://react.dev/link/rules-of-hooks");
  const i = c.at++;
  if (i >= c.hooks.length) {
    // A pass again (its own update) with more hooks than the first: React's error.
    if (c.pass > 0) throw new Error("Rendered more hooks than during the previous render");
    // Its place taken first: a hook its initializer calls comes after it, as React numbers them.
    c.hooks.push(undefined);
    c.hooks[i] = inHook(make);
  }
  return c.hooks[i];
}

const basicState = (s: any, a: any) => (typeof a === "function" ? a(s) : a);

/** useState and useReducer: updates made while rendering are applied on the next pass, with the reducer of that pass. */
function reducerHook(reducer: any, arg: any, init: any, isState: boolean) {
  const c = rendering;
  const h = slot(() => {
    const box: any = { value: isState ? (typeof arg === "function" ? arg() : arg) : init ? init(arg) : arg, queue: [] };
    box.dispatch = (action: any) => {
      // Only while its component renders (the server renders once): a pass more, with this update.
      if (rendering === c) {
        box.queue.push(action);
        c!.again = true;
      }
    };
    return box;
  });
  for (const a of h.queue.splice(0)) h.value = inHook(() => reducer(h.value, a));
  return [h.value, h.dispatch];
}

function memoHook(fn: () => any, deps?: any[]) {
  const h = slot(() => ({ deps: undefined as any, value: undefined as any, set: false }));
  if (!h.set || !deps || !h.deps || deps.length !== h.deps.length || deps.some((d: any, i: number) => !Object.is(d, h.deps[i]))) {
    h.value = inHook(fn);
    h.deps = deps;
    h.set = true;
  }
  return h.value;
}

/** A function component rendered on the server: again while it set its own state, as React's server does. */
/** Whether the function component rendered last called useId (its children are then a fork of its own). */
let lastUsedId = false;
/** A function component's output rendered: under a fork of its tree position when it called useId (React's). */
function renderOutput(out: any, ctx: Ctx, hooks: any) {
  if (!lastUsedId) return render(out, ctx, hooks);
  lastUsedId = false;
  const tree = ctx.tree;
  ctx.tree = pushTree(tree, 1, 0);
  try {
    return render(out, ctx, hooks);
  } finally {
    ctx.tree = tree;
  }
}
/** A context's value where the render is (its provider's, or its default). */
const contextValue = (ctx: Ctx, c: any) => (ctx.values.has(c) ? ctx.values.get(c) : c._defaultValue);

function renderFunction(type: any, props: any) {
  const c: ServerComponent = { hooks: [], at: 0, again: false, ids: 0, pass: 0 };
  const was = rendering;
  rendering = c;
  try {
    for (let pass = 0; ; pass++) {
      if (pass >= 25) throw new Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
      c.at = 0;
      c.pass = pass;
      c.again = false;
      c.ids = 0;
      const out = type(props);
      if (!c.again) return (lastUsedId = c.ids > 0), out;
    }
  } finally {
    rendering = was;
  }
}

function serverHooks(ctx: Ctx) {
  const read = (c: any) => (ctx.values.has(c) ? ctx.values.get(c) : c._defaultValue);
  return {
    ...client,
    useState: (init: any) => reducerHook(basicState, init, undefined, true),
    useReducer: (r: any, a: any, i?: any) => reducerHook(r, a, i, false),
    useRef: (v: any) => slot(() => ({ current: v })),
    useMemo: (fn: any, deps?: any[]) => memoHook(fn, deps),
    useCallback: (fn: any, deps?: any[]) => memoHook(() => fn, deps),
    useEffect: NOOP,
    useLayoutEffect: NOOP,
    useInsertionEffect: NOOP,
    useImperativeHandle: NOOP,
    readContext: (c: any) => {
      if (inHookCode)
        warn("Context can only be read while React is rendering. In classes, you can read it in the render method or getDerivedStateFromProps. In function components, you can read it directly in the function body, but not inside Hooks like useReducer() or useMemo().");
      return read(c);
    },
    // A hook: only inside a function component (a class render calling it is an invalid hook call).
    useContext: (c: any) => {
      if (!rendering) throw new Error(INVALID_HOOK);
      if (inHookCode) warn("Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. You can only call Hooks at the top level of your React function. For more information, see https://react.dev/link/rules-of-hooks");
      return read(c);
    },
    // From where it is in the tree (React's), so the client hydrating finds the same id.
    useId: () => makeId(ctx.idPrefix, "R", ctx.tree, rendering ? rendering.ids++ : 0),
    useSyncExternalStore: (_s: any, get: any, getServer?: any) => (getServer ?? get)(),
    useTransition: () => [false, (fn: any) => fn()],
    useDeferredValue: (v: any, initial?: any) => (initial !== undefined ? initial : v),
    useActionState: (_a: any, init: any) => [init, NOOP, false],
    useOptimistic: (s: any) => [s, NOOP],
    // On the server an effect event is never called: calling it is an error, as React's.
    useEffectEvent: () => effectEventOnServer,
    use: (u: any) => (u && u.$$typeof === CONTEXT ? read(u) : u && u.$$typeof === RECOVERABLE ? browserOnly(u) : readThenable(u)),
  } as any;
}

function render(node: any, ctx: Ctx, hooks: any): string {
  const name = node && typeof node === "object" && node.$$typeof === ELEMENT ? frameName(node.type) : "";
  if (name) ctx.stack.push(name);
  try {
    return renderFrame(node, ctx, hooks);
  } catch (e) {
    if (e && typeof e === "object" && typeof (e as any).then !== "function" && !stacks.has(e)) stacks.set(e, stackText(ctx.stack));
    else if (e && typeof (e as any).then === "function" && ctx.suspendedAt === undefined) ctx.suspendedAt = stackText(ctx.stack);
    throw e;
  } finally {
    if (name) ctx.stack.pop();
  }
}

/**
 * A child that suspends does not stop its siblings: they render on (React renders past a suspended child, and
 * meets their resources), and the boundary around them suspends once they have.
 */
function renderSibling(node: any, ctx: Ctx, hooks: any): string {
  try {
    return render(node, ctx, hooks);
  } catch (e: any) {
    if (!e || typeof e.then !== "function") throw e;
    ctx.suspended ??= e;
    ctx.lastText = false;
    return "";
  }
}
/** What `fn` renders, or what a child of it suspended on, thrown once it is done. */
function suspendAfter(ctx: Ctx, fn: () => string): string {
  const outer = ctx.suspended;
  ctx.suspended = null;
  try {
    const out = fn();
    if (ctx.suspended) throw ctx.suspended;
    return out;
  } finally {
    ctx.suspended = outer;
  }
}

function renderFrame(node: any, ctx: Ctx, hooks: any): string {
  // A lazy or a promise as a child: what it resolves to (thrown to the nearest Suspense until then).
  node = unwrapChild(node);
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") {
    const text = String(node);
    // Nothing for an empty string; between two texts a comment, so the browser keeps them two nodes (as React's).
    if (text === "") return "";
    // (Static markup is never hydrated: no separators.)
    const sep = ctx.lastText && !ctx.static ? "<!-- -->" : "";
    ctx.lastText = true;
    return sep + escape(text);
  }
  if (Array.isArray(node)) {
    const tree = ctx.tree;
    try {
      return node.map((n, i) => ((ctx.tree = pushTree(tree, node.length, i)), renderSibling(n, ctx, hooks))).join("");
    } finally {
      ctx.tree = tree;
    }
  }
  if (typeof node === "object" && typeof node[Symbol.iterator] === "function" && !node.$$typeof) {
    const it = node[Symbol.iterator]();
    if (it === node)
      warnOnce(
        "Using Iterators as children is unsupported and will likely yield unexpected results because enumerating a generator mutates it. You may convert it to an array with `Array.from()` or the `[...spread]` operator before rendering. You can also use an Iterable that can iterate multiple times over the same items.",
      );
    else if (node.entries === node[Symbol.iterator]) warnOnce("Using Maps as children is not supported. Use an array of keyed ReactElements instead.");
    const items: any[] = [];
    for (let r = it.next(); !r.done; r = it.next()) items.push(r.value);
    return render(items, ctx, hooks);
  }
  // A context as a child: its value where it is rendered.
  if (node.$$typeof === CONTEXT) return render(ctx.values.has(node) ? ctx.values.get(node) : node._defaultValue, ctx, hooks);
  if (node.$$typeof === PORTAL) return "";
  if (node.$$typeof !== ELEMENT) throw objectChild(node);
  const { type, props } = node;
  if (typeof type === "string") return host(type, props, ctx, hooks);
  if (typeof type === "symbol") {
    if (type === SUSPENSE) {
      // Between markers, so the client finds the boundary: complete ($), pending ($?), or left to the client ($!).
      const queued = ctx.streaming?.shared.boundaries.length ?? 0;
      // Its own stylesheets and style rules: its parent's if it completes here, its own if it waits.
      const parentDeps = ctx.res.boundary;
      const deps = { sheets: new Set<any>(), styles: new Set<any>() };
      ctx.res.boundary = deps;
      ctx.lastText = false;
      const abortedNow = () => {
        const why = ctx.streaming!.shared.aborted!.reason;
        const at = stackText(ctx.stack);
        const digest = ctx.streaming!.onError(why, at);
        ctx.res.boundary = parentDeps;
        ctx.streaming!.shared.boundaries.length = queued;
        const fallback = fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
        ctx.lastText = false;
        return `<!--$!-->${errorTemplate(digest, aborted((why as any)?.message ?? String(why)), undefined, at)}${fallback}<!--/$-->`;
      };
      if (ctx.streaming?.shared.aborted) return abortedNow();
      try {
        const out = suspendAfter(ctx, () => render(props.children, ctx, hooks));
        if (ctx.streaming?.shared.aborted) return abortedNow();
        ctx.lastText = false;
        const stream = ctx.streaming;
        if (stream && !ctx.static) {
          // Large (past React's progressiveChunkSize with what was written in place before it): sent after the shell,
          // its fallback in its place meanwhile, as React outlines it.
          const size = utf8Bytes(out);
          if (size > 500 && stream.shared.inlined + size > stream.shared.chunk && !/<(html|head|body)[\s>]/.test(out)) {
            const id = stream.shared.next++;
            const b: Boundary = { tree: ctx.tree, id, children: props.children, values: new Map(ctx.values), svg: ctx.svg, select: ctx.select, waiting: Promise.resolve(), stack: ctx.stack.slice(), deps, wrap: segmentWrap(ctx), done: out };
            stream.shared.boundaries.push(b);
            ctx.res.boundary = parentDeps;
            b.fallback = fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
            ctx.lastText = false;
            return pendingMarkup(b);
          }
          stream.shared.inlined += size;
        }
        if (parentDeps) {
          for (const k of ["sheets", "styles"] as const) for (const x of deps[k]) parentDeps[k].add(x);
          if ((deps as any).emitted) ((parentDeps as any).emitted ??= []).push(...(deps as any).emitted);
        }
        return ctx.static ? out : `<!--$-->${out}<!--/$-->`;
      } catch (e: any) {
        // Aborted meanwhile: whatever it threw, it is an aborted boundary.
        if (ctx.streaming?.shared.aborted) return abortedNow();
        ctx.res.boundary = parentDeps;
        ctx.lastText = false;
        // Boundaries met inside it were never written: they go with this render.
        if (ctx.streaming) ctx.streaming.shared.boundaries.length = queued;
        const stream = ctx.streaming;
        if (e && typeof e.then === "function") {
          if (stream) {
            const id = stream.shared.next++;
            const b: Boundary = { tree: ctx.tree, id, children: props.children, values: new Map(ctx.values), svg: ctx.svg, select: ctx.select, waiting: e, stack: ctx.stack.slice(), deps, wrap: segmentWrap(ctx), suspendedAt: ctx.suspendedAt };
            ctx.suspendedAt = undefined;
            stream.shared.boundaries.push(b);
            b.fallback = fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
            ctx.lastText = false;
            return pendingMarkup(b);
          }
          ctx.waiting.push(e);
          if (ctx.static) return fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
          return `<!--$!-->${errorTemplate(undefined, aborted(RENDER_TO_STRING_SUSPENSE))}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
        }
        if (!stream) throw e;
        // An error inside a boundary: its fallback now, the client renders it again (React's behaviour).
        const digest = stream.onError(e);
        return `<!--$!-->${errorTemplate(digest, errored(e), e)}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
      } finally {
        ctx.res.boundary = parentDeps;
      }
    }
    // Activity: a visible one between its markers (React's); a hidden one is left to the client.
    if (type === ACTIVITY) {
      if (props.mode === "hidden") return "";
      ctx.lastText = false;
      const inner = render(props.children, ctx, hooks);
      ctx.lastText = false;
      return ctx.static ? inner : `<!--&-->${inner}<!--/&-->`;
    }
    return render(props.children, ctx, hooks);
  }
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      const ct = type.contextType;
      const validCt = ct != null && ct.$$typeof === CONTEXT;
      if (dev() && ct !== undefined && !validCt && ct !== null)
        warn(
          `${type.displayName || type.name || "Component"} defines an invalid contextType. contextType should point to the Context object returned by React.createContext(). ${ct?.$$typeof === CONSUMER ? "Did you accidentally pass the Context.Consumer instead?" : typeof ct !== "object" ? `However, it is set to a ${typeof ct}.` : `However, it is set to an object with keys {${Object.keys(ct).join(", ")}}.`}`,
        );
      // No context type: an empty context object, as React gives.
      const c = validCt ? contextValue(ctx, ct) : {};
      const inst = new type(props, c);
      inst.props = props;
      inst.context = c;
      if (type.getDerivedStateFromProps) inst.state = { ...inst.state, ...type.getDerivedStateFromProps(props, inst.state) };
      // As React's server does: componentWillMount runs (without getDerivedStateFromProps), its setState applied at once.
      else if (inst.UNSAFE_componentWillMount || inst.componentWillMount) {
        inst.setState = (s: any, cb?: () => void) => {
          inst.state = { ...inst.state, ...(typeof s === "function" ? s(inst.state, inst.props) : s) };
          cb?.();
        };
        // forceUpdate while mounting: nothing to do (it renders right after).
        inst.forceUpdate = (cb?: () => void) => cb?.();
        (inst.UNSAFE_componentWillMount ?? inst.componentWillMount).call(inst);
      }
      const out = inst.render();
      // Rendered once on the server: an update asked later does nothing (React says so).
      const name = type.displayName || type.name || "Component";
      const noop = (what: string) => () =>
        warn(`Can only update a mounting component. This usually means you called ${what}() outside componentWillMount() on the server. This is a no-op.\n\nPlease check the code for the ${name} component.`);
      inst.setState = noop("setState");
      inst.forceUpdate = noop("forceUpdate");
      return render(out, ctx, hooks);
    }
    // A class with a render method that is not a Component: React warns, and calls it as a function.
    if (dev() && type.prototype && typeof type.prototype.render === "function")
      warn(
        `The <${type.displayName || type.name || "Component"} /> component appears to have a render method, but doesn't extend React.Component. This is likely to cause errors. Change ${type.displayName || type.name || "Component"} to extend React.Component instead.`,
      );
    return renderOutput(renderFunction(type, props), ctx, hooks);
  }
  if (type == null) throw invalidType(type);
  switch (type.$$typeof) {
    case CONTEXT: {
      const had = ctx.values.has(type);
      const was = ctx.values.get(type);
      ctx.values.set(type, props.value);
      try {
        return render(props.children, ctx, hooks);
      } finally {
        if (had) ctx.values.set(type, was);
        else ctx.values.delete(type);
      }
    }
    case CONSUMER:
      return render(props.children(contextValue(ctx, type._context)), ctx, hooks);
    case FORWARD_REF: {
      const { ref, ...rest } = props;
      return renderOutput(renderFunction(() => type.render(rest, ref ?? null), props), ctx, hooks);
    }
    case MEMO:
      return render(createElement(type.type, props), ctx, hooks);
    case LAZY: {
      const p = type._payload;
      if (p.status === 1) return render(createElement(p.value, props), ctx, hooks);
      if (p.status === -1) {
        p.status = 0;
        p.promise = p.load().then((m: any) => ((p.status = 1), (p.value = m.default ?? m)), (e: any) => ((p.status = 2), (p.value = e)));
      }
      if (p.status === 2) throw p.value;
      throw p.promise;
    }
  }
  if (type === FRAGMENT) return render(props.children, ctx, hooks);
  throw invalidType(type);
}

function host(tag: string, props: any, ctx: Ctx, hooks: any): string {
  checkTagName(tag);
  if (!ctx.svg && !tag.includes("-") && tag.toLowerCase() !== tag)
    warn(`<${tag} /> is using incorrect casing. Use PascalCase for React components, or lowercase for HTML elements.`);
  assertValidProps(tag, props);
  validateProps(tag, props, false);
  const hoisted = hoist(tag, props, ctx);
  if (hoisted !== undefined) return hoisted;
  const svg = ctx.svg;
  if (tag === "svg") ctx.svg = true;
  // A whole document: React writes its doctype first.
  ctx.lastText = false;
  let open = `${tag === "html" && ctx.streaming ? "<!DOCTYPE html>" : ""}<${tag}${attrs(props, ctx, tag)}`;
  if (tag === "option") {
    const chosen = ctx.select;
    const v = props.value ?? (typeof props.children === "string" ? props.children : undefined);
    if (chosen !== undefined && (Array.isArray(chosen) ? chosen.map(String).includes(String(v)) : String(chosen) === String(v))) open += " selected";
  }
  // A void element closes itself, as React writes it.
  if (VOID.has(tag) && tag !== "menuitem") {
    ctx.svg = svg;
    return open + "/>";
  }
  open += ">";
  let inner: string;
  if (props.dangerouslySetInnerHTML?.__html != null) inner = props.dangerouslySetInnerHTML.__html;
  else if (tag === "script" && !ctx.svg) {
    const c = props.children;
    if (c != null && typeof c !== "string")
      warn(
        `A script element was rendered with ${typeof c === "number" ? "a number for children" : Array.isArray(c) ? "an array for children" : "something unexpected for children"}. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.`,
      );
    inner = typeof c === "string" ? scriptSafe(c) : "";
  } else if (tag === "style" && !ctx.svg && (typeof props.children === "string" || typeof props.children === "number")) inner = styleSafe(String(props.children));
  else if (tag === "textarea") inner = escape(String(props.value ?? props.defaultValue ?? props.children ?? ""));
  else if (tag === "select") {
    const was = ctx.select;
    ctx.select = props.value ?? props.defaultValue;
    inner = render(props.children, ctx, hooks);
    ctx.select = was;
  } else {
    if (tag === "foreignObject") ctx.svg = false;
    const { parent, noscript, picture } = ctx;
    ctx.parent = tag;
    if (tag === "noscript") ctx.noscript = true;
    if (tag === "picture") ctx.picture = true;
    try {
      inner = render(props.children, ctx, hooks);
    } finally {
      ctx.parent = parent;
      ctx.noscript = noscript;
      ctx.picture = picture;
    }
  }
  ctx.svg = svg;
  ctx.lastText = false;
  // The document's <head> holds Float's resources (written in at the end); an <html> without one gets one.
  const top = !svg && (ctx.parent === null || ctx.parent === "html");
  if (tag === "head" && top) inner = HEAD_MARK + inner;
  if (tag === "html" && ctx.parent === null && !inner.includes(HEAD_MARK)) inner = `<head>${HEAD_MARK}</head>` + inner;
  return `${open}${inner}</${tag}>`;
}

/** React's checks on a <title>'s children: one string-like value (browsers keep a title's content as text). */
function titleChildren(props: any) {
  if (!Object.prototype.hasOwnProperty.call(props, "children")) return;
  const children = props.children;
  const child = Array.isArray(children) ? (children.length < 2 ? children[0] : null) : children;
  if (Array.isArray(children) && children.length > 1)
    warn(
      `React expects the \`children\` prop of <title> tags to be a string, number, bigint, or object with a novel \`toString\` method but found an Array with length ${children.length} instead. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert \`children\` of <title> tags to a single string value which is why Arrays of length greater than 1 are not supported. When using JSX it can be common to combine text nodes and value nodes. For example: <title>hello {nameOfUser}</title>. While not immediately apparent, \`children\` in this case is an Array with length 2. If your \`children\` prop is using this form try rewriting it using a template string: <title>{\`hello \${nameOfUser}\`}</title>.`,
    );
  else if (typeof child === "function" || typeof child === "symbol")
    warn(
      `React expect children of <title> tags to be a string, number, bigint, or object with a novel \`toString\` method but found ${typeof child === "function" ? "a Function" : "a Sybmol"} instead. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert children of <title> tags to a single string value.`,
    );
  else if (child && child.toString === {}.toString)
    warn(
      child.$$typeof != null
        ? "React expects the `children` prop of <title> tags to be a string, number, bigint, or object with a novel `toString` method but found an object that appears to be a React element which never implements a suitable `toString` method. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert children of <title> tags to a single string value which is why rendering React elements is not supported. If the `children` of <title> is a React Component try moving the <title> tag into that component. If the `children` of <title> is some HTML markup change it to be Text only to be valid HTML."
        : "React expects the `children` prop of <title> tags to be a string, number, bigint, or object with a novel `toString` method but found an object that does not implement a suitable `toString` method. Browsers treat all child Nodes of <title> tags as Text content and React expects to be able to convert children of <title> tags to a single string value. Using the default `toString` method available on every object is almost certainly an error. Consider whether the `children` of this <title> is an object in error and change it to a string or number value if so. Otherwise implement a `toString` method that React can use to produce a valid <title>.",
    );
}

/** Where Float's resources go in a rendered document. */
const HEAD_MARK = "\u0000head\u0000";
/** The shell with Float's resources in its <head>, or before it if it has none. */
function withPreamble(shell: string, resources: string) {
  const at = shell.indexOf(HEAD_MARK);
  return at < 0 ? resources + shell : shell.slice(0, at) + resources + shell.slice(at + HEAD_MARK.length);
}

/** An element written outside its place (into <head>), as React writes it: void ones self-closed. */
const writeTag = (tag: string, props: any, inner?: string) => {
  const a = attrs(props, { svg: false } as Ctx, tag);
  return VOID.has(tag) ? `<${tag}${a}/>` : `<${tag}${a}>${inner ?? ""}</${tag}>`;
};
const single = (children: any) => (Array.isArray(children) ? (children.length < 2 ? children[0] : null) : children);
const styleSafe = (css: string) => css.replace(/(<\/|<)(s)(tyle)/gi, (_m, a, b, c) => a + (b === "s" ? "\\73 " : "\\53 ") + c);

/**
 * React's Float on the server: a <title>, <meta> or <link> rendered anywhere goes to <head>; a stylesheet or
 * <style> with a precedence and an async script become shared resources; an <img> is preloaded. Returns what stays
 * in place (nothing, or a text separator), or undefined to render the element where it is.
 */
function hoist(tag: string, props: any, ctx: Ctx): string | undefined {
  const r = ctx.res;
  const inline = ctx.svg || ctx.noscript || props.itemProp != null;
  const separator = () => {
    const sep = ctx.lastText && !ctx.static ? "<!-- -->" : "";
    ctx.lastText = false;
    return sep;
  };
  switch (tag) {
    case "title": {
      titleChildren(props);
      if (inline) return undefined;
      if (!ctx.fallback) {
        const child = single(props.children);
        const text = child == null || typeof child === "function" || typeof child === "symbol" || typeof child === "boolean" ? "" : escape(String(child));
        r.hoistInto(r.hoistables, writeTag("title", { ...props, children: undefined }, props.dangerouslySetInnerHTML?.__html ?? text));
      }
      return "";
    }
    case "link": {
      const { rel, href, precedence } = props;
      if (inline || typeof rel !== "string" || typeof href !== "string" || href === "") {
        if (rel === "stylesheet" && typeof precedence === "string" && !(typeof href === "string" && href))
          warn(
            `React encountered a \`<link rel="stylesheet" .../>\` with a \`precedence\` prop and expected the \`href\` prop to be a non-empty string but ecountered ${href === null ? "\`null\`" : href === undefined ? "\`undefined\`" : href === "" ? "an empty string" : `something with type "${typeof href}"`} instead. If your intent was to have React hoist and deduplciate this stylesheet using the \`precedence\` prop ensure there is a non-empty string \`href\` prop as well, otherwise remove the \`precedence\` prop.`,
          );
        return undefined;
      }
      if (rel === "stylesheet") {
        if (typeof precedence !== "string" || props.disabled != null || props.onLoad || props.onError) {
          if (typeof precedence === "string") {
            if (props.disabled != null)
              warn(
                'React encountered a `<link rel="stylesheet" .../>` with a `precedence` prop and a `disabled` prop. The presence of the `disabled` prop indicates an intent to manage the stylesheet active state from your from your Component code and React will not hoist or deduplicate this stylesheet. If your intent was to have React hoist and deduplciate this stylesheet using the `precedence` prop remove the `disabled` prop, otherwise remove the `precedence` prop.',
              );
            else {
              const d = props.onLoad && props.onError ? "`onLoad` and `onError` props" : props.onLoad ? "`onLoad` prop" : "`onError` prop";
              warn(
                `React encountered a \`<link rel="stylesheet" .../>\` with a \`precedence\` prop and ${d}. The presence of loading and error handlers indicates an intent to manage the stylesheet loading state from your from your Component code and React will not hoist or deduplicate this stylesheet. If your intent was to have React hoist and deduplciate this stylesheet using the \`precedence\` prop remove the ${d}, otherwise remove the \`precedence\` prop.`,
              );
            }
          }
          return undefined;
        }
        r.stylesheet(props);
        return separator();
      }
      if (props.onLoad || props.onError) return undefined;
      const sep = separator();
      if (!ctx.fallback) r.hoistInto(r.hoistables, writeTag("link", props));
      return sep;
    }
    case "script": {
      const a = props.async;
      if (typeof props.src !== "string" || !props.src || !a || typeof a === "function" || typeof a === "symbol" || props.onLoad || props.onError || inline) return undefined;
      r.asyncScript(props);
      return separator();
    }
    case "style": {
      const { precedence, href } = props;
      if (inline || typeof precedence !== "string" || typeof href !== "string" || href === "") return undefined;
      if (href.includes(" "))
        warn(
          `React expected the \`href\` prop for a <style> tag opting into hoisting semantics using the \`precedence\` prop to not have any spaces but ecountered spaces instead. using spaces in this prop will cause hydration of this style to fail on the client. The href for the <style> where this ocurred is "${href}".`,
        );
      const child = single(props.children);
      let text = child == null || typeof child === "function" || typeof child === "symbol" ? "" : styleSafe(String(child));
      if (props.dangerouslySetInnerHTML?.__html != null) text += props.dangerouslySetInnerHTML.__html;
      r.styleTag(props, text, warn);
      return separator();
    }
    case "meta": {
      if (inline) return undefined;
      const sep = separator();
      if (!ctx.fallback) {
        const html = writeTag("meta", props);
        r.hoistInto(typeof props.charSet === "string" ? r.charset : props.name === "viewport" ? r.viewport : r.hoistables, html);
      }
      return sep;
    }
    case "img": {
      const { src, srcSet } = props;
      const data = (v: any) => typeof v === "string" && v[4] === ":" && v.slice(0, 4).toLowerCase() === "data";
      if (
        !(props.loading === "lazy" || (!src && !srcSet) || (typeof src !== "string" && src != null) || (typeof srcSet !== "string" && srcSet != null) || props.fetchPriority === "low" || ctx.picture || ctx.noscript) &&
        !data(src) &&
        !data(srcSet)
      )
        r.image_(props);
      return undefined;
    }
  }
  return undefined;
}

function once(node: any, ctx: Ctx) {
  const hooks = serverHooks(ctx);
  const was = rendering_;
  rendering_ = ctx.res;
  try {
    return withHooks(hooks, () => suspendAfter(ctx, () => render(node, ctx, hooks)));
  } finally {
    rendering_ = was;
  }
}

/** The render whose resources ReactDOM.preload and its siblings feed (the client's dispatcher otherwise). */
let rendering_: Resources | null = null;
{
  const d: any = Internals.d;
  const prev = { ...d };
  const via = (name: string, call: (r: Resources, ...a: any[]) => void) =>
    (d[name] = (...a: any[]) => (rendering_ ? call(rendering_, ...a) : prev[name](...a)));
  via("D", (r, href) => r.prefetchDNS(href));
  via("C", (r, href, co) => r.preconnect(href, co));
  via("L", (r, href, as, o) => r.preload(href, as, o));
  via("m", (r, href, o) => r.preloadModule(href, o));
  via("X", (r, src, o) => r.preinitScript(src, o));
  via("S", (r, href, p, o) => r.preinitStyle(href, p, o));
  via("M", (r, src, o) => r.preinitModuleScript(src, o));
}

const fresh = (res = new Resources(writeTag)): Ctx => ({
  values: new Map(),
  ids: 0,
  waiting: [],
  svg: false,
  select: undefined,
  lastText: false,
  stack: [],
  res,
  tree: ROOT_TREE,
  idPrefix: "",
  parent: null,
  noscript: false,
  picture: false,
  fallback: false,
});

/** Inline script content made safe as React makes it: the "s" of any "<script" or "</script" escaped. */
const scriptSafe = (code: string) => code.replace(/(<\/|<)(s)(cript)/gi, (_m, a, b, c) => a + (b === "s" ? "\\u0073" : "\\u0053") + c);
/** A bootstrap script's attributes, given as a string or as { src, integrity, crossOrigin }. */
function scriptAttrs(s: any, nonce?: string) {
  const src = typeof s === "string" ? s : s.src;
  let out = ` src="${escape(src)}"`;
  if (nonce) out += ` nonce="${escape(nonce)}"`;
  if (typeof s === "object" && typeof s.integrity === "string") out += ` integrity="${escape(s.integrity)}"`;
  if (typeof s === "object" && s.crossOrigin != null) out += ` crossorigin="${s.crossOrigin === "use-credentials" ? "use-credentials" : ""}"`;
  return out;
}
const importMap = (options: any, nonce?: string) =>
  options.importMap ? `<script type="importmap"${nonce ? ` nonce="${escape(nonce)}"` : ""}>${scriptSafe(JSON.stringify(options.importMap))}</script>` : "";
/** The preloads of the bootstrap scripts and modules (written with the preamble; never preloaded again). */
function bootstrapPreloads(options: any, nonce: string | undefined, res: Resources) {
  let out = "";
  const src = (s: any) => (typeof s === "string" ? s : s.src);
  for (const s of options.bootstrapScripts ?? []) {
    res.script.set(src(s), null);
    res.module.set(src(s), null);
    out += `<link rel="preload" as="script" fetchPriority="low"${scriptAttrs(s, nonce).replace(" src=", " href=")}/>`;
  }
  for (const s of options.bootstrapModules ?? []) {
    res.script.set(src(s), null);
    res.module.set(src(s), null);
    out += `<link rel="modulepreload" fetchPriority="low"${scriptAttrs(s, nonce).replace(" src=", " href=")}/>`;
  }
  return out;
}
/** The bootstrap: its inline content, then its scripts and modules, each async. */
function bootstrap(options: any, nonce?: string) {
  // The first carries the completed shell's id (React's, which its client looks for).
  let id = ` id="${escape("_" + (options.identifierPrefix ?? "") + "R_")}"`;
  const takeId = () => {
    const out = id;
    id = "";
    return out;
  };
  let out = options.bootstrapScriptContent !== undefined ? `<script${nonce ? ` nonce="${escape(nonce)}"` : ""}${takeId()}>${scriptSafe(String(options.bootstrapScriptContent))}</script>` : "";
  for (const s of options.bootstrapScripts ?? []) out += `<script${scriptAttrs(s, nonce)}${takeId()} async=""></script>`;
  for (const s of options.bootstrapModules ?? []) out += `<script type="module"${scriptAttrs(s, nonce)}${takeId()} async=""></script>`;
  return out;
}

/** A boundary's fallback rendered under React's "Suspense Fallback" frame (in place of "Suspense"). */
function fallbackFrame(ctx: Ctx, fn: () => string): string {
  const i = ctx.stack.length - 1;
  const was = ctx.stack[i];
  const fallback = ctx.fallback;
  if (was === "Suspense") ctx.stack[i] = "Suspense Fallback";
  ctx.fallback = true;
  const deps = ctx.res.boundary;
  if (deps) ctx.res.boundary = { sheets: new Set(), styles: new Set() };
  try {
    return fn();
  } finally {
    if (was === "Suspense") ctx.stack[i] = was;
    ctx.fallback = fallback;
    ctx.res.boundary = deps;
  }
}

/** Where an error was thrown: React's component stack, innermost first, kept for onError and the client. */
const stacks = new WeakMap<object, string>();
export const componentStackOf = (e: unknown) => (e && typeof e === "object" ? stacks.get(e) ?? "" : "");
const stackText = (frames: string[]) => frames.slice().reverse().map((n) => `\n    in ${n} (at **)`).join("");
/** A frame's name, as React names components in its stacks. */
const frameName = (type: any): string =>
  typeof type === "string"
    ? type
    : type === SUSPENSE
      ? "Suspense"
      : typeof type === "function"
        ? type.displayName || type.name || "Anonymous"
        : type?.$$typeof === FORWARD_REF
          ? type.displayName || frameName(type.render)
          : type?.$$typeof === MEMO
            ? type.displayName || frameName(type.type)
            : type?.$$typeof === LAZY
              ? "Lazy"
              : "";

export function renderToString(node: any, options?: any) {
  const ctx = fresh();
  ctx.idPrefix = options?.identifierPrefix ?? "";
  const html = once(node, ctx);
  return withPreamble(html, ctx.res.preamble("", ""));
}
/** Plain markup, for pages no client hydrates: no text separators and no Suspense or Activity comments. */
export function renderToStaticMarkup(node: any, options?: any) {
  const ctx = fresh();
  ctx.static = true;
  ctx.idPrefix = options?.identifierPrefix ?? "";
  const html = once(node, ctx);
  return withPreamble(html, ctx.res.preamble("", ""));
}

/** Rendered again until nothing it waits on is pending (each wait settles one more Suspense). */
async function complete(node: any) {
  for (let round = 0; ; round++) {
    const ctx = fresh();
    const html = once(node, ctx);
    if (!ctx.waiting.length || round > 50) return withPreamble(html, ctx.res.preamble("", ""));
    await Promise.allSettled(ctx.waiting);
  }
}

/**
 * `react-dom/static`: the whole page once everything it waits on has settled (or the render is aborted: what was
 * not done is left to the client), as one prelude. A shell that fails rejects; aborted before the shell, it is empty.
 */
function prerenderHtml(node: any, options: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let settled = false;
    // Aborting: a shell that cannot finish is an empty prelude, not a failure.
    let aborting = false;
    let abortNow: ((reason?: unknown) => void) | null = null;
    let run: ReturnType<typeof startStream> | null = null;
    const done = (html: string) => (settled ? undefined : ((settled = true), resolve(html)));
    const begin = () => {
      if (run || settled) return;
      run = startStream(
        node,
        {
          ...options,
          // (A prerender's boundaries done in place end without a text separator, as React writes them.)
          prerendering: true,
          onShellError: (e: unknown) => {
            options.onShellError?.(e);
            if (aborting) done("");
            else if (!settled) (settled = true), reject(e);
          },
          onAllReady: () => {
            options.onAllReady?.();
            queueMicrotask(() => run?.flow());
          },
        },
        (c) => chunks.push(c),
        () => done(chunks.join("")),
        false,
        (a) => (abortNow = a),
      );
    };
    const abort = (reason: unknown) => {
      aborting = true;
      // Not started yet: started now, and aborted at once (its errors told as React tells them).
      if (!run) begin();
      run?.abort(reason);
    };
    const signal = options.signal;
    // Aborted before it began: nothing rendered, the reason told once.
    if (signal?.aborted) return void (options.onError?.(signal.reason), done(""));
    signal?.addEventListener?.("abort", () => abort(signal.reason), { once: true });
    setImmediateOr(begin);
  });
}

export async function prerender(node: any, options: any = {}) {
  const html = await prerenderHtml(node, options);
  const bytes = new TextEncoder().encode(html);
  const prelude = new ReadableStream<Uint8Array>({
    start(c) {
      if (bytes.length) c.enqueue(bytes);
      c.close();
    },
  });
  return { prelude, postponed: null };
}

export async function prerenderToNodeStream(node: any, options: any = {}) {
  const html = await prerenderHtml(node, options);
  const { Readable } = await import("node:stream" as string);
  return { prelude: Readable.from(html ? [html] : []), postponed: null };
}

// ---------------------------------------------------------------- streaming

/**
 * The swap a streamed boundary runs (sent once, before the first): its content, sent hidden, takes the place of
 * the fallback between the boundary's markers. `$SX` gives a boundary up to the client (it renders it itself).
 */
const RUNTIME_SOURCE =
  "<script>$SC=function(b,s){var t=document.getElementById(b),c=document.getElementById(s);if(!t||!c)return;var p=t.parentNode,n=t.nextSibling,d=0;while(n){if(n.nodeType===8){if(n.data==='/$'){if(d===0)break;d--}else if(n.data[0]==='$')d++}var x=n.nextSibling;p.removeChild(n);n=x}while(c.firstChild)p.insertBefore(c.firstChild,n);var m=t.previousSibling;if(m&&m.nodeType===8)m.data='$';c.remove();t.remove();if(m&&m._reactRetry)m._reactRetry()};$SX=function(b,g,m,k){var t=document.getElementById(b);if(!t)return;if(g!=null)t.dataset.dgst=g;if(m)t.dataset.msg=m;if(k)t.dataset.cstck=k;var m=t.previousSibling;if(m&&m.nodeType===8){m.data='$!';if(m._reactRetry)m._reactRetry()}};$SM=new Map;$SR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll(\"link[data-precedence],style[data-precedence]\"),v=[],k=0;b=e[k++];)\"not all\"===b.getAttribute(\"media\")?v.push(b):(\"LINK\"===b.tagName&&$SM.set(b.getAttribute(\"href\"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$SM.get(d)){var g=a._p;c=!0}else{a=t.createElement(\"link\");a.href=d;a.rel=\"stylesheet\";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$SM.set(d,a)}d=a.getAttribute(\"media\");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute(\"data-precedence\");a.removeAttribute(\"media\")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\"$~\";Promise.all(b).then($SC.bind(null,n,w),$SX.bind(null,n,\"CSS failed to load\"))};</script>";

/** A value written into an inline script, as React escapes it (no "<", "&", ">" or line separators raw). */
const jsArg = (v: unknown) => JSON.stringify(v).replace(/[&><\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** A boundary as the shell writes it while it waits: its template, then its fallback. */
const pendingMarkup = (b: Boundary) => `<!--$?--><template id="B:${b.id}"></template>${b.fallback}<!--/$-->`;

type Boundary = { tree?: TreeContext; id: number; children: any; values: Map<any, any>; svg: boolean; select: any; waiting: PromiseLike<any>; stack: string[]; deps?: { sheets: Set<any>; styles: Set<any> }; fallback?: string; wrap?: [string, string]; suspendedAt?: string; done?: string };

/** A string's size in UTF-8 bytes (what React measures a boundary by). */
function utf8Bytes(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Two bytes below U+0800, three above; a surrogate pair (two units) is four.
    if (c >= 0x80) n += c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 1 : 2;
  }
  return n;
}

/** The hidden element a boundary's late content is sent in: one the parser keeps where the boundary is (React's). */
function segmentWrap(ctx: Ctx): [string, string] {
  if (ctx.svg) return ['<svg aria-hidden="true" style="display:none" id="', "</svg>"];
  switch (ctx.parent) {
    case "math":
      return ['<math aria-hidden="true" style="display:none" id="', "</math>"];
    case "table":
      return ['<table hidden id="', "</table>"];
    case "thead":
    case "tbody":
    case "tfoot":
      return ['<table hidden><tbody id="', "</tbody></table>"];
    case "tr":
      return ['<table hidden><tr id="', "</tr></table>"];
    case "colgroup":
      return ['<table hidden><colgroup id="', "</colgroup></table>"];
  }
  return ['<div hidden id="', "</div>"];
}

/** One streamed render: the shell, then each boundary as it settles, written through `write`. */
function startStream(node: any, options: any, write: (chunk: string) => void, finish: () => void, flowingAtStart = true, expose?: (abort: (reason?: unknown) => void) => void) {
  // Until the stream flows (pipe), nothing is written: the shell waits, and boundaries that complete meanwhile are
  // written into it in place (React flushes them with the shell, no script).
  let flowing = flowingAtStart;
  let held: string | null = null;
  let endHeld = false;
  // chunk: React's progressiveChunkSize; inlined: the bytes of the boundaries written in place so far.
  const shared = { ids: 0, boundaries: [] as Boundary[], next: 0, chunk: options.progressiveChunkSize ?? 12800, inlined: 0 };
  const res = new Resources(writeTag, typeof options.nonce === "object" ? options.nonce?.style : undefined);
  if (typeof options.onHeaders === "function") {
    if (typeof options.maxHeadersLength === "number" && options.maxHeadersLength <= 0)
      warn(
        `React expected a positive non-zero \`maxHeadersLength\` option but found ${options.maxHeadersLength === 0 ? "zero" : options.maxHeadersLength} instead. When using the \`onHeaders\` option you may supply an optional \`maxHeadersLength\` option as well however, when setting this value to zero or less no headers will be captured.`,
      );
    res.headers = { preconnects: "", fontPreloads: "", highImagePreloads: "", remaining: 2 + (typeof options.maxHeadersLength === "number" ? options.maxHeadersLength : 2000) };
  }
  /** The early Link header handed to onHeaders, once: when the shell is done, or first waits. */
  const sendHeaders = (shellComplete: boolean) => {
    try {
      const h = res.takeHeaders(shellComplete);
      if (h) options.onHeaders(h);
    } catch (e) {
      onError(e);
    }
  };
  const pending = new Set<Boundary>();
  let runtimeSent = false;
  let closed = false;
  const nonce: string | undefined = typeof options.nonce === "string" ? options.nonce : options.nonce?.script;
  const scriptOpen = nonce ? `<script nonce="${escape(nonce)}">` : "<script>";
  const RUNTIME = RUNTIME_SOURCE.replace("<script>", scriptOpen);
  // A browser() bail-out is told to onBrowserBailout, its digest empty (the client reports nothing).
  const onError = (e: unknown, at?: string) => {
    const componentStack = at ?? componentStackOf(e);
    if (isBrowserOnly(e)) return options.onBrowserBailout?.(e, { componentStack }), "";
    const digest = options.onError ? options.onError(e, { componentStack }) : (console.error(e), undefined);
    return digest === "" ? undefined : digest;
  };
  // The digest and (in development) the message, as script arguments.
  const sxArgs = (digest: unknown, message: string, error?: unknown, at?: string) =>
    [typeof digest === "string" ? digest : null, dev() ? message : "", dev() ? (at ?? (error ? componentStackOf(error) : "")) : ""].map((v) => "," + JSON.stringify(v).replace(/</g, "\\u003c")).join("");
  const ctxFor = (b?: Boundary): Ctx => ({
    ...fresh(res),
    values: b ? new Map(b.values) : new Map(),
    svg: b?.svg ?? false,
    select: b?.select,
    stack: b ? b.stack.slice() : [],
    tree: b?.tree ?? ROOT_TREE,
    idPrefix: options.identifierPrefix ?? "",
    streaming: { shared, onError },
  });
  let postamble = "";
  const close = () => {
    if (closed) return;
    closed = true;
    options.onAllReady?.();
    if (!flowing) return void (endHeld = true);
    if (postamble) write(postamble);
    finish();
  };
  /** In the held shell: the boundary's pending markup replaced. */
  const inShell = (b: Boundary, markup: string) => {
    if (held === null) return false;
    const at = held.indexOf(pendingMarkup(b));
    if (at < 0) return false;
    held = held.slice(0, at) + markup + held.slice(at + pendingMarkup(b).length);
    return true;
  };
  const watch = () => {
    for (const b of shared.boundaries.splice(0)) {
      pending.add(b);
      const retry = () => (closed ? undefined : settle(b));
      b.waiting.then(retry, retry);
    }
    if (!pending.size) close();
  };
  const settle = (b: Boundary) => {
    pending.delete(b);
    const ctx = ctxFor(b);
    let inner: string;
    if (b.done !== undefined) return reveal(b, ctx, b.done);
    // Its stylesheets and style rules, kept across its renders (each retry meets what the last one did).
    const deps = (b.deps ??= { sheets: new Set<any>(), styles: new Set<any>() });
    // What it sent before is sent once only; this render records it all again.
    res.replay = new Map();
    for (const h of (deps as any).emitted ?? []) res.replay.set(h, (res.replay.get(h) ?? 0) + 1);
    (deps as any).emitted = [];
    res.boundary = deps;
    const queued = shared.boundaries.length;
    try {
      inner = once(b.children, ctx);
    } catch (e: any) {
      res.boundary = res.replay = null;
      if (e && typeof e.then === "function") {
        // Still waiting on something else: the boundary waits again; what it found so far is preloaded now,
        // as React flushes the resources of the parts that have rendered.
        b.waiting = e;
        if (ctx.suspendedAt !== undefined) b.suspendedAt = ctx.suspendedAt;
        shared.boundaries.length = queued;
        shared.boundaries.push(b);
        if (flowing) {
          const early = res.late() + res.lateStyleTags(deps);
          if (early) write(early);
        }
        return watch();
      }
      const digest = onError(e);
      if (!flowing && inShell(b, `<!--$!-->${errorTemplate(digest, errored(e), e)}${b.fallback}<!--/$-->`)) return watch();
      write(`${res.late()}${runtimeSent ? "" : RUNTIME}${scriptOpen}$SX("B:${b.id}"${sxArgs(digest, errored(e), e)})</script>`);
      runtimeSent = true;
      return watch();
    }
    res.boundary = res.replay = null;
    // Done before the first flush: in the shell, its resources with the shell's (text at its end kept apart).
    if (!flowing && inShell(b, `<!--$-->${inner}${ctx.lastText && !options.prerendering ? "<!-- -->" : ""}<!--/$-->`)) return watch();
    reveal(b, ctx, inner);
  };
  /** A boundary's content sent after the shell, and the script that puts it in place of its fallback. */
  const reveal = (b: Boundary, ctx: Ctx, inner: string) => {
    const deps = (b.deps ??= { sheets: new Set<any>(), styles: new Set<any>() });
    const late = res.late();
    const { styleTags, sheets } = res.boundaryStyles(deps);
    // With stylesheets (or style rules) of its own, the boundary is revealed once they have loaded ($SR).
    const hoist = res.stylesToHoist;
    res.stylesToHoist = false;
    const reveal =
      hoist || sheets.length
        ? `$SR("B:${b.id}","S:${b.id}",${jsArg(sheets.map((s) => (s[1] === "" ? [s[0]] : [s[0], s[1], ...Object.entries(s[2]).flat()])))})`
        : `$SC("B:${b.id}","S:${b.id}")`;
    write(`${late}${runtimeSent ? "" : RUNTIME}${(b.wrap ?? segmentWrap(ctx))[0]}S:${b.id}">${inner}${(b.wrap ?? segmentWrap(ctx))[1]}${styleTags}${scriptOpen}${reveal}</script>`);
    runtimeSent = true;
    watch();
  };
  // The shell: when it suspends outside any boundary, rendered again once what it waits on settles (React waits).
  let shellDone = false;
  const tryShell = (): unknown => {
    let shell: string;
    try {
      shell = once(node, ctxFor());
    } catch (e: any) {
      if (e && typeof e.then === "function") {
        sendHeaders(false);
        shared.boundaries.length = 0;
        shared.ids = 0;
        const again = () => (closed ? undefined : tryShell());
        e.then(again, again);
        return null;
      }
      if (isBrowserOnly(e)) e = fatalBrowserError(e);
      onError(e);
      options.onShellError?.(e);
      closed = true;
      return e;
    }
    shellDone = true;
    sendHeaders(true);
    held = shell;
    options.onShellReady?.();
    if (flowing) writeShell();
    watch();
    return null;
  };
  const writeShell = () => {
  const shell = held!;
  held = null;
  // The preamble (an import map, the bootstrap scripts' preloads) in the shell's <head>, or before the shell; the
  // bootstrap scripts after it, as React writes them.
  const shellWithPreamble = withPreamble(shell, res.preamble(importMap(options, nonce), bootstrapPreloads(options, nonce, res)));
  // React's mark of the first paint, which its reveal timing reads: only while boundaries are still to come.
  const paint = !shared.boundaries.length && !pending.size ? "" : `${scriptOpen}requestAnimationFrame(function(){$RT=performance.now()});</script>`;
  // The document's closing tags come last, once everything has streamed (React's postamble).
  const end = /(<\/body>)?<\/html>$/.exec(shellWithPreamble);
  postamble = end ? end[0] : "";
  write(shellWithPreamble.slice(0, shellWithPreamble.length - postamble.length) + paint + bootstrap(options, nonce));
  };
  // Aborted while the shell renders: what is left is aborted once it is done.
  let renderingShell = true;
  // (A shell that failed has nothing left to abort.)
  let api: { abort(reason?: unknown): void } | null = null;
  expose?.((reason?: unknown) => {
    if (renderingShell) shared.aborted = { reason: reason ?? new Error("The render was aborted by the server without a reason.") };
    else api?.abort(reason);
  });
  const failed = tryShell();
  renderingShell = false;
  if (failed) return { abort() {}, failed, flow() {} };
  const handle = {
    failed: null,
    /** The stream flows (piped): the shell and what completed into it written, then the rest as it comes. */
    flow() {
      if (flowing) return;
      flowing = true;
      if (held !== null) writeShell();
      if (endHeld) {
        if (postamble) write(postamble);
        finish();
      }
    },
    /** Stop waiting: what is still pending is left for the client to render. */
    abort(reason?: unknown) {
      if (closed) return;
      const browserReason = reason && typeof reason === "object" && (reason as any).$$typeof === RECOVERABLE ? browserError(reason) : null;
      if (!shellDone) {
        // Aborted before the shell: the shell fails with the reason.
        const why = browserReason ? fatalBrowserError(browserReason) : reason ?? new Error("The render was aborted by the server without a reason.");
        onError(why);
        options.onShellError?.(why);
        closed = true;
        finish();
        return;
      }
      for (const b of pending) {
        const why = browserReason ?? reason ?? new Error("The render was aborted by the server without a reason.");
        const digest = onError(why, b.suspendedAt);
        if (!flowing && inShell(b, `<!--$!-->${errorTemplate(digest, aborted((why as any)?.message ?? String(why)), undefined, b.suspendedAt)}${b.fallback}<!--/$-->`)) continue;
        write(`${runtimeSent ? "" : RUNTIME}${scriptOpen}$SX("B:${b.id}"${sxArgs(digest, aborted((why as any)?.message ?? String(why)), undefined, b.suspendedAt)})</script>`);
        runtimeSent = true;
      }
      pending.clear();
      close();
    },
  };
  api = handle;
  if (shared.aborted) handle.abort(shared.aborted.reason);
  return handle;
}

export function renderToPipeableStream(node: any, options: any = {}) {
  const chunks: string[] = [];
  let out: any = null;
  let ended = false;
  const write = (c: string) => (out ? out.write(c) : chunks.push(c));
  const finish = () => (out ? out.end?.() : (ended = true));
  let run: ReturnType<typeof startStream> | null = null;
  // Started on the next turn, as React starts its work; it flows once piped.
  let abortNow: ((reason?: unknown) => void) | null = null;
  // A shell that failed: the destination destroyed with its error, as React's fatal error does (once piped).
  let fatal: { error: unknown } | null = null;
  const shellError = (e: unknown) => {
    options.onShellError?.(e);
    fatal = { error: e };
    out?.destroy?.(e);
  };
  setImmediateOr(() => {
    run = startStream(node, { ...options, onShellError: shellError }, write, finish, out !== null, (a) => (abortNow = a));
    // Piped while its shell rendered (from onShellReady): it flows now.
    if (out) run.flow();
  });
  return {
    pipe(w: any) {
      out = w;
      for (const c of chunks.splice(0)) w.write(c);
      // (One nobody listens to for errors is ended instead: an unhandled stream error would take the process down.)
      if (fatal) w.listenerCount?.("error") ? w.destroy?.((fatal as any).error) : w.end?.();
      else if (ended) w.end?.();
      run?.flow();
      return w;
    },
    abort(reason?: unknown) {
      abortNow ? abortNow(reason) : run?.abort(reason);
    },
  };
}

export function renderToReadableStream(node: any, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const enc = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let allReady!: () => void;
    const ready = new Promise<void>((r) => (allReady = r));
    const stream: any = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    stream.allReady = ready;
    const run = startStream(
      node,
      {
        ...options,
        onShellReady: () => {
          options.onShellReady?.();
          resolve(stream);
        },
        onShellError: (e: unknown) => {
          options.onShellError?.(e);
          reject(e);
        },
        onAllReady: () => {
          options.onAllReady?.();
          allReady();
        },
      },
      (c) => controller.enqueue(enc.encode(c)),
      () => controller.close(),
    );
    options.signal?.addEventListener?.("abort", () => run.abort(options.signal.reason), { once: true });
  });
}

/** Renders scheduled to start and not started yet (a test's act waits for them). */
let starting = 0;
export const streamsStarting = () => starting;
/** For a test runner: renders scheduled by a test that ended (its fake timers dropped) forgotten. */
export const resetStreams = () => void (starting = 0);
/** A render's start: in a microtask, as React 19 starts its work (scheduleMicrotask). */
const setImmediateOr = (fn: () => void) => {
  starting++;
  queueMicrotask(() => (starting--, fn()));
};

export const version = "19.3.0";

// The module as one object too: `import ReactDOMServer from "react-dom/server"`.
export default { renderToString, renderToStaticMarkup, renderToReadableStream, renderToPipeableStream, prerender, prerenderToNodeStream, version };
