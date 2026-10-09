// Rendering to HTML, on the server or anywhere without a DOM: the same elements and components, hooks answering
// with their first values. Suspense shows its fallback in renderToString; the streams wait for what it waits on.
import { ACTIVITY, CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, SUSPENSE, createElement, invalidType, objectChild, unwrapChild } from "./element.ts";
import { client } from "./core.ts";
import { withHooks } from "./hooks.ts";
import { validateProps, validateStyle } from "./validate-props.ts";
import { fieldString } from "./coercion.ts";
import { dev } from "./warnings.ts";
import { styleText } from "./props.ts";
import { assertValidProps, attribute, checkTagName, customAttribute, isCustomElement } from "./attributes.ts";
import { Resources } from "./float-server.ts";
import { warn } from "./warnings.ts";
import { __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as Internals } from "./react-dom.ts";

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "innerHTML"]);

/** Why the server gave a boundary to the client, in its template as React writes it: the digest onError gave, and
 * in development the message (the client reports it). */
const RENDER_TO_STRING_SUSPENSE = 'The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "renderToPipeableStream" which supports Suspense on the server';
const errored = (e: any) => "Switched to client rendering because the server rendering errored:\n\n" + (e?.message ?? String(e));
const aborted = (reason: string) => "Switched to client rendering because the server rendering aborted due to:\n\n" + reason;
function errorTemplate(digest: unknown, message: string, error?: unknown) {
  const dgst = typeof digest === "string" ? ` data-dgst="${escape(digest)}"` : "";
  const stack = dev() && error ? componentStackOf(error) : "";
  return `<template${dgst}${dev() ? ` data-msg="${escape(message)}"` : ""}${stack ? ` data-cstck="${escape(stack)}"` : ""}></template>`;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);

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
  /** What a child suspended on while its siblings rendered on: thrown at the boundary around them. */
  suspended?: PromiseLike<any> | null;
  /** Float's resources and hoistables for this render (written into <head>, or before a later chunk). */
  res: Resources;
  /** The enclosing element's tag (null at the top): <html>, <head> and <body> are the document's only at the top. */
  parent: string | null;
  /** Inside a <noscript>, a <picture>, a Suspense fallback: where React renders hoistables in place or drops them. */
  noscript: boolean;
  picture: boolean;
  fallback: boolean;
  /** While streaming: ids and suspended boundaries shared by the shell and every boundary's render. */
  streaming?: { shared: { ids: number; boundaries: Boundary[]; next: number }; onError: (e: unknown) => any };
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

// ---------------------------------------------------------------- hooks while rendering a component on the server

/** The function component rendering now: its hooks, kept across its re-renders (state set while it renders). */
type ServerComponent = { hooks: any[]; at: number; again: boolean };
let rendering: ServerComponent | null = null;

const INVALID_HOOK =
  "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.";

function slot<T>(make: () => T): T {
  const c = rendering;
  if (!c) throw new Error(INVALID_HOOK);
  const i = c.at++;
  if (i >= c.hooks.length) c.hooks.push(make());
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
  for (const a of h.queue.splice(0)) h.value = reducer(h.value, a);
  return [h.value, h.dispatch];
}

function memoHook(fn: () => any, deps?: any[]) {
  const h = slot(() => ({ deps: undefined as any, value: undefined as any, set: false }));
  if (!h.set || !deps || !h.deps || deps.length !== h.deps.length || deps.some((d: any, i: number) => !Object.is(d, h.deps[i]))) {
    h.value = fn();
    h.deps = deps;
    h.set = true;
  }
  return h.value;
}

/** A function component rendered on the server: again while it set its own state, as React's server does. */
function renderFunction(type: any, props: any) {
  const c: ServerComponent = { hooks: [], at: 0, again: false };
  const was = rendering;
  rendering = c;
  try {
    for (let pass = 0; ; pass++) {
      if (pass >= 25) throw new Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
      c.at = 0;
      c.again = false;
      const out = type(props);
      if (!c.again) return out;
    }
  } finally {
    rendering = was;
  }
}

function serverHooks(ctx: Ctx) {
  const readThenable = (t: any) => {
    if (t.status === "fulfilled") return t.value;
    if (t.status === "rejected") throw t.reason;
    if (t.status !== "pending") {
      t.status = "pending";
      t.then((v: any) => ((t.status = "fulfilled"), (t.value = v)), (e: any) => ((t.status = "rejected"), (t.reason = e)));
    }
    throw t;
  };
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
    useContext: read,
    useId: () => `_r_${(ctx.streaming ? ctx.streaming.shared.ids++ : ctx.ids++).toString(32)}_`,
    useSyncExternalStore: (_s: any, get: any, getServer?: any) => (getServer ?? get)(),
    useTransition: () => [false, (fn: any) => fn()],
    useDeferredValue: (v: any, initial?: any) => (initial !== undefined ? initial : v),
    useActionState: (_a: any, init: any) => [init, NOOP, false],
    useOptimistic: (s: any) => [s, NOOP],
    useEffectEvent: (fn: any) => fn,
    use: (u: any) => (u && u.$$typeof === CONTEXT ? read(u) : readThenable(u)),
  } as any;
}

function render(node: any, ctx: Ctx, hooks: any): string {
  const name = node && typeof node === "object" && node.$$typeof === ELEMENT ? frameName(node.type) : "";
  if (name) ctx.stack.push(name);
  try {
    return renderFrame(node, ctx, hooks);
  } catch (e) {
    if (e && typeof e === "object" && typeof (e as any).then !== "function" && !stacks.has(e)) stacks.set(e, stackText(ctx.stack));
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
    const sep = ctx.lastText ? "<!-- -->" : "";
    ctx.lastText = true;
    return sep + escape(text);
  }
  if (Array.isArray(node)) return node.map((n) => renderSibling(n, ctx, hooks)).join("");
  if (typeof node === "object" && typeof node[Symbol.iterator] === "function" && !node.$$typeof) return render([...node], ctx, hooks);
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
      try {
        const out = suspendAfter(ctx, () => render(props.children, ctx, hooks));
        if (parentDeps) for (const k of ["sheets", "styles"] as const) for (const x of deps[k]) parentDeps[k].add(x);
        return `<!--$-->${out}<!--/$-->`;
      } catch (e: any) {
        ctx.res.boundary = parentDeps;
        ctx.lastText = false;
        // Boundaries met inside it were never written: they go with this render.
        if (ctx.streaming) ctx.streaming.shared.boundaries.length = queued;
        const stream = ctx.streaming;
        if (e && typeof e.then === "function") {
          if (stream) {
            const id = stream.shared.next++;
            stream.shared.boundaries.push({ id, children: props.children, values: new Map(ctx.values), svg: ctx.svg, select: ctx.select, waiting: e, stack: ctx.stack.slice(), deps });
            return `<!--$?--><template id="B:${id}"></template>${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
          }
          ctx.waiting.push(e);
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
      return `<!--&-->${inner}<!--/&-->`;
    }
    return render(props.children, ctx, hooks);
  }
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      const c = type.contextType ? hooks.useContext(type.contextType) : undefined;
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
        (inst.UNSAFE_componentWillMount ?? inst.componentWillMount).call(inst);
      }
      return render(inst.render(), ctx, hooks);
    }
    return render(renderFunction(type, props), ctx, hooks);
  }
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
      return render(props.children(hooks.useContext(type._context)), ctx, hooks);
    case FORWARD_REF: {
      const { ref, ...rest } = props;
      return render(renderFunction(() => type.render(rest, ref ?? null), props), ctx, hooks);
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
  open += ">";
  if (VOID.has(tag) && tag !== "menuitem") {
    ctx.svg = svg;
    return open;
  }
  let inner: string;
  if (props.dangerouslySetInnerHTML?.__html != null) inner = props.dangerouslySetInnerHTML.__html;
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
    const sep = ctx.lastText ? "<!-- -->" : "";
    ctx.lastText = false;
    return sep;
  };
  switch (tag) {
    case "title": {
      if (inline) return undefined;
      if (!ctx.fallback) {
        const child = single(props.children);
        const text = child == null || typeof child === "function" || typeof child === "symbol" || typeof child === "boolean" ? "" : escape(String(child));
        r.hoistables.push(writeTag("title", { ...props, children: undefined }, props.dangerouslySetInnerHTML?.__html ?? text));
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
      if (!ctx.fallback) r.hoistables.push(writeTag("link", props));
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
        (typeof props.charSet === "string" ? r.charset : props.name === "viewport" ? r.viewport : r.hoistables).push(html);
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
  if (typeof s === "object" && s.integrity) out += ` integrity="${escape(s.integrity)}"`;
  if (typeof s === "object" && s.crossOrigin != null) out += ` crossorigin="${s.crossOrigin === "use-credentials" ? "use-credentials" : ""}"`;
  if (nonce) out += ` nonce="${escape(nonce)}"`;
  return out;
}
const importMap = (options: any) => (options.importMap ? `<script type="importmap">${scriptSafe(JSON.stringify(options.importMap))}</script>` : "");
/** The preloads of the bootstrap scripts and modules (written with the preamble; never preloaded again). */
function bootstrapPreloads(options: any, nonce: string | undefined, res: Resources) {
  let out = "";
  const src = (s: any) => (typeof s === "string" ? s : s.src);
  for (const s of options.bootstrapScripts ?? []) {
    res.script.set(src(s), null);
    res.module.set(src(s), null);
    out += `<link rel="preload" as="script" fetchpriority="low"${scriptAttrs(s, nonce).replace(" src=", " href=")}/>`;
  }
  for (const s of options.bootstrapModules ?? []) {
    res.script.set(src(s), null);
    res.module.set(src(s), null);
    out += `<link rel="modulepreload" fetchpriority="low"${scriptAttrs(s, nonce).replace(" src=", " href=")}/>`;
  }
  return out;
}
/** The bootstrap: its inline content, then its scripts and modules, each async. */
function bootstrap(options: any, nonce?: string) {
  const open = nonce ? `<script nonce="${escape(nonce)}">` : "<script>";
  let out = options.bootstrapScriptContent ? `${open}${scriptSafe(String(options.bootstrapScriptContent))}</script>` : "";
  for (const s of options.bootstrapScripts ?? []) out += `<script${scriptAttrs(s, nonce)} async=""></script>`;
  for (const s of options.bootstrapModules ?? []) out += `<script type="module"${scriptAttrs(s, nonce)} async=""></script>`;
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

export function renderToString(node: any, _options?: any) {
  const ctx = fresh();
  const html = once(node, ctx);
  return withPreamble(html, ctx.res.preamble("", ""));
}
export const renderToStaticMarkup = renderToString;

/** Rendered again until nothing it waits on is pending (each wait settles one more Suspense). */
async function complete(node: any) {
  for (let round = 0; ; round++) {
    const ctx = fresh();
    const html = once(node, ctx);
    if (!ctx.waiting.length || round > 50) return withPreamble(html, ctx.res.preamble("", ""));
    await Promise.allSettled(ctx.waiting);
  }
}

// `react-dom/static`: the whole page, once everything it waits on has settled.
export async function prerender(node: any, options: any = {}) {
  return { prelude: await renderToReadableStream(node, options), postponed: null };
}

export async function prerenderToNodeStream(node: any, _options: any = {}) {
  const html = await complete(node);
  const { Readable } = await import("node:stream" as string);
  return { prelude: Readable.from([html]), postponed: null };
}

// ---------------------------------------------------------------- streaming

/**
 * The swap a streamed boundary runs (sent once, before the first): its content, sent hidden, takes the place of
 * the fallback between the boundary's markers. `$SX` gives a boundary up to the client (it renders it itself).
 */
const RUNTIME_SOURCE =
  "<script>$SC=function(b,s){var t=document.getElementById(b),c=document.getElementById(s);if(!t||!c)return;var p=t.parentNode,n=t.nextSibling,d=0;while(n){if(n.nodeType===8){if(n.data==='/$'){if(d===0)break;d--}else if(n.data[0]==='$')d++}var x=n.nextSibling;p.removeChild(n);n=x}while(c.firstChild)p.insertBefore(c.firstChild,n);var m=t.previousSibling;if(m&&m.nodeType===8)m.data='$';c.remove();t.remove();if(m&&m._reactRetry)m._reactRetry()};$SX=function(b,g,m,k){var t=document.getElementById(b);if(!t)return;if(g)t.dataset.dgst=g;if(m)t.dataset.msg=m;if(k)t.dataset.cstck=k;var m=t.previousSibling;if(m&&m.nodeType===8){m.data='$!';if(m._reactRetry)m._reactRetry()}};$SM=new Map;$SR=function(n,w,p){function u(q){this._p=null;q()}for(var r=new Map,t=document,h,b,e=t.querySelectorAll(\"link[data-precedence],style[data-precedence]\"),v=[],k=0;b=e[k++];)\"not all\"===b.getAttribute(\"media\")?v.push(b):(\"LINK\"===b.tagName&&$SM.set(b.getAttribute(\"href\"),b),r.set(b.dataset.precedence,h=b));e=0;b=[];var l,a;for(k=!0;;){if(k){var f=p[e++];if(!f){k=!1;e=0;continue}var c=!1,m=0;var d=f[m++];if(a=$SM.get(d)){var g=a._p;c=!0}else{a=t.createElement(\"link\");a.href=d;a.rel=\"stylesheet\";for(a.dataset.precedence=l=f[m++];g=f[m++];)a.setAttribute(g,f[m++]);g=a._p=new Promise(function(q,x){a.onload=u.bind(a,q);a.onerror=u.bind(a,x)});$SM.set(d,a)}d=a.getAttribute(\"media\");!g||d&&!matchMedia(d).matches||b.push(g);if(c)continue}else{a=v[e++];if(!a)break;l=a.getAttribute(\"data-precedence\");a.removeAttribute(\"media\")}c=r.get(l)||h;c===h&&(h=a);r.set(l,a);c?c.parentNode.insertBefore(a,c.nextSibling):(c=t.head,c.insertBefore(a,c.firstChild))}if(p=document.getElementById(n))p.previousSibling.data=\"$~\";Promise.all(b).then($SC.bind(null,n,w),$SX.bind(null,n,\"CSS failed to load\"))};</script>";

/** A value written into an inline script, as React escapes it (no "<", "&", ">" or line separators raw). */
const jsArg = (v: unknown) => JSON.stringify(v).replace(/[&><\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

type Boundary = { id: number; children: any; values: Map<any, any>; svg: boolean; select: any; waiting: PromiseLike<any>; stack: string[]; deps?: { sheets: Set<any>; styles: Set<any> } };

/** One streamed render: the shell, then each boundary as it settles, written through `write`. */
function startStream(node: any, options: any, write: (chunk: string) => void, finish: () => void) {
  const shared = { ids: 0, boundaries: [] as Boundary[], next: 0 };
  const res = new Resources(writeTag, typeof options.nonce === "object" ? options.nonce?.style : undefined);
  const pending = new Set<Boundary>();
  let runtimeSent = false;
  let closed = false;
  const nonce: string | undefined = typeof options.nonce === "string" ? options.nonce : options.nonce?.script;
  const scriptOpen = nonce ? `<script nonce="${escape(nonce)}">` : "<script>";
  const RUNTIME = RUNTIME_SOURCE.replace("<script>", scriptOpen);
  const onError = (e: unknown) => options.onError?.(e, { componentStack: componentStackOf(e) });
  // The digest and (in development) the message, as script arguments.
  const sxArgs = (digest: unknown, message: string, error?: unknown) =>
    [typeof digest === "string" ? digest : "", dev() ? message : "", dev() && error ? componentStackOf(error) : ""].map((v) => "," + JSON.stringify(v).replace(/</g, "\\u003c")).join("");
  const ctxFor = (b?: Boundary): Ctx => ({
    ...fresh(res),
    values: b ? new Map(b.values) : new Map(),
    svg: b?.svg ?? false,
    select: b?.select,
    stack: b ? b.stack.slice() : [],
    streaming: { shared, onError },
  });
  const close = () => {
    if (closed) return;
    closed = true;
    options.onAllReady?.();
    finish();
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
    // Its stylesheets and style rules, kept across its renders (each retry meets what the last one did).
    const deps = (b.deps ??= { sheets: new Set<any>(), styles: new Set<any>() });
    res.boundary = deps;
    const queued = shared.boundaries.length;
    try {
      inner = once(b.children, ctx);
    } catch (e: any) {
      res.boundary = null;
      if (e && typeof e.then === "function") {
        // Still waiting on something else: the boundary waits again; what it found so far is preloaded now,
        // as React flushes the resources of the parts that have rendered.
        b.waiting = e;
        shared.boundaries.length = queued;
        shared.boundaries.push(b);
        const early = res.late() + res.lateStyleTags(deps);
        if (early) write(early);
        return watch();
      }
      const digest = onError(e);
      write(`${res.late()}${runtimeSent ? "" : RUNTIME}${scriptOpen}$SX("B:${b.id}"${sxArgs(digest, errored(e), e)})</script>`);
      runtimeSent = true;
      return watch();
    }
    res.boundary = null;
    const late = res.late();
    const { styleTags, sheets } = res.boundaryStyles(deps);
    // With stylesheets (or style rules) of its own, the boundary is revealed once they have loaded ($SR).
    const hoist = res.stylesToHoist;
    res.stylesToHoist = false;
    const reveal =
      hoist || sheets.length
        ? `$SR("B:${b.id}","S:${b.id}",${jsArg(sheets.map((s) => (s[1] === "" ? [s[0]] : [s[0], s[1], ...Object.entries(s[2]).flat()])))})`
        : `$SC("B:${b.id}","S:${b.id}")`;
    write(`${late}${runtimeSent ? "" : RUNTIME}<div hidden id="S:${b.id}">${inner}</div>${styleTags}${scriptOpen}${reveal}</script>`);
    runtimeSent = true;
    watch();
  };
  let shell: string;
  try {
    shell = once(node, ctxFor());
  } catch (e) {
    onError(e);
    options.onShellError?.(e);
    closed = true;
    return { abort() {}, failed: e };
  }
  // The preamble (an import map, the bootstrap scripts' preloads) in the shell's <head>, or before the shell; the
  // bootstrap scripts after it, as React writes them.
  const shellWithPreamble = withPreamble(shell, res.preamble(importMap(options), bootstrapPreloads(options, nonce, res)));
  // React's mark of the first paint, which its reveal timing reads: only while boundaries are still to come.
  const paint = !shared.boundaries.length ? "" : `${scriptOpen}requestAnimationFrame(function(){$RT=performance.now()});</script>`;
  write(shellWithPreamble + paint + bootstrap(options, nonce));
  options.onShellReady?.();
  watch();
  return {
    failed: null,
    /** Stop waiting: what is still pending is left for the client to render. */
    abort(reason?: unknown) {
      if (closed) return;
      for (const b of pending) {
        const why = reason ?? new Error("The render was aborted by the server without a reason.");
        const digest = onError(why);
        write(`${runtimeSent ? "" : RUNTIME}${scriptOpen}$SX("B:${b.id}"${sxArgs(digest, aborted((why as any)?.message ?? String(why)))})</script>`);
        runtimeSent = true;
      }
      pending.clear();
      close();
    },
  };
}

export function renderToPipeableStream(node: any, options: any = {}) {
  const chunks: string[] = [];
  let out: any = null;
  let ended = false;
  const write = (c: string) => (out ? out.write(c) : chunks.push(c));
  const finish = () => (out ? out.end?.() : (ended = true));
  let run: ReturnType<typeof startStream> | null = null;
  // Started on the next turn, as React starts its work: the caller has its pipe ready by then.
  setImmediateOr(() => (run = startStream(node, options, write, finish)));
  return {
    pipe(w: any) {
      out = w;
      for (const c of chunks.splice(0)) w.write(c);
      if (ended) w.end?.();
      return w;
    },
    abort(reason?: unknown) {
      run?.abort(reason);
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

const setImmediateOr = (fn: () => void) => ((globalThis as any).setImmediate ? (globalThis as any).setImmediate(fn) : setTimeout(fn, 0));

export const version = "19.3.0";

// The module as one object too: `import ReactDOMServer from "react-dom/server"`.
export default { renderToString, renderToStaticMarkup, renderToReadableStream, renderToPipeableStream, prerender, prerenderToNodeStream, version };
