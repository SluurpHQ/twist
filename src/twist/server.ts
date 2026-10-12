// Twist's server runtime (`@solidjs/web` on a server): JSX makes descriptions, rendered to HTML top-down so hydration
// keys are taken in document order, as the client claims them. A template's root element takes a key; elements nested
// in the same template do not; elements made at run time (dynamic tags, spreads into ssrElement) do.
declare const process: { env: Record<string, string | undefined> };
import { childIdCount, setChildIdCount, idScope, createMemo, createOwner, ownerUnder, createRoot, getNextChildId, getOwner, NotReadyError, resetOwner, runWithOwner, settlesOf, holdsShell, setServerAnswers, setServerFly, setServerRender, setServerScope, setInsideLoading, sharedConfig, untrack, SOURCE_ANSWER, isClientOnly } from "./signals.ts";
import { OBSERVE, emitDiagnostic, ownerPath, reportDiagnostic, setRouteDeclarer } from "./diagnostics.ts";
import { merge, omit, isStatic } from "./flow.ts";
import { headerScript, hydrationSerializer } from "./serialize.ts";
import { createHydrationSerializer } from "./serialization.ts";
import { __twist_mark, markBuiltin, renderComponent, callComponent, componentProps, createComponent, isChildren, isDynamic, setDescribedNode } from "./control.ts";

export { lazy } from "./server-solid.ts";
export * from "./server-solid.ts";
export * from "./control.ts";
export * from "./response.ts";
export { CLAIMS_STREAM, CLAIMS_DOCUMENT, SLOT_VALUE, SLOT_MARKER, SLOT_FACE_STREAM, SLOT_FACE_DATA, SLOT_FACE_MARKUP, slotValue, isSlotValue, ssrClaim } from "./server-slots.ts";
export { createLiveHoles } from "./server-live.ts";
import { commitResponseStub, deriveHead, devCheck, getRequestEvent, setRequestErrorHook, getExpectedRedirectStatus, reportServerError, ssrSanitizeError, type RequestEvent } from "./request.ts";
import { isHttpNavigationTarget } from "./response.ts";
// The container tier's server half (projections cross a frame's border as traces), as Solid's server entry installs it.
import { setAsyncIterableSharer, setContainerTraceResolver } from "./frames/frame-container-plugin.ts";
import { getProjectionTrace } from "./container-trace.ts";
import { traceFor, traceForEvent } from "./trace.ts";
import { inServerComponentScope, shareAsyncIterable } from "./server-internal.ts";
import { expand, hasHoles, type Spec } from "./tags.ts";
setContainerTraceResolver(getProjectionTrace);
setAsyncIterableSharer(shareAsyncIterable);
import { applyAssetTracking, collectStreamStyles, createAssetTracking, nonceAttr, normalizeNonce, preloadLink, registerEntryAssets, renderHeadAssets, renderInlineStyle, resourceIdentity, serializeFragmentAssets, type AssetTracking, type Nonce } from "./server-assets.ts";
import { isSlotValue, slotAttribute, slotClassOrStyle, spreadBehaviorMarkers, spreadBehaviorPosition, spreadPropPosition } from "./server-slots.ts";
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
  httpStatus,
  httpHeader,
} from "./request.ts";
export { getServerFunctionMetadata, getServerFunctionRPC, isServerFunction } from "./server-functions/registry.ts";
export { merge, omit, isStatic, merge as mergeProps };
export const isServer = true;
// (Server mode is on while a render runs: see rendering().)
// Where control flow needs a component's value (a Switch reading its Matches): the component run.
setDescribedNode((v) => (v && v[COMP] ? createComponent(v.fn, componentProps(v.props)) : v));

// ---------------------------------------------------------------- descriptions

const EL = Symbol("twist.ssr.element");
const COMP = Symbol("twist.ssr.component");
/** Whether `v` is markup made here and not rendered yet (Twist's JSX describes; html() renders). */
export const isServerNode = (v: any) => !!v && typeof v === "object" && (v[EL] === true || v[COMP] === true);

type Element_ = { [EL]: true; tag: string; props: any; children?: any; keyed?: boolean; skip?: (k: string) => boolean; attrs?: string; sources?: boolean };
type Component_ = { [COMP]: true; fn: (props: any) => any; props: Record<string, any> };

export const Fragment = (props: { children?: unknown }) => props.children;

/**
 * A compiled template on the server: the element the JSX stands for, its static attributes rendered once and each
 * fixed part as its HTML (rendered the first time). Static attributes after one set at run time: the JSX itself, so
 * attributes keep their order.
 */
export const __twist_t = (spec: Spec) => (values: unknown[]) => described(spec, values, { i: 0 });
const fixedAttrs = new WeakMap<Spec, string>();
const fixedHtml = new WeakMap<Spec, { t: string }>();
function described(spec: Spec, values: unknown[], at: { i: number }): any {
  if (spec[4]) return expand(spec, values, at, jsx, jsxs);
  const [tag, fixed, slots, kids] = spec;
  const props: Record<string, any> = {};
  for (const name of slots) props[name] = values[at.i++];
  const children = kids.map((k) => (k === 0 ? values[at.i++] : typeof k === "string" ? (RAW_TEXT.has(tag) ? k : { t: k.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }) : hasHoles(k) ? described(k, values, at) : fixedPart(k)));
  if (children.length > 1) ((children as any)[OWN] = true), (props.children = children);
  else if (children.length) props.children = children[0];
  let attrs = fixedAttrs.get(spec);
  if (attrs === undefined) {
    attrs = "";
    for (let i = 0; i < fixed.length; i += 2) attrs += ssrAttribute(fixed[i]!, fixed[i + 1]);
    fixedAttrs.set(spec, attrs);
  }
  return { [EL]: true, tag, props, attrs } as Element_;
}
function fixedPart(spec: Spec): { t: string } {
  let part = fixedHtml.get(spec);
  if (!part) fixedHtml.set(spec, (part = { t: element(described(spec, [], { i: 0 }), false) }));
  return part;
}

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

export function dynamic<P>(source: () => any, options?: { static?: boolean; deferStream?: boolean }): (props: P) => any {
  return dynamicCore<P>(source, options, true);
}

/** `dynamic` for a source that only answers with components, never a tag name. */
export function dynamicComponent<P>(source: () => any, options?: { static?: boolean; deferStream?: boolean }): (props: P) => any {
  return dynamicCore<P>(source, options, false);
}

const COMPONENT_BINDING = Symbol.for("solid.component-binding");

function dynamicCore<P>(source: () => any, options: { static?: boolean; deferStream?: boolean } | undefined, tags: boolean): (props: P) => any {
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
  // (deferStream: its answer holds the shell.)
  const cached = createMemo(source, options?.deferStream ? ({ deferStream: true } as any) : undefined);
  return (props: any) => {
    const which = createMemo(() => cached());
    return createMemo(() => ({ t: html(make(which(), props), false) }));
  };
}

/** A server Errored's answer for a failure inside it: its fallback's markup (read by a failed Loading's fragment). */
const ERRORED_OUTCOME = Symbol("twist.ssr.errored-outcome");

/**
 * What a failed streamed Loading inside a server component puts in its place: the nearest server Errored's fallback, or
 * (none) its own fallback, the error escaping to the frame. Outside one: nothing (the client renders it again).
 */
function failedOutcome(r: Render, boundary: any, fallback: string, e: unknown): string {
  if (!inServerComponentScope(boundary)) return " ";
  const answer = boundary.context?.[ERRORED_OUTCOME] as ((e: unknown) => string) | undefined;
  if (answer) {
    // (Finished markup, nothing live in it: the live-hole engine mints nothing for it.)
    const live = (r.ctx as any)?.liveHoles;
    if (live) live.suppressed++;
    try {
      return rendering(r, r.options, () => runWithOwner(boundary, () => answer(e)));
    } catch {
    } finally {
      if (live) live.suppressed--;
    }
  }
  const message = e instanceof Error ? e.message : String(e);
  // (The frame as one value errors: a frame stream's unkeyed error chunk, or the document's live op addressed to it.)
  const ctx = (boundary.renderCtx ?? r.ctx) as any;
  if (r.options.sink?.error) r.sink.error!("", message);
  else ctx?.live?.error?.(ctx.frameId, message);
  return fallback.replace(/^<template id="pl-[^"]*"><\/template>|<!--pl-[^>]*-->$/g, "");
}

/** Its children, or its fallback (given the error and a reset) once rendering them throws. */
export function Errored(props: { fallback: any; children?: any }) {
  // As Solid's: the boundary (its content under an owner of its own, its error sent under its id), then an output owner
  // beside it that its fallback renders under (the client claims the same).
  const boundary = createOwner();
  const output = createOwner();
  const content = ownerUnder(boundary);
  // (In a server component: what a failed Loading inside it renders in its place, this fallback for the error.)
  if (inServerComponentScope(content)) content.context = { ...content.context, [ERRORED_OUTCOME]: (err: unknown) => fallback(err) };
  const fallback = (err: unknown) => {
    // What the client may see of it: the error hook's answer, else the sanitized error (heard once, where it was met).
    const id = (boundary as any).id;
    const e = ssrSanitizeError(err, boundary, { kind: "render", handling: "fallback", boundary: id }, (sharedConfig.context as any)?.errorPolicy);
    // The error goes to the client under the content's id: the fallback hydrates against it.
    const r = render;
    if (r?.serializer && id != null && !isNoHydration() && !r.written.has(id)) r.written.add(id), r.serializer.write(id, e);
    else if (!r && id != null && !isNoHydration()) (sharedConfig.context as any)?.serialize?.(id, e);
    const f = props.fallback;
    return runWithOwner(output, () => html(typeof f === "function" ? f(() => e, () => {}) : f, false));
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
export function clientOnly<P extends object>(_load: () => Promise<any>, _options?: { lazy?: boolean; export?: string }, moduleUrl?: string) {
  return (props: P & { fallback?: any }) => {
    // (Its module, named by the bundler: plain link hints so the browser fetches it early — never the hydration map,
    // as hydration does not need it; the fallback is what hydrates.)
    const ctx = sharedConfig.context as any;
    if (moduleUrl && ctx?.registerAsset && ctx.resolveAssets) {
      const hint = (assets: any) => {
        if (!assets) return;
        for (const css of assets.css ?? []) ctx.registerAsset(typeof css === "string" ? "style" : "inline-style", css);
        for (const p of assets.preloads ?? []) ctx.registerAsset("preload", p);
        for (const js of assets.js ?? []) ctx.registerAsset("module", js);
      };
      const assets = ctx.resolveAssetsSync ? ctx.resolveAssetsSync(moduleUrl) : ctx.resolveAssets(moduleUrl);
      assets && typeof assets.then === "function" ? assets.then(hint, () => {}) : hint(assets);
    }
    return props.fallback;
  };
}

// ---------------------------------------------------------------- hydration keys

/** The next hydration key, while a hydratable render runs (none under NoHydration). */
export function getHydrationKey(): string | undefined {
  const o = getOwner();
  if (!(sharedConfig.context as any) || !o || (o as any).id == null || isNoHydration()) return undefined;
  return getNextChildId(o);
}

export function ssrHydrationKey() {
  const hk = getHydrationKey();
  return hk ? ` _hk=${hk}` : "";
}

let noHydration = 0;
/** NoHydration and Hydration mark their owners: what renders under them later (a boundary's retry) still knows. */
const NO_HYDRATE = Symbol.for("twist.ssr.no-hydrate");
// (Registered: it crosses a server component's context barrier, as Solid's NoHydrateContext does — see server-internal.)
/** Whether rendering under NoHydration (nothing hydrates there). */
export const isNoHydration = () => {
  const marked = (getOwner() as any)?.context?.[NO_HYDRATE];
  return marked !== undefined ? marked : noHydration > 0;
};

/** Its children render with no hydration keys (they will not be hydrated). */
export function NoHydration(props: { children?: any }) {
  const o = createOwner({ transparent: true }) as any;
  o.context = { ...o.context, [NO_HYDRATE]: true };
  noHydration++;
  try {
    return { t: runWithOwner(o, () => html(props.children, false)) };
  } finally {
    noHydration--;
  }
}

/** Its children hydrate (inside NoHydration). */
export function Hydration(props: { id?: string; children?: any }) {
  // Hydrating already: its children as they are.
  if (!isNoHydration()) return props.children;
  const was = noHydration;
  noHydration = 0;
  const o = ownerUnder(getOwner(), { id: props.id ?? "" }) as any;
  o.context = { ...o.context, [NO_HYDRATE]: false };
  try {
    // Keys from `id` on (a server component's client content claims under its occurrence's prefix).
    return runWithOwner(o, () => {
      const v = props.children;
      // A slot's range keeps itself (its caller reads it): its parts rendered in place.
      if (Array.isArray(v) && (v as any).$slot) {
        for (let i = 0; i < v.length; i++) v[i] = { t: html(v[i], false) };
        return v;
      }
      return { t: html(v, false) };
    });
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
  // (A template's dynamic hole: its own id scope, as the client's binding is.)
  if (typeof v === "function") return inTemplate && isDynamic(v) ? hole(idScope(() => liveHole(v) ?? html(v(), false)), true) : hole(() => liveHole(v) ?? html(v(), false));
  if (v[EL]) return element(v, v.keyed ?? !inTemplate);
  if (v[COMP]) return renderComponent(v.fn, componentProps(v.props), (out) => html(out, false));
  if (typeof v.t === "string") return v.t;
  // A binding-slot value as text: the markers the client writes between.
  if (isSlotValue(v)) return v.w();
  // Neither text, a node, a list nor something to call: skipped, and said (as the client does).
  if (typeof v === "object" || typeof v === "symbol") {
    if (process.env.NODE_ENV !== "production") devCheck({ code: "UNRECOGNIZED_INSERT_VALUE", kind: "render", severity: "warn", message: `[UNRECOGNIZED_INSERT_VALUE] Unrecognized value. Skipped inserting (${typeof v}).`, data: { type: typeof v, value: v } });
    return "";
  }
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

/** Tag names seen valid (one element name: a letter, then letters, digits, dots, dashes, underscores, colons). */
const validTags = new Set<string>();
const TAG_NAME = /^[A-Za-z][A-Za-z0-9._:-]*$/;

function element(el: Element_, keyed: boolean): string {
  const { tag } = el;
  // (A name from run time: one element name, or nothing is written.)
  if (!validTags.has(tag)) {
    if (!TAG_NAME.test(tag)) throw new Error(`"${tag}" is not a valid tag name`);
    validTags.add(tag);
  }
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
  const tail: Set<string> | undefined = (all as any)[TAIL];
  // (Own keys through the proxy's ownKeys alone: no descriptor asked for.)
  for (const k of Reflect.ownKeys(all)) {
    if (typeof k !== "string" || el.skip?.(k) || !ATTR_NAME.test(k) || (tail && tail.has(k))) continue;
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
    // Children that can change stay a hole: one not ready waits on its own, a live frame re-sends it.
    if (k === "children" && isDynamic(raw)) {
      kids = { [DYNAMIC_KIDS]: raw };
      continue;
    }
    const v = read(raw);
    // (A spread's children: templates of their own, each keyed as a hole's are.)
    if (k === "children") kids = el.sources || hasSpread(el.props) ? keyedKids(v) : v;
    else if (k === "ref" || /^on[A-Z]/.test(k)) {
      if (slots) behaviors = spreadBehaviorPosition(behaviors, k, v, ctx.claims, 0, false);
      continue;
    }
    // (A property has no markup; a stand-in there is named in development.)
    else if (k.startsWith("prop:")) {
      if (slots && v !== null && typeof v === "object") spreadPropPosition(k, v);
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
  if (tail) for (const k of tail) out += ssrAttribute(k, read(all[k]));
  // Attribute markup the caller already holds: after the props' own, as is.
  if (el.attrs) out += el.attrs;
  if (tag === "option" && selecting !== NONE_CHOSEN && !hasSelected) {
    const v = String(own === NONE_CHOSEN ? "" : (own ?? ""));
    if (Array.isArray(selecting) ? selecting.map(String).includes(v) : String(selecting ?? "") === v) out += " selected";
  }
  // (Ended as Solid ends them: a compiled template writes `<input …>`, a run-time or spread element `<input … />`.)
  if (VOID.has(tag)) return out + (el.sources || hasSpread(el.props) ? " />" : ">");
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
    else if (kids !== NONE_CHOSEN) out += RAW_TEXT.has(tag) ? rawText(kids && kids[DYNAMIC_KIDS] ? read(kids[DYNAMIC_KIDS]) : kids) : children(kids);
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
/** Children read from an accessor, rendered where they are read (as their value would be). */
const DYNAMIC_KIDS = Symbol("twist.ssr.dynamic-children");

/** Elements given as values (not a template's own children): keyed, as Solid's templates each take an id. */
const keyedKids = (v: any): any => (Array.isArray(v) ? Object.assign(v.map(keyedKids), { [OWN]: (v as any)[OWN] }) : v && v[EL] && v.keyed === undefined ? { ...v, keyed: true } : v);

function children(c: any): string {
  if (c && c[DYNAMIC_KIDS]) {
    const raw = c[DYNAMIC_KIDS];
    return hole(idScope(() => liveHole(() => read(raw)) ?? children(read(raw))), true);
  }
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
  return joined(parts);
}

/** Dynamic holes being rendered in their scope, with the scoped run (a retry runs it again). */
const scoping = new Map<Function, () => Part[]>();

/** Parts as HTML: text beside text split where the client would see two nodes. */
function joined(parts: Part[]): string {
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
    // A dynamic hole of a template (an insert, in Solid's terms; not a component's children): rendered in an id scope
    // of its own, as the client's binding is, and retried in the same one.
    if (inTemplate && typeof x === "function" && isDynamic(x) && !scoping.has(x)) {
      const f = x;
      const run = idScope(() => {
        const ps: Part[] = [];
        scoping.set(f, run);
        try {
          collect([f], own, inTemplate, viaFn, ps);
        } finally {
          scoping.delete(f);
        }
        return ps;
      });
      parts.push(...run());
      continue;
    }
    if (typeof x === "function") {
      const f = x;
      const rr = render;
      const o = getOwner() as any;
      const scoped = scoping.get(f);
      const at = scoped ? -1 : childIdCount(o);
      try {
        // A live frame's hole: rendered (between markers) by the live-hole engine, which re-sends it as it changes.
        const live = liveHole(f);
        if (live != null) {
          parts.push({ s: live, text: false, split: false });
          continue;
        }
        while (typeof x === "function") (x = x()), (fn = true);
      } catch (e) {
        // A part of the shell not ready yet waits on its own, like any hole.
        const waits = e instanceof NotReadyError && rr?.async && settlesOf(e);
        if (!waits || (boundaries > 0 && !rr!.shellSent && holdsShell(e))) throw e;
        parts.push({ s: later(rr!, scoped ? () => joined(scoped()) : () => list([f], own, inTemplate), waits, o, at), text: false, split: false });
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

const hasSpread = (props: unknown) => !!props && typeof props === "object" && Object.keys(props).some((k) => k.startsWith("$spread$"));

/** Props with their spreads applied, in order. */
function expandSpreads(props: Record<string, any>) {
  if (!Object.keys(props).some((k) => k.startsWith("$spread$"))) return props;
  // (Each key from the last source that has it, read only there: one a later attribute overrides is never read.)
  const winner = new Map<string, Record<string, any>>();
  // (Refs from every source, joined in order: a named one does not replace a spread's.)
  const refs: unknown[] = [];
  // (A handler or ref keeps the place it first had; an attribute moves to its latest.)
  const place = (k: string, source: Record<string, any>) => {
    if (k !== "ref" && !/^on[A-Z]/.test(k)) winner.delete(k);
    winner.set(k, source);
  };
  const keys = Object.keys(props);
  let last = -1;
  keys.forEach((k, i) => k.startsWith("$spread$") && (last = i));
  for (const k of keys) {
    // (Set again later: it moves there, as the later attribute.)
    if (!k.startsWith("$spread$")) {
      if (k === "ref") refs.push(props[k]);
      place(k, props);
    } else {
      const source = props[k]();
      if (source)
        for (const key of Object.keys(source)) {
          if (key === "ref") refs.push(source[key]);
          place(key, source);
        }
    }
  }
  const out: Record<string, any> = {};
  for (const [k, source] of winner)
    if (k === "ref" && refs.length > 1) out[k] = refs.flat();
    else if (source === props) out[k] = props[k];
    else Object.defineProperty(out, k, { get: () => source[k], enumerable: true, configurable: true });
  // (The statics after the last spread: the tail, written after the claim markers.)
  const tail = keys.slice(last + 1).filter((k) => k !== "ref" && !CONTENT_PROPS.has(k) && !/^on[A-Z]/.test(k) && !isDynamic(props[k]));
  if (tail.length) Object.defineProperty(out, TAIL, { value: new Set(tail) });
  return out;
}
const TAIL = Symbol("twist.ssr.spread-tail");
/** Props that are content, not attributes (a select's and an option's value too). */
const CONTENT_PROPS = new Set(["children", "innerHTML", "textContent", "value", "defaultValue", "selected"]);

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
  if (value == null || typeof value === "boolean") return "";
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
  /** Its Loading boundaries that waited, by id (their records). */
  tracks?: Map<string, BoundaryTrack>;
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
  /** The client assets the render registered (lazy modules, styles, preloads). */
  tracking: AssetTracking;
  /** Stylesheets the shell's head carries (a fragment does not link them again). */
  headStyles: Set<string> | null;
  nonce: Nonce | undefined;
  /** What a failed boundary lets go of, by id: data still to come, nested boundaries still waiting. */
  abandons: Map<string, () => void>;
};

/** A boundary failed: what waits under it (by id) is let go of, so the stream can end (and how much, said). */
function abandonUnder(r: Render, id: string, error: unknown) {
  let fragments = 0;
  let serialized = 0;
  for (const [k, let_go] of [...r.abandons])
    if (k !== id && k.startsWith(id)) {
      r.abandons.delete(k), let_go();
      DATA in let_go ? serialized++ : fragments++;
    }
  if (OBSERVE && (fragments || serialized))
    emitDiagnostic(
      {
        code: "SSR_SUBTREE_ABANDONED",
        kind: "ssr",
        severity: "warn",
        message:
          `[SSR_SUBTREE_ABANDONED] Fragment '${id}' failed with ${fragments} nested fragment(s) and ${serialized} serialized value(s) ` +
          `still pending; the subtree was discarded and the client renders it from scratch.`,
        data: { fragment: id, fragments, serialized, error },
      },
      null,
    );
}
/** Marks an abandon that lets go of a serialized value (not a nested fragment). */
const DATA = Symbol("data");

/**
 * The head with the render's asset links before `</head>`. A page with no head (one embedded in the caller's
 * document): what the head would carry goes to `onHead`, else nowhere.
 */
function withHeadAssets(html: string, tracking: AssetTracking, h: HeadRegistry | null, nonce?: Nonce, onHead?: (head: string) => void): string {
  // (A head the page wrote as text, not rendered: no slot was filled, its tags go with the links.)
  const tags = h && !h.placed ? h.resources.join("") + winners(h.groups.filter((g) => g.boundary === "")).map(headTag).join("") : "";
  const at = html.indexOf("</head>");
  if (at === -1) {
    onHead?.(tags + renderHeadAssets(tracking, nonce));
    return html;
  }
  const links = tags + renderHeadAssets(tracking, nonce);
  return links ? html.slice(0, at) + links + html.slice(at) : html;
}

/** An asset registered during a render: in the head while the shell is to come, to the sink after. */
function registerAssetIn(tracking: AssetTracking, shellSent: () => boolean, sink: Sink | null, type: string, value: any, nonce?: Nonce) {
  if (type === "preload") {
    const entry = preloadLink(tracking, value, nonce);
    if (entry && shellSent()) sink?.asset("preload", entry);
    return;
  }
  if (type === "inline-style") {
    const entry = tracking.registerInlineStyle(value);
    if (shellSent() && !tracking.currentBoundaryId && !entry.emitted) {
      entry.emitted = true;
      sink?.asset("inline-style", entry);
    }
    return;
  }
  if (tracking.currentBoundaryId && type === "style") {
    let styles = tracking.boundaryStyles.get(tracking.currentBoundaryId);
    if (!styles) tracking.boundaryStyles.set(tracking.currentBoundaryId, (styles = new Set()));
    styles.add(value);
  }
  if (!tracking.emittedAssets.has(value)) {
    tracking.emittedAssets.add(value);
    if (shellSent()) sink?.asset(type, value);
  }
}

/** Nothing left that renders: the document's live channel gets its last sweep and closes (before the data's end, which
 * it would otherwise hold open). */
function endLive(r: Render) {
  const live = (r.ctx as any).live;
  if (!live?.end || r.waiting.size || r.holds) return;
  const end = live.end;
  live.end = null;
  // (Closed after the shell: the response waits for the close to be written.)
  if (r.shellSent) (r as any).liveClosing = true;
  end();
}

/** The shell with the fragments that settled before it went out in place of their placeholders. */
function inlineFragments(r: Render, shell: string): string {
  for (let again = true; again && r.inlined.size; ) {
    again = false;
    for (const [id, content] of r.inlined) {
      const open = `<template id="pl-${id}">`;
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
/** Marks a server <Loading> boundary's owner (what reads under it, on any later pass, is inside it). */
const LOADING_OWNER = Symbol("twist.ssr.loading");
setInsideLoading((o) => {
  if (boundaries > 0) return true;
  for (let x: any = o; x; x = x.parent) if (x[LOADING_OWNER]) return true;
  return false;
});
let holeCount = 0;

/**
 * A hole of the shell, outside every Loading: one that is not ready yet waits on its own (a placeholder in the shell,
 * filled when it renders), the rest of the shell rendered once.
 */
function hole(fn: () => string, scoped = false): string {
  const r = render;
  if (!r || !r.async) return fn();
  const o = getOwner() as any;
  // (Scoped: it takes its ids under its own, the same each time; else again from where it began.)
  const at = scoped ? -1 : childIdCount(o);
  try {
    return fn();
  } catch (e) {
    const waits = e instanceof NotReadyError && settlesOf(e);
    if (!waits || (boundaries > 0 && !r.shellSent && holdsShell(e))) throw e;
    return later(r, fn, waits, o, at);
  }
}

/** A placeholder in the shell for `fn`, rendered again (from the same ids) once `waits` settles. */
/** Whether a hole made under `o` still belongs to the render: none of its owners reset or disposed since. */
function stillOwned(o: any): () => boolean {
  const seen: [any, number][] = [];
  for (let x = o; x; x = x.parent) seen.push([x, x.resets ?? 0]);
  return () => seen.every(([x, n]) => !x.disposed && (x.resets ?? 0) === n);
}

function later(r: Render, fn: () => string, waits: Promise<void>, o: any, at: number): string {
  const owned = stillOwned(o);
  {
    const token = "\u0000hole" + holeCount++ + "\u0000";
    r.holes.set(
      token,
      new Promise<string>((ok, fail) => {
        const again = (w: Promise<void>) =>
          w.then(() => {
            // Thrown away with a pass of its boundary that was rendered again: nothing to fill.
            if (!owned()) return ok("");
            // From the same ids: the hole takes again what it took the first time.
            if (at >= 0) setChildIdCount(o, at);
            try {
              ok(rendering(r, r.options, () => runWithOwner(o, fn)));
            } catch (e2) {
              // (Client-only content: passed up as it is, its boundary hands it to the client.)
              const next = e2 instanceof NotReadyError && !isClientOnly(e2) && settlesOf(e2);
              if (next) holdShell(r, e2, next);
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
async function filled(r: Render, s: string, pass?: () => void): Promise<string> {
  for (;;) {
    const found = s.match(/\u0000hole\d+\u0000/g);
    if (!found) return s;
    // (Each hole awaited is a pass, the one that failed too; one failing fails them all, at once.)
    const vs = await Promise.all(found.map((h) => r.holes.get(h)!.finally(() => pass?.())));
    found.forEach((h, i) => (s = s.replace(h, () => vs[i]!)));
  }
}

/**
 * Its children, or its fallback while something under it is not ready. In a stream the fallback is sent first, between
 * markers the client's reveal script finds; the children follow in a template once what they wait on lands.
 */
export function Loading(props: { fallback?: any; on?: unknown; children?: any }) {
  const parent = getOwner();
  const boundary = ownerUnder(parent);
  (boundary as any)[LOADING_OWNER] = true;
  // (A group coordinates the boundaries directly inside it, not theirs.)
  const group = revealGroupOf(parent);
  if (group) setRevealGroup(boundary, null);
  const id = (boundary as any).id as string | undefined;
  // Its content's ids as the client's: under X00 (X01 after `on`); its fallback's under X.
  if (id != null) (boundary as any).id = id + ("on" in props ? "01" : "00");
  const wasBoundary = headBoundary;
  try {
    boundaries++;
    headBoundary = id ?? headBoundary;
    let content: string;
    const assetCtx = sharedConfig.context as any;
    const wasAssetBoundary = assetCtx?._currentBoundaryId;
    if (assetCtx && id != null && "_currentBoundaryId" in assetCtx) assetCtx._currentBoundaryId = id;
    try {
      content = runWithOwner(boundary, () => html(props.children, false));
    } finally {
      boundaries--;
      headBoundary = wasBoundary;
      if (assetCtx && "_currentBoundaryId" in assetCtx) assetCtx._currentBoundaryId = wasAssetBoundary;
    }
    const r = render;
    // Holes in it still waiting (made once, filled as they land): the fallback now, the content when they are filled.
    if (!r || !r.async || id == null || !HOLE_TOKEN.test(content)) {
      const waited = r && id != null ? r.tracks?.get(id) : undefined;
      if (waited && waited.outcome === undefined) waited.passes++, settleBoundary(r!, waited, "settled");
      // (Its modules, for the client to load before it hydrates it.)
      if (id != null) boundaryModules(id);
      return { t: content };
    }
    const reg = group?.register(id) ?? null;
    const fallback = runWithOwner(ownerUnder(parent, { id }), () => html(props.fallback, false));
    const track = trackBoundary(r, id, boundary, group);
    return { t: streamBoundary(r, boundary, id, fallback, filled(r, content, () => track.passes++), group, !!reg?.collapseFallback, track) };
  } catch (e) {
    if (!(e instanceof NotReadyError)) throw e;
    const r = render;
    // (Client-only content: nothing on the server settles it.)
    const client = isClientOnly(e);
    const waits = client ? null : settlesOf(e);
    // What holds the shell (a module loading, data marked deferStream): the boundary waits in the shell, unseen.
    if (r && r.async && !r.shellSent && waits && holdsShell(e)) {
      if (id != null) trackBoundary(r, id, boundary, group);
      resetOwner(boundary);
      const at = childIdCount(parent);
      (parent as any).owned?.splice((parent as any).owned.indexOf(boundary), 1);
      setChildIdCount(parent, at - 1);
      return { t: later(r, () => (Loading(props) as any).t, waits, parent, at - 1) };
    }
    const reg = group && id != null ? group.register(id) : null;
    // Collapsed by its group, outside a stream: nothing shows for it.
    if (reg?.collapseFallback && (!r || !r.async)) return { t: "" };
    // The fallback under an owner of its own with the boundary's id: it takes no id from what follows (as Solid).
    const fallback = runWithOwner(ownerUnder(parent, { id }), () => html(props.fallback, false));
    if (!r || !r.async || !waits || id == null) {
      // What it showed, final: the fallback of a string render, or client-only content the client renders.
      const track = trackBoundary(r, id ?? "", boundary, group);
      // (The modules it began to load, for the client to load before it renders it.)
      if (id != null) boundaryModules(id);
      // (The client goes on from its fallback: it renders the content itself.)
      if (id != null) (sharedConfig.context as any)?.serialize?.(id, "$$f");
      settleBoundary(r, track, client ? "client" : "fallback");
      return { t: fallback };
    }
    const collapse = !!reg?.collapseFallback;
    const track = trackBoundary(r, id, boundary, group);
    let passes = 0;
    let abandoned = false;
    const retry = (p: Promise<void>) => {
      r.waiting.add(p);
      r.abandons.set(id, () => {
        abandoned = true;
        r.waiting.delete(p);
        fragments.get(boundary)?.(false);
        r.wake?.();
      });
      p.then(() => {
        if (abandoned) return;
        r.abandons.delete(id);
        r.waiting.delete(p);
        // A boundary rendered again since (or thrown away): this retry is not its any more.
        // (Its record settles: nothing will be sent for it.)
        if ((boundary as any).disposed) return fragments.get(boundary)?.(false), r.wake?.();
        resetOwner(boundary);
        track.passes++;
        try {
          boundaries++;
          let content: string;
          const hb = headBoundary;
          headBoundary = id;
          // (What an earlier pass of it registered goes: this pass registers it again.)
          if (r.head) r.head.groups = r.head.groups.filter((g) => g.boundary !== id);
          const wasCurrent = r.tracking.currentBoundaryId;
          r.tracking.currentBoundaryId = id!;
          try {
            content = rendering(r, r.options, () => runWithOwner(boundary, () => html(props.children, false)));
          } finally {
            r.tracking.currentBoundaryId = wasCurrent;
            boundaries--;
            headBoundary = hb;
          }
          const patch = r.head ? headPatch(r, id!) : "";
          fragments.get(boundary)?.(true);
          serializeFragmentAssets(id!, r.tracking, r.ctx);
          if (!r.shellSent) r.inlined.set(id!, content);
          else r.sink.fragment(id!, content, { styles: collectStreamStyles(id!, r.tracking, r.headStyles), patch, revealGroup: group?.id });
          settleBoundary(r, track, "settled");
          group?.onResolved(id!);
        } catch (e2) {
          // Client-only content surfaced: handed to the client, which renders it.
          if (e2 instanceof NotReadyError && isClientOnly(e2)) {
            fragments.get(boundary)?.(false);
            settleBoundary(r, track, "client");
            group?.onResolved(id!);
            return void r.wake?.();
          }
          // (A pass that never stops waiting on something new: given up after a budget of passes, as an error.)
          const stuck = e2 instanceof NotReadyError && ++passes >= CONVERGE_BUDGET;
          if (stuck) e2 = new Error(`<Loading> did not converge: still waiting after ${passes} passes`);
          const next = e2 instanceof NotReadyError && settlesOf(e2);
          if (!next) {
            // One that never settles, before the shell went out: the request fails with it.
            if (stuck && !r.shellSent && (r as any).failShell) return void ((r as any).failShell(e2), r.wake?.());
            // A real error retrying: the boundary's record fails with it (the stream goes on).
            abandonUnder(r, id, e2);
            failures.get(boundary)?.(e2);
            // (Before the shell went out its placeholder is inlined away: no fallback, the client renders it again.)
            if (r.shellSent) r.sink.fragment(id!, failedOutcome(r, boundary, fallback, e2), { styles: { inline: [], links: [] }, error: e2, revealGroup: group?.id });
            else r.inlined.set(id!, "");
            settleBoundary(r, track, "error", e2);
            group?.onResolved(id!);
            return void r.wake?.();
          }
          holdShell(r, e2, next);
          retry(next);
        }
        r.wake?.();
      });
    };
    boundaryRecord(r, boundary, id);
    retry(waits);
    return { t: placeholder(id, fallback, collapse) };
  }
}

/** A Loading boundary that waited, as Solid records it ("boundary" on OBSERVE.records): when it was found waiting, its passes, how it ended. */
type BoundaryTrack = { id: string; at: number; passes: number; boundary: object; group?: string; settledAt?: number; outcome?: string; streamed?: boolean; error?: unknown; told?: boolean };
function trackBoundary(r: Render | null, id: string, boundary: object, group: RevealGroup | null): BoundaryTrack {
  let t = r?.tracks?.get(id);
  if (!t) {
    t = { id, at: performance.now(), passes: 0, boundary, group: group?.id };
    if (r) (r.tracks ??= new Map()).set(id, t);
  }
  t.passes++;
  return t;
}
/** How it ended: told now, or (in a group) when the group reveals it. */
function settleBoundary(r: Render | null, t: BoundaryTrack, outcome: string, error?: unknown) {
  if (t.outcome !== undefined) return;
  t.settledAt = performance.now();
  t.outcome = outcome;
  t.streamed = !!r?.shellSent;
  if (error !== undefined) t.error = error;
  if (process.env.NODE_ENV !== "production") boundaryChecks(t);
  if (!t.group || !r?.async) tellBoundary(t, t.settledAt);
}
function tellBoundary(t: BoundaryTrack, revealAt: number) {
  t.told = true;
  const records = OBSERVE?.records;
  if (!records?.observed("boundary")) return;
  const event: Record<string, unknown> = { id: t.id, at: t.at, durationMs: t.settledAt! - t.at, passes: t.passes, outcome: t.outcome, streamed: t.streamed, heldMs: revealAt - t.settledAt! };
  if (t.group) event.revealGroup = t.group;
  const path = ownerPath(t.boundary);
  if (path) event.ownerPath = path;
  records.emit("boundary", event, t.error !== undefined ? { error: t.error } : {});
}
/** What the record shows a developer: sequential waits (a waterfall), client-only content found only after a wait. */
function boundaryChecks(t: BoundaryTrack) {
  if (t.outcome === "settled" && t.passes >= 3) {
    const waits = t.passes - 1;
    const entry = emitDiagnostic(
      {
        code: "SSR_BOUNDARY_WATERFALL",
        kind: "ssr",
        severity: waits >= 3 ? "warn" : "info",
        message: `[SSR_BOUNDARY_WATERFALL] A <Loading> boundary took ${t.passes} render passes — ${waits} sequential async waits, each found only once the one before it answered. Start the reads together (or higher up) so they wait in parallel.`,
        data: { boundary: t.id, passes: t.passes, sequentialMs: t.settledAt! - t.at },
      },
      t.boundary,
    );
    if (waits >= 3) reportDiagnostic(entry);
  }
  if (t.outcome === "client" && t.passes >= 2) {
    const waits = t.passes - 1;
    reportDiagnostic(
      emitDiagnostic(
        {
          code: "SSR_CLIENT_CONTENT_MASKED",
          kind: "ssr",
          severity: "warn",
          message: `[SSR_CLIENT_CONTENT_MASKED] Client-only content under a <Loading> boundary was found after ${waits} server wait${waits === 1 ? "" : "s"}: the fallback streamed, then the client rendered it. Read it outside the server wait, or mark the boundary for the client.`,
          data: { boundary: t.id, passes: t.passes },
        },
        t.boundary,
      ),
    );
  }
}

/** The passes a Loading boundary's content gets to stop waiting before it fails. */
const CONVERGE_BUDGET = 100;

/** The boundary's fragment record: settles once its content has been sent (the client hydrates it then). */
function boundaryRecord(r: Render, boundary: object, id: string) {
  let revealed!: (v: boolean) => void;
  let failed!: (e: unknown) => void;
  const record = new Promise<boolean>((ok, no) => ((revealed = ok), (failed = no)));
  record.catch(() => {});
  fragments.set(boundary, revealed);
  failures.set(boundary, (e: unknown) => failed(ssrSanitizeError(e, boundary, { kind: "render", handling: "client", boundary: id }, (r.ctx as any)?.errorPolicy)));
  // (A server component's too: hydration-free, but its fragment's outcome is what the client's dev report reads.)
  if (r.serializer && (!isNoHydration() || inServerComponentScope(boundary as any))) {
    r.serializer.write(id + "_fr", record);
    // The stream ends after the record's settling is written.
    r.pendingData++;
    const done = () => queueMicrotask(() => (r.pendingData--, r.wake?.()));
    record.then(done, done);
  }
}
/** What fails each streamed boundary's fragment record (the client renders the subtree, and meets the error there). */
const failures = new WeakMap<object, (e: unknown) => void>();

/** A wait the shell must not go out before (deferred data found while a boundary retries). */
function holdShell(r: Render, e: unknown, waits: Promise<void>) {
  if (!r.shellSent && e instanceof NotReadyError && holdsShell(e)) r.blocks.add(waits);
}

/** A boundary whose content waits on holes of its own: its fallback in place, the content streamed once filled. */
/** A boundary's place in the stream: its fallback between markers (kept in the template while its group collapses it). */
const placeholder = (id: string, fallback: string, collapse: boolean) =>
  collapse ? `<template id="pl-${id}">${fallback}</template><!--pl-${id}-->` : `<template id="pl-${id}"></template>${fallback}<!--pl-${id}-->`;

/** A boundary's modules, serialized for the client to load before it hydrates or renders it. */
function boundaryModules(id: string) {
  const ctx = sharedConfig.context as any;
  const map = ctx?.getBoundaryModules?.(id);
  if (map && Object.keys(map).length) ctx.serialize?.(id + "_assets", { ...map });
}

function streamBoundary(r: Render, boundary: any, id: string, fallback: string, content: Promise<string>, group: RevealGroup | null = null, collapse = false, track?: BoundaryTrack): string {
  boundaryRecord(r, boundary, id);
  const done: Promise<void> = content.then(
    (html) => {
      if (boundary.disposed) return void fragments.get(boundary)?.(false);
      rendering(r, r.options, () => {
        const patch = r.head ? headPatch(r, id) : "";
        fragments.get(boundary)?.(true);
        serializeFragmentAssets(id, r.tracking, r.ctx);
        if (!r.shellSent) r.inlined.set(id, html);
        else r.sink.fragment(id, html, { styles: collectStreamStyles(id, r.tracking, r.headStyles), patch, revealGroup: group?.id });
        if (track) settleBoundary(r, track, "settled");
      });
    },
    (e) => {
      // Client-only content surfaced: handed to the client, which renders it.
      if (e instanceof NotReadyError && isClientOnly(e)) {
        if (track) settleBoundary(r, track, "client");
        return void fragments.get(boundary)?.(false);
      }
      if (track) settleBoundary(r, track, "error", e);
      abandonUnder(r, id, e);
      failures.get(boundary)?.(e);
      // (Before the shell went out its placeholder is inlined away: no fallback, the client renders it again.)
      if (r.shellSent) r.sink.fragment(id, failedOutcome(r, boundary, fallback, e), { styles: { inline: [], links: [] }, error: e, revealGroup: group?.id });
      else r.inlined.set(id, "");
    },
  ).finally(() => rendering(r, r.options, () => group?.onResolved(id)));
  const settled = done.then(() => {
    r.abandons.delete(id);
    r.waiting.delete(settled);
    r.wake?.();
  });
  r.waiting.add(settled);
  // (Let go of by a failing boundary around it: its record settles, nothing more is sent for it.)
  r.abandons.set(id, () => {
    r.waiting.delete(settled);
    fragments.get(boundary)?.(false);
    r.wake?.();
  });
  return placeholder(id, fallback, collapse);
}

const HOLE_TOKEN = /\u0000hole\d+\u0000/;

/** Swaps a streamed template in for the fallback before it (written for Twist, not taken from Solid). */
/** Solid's fragment swap runtime (MIT, Ryan Carniato and contributors): `$df`, groups (`$dfj`), fallbacks (`$dflj`), style gates. */
const REVEAL = `function $df(e){return _$HY.f?_$HY.f(e):$dfr(e)}function $dfr(e,n,o,t){if(!(n=document.getElementById(e)))return 0;if(!(o=document.getElementById("pl-"+e)))return(_$HY.dq=_$HY.dq||{})[e]=1,0;for(;o&&(8!==o.nodeType||o.nodeValue!=="pl-"+e);)t=o.nextSibling,o.remove(),o=t;t=o.parentNode,o.replaceWith(n.content),n.remove(),(_$HY.v=_$HY.v||{})[e]=1,_$HY.fe(e,t),_$HY.hp&&_$HY.hp[e]&&($dh(_$HY.hp[e]),delete _$HY.hp[e]),$dfd();return 1}function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return(_$HY.dlq=_$HY.dlq||{})[e]=1,0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1,$dfd();return 1}n=n.nextSibling}return 0}function $dflj(e,i){for(i=0;i<e.length;i++)$dfl(e[i])}function $dfd(e,i){if(e=_$HY.dq){_$HY.dq=0;for(i in e)$df(i)}if(e=_$HY.dlq){_$HY.dlq=0;for(i in e)$dfl(i)}}function $dfs(e,c,d){(_$HY.sc=_$HY.sc||{})[e]=c,d&&((_$HY.sd=_$HY.sd||{})[e]=1)}function $dfg(e,g,i,k){if(!(g=_$HY.sg&&_$HY.sg[e]))return;for(i=0;i<g.length;i++)if(_$HY.sc&&_$HY.sc[g[i]]>0)return;for(i=0;i<g.length;i++)k=g[i],delete _$HY.sg[k],$df(k)}function $dfc(e){if(--_$HY.sc[e]<=0){delete _$HY.sc[e],_$HY.sg&&_$HY.sg[e]?$dfg(e):!(_$HY.sd&&_$HY.sd[e])&&$df(e);_$HY.sd&&delete _$HY.sd[e]}}function $dfj(e,i,n){for(i=0;i<e.length;i++)if(_$HY.sc&&_$HY.sc[e[i]]>0){for(n=0;n<e.length;n++)(_$HY.sg=_$HY.sg||{})[e[n]]=e;return}for(i=0;i<e.length;i++)$df(e[i])}function $dfe(e,t,k){(t=e.target)&&t.getAttribute&&!t._$dc&&(k=t.getAttribute("data-dfc"))&&(t._$dc=1,$dfc(k))}document.addEventListener("load",$dfe,!0);document.addEventListener("error",$dfe,!0)`;

// ---------------------------------------------------------------- Reveal (ported from Solid's server flow.ts, MIT)

type RevealOrder = "sequential" | "together" | "natural";
type RevealGroup = {
  id: string;
  register(key: string, options?: { onActivate?: () => void }): { collapseFallback: boolean; held: boolean };
  onResolved(key: string): void;
  onMinimallyResolved?(key: string): void;
};
const REVEAL_GROUP = Symbol("twist.ssr.reveal-group");
const revealGroupOf = (o: any): RevealGroup | null => (o?.context?.[REVEAL_GROUP] as RevealGroup | undefined) ?? null;
const setRevealGroup = (o: any, g: RevealGroup | null) => void (o.context = { ...o.context, [REVEAL_GROUP]: g });

/** The order the Loading boundaries directly inside reveal in, as the stream sends them. */
export function Reveal(props: { order?: RevealOrder; collapsed?: boolean; children?: any }) {
  const parent = getOwner();
  const o = ownerUnder(parent) as any;
  const id = o.id as string;
  const order: RevealOrder = props.order ?? "sequential";
  const collapsed = order === "sequential" && !!props.collapsed;
  const ctx = sharedConfig.context as any;
  const parentGroup = revealGroupOf(parent);

  if (!ctx?.async) {
    let collapsedByParent = false;
    if (parentGroup) collapsedByParent = parentGroup.register(id).collapseFallback;
    let count = 0;
    setRevealGroup(o, {
      id,
      register() {
        count++;
        return { collapseFallback: collapsedByParent || (order === "sequential" && collapsed && count > 1), held: false };
      },
      onResolved() {},
    });
    return { t: runWithOwner(o, () => html(props.children, false)) };
  }

  const keys: string[] = [];
  const resolved = new Set<string>();
  const minimallyResolved = new Set<string>();
  const composites = new Map<string, () => void>();
  const activated = new Set<string>();
  const stash: string[] = [];
  const collapsedLeafKeys: string[] = [];
  let frontier = 0;
  let heldByParent = false;
  let collapsedByParent = false;
  let selfMinimallyResolved = false;
  let notifiedParentDone = false;
  let registering = true;

  if (parentGroup) {
    const reg = parentGroup.register(id, {
      onActivate: () => {
        if (!heldByParent) return;
        heldByParent = false;
        if (collapsedByParent) {
          collapsedByParent = false;
          if (collapsedLeafKeys.length) {
            ctx.revealFallbacks?.([...collapsedLeafKeys]);
            collapsedLeafKeys.length = 0;
          }
        }
        if (order === "sequential") advanceFrontier();
        else if (order === "together") checkTogetherRelease();
        else naturalRelease();
      },
    });
    collapsedByParent = reg.collapseFallback;
    heldByParent = reg.held;
  }

  const revealLeaves = (leafKeys: string[]) => ctx.revealFragments?.(leafKeys);
  function notifyParentIfDone() {
    if (registering || notifiedParentDone) return;
    if (parentGroup && resolved.size === keys.length) {
      notifiedParentDone = true;
      parentGroup.onResolved(id);
    }
  }
  function activateComposite(key: string) {
    if (activated.has(key)) return;
    activated.add(key);
    composites.get(key)!();
  }
  function updateSelfMinimallyResolved() {
    if (registering || selfMinimallyResolved) return;
    if (keys.length === 0) selfMinimallyResolved = true;
    else if (order === "together") selfMinimallyResolved = minimallyResolved.size === keys.length;
    else if (order === "sequential") selfMinimallyResolved = minimallyResolved.has(keys[0]!);
    else selfMinimallyResolved = minimallyResolved.size > 0;
    if (selfMinimallyResolved) parentGroup?.onMinimallyResolved?.(id);
  }
  function advanceFrontier() {
    if (heldByParent) return;
    while (frontier < keys.length && resolved.has(keys[frontier]!)) {
      const k = keys[frontier]!;
      if (composites.has(k)) activateComposite(k);
      else revealLeaves([k]);
      frontier++;
    }
    if (frontier < keys.length) {
      const k = keys[frontier]!;
      if (composites.has(k)) activateComposite(k);
      else if (order === "sequential" && collapsed) ctx.revealFallbacks?.([k]);
    }
    notifyParentIfDone();
  }
  function checkTogetherRelease() {
    if (registering || order !== "together" || heldByParent) return;
    if (minimallyResolved.size < keys.length) return;
    if (stash.length) {
      revealLeaves([...stash]);
      stash.length = 0;
    }
    composites.forEach((_, key) => activateComposite(key));
    notifyParentIfDone();
  }
  function naturalRelease() {
    if (stash.length) {
      revealLeaves([...stash]);
      stash.length = 0;
    }
    composites.forEach((_, key) => activateComposite(key));
    notifyParentIfDone();
  }
  function markMinimallyResolved(key: string) {
    if (minimallyResolved.has(key)) return;
    minimallyResolved.add(key);
    updateSelfMinimallyResolved();
    if (order === "together") checkTogetherRelease();
  }

  setRevealGroup(o, {
    id,
    register(key, options) {
      keys.push(key);
      const isComposite = !!options?.onActivate;
      if (isComposite) composites.set(key, options!.onActivate!);
      const selfCollapse = order === "sequential" && collapsed && keys.length > 1;
      const collapseFallback = collapsedByParent || selfCollapse;
      if (collapseFallback && !isComposite) collapsedLeafKeys.push(key);
      let held = heldByParent;
      if (!held) {
        if (order === "together") held = true;
        else if (order === "sequential" && keys.length > 1) held = true;
      }
      return { collapseFallback, held };
    },
    onResolved(key) {
      resolved.add(key);
      if (!composites.has(key)) {
        if (order === "together") stash.push(key);
        else if (order === "natural" && heldByParent) stash.push(key);
        else if (order === "natural") revealLeaves([key]);
        markMinimallyResolved(key);
        if (order === "sequential" && !heldByParent) advanceFrontier();
        if (order === "natural") updateSelfMinimallyResolved();
      } else {
        markMinimallyResolved(key);
        if (!heldByParent) {
          if (order === "sequential") advanceFrontier();
          else if (order === "natural") activateComposite(key);
        }
        if (order === "together") checkTogetherRelease();
        if (order === "natural") updateSelfMinimallyResolved();
      }
      notifyParentIfDone();
    },
    onMinimallyResolved(key) {
      markMinimallyResolved(key);
    },
  });
  const result = runWithOwner(o, () => html(props.children, false));
  registering = false;
  updateSelfMinimallyResolved();
  checkTogetherRelease();
  notifyParentIfDone();
  return { t: result };
}
markBuiltin(Reveal);

function script(r: Render, code: string) {
  const s = r.revealScript ? code : REVEAL + ";" + code;
  r.revealScript = true;
  return `<script${nonceAttr(r.nonce, "script")}>${s}</script>`;
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

/** A render's head registry; `sent` is the render's resource identities, shared with its preloads. */
const newHead = (sent: Set<string>): HeadRegistry => ({ groups: [], resources: [], sent, placed: false });

/**
 * Tags for the page's head. Replaceable ones (a title, a meta by name, a canonical link…) resolve last-wins: in the
 * shell's head for the shell, as patch ops beside a streamed boundary's reveal. Resources (scripts with a src,
 * stylesheets, preloads) go out as they are.
 */
export function useHead(tags: HeadDesc | HeadDesc[] | (() => HeadDesc | HeadDesc[])) {
  if (!head || !sharedConfig.context) {
    if (process.env.NODE_ENV !== "production") headCheck("useHead called outside a server render: ignored", { reason: "outside-render" });
    return;
  }
  const list = typeof tags === "function" ? tags() : tags;
  const group: HeadGroup = { boundary: headBoundary, tags: [] };
  for (const d of Array.isArray(list) ? list : [list]) {
    if (!d) continue;
    if (!HEAD_TAGS.has(d.tag)) {
      if (process.env.NODE_ENV !== "production") headCheck(`useHead: ignoring non-head tag <${d.tag}>`, { reason: "non-head-tag", detail: d.tag });
      continue;
    }
    if (process.env.NODE_ENV !== "production")
      for (const k of Object.keys(d.props ?? {})) if (k !== "children" && !ATTR_NAME.test(k)) headCheck(`useHead: ignoring invalid attribute name "${k}" on <${d.tag}>`, { reason: "invalid-attribute", detail: k });
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

/** A head check's finding (dev), located by component. */
const headCheck = (message: string, data: Record<string, unknown>) => devCheck({ code: "HEAD_TAG_INVALID", kind: "head", severity: "warn", message: "[HEAD_TAG_INVALID] " + message, data });

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
  const props: Record<string, unknown> = {};
  for (const k in d.props) props[k] = evalHead(d.props[k]);
  return resourceIdentity(d.tag, props);
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
  // (The slot is written with the head: none, nothing to look for in the page.)
  if (!h.placed || !shell.includes(HEAD_SLOT)) return shell;
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
  return markup + `<script${nonceAttr(r.nonce, "script")}>${code}</script>`;
}

// ---------------------------------------------------------------- render entry points

/** An async node's answer, sent to the client under its id (once; nothing under NoHydration). */
const noopFn = () => {};
function sendAnswer(node: any, answer: unknown) {
  const r = render;
  // Data marked deferStream holds the shell until it lands, wherever it is first asked (as Solid's serialize).
  if (r && node?.deferStream && !r.shellSent && answer && typeof (answer as any).then === "function")
    r.blocks.add((answer as Promise<unknown>).then(noopFn, noopFn));
  const id = node?.id as string | undefined;
  if (!r?.serializer || id == null || isNoHydration() || !sharedConfig.context || r.written.has(id)) return;
  r.written.add(id);
  r.serializer.write(id, awaitData(r, answer, id));
}
/** A value still to come (a promise, or an async source's values): the stream stays open until it has all been written. */
function awaitData<V>(r: Render, v: V, id?: string): V {
  if (!isData(v)) return v;
  r.pendingData++;
  let open = true;
  const done = () => open && ((open = false), id != null && r.abandons.delete(id), queueMicrotask(() => (r.pendingData--, r.wake?.())));
  if (id != null) r.abandons.set(id, Object.assign(done, { [DATA]: true }));
  // (A promise as it is, the serializer's to write; one that answers with a source, held until that ends.)
  if (typeof (v as any).then === "function" && !(v as any)[SOURCE_ANSWER]) return (v as any).then(done, done), v;
  return held(v, done);
}
// (A source counts only when it is the client's reader of one Twist split: anything else goes to the serializer as it is.)
const isData = (v: any) => !!v && (typeof v.then === "function" || v.__SEROVAL_STREAM__ === true || (typeof v[Symbol.asyncIterator] === "function" && !!v[SOURCE_ANSWER]));
/** An answer's value with `done` called once the sources inside it (plain objects' and arrays') have all ended. */
function heldInside(x: any, done: () => void): any {
  let left = 1;
  const part = () => () => --left === 0 && done();
  const map = (v: any, seen: Map<object, any>): any => {
    if (!v || typeof v !== "object") return v;
    if (typeof v[Symbol.asyncIterator] === "function" && typeof v.then !== "function") return left++, held(v, part());
    if (seen.has(v)) return seen.get(v);
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v;
    let copy: any = null;
    for (const k of Object.keys(v)) {
      const c = map(v[k], seen);
      if (c !== v[k]) (copy ??= Array.isArray(v) ? [...v] : { ...v })[k] = c;
    }
    seen.set(v, copy ?? v);
    return copy ?? v;
  };
  const out = map(x, new Map());
  part()();
  return out;
}
/** `v` with `done` called once it has all come: a promise when it settles (or, answering with a source, when that ends). */
function held(v: any, done: () => void): any {
  // (A serialized stream: done when it returns or throws.)
  if (v.__SEROVAL_STREAM__ === true) return v.on({ next() {}, throw: done, return: done }), v;
  if (typeof v.then === "function") return v.then((x: any) => (x && typeof x[Symbol.asyncIterator] === "function" ? held(x, done) : heldInside(x, done)), (e: unknown) => (done(), Promise.reject(e)));
  // (A source: done when it ends, fails or is let go of. Only the iterator method shows: what is serialized is the
  // source, not its reader's methods.)
  const it = v[Symbol.asyncIterator]();
  const reader = {
    next: (...a: any[]) => Promise.resolve(it.next(...a)).then((x: IteratorResult<unknown>) => (x.done && done(), x), (e: unknown) => (done(), Promise.reject(e))),
    return: (x?: unknown) => (done(), it.return ? it.return(x) : Promise.resolve({ done: true, value: x })),
  };
  return { [Symbol.asyncIterator]: () => reader };
}

/** The data not yet sent, as a script (the scope's header ahead of the first). */
function takeData(r: Render): string {
  if (!r.data) return "";
  const s = (r.headerSent ? "" : headerScript(r.options.renderId)) + r.data;
  r.headerSent = true;
  r.data = "";
  return `<script${nonceAttr(r.nonce, "script")}>${s}</script>`;
}

function rendering<T>(r: Render | null, options: { renderId?: string; noHydrate?: boolean }, fn: () => T): T {
  const wasRender = render;
  sharedConfig.context = options.noHydrate ? null : (r?.ctx ?? stringCtx ?? stringContext(options.renderId ?? ""));
  render = r;
  const wasHead = head;
  if (r) head = r.head;
  setServerAnswers(r?.answers ?? null);
  setServerFly(r?.serializer ? sendAnswer : null);
  const wasServer = setServerRender(true);
  const wasScope = setServerScope(r ? { key: r, enter: (f) => rendering(r, options, f) } : null);
  try {
    return fn();
  } finally {
    setServerScope(wasScope);
    setServerRender(wasServer);
    // (The context stays the global one: whichever render touched it last, as Solid leaves it.)
    render = wasRender;
    head = wasHead;
    setServerAnswers(wasRender?.answers ?? null);
    setServerFly(wasRender?.serializer ? sendAnswer : null);
  }
}

setRouteDeclarer(() => (sharedConfig.context as any)?._declareRoute);

/** A render's trace: its request's, or (outside one) its own. */
function traceOfRender(ctx: object) {
  const event = getRequestEvent();
  return event ? traceForEvent(event as any) : traceFor(ctx, undefined);
}

/** A server render's "render" record, when something listens: told once, at settle. */
function renderRecord(ctx: any, mode: "string" | "stream") {
  const records = OBSERVE?.records;
  if (!records?.observed("render")) return null;
  const at = Date.now();
  let route: any;
  let shellAt: number | undefined;
  let told = false;
  ctx._declareRoute = (ref: unknown) => void (route = ref);
  return {
    shell: () => void (shellAt ??= Date.now()),
    settle(outcome: "complete" | "abandoned" | "error", boundaries: number) {
      if (told) return;
      told = true;
      const event: Record<string, unknown> = { mode, at, durationMs: Date.now() - at, boundaries, outcome };
      if (shellAt !== undefined) event.shellMs = shellAt - at;
      // (The route as it stands now: a match refined during the render is what lands.)
      if (route) {
        const named: Record<string, unknown> = {};
        for (const k of ["name", "to", "params"]) if (route[k] !== undefined) named[k] = route[k];
        event.route = named;
      }
      // (Told under an owner of the render: its listener reads this render's trace, whatever renders now.)
      const o = runWithOwner(null, () => createOwner()) as any;
      o.renderCtx = ctx;
      runWithOwner(o, () => records.emit("render", event, { trace: ctx.trace?.context, event: ctx.event ?? getRequestEvent() }));
    },
  };
}

export function renderToString(code: () => any, options: { renderId?: string; noHydrate?: boolean; manifest?: any; nonce?: string | { script?: string; style?: string }; onHead?: (head: string) => void; onError?: (error: unknown, context: any) => unknown } = {}): string {
  const wasHead = head;
  const wasCtx = stringCtx;
  const tracking = createAssetTracking();
  head = newHead(tracking.resources);
  const nonce = normalizeNonce(options.nonce);
  const ctx = (stringCtx = stringContext(options.renderId ?? "")) as any;
  ctx.errorPolicy = options.onError;
  fileRequestHook(options.onError);
  // What the client hydrates with: values known now (a string render sends nothing that is still to come).
  let data = "";
  const serializer = options.noHydrate ? null : createHydrationSerializer({ scopeId: options.renderId, onData: (p: string) => void (data += p + ";"), onDone() {}, onError: serializeFailed(options.onError) });
  const written = new Set<string>();
  ctx.serialize = (id: string, v: unknown) => {
    if (!serializer || written.has(id) || (v && typeof (v as any).then === "function")) return;
    written.add(id);
    serializer.write(id, v);
  };
  ctx.registerAsset = (type: string, value: unknown) => registerAssetIn(tracking, () => false, null, type, value, nonce);
  applyAssetTracking(ctx, tracking, options.manifest);
  ctx.trace = traceOfRender(ctx);
  const record = renderRecord(ctx, "string");
  let outcome: "complete" | "error" = "error";
  try {
    const page = rendering(null, options, () => {
      registerEntryAssets(ctx, options.manifest);
      return createRoot(
        (dispose) => {
          try {
            // (No head rendered: no page to look through for one.)
            const page = fillHead(html(code(), false), head!, false) as string;
            const out = withHeadAssets(page, tracking, head, nonce, options.onHead);
            // (The response head as declared, frozen before the render is disposed: what it declared stays.)
            const ev = getRequestEvent();
            if (ev?.response) commitResponseStub(ev.response, { event: ev });
            return data ? out + `<script${nonceAttr(nonce, "script")}>${headerScript(options.renderId)}${data}</script>` : out;
          } catch (e) {
            // A render that fails: the hook hears it (the request fails), then the caller.
            reportServerError(e, { kind: "render", handling: "failed" }, null, options.onError);
            throw e;
          } finally {
            dispose();
          }
        },
        { id: options.renderId ?? "" },
      );
    });
    outcome = "complete";
    return page;
  } finally {
    head = wasHead;
    stringCtx = wasCtx;
    record?.settle(outcome, 0);
  }
}
/** A value the serializer could not write: the render's hook hears it (the page goes on without it). */
const serializeFailed = (hook: any) => (e: unknown) => void reportServerError(e, { kind: "serialize", handling: "serialize" } as any, null, hook);
/** A render's onError filed as the hook of the request it serves (when it serves one). */
function fileRequestHook(hook: any) {
  const event = getRequestEvent();
  if (event && hook) setRequestErrorHook(event, hook);
}
/** The context of the string render under way. */
let stringCtx: any = null;

type Writable = { write(chunk: string): void; end(): void };

/** A value rendered to Solid's template shape: its html, or a hole (re-resolved once `p` settles) when it waits. */
function resolveTemplate(v: any): { t: string[]; h: any[]; p: Promise<unknown>[] } {
  try {
    return { t: [html(v, false)], h: [], p: [] };
  } catch (e) {
    const waits = e instanceof NotReadyError && settlesOf(e);
    if (!waits) throw e;
    return { t: ["", ""], h: [v], p: [waits] };
  }
}

/** The context a string render's code reads: nothing waits, nothing is sent. */
function stringContext(id: string) {
  return { id, count: 0, async: false, document: true, escape, ssr, resolve: resolveTemplate, serialize() {}, block() {}, replace() {}, registerAsset() {}, hold: () => () => {} };
}

/** The context of a stream: Solid's render context API over this render. */
function streamContext(r: Render, options: StreamOptions) {
  return {
    errorPolicy: options.onError,
    id: options.renderId ?? "",
    count: 0,
    async: true,
    nonce: options.nonce,
    document: !options.sink,
    live: {},
    escape,
    ssr,
    resolve: resolveTemplate,
    serialize(id: string, p: unknown, deferStream?: boolean) {
      if (!r.serializer) return;
      if (deferStream && !r.shellSent && p && typeof (p as any).then === "function") r.blocks.add(p as Promise<unknown>);
      r.serializer.write(id, awaitData(r, p, id));
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
      registerAssetIn(r.tracking, () => r.shellSent, r.sink, type, value, r.nonce);
    },
    /** A fragment of the caller's: its record serialized now, its content to the sink when given. */
    registerFragment(key: string, opts?: { revealGroup?: string }) {
      let settle!: (v: unknown) => void;
      let fail!: (e: unknown) => void;
      const record = new Promise((ok, no) => ((settle = ok), (fail = no)));
      record.catch(() => {});
      r.serializer?.write(key + "_fr", record);
      let done = false;
      // (The stream stays open until it is done.)
      r.holds++;
      return (value?: string, error?: unknown) => {
        if (done) return r.shellSent;
        done = true;
        r.holds--;
        serializeFragmentAssets(key, r.tracking, r.ctx);
        r.sink.fragment(key, value !== undefined ? value : " ", { styles: collectStreamStyles(key, r.tracking, r.headStyles), revealGroup: opts?.revealGroup, error });
        queueMicrotask(() => (error ? fail(error) : settle(true)));
        r.wake?.();
        return r.shellSent;
      };
    },
    revealFragments(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      r.sink.reveal(list, { fallback: false });
      // (A grouped boundary's record goes when the group reveals it: its hold measured.)
      for (const k of list) {
        const t = r.tracks?.get(k);
        if (t && t.outcome !== undefined && !t.told) tellBoundary(t, performance.now());
      }
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
  nonce?: string | { script?: string; style?: string };
  onCompleteShell?: (info: { write: (chunk: string) => void }) => void;
  onCompleteAll?: (info: { write: (chunk: string) => void }) => void;
  /** A sink of the caller's in place of the document (what the render makes goes there). */
  sink?: Partial<Sink>;
  /** Where the head goes when the page has none (a render embedded in the caller's document). */
  onHead?: (head: string) => void;
  /** The serializer data is written with (the hydration serializer by default). */
  serializer?: (options: any) => any;
  plugins?: any[];
  signal?: AbortSignal;
  /** Where lazy() components' client assets come from (a Vite manifest, or a resolver). */
  manifest?: any;
  /** This render's server error hook (ahead of the ambient one). */
  onError?: (error: unknown, context: any) => unknown;
};

/** The shell at once, then each boundary as it settles; awaited, the whole document. */
export function renderToStream(code: () => any, options: StreamOptions = {}) {
  const r: Render = { async: true, waiting: new Set(), chunks: [], wake: null, revealScript: false, answers: new Map(), options, holes: new Map(), shellSent: false, head: null as any, data: "", serializer: null, written: new Set(), pendingData: 0, headerSent: false, sink: null as any, ctx: null, blocks: new Set(), holds: 0, inlined: new Map(), tracking: createAssetTracking(), headStyles: null, nonce: normalizeNonce(options.nonce), abandons: new Map() };
  r.head = newHead(r.tracking.resources);
  // Its hook is its request's: a server function the request calls later reports to it.
  fileRequestHook(options.onError);
  // (The request it renders for: its response head freezes once the shell goes out.)
  const requestEvent = getRequestEvent();
  // The document: html text, data as script, each fragment as a template and its reveal.
  let documentShell = "";
  const documentSink: Sink = {
    data: (payload: string) => void (r.data += payload + ";"),
    fragment: (key, value, meta) => {
      const styles = meta.styles ?? { inline: [], links: [] };
      let out = takeData(r) + (meta.patch ?? "");
      for (const entry of styles.inline) out += renderInlineStyle(entry, r.nonce);
      if (styles.links.length) {
        out += script(r, `$dfs("${key}",${styles.links.length},${meta.revealGroup ? 1 : 0})`) + `<template id="${key}">${value}</template>`;
        for (const entry of styles.links)
          out += typeof entry === "string" ? `<link rel="stylesheet" href="${entry}" data-dfc="${key}">` : `<link${entry.attrHtml} data-dfc="${key}">`;
      } else out += `<template id="${key}">${value}</template>` + (meta.revealGroup ? "" : script(r, `$df("${key}")`));
      r.chunks.push(out);
    },
    reveal: (keys, meta) => void r.chunks.push(takeData(r) + script(r, `${meta.fallback ? "$dflj" : "$dfj"}(${JSON.stringify(keys)})`)),
    asset(type, value: any) {
      if (type === "module") r.chunks.push(`<link rel="modulepreload" href="${value}">`);
      else if (type === "preload") r.chunks.push(`<link${value.attrHtml}>`);
      else if (type === "inline-style") r.chunks.push(renderInlineStyle(value, r.nonce));
      else if (type === "head-tag") r.chunks.push(value);
    },
    shell: (html) => void (documentShell = withHeadAssets(html, r.tracking, r.head, r.nonce, options.onHead) + takeData(r)),
  };
  r.sink = { ...documentSink, ...options.sink } as Sink;
  r.ctx = streamContext(r, options);
  (r.ctx as any).trace = traceOfRender(r.ctx);
  const record = renderRecord(r.ctx, "stream");
  applyAssetTracking(r.ctx, r.tracking, options.manifest);
  rendering(r, options, () => registerEntryAssets(r.ctx, options.manifest));
  if (!options.noHydrate) r.serializer = (options.serializer ?? createHydrationSerializer)({ scopeId: options.renderId, plugins: options.plugins, onData: (p: unknown) => (r.sink.data(p), r.wake?.()), onDone() {}, onError: serializeFailed(options.onError) });
  let dispose!: () => void;
  let root!: any;
  // The shell: rendered again (from the same ids) while something outside every Loading is not ready.
  // A root failure on the first, synchronous pass: heard by the hook, then thrown to the caller.
  let syncFailure: { error: unknown } | null = null;
  let firstPass = true;
  const shellReady = new Promise<string>((ok, fail) => {
    // (A boundary failing before the shell goes out fails the request with it.)
    (r as any).failShell = fail;
    const attempt = () => {
      try {
        filled(r, rendering(r, options, () => runWithOwner(root, () => html(code(), false))))
          .then(async (shell) => {
            // What blocks the shell, until none is left: settling one can register another (a lazy chunk's data). The
            // flush itself waits a macrotask, as Solid's: a boundary settling within microtasks goes out inline.
            const macrotask = () => new Promise((ok) => (typeof setImmediate === "function" ? setImmediate(ok) : setTimeout(ok, 0)));
            do {
              while (r.blocks.size) {
                const now = [...r.blocks];
                await Promise.allSettled(now);
                for (const p of now) r.blocks.delete(p);
              }
              await macrotask();
            } while (r.blocks.size);
            return shellHead(r, shell);
          })
          .then(ok, fail);
      } catch (e) {
        const waits = e instanceof NotReadyError && settlesOf(e);
        if (!waits && firstPass) return void (syncFailure = { error: e });
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
    firstPass = false;
  });
  if (syncFailure) {
    reportServerError(syncFailure.error, { kind: "render", handling: "failed" }, null, options.onError);
    dispose();
    throw syncFailure.error;
  }
  let shell = "";
  const sinks: Writable[] = [];
  let sent = 0;
  let done = false;
  const drain = () => {
    // Ended: the sinks are closed (a wake-up after the last write has nothing left to send).
    if (done) return;
    // (Nothing left that renders: the document's live channel gets its last sweep and closes — before the data's end,
    // which it would otherwise hold open.)
    endLive(r);
    const data = takeData(r);
    if (data) r.chunks.push(data);
    for (; sent < r.chunks.length && !done; sent++) for (const w of sinks) write(w, r.chunks[sent]!);
    // A frame stream ends after its serializer's last record (a trace still writing is part of the response).
    if (!r.waiting.size && !r.pendingData && !r.holds && !done && (options.sink || (r as any).liveClosing) && (r.serializer as any)?.pending > 0) {
      (typeof setImmediate === "function" ? setImmediate : setTimeout)(() => r.wake?.(), 0);
      return;
    }
    if (!r.waiting.size && !r.pendingData && !r.holds && !done) {
      options.onCompleteAll?.({ write: (chunk) => sinks.forEach((w) => write(w, chunk)) });
      done = true;
      record?.settle("complete", r.tracks?.size ?? 0);
      dispose();
      for (const w of sinks) w.end();
      finished();
    }
  };
  let finished!: () => void;
  const all = new Promise<void>((ok) => (finished = ok));
  let shellSent = false;
  // Awaited whole (no consumer piped): the document once everything settled, every boundary inline.
  let whole = false;
  const idle: (() => void)[] = [];
  const quiet = () => !r.waiting.size && !r.holds;
  r.wake = () =>
    queueMicrotask(() => {
      if (idle.length && quiet()) for (const ok of idle.splice(0)) ok();
      if (shellSent) rendering(r, options, drain);
    });
  /** The response abandoned (aborted, or its consumer gone): the render torn down, its sources returned, nothing more sent. */
  const abandon = (end: boolean, outcome: "abandoned" | "error" = "abandoned", reason?: "sink" | "signal" | "consumer") => {
    if (done) return;
    done = true;
    record?.settle(outcome, r.tracks?.size ?? 0);
    if (reason && process.env.NODE_ENV !== "production")
      emitDiagnostic({
        code: "SSR_STREAM_ABANDONED",
        kind: "ssr",
        severity: "warn",
        message: `[SSR_STREAM_ABANDONED] The response was abandoned (${reason}) before it finished: ${r.waiting.size} fragment(s) still to come were dropped and the render torn down.`,
        data: { reason, pendingFragments: r.waiting.size, shellFlushed: shellSent },
      });
    dispose?.();
    if (end) for (const w of sinks) close(w);
    finished();
  };
  /** A consumer done with: ended, or told the shell never came (one that can answer otherwise, a response's sink). */
  const close = (w: Writable) => (!shellSent && (w as any)[SHELL_ABANDONED] ? (w as any)[SHELL_ABANDONED]() : w.end());
  /** A write to a consumer; one that throws is gone. */
  const write = (w: Writable, chunk: string) => {
    try {
      w.write(chunk);
    } catch {
      abandon(false, "abandoned", "sink");
    }
  };
  // (A request aborted after the shell: a disconnect, the sink not touched again; before it, the response ends.)
  // (Ended quietly by its owner — a frame response cut at a bound — is no abandonment to report.)
  const onAbort = () => abandon(!shellSent, "abandoned", (options.signal as any).reason?.quiet ? undefined : "signal");
  // (Aborted before it began: no event will come, none listened for.)
  if (options.signal?.aborted) abandon(true);
  else if (options.signal) {
    options.signal.addEventListener("abort", onAbort, { once: true });
    // (Let go of once the response is over: the request's signal outlives it.)
    void all.then(() => options.signal!.removeEventListener("abort", onAbort));
  }
  let readable: ReadableStream<Uint8Array> | null = null;
  const failed = shellReady.then(
    async (s) => {
      if (whole && !quiet()) await new Promise<void>((ok) => idle.push(ok));
      // (All settled before the shell: the live channel closes with it.)
      endLive(r);
      rendering(r, options, () => {
        serializeFragmentAssets("", r.tracking, r.ctx, options.renderId ?? "");
        r.headStyles = new Set([...r.tracking.emittedAssets].filter((u) => !r.tracking.currentBoundaryId && u.endsWith(".css")));
        r.sink.shell(inlineFragments(r, s), { preloads: r.tracking.emittedAssets, preloadLinks: r.tracking.preloadLinks });
      });
      shell = documentShell;
      shellSent = true;
      if (requestEvent?.response) commitResponseStub(requestEvent.response, { event: requestEvent });
      record?.shell();
      r.shellSent = true;
      // (One settled inside a placeholder that was itself streamed: it streams too.)
      for (const [id, content] of r.inlined) r.sink.fragment(id, content, { styles: { inline: [], links: [] } });
      r.inlined.clear();
      const extra: string[] = [];
      options.onCompleteShell?.({ write: (chunk) => void extra.push(chunk) });
      for (const w of sinks) write(w, shell);
      for (const chunk of extra) for (const w of sinks) write(w, chunk);
      rendering(r, options, drain);
    },
    (e) => {
      // A failure on a later pass: nothing on the stack to throw to — the request fails, the stream ends.
      if (!reportServerError(e, { kind: "render", handling: "failed" }, null, options.onError).heard) console.error(e);
      abandon(true, "error");
    },
  );
  return {
    then<A, B>(ok?: (html: string) => A, fail?: (e: unknown) => B) {
      if (!shellSent && !sinks.length) whole = true;
      return failed.then(() => all).then(() => shell + r.chunks.join("")).then(ok, fail);
    },
    pipe(w: Writable) {
      // (A consumer that may stop the render: given the way to.)
      if ((w as any)[SHELL_ABANDONED]) (w as any)[ABANDON_RENDER] = (reason?: "consumer") => abandon(false, "abandoned", reason);
      if (shellSent) write(w, shell);
      for (let i = 0; i < sent; i++) write(w, r.chunks[i]!);
      sinks.push(w);
      if (done) close(w);
    },
    pipeTo(ws: WritableStream<any>) {
      const writer = ws.getWriter();
      const enc = new TextEncoder();
      // A writable that errors (a reader cancelled, the transport gone): the response is abandoned.
      const gone = () => abandon(false, "abandoned", "consumer");
      writer.closed.catch(gone);
      return new Promise<void>((ok) =>
        this.pipe({
          write: (c) => void writer.write(enc.encode(c)).catch(gone),
          end: () => void writer.close().then(ok, () => ok()),
        }),
      );
    },
    /** The response as a web stream (`new Response(stream.readable)`); cancelled, the render is abandoned. */
    get readable() {
      if (!readable) {
        const enc = new TextEncoder();
        let open = true;
        readable = new ReadableStream<Uint8Array>({
          start: (c) =>
            this.pipe({
              write: (chunk) => void (open && c.enqueue(enc.encode(chunk))),
              end: () => void (open && ((open = false), c.close())),
            }),
          cancel: () => {
            open = false;
            abandon(false, "abandoned", "consumer");
          },
        });
      }
      return readable;
    },
  };
}

export { NotReadyError, untrack, isChildren };

/** A consumer's ways in the stream protocol: told the shell was abandoned; given how to abandon the render. */
const SHELL_ABANDONED = Symbol.for("twist.ssr.shellAbandoned");
const ABANDON_RENDER = Symbol.for("twist.ssr.abandonRender");

/**
 * A render as a web Response (Solid's createSSRResponse): a string at once; a stream once its shell is ready, with
 * the head the render wrote (status, headers, a redirect answered as one), a render that fails before its shell
 * answered 500, and a redirect set after the shell left done in the page.
 */
export function createSSRResponse(result: any, event?: RequestEvent, options: { responseInit?: ResponseInit; transformChunk?: (chunk: string) => string; nonce?: string } = {}): Response | Promise<Response> {
  const stub = event?.response;
  const { responseInit, transformChunk } = options;
  const respond = (body: BodyInit | null, late = false) => {
    if (stub) commitResponseStub(stub, { event, ...(late ? { allowLateLocation: true } : {}) });
    const head = deriveHead(stub, responseInit);
    if (stub?.headers.get("Location")) return { redirect: new Response(null, { status: getExpectedRedirectStatus(stub), headers: head.headers }) };
    if (!head.headers.has("content-type")) head.headers.set("content-type", "text/html; charset=utf-8");
    return { response: new Response(body, { status: head.status, statusText: head.statusText, headers: head.headers }) };
  };
  if (typeof result === "string") {
    const r = respond(transformChunk ? transformChunk(result) : result);
    return r.redirect ?? r.response!;
  }
  const encoder = new TextEncoder();
  return new Promise((resolve) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closed = false;
    let flushed = false;
    const enqueue = (v: string) => {
      if (closed || !controller) return;
      try {
        controller.enqueue(encoder.encode(v));
      } catch {
        closed = true;
      }
    };
    const sink: any = {
      write(chunk: string) {
        if (!flushed) {
          flushed = true;
          const stream = new ReadableStream<Uint8Array>({
            start: (c) => void (controller = c),
            cancel: () => {
              if (closed) return;
              closed = true;
              // (The reader left: a disconnect.)
              sink[ABANDON_RENDER]?.("consumer");
            },
          });
          const r = respond(stream, true);
          if (r.redirect) {
            closed = true;
            resolve(r.redirect);
            sink[ABANDON_RENDER]?.();
            return;
          }
          resolve(r.response!);
        }
        enqueue(transformChunk ? transformChunk(chunk) : chunk);
      },
      end() {
        if (!flushed) sink.write("");
        if (closed || !controller) return;
        // A redirect set after the head left: done in the page.
        const location = stub?.headers.get("Location");
        if (location && isHttpNavigationTarget(location)) {
          const nonce = options.nonce ? ` nonce="${escape(options.nonce, true)}"` : "";
          enqueue(`<script${nonce}>window.location=${JSON.stringify(location).replace(/</g, "\\u003c")}</script>`);
        }
        closed = true;
        try {
          controller.close();
        } catch {}
      },
      [SHELL_ABANDONED]() {
        if (flushed) return;
        flushed = closed = true;
        if (stub) commitResponseStub(stub, { event });
        const head = deriveHead(stub, responseInit);
        resolve(new Response(null, { status: stub?.headers.get("Location") ? getExpectedRedirectStatus(stub) : 500, headers: head.headers }));
      },
    };
    result.pipe(sink);
  });
}
