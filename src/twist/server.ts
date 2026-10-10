// Twist's server runtime (`@solidjs/web` on a server): JSX makes descriptions, rendered to HTML top-down so hydration
// keys are taken in document order, as the client claims them. A template's root element takes a key; elements nested
// in the same template do not; elements made at run time (dynamic tags, spreads into ssrElement) do.
import { childIdCount, setChildIdCount, createMemo, createOwner, ownerUnder, createRoot, getNextChildId, getOwner, NotReadyError, resetOwner, runWithOwner, settlesOf, holdsShell, setServerAnswers, setServerFly, setServerRender, sharedConfig, untrack } from "./signals.ts";
import { merge, omit, isStatic } from "./flow.ts";
import { headerScript, hydrationSerializer } from "./serialize.ts";
import { createHydrationSerializer } from "./serialization.ts";
import { __twist_mark, markBuiltin, callComponent, componentProps, createComponent, isChildren, isDynamic, setDescribedNode } from "./control.ts";

export * from "./server-solid.ts";
export * from "./control.ts";
export * from "./response.ts";
export { CLAIMS_STREAM, CLAIMS_DOCUMENT, SLOT_VALUE, SLOT_MARKER, SLOT_FACE_STREAM, SLOT_FACE_DATA, SLOT_FACE_MARKUP, slotValue, isSlotValue, ssrClaim } from "./server-slots.ts";
export { createLiveHoles } from "./server-live.ts";
import { isSlotValue, slotAttribute, slotClassOrStyle, spreadBehaviorMarkers, spreadBehaviorPosition } from "./server-slots.ts";
export {
  RequestContext,
  getRequestEvent,
  getTraceContext,
  createRequestEvent,
  createResponseStub,
  commitResponseStub,
  commitEventResponse,
  getExpectedRedirectStatus,
  composeMiddleware,
  configureServerErrors,
  reportRequestFailure,
} from "./request.ts";
export { merge, omit, isStatic, merge as mergeProps };
export const isServer = true;
// (Server mode is on while a render runs: see rendering().)
// Where control flow needs a component's value (a Switch reading its Matches): the component run.
setDescribedNode((v) => (v && v[COMP] ? createComponent(v.fn, componentProps(v.props)) : v));

// ---------------------------------------------------------------- descriptions

const EL = Symbol("twist.ssr.element");
const COMP = Symbol("twist.ssr.component");

type Element_ = { [EL]: true; tag: string; props: any; children?: any; keyed?: boolean; skip?: (k: string) => boolean; attrs?: string; sources?: boolean };
type Component_ = { [COMP]: true; fn: (props: any) => any; props: Record<string, any> };

export const Fragment = (props: { children?: unknown }) => props.children;

export function jsx(type: any, props: Record<string, any>): any {
  if (type === Fragment) return props.children;
  if (typeof type === "function") return { [COMP]: true, fn: type, props } as Component_;
  return { [EL]: true, tag: type, props } as Element_;
}

/** Several children written in the JSX: the array is the template's own (no separators between its items). */
export function jsxs(type: any, props: Record<string, any>): any {
  if (Array.isArray(props.children)) (props.children as any)[OWN] = true;
  return jsx(type, props);
}
/** The development form: the same, with whether the children are written in the JSX. */
export function jsxDEV(type: any, props: Record<string, any>, _key?: unknown, staticChildren?: boolean): any {
  return staticChildren ? jsxs(type, props) : jsx(type, props);
}

const OWN = Symbol("twist.ssr.own");

/** An element made at run time (a dynamic tag): it always takes a key of its own. */
export function ssrElement(tag: string, props: any, children?: any, needsId?: boolean, skip?: (k: string) => boolean, attrs?: string) {
  if (Array.isArray(children)) (children as any)[OWN] = true;
  // Rendered here, in the order it is called (its key taken now): finished HTML.
  return { t: element({ [EL]: true, tag, props, children, skip, attrs, sources: true } as Element_, !!needsId) };
}

/**
 * A component whose tag or component comes from `source`. Its element is made at run time, so it takes a key; the
 * memo path renders it under a memo of its own (as the client does), the static path under the caller.
 */
/** Drawn in the browser only: nothing here, one id taken (the browser's Portal takes the same). */
export function Portal(_props: { mount?: unknown; children?: any }) {
  const o = getOwner();
  if ((o as any)?.id != null) getNextChildId(o!);
  return undefined;
}

/** The component (or tag name) `component` names, given the other props. */
export function Dynamic<P>(props: P & { component: any }) {
  const Comp = dynamic<P>(() => props.component);
  return createComponent(Comp, omit(props as any, "component") as any);
}

// Twist's own: never handed to React.
for (const f of [Portal, Dynamic]) __twist_mark(f);
// (Their bodies read what they render: no strict-read scope; functions declared below are hoisted.)
markBuiltin(Portal, Dynamic, Errored, NoHydration, Hydration, Loading, HydrationScript);

export function dynamic<P>(source: () => any, options?: { static?: boolean }): (props: P) => any {
  return dynamicCore<P>(source, options, true);
}

/** `dynamic` for a source that only answers with components, never a tag name. */
export function dynamicComponent<P>(source: () => any, options?: { static?: boolean }): (props: P) => any {
  return dynamicCore<P>(source, options, false);
}

const COMPONENT_BINDING = Symbol.for("solid.component-binding");

function dynamicCore<P>(source: () => any, options: { static?: boolean } | undefined, tags: boolean): (props: P) => any {
  const make = (w: any, props: any) => {
    if (typeof w === "string") return tags ? ssrElement(w, props, undefined, true) : undefined;
    if (typeof w !== "function") return undefined;
    // A server component's answer: its component, given the call's address.
    const binding = w[COMPONENT_BINDING];
    return binding ? untrack(() => binding.component(props, () => binding.address)) : createComponent(w, props);
  };
  if (options?.static) {
    const w = untrack(source);
    if (w && typeof w.then === "function") throw new Error("dynamic(): a static source must resolve synchronously");
    return (props: any) => make(w, props);
  }
  // As the client's: the source's answer kept once, then a value and its rendering per instance.
  const cached = createMemo(source);
  return (props: any) => {
    const which = createMemo(() => cached());
    return createMemo(() => ({ t: html(make(which(), props), false) }));
  };
}

/** Its children, or its fallback (given the error and a reset) once rendering them throws. */
export function Errored(props: { fallback: any; children?: any }) {
  // The boundary; its content under a first owner of its own, its fallback under a second (the client claims the same).
  const boundary = createOwner();
  const content = ownerUnder(boundary);
  const fallback = (e: unknown) => {
    // The error goes to the client under the content's id: the fallback hydrates against it.
    const r = render;
    const id = (content as any).id;
    if (r?.serializer && id != null && noHydration === 0 && !r.written.has(id)) r.written.add(id), r.serializer.write(id, e);
    const f = props.fallback;
    return runWithOwner(ownerUnder(boundary), () => html(typeof f === "function" ? f(() => e, () => {}) : f, false));
  };
  try {
    const before = holeCount;
    const t = runWithOwner(content, () => html(props.children, false));
    // Holes in it that wait: it waits with them, and shows its fallback if one of them fails.
    const r = render;
    if (!r || holeCount === before || !/\u0000hole\d+\u0000/.test(t)) return { t };
    const token = "\u0000hole" + holeCount++ + "\u0000";
    r.holes.set(token, filled(r, t).catch((e) => rendering(r, r.options, () => fallback(e))));
    return { t: token };
  } catch (e) {
    // Waiting is not failing: the Loading or the shell above waits.
    if (e instanceof NotReadyError) throw e;
    return { t: fallback(e) };
  }
}

/** Style text from (name:, value) pairs: entries with no value left out, the rest joined by ";". */
export function ssrStyleProperties(...entries: any[]): string {
  let out = "";
  for (let i = 0; i < entries.length; i += 2) {
    const v = entries[i + 1];
    if (v == null || v === false || v === "") continue;
    out += (out ? ";" : "") + entries[i] + v;
  }
  return out;
}

export const ssrStyleProperty = (name: string, value: any) => ssrStyleProperties(name, value);

/** A template with holes: the strings with each hole rendered between them (finished HTML). */
export function ssr(template: string[] | string, ...nodes: any[]): { t: string } {
  if (typeof template === "string") return { t: template };
  let out = template[0] ?? "";
  for (let i = 1; i < template.length; i++) out += html(nodes[i - 1], false) + template[i];
  return { t: out };
}

/** What sets up `_$HY` in the page before the server's data and the client's hydration (written for Twist). */
export function generateHydrationScript(options: { nonce?: string; eventNames?: string[] } = {}) {
  const events = JSON.stringify(options.eventNames ?? ["click", "input"]);
  const nonce = options.nonce ? ` nonce="${escape(options.nonce, true)}"` : "";
  return `<script${nonce}>window._$HY||(_$HY={events:[],completed:new WeakSet(),r:{},fe(){}},${events}.forEach(function(t){document.addEventListener(t,function(e){_$HY.events.push([e.target,e])})}))</script>`;
}

export function HydrationScript(props: { nonce?: string; eventNames?: string[] }) {
  return { t: generateHydrationScript(props) };
}

/** On the server a client-only component is its fallback. */
export function clientOnly<P extends object>(_load: () => Promise<any>, _options?: { lazy?: boolean; export?: string }) {
  return (props: P & { fallback?: any }) => props.fallback;
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
const ATTR = /[&"<]/

/** Text for HTML: `<` and `&` in content, `&` and `"` in an attribute. */
export function escape(s: any, attr?: boolean): any {
  if (typeof s !== "string") {
    if (attr) return s == null || typeof s === "boolean" || typeof s === "number" ? s : escape(String(s), true);
    if (Array.isArray(s)) {
      const out: any = s.map((x) => escape(x));
      if ((s as any).$slot) out.$slot = true;
      return out;
    }
    if (typeof s === "function") {
      if (s.$esc) return s;
      const w: any = () => escape(s());
      w.$esc = true;
      // (Tags other layers key on ride along.)
      if (s.$lhSkip) w.$lhSkip = true;
      if (s.$lhSuppress) w.$lhSuppress = true;
      return w;
    }
    return s;
  }
  if (!(attr ? ATTR : CONTENT).test(s)) return s;
  let out = "";
  for (const c of s) out += c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === '"' && attr ? "&quot;" : c;
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
  if (Array.isArray(v)) return list(v, !!(v as any)[OWN], inTemplate);
  if (typeof v === "function") return hole(() => liveHole(v) ?? html(v(), false));
  if (v[EL]) return element(v, v.keyed ?? !inTemplate);
  if (v[COMP]) return html(callComponent(v.fn, componentProps(v.props)), false);
  if (typeof v.t === "string") return v.t;
  // A binding-slot value as text: the markers the client writes between.
  if (isSlotValue(v)) return v.w();
  return escape(String(v));
}

/** One HTML attribute name (anything else is dropped). */
const ATTR_NAME = /^[^\s"'>/=<\u0000-\u001f]+$/;
const NONE_CHOSEN = Symbol("none");
const RAW_TEXT = new Set(["script", "style"]);
const rawText = (v: any): string => (v == null || typeof v === "boolean" ? "" : Array.isArray(v) ? v.map(rawText).join("") : typeof v === "function" ? rawText(v()) : typeof v === "object" && typeof v.t === "string" ? v.t : String(v));
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
  const { tag } = el;
  // The key first: what the props read is the element's, after it.
  let out = "<" + tag + (keyed ? ssrHydrationKey() : "");
  const all = propsOf(el);
  let content: string | undefined;
  let kids: any = NONE_CHOSEN;
  let chosen: unknown = NONE_CHOSEN;
  let own: unknown = NONE_CHOSEN;
  let hasSelected = false;
  // In a server component's frame: slot values become markers, handlers and refs claims the client binds.
  const ctx = sharedConfig.context as any;
  const slots = ctx != null && ctx.claims !== undefined;
  let behaviors: Map<string, string> | null = null;
  // (Own keys through the proxy's ownKeys alone: no descriptor asked for.)
  for (const k of Reflect.ownKeys(all)) {
    if (typeof k !== "string" || el.skip?.(k) || !ATTR_NAME.test(k)) continue;
    // A void element has no children: never read.
    if (k === "children" && VOID.has(tag)) continue;
    const raw = all[k];
    // Content that can change, in a live frame: a hole the engine re-sends.
    if ((k === "innerHTML" || k === "textContent") && isDynamic(raw)) {
      const live = liveHole(() => ({ t: k === "innerHTML" ? String(read(raw) ?? "") : escape(String(read(raw) ?? "")) }));
      if (live != null) {
        content = live;
        continue;
      }
    }
    // (Children that can change stay a hole: a live frame re-sends it.)
    if (k === "children" && isDynamic(raw) && (sharedConfig.context as any)?.liveHoles) {
      kids = raw;
      continue;
    }
    const v = read(raw);
    if (k === "children") kids = v;
    else if (k === "ref" || /^on[A-Z]/.test(k)) {
      if (slots) behaviors = spreadBehaviorPosition(behaviors, k, v, ctx.claims, 0, false);
      continue;
    }
    // Content props: the markup, the text, a textarea's value.
    else if (k === "innerHTML") content = v == null ? "" : String(v);
    else if (k === "textContent" || (tag === "textarea" && (k === "value" || (k === "defaultValue" && content === undefined)))) content = escape(String(v ?? ""));
    // A select's value is no attribute: the matching option is marked selected.
    else if (tag === "select" && k === "value") chosen = v;
    else {
      if (tag === "option" && k === "value") own = v;
      if (k === "selected") hasSelected = true;
      out += slots && v !== null && typeof v === "object" ? (k === "class" || k === "style" ? slotClassOrStyle(k, v) : isSlotValue(v) ? slotAttribute(k, v) : ssrAttribute(k, v)) : ssrAttribute(k, v);
    }
  }
  if (behaviors) out += spreadBehaviorMarkers(behaviors, undefined, ctx.claims);
  // Attribute markup the caller already holds: after the props' own, as is.
  if (el.attrs) out += el.attrs;
  if (tag === "option" && selecting !== NONE_CHOSEN && !hasSelected) {
    const v = String(own === NONE_CHOSEN ? "" : (own ?? ""));
    if (Array.isArray(selecting) ? selecting.map(String).includes(v) : String(selecting ?? "") === v) out += " selected";
  }
  // (Ended as Solid ends them: a compiled template writes `<input …>`, a run-time element `<input … />`.)
  if (VOID.has(tag)) return out + (el.sources ? " />" : ">");
  out += ">";
  // The page's head: what useHead registers goes here once the shell is rendered.
  if (tag === "head" && head && !head.placed) {
    head.placed = true;
    const inner = kids !== NONE_CHOSEN ? children(kids) : "";
    return out + inner + HEAD_SLOT + "</head>";
  }
  const was = selecting;
  if (chosen !== NONE_CHOSEN) selecting = chosen;
  try {
    if (content !== undefined) out += content;
    // Script and style text is raw.
    else if (kids !== NONE_CHOSEN) out += RAW_TEXT.has(tag) ? rawText(kids) : children(kids);
  } finally {
    selecting = was;
  }
  return out + "</" + tag + ">";
}

/** An element's props: JSX props with their spreads, or ssrElement's sources merged (later ones winning). */
function propsOf(el: Element_): Record<string, any> {
  if (!el.sources) return expandSpreads(el.props);
  let p = typeof el.props === "function" ? el.props() : el.props;
  // (A function source is resolved once.)
  if (Array.isArray(p)) p = merge(...p.map((x: any) => (typeof x === "function" ? x() : x)).filter((x: any) => x != null));
  p ??= {};
  return el.children === undefined ? p : merge(p, { children: el.children });
}

/** An element's children: elements written here are in its template; anything else is a hole. */
function children(c: any): string {
  return Array.isArray(c) ? list(c, !!(c as any)[OWN], true) : typeof c === "function" ? hole(() => list([c], true, true)) : c && c[EL] ? element(c, c.keyed ?? false) : html(c, false);
}

type Part = { s: string; text: boolean; split: boolean };

/**
 * A list as the client flattens it. Text next to text becomes two text nodes there, so a separator marks the split
 * here: between values a hole yields (what each resolves to decides), never between a template's own items.
 */
function list(items: any[], own: boolean, inTemplate: boolean): string {
  const parts: Part[] = [];
  collect(items, own, inTemplate, false, parts);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i - 1];
    const b = parts[i]!;
    if (a && a.text && b.text && a.split && b.split) out += SEP;
    out += b.s;
  }
  return out;
}

function collect(items: any[], own: boolean, inTemplate: boolean, viaFn: boolean, parts: Part[]) {
  for (let x of items) {
    let fn = viaFn;
    // A hole or a component beside other children: between markers the client claims it by.
    if (own && !viaFn && items.length > 1 && ((typeof x === "function" && !(x as any).$esc) || (x && x[COMP]))) {
      parts.push({ s: "<!--$-->" + (x[COMP] ? html(x, false) : list([x], false, inTemplate)) + "<!--/-->", text: false, split: false });
      continue;
    }
    if (typeof x === "function") {
      const f = x;
      // A live frame's hole: rendered (between markers) by the live-hole engine, which re-sends it as it changes.
      const live = liveHole(f);
      if (live != null) {
        parts.push({ s: live, text: false, split: false });
        continue;
      }
      const rr = render;
      const o = getOwner() as any;
      const at = childIdCount(o);
      try {
        while (typeof x === "function") (x = x()), (fn = true);
      } catch (e) {
        // A part of the shell not ready yet waits on its own, like any hole.
        const waits = e instanceof NotReadyError && rr?.async && boundaries === 0 && settlesOf(e);
        if (!waits) throw e;
        parts.push({ s: later(rr!, () => list([f], own, inTemplate), waits, o, at), text: false, split: false });
        continue;
      }
    }
    if (x == null || typeof x === "boolean") continue;
    // (A function in a template's own list yields more of that list; an array nested in a list is a hole's.)
    if (Array.isArray(x)) {
      const stays = (own && fn && !viaFn) || !!(x as any)[OWN];
      collect(x, stays, inTemplate && own, stays ? false : fn, parts);
    }
    else if (typeof x === "string" || typeof x === "number") parts.push({ s: typeof x === "string" ? escape(x) : String(x), text: true, split: !own || fn });
    else if (x[EL]) parts.push({ s: element(x, x.keyed ?? !(inTemplate && own && !fn)), text: false, split: false });
    else parts.push({ s: html(x, false), text: false, split: false });
  }
}

const read = (v: any) => (isDynamic(v) ? v() : v);

/** A hole through the render's live-hole engine (a frame response arms one), or null when it is not live. */
function liveHole(f: () => any): string | null {
  const live = (sharedConfig.context as any)?.liveHoles;
  if (!live) return null;
  const r = live.content(f);
  return r == null ? null : typeof r === "string" ? r : r.t.join("");
}

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
  // (`className`, as React code writes it: the class.)
  if (name === "className") name = "class";
  if (name === "class") value = ssrClassName(value);
  else if (name === "style") value = ssrStyle(value);
  if (value == null || value === false) return "";
  if (value === "" && (name === "class" || name === "style")) return "";
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
  /** What async nodes answered, by id: a retry takes the same answer instead of asking again. */
  answers: Map<string, [boolean, unknown]>;
  options: { renderId?: string; noHydrate?: boolean };
  /** What useHead registered, and whether the patch script has been sent. */
  head: HeadRegistry | null;
  headScript?: boolean;
  /** Whether the shell has gone out (later, nothing holds it). */
  shellSent: boolean;
  /** What the client hydrates with, as script text not yet sent. */
  data: string;
  serializer: ReturnType<typeof hydrationSerializer> | null;
  /** Keys already written, and answers still to come (the stream ends after them). */
  written: Set<string>;
  pendingData: number;
  headerSent: boolean;
  /** Holes of the shell still waiting, by placeholder. */
  holes: Map<string, Promise<string>>;
  /** Where what the render makes goes: the document (html text), or a sink of the caller's (a frame stream). */
  sink: Sink;
  /** The render context code reads (`sharedConfig.context`), one for the whole render. */
  ctx: any;
  /** What holds the shell (deferStream data), and holds on the stream's end. */
  blocks: Set<Promise<unknown>>;
  holds: number;
  /** Fragments settled before the shell went out: put in the shell in place of their placeholders. */
  inlined: Map<string, string>;
};

/** The shell with the fragments that settled before it went out in place of their placeholders. */
function inlineFragments(r: Render, shell: string): string {
  for (let again = true; again && r.inlined.size; ) {
    again = false;
    for (const [id, content] of r.inlined) {
      const open = `<template id="pl-${id}"></template>`;
      const at = shell.indexOf(open);
      if (at === -1) continue;
      const close = `<!--pl-${id}-->`;
      const end = shell.indexOf(close, at);
      if (end === -1) continue;
      shell = shell.slice(0, at) + content + shell.slice(end + close.length);
      r.inlined.delete(id);
      again = true;
    }
  }
  return shell;
}

/** What a stream makes, as Solid's renderer hands it out: the shell, data, fragments, reveals, assets. */
export type Sink = {
  data(payload: any): void;
  fragment(key: string, value: string, meta: { styles?: { inline: any[]; links: any[] }; revealGroup?: string; error?: unknown; patch?: string }): void;
  reveal(keys: string[], meta: { fallback?: boolean }): void;
  asset(type: string, value: unknown): void;
  shell(html: string, meta: Record<string, unknown>): void;
  error?(id: string, message: string): void;
};
let render: Render | null = null;
/** What settles each streamed boundary's fragment record. */
const fragments = new WeakMap<object, (v: boolean) => void>();
/** Loading boundaries being rendered (under one, a waiting hole shows the boundary's fallback instead). */
let boundaries = 0;
let holeCount = 0;

/**
 * A hole of the shell, outside every Loading: one that is not ready yet waits on its own (a placeholder in the shell,
 * filled when it renders), the rest of the shell rendered once.
 */
function hole(fn: () => string): string {
  const r = render;
  if (!r || !r.async || boundaries > 0) return fn();
  const o = getOwner() as any;
  const at = childIdCount(o);
  try {
    return fn();
  } catch (e) {
    const waits = e instanceof NotReadyError && settlesOf(e);
    if (!waits) throw e;
    return later(r, fn, waits, o, at);
  }
}

/** A placeholder in the shell for `fn`, rendered again (from the same ids) once `waits` settles. */
function later(r: Render, fn: () => string, waits: Promise<void>, o: any, at: number): string {
  {
    const token = "\u0000hole" + holeCount++ + "\u0000";
    r.holes.set(
      token,
      new Promise<string>((ok, fail) => {
        const again = (w: Promise<void>) =>
          w.then(() => {
            // From the same ids: the hole takes again what it took the first time.
            setChildIdCount(o, at);
            try {
              ok(rendering(r, r.options, () => runWithOwner(o, fn)));
            } catch (e2) {
              const next = e2 instanceof NotReadyError && settlesOf(e2);
              next ? again(next) : fail(e2);
            }
          });
        again(waits);
      }),
    );
    return token;
  }
}

/** The shell with its waiting holes filled (holes rendered late may hold holes of their own). */
async function filled(r: Render, s: string): Promise<string> {
  for (;;) {
    const m = /\u0000hole\d+\u0000/.exec(s);
    if (!m) return s;
    const v = await r.holes.get(m[0])!;
    s = s.replace(m[0], () => v);
  }
}

/**
 * Its children, or its fallback while something under it is not ready. In a stream the fallback is sent first, between
 * markers the client's reveal script finds; the children follow in a template once what they wait on lands.
 */
export function Loading(props: { fallback?: any; children?: any }) {
  const parent = getOwner();
  const boundary = ownerUnder(parent);
  const id = (boundary as any).id as string | undefined;
  const wasBoundary = headBoundary;
  try {
    boundaries++;
    headBoundary = id ?? headBoundary;
    try {
      return { t: runWithOwner(boundary, () => html(props.children, false)) };
    } finally {
      boundaries--;
      headBoundary = wasBoundary;
    }
  } catch (e) {
    if (!(e instanceof NotReadyError)) throw e;
    const r = render;
    const waits = settlesOf(e);
    // What holds the shell (a module loading, data marked deferStream): the boundary waits in the shell, unseen.
    if (r && r.async && !r.shellSent && waits && holdsShell(e)) {
      resetOwner(boundary);
      const at = childIdCount(parent);
      (parent as any).owned?.splice((parent as any).owned.indexOf(boundary), 1);
      setChildIdCount(parent, at - 1);
      return { t: later(r, () => (Loading(props) as any).t, waits, parent, at - 1) };
    }
    // The fallback under an owner of its own with the boundary's id: it takes no id from what follows (as Solid).
    const fallback = runWithOwner(ownerUnder(parent, { id }), () => html(props.fallback, false));
    if (!r || !r.async || !waits || id == null) return { t: fallback };
    const retry = (p: Promise<void>) => {
      r.waiting.add(p);
      p.then(() => {
        r.waiting.delete(p);
        // A boundary rendered again since (or thrown away): this retry is not its any more.
        // (Its record settles: nothing will be sent for it.)
        if ((boundary as any).disposed) return fragments.get(boundary)?.(false), r.wake?.();
        resetOwner(boundary);
        try {
          boundaries++;
          let content: string;
          const hb = headBoundary;
          headBoundary = id;
          // (What an earlier pass of it registered goes: this pass registers it again.)
          if (r.head) r.head.groups = r.head.groups.filter((g) => g.boundary !== id);
          try {
            content = rendering(r, r.options, () => runWithOwner(boundary, () => html(props.children, false)));
          } finally {
            boundaries--;
            headBoundary = hb;
          }
          const patch = r.head ? headPatch(r, id!) : "";
          fragments.get(boundary)?.(true);
          if (!r.shellSent) r.inlined.set(id!, content);
          else r.sink.fragment(id!, content, { styles: { inline: [], links: [] }, patch });
        } catch (e2) {
          const next = e2 instanceof NotReadyError && settlesOf(e2);
          if (!next) throw e2;
          retry(next);
        }
        r.wake?.();
      });
    };
    // The boundary's fragment record: settles once its content has been sent (the client hydrates it then).
    let revealed!: (v: boolean) => void;
    const record = new Promise<boolean>((ok) => (revealed = ok));
    fragments.set(boundary, revealed);
    if (r.serializer && noHydration === 0) {
      r.serializer.write(id + "_fr", record);
      // The stream ends after the record's resolution is written.
      r.pendingData++;
      record.then(() => queueMicrotask(() => (r.pendingData--, r.wake?.())));
    }
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

// ---------------------------------------------------------------- head (useHead)

type HeadDesc = { tag: string; props?: Record<string, any>; key?: any };
type HeadGroup = { boundary: string; tags: HeadDesc[] };
type HeadRegistry = { groups: HeadGroup[]; resources: string[]; sent: Set<string>; placed: boolean };

const HEAD_SLOT = "\u0000head\u0000";
const HEAD_TAGS = new Set(["title", "meta", "link", "style", "script", "base"]);
const RESOURCE_RELS = new Set(["preload", "modulepreload", "prefetch", "preconnect", "dns-prefetch", "stylesheet"]);

/** The registry of the render under way. */
let head: HeadRegistry | null = null;
/** The Loading boundary rendering now ("" for the shell): what useHead registers belongs to it. */
let headBoundary = "";

const newHead = (): HeadRegistry => ({ groups: [], resources: [], sent: new Set(), placed: false });

/**
 * Tags for the page's head. Replaceable ones (a title, a meta by name, a canonical link…) resolve last-wins: in the
 * shell's head for the shell, as patch ops beside a streamed boundary's reveal. Resources (scripts with a src,
 * stylesheets, preloads) go out as they are.
 */
export function useHead(tags: HeadDesc | HeadDesc[] | (() => HeadDesc | HeadDesc[])) {
  if (!head) return;
  const list = typeof tags === "function" ? tags() : tags;
  const group: HeadGroup = { boundary: headBoundary, tags: [] };
  for (const d of Array.isArray(list) ? list : [list]) {
    if (!d || !HEAD_TAGS.has(d.tag)) continue;
    if (isResource(d)) {
      // (Its props read now: one not ready waits, under its boundary, like any read.)
      const markup = headTag(d);
      const id = resourceId(d);
      if (!head.sent.has(id)) head.sent.add(id), headBoundary === "" ? head.resources.push(markup) : group.tags.push({ ...d, props: { ...d.props, [RAW]: markup } });
    } else {
      // Its props read now: under a boundary one not ready suspends it (the shell's head waits at its own fill).
      if (headBoundary !== "") headAttrs(d), evalHead(d.props?.children);
      group.tags.push(d);
    }
  }
  if (group.tags.length) head.groups.push(group);
}

const RAW = "\u0000raw";

function isResource(d: HeadDesc) {
  const p = d.props ?? {};
  if (d.tag === "link") return RESOURCE_RELS.has(evalHead(p.rel));
  if (d.tag === "script") return "src" in p;
  if (d.tag === "style") return "href" in p;
  return false;
}

const evalHead = (v: any) => (typeof v === "function" ? v() : v);

function resourceId(d: HeadDesc) {
  const p = d.props ?? {};
  return "res:" + d.tag + ":" + (evalHead(p.rel) ?? "") + ":" + String(evalHead(p.href) ?? evalHead(p.src) ?? "");
}

/** Which tag a later one replaces: one title, one base, a meta by name, a link by rel and href; else its own. */
function identity(d: HeadDesc, unique: number) {
  const p = d.props ?? {};
  if (d.tag === "title" || d.tag === "base") return d.tag;
  if (d.key != null) return d.tag + ":key:" + evalHead(d.key);
  if (d.tag === "meta") {
    if (p.charset != null) return "charset";
    for (const ns of ["name", "property", "http-equiv"]) if (p[ns] != null) return "meta:" + ns + ":" + evalHead(p[ns]);
  }
  if (d.tag === "link") return "link:" + (evalHead(p.rel) ?? "") + ":" + (evalHead(p.href) ?? "");
  return "u" + unique;
}

/** A head tag's props as attributes: values read, camelCase handlers and children left out. */
function headAttrs(d: HeadDesc): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const k of Object.keys(d.props ?? {})) {
    if (k === "children" || k === RAW || /^on[A-Z]/.test(k) || !ATTR_NAME.test(k)) continue;
    const v = evalHead(d.props![k]);
    if (v == null || v === false) continue;
    out[k] = v === true ? true : String(v);
  }
  return out;
}

function headTag(d: HeadDesc): string {
  if (d.props?.[RAW]) return d.props[RAW];
  let out = "<" + d.tag;
  const a = headAttrs(d);
  for (const k of Object.keys(a)) out += a[k] === true ? " " + k : ` ${k}="${escape(a[k], true)}"`;
  if (VOID.has(d.tag)) return out + ">";
  const text = evalHead(d.props?.children);
  return out + ">" + (text == null ? "" : d.tag === "title" ? escape(String(text)) : String(text)) + "</" + d.tag + ">";
}

/** The winners of `groups`, last one per identity. */
function winners(groups: HeadGroup[]): HeadDesc[] {
  const by = new Map<string, HeadDesc>();
  let unique = 0;
  for (const g of groups) for (const d of g.tags) by.set(identity(d, unique++), d);
  return [...by.values()];
}

/** The head's slot filled: the shell's tags (and its resources). Waiting when `wait`: a tag not ready holds it. */
function fillHead(shell: string, h: HeadRegistry, wait: boolean): string | Promise<string> {
  if (!shell.includes(HEAD_SLOT)) return shell;
  try {
    const tags = winners(h.groups.filter((g) => g.boundary === "")).map(headTag);
    return shell.replace(HEAD_SLOT, () => h.resources.join("") + tags.join(""));
  } catch (e) {
    const waits = wait && e instanceof NotReadyError && settlesOf(e);
    if (!waits) return shell.replace(HEAD_SLOT, () => h.resources.join(""));
    return waits.then(() => fillHead(shell, h, wait));
  }
}

function shellHead(r: Render, shell: string): string | Promise<string> {
  return r.head ? rendering(r, r.options, () => fillHead(shell, r.head!, true)) : shell;
}

/** Applies head patch ops: retitle, remove by identity, add (written for Twist). */
const HEAD_SCRIPT = `function $dh(o,i,e,n,k){for(i=0;i<o.length;i++){e=o[i];if(e[0]=="t"){n=document.querySelector("title");if(!n){n=document.createElement("title");document.head.appendChild(n)}n.textContent=e[1];n.setAttribute("data-dh","title")}else if(e[0]=="r"){document.head.querySelectorAll("[data-dh]").forEach(function(x){x.getAttribute("data-dh")==e[1]&&x.remove()})}else{n=document.createElement(e[2]);for(k in e[3])n.setAttribute(k,e[3][k]===true?"":e[3][k]);if(e[4]!=null)n.textContent=e[4];n.setAttribute("data-dh",e[1]);document.head.appendChild(n)}}}`;

/** A streamed boundary's head: its resources as markup, its tags as patch ops for $dh. */
function headPatch(r: Render, id: string): string {
  const h = r.head!;
  const groups = h.groups.filter((g) => g.boundary === id);
  if (!groups.length) return "";
  let markup = "";
  const ops: unknown[] = [];
  let unique = 0;
  for (const d of winners(groups)) {
    if (d.props?.[RAW]) {
      markup += d.props[RAW];
      continue;
    }
    const ident = identity(d, unique++);
    if (d.tag === "title") ops.push(["t", String(evalHead(d.props?.children) ?? "")]);
    else ops.push(["r", ident], ["a", ident, d.tag, headAttrs(d), evalHead(d.props?.children) ?? null]);
  }
  if (!ops.length) return markup;
  const code = (r.headScript ? "" : HEAD_SCRIPT + ";") + "$dh(" + JSON.stringify(ops).replace(/</g, "\\u003c") + ")";
  r.headScript = true;
  return markup + `<script>${code}</script>`;
}

// ---------------------------------------------------------------- render entry points

/** An async node's answer, sent to the client under its id (once; nothing under NoHydration). */
function sendAnswer(node: any, answer: unknown) {
  const r = render;
  const id = node?.id as string | undefined;
  if (!r?.serializer || id == null || noHydration > 0 || !sharedConfig.context || r.written.has(id)) return;
  r.written.add(id);
  if (answer && typeof (answer as any).then === "function") {
    r.pendingData++;
    const done = () => queueMicrotask(() => (r.pendingData--, r.wake?.()));
    (answer as Promise<unknown>).then(done, done);
  }
  r.serializer.write(id, answer);
}

/** The data not yet sent, as a script (the scope's header ahead of the first). */
function takeData(r: Render): string {
  if (!r.data) return "";
  const s = (r.headerSent ? "" : headerScript(r.options.renderId)) + r.data;
  r.headerSent = true;
  r.data = "";
  return `<script>${s}</script>`;
}

function rendering<T>(r: Render | null, options: { renderId?: string; noHydrate?: boolean }, fn: () => T): T {
  const was = sharedConfig.context;
  const wasRender = render;
  sharedConfig.context = options.noHydrate ? null : (r?.ctx ?? stringContext(options.renderId ?? ""));
  render = r;
  const wasHead = head;
  if (r) head = r.head;
  setServerAnswers(r?.answers ?? null);
  setServerFly(r?.serializer ? sendAnswer : null);
  const wasServer = setServerRender(true);
  try {
    return fn();
  } finally {
    setServerRender(wasServer);
    sharedConfig.context = was;
    render = wasRender;
    head = wasHead;
    setServerAnswers(wasRender?.answers ?? null);
    setServerFly(wasRender?.serializer ? sendAnswer : null);
  }
}

export function renderToString(code: () => any, options: { renderId?: string; noHydrate?: boolean } = {}): string {
  const wasHead = head;
  head = newHead();
  try {
    return rendering(null, options, () =>
      createRoot(
        (dispose) => {
          try {
            return fillHead(html(code(), false), head!, false) as string;
          } finally {
            dispose();
          }
        },
        { id: options.renderId ?? "" },
      ),
    );
  } finally {
    head = wasHead;
  }
}

type Writable = { write(chunk: string): void; end(): void };

/** The context a string render's code reads: nothing waits, nothing is sent. */
function stringContext(id: string) {
  return { id, count: 0, async: false, document: true, live: {}, escape, ssr, resolve: (v: any) => ({ t: html(v, false) }), serialize() {}, block() {}, replace() {}, registerAsset() {}, hold: () => () => {} };
}

/** The context of a stream: Solid's render context API over this render. */
function streamContext(r: Render, options: StreamOptions) {
  return {
    id: options.renderId ?? "",
    count: 0,
    async: true,
    nonce: options.nonce,
    document: !options.sink,
    live: {},
    escape,
    ssr,
    resolve: (v: any) => ({ t: html(v, false) }),
    serialize(id: string, p: unknown, deferStream?: boolean) {
      if (!r.serializer) return;
      if (deferStream && !r.shellSent && p && typeof (p as any).then === "function") r.blocks.add(p as Promise<unknown>);
      r.serializer.write(id, p);
    },
    block(p: Promise<unknown>) {
      if (!r.shellSent) r.blocks.add(p);
    },
    hold() {
      r.holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        r.holds--;
        r.wake?.();
      };
    },
    replace() {},
    registerAsset(type: string, value: unknown) {
      if (r.shellSent) r.sink.asset(type, value);
    },
    /** A fragment of the caller's: its record serialized now, its content to the sink when given. */
    registerFragment(key: string, opts?: { revealGroup?: string }) {
      let settle!: (v: unknown) => void;
      let fail!: (e: unknown) => void;
      const record = new Promise((ok, no) => ((settle = ok), (fail = no)));
      record.catch(() => {});
      r.serializer?.write(key + "_fr", record);
      let done = false;
      return (value?: string, error?: unknown) => {
        if (done) return r.shellSent;
        done = true;
        r.sink.fragment(key, value !== undefined ? value : " ", { styles: { inline: [], links: [] }, revealGroup: opts?.revealGroup, error });
        queueMicrotask(() => (error ? fail(error) : settle(true)));
        r.wake?.();
        return r.shellSent;
      };
    },
    revealFragments(keys: string | string[]) {
      r.sink.reveal(Array.isArray(keys) ? keys : [keys], { fallback: false });
    },
    revealFallbacks(keys: string | string[]) {
      r.sink.reveal(Array.isArray(keys) ? keys : [keys], { fallback: true });
    },
    flushed: () => r.shellSent,
  };
}

type StreamOptions = {
  renderId?: string;
  noHydrate?: boolean;
  nonce?: string;
  onCompleteShell?: () => void;
  onCompleteAll?: () => void;
  /** A sink of the caller's in place of the document (what the render makes goes there). */
  sink?: Partial<Sink>;
  /** The serializer data is written with (the hydration serializer by default). */
  serializer?: (options: any) => any;
  plugins?: any[];
  signal?: AbortSignal;
};

/** The shell at once, then each boundary as it settles; awaited, the whole document. */
export function renderToStream(code: () => any, options: StreamOptions = {}) {
  const r: Render = { async: true, waiting: new Set(), chunks: [], wake: null, revealScript: false, answers: new Map(), options, holes: new Map(), shellSent: false, head: newHead(), data: "", serializer: null, written: new Set(), pendingData: 0, headerSent: false, sink: null as any, ctx: null, blocks: new Set(), holds: 0, inlined: new Map() };
  // The document: html text, data as script, each fragment as a template and its reveal.
  let documentShell = "";
  const documentSink: Sink = {
    data: (payload: string) => void (r.data += payload + ";"),
    fragment: (key, value, meta) => void r.chunks.push(takeData(r) + (meta.patch ?? "") + `<template id="${key}">${value}</template>` + (meta.revealGroup ? "" : script(r, `$df("${key}")`))),
    reveal: (keys, meta) => void (meta.fallback || r.chunks.push(script(r, keys.map((k) => `$df("${k}")`).join(";")))),
    asset() {},
    shell: (html) => void (documentShell = html + takeData(r)),
  };
  r.sink = { ...documentSink, ...options.sink } as Sink;
  r.ctx = streamContext(r, options);
  if (!options.noHydrate) r.serializer = (options.serializer ?? createHydrationSerializer)({ scopeId: options.renderId, plugins: options.plugins, onData: (p: unknown) => (r.sink.data(p), r.wake?.()), onDone() {}, onError() {} });
  let dispose!: () => void;
  let root!: any;
  // The shell: rendered again (from the same ids) while something outside every Loading is not ready.
  const shellReady = new Promise<string>((ok, fail) => {
    const attempt = () => {
      try {
        filled(r, rendering(r, options, () => runWithOwner(root, () => html(code(), false))))
          .then(async (shell) => {
            while (r.blocks.size) {
              const now = [...r.blocks];
              await Promise.allSettled(now);
              for (const p of now) r.blocks.delete(p);
            }
            return shellHead(r, shell);
          })
          .then(ok, fail);
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
    // Ended: the sinks are closed (a wake-up after the last write has nothing left to send).
    if (done) return;
    const data = takeData(r);
    if (data) r.chunks.push(data);
    for (; sent < r.chunks.length; sent++) for (const w of sinks) w.write(r.chunks[sent]!);
    if (!r.waiting.size && !r.pendingData && !r.holds && !done) {
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
  // Aborted: the render is torn down (its sources returned) and nothing more is sent.
  options.signal?.addEventListener(
    "abort",
    () => {
      if (done) return;
      done = true;
      dispose?.();
      for (const w of sinks) w.end();
      finished();
    },
    { once: true },
  );
  const failed = shellReady.then(
    (s) => {
      rendering(r, options, () => r.sink.shell(inlineFragments(r, s), {}));
      shell = documentShell;
      shellSent = true;
      r.shellSent = true;
      // (One settled inside a placeholder that was itself streamed: it streams too.)
      for (const [id, content] of r.inlined) r.sink.fragment(id, content, { styles: { inline: [], links: [] } });
      r.inlined.clear();
      options.onCompleteShell?.();
      for (const w of sinks) w.write(shell);
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
