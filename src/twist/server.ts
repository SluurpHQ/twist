// Twist's server runtime (`@solidjs/web` on a server): JSX makes descriptions, rendered to HTML top-down so hydration
// keys are taken in document order, as the client claims them. A template's root element takes a key; elements nested
// in the same template do not; elements made at run time (dynamic tags, spreads into ssrElement) do.
import { createRoot, getNextChildId, getOwner, NotReadyError, sharedConfig, untrack } from "./signals.ts";
import { merge, omit, isStatic } from "./flow.ts";
import { componentProps, createComponent, isChildren, isDynamic } from "./control.ts";

export * from "./server-solid.ts";
export * from "./control.ts";
export { merge, omit, isStatic, merge as mergeProps };
export const isServer = true;

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
    let out = "";
    for (const x of v) out += html(x, inTemplate);
    return out;
  }
  if (typeof v === "function") return html(v(), false);
  if (v[EL]) return element(v, !inTemplate || v.keyed);
  if (v[COMP]) return html(createComponent(v.fn, componentProps(v.props)), false);
  if (typeof v.t === "string") return v.t;
  return escape(String(v));
}

function element(el: Element_, keyed: boolean): string {
  const { tag, props } = el;
  let out = "<" + tag + (keyed ? ssrHydrationKey() : "");
  const all = expandSpreads(props);
  for (const k of Object.keys(all)) {
    if (k === "children" || k === "ref" || /^on[A-Z]/.test(k)) continue;
    out += ssrAttribute(k, read(all[k]));
  }
  if (VOID.has(tag)) return out + "/>";
  out += ">";
  if ("children" in all) out += children(all.children);
  return out + "</" + tag + ">";
}

/** An element's children: elements written here are in its template; anything else is a hole. */
function children(c: any): string {
  if (Array.isArray(c)) {
    let out = "";
    for (const x of c) out += children(x);
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

// ---------------------------------------------------------------- render entry points

export function renderToString(code: () => any, options: { renderId?: string; noHydrate?: boolean } = {}): string {
  const was = sharedConfig.context;
  sharedConfig.context = options.noHydrate ? null : { id: options.renderId ?? "" };
  try {
    return createRoot(
      (dispose) => {
        try {
          return html(code(), false);
        } finally {
          dispose();
        }
      },
      { id: options.renderId ?? "" },
    );
  } finally {
    sharedConfig.context = was;
  }
}

export { NotReadyError, untrack, isChildren };
