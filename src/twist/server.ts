// Twist's server runtime (`@solidjs/web` on a server): JSX makes descriptions, rendered to HTML top-down so hydration
// keys are taken in document order, as the client claims them. A template's root element takes a key; elements nested
// in the same template do not; elements made at run time (dynamic tags, spreads into ssrElement) do.
import { createMemo, createOwner, createRoot, getNextChildId, getOwner, NotReadyError, resetOwner, runWithOwner, settlesOf, setServerRender, sharedConfig, untrack } from "./signals.ts";
import { merge, omit, isStatic } from "./flow.ts";
import { componentProps, createComponent, isChildren, isDynamic } from "./control.ts";

export * from "./server-solid.ts";
export * from "./control.ts";
export { merge, omit, isStatic, merge as mergeProps };
export const isServer = true;
setServerRender(true);

// ---------------------------------------------------------------- descriptions

const EL = Symbol("twist.ssr.element");
const COMP = Symbol("twist.ssr.component");

type Element_ = { [EL]: true; tag: string; props: Record<string, any>; keyed?: boolean };
type Component_ = { [COMP]: true; fn: (props: any) => any; props: Record<string, any> };

export const Fragment = (props: { children?: unknown }) => props.children;

export function jsx(type: any, props: Record<string, any>): any {
  if (type === Fragment) return props.children;
  if (typeof type === "function") return { [COMP]: true, fn: type, props } as Component_;
  return { [EL]: true, tag: type, props } as Element_;
}
export { jsx as jsxs, jsx as jsxDEV };

/** An element made at run time (a dynamic tag): it always takes a key of its own. */
export function ssrElement(tag: string, props: any, children?: any, _needsId?: boolean) {
  const p = typeof props === "function" ? props() : { ...props };
  if (children !== undefined) p.children = children;
  return { [EL]: true, tag, props: p, keyed: true } as Element_;
}

/**
 * A component whose tag or component comes from `source`. Its element is made at run time, so it takes a key; the
 * memo path renders it under a memo of its own (as the client does), the static path under the caller.
 */
export function dynamic<P>(source: () => any, options?: { static?: boolean }): (props: P) => any {
  const which = options?.static ? ((v) => () => v)(untrack(source)) : createMemo(source);
  const make = (w: any, props: any) => (typeof w === "string" ? ssrElement(w, props) : typeof w === "function" ? createComponent(w, props) : undefined);
  return (props: any) => (options?.static ? make(which(), props) : createMemo(() => ({ t: html(make(which(), props), false) })));
}

// ---------------------------------------------------------------- hydration keys

/** The next hydration key, while a hydratable render runs (none under NoHydration). */
export function getHydrationKey(): string | undefined {
  const o = getOwner();
  if (!(sharedConfig.context as any) || !o || (o as any).id == null || noHydration > 0) return undefined;
  return getNextChildId(o);
}

export function ssrHydrationKey() {
  const hk = getHydrationKey();
  return hk ? ` _hk=${hk}` : "";
}

let noHydration = 0;

/** Its children render with no hydration keys (they will not be hydrated). */
export function NoHydration(props: { children?: any }) {
  noHydration++;
  try {
    return { t: html(props.children, false) };
  } finally {
    noHydration--;
  }
}

/** Its children hydrate (inside NoHydration). */
export function Hydration(props: { children?: any }) {
  const was = noHydration;
  noHydration = 0;
  try {
    return { t: html(props.children, false) };
  } finally {
    noHydration = was;
  }
}

// ---------------------------------------------------------------- escaping

const CONTENT = /[<&]/;
const ATTR = /[&"]/;

/** Text for HTML: `<` and `&` in content, `&` and `"` in an attribute. */
export function escape(s: any, attr?: boolean): any {
  if (typeof s !== "string") {
    if (attr) return s == null || typeof s === "boolean" || typeof s === "number" ? s : escape(String(s), true);
    if (Array.isArray(s)) return s.map((x) => escape(x));
    if (typeof s === "function") {
      const w = () => escape(s());
      (w as any).$esc = true;
      return s.$esc ? s : w;
    }
    return s;
  }
  if (!(attr ? ATTR : CONTENT).test(s)) return s;
  let out = "";
  for (const c of s) out += c === "&" ? "&amp;" : c === "<" && !attr ? "&lt;" : c === '"' && attr ? "&quot;" : c;
  return out;
}

// ---------------------------------------------------------------- rendering

const VOID = new Set("area,base,br,col,embed,hr,img,input,keygen,link,meta,param,source,track,wbr".split(","));
/** Attributes whose presence is the value. */
const BOOLEAN = new Set(
  "allowfullscreen,async,autofocus,autoplay,checked,controls,default,disabled,formnovalidate,hidden,indeterminate,inert,ismap,loop,multiple,muted,nomodule,novalidate,open,playsinline,readonly,required,reversed,seamless,selected".split(","),
);

/** What `v` renders to: elements, components, text and holes, in document order. */
export function html(v: any, inTemplate: boolean): string {
  if (v == null || typeof v === "boolean") return "";
  if (typeof v === "string") return escape(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    // Flattened as the client flattens it: text next to text becomes two text nodes there, so a separator marks the
    // split here (what each item resolves to decides, not its kind).
    let out = "";
    let text = false;
    for (const x of flat(v)) {
      const isText = typeof x === "string" || typeof x === "number";
      if (isText && text) out += SEP;
      out += html(x, inTemplate);
      text = isText;
    }
    return out;
  }
  if (typeof v === "function") return html(v(), false);
  if (v[EL]) return element(v, !inTemplate || v.keyed);
  if (v[COMP]) return html(createComponent(v.fn, componentProps(v.props)), false);
  if (typeof v.t === "string") return v.t;
  return escape(String(v));
}

const NONE_CHOSEN = Symbol("none");
/** The value of the select being rendered: its options compare against it. */
let selecting: unknown = NONE_CHOSEN;

const SEP = "<!--!$-->";

/** An array's items as the client sees them: nested arrays and functions resolved, nothing, true and false dropped. */
function flat(v: any[], out: any[] = []): any[] {
  for (let x of v) {
    while (typeof x === "function") x = x();
    if (Array.isArray(x)) flat(x, out);
    else if (x != null && typeof x !== "boolean") out.push(x);
  }
  return out;
}

/** An element's children flattened: nested arrays opened, nothing, true and false dropped (functions stay holes). */
function flatChildren(v: any[], out: any[] = []): any[] {
  for (const x of v) {
    if (Array.isArray(x)) flatChildren(x, out);
    else if (x != null && typeof x !== "boolean") out.push(x);
  }
  return out;
}

function element(el: Element_, keyed: boolean): string {
  const { tag, props } = el;
  let out = "<" + tag + (keyed ? ssrHydrationKey() : "");
  const all = expandSpreads(props);
  // A select's value is no attribute: the matching option is marked selected.
  const chosen = tag === "select" && "value" in all ? read(all.value) : NONE_CHOSEN;
  for (const k of Object.keys(all)) {
    if (k === "children" || k === "ref" || /^on[A-Z]/.test(k) || (k === "value" && chosen !== NONE_CHOSEN)) continue;
    out += ssrAttribute(k, read(all[k]));
  }
  if (tag === "option" && selecting !== NONE_CHOSEN && !("selected" in all)) {
    const v = String(read(all.value) ?? "");
    if (Array.isArray(selecting) ? selecting.map(String).includes(v) : String(selecting ?? "") === v) out += " selected";
  }
  if (VOID.has(tag)) return out + "/>";
  out += ">";
  const was = selecting;
  if (chosen !== NONE_CHOSEN) selecting = chosen;
  try {
    if ("children" in all) out += children(all.children);
  } finally {
    selecting = was;
  }
  return out + "</" + tag + ">";
}

/** An element's children: elements written here are in its template; anything else is a hole. */
function children(c: any): string {
  if (Array.isArray(c)) {
    let out = "";
    let text = false;
    for (const x of flatChildren(c)) {
      const isText = typeof x === "string" || typeof x === "number";
      if (isText && text) out += SEP;
      out += children(x);
      text = isText;
    }
    return out;
  }
  if (c && c[EL]) return element(c, !!c.keyed);
  return html(c, false);
}

const read = (v: any) => (isDynamic(v) ? v() : v);

/** Props with their spreads applied, in order. */
function expandSpreads(props: Record<string, any>) {
  if (!Object.keys(props).some((k) => k.startsWith("$spread$"))) return props;
  const out: Record<string, any> = {};
  for (const k of Object.keys(props)) {
    if (k.startsWith("$spread$")) Object.assign(out, props[k]());
    else out[k] = props[k];
  }
  return out;
}

/** One attribute: ` name="value"`, a bare name when true, nothing when absent. */
export function ssrAttribute(name: string, value: any): string {
  if (name === "class") value = ssrClassName(value);
  else if (name === "style") value = ssrStyle(value);
  if (value == null || value === false) return "";
  if (value === true) return " " + name;
  if (value === "" && name !== "class" && name !== "style") return " " + name;
  if (BOOLEAN.has(name.toLowerCase())) return value ? " " + name : "";
  return ` ${name}="${escape(String(value), true)}"`;
}

export function ssrClassName(value: any): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(ssrClassName).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.keys(value).filter((k) => value[k]).join(" ");
  return String(value);
}

export function ssrStyle(value: any): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  let out = "";
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (v == null || v === false) continue;
    out += (out ? ";" : "") + k + ":" + v;
  }
  return out;
}

// ---------------------------------------------------------------- Loading and streaming

/** A render in progress: whether it can wait (a stream), and the boundaries still waiting. */
type Render = {
  async: boolean;
  waiting: Set<Promise<void>>;
  /** Chunks after the shell: revealed boundaries, in the order they settled. */
  chunks: string[];
  wake: (() => void) | null;
  revealScript: boolean;
};
let render: Render | null = null;

/**
 * Its children, or its fallback while something under it is not ready. In a stream the fallback is sent first, between
 * markers the client's reveal script finds; the children follow in a template once what they wait on lands.
 */
export function Loading(props: { fallback?: any; children?: any }) {
  const parent = getOwner();
  const boundary = createOwner(parent);
  const id = (boundary as any).id as string | undefined;
  try {
    return { t: runWithOwner(boundary, () => html(props.children, false)) };
  } catch (e) {
    if (!(e instanceof NotReadyError)) throw e;
    const fallback = runWithOwner(parent, () => html(props.fallback, false));
    const r = render;
    const waits = settlesOf(e);
    if (!r || !r.async || !waits || id == null) return { t: fallback };
    const retry = (p: Promise<void>) => {
      r.waiting.add(p);
      p.then(() => {
        r.waiting.delete(p);
        resetOwner(boundary);
        try {
          const content = runWithOwner(boundary, () => html(props.children, false));
          r.chunks.push(`<template id="${id}">${content}</template>` + script(r, `$df("${id}")`));
        } catch (e2) {
          const next = e2 instanceof NotReadyError && settlesOf(e2);
          if (!next) throw e2;
          retry(next);
        }
        r.wake?.();
      });
    };
    retry(waits);
    return { t: `<template id="pl-${id}"></template>${fallback}<!--pl-${id}-->` };
  }
}

/** Swaps a streamed template in for the fallback before it (written for Twist, not taken from Solid). */
const REVEAL = `function $df(e,t,p,n){if(!(t=document.getElementById(e))||!(p=document.getElementById("pl-"+e)))return;for(n=p.nextSibling;n&&!(n.nodeType===8&&n.nodeValue==="pl-"+e);){var x=n.nextSibling;n.remove();n=x}n&&n.replaceWith(t.content);p.remove();t.remove();_$HY.fe&&_$HY.fe(e)}`;

function script(r: Render, code: string) {
  const s = r.revealScript ? code : REVEAL + ";" + code;
  r.revealScript = true;
  return `<script>${s}</script>`;
}

// ---------------------------------------------------------------- render entry points

function rendering<T>(r: Render | null, options: { renderId?: string; noHydrate?: boolean }, fn: () => T): T {
  const was = sharedConfig.context;
  const wasRender = render;
  sharedConfig.context = options.noHydrate ? null : { id: options.renderId ?? "" };
  render = r;
  try {
    return fn();
  } finally {
    sharedConfig.context = was;
    render = wasRender;
  }
}

export function renderToString(code: () => any, options: { renderId?: string; noHydrate?: boolean } = {}): string {
  return rendering(null, options, () =>
    createRoot(
      (dispose) => {
        try {
          return html(code(), false);
        } finally {
          dispose();
        }
      },
      { id: options.renderId ?? "" },
    ),
  );
}

type Writable = { write(chunk: string): void; end(): void };

/** The shell at once, then each boundary as it settles; awaited, the whole document. */
export function renderToStream(code: () => any, options: { renderId?: string; noHydrate?: boolean; onCompleteShell?: () => void; onCompleteAll?: () => void } = {}) {
  const r: Render = { async: true, waiting: new Set(), chunks: [], wake: null, revealScript: false };
  let dispose!: () => void;
  let root!: any;
  // The shell: rendered again (from the same ids) while something outside every Loading is not ready.
  const shellReady = new Promise<string>((ok, fail) => {
    const attempt = () => {
      try {
        ok(rendering(r, options, () => runWithOwner(root, () => html(code(), false))));
      } catch (e) {
        const waits = e instanceof NotReadyError && settlesOf(e);
        if (!waits) return fail(e);
        waits.then(() => (resetOwner(root), attempt()));
      }
    };
    createRoot(
      (d) => {
        dispose = d;
        root = getOwner();
      },
      { id: options.renderId ?? "" },
    );
    attempt();
  });
  let shell = "";
  const sinks: Writable[] = [];
  let sent = 0;
  let done = false;
  const drain = () => {
    for (; sent < r.chunks.length; sent++) for (const w of sinks) w.write(r.chunks[sent]!);
    if (!r.waiting.size && !done) {
      done = true;
      options.onCompleteAll?.();
      dispose();
      for (const w of sinks) w.end();
      finished();
    }
  };
  let finished!: () => void;
  const all = new Promise<void>((ok) => (finished = ok));
  let shellSent = false;
  r.wake = () => queueMicrotask(() => shellSent && rendering(r, options, drain));
  const failed = shellReady.then(
    (s) => {
      shell = s;
      shellSent = true;
      for (const w of sinks) w.write(shell);
      options.onCompleteShell?.();
      rendering(r, options, drain);
    },
    (e) => {
      dispose();
      throw e;
    },
  );
  return {
    then<A, B>(ok?: (html: string) => A, fail?: (e: unknown) => B) {
      return failed.then(() => all).then(() => shell + r.chunks.join("")).then(ok, fail);
    },
    pipe(w: Writable) {
      if (shellSent) w.write(shell);
      for (let i = 0; i < sent; i++) w.write(r.chunks[i]!);
      sinks.push(w);
      if (done) w.end();
    },
    pipeTo(ws: WritableStream<any>) {
      const writer = ws.getWriter();
      const enc = new TextEncoder();
      return new Promise<void>((ok) => this.pipe({ write: (c) => void writer.write(enc.encode(c)), end: () => void writer.close().then(ok) }));
    },
  };
}

export { NotReadyError, untrack, isChildren };
