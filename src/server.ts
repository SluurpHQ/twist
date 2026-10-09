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
  if (Array.isArray(node)) return node.map((n) => render(n, ctx, hooks)).join("");
  if (typeof node === "object" && typeof node[Symbol.iterator] === "function" && !node.$$typeof) return render([...node], ctx, hooks);
  if (node.$$typeof === PORTAL) return "";
  if (node.$$typeof !== ELEMENT) throw objectChild(node);
  const { type, props } = node;
  if (typeof type === "string") return host(type, props, ctx, hooks);
  if (typeof type === "symbol") {
    if (type === SUSPENSE) {
      // Between markers, so the client finds the boundary: complete ($), pending ($?), or left to the client ($!).
      try {
        return `<!--$-->${render(props.children, ctx, hooks)}<!--/$-->`;
      } catch (e: any) {
        ctx.lastText = false;
        const stream = ctx.streaming;
        if (e && typeof e.then === "function") {
          if (stream) {
            const id = stream.shared.next++;
            stream.shared.boundaries.push({ id, children: props.children, values: new Map(ctx.values), svg: ctx.svg, select: ctx.select, waiting: e, stack: ctx.stack.slice() });
            return `<!--$?--><template id="B:${id}"></template>${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
          }
          ctx.waiting.push(e);
          return `<!--$!-->${errorTemplate(undefined, aborted(RENDER_TO_STRING_SUSPENSE))}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
        }
        if (!stream) throw e;
        // An error inside a boundary: its fallback now, the client renders it again (React's behaviour).
        const digest = stream.onError(e);
        return `<!--$!-->${errorTemplate(digest, errored(e), e)}${fallbackFrame(ctx, () => render(props.fallback, ctx, hooks))}<!--/$-->`;
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
    inner = render(props.children, ctx, hooks);
  }
  ctx.svg = svg;
  ctx.lastText = false;
  return `${open}${inner}</${tag}>`;
}

function once(node: any, ctx: Ctx) {
  const hooks = serverHooks(ctx);
  return withHooks(hooks, () => render(node, ctx, hooks));
}

const fresh = (): Ctx => ({ values: new Map(), ids: 0, waiting: [], svg: false, select: undefined, lastText: false, stack: [] });

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
/** The import map and the preloads of the bootstrap scripts and modules (React's preamble resources). */
function preamble(options: any, nonce?: string) {
  let out = "";
  if (options.importMap) out += `<script type="importmap">${scriptSafe(JSON.stringify(options.importMap))}</script>`;
  for (const s of options.bootstrapScripts ?? []) out += `<link rel="preload" as="script" fetchpriority="low"${scriptAttrs(s, nonce).replace(" src=", " href=")}/>`;
  for (const s of options.bootstrapModules ?? []) out += `<link rel="modulepreload" fetchpriority="low"${scriptAttrs(s, nonce).replace(" src=", " href=")}/>`;
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
  if (was === "Suspense") ctx.stack[i] = "Suspense Fallback";
  try {
    return fn();
  } finally {
    if (was === "Suspense") ctx.stack[i] = was;
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
  return once(node, fresh());
}
export const renderToStaticMarkup = renderToString;

/** Rendered again until nothing it waits on is pending (each wait settles one more Suspense). */
async function complete(node: any) {
  for (let round = 0; ; round++) {
    const ctx = fresh();
    const html = once(node, ctx);
    if (!ctx.waiting.length || round > 50) return html;
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
  "<script>$SC=function(b,s){var t=document.getElementById(b),c=document.getElementById(s);if(!t||!c)return;var p=t.parentNode,n=t.nextSibling,d=0;while(n){if(n.nodeType===8){if(n.data==='/$'){if(d===0)break;d--}else if(n.data[0]==='$')d++}var x=n.nextSibling;p.removeChild(n);n=x}while(c.firstChild)p.insertBefore(c.firstChild,n);var m=t.previousSibling;if(m&&m.nodeType===8)m.data='$';c.remove();t.remove();if(m&&m._reactRetry)m._reactRetry()};$SX=function(b,g,m,k){var t=document.getElementById(b);if(!t)return;if(g)t.dataset.dgst=g;if(m)t.dataset.msg=m;if(k)t.dataset.cstck=k;var m=t.previousSibling;if(m&&m.nodeType===8){m.data='$!';if(m._reactRetry)m._reactRetry()}}</script>";

type Boundary = { id: number; children: any; values: Map<any, any>; svg: boolean; select: any; waiting: PromiseLike<any>; stack: string[] };

/** One streamed render: the shell, then each boundary as it settles, written through `write`. */
function startStream(node: any, options: any, write: (chunk: string) => void, finish: () => void) {
  const shared = { ids: 0, boundaries: [] as Boundary[], next: 0 };
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
    ...fresh(),
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
    try {
      inner = once(b.children, ctx);
    } catch (e: any) {
      if (e && typeof e.then === "function") {
        // Still waiting on something else: the boundary waits again.
        b.waiting = e;
        shared.boundaries.push(b);
        return watch();
      }
      const digest = onError(e);
      write(`${runtimeSent ? "" : RUNTIME}${scriptOpen}$SX("B:${b.id}"${sxArgs(digest, errored(e), e)})</script>`);
      runtimeSent = true;
      return watch();
    }
    write(`${runtimeSent ? "" : RUNTIME}<div hidden id="S:${b.id}">${inner}</div>${scriptOpen}$SC("B:${b.id}","S:${b.id}")</script>`);
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
  const headAt = /<head(?:\s[^>]*)?>/.exec(shell);
  const pre = preamble(options, nonce);
  const shellWithPreamble = headAt ? shell.slice(0, headAt.index + headAt[0].length) + pre + shell.slice(headAt.index + headAt[0].length) : pre + shell;
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
