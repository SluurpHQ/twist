// Rendering to HTML, on the server or anywhere without a DOM: the same elements and components, hooks answering
// with their first values. Suspense shows its fallback in renderToString; the streams wait for what it waits on.
import { ACTIVITY, CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, SUSPENSE, VIEW_TRANSITION, createElement, invalidType, objectChild, readThenable, unwrapChild, withOwner } from "./element.ts";
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
import { checkClassInstance, checkDerivedState } from "./class-checks.ts";
import { __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as Internals } from "./react-dom.ts";

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "innerHTML"]);

/** Why the server gave a boundary to the client, in its template as React writes it: the digest onError gave, and
 * in development the message (the client reports it). */
/** A string render's message for a boundary that suspended, naming the streaming API of its build. */
const renderToStringSuspense = (api: string) =>
  `The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "${api}" which supports Suspense on the server`;
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
  /** The streaming API this build offers, named by a string render's Suspense message. */
  streamApi: string;
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
  /** The <ViewTransition> the next element belongs to (React's format context), and where it is (VT_* scopes). */
  vt: VTContext | null;
  scope: number;
  /** While streaming: ids and suspended boundaries shared by the shell and every boundary's render. */
  streaming?: {
    shared: { ids: number; boundaries: Boundary[]; next: number; aborted?: { reason: unknown }; chunk: number; inlined: number; bounds?: SBoundary[]; rootPre?: Preamble };
    onError: (e: unknown, at?: string) => any;
    prerendering?: boolean;
    /** A child that suspended: a task of its own, the marker of its place returned. */
    spawn?: (node: any, ctx: Ctx, pushed: boolean, thenable: PromiseLike<any> | null) => string;
    /** Resuming a prerender: a boundary the prelude left pending takes its id there. */
    adopt?: (b: SBoundary) => void;
  };
  /** A form's custom action fields, written first inside it. */
  formFields?: string;
  /** The boundary being rendered into (null: the shell), and the one whose fallback is. */
  container?: SBoundary | null;
  fallbackOf?: SBoundary | null;
};

function attrs(props: any, ctx: Ctx, tag: string) {
  let out = "";
  const put = (name: string, value: string | null) => {
    if (value != null) out += value === "" && !name.includes("-") && !name.includes(":") ? ` ${name}=""` : ` ${name}="${escape(value)}"`;
  };
  for (const k in props) {
    let v = props[k];
    if (SKIP.has(k)) continue;
    if (typeof v === "function" && v.isSignal === true) v = v();
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
    if (k === "checked" || k === "selected" || k === "muted" || k === "multiple") {
      if (v && typeof v !== "function" && typeof v !== "symbol") put(k, "");
      continue;
    }
    if (k === "autoFocus") {
      if (v && typeof v !== "function" && typeof v !== "symbol") put("autofocus", "");
      continue;
    }
    if ((k === "action" || k === "formAction") && typeof v === "function") continue;
    // A custom element's object and array props are properties the client sets, not attributes (React's Fizz).
    if (isCustomElement(tag, props) && v !== null && typeof v === "object") continue;
    const a = isCustomElement(tag, props) ? customAttribute(tag, k, v) : attribute(tag, k, v, ctx.svg, "server");
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

/** The component (its owner frame) whose render threw last: onError is told from it. */
let failedIn: any = null;

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
    // Streaming: what suspends is retried on its own later (React's spawned task); its siblings go on.
    else if (e && typeof (e as any).then === "function" && ctx.streaming?.spawn && !ctx.static) return ctx.streaming.spawn(node, ctx, !!name, e as any);
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
  // A signal: what it holds now (the client binds to it).
  if (typeof node === "function" && node.isSignal === true) node = node();
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
  // An iterable (or an old `@@iterator` object, which React still accepts).
  const iterate = typeof node === "object" && !node.$$typeof ? (node[Symbol.iterator] ?? node["@@iterator"]) : undefined;
  if (typeof iterate === "function") {
    const it = iterate.call(node);
    if (it === node)
      warnOnce(
        "Using Iterators as children is unsupported and will likely yield unexpected results because enumerating a generator mutates it. You may convert it to an array with `Array.from()` or the `[...spread]` operator before rendering. You can also use an Iterable that can iterate multiple times over the same items.",
      );
    else if (node.entries === iterate) warnOnce("Using Maps as children is not supported. Use an array of keyed ReactElements instead.");
    const items: any[] = [];
    for (let r = it.next(); !r.done; r = it.next()) items.push(r.value);
    return render(items, ctx, hooks);
  }
  // A context as a child: its value where it is rendered.
  if (node.$$typeof === CONTEXT) return render(ctx.values.has(node) ? ctx.values.get(node) : node._defaultValue, ctx, hooks);
  if (node.$$typeof === PORTAL) throw new Error("Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render.");
  if (node.$$typeof !== ELEMENT) throw objectChild(node);
  const { type, props } = node;
  if (typeof type === "string") return host(type, props, ctx, hooks);
  if (typeof type === "symbol") {
    if (type === SUSPENSE) {
      if (ctx.streaming?.spawn && !ctx.static) return streamSuspense(props, ctx, hooks);
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
        const out = suspenseFrame(ctx, false, () => suspendAfter(ctx, () => render(props.children, ctx, hooks)));
        if (ctx.streaming?.shared.aborted) return abortedNow();
        ctx.lastText = false;
        const stream = ctx.streaming;
        if (stream && !ctx.static) {
          // Large (past React's progressiveChunkSize with what was written in place before it): sent after the shell,
          // its fallback in its place meanwhile, as React outlines it.
          const size = utf8Bytes(out);
          if (size > 500 && stream.shared.inlined + size > stream.shared.chunk && !/<(html|head|body)[\s>]/.test(out)) {
            const id = stream.shared.next++;
            const b: Boundary = { prefix: ctx.idPrefix, tree: ctx.tree, id, children: props.children, values: new Map(ctx.values), svg: ctx.svg, select: ctx.select, vt: ctx.vt, scope: ctx.scope, waiting: Promise.resolve(), stack: ctx.stack.slice(), deps, wrap: segmentWrap(ctx), done: out };
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
            const b: Boundary = { prefix: ctx.idPrefix, tree: ctx.tree, id, children: props.children, values: new Map(ctx.values), svg: ctx.svg, select: ctx.select, vt: ctx.vt, scope: ctx.scope, waiting: e, stack: ctx.stack.slice(), deps, wrap: segmentWrap(ctx), suspendedAt: ctx.suspendedAt };
            ctx.suspendedAt = undefined;
            stream.shared.boundaries.push(b);
            try {
              b.fallback = fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
            } catch (f: any) {
              // Its fallback suspends too: nothing to show yet, so what is around it waits on whichever settles first
              // (the content, done, is then written in place; the fallback is never needed).
              if (!f || typeof f.then !== "function") throw f;
              stream.shared.boundaries.pop();
              throw Promise.race([e, f]);
            }
            ctx.lastText = false;
            return pendingMarkup(b);
          }
          ctx.waiting.push(e);
          if (ctx.static) return fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
          return `<!--$!-->${errorTemplate(undefined, aborted(renderToStringSuspense(ctx.streamApi)))}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
        }
        // Asked for in the browser only: the fallback, left to the client (no error to tell).
        if (!stream && isBrowserOnly(e)) return ctx.static ? fallbackFrame(ctx, () => render(props.fallback, ctx, hooks)) : `<!--$!-->${errorTemplate("", "")}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
        if (!stream) throw e;
        // An error inside a boundary: its fallback now, the client renders it again (React's behaviour).
        const digest = stream.onError(e);
        return `<!--$!-->${errorTemplate(digest, errored(e), e)}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
      } finally {
        ctx.res.boundary = parentDeps;
      }
    }
    // A <ViewTransition>: its children annotated; without a name of its own it takes a useId slot for one.
    if (type === VIEW_TRANSITION) {
      if (props.name != null && props.name !== "auto") return viewTransitionFrame(ctx, props, props.name, () => render(props.children, ctx, hooks));
      const tree = ctx.tree;
      const autoName = makeId(ctx.idPrefix, "R", tree, 0);
      ctx.tree = pushTree(tree, 1, 0);
      try {
        return viewTransitionFrame(ctx, props, autoName, () => render(props.children, ctx, hooks));
      } finally {
        ctx.tree = tree;
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
    // Aborted: no component renders any more; what is rendering unwinds to its boundary (React's abort sigil).
    if (ctx.streaming?.shared.aborted && ctx.streaming.spawn) throw ABORTED;
    if (type.prototype?.isReactComponent) {
      // A class gets its props without `ref` (React's resolveClassComponentProps): the ref is its instance's.
      let own = props;
      if (own && "ref" in own) {
        const { ref: _ref, ...rest } = own;
        own = rest;
      }
      const ct = type.contextType;
      const validCt = ct != null && ct.$$typeof === CONTEXT;
      const name = type.displayName || type.name || "Component";
      if (dev() && "contextType" in type && ct !== null && !validCt) {
        const why =
          ct === undefined
            ? " However, it is set to undefined. This can be caused by a typo or by mixing up named and default imports. This can also happen due to a circular dependency, so try moving the createContext() call to a separate file."
            : typeof ct !== "object"
              ? ` However, it is set to a ${typeof ct}.`
              : ct.$$typeof === CONSUMER
                ? " Did you accidentally pass the Context.Consumer instead?"
                : ` However, it is set to an object with keys {${Object.keys(ct).join(", ")}}.`;
        warn(`${name} defines an invalid contextType. contextType should point to the Context object returned by React.createContext().${why}`, "invalid-context-type:" + name);
      }
      // No context type: an empty context object, as React gives.
      const c = validCt ? contextValue(ctx, ct) : {};
      const inst = new type(own, c);
      checkClassInstance(type, inst, own, "server:");
      inst.props = own;
      inst.context = c;
      if (typeof type.getDerivedStateFromProps === "function") {
        const partial = type.getDerivedStateFromProps(own, inst.state);
        checkDerivedState(type, partial);
        if (partial != null) inst.state = { ...inst.state, ...partial };
      } else if (typeof inst.getSnapshotBeforeUpdate !== "function" && (inst.UNSAFE_componentWillMount || inst.componentWillMount)) {
        // As React's server does: componentWillMount runs (not beside the newer lifecycles), its setState applied at once.
        const queue: any[] = [];
        inst.setState = (s: any, cb?: () => void) => {
          queue.push(s);
          cb?.();
        };
        // forceUpdate while mounting: nothing to do (it renders right after).
        inst.forceUpdate = (cb?: () => void) => cb?.();
        const before = inst.state;
        if (typeof inst.componentWillMount === "function") {
          if (dev() && inst.componentWillMount.__suppressDeprecationWarning !== true)
            console.warn(
              `componentWillMount has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.\n\n* Move code from componentWillMount to componentDidMount (preferred in most cases) or the constructor.\n\nPlease update the following components: ${name}`,
            );
          inst.componentWillMount();
        }
        if (typeof inst.UNSAFE_componentWillMount === "function") inst.UNSAFE_componentWillMount();
        if (dev() && before !== inst.state)
          warn(`${name}.componentWillMount(): Assigning directly to this.state is deprecated (except inside a component's constructor). Use setState instead.`);
        for (const u of queue) {
          const part = typeof u === "function" ? u(inst.state, inst.props) : u;
          if (part != null) inst.state = { ...inst.state, ...part };
        }
      }
      const out = inst.render();
      // Rendered once on the server: an update asked later does nothing (React says so).
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
    // (Its element's owner and its type: what it makes is owned by it, an owner stack starts from it.)
    const frame = dev() ? { type, owner: node?._owner ?? null } : null;
    if (dev() && type.contextTypes)
      withOwner(frame!, () =>
        warn(`${type.displayName || type.name || "Unknown"} uses the legacy contextTypes API which was removed in React 19. Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)`, "server:legacy-fn-context:" + (type.displayName || type.name)),
      );
    let out: any;
    try {
      out = frame ? withOwner(frame, () => renderFunction(type, props)) : renderFunction(type, props);
    } catch (e) {
      if (frame && failedIn === null && !(e && typeof (e as any).then === "function")) failedIn = frame;
      throw e;
    }
    return renderOutput(out, ctx, hooks);
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
      if (ctx.streaming?.shared.aborted && ctx.streaming.spawn) throw ABORTED;
      const p = type._payload;
      if (p.status === 1) return render(createElement(p.value, props), ctx, hooks);
      if (p.status === -1) {
        p.status = 0;
        // (A thenable that settles at once: what it gives is used now, no promise to throw.)
        let sync = true;
        // (A failed load rejects, so what waits on it hears why.)
        p.promise = p.load().then(
          (m: any) => ((p.status = 1), (p.value = m.default ?? m)),
          (e: any) => {
            p.status = 2;
            p.value = e;
            if (!sync) throw e;
          },
        );
        sync = false;
        p.promise?.catch?.(() => {});
      }
      if (p.status === 1) return render(createElement(p.value, props), ctx, hooks);
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
  if (ctx.streaming?.spawn && !ctx.static && !ctx.svg && (tag === "html" ? ctx.parent === null : (tag === "head" || tag === "body") && (ctx.parent === null || ctx.parent === "html")))
    return preambleElement(tag, props, ctx, hooks);
  // An action that says how it submits without JavaScript (a Server Action's $$FORM_ACTION): its fields instead.
  let fields = "";
  if (!ctx.svg && (tag === "form" || tag === "button" || tag === "input")) {
    const custom = customFormAction(tag === "form" ? props.action : props.formAction, ctx);
    if (custom) {
      const { action, encType, method, target, name, data } = custom;
      if (tag === "form") {
        props = { ...props, action: action || "", encType, method, target };
        if (name != null) fields = `<input type="hidden" name="${escape(String(name))}"/>` + hiddenFields(data);
      } else {
        props = { ...props, formAction: action || "", formEncType: encType, formMethod: method, formTarget: target, name };
        // (A button holds its extra fields; an input has them right after it.)
        fields = hiddenFields(data);
      }
    }
  }
  ctx.formFields = fields;
  const svg = ctx.svg;
  if (tag === "svg") ctx.svg = true;
  // A whole document: React writes its doctype first.
  ctx.lastText = false;
  let open = `${tag === "html" && ctx.streaming ? "<!DOCTYPE html>" : ""}<${tag}${attrs(props, ctx, tag)}${vtAttributes(ctx)}`;
  // Below it, the view transition is used up, and so is where it can enter or exit.
  const { vt, scope } = ctx;
  ctx.vt = null;
  ctx.scope = scope & ~(VT_ENTER | VT_EXIT);
  try {
    return hostRest(tag, props, ctx, hooks, open, svg);
  } finally {
    ctx.vt = vt;
    ctx.scope = scope;
    // (A child that suspends leaves by throwing: where it was is put back for the boundary around it.)
    ctx.svg = svg;
  }
}

/**
 * The document's <html>, <head> or <body> (React's preamble): its start tag kept for the start of the document, and
 * a <head>'s children too; the rest renders in place. In a boundary, a comment marks where it was given.
 */
function preambleElement(tag: string, props: any, ctx: Ctx, hooks: any): string {
  const s = ctx.streaming!;
  const pre: Preamble = ctx.fallbackOf ? (ctx.fallbackOf.fallbackPre ??= {}) : ctx.container ? (ctx.container.preamble ??= {}) : (s.shared.rootPre ??= {});
  if (pre[tag as "html"] !== undefined) throw new Error(`The \`<${tag}>\` tag may only be rendered once.`);
  pre[tag as "html"] = `${tag === "html" ? "<!DOCTYPE html>" : ""}<${tag}${attrs(props, ctx, tag)}${vtAttributes(ctx)}>`;
  const marker = ctx.container || ctx.fallbackOf ? `<!--${tag}-->` : "";
  const { parent, vt, scope } = ctx;
  ctx.parent = tag;
  ctx.vt = null;
  ctx.scope = scope & ~(VT_ENTER | VT_EXIT);
  ctx.lastText = false;
  try {
    const inner = render(props.children, ctx, hooks);
    if (tag === "head") return (pre.headInner = inner), marker;
    return marker + inner;
  } finally {
    ctx.parent = parent;
    ctx.vt = vt;
    ctx.scope = scope;
    ctx.lastText = false;
  }
}
/** What a render (or a boundary, or its fallback) gives the document's start: its tags, and its <head>'s content. */
type Preamble = { html?: string; head?: string; body?: string; headInner?: string };

/** A function action's progressive-enhancement form (React's getCustomFormFields), with a prefix of its own. */
function customFormAction(action: any, ctx: Ctx): any {
  if (typeof action !== "function" || typeof action.$$FORM_ACTION !== "function") return null;
  const res: any = ctx.res;
  const prefix = ctx.idPrefix + (res.nextFormID = (res.nextFormID ?? -1) + 1);
  try {
    const custom = action.$$FORM_ACTION(prefix);
    custom?.data?.forEach?.((v: unknown) => {
      if (typeof v !== "string") throw new Error("File/Blob fields are not yet supported in progressive forms. Will fallback to client hydration.");
    });
    return custom ?? null;
  } catch (e) {
    if (dev()) console.error("Failed to serialize an action for progressive enhancement:\n%s", e);
    return null;
  }
}
/** A custom action's extra data, as hidden inputs. */
function hiddenFields(data: any): string {
  let out = "";
  data?.forEach?.((v: string, k: string) => (out += `<input type="hidden" name="${escape(k)}" value="${escape(v)}"/>`));
  return out;
}

function hostRest(tag: string, props: any, ctx: Ctx, hooks: any, open: string, svg: boolean): string {
  if (tag === "option") {
    const chosen = ctx.select;
    const v = props.value ?? (typeof props.children === "string" ? props.children : undefined);
    if (chosen !== undefined && (Array.isArray(chosen) ? chosen.map(String).includes(String(v)) : String(chosen) === String(v))) open += " selected";
  }
  // A void element closes itself, as React writes it.
  if (VOID.has(tag) && tag !== "menuitem") {
    ctx.svg = svg;
    const after = tag === "input" && ctx.formFields ? ctx.formFields : "";
    ctx.formFields = "";
    return open + "/>" + after;
  }
  open += ">";
  // (A form's custom action's own fields: first inside it.)
  if ((tag === "form" || tag === "button") && ctx.formFields) (open += ctx.formFields), (ctx.formFields = "");
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
    try {
      inner = render(props.children, ctx, hooks);
    } finally {
      ctx.select = was;
    }
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

/** A render that cannot wait (renderToString): what suspends outside any Suspense is an error, as React says. */
function onceSync(node: any, ctx: Ctx): string {
  try {
    return once(node, ctx);
  } catch (e: any) {
    if (e && typeof e.then === "function")
      throw new Error("A component suspended while responding to synchronous input. This will cause the UI to be replaced with a loading indicator. To fix, updates that suspend should be wrapped with startTransition.");
    throw e;
  }
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
  streamApi: "renderToPipeableStream",
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
  vt: null,
  scope: 0,
});

// ---------------------------------------------------------------- view transitions (React's Fizz annotations)

/** A <ViewTransition>'s classes for the elements it wraps, written as vt-* attributes for the client to animate. */
type VTContext = { update: string; enter: string; exit: string; share: string; name: string; autoName: string; nameIdx: number };
// Where an element is: right below a fallback (it can exit), right below content (it can enter), in a fallback,
// in a subtree that updates.
const VT_EXIT = 1;
const VT_ENTER = 2;
const VT_FALLBACK = 4;
const VT_UPDATE = 8;
const VT_APPEARING = 16;

/** A class prop resolved for no transition type: a string, or the object's default ("auto" means none given). */
const classOf = (c: any): string | null | undefined => (c == null || typeof c === "string" ? c : c.default);
function vtClass(defaultClass: any, eventClass: any): string | null {
  const d = classOf(defaultClass);
  const e = classOf(eventClass);
  if (e == null) return d === "auto" ? null : (d ?? null);
  return e === "auto" ? null : e;
}

/** A Suspense boundary inside a <ViewTransition>: its fallback and content share a name (React's getSuspenseViewTransition). */
const suspenseVT = (vt: VTContext | null): VTContext | null =>
  vt && { update: vt.update, enter: "none", exit: "none", share: vt.update, name: vt.autoName, autoName: vt.autoName, nameIdx: 0 };

/** `fn` rendered as a Suspense boundary's fallback (`fallback`) or content, in the view transition context it gives. */
function suspenseFrame(ctx: Ctx, fallback: boolean, fn: () => string): string {
  const { vt, scope } = ctx;
  ctx.vt = suspenseVT(vt);
  ctx.scope = fallback ? scope | VT_FALLBACK | VT_EXIT : scope | VT_ENTER | (ctx.vt && ctx.vt.share !== "none" ? VT_APPEARING : 0);
  try {
    return fn();
  } finally {
    ctx.vt = vt;
    ctx.scope = scope;
  }
}

/** A <ViewTransition>'s children, in its context (React's getViewTransitionFormatContext). */
function viewTransitionFrame(ctx: Ctx, props: any, autoName: string, fn: () => string): string {
  const { vt: parent, scope } = ctx;
  let update = vtClass(props.default, props.update) ?? "auto";
  let enter = vtClass(props.default, props.enter) ?? "auto";
  let exit = vtClass(props.default, props.exit) ?? "auto";
  let share = vtClass(props.default, props.share);
  let name: string = props.name;
  if (name == null) {
    if (parent) (name = parent.name), (share = parent.share);
    else (name = "auto"), (share = "none");
  } else if (share == null) share = "auto";
  if (!(scope & VT_EXIT)) exit = "none";
  if (!(scope & VT_ENTER)) enter = "none";
  let sub = scope & ~(VT_ENTER | VT_EXIT);
  sub = update !== "none" ? sub | VT_UPDATE : sub & ~VT_UPDATE;
  if (enter !== "none") sub |= VT_APPEARING;
  ctx.vt = { update, enter, exit, share: share ?? "none", name, autoName, nameIdx: 0 };
  ctx.scope = sub;
  try {
    return fn();
  } finally {
    ctx.vt = parent;
    ctx.scope = scope;
  }
}

/** The vt-* attributes of the first elements in a <ViewTransition> (React's pushViewTransitionAttributes). */
function vtAttributes(ctx: Ctx): string {
  const vt = ctx.vt;
  if (!vt) return "";
  let out = "";
  if (vt.name !== "auto") out += ` vt-name="${escape(vt.nameIdx === 0 ? vt.name : vt.name + "_" + vt.nameIdx)}"`, vt.nameIdx++;
  out += ` vt-update="${escape(vt.update)}"`;
  if (vt.enter !== "none") out += ` vt-enter="${escape(vt.enter)}"`;
  if (vt.exit !== "none") out += ` vt-exit="${escape(vt.exit)}"`;
  if (vt.share !== "none") out += ` vt-share="${escape(vt.share)}"`;
  return out;
}

/** Inline script content made safe as React makes it: the "s" of any "<script" or "</script" escaped. */
const scriptSafe = (code: string) => code.replace(/(<\/|<)(s)(cript)/gi, (_m, a, b, c) => a + (b === "s" ? "\\u0073" : "\\u0053") + c);
/** A bootstrap script's attributes, given as a string or as { src, integrity, crossOrigin }. */
/** A bootstrap script's preload attributes, in React's order: nonce, href, integrity, crossorigin. */
function preloadAttrs(s: any, nonce?: string) {
  const src = typeof s === "string" ? s : s.src;
  let out = nonce ? ` nonce="${escape(nonce)}"` : "";
  out += ` href="${escape(src)}"`;
  if (typeof s === "object" && typeof s.integrity === "string") out += ` integrity="${escape(s.integrity)}"`;
  if (typeof s === "object" && s.crossOrigin != null) out += ` crossorigin="${s.crossOrigin === "use-credentials" ? "use-credentials" : ""}"`;
  return out;
}
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
    out += `<link rel="preload" as="script" fetchPriority="low"${preloadAttrs(s, nonce)}/>`;
  }
  for (const s of options.bootstrapModules ?? []) {
    res.script.set(src(s), null);
    res.module.set(src(s), null);
    out += `<link rel="modulepreload" fetchPriority="low"${preloadAttrs(s, nonce)}/>`;
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
  const inner = fn;
  fn = () => suspenseFrame(ctx, true, inner);
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

export function renderToString(node: any, options?: any, streamApi?: string) {
  const ctx = fresh();
  if (streamApi) ctx.streamApi = streamApi;
  ctx.idPrefix = options?.identifierPrefix ?? "";
  const html = onceSync(node, ctx);
  return withPreamble(html, ctx.res.preamble("", ""));
}
/**
 * A streamed Suspense boundary (React's renderSuspenseBoundary): its content rendered now, each part that suspends a
 * task of the boundary's; done when they are. Its fallback only when it waits, its tasks the parent's (dropped if
 * the content is done first). In the output, a marker: what it becomes is decided when its parent is written.
 */
function streamSuspense(props: any, ctx: Ctx, hooks: any): string {
  const s = ctx.streaming!;
  const bounds = (s.shared.bounds ??= []);
  const parent = ctx.container ?? null;
  const b: SBoundary = { idx: bounds.length, id: -1, prefix: ctx.idPrefix, status: 0, pending: 0, content: "", fallback: "", parent, flushed: false, deps: { sheets: new Set(), styles: new Set() }, wrap: segmentWrap(ctx), stack: ctx.stack.slice(), fallbackTasks: new Set(), canPre: !ctx.svg && (ctx.parent === null || ctx.parent === "html") };
  bounds.push(b);
  // Where it is (what a resume finds it by): its components and its place among siblings.
  b.key = `${ctx.stack.join(">")}|${ctx.tree.id}:${ctx.tree.overflow}`;
  s.adopt?.(b);
  // A prerender renders the fallback first (React's): it is there if the content is postponed.
  const renderFallback = () => {
    const was = ctx.fallbackOf;
    ctx.fallbackOf = b;
    ctx.lastText = false;
    try {
      b.fallback = fallbackFrame(ctx, () => render(props.fallback, ctx, hooks));
    } finally {
      ctx.fallbackOf = was;
    }
  };
  let fallbackDone = false;
  if (s.prerendering) renderFallback(), (fallbackDone = true);
  const parentDeps = ctx.res.boundary;
  ctx.res.boundary = b.deps;
  ctx.container = b;
  const outerFallback = ctx.fallbackOf;
  ctx.fallbackOf = null;
  ctx.lastText = false;
  try {
    // (A prerender renders the content as a task of its own, after the fallbacks before it, as React does.)
    b.content = suspenseFrame(ctx, false, () => (s.prerendering && s.spawn && !s.shared.aborted ? s.spawn(props.children, ctx, false, null) : render(props.children, ctx, hooks)));
  } catch (e: any) {
    // An error inside it: its fallback, the client renders it again (React's behaviour). (After an abort, the abort
    // is what it tells.)
    if (!s.shared.aborted) {
      b.status = 2;
      b.error = { digest: s.onError(e), message: errored(e), error: e };
    }
  } finally {
    ctx.res.boundary = parentDeps;
    ctx.container = parent;
    ctx.fallbackOf = outerFallback;
  }
  // Aborted while it rendered (or before): left to the client, the reason told for it.
  const why = s.shared.aborted;
  // (A prerender postpones it instead: a resume renders it.)
  if (why && s.prerendering && b.status === 0) b.postponed = true;
  else if (why && b.status !== 2 && b.status !== 1) {
    const at = stackText(ctx.stack);
    b.status = 2;
    b.error = { digest: s.onError(why.reason, at), message: aborted((why.reason as any)?.message ?? String(why.reason)), at };
  }
  if (b.status === 0 && b.pending === 0) {
    b.status = 1;
    mergeDeps(b, parentDeps);
  }
  if (b.status !== 1) {
    if (!fallbackDone) renderFallback();
  } else {
    b.renderFallback = fallbackDone ? () => b.fallback : snapshotFallback(props.fallback, ctx);
  }
  ctx.lastText = false;
  return `\u0000B${b.idx}\u0000`;
}

/** A boundary done before its parent is out: its stylesheets and style rules are its parent's (React hoists them). */
function mergeDeps(b: SBoundary, into: { sheets: Set<any>; styles: Set<any> } | null | undefined) {
  if (into) for (const k of ["sheets", "styles"] as const) for (const x of b.deps[k]) into[k].add(x);
}

/** A complete boundary's fallback, rendered later if it is outlined (sent after its parent). */
function snapshotFallback(fallback: any, ctx: Ctx) {
  const snap = snapshot(ctx, false);
  return () => {
    const c: Ctx = { ...snap, values: new Map(snap.values), stack: snap.stack.slice() };
    const hooks = serverHooks(c);
    return withHooks(hooks, () => fallbackFrame(c, () => render(fallback, c, hooks)));
  };
}

/** Where rendering is, kept for a task that renders there later. */
const snapshot = (ctx: Ctx, pushed: boolean): Ctx => ({ ...ctx, values: new Map(ctx.values), stack: pushed ? ctx.stack.slice(0, -1) : ctx.stack.slice() });

/** Plain markup, for pages no client hydrates: no text separators and no Suspense or Activity comments. */
export function renderToStaticMarkup(node: any, options?: any, streamApi?: string) {
  const ctx = fresh();
  if (streamApi) ctx.streamApi = streamApi;
  ctx.static = true;
  ctx.idPrefix = options?.identifierPrefix ?? "";
  const html = onceSync(node, ctx);
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
function prerenderHtml(node: any, options: any, lifetime?: AbortController | null, onPostponed?: (p: Postponed | null) => void): Promise<string> {
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
          onPostponed,
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
      // Aborted while its shell renders: told through the render's own hook.
      if (!run && abortNow) return abortNow(reason);
      // Not started yet: started now, and aborted at once (its errors told as React tells them).
      if (!run) begin();
      run?.abort(reason);
    };
    const signal = options.signal;
    // Aborted before it began: nothing rendered, the reason told once.
    if (signal?.aborted) return void (options.onError?.(signal.reason), done(""));
    signal?.addEventListener?.("abort", () => (abort(signal.reason), lifetime?.abort()), { once: true, signal: lifetime?.signal });
    setImmediateOr(begin);
  });
}

export async function prerender(node: any, options: any = {}) {
  // (Only with a signal to listen to: the listener's lifetime, ended when the prelude has been read.)
  const lifetime = options.signal ? new AbortController() : null;
  let html: string;
  let postponed: Postponed | null = null;
  try {
    html = await prerenderHtml(node, options, lifetime, (p) => (postponed = p));
  } catch (e) {
    lifetime?.abort();
    throw e;
  }
  const bytes = new TextEncoder().encode(html);
  const prelude = new ReadableStream<Uint8Array>({
    pull(c) {
      if (bytes.length) c.enqueue(bytes);
      c.close();
      lifetime?.abort();
    },
    cancel: () => void lifetime?.abort(),
  }, { highWaterMark: 0 });
  return { prelude, postponed };
}

export async function prerenderToNodeStream(node: any, options: any = {}) {
  let postponed: Postponed | null = null;
  const html = await prerenderHtml(node, options, null, (p) => (postponed = p));
  const { Readable } = await import("node:stream" as string);
  return { prelude: Readable.from(html ? [html] : []), postponed };
}

/** A prerender finished: what it left pending rendered and sent (or, if its shell never finished, all of it). */
export function resume(node: any, postponed: Postponed, options: any = {}) {
  return renderToReadableStream(node, { ...options, postponed });
}
export function resumeToPipeableStream(node: any, postponed: Postponed, options: any = {}) {
  return renderToPipeableStream(node, { ...options, postponed });
}
/** A prerender resumed as another prerender: its prelude what this one adds, its postponed state what is still left. */
export function resumeAndPrerender(node: any, postponed: Postponed, options: any = {}) {
  return prerender(node, { ...options, postponed });
}
export function resumeAndPrerenderToNodeStream(node: any, postponed: Postponed, options: any = {}) {
  return prerenderToNodeStream(node, { ...options, postponed });
}

// ---------------------------------------------------------------- streaming

/**
 * The swap a streamed boundary runs (sent once, before the first): its content, sent hidden, takes the place of
 * the fallback between the boundary's markers. `$SX` gives a boundary up to the client (it renders it itself).
 */
const RUNTIME_SOURCE =
  "<script>$SC=function(b,s){var t=document.getElementById(b),c=document.getElementById(s);if(!t||!c)return;var p=t.parentNode,n=t.nextSibling,d=0;while(n){if(n.nodeType===8){if(n.data==='/$'){if(d===0)break;d--}else if(n.data[0]==='$')d++}var x=n.nextSibling;p.removeChild(n);n=x}while(c.firstChild)p.insertBefore(c.firstChild,n);var m=t.previousSibling;if(m&&m.nodeType===8)m.data='$';c.remove();t.remove();if(m&&m._reactRetry)m._reactRetry()};$SX=function(b,g,m,k){var t=document.getElementById(b);if(!t)return;if(g!=null)t.dataset.dgst=g;if(m)t.dataset.msg=m;if(k)t.dataset.cstck=k;var m=t.previousSibling;if(m&&m.nodeType===8){m.data='$!';if(m._reactRetry)m._reactRetry()}};$SM=new Map;$SR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll(\"link[data-precedence],style[data-precedence]\"),v=[],k=0;b=e[k++];)\"not all\"===b.getAttribute(\"media\")?v.push(b):(\"LINK\"===b.tagName&&$SM.set(b.getAttribute(\"href\"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$SM.get(d)){var g=a._p;c=!0}else{a=t.createElement(\"link\");a.href=d;a.rel=\"stylesheet\";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$SM.set(d,a)}d=a.getAttribute(\"media\");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute(\"data-precedence\");a.removeAttribute(\"media\")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\"$~\";Promise.all(b).then($SC.bind(null,n,w),$SX.bind(null,n,\"CSS failed to load\"))};</script>";

/** Thrown by what renders after an abort: it unwinds to the boundary (or the shell) that is then aborted. */
const ABORTED = { aborted: true };

/** A part sent after its placeholder: put in its place (React's completeSegment). */
const RS_RUNTIME = "$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};";

/** A value written into an inline script, as React escapes it (no "<", "&", ">" or line separators raw). */
const jsArg = (v: unknown) => JSON.stringify(v).replace(/[&><\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** A boundary as the shell writes it while it waits: its template, then its fallback. */
const pendingMarkup = (b: Boundary) => `<!--$?--><template id="${b.prefix ?? ""}B:${b.id}"></template>${b.fallback}<!--/$-->`;

/** What a prerender leaves for a resume: the boundaries it sent pending (where they are, their id), the next id,
 * or the whole render (root). Plain data, as React's postponed state is (it is serialized between the two). */
type Postponed = { root?: boolean; next: number; boundaries: [string, number][] };

/** A streamed boundary: pending (0), complete (1), or left to the client (2). */
type SBoundary = {
  idx: number;
  id: number;
  prefix: string;
  status: 0 | 1 | 2;
  pending: number;
  content: string;
  fallback: string;
  renderFallback?: () => string;
  parent: SBoundary | null;
  /** Its parent was written: what becomes of it now is sent as a script. */
  flushed: boolean;
  /** Its content sent (hidden, for its swap), and the swap itself. */
  rootWritten?: boolean;
  revealed?: boolean;
  deps: { sheets: Set<any>; styles: Set<any> };
  wrap: [string, string];
  stack: string[];
  fallbackTasks: Set<STask>;
  /** At the document's level: it may give the document its <html>, <head> or <body>. */
  canPre?: boolean;
  /** Where it is in the tree; and, resuming, that the prelude holds it pending (its content is what is sent). */
  key?: string;
  replayed?: boolean;
  /** A prerender was aborted with a part of it still waiting: it stays pending for a resume. */
  postponed?: boolean;
  preamble?: Preamble;
  fallbackPre?: Preamble;
  error?: { digest: unknown; message: string; error?: unknown; at?: string };
};
/** A part that suspended: rendered again on its own when what it waits on settles. 0 pending, 1 done, 2 dropped. */
type STask = { idx: number; node: any; snap: Ctx; container: SBoundary | null; fallbackOf: SBoundary | null; lastText: boolean; at: string; out?: string; state: 0 | 1 | 2; id?: number; flushed?: boolean; written?: boolean; root?: boolean; aborting?: boolean };
type Boundary = { prefix?: string; tree?: TreeContext; id: number; children: any; values: Map<any, any>; svg: boolean; select: any; vt?: VTContext | null; scope?: number; waiting: PromiseLike<any>; stack: string[]; deps?: { sheets: Set<any>; styles: Set<any> }; fallback?: string; wrap?: [string, string]; suspendedAt?: string; done?: string };

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
function startStream(node: any, options: any, write: (chunk: string) => void, finish: () => void, flowingAtStart = true, expose?: (abort: (reason?: unknown) => void, flow: () => void) => void) {
  // Until the stream flows (pipe), nothing is written: the shell waits, and boundaries that complete meanwhile are
  // written into it in place (React flushes them with the shell, no script).
  let flowing = flowingAtStart;
  // Ended (the destination told so): nothing more is written. (Closed is earlier: all work done, maybe not yet sent.)
  let ended = false;
  const endStream = finish;
  finish = () => ((ended = true), endStream());
  let held: string | null = null;
  let endHeld = false;
  // chunk: React's progressiveChunkSize; inlined: the bytes of the boundaries written in place so far.
  const shared = { ids: 0, boundaries: [] as Boundary[], next: 0, chunk: options.progressiveChunkSize ?? 12800, inlined: 0, aborted: undefined as { reason: unknown } | undefined, bounds: undefined as SBoundary[] | undefined, rootPre: undefined as Preamble | undefined };
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
    // Told from the component that threw, so captureOwnerStack gives the components that rendered it.
    const from = failedIn;
    failedIn = null;
    const digest = options.onError ? withOwner(from, () => options.onError(e, { componentStack })) : (console.error(e), undefined);
    return digest === "" ? undefined : digest;
  };
  // The digest and (in development) the message, as script arguments.
  const sxArgs = (digest: unknown, message: string, error?: unknown, at?: string) =>
    [typeof digest === "string" ? digest : null, dev() ? message : "", dev() ? (at ?? (error ? componentStackOf(error) : "")) : ""].map((v) => "," + JSON.stringify(v).replace(/</g, "\\u003c")).join("");
  const ctxFor = (b?: Boundary): Ctx => ({
    ...fresh(res),
    values: b ? new Map(b.values) : new Map(),
    // (Streamed into an SVG or MathML container: its namespace is where the render starts.)
    svg: b?.svg ?? options.namespaceURI === "http://www.w3.org/2000/svg",
    ...(b ? {} : options.namespaceURI === "http://www.w3.org/1998/Math/MathML" ? { parent: "math" } : {}),
    select: b?.select,
    vt: b?.vt ?? null,
    scope: b?.scope ?? 0,
    stack: b ? b.stack.slice() : [],
    tree: b?.tree ?? ROOT_TREE,
    idPrefix: options.identifierPrefix ?? "",
    streaming: { shared, onError, prerendering: !!options.prerendering },
  });
  let postamble = "";
  // Resuming a prerender (React's postponed state): its shell was sent; the boundaries it left pending are found by
  // where they are, keep their ids, and are sent as they complete. What lies outside them is not sent again.
  const resumed: Postponed | null = options.postponed && !options.postponed.root ? options.postponed : null;
  const leftPending = new Map<string, number>((resumed?.boundaries ?? []).map((x) => [x[0], x[1]]));
  if (resumed) shared.next = resumed.next;
  // Every task (each a part that suspended), the shell's still pending, and all still pending.
  const tasks: STask[] = [];
  let rootPending = 0;
  let allPending = 0;
  let rootContent = "";
  const close = () => {
    if (closed) return;
    closed = true;
    options.onAllReady?.();
    if (!flowing) return void (endHeld = true);
    if (postamble) write(postamble);
    finish();
  };
  const maybeClose = () => {
    if (shellDone && allPending === 0 && !closed && (shellWritten || !flowing)) close();
  };
  const adopt = (b: SBoundary) => {
    const id = leftPending.get(b.key!);
    if (id === undefined) return;
    leftPending.delete(b.key!);
    b.id = id;
    b.flushed = b.replayed = true;
    flushedBounds.push(b);
  };
  /** Resuming: whether what renders here is sent (inside a boundary the prelude left pending). */
  const replayedHere = (c: SBoundary | null | undefined) => {
    for (; c; c = c.parent) if (c.replayed) return true;
    return false;
  };
  const spawn = (node: any, ctx: Ctx, pushed: boolean, thenable: PromiseLike<any> | null) => {
    // (Resuming, a part outside what is sent, and not on the way to a boundary that is, is not waited for.)
    if (resumed && !replayedHere(ctx.container)) {
      const at = ctx.stack.join(">");
      if (![...leftPending.keys()].some((k) => k.startsWith(at))) return "";
    }
    const t: STask = { idx: tasks.length, node, snap: snapshot(ctx, pushed), container: ctx.container ?? null, fallbackOf: ctx.fallbackOf ?? null, lastText: ctx.lastText, at: stackText(ctx.stack), state: 0 };
    tasks.push(t);
    // (The new segment takes the text before it: what follows it starts afresh.)
    ctx.lastText = false;
    if (t.container) t.container.pending++;
    else rootPending++;
    allPending++;
    t.fallbackOf?.fallbackTasks.add(t);
    // (None: rendered in this same pass of work, as React works through what it pushes.)
    if (!thenable) return pinged.push(t), `\u0000T${t.idx}\u0000`;
    thenable.then(
      () => schedule(t),
      (e) => {
        // Claimed by an abort already: told with this reason, before the abort tells the rest.
        if (t.aborting) return t.state === 0 ? (finishAborted(t, e), flushQueues()) : undefined;
        schedule(t);
      },
    );
    return `\u0000T${t.idx}\u0000`;
  };
  // Landings are worked through together, then what they finished is written at once (React's pingedTasks and
  // performWork, which flushes after the batch).
  const pinged: STask[] = [];
  const schedule = (t: STask) => {
    pinged.push(t);
    if (pinged.length === 1) setImmediateOr(work);
  };
  const drain = () => {
    for (let i = 0; i < pinged.length; i++) retry(pinged[i]!);
    pinged.length = 0;
  };
  const work = () => {
    drain();
    after();
  };
  /** A part an abort claimed: its boundary left to the client with the reason (the shell's parts are gone already). */
  const finishAborted = (t: STask, why: unknown) => {
    const b = t.container;
    if (options.prerendering && b) {
      // (Its boundary stays pending in the prelude: a resume renders it.)
      b.postponed = true;
      onError(why, t.at);
      return settled(t, 2);
    }
    if (b && b.status === 0) giveUp(b, { digest: onError(why, t.at), message: aborted((why as any)?.message ?? String(why)), at: t.at });
    settled(t, 2);
  };
  let abortClaimed = false;
  /** A task's part rendered again where it was (React's retryTask). */
  const retry = (t: STask) => {
    if (t.state !== 0 || closed || t.aborting) return;
    // Its boundary given to the client meanwhile: nothing to render.
    if (t.container?.status === 2) return settled(t, 2);
    // Its boundary already out: what surrounds it was written before it (React flushes a pending boundary's finished
    // parts early), so it is no longer embedded in that text.
    const embedded = !t.flushed;
    const ctx: Ctx = { ...t.snap, values: new Map(t.snap.values), stack: t.snap.stack.slice(), lastText: embedded && t.lastText };
    ctx.res.boundary = t.container ? t.container.deps : null;
    const was = rendering_;
    rendering_ = res;
    let out: string;
    try {
      const hooks = serverHooks(ctx);
      out = withHooks(hooks, () => render(t.node, ctx, hooks));
    } catch (e: any) {
      return failed(t, e);
    } finally {
      rendering_ = was;
      res.boundary = null;
    }
    if (t.state !== 0) return;
    // A text-embedded segment ending in text: closed with a separator (React's pushSegmentFinale).
    // (A prerender's are written in place, without it, as React writes them.)
    if (ctx.lastText && embedded && !options.prerendering) out += "<!-- -->";
    t.out = out;
    settled(t, 1);
    if (flowing && shellWritten && !closed) {
      // What the parts done so far found, sent now (React flushes a partial boundary's resources and styles).
      const c = t.container;
      const early = res.late() + (c && c.status === 0 ? res.lateStyleTags(c.deps) : "");
      if (early) write(early);
    }
  };
  /** A task done (or dropped): its boundary, or the shell, one closer to complete. */
  const settled = (t: STask, state: 1 | 2) => {
    t.state = state;
    allPending--;
    t.fallbackOf?.fallbackTasks.delete(t);
    const c = t.container;
    if (!c) {
      if (--rootPending === 0 && !shellDone && !closed) shellReady();
    } else if (--c.pending === 0 && c.status === 0 && !c.postponed) complete(c);
  };
  /** After work: what can be written is, then the stream ends if nothing is left. */
  const after = () => {
    if (shellDone && flowing && !shellWritten && !closed) writeShell();
    flushQueues();
    maybeClose();
  };
  const failed = (t: STask, e: unknown) => {
    const c = t.container;
    if (!c) {
      // In the shell: the whole render fails (React's fatal error).
      t.state = 2;
      if (isBrowserOnly(e)) e = fatalBrowserError(e);
      onError(e);
      if (!shellDone) options.onShellError?.(e);
      closed = true;
      finish();
      return;
    }
    // (Unwound by an abort: the abort is what it tells.)
    if (c.status === 0 && e === ABORTED) {
      const why = shared.aborted!.reason;
      giveUp(c, { digest: onError(why, t.at), message: aborted((why as any)?.message ?? String(why)), at: t.at });
    } else if (c.status === 0) giveUp(c, { digest: onError(e), message: errored(e), error: e });
    settled(t, 2);
  };
  /** A boundary left to the client: its fallback stays (in place, or by a script once its parent is out). */
  const giveUp = (b: SBoundary, error: NonNullable<SBoundary["error"]>) => {
    b.status = 2;
    b.error = error;
    if (b.flushed && flowing) {
      write(`${runtimeSent ? "" : RUNTIME}${scriptOpen}$SX("${b.prefix}B:${b.id}"${sxArgs(error.digest, error.message, error.error, error.at)})</script>`);
      runtimeSent = true;
    }
  };
  const complete = (b: SBoundary) => {
    b.status = 1;
    if (!b.flushed) mergeDeps(b, b.parent ? b.parent.deps : null);
    // Its fallback is not needed: what it waits on is dropped (React's abortTaskSoft).
    if (!b.flushed) for (const t of [...b.fallbackTasks]) if (t.state === 0) settled(t, 2);
  };
  /** The task a segment holds when it holds nothing else, still pending. */
  const loneTask = (html: string) => {
    const m = /^\u0000T(\d+)\u0000$/.exec(html);
    const t = m ? tasks[+m[1]!] : undefined;
    return t && t.state === 0 ? t : undefined;
  };
  /** Boundaries whose parent is out, in the order they went out. */
  const flushedBounds: SBoundary[] = [];
  let segmentRuntimeSent = false;
  /** What of a boundary is done and not yet sent: its content (once), then each part that landed (React's segments). */
  const segmentsOf = (b: SBoundary) => {
    let out = "";
    // (Postponed by a prerender: a resume sends it.)
    if (b.postponed) return out;
    const p = b.prefix;
    if (!b.rootWritten) {
      b.rootWritten = true;
      // Nothing but a part still to come: that part takes its id, nothing is sent now (React's queueCompletedSegment).
      const only = loneTask(b.content);
      if (only) (only.id = b.id), (only.flushed = true), (only.root = true);
      else out += `${b.wrap[0]}${p}S:${b.id}">${assemble(b.content, b, true)}${b.wrap[1]}`;
    }
    for (const t of tasks) {
      if (t.container !== b || t.state !== 1 || !t.flushed || t.written) continue;
      t.written = true;
      const only = loneTask(t.out!);
      if (only) {
        only.id = t.id;
        only.flushed = true;
        only.root = t.root;
        continue;
      }
      // (The boundary's own content: swapped in with the boundary, not into a placeholder.)
      if (t.root) {
        out += `${b.wrap[0]}${p}S:${t.id}">${assemble(t.out!, b, true)}${b.wrap[1]}`;
        continue;
      }
      const w = segmentWrap(t.snap);
      out += `${w[0]}${p}S:${t.id}">${assemble(t.out!, b, true)}${w[1]}${segmentRuntimeSent ? scriptOpen : scriptOpen + RS_RUNTIME}$RS("${p}S:${t.id}","${p}P:${t.id}")</script>`;
      segmentRuntimeSent = true;
    }
    return out;
  };
  /** What can be sent now (React's flushCompletedQueues): completed boundaries with their swap, then the parts of
   * boundaries still waiting. */
  const flushQueues = () => {
    if (!flowing || !shellWritten || ended) return;
    for (let i = 0; i < flushedBounds.length; i++) {
      const b = flushedBounds[i]!;
      if (b.status !== 1 || b.revealed) continue;
      b.revealed = true;
      const parts = segmentsOf(b);
      const late = res.late();
      const { styleTags, sheets } = res.boundaryStyles(b.deps);
      const hoist = res.stylesToHoist;
      res.stylesToHoist = false;
      const p = b.prefix;
      const swap =
        hoist || sheets.length
          ? `$SR("${p}B:${b.id}","${p}S:${b.id}",${jsArg(sheets.map((x) => (x[1] === "" ? [x[0]] : [x[0], x[1], ...Object.entries(x[2]).flat()])))})`
          : `$SC("${p}B:${b.id}","${p}S:${b.id}")`;
      write(`${late}${runtimeSent ? "" : RUNTIME}${parts}${styleTags}${scriptOpen}${swap}</script>`);
      runtimeSent = true;
    }
    for (let i = 0; i < flushedBounds.length; i++) {
      const b = flushedBounds[i]!;
      if (b.status !== 0) continue;
      const parts = segmentsOf(b);
      if (parts) write(parts);
    }
  };
  /** Markup with its markers resolved: tasks' parts in place, boundaries as they now are (React's flushSegment). */
  const assemble = (html: string, into: SBoundary | null, partial = false): string =>
    html.replace(/\u0000([TB])(\d+)\u0000/g, (_m, kind: string, n: string) => {
      if (kind === "T") {
        const t = tasks[+n]!;
        if (t.state === 1) return (t.written = true), assemble(t.out!, into, partial);
        // Still to come while what holds it goes out: a placeholder it fills later (React's P: segment).
        if (t.state === 0 && partial) {
          t.id = shared.next++;
          t.flushed = true;
          return `<template id="${into?.prefix ?? ""}P:${t.id}"></template>`;
        }
        return "";
      }
      const b = (shared as any).bounds[+n] as SBoundary;
      if (b.status === 1) {
        const inner = assemble(b.content, b);
        const size = utf8Bytes(inner);
        // Large (past React's progressiveChunkSize with what was inlined before it): sent after its parent.
        // (Never one that gives the document its preamble: it is written with it.)
        if (size > 500 && shared.inlined + size > shared.chunk && !b.preamble && b.renderFallback) {
          let fallback: string | null = null;
          try {
            fallback = b.renderFallback();
          } catch {}
          if (fallback !== null) {
            b.id = shared.next++;
            b.flushed = true;
            b.fallback = fallback;
            flushedBounds.push(b);
            return `<!--$?--><template id="${b.prefix}B:${b.id}"></template>${fallback}<!--/$-->`;
          }
        }
        shared.inlined += size;
        return `<!--$-->${inner}<!--/$-->`;
      }
      const fallback = assemble(b.fallback, into);
      if (b.status === 2) {
        const e = b.error!;
        return `<!--$!-->${errorTemplate(e.digest, e.message, e.error, e.at)}${fallback}<!--/$-->`;
      }
      b.id = shared.next++;
      b.flushed = true;
      flushedBounds.push(b);
      anyPending = true;
      return `<!--$?--><template id="${b.prefix}B:${b.id}"></template>${fallback}<!--/$-->`;
    });
  let anyPending = false;
  let shellDone = false;
  let shellWritten = false;
  const shellReady = () => {
    shellDone = true;
    sendHeaders(true);
    // (Resuming: the prelude was the shell.)
    if (resumed) shellWritten = true;
    options.onShellReady?.();
    if (flowing && !shellWritten) writeShell();
    if (resumed) flushQueues();
    maybeClose();
  };
  /** The document's start as far as it is known, and whether a boundary still waiting could add to it. */
  const preambleNow = () => {
    const found: Preamble & { inners: string[] } = { inners: [] };
    let waiting = false;
    const take = (p?: Preamble) => {
      if (!p) return;
      found.html ??= p.html;
      found.head ??= p.head;
      found.body ??= p.body;
      if (p.headInner !== undefined) found.inners.push(p.headInner);
    };
    const walk = (html: string) => {
      for (const m of html.matchAll(/\u0000([TB])(\d+)\u0000/g)) {
        if (m[1] === "T") {
          const t = tasks[+m[2]!]!;
          if (t.state === 1) walk(t.out!);
          continue;
        }
        const b = shared.bounds![+m[2]!]!;
        if (!b.canPre) continue;
        if (b.status === 1) take(b.preamble), walk(b.content), b.preamble?.headInner && walk(b.preamble.headInner);
        else if (b.status === 2) take(b.fallbackPre), walk(b.fallback);
        else waiting = true;
      }
    };
    take(shared.rootPre);
    walk(rootContent);
    if (shared.rootPre?.headInner) walk(shared.rootPre.headInner);
    return { found, ready: !waiting || !!(found.head && found.body) };
  };
  const writeShell = () => {
    const { found, ready } = preambleNow();
    // A boundary that could still give the document its <html>, <head> or <body>: the shell waits for it.
    if (!ready) return;
    shellWritten = true;
    anyPending = false;
    const shell = assemble(rootContent, null);
    const inners = found.inners.map((h) => assemble(h, null)).join("");
    // The preamble (an import map, the bootstrap scripts' preloads) in the document's <head>, or before the shell;
    // the bootstrap scripts after it, as React writes them.
    const resources = res.preamble(importMap(options, nonce), bootstrapPreloads(options, nonce, res));
    const start = found.html || found.head ? `${found.html ?? ""}${found.head ?? "<head>"}${resources}${inners}</head>${found.body ?? ""}` : `${resources}${found.body ?? ""}`;
    // React's mark of the first paint, which its reveal timing reads: only while boundaries are still to come.
    const paint = !anyPending && !flushedBounds.length ? "" : `${scriptOpen}requestAnimationFrame(function(){$RT=performance.now()});</script>`;
    // The document's closing tags come last, once everything has streamed (React's postamble).
    postamble = (found.body ? "</body>" : "") + (found.html ? "</html>" : "");
    write(start + withPreamble(shell, "") + paint + bootstrap(options, nonce));
    flushQueues();
  };
  // Aborted while the shell renders: what is left is aborted once it is done.
  let renderingShell = true;
  let api: { abort(reason?: unknown): void } | null = null;
  // The stream flows (piped): the shell and what completed into it written, then the rest as it comes.
  /** A prerender: the boundaries it leaves pending, for a resume to finish (React's postponed state). */
  const reportPostponed = () => {
    if (!options.prerendering) return;
    const left = (shared.bounds ?? []).filter((b) => b.flushed && b.status === 0).map((b) => [b.key!, b.id] as [string, number]);
    options.onPostponed?.(left.length ? { next: shared.next, boundaries: left } : null);
  };
  const flow = () => {
    if (flowing) return;
    flowing = true;
    if (shellDone && !shellWritten) writeShell();
    if (shellWritten) flushQueues();
    if (shellDone) reportPostponed();
    if (endHeld) {
      if (postamble) write(postamble);
      finish();
    }
  };
  expose?.(
    (reason?: unknown) => {
      if (renderingShell) shared.aborted = { reason: reason ?? new Error("The render was aborted by the server without a reason.") };
      else api?.abort(reason);
    },
    // (Piped from onShellReady, before the shell's render returns: it flows at once, as React's pipe writes.)
    () => flow(),
  );
  /** Aborted before the shell is done: each part still waiting told the reason (React's abortTask), and the part
   * that was rendering (inFlight), then the shell fails with it. A browser() reason: a boundary's part bails out to
   * the browser, a part of the shell is fatal, each its own. */
  const abortShell = (reason: unknown, inFlight?: string, known?: Error | null) => {
    if (closed) return;
    // (A browser() reason is resolved once: its initializer runs once.)
    const browserReason = known !== undefined ? known : reason && typeof reason === "object" && (reason as any).$typeof === RECOVERABLE ? browserError(reason) : null;
    const plain = reason ?? new Error("The render was aborted by the server without a reason.");
    let why: unknown = null;
    const tell = (inShell: boolean, at?: string) => {
      const e = browserReason ? (inShell ? fatalBrowserError(browserReason) : browserReason) : plain;
      if (inShell) why ??= e;
      onError(e, at);
    };
    for (const t of tasks) {
      if (t.state !== 0) continue;
      t.state = 2;
      tell(!t.container, t.at);
    }
    if (inFlight !== undefined || why === null) tell(true, inFlight);
    // (A prerender whose shell could not finish: the whole render is left to a resume.)
    if (options.prerendering) options.onPostponed?.({ root: true, next: 0, boundaries: [] });
    options.onShellError?.(why);
    closed = true;
    finish();
  };
  // The shell, rendered now; what suspends in it is retried as it settles.
  const failedShell = (() => {
    const ctx = ctxFor();
    ctx.streaming!.spawn = spawn;
    if (resumed) ctx.streaming!.adopt = adopt;
    ctx.container = null;
    try {
      rootContent = once(node, ctx);
      // (What the shell pushed to render now, rendered now.)
      drain();
      // A prerender aborted while its shell rendered: the whole render is left to a resume, the reason told once.
      if (options.prerendering && shared.aborted) {
        renderingShell = false;
        const why = shared.aborted.reason;
        onError(why);
        options.onPostponed?.({ root: true, next: 0, boundaries: [] });
        options.onShellError?.(why);
        closed = true;
        finish();
        return why;
      }
    } catch (e: any) {
      if (e === ABORTED || shared.aborted) {
        renderingShell = false;
        abortShell(shared.aborted!.reason, stackText(ctx.stack));
        return shared.aborted!.reason ?? e;
      }
      if (isBrowserOnly(e)) e = fatalBrowserError(e);
      onError(e);
      options.onShellError?.(e);
      closed = true;
      return e;
    }
    if (rootPending === 0) shellReady();
    else sendHeaders(false);
    return null;
  })();
  renderingShell = false;
  if (failedShell) return { abort() {}, failed: failedShell, flow() {} };
  const handle = {
    failed: null,
    flow,
    /** Stop waiting: what is still pending is left for the client to render. */
    abort(reason?: unknown) {
      if (closed) return;
      const browserReason = reason && typeof reason === "object" && (reason as any).$$typeof === RECOVERABLE ? browserError(reason) : null;
      if (!shellDone) return abortShell(reason, undefined, browserReason);
      const why = browserReason ?? reason ?? new Error("The render was aborted by the server without a reason.");
      if (abortClaimed) return;
      abortClaimed = true;
      shared.aborted = { reason: why };
      // What waits is claimed now and told later (React's abortTask, then finishAbort): a rejection that comes in
      // between is told with its own reason.
      for (const t of tasks) if (t.state === 0) t.aborting = true;
      // (A task later, as React's scheduleWork: rejections already on their way are heard first.)
      ((globalThis as any).setImmediate ?? setTimeout)(() => {
        for (const t of tasks) if (t.state === 0 && t.aborting) finishAborted(t, why);
        flushQueues();
        close();
      });
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
  // The destination closed or errored before the render was done: nothing more is written to it.
  let dropped = false;
  const write = (c: string) => {
    if (dropped) return;
    if (!out) return void chunks.push(c);
    // Ended or destroyed by its owner (its close event may come later): closed early.
    if (out.writableEnded || out.destroyed) return cancel("The destination stream closed early.")();
    out.write(c);
  };
  const finish = () => ((ended = true), out && !dropped ? out.end?.() : undefined);
  let run: ReturnType<typeof startStream> | null = null;
  const cancel = (reason: string) => () => {
    if (ended || dropped) return;
    dropped = true;
    const why = new Error(reason);
    abortNow ? abortNow(why) : run?.abort(why);
  };
  // Started on the next turn, as React starts its work; it flows once piped.
  let abortNow: ((reason?: unknown) => void) | null = null;
  let flowNow: (() => void) | null = null;
  // A shell that failed: the destination destroyed with its error, as React's fatal error does (once piped).
  let fatal: { error: unknown } | null = null;
  const shellError = (e: unknown) => {
    options.onShellError?.(e);
    fatal = { error: e };
    out?.destroy?.(e);
  };
  setImmediateOr(() => {
    run = startStream(node, { ...options, onShellError: shellError }, write, finish, out !== null, (a, f) => ((abortNow = a), (flowNow = f)));
    // Piped while its shell rendered (from onShellReady): it flows now.
    if (out) run.flow();
  });
  return {
    pipe(w: any) {
      out = w;
      // As React's pipe: a destination that errors or closes early aborts what is left of the render.
      w.on?.("error", cancel("The destination stream errored while writing data."));
      w.on?.("close", cancel("The destination stream closed early."));
      for (const c of chunks.splice(0)) w.write(c);
      // (One nobody listens to for errors is ended instead: an unhandled stream error would take the process down.)
      if (fatal) w.listenerCount?.("error") ? w.destroy?.((fatal as any).error) : w.end?.();
      else if (ended) w.end?.();
      run ? run.flow() : flowNow?.();
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
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let allReady!: () => void;
    let allFailed!: (e: unknown) => void;
    const ready = new Promise<void>((r, f) => ((allReady = r), (allFailed = f)));
    ready.catch(() => {});
    let run: ReturnType<typeof startStream> | null = null;
    let abortNow: ((reason?: unknown) => void) | null = null;
    let flowNow: (() => void) | null = null;
    let cancelled = false;
    const signal = options.signal;
    // The listener's lifetime (React's): it goes when the render is done with it, whichever way.
    const lifetime = signal ? new AbortController() : null;
    const end = () => lifetime?.abort();
    const onAbort = () => (run ? run.abort(signal.reason) : abortNow?.(signal.reason), end());
    // It flows once read (React's pull), and a reader that cancels aborts what is left.
    const stream: any = new ReadableStream<Uint8Array>(
      {
        start: (c) => void (controller = c),
        pull: () => void (run ? run.flow() : flowNow?.()),
        cancel: (reason) => {
          // (Nothing more is read: what the abort writes is dropped.)
          cancelled = true;
          end();
          run ? run.abort(reason) : abortNow?.(reason);
        },
      },
      { highWaterMark: 0 },
    );
    stream.allReady = ready;
    // Aborted before it began: nothing renders, the shell fails with the reason (React aborts the request first).
    if (signal?.aborted) {
      const why = signal.reason;
      options.onError?.(why);
      options.onShellError?.(why);
      allFailed(why);
      return reject(why);
    }
    // (Listening before it starts: an abort while the shell renders is heard there.)
    signal?.addEventListener?.("abort", onAbort, { once: true, signal: lifetime!.signal });
    run = startStream(
      node,
      {
        ...options,
        onShellReady: () => {
          options.onShellReady?.();
          resolve(stream);
        },
        onShellError: (e: unknown) => {
          options.onShellError?.(e);
          end();
          allFailed(e);
          reject(e);
        },
        onAllReady: () => {
          options.onAllReady?.();
          allReady();
        },
      },
      (c) => void (cancelled || controller?.enqueue(enc.encode(c))),
      () => {
        end();
        if (cancelled) return;
        try {
          controller?.close();
        } catch {}
      },
      false,
      (a, f) => ((abortNow = a), (flowNow = f)),
    );
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
export default { renderToString, renderToStaticMarkup, renderToReadableStream, renderToPipeableStream, prerender, prerenderToNodeStream, resume, resumeToPipeableStream, resumeAndPrerender, resumeAndPrerenderToNodeStream, version };
