// Rendering to HTML, on the server or anywhere without a DOM: the same elements and components, hooks answering
// with their first values. Suspense shows its fallback in renderToString; the streams wait for what it waits on.
import { CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, SUSPENSE, createElement } from "./element.ts";
import { client } from "./core.ts";
import { withHooks } from "./hooks.ts";
import { VOID_TAGS, assertValidProps, attribute, checkTagName } from "./attributes.ts";

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const UNITLESS = new Set("animationIterationCount aspectRatio columnCount flex flexGrow flexShrink fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth gridRow gridColumn gridArea".split(" "));
const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "innerHTML"]);

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);

function style(s: any) {
  if (typeof s === "string") return s;
  let out = "";
  for (const k in s) {
    const v = s[k];
    if (v == null || typeof v === "boolean" || v === "") continue;
    const name = k.startsWith("--") ? k : k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).replace(/^ms-/, "-ms-");
    out += `${out ? ";" : ""}${name}:${typeof v === "number" && v !== 0 && !UNITLESS.has(k) && !k.startsWith("--") ? v + "px" : String(v).trim()}`;
  }
  return out;
}

type Ctx = { values: Map<any, any>; ids: number; waiting: Promise<any>[]; svg: boolean; select: any };

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
      if (tag === "input" && props.value == null && v != null) put("value", String(v));
      continue;
    }
    if (k === "defaultChecked") {
      if (v && props.checked == null) put("checked", "");
      continue;
    }
    if (k === "value") {
      if (tag !== "textarea" && tag !== "select" && v != null && typeof v !== "function" && typeof v !== "symbol") put("value", String(v));
      continue;
    }
    if (k === "checked" || k === "selected" || k === "muted") {
      if (v && typeof v !== "function" && typeof v !== "symbol") put(k, "");
      continue;
    }
    if (k === "autoFocus") continue;
    if ((k === "action" || k === "formAction") && typeof v === "function") continue;
    const a = attribute(tag, k, v, ctx.svg);
    if (a) put(a[0], a[1]);
  }
  return out;
}

const NOOP = () => {};

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
    useState: (init: any) => [typeof init === "function" ? init() : init, NOOP],
    useReducer: (_r: any, a: any, i?: any) => [i ? i(a) : a, NOOP],
    useRef: (v: any) => ({ current: v }),
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useEffect: NOOP,
    useLayoutEffect: NOOP,
    useInsertionEffect: NOOP,
    useImperativeHandle: NOOP,
    useContext: read,
    useId: () => `_r_${(ctx.ids++).toString(32)}_`,
    useSyncExternalStore: (_s: any, get: any, getServer?: any) => (getServer ?? get)(),
    useTransition: () => [false, (fn: any) => fn()],
    useDeferredValue: (v: any) => v,
    useActionState: (_a: any, init: any) => [init, NOOP, false],
    useOptimistic: (s: any) => [s, NOOP],
    useEffectEvent: (fn: any) => fn,
    use: (u: any) => (u && u.$$typeof === CONTEXT ? read(u) : readThenable(u)),
  } as any;
}

function render(node: any, ctx: Ctx, hooks: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return escape(node);
  if (typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map((n) => render(n, ctx, hooks)).join("");
  if (typeof node === "object" && typeof node[Symbol.iterator] === "function" && !node.$$typeof) return render([...node], ctx, hooks);
  if (node.$$typeof === PORTAL) return "";
  if (node.$$typeof !== ELEMENT) throw new Error("Objects are not valid as a React child");
  const { type, props } = node;
  if (typeof type === "string") return host(type, props, ctx, hooks);
  if (typeof type === "symbol") {
    if (type === SUSPENSE) {
      try {
        return render(props.children, ctx, hooks);
      } catch (e: any) {
        if (e && typeof e.then === "function") {
          ctx.waiting.push(e);
          return render(props.fallback, ctx, hooks);
        }
        throw e;
      }
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
      return render(inst.render(), ctx, hooks);
    }
    return render(type(props), ctx, hooks);
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
      return render(type.render(rest, ref ?? null), ctx, hooks);
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
  throw new Error("Element type is invalid");
}

function host(tag: string, props: any, ctx: Ctx, hooks: any): string {
  checkTagName(tag);
  assertValidProps(tag, props);
  const svg = ctx.svg;
  if (tag === "svg") ctx.svg = true;
  // A whole document: React writes its doctype first.
  let open = `${tag === "html" ? "<!DOCTYPE html>" : ""}<${tag}${attrs(props, ctx, tag)}`;
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
  return `${open}${inner}</${tag}>`;
}

function once(node: any, ctx: Ctx) {
  const hooks = serverHooks(ctx);
  return withHooks(hooks, () => render(node, ctx, hooks));
}

const fresh = (): Ctx => ({ values: new Map(), ids: 0, waiting: [], svg: false, select: undefined });

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

export async function renderToReadableStream(node: any, options: any = {}) {
  const html = await complete(node);
  const text = (options.bootstrapScriptContent ? `<script>${options.bootstrapScriptContent}</script>` : "") + html +
    (options.bootstrapModules ?? []).map((s: string) => `<script type="module" src="${escape(s)}"></script>`).join("") +
    (options.bootstrapScripts ?? []).map((s: string) => `<script src="${escape(s)}" async></script>`).join("");
  const body = new TextEncoder().encode(text);
  const stream: any = new ReadableStream({
    start(c) {
      c.enqueue(body);
      c.close();
    },
  });
  stream.allReady = Promise.resolve();
  return stream;
}

export function renderToPipeableStream(node: any, options: any = {}) {
  const done = complete(node);
  done.then(() => options.onShellReady?.(), (e) => options.onShellError?.(e));
  done.then(() => options.onAllReady?.());
  return {
    pipe(w: any) {
      done.then((html) => (w.write(html), w.end?.()));
      return w;
    },
    abort() {},
  };
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

export const version = "19.3.0";
