// Twist's server runtime (`@solidjs/web` on a server): JSX makes descriptions, rendered to HTML top-down so hydration
// keys are taken in document order, as the client claims them. A template's root element takes a key; elements nested
// in the same template do not; elements made at run time (dynamic tags, spreads into ssrElement) do.
declare const process: { env: Record<string, string | undefined> };
import { ssrScope, createMemo, createOwner, createRoot, getNextChildId, getOwner, NotReadyError, resetOwnerForRerun as resetOwner, runWithOwner, untrack, onCleanup, merge, omit, isStatic, NoHydrateContext, getProjectionTrace, SOURCE_ANSWER, type Owner } from "./server/signals.ts";
import { sharedConfig } from "./server/shared.ts";
import { childIdCount, setChildIdCount, keyOwnerOf, inIdScope, idPlace, standing, settlesOf, fileRenderRoot, renderContextOf } from "./server/twist.ts";
import { OBSERVE, emitDiagnostic, setRouteDeclarer } from "./diagnostics.ts";
import { createHydrationSerializer, getLocalHeaderScript as headerScript } from "./serialization.ts";
import { __twist_mark, markBuiltin, renderComponent, componentProps, createComponent, isChildren, isDynamic, setDescribedNode, erroredFallback } from "./server/control.ts";
import { createLoadingBoundary, ssrHandleError } from "./server/hydration.ts";
import { createErrorBoundary } from "./server/signals.ts";
import { Reveal as layerReveal } from "./server/flow.ts";

// (Solid's server API by name; this module's Loading, Errored… over the layer's.)
export * from "./server/index.ts";
export { lazy } from "./server-solid.ts";
export * from "./server/control.ts";
export { createComponent } from "./server/control.ts";
export * from "./response.ts";
export { CLAIMS_STREAM, CLAIMS_DOCUMENT, SLOT_VALUE, SLOT_MARKER, SLOT_FACE_STREAM, SLOT_FACE_DATA, SLOT_FACE_MARKUP, slotValue, isSlotValue, ssrClaim } from "./server-slots.ts";
export { createLiveHoles } from "./server-live.ts";
import { commitResponseStub, deriveHead, devCheck, getRequestEvent, peekRequestEvent, setRequestErrorHook, getExpectedRedirectStatus, reportServerError, ssrSanitizeError, type RequestEvent } from "./request.ts";
import { isHttpNavigationTarget } from "./response.ts";
// The container tier's server half (projections cross a frame's border as traces), as Solid's server entry installs it.
import { setAsyncIterableSharer, setContainerTraceResolver, toBorderForm } from "./frames/frame-container-plugin.ts";
import { traceFor, traceForEvent, traceMetaMarkup } from "./trace.ts";
import { shareAsyncIterable } from "./server-internal.ts";
import { expand, hasHoles, type Spec } from "./tags.ts";
setContainerTraceResolver(getProjectionTrace);
setAsyncIterableSharer(shareAsyncIterable);
/** An owner made under `parent` (given its id, unless transparent). */
/** A dynamic hole's id scope (Solid's ssrScope): one id taken now, what it makes taking ids under it each run. */
const idScope = <T,>(fn: () => T) => ssrScope(fn) as () => T;
const ownerUnder = (parent: Owner | null, options?: { transparent?: boolean; id?: string }) => runWithOwner(parent, () => createOwner(options));
/** A value on an owner's own context record (what is made under it inherits it). */
const putContext = (o: any, key: symbol, value: unknown) => void (o._context = { ...o._context, [key]: value });
import { applyAssetTracking, collectStreamStyles, createAssetTracking, nonceAttr, normalizeNonce, preloadLink, registerEntryAssets, renderHeadAssets, renderInlineStyle, resourceIdentity, serializeFragmentAssets, type AssetTracking, type Nonce } from "./server-assets.ts";
import { isSlotValue, slotAttribute, slotClassOrStyle, slotSpreadSource, spreadBehaviorMarkers, spreadBehaviorPosition, spreadPropPosition } from "./server-slots.ts";
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
/** A template's own element with nothing special about it: written straight from its spec when its parent is (no
 * description made), from `start` in its template's values. */
const LAZY = Symbol("twist.ssr.lazy-element");
type Lazy_ = { [LAZY]: true; spec: Spec; meta: SpecMeta; values: unknown[]; start: number; keyed?: boolean };
/** Whether `v` is markup made here and not rendered yet (Twist's JSX describes; html() renders). */
export const isServerNode = (v: any) => !!v && typeof v === "object" && (v[EL] === true || v[COMP] === true || v[LAZY] === true);

type Element_ = { [EL]: true; tag: string; props: any; children?: any; keyed?: boolean; owner?: any; skip?: (k: string) => boolean; attrs?: string; sources?: boolean; keys?: string[]; tagIs?: TagFacts; ops?: Op[]; values?: unknown[]; made?: any };
type Component_ = { [COMP]: true; fn: (props: any) => any; props: Record<string, any> };

export const Fragment = (props: { children?: unknown }) => props.children;

/**
 * A compiled template on the server: the element the JSX stands for, its static attributes rendered once and each
 * fixed part as its HTML (rendered the first time). Static attributes after one set at run time: the JSX itself, so
 * attributes keep their order.
 */
export const __twist_t = (spec: Spec) => {
  let meta: SpecMeta | undefined;
  return (values: unknown[]) => {
    // (Keyed under the owner that made it, as Solid's template takes its key where it is made.)
    meta ??= spec[4] ? undefined : metaOf(spec);
    // (Plain all through: written from its compiled parts; its props made only if something reads them.)
    if (meta?.plain) return new PlainEl(spec, meta, values, getOwner());
    const d = described(spec, values, { i: 0 }, meta);
    if (d && d[EL]) d.owner = getOwner();
    return d;
  };
};
/** A plain template's element: what element() needs at hand, its props (a description's) made the first time they are
 * read. Written from its compiled parts while they are the ones it made. */
class PlainEl {
  declare owner: any;
  declare ops: Op[];
  declare values: unknown[];
  declare tag: string;
  declare keyed?: boolean;
  declare made?: any;
  declare spec: Spec;
  declare meta: SpecMeta;
  constructor(spec: Spec, meta: SpecMeta, values: unknown[], owner: any) {
    this.spec = spec;
    this.meta = meta;
    this.values = values;
    this.owner = owner;
    this.tag = spec[0];
    this.ops = opsOf(spec, meta);
    if (process.env.NODE_ENV !== "production") for (const [sp, i] of (this.ops as any).holes as [Spec, number][]) holeValue(sp, values, { i });
  }
  get props(): any {
    const d = described(this.spec, this.values, { i: 0 }, this.meta);
    Object.defineProperty(this, "props", { value: d.props, writable: true, configurable: true, enumerable: true });
    this.made = d.props;
    return d.props;
  }
  set props(v: any) {
    Object.defineProperty(this, "props", { value: v, writable: true, configurable: true, enumerable: true });
  }
  get attrs() {
    return this.meta.attrs;
  }
  get keys() {
    return this.meta.keys!;
  }
  get tagIs() {
    return this.meta.tagIs;
  }
}
(PlainEl.prototype as any)[EL] = true;
const fixedHtml = new WeakMap<Spec, { t: string }>();
/** What a template element's spec gives every element made from it, worked out once: its fixed attributes, its fixed
 * text (escaped), and its prop keys when they need no checking (no spread among them). */
type SpecMeta = { attrs: string; kids: any[]; kinds: number[]; inner: (SpecMeta | undefined)[]; keys: string[] | null; tagIs: TagFacts; size: number; plain: boolean };
/** A template child: a hole, text, an element with holes, a fixed element (its HTML kept in `kids` once made). */
const HOLE = 0;
const TEXT = 1;
const INNER = 2;
const FIXED = 3;
/** What an element's tag means for its markup (worked out once per template). */
type TagFacts = { void: boolean; raw: boolean };
const specMeta = new WeakMap<Spec, SpecMeta>();
function metaOf(spec: Spec): SpecMeta {
  let m = specMeta.get(spec);
  if (m) return m;
  const [tag, fixed, slots, kids] = spec;
  let attrs = "";
  for (let i = 0; i < fixed.length; i += 2) attrs += ssrAttribute(fixed[i]!, fixed[i + 1]);
  const texts = kids.map((k) => (typeof k === "string" ? (RAW_TEXT.has(tag) ? k : { t: k.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") }) : undefined));
  const kinds = kids.map((k) => (k === 0 ? HOLE : typeof k === "string" ? TEXT : hasHoles(k) ? INNER : FIXED));
  const inner = kids.map((k, i) => (kinds[i] === INNER && !(k as Spec)[4] ? metaOf(k as Spec) : undefined));
  // (Plain attribute names only: anything else goes through the general checks.)
  const keys = slots.every((k) => !k.startsWith("$spread$") && ATTR_NAME.test(k)) ? [...slots, ...(kids.length ? ["children"] : [])] : null;
  validTag(tag);
  // (How many of the template's values it takes; whether it can be written without its description.)
  let size = slots.length;
  for (let i = 0; i < kids.length; i++) size += kinds[i] === HOLE ? 1 : kinds[i] === INNER ? (inner[i]?.size ?? countValues(kids[i] as Spec)) : 0;
  const plain = keys !== null && !SPECIAL_TAGS.has(tag) && kinds.every((k, i) => k !== INNER || inner[i] !== undefined) && slots.every((k) => k !== "children" && k !== "ref" && k !== "innerHTML" && k !== "textContent" && !/^on[A-Z]/.test(k) && !k.startsWith("prop:"));
  specMeta.set(spec, (m = { attrs, kids: texts, kinds, inner, keys, tagIs: { void: VOID.has(tag), raw: RAW_TEXT.has(tag) }, size, plain }));
  return m;
}
/** The values a spec with a spread takes (each of its slots and holes, and its own elements'). */
function countValues(spec: Spec): number {
  let n = spec[2].length;
  for (const k of spec[3]) n += k === 0 ? 1 : typeof k === "string" ? 0 : countValues(k);
  return n;
}
/** Tags whose markup depends on more than their attributes and children (written through their description). */
const SPECIAL_TAGS = /* @__PURE__ */ new Set(["html", "head", "body", "select", "option", "textarea", "script", "style", "title", "meta", "link", "base", "template"]);
function described(spec: Spec, values: unknown[], at: { i: number }, meta?: SpecMeta): any {
  if (spec[4]) return expand(spec, values, at, jsx, jsxs);
  const [tag, , slots, kids] = spec;
  meta ??= metaOf(spec);
  const props: Record<string, any> = {};
  for (let i = 0; i < slots.length; i++) props[slots[i]!] = values[at.i++];
  const { kids: parts, kinds, inner } = meta;
  const children: any[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    children.push(kind === HOLE ? holeValue(spec, values, at) : kind === TEXT ? parts[i] : kind === INNER ? innerElement(kids[i] as Spec, values, at, inner[i]) : (parts[i] ??= fixedPart(kids[i] as Spec)));
  }
  if (children.length > 1) ((children as any)[OWN] = true), (props.children = children);
  else if (children.length) props.children = children[0];
  const d = { [EL]: true, tag, props, attrs: meta.attrs, tagIs: meta.tagIs } as Element_;
  if (meta.keys) d.keys = meta.keys;
  return d;
}
/** A template's own element: lazy when plain (written from its spec), else described. */
function innerElement(spec: Spec, values: unknown[], at: { i: number }, meta: SpecMeta | undefined): any {
  if (!meta?.plain) return described(spec, values, at, meta);
  const z: Lazy_ = { [LAZY]: true, spec, meta, values, start: at.i };
  at.i += meta.size;
  return z;
}
/**
 * A plain template compiled once, as Solid compiles its server templates: its fixed markup in strings, and between them
 * what each render fills in, in the order the template's values come (an element's attributes, then its children).
 */
type Op =
  | string
  | { k: 0 } // the root's hydration key, when it is keyed
  | { k: 1; name: string } // an attribute's value
  | { k: 2; spec: Spec } // a lone hole: the element's only child
  | { k: 3; spec: Spec } // a hole among other children
  | { k: 4; spec: Spec; meta: SpecMeta | undefined } // an element with something special: described, then written
  | { k: 5 } // children begin: what follows goes into their list, as collect() writes it
  | { k: 6 }; // children end
const compiled = new WeakMap<Spec, Op[]>();
function opsOf(spec: Spec, meta: SpecMeta): Op[] {
  let ops = compiled.get(spec);
  if (ops) return ops;
  const out: Op[] = [];
  // (Where each hole's value is, with its element's spec: registered as the template is made, in development.)
  const holes: [Spec, number][] = [];
  let n = 0;
  const str = (t: string) => (typeof out[out.length - 1] === "string" ? (out[out.length - 1] = (out[out.length - 1] as string) + t) : out.push(t));
  const walk = (sp: Spec, m: SpecMeta, root: boolean) => {
    const [tag, , slots, kids] = sp;
    str("<" + tag);
    if (root) out.push({ k: 0 });
    for (const name of slots) out.push({ k: 1, name }), n++;
    str(m.attrs + ">");
    if (m.tagIs.void) return;
    const lone = kids.length === 1;
    // (A list only where a hole sits among other children: it needs the list state between them.)
    const listed = !lone && m.kinds.some((k) => k === HOLE);
    if (listed) out.push({ k: 5 });
    for (let i = 0; i < kids.length; i++) {
      const kind = m.kinds[i];
      if (kind === HOLE) out.push({ k: lone ? 2 : 3, spec: sp }), holes.push([sp, n++]);
      else if (kind === TEXT) str(m.kids[i].t ?? m.kids[i]);
      else if (kind === FIXED) str(fixedPart(kids[i] as Spec).t);
      else if (m.inner[i]?.plain) walk(kids[i] as Spec, m.inner[i]!, false);
      else out.push({ k: 4, spec: kids[i] as Spec, meta: m.inner[i] }), (n += m.inner[i]?.size ?? countValues(kids[i] as Spec));
    }
    if (listed) out.push({ k: 6 });
    str("</" + tag + ">");
  };
  walk(spec, meta, true);
  (out as any).holes = holes;
  compiled.set(spec, (ops = out));
  return ops;
}
/** A compiled template written with these values. */
function runOps(ops: Op[], values: unknown[], keyed: boolean): string {
  const at = { i: 0 };
  // What is being written: the markup, or (inside a children list) the list's markup since its last part — held until a
  // hole needs the list's state, then given as one part (as each piece would be one).
  let out = "";
  let cur: Parts | null = null;
  const outer: [Parts | null, string][] = [];
  for (let j = 0; j < ops.length; j++) {
    const op = ops[j]!;
    if (typeof op === "string") {
      out += op;
      continue;
    }
    switch (op.k) {
      case 0:
        if (keyed) out += ssrHydrationKey();
        break;
      case 1:
        out += ssrAttribute(op.name, read(values[at.i++]));
        break;
      case 2: {
        // (As children() writes an element's one child.)
        const raw = holeValue(op.spec, values, at);
        out += isDynamic(raw) ? dynamicKids(raw) : children(read(raw));
        break;
      }
      case 3: {
        // (As collect() writes a child among others: a function or a component between markers.)
        const x: any = holeValue(op.spec, values, at);
        if ((typeof x === "function" && !x.$esc) || (x && x[COMP])) out += "<!--$-->" + (x[COMP] ? html(x, false) : list([x], false, true)) + "<!--/-->";
        else {
          if (out) cur!.add(out, false, false), (out = "");
          collect([x], true, true, false, cur!);
        }
        break;
      }
      case 4:
        out += element(described(op.spec, values, at, op.meta), false);
        break;
      case 5:
        outer.push([cur, out]);
        cur = new Parts();
        out = "";
        break;
      case 6: {
        if (out) cur!.add(out, false, false);
        const done = cur!.out;
        [cur, out] = outer.pop()!;
        out += done;
        break;
      }
    }
  }
  return out;
}

/** A lazy element written: as element() writes its description (in a live frame's claims, through it). */
function lazyElement(z: Lazy_, keyed: boolean): string {
  const { spec, meta, values } = z;
  if ((sharedConfig.context as any)?.claims !== undefined) return element(described(spec, values, { i: z.start }, meta), keyed);
  const [tag, , slots, kids] = spec;
  const at = { i: z.start };
  let out = "<" + tag + (keyed ? ssrHydrationKey() : "");
  for (let i = 0; i < slots.length; i++) out += ssrAttribute(slots[i]!, read(values[at.i++]));
  out += meta.attrs;
  if (meta.tagIs.void) return out + ">";
  out += ">";
  if (kids.length === 1 && meta.kinds[0] === HOLE) {
    // (One hole, the commonest: no list.)
    const raw = holeValue(spec, values, at);
    out += isDynamic(raw) ? dynamicKids(raw) : children(read(raw));
  } else if (kids.length) {
    const { kids: parts, kinds, inner } = meta;
    const list: any[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      list.push(kind === HOLE ? holeValue(spec, values, at) : kind === TEXT ? parts[i] : kind === INNER ? innerElement(kids[i] as Spec, values, at, inner[i]) : (parts[i] ??= fixedPart(kids[i] as Spec)));
    }
    let raw: any;
    if (list.length > 1) ((list as any)[OWN] = true), (raw = list);
    else raw = list[0];
    out += children(isDynamic(raw) ? { [DYNAMIC_KIDS]: raw } : read(raw));
  }
  return out + "</" + tag + ">";
}
/** A bare function at a template's hole (not compiled as dynamic): where it was registered, to check what it allocates. */
const holeSites = new WeakMap<Function, { spec: Spec; hole: number; registered: number }>();
/** Sites already reported (each once, however many times it renders). */
const reportedSites = new WeakMap<Spec, Set<number>>();
function holeValue(spec: Spec, values: unknown[], at: { i: number }) {
  const v = values[at.i++];
  if (process.env.NODE_ENV !== "production" && typeof v === "function" && !isDynamic(v) && !isChildren(v) && !holeSites.has(v)) {
    const o = getOwner();
    if (o) holeSites.set(v, { spec, hole: at.i, registered: childIdCount(o) });
  }
  return v;
}
/** A bare function hole that allocated ids on the enclosing scope (the client builds it where it was registered). */
function unscopedHole(f: Function, before: number, after: number) {
  const site = holeSites.get(f)!;
  let done = reportedSites.get(site.spec);
  if (done?.has(site.hole)) return;
  (done ??= new Set()), reportedSites.set(site.spec, done), done.add(site.hole);
  const name = f.name || "fn";
  devCheck({
    code: "UNSCOPED_HOLE_ALLOCATED_IDS",
    kind: "render",
    severity: "warn",
    message: `[UNSCOPED_HOLE_ALLOCATED_IDS] A function placed as a hole, {${name}}, rendered content that took hydration ids from the enclosing scope, so its ids depend on when it was rendered. Call it in the hole instead ({${name}()}), which gives it a scope of its own.`,
    data: { name, hole: site.hole, registered: site.registered, before, after },
  });
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
markBuiltin(Portal, Dynamic, Errored, NoHydration, Hydration, Loading, Reveal, HydrationScript);

export function dynamic<P>(source: () => any, options?: { static?: boolean; deferStream?: boolean }): (props: P) => any {
  return dynamicCore<P>(source, options, true);
}

/** `dynamic` for a source that only answers with components, never a tag name. */
export function dynamicComponent<P>(source: () => any, options?: { static?: boolean; deferStream?: boolean }): (props: P) => any {
  return dynamicCore<P>(source, options, false);
}

const COMPONENT_BINDING = Symbol.for("solid.component-binding");
const SERVER_COMPONENT = Symbol.for("solid.server-component");

/** What an async dynamic() source landed, as its record can carry it — a client component function it cannot. */
function classifyLanding(resolved: any) {
  if (typeof resolved !== "function" || SERVER_COMPONENT in resolved || COMPONENT_BINDING in resolved) return resolved;
  const message =
    process.env.NODE_ENV !== "production"
      ? "[DYNAMIC_ASYNC_COMPONENT] An async dynamic() source resolved to a client component " +
        "function, which cannot be serialized for hydration: the client would re-run the source " +
        "and wait on it while hydrating, committing the enclosing <Loading> to a fallback the " +
        "server never rendered. Resolve the async upstream — a createAsync()/createMemo() the " +
        "source reads synchronously (`dynamic(() => page() ? Editor : Viewer)`) — or use lazy() " +
        "for a code-split component. A source may stay async when it resolves to a server " +
        "component or a serializable value (a tag name)."
      : "[DYNAMIC_ASYNC_COMPONENT] An async dynamic() source resolved to a client component function";
  if (OBSERVE) emitDiagnostic({ code: "DYNAMIC_ASYNC_COMPONENT", kind: "ssr", severity: "error", message, data: { component: resolved.name || undefined } } as any, null);
  throw new Error(message);
}

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
  // As the client's (Solid's server dynamic, ported): the source run once per mount, a thenable answer boxed so this
  // memo stays sync and is nobody's record; per instance, a value memo that unboxes (an ordinary async memo, its landing
  // serialized under the instance's id) and a render.
  const cached = createMemo(() => {
    const next: any = source();
    return next && typeof next.then === "function" ? { [FLIGHT]: next } : next;
  });
  const deferStream = !!options?.deferStream;
  return (props: any) => {
    const ctx = sharedConfig.context as any;
    let gated = !deferStream || !ctx?.async;
    const value = createMemo(
      () => {
        let c: any;
        try {
          c = cached();
        } catch (err) {
          // (deferStream over a dependency the source reads that is pending: the shell held on it once — never on
          // client-only content, which nothing on the server settles.)
          if (!gated && err instanceof NotReadyError && !(err as any).source?.$clientHole) {
            gated = true;
            ctx.block(Promise.resolve((err as any).source).then(noopFn, noopFn));
          }
          throw err;
        }
        if (!c || !c[FLIGHT]) return c;
        const next: PromiseLike<any> = c[FLIGHT];
        // (The landing classified in the source promise's own handlers: no extra microtask.)
        return {
          then: (ok?: (v: any) => any, fail?: (e: any) => any) =>
            next.then((resolved: any) => {
              let landed: any;
              try {
                landed = classifyLanding(resolved);
              } catch (err) {
                if (fail) return fail(err);
                throw err;
              }
              return ok ? ok(landed) : landed;
            }, fail),
        };
      },
      { deferStream } as any,
    );
    return createMemo(() => ({ t: html(make(value(), props), false) }), { sync: true } as any);
  };
}
/** The box a dynamic() factory holds a thenable answer in (its per-instance memo is the one that goes async). */
const FLIGHT = Symbol("twist.dynamic-flight");

// ---------------------------------------------------------------- boundaries (the server layer's: Solid's)

/** What a boundary renders, rendered as the boundary runs it (Twist's JSX describes): keyed under the owner it runs
 * under, as Solid's eager templates are, in the render the boundary was made in (a later pass runs after an await). */
function renderNow(r: Render | null, v: unknown) {
  return r ? inRender(r, () => ({ t: html(v, false) })) : { t: html(v, false) };
}
/** A fallback, as Solid's boundary hands it on: a plain value as it is (escaped where it is written), markup rendered. */
const fallbackNow = (r: Render | null, v: unknown) => (v == null || (typeof v !== "object" && typeof v !== "function") ? v : renderNow(r, v));

/** Its children, or its fallback while something under it is not ready. */
export function Loading(props: { fallback?: any; on?: unknown; children?: any }) {
  const r = render;
  return createLoadingBoundary(
    () => {
      // (What is made under it, on any later pass, is inside a Loading.)
      putContext(getOwner(), LOADING_OWNER, true);
      return renderNow(r, props.children);
    },
    () => fallbackNow(r, props.fallback),
    "on" in props ? { on: () => props.on } : undefined,
  );
}

/** Its children, or its fallback (given the error and a reset) once rendering them throws. */
export function Errored(props: { fallback: any; children?: any }) {
  const r = render;
  return createErrorBoundary(
    () => renderNow(r, props.children),
    (err, reset) => fallbackNow(r, erroredFallback(props.fallback, err, reset)),
  );
}

/** The order the Loading boundaries directly inside reveal in, as the stream sends them. */
export function Reveal(props: { order?: "sequential" | "together" | "natural"; collapsed?: boolean; children?: any }) {
  const r = render;
  return layerReveal({
    get order() {
      return props.order;
    },
    get collapsed() {
      return props.collapsed;
    },
    get children() {
      return renderNow(r, props.children);
    },
  } as any);
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

/** Markup that may hold the page's `</head>` (an html or head element, raw markup with one): the render looks for it at
 * the end; a fragment's string is never searched (on a long page, the search alone was as costly as the render). */
function markHead(raw?: string) {
  const ctx = sharedConfig.context as any;
  if (ctx && !ctx.headMarkup && (raw === undefined || raw.includes("</head>"))) ctx.headMarkup = true;
}
/** A template with holes: the strings with each hole rendered between them (finished HTML). */
export function ssr(template: string[] | string, ...nodes: any[]): { t: string } {
  if (typeof template === "string") return markHead(template), { t: template };
  for (const t of template) markHead(t);
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
/** NoHydration and Hydration mark their owners (Solid's NoHydrateContext): what renders under them later (a
 * boundary's retry) still knows, and it crosses a server component's barrier. */
const NO_HYDRATE = NoHydrateContext.id;
/** Whether rendering under NoHydration (nothing hydrates there). */
export const isNoHydration = () => {
  const marked = (getOwner() as any)?._context?.[NO_HYDRATE];
  return marked !== undefined ? marked : noHydration > 0;
};

/** The renders of each request under way: an owner-less caller reaches its request's only one. */
const eventRenders = new WeakMap<object, Set<any>>();
/** A render's root claims its context: reached through its owners, and through its request, until it is disposed. */
function claimRender(ctx: any) {
  ctx.rooted = true;
  ctx.writer = hydrationWriter(ctx);
  fileRenderRoot(getOwner()!, ctx);
  const event = peekRequestEvent();
  let renders = event && eventRenders.get(event);
  if (event && !renders) eventRenders.set(event, (renders = new Set()));
  renders?.add(ctx);
  onCleanup(() => {
    ctx.rooted = false;
    renders?.delete(ctx);
  });
}
/** The render the caller's owner belongs to, while its root lives. */
function callerRender() {
  const ctx = renderContextOf(getOwner());
  return ctx?.rooted ? ctx : undefined;
}
/** Keyed values for the client to take (`takeHydrationValue`): the first write of a key wins, while the render is open. */
function hydrationWriter(ctx: any) {
  const keys = new Set<string>();
  return {
    async: !!ctx.async,
    write(key: string, value: unknown, options?: { deferStream?: boolean }) {
      if (!ctx.rooted || keys.has(key)) return false;
      ctx.serialize(key, value, options?.deferStream);
      keys.add(key);
      return true;
    },
  };
}
/** Nothing to take on a server (the client's read of what the server wrote). */
export const takeHydrationValue = (_key: string): undefined => undefined;
/** Whether what renders here hydrates: inside a render, outside NoHydration. */
export const isHydratable = () => !!callerRender() && !isNoHydration();
/** The hydration writer of the caller's render: by its owner, else its request's only render. */
export function getHydrationWriter() {
  let ctx = callerRender();
  if (!ctx) {
    const event = peekRequestEvent();
    const renders = event && eventRenders.get(event);
    if (renders?.size === 1) [ctx] = renders;
  }
  return ctx?.writer;
}

/** Its children render with no hydration keys (they will not be hydrated). */
export function NoHydration(props: { children?: any }) {
  const o = createOwner({ transparent: true }) as any;
  putContext(o, NO_HYDRATE, true);
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
  putContext(o, NO_HYDRATE, false);
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
  if (v[LAZY]) return lazyElement(v, v.keyed ?? !inTemplate);
  if (v[COMP]) return renderComponent(v.fn, componentProps(v.props), (out) => html(out, false));
  if (typeof v.t === "string") return v.t;
  // (A boundary's answer in Solid's template shape: its markup; one still waiting, waited on as a hole is.)
  if (Array.isArray(v.t)) {
    if (v.h?.length) throw new NotReadyError(Promise.all(v.p));
    return v.t.join("");
  }
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

/** A tag name from run time checked: one element name, or nothing is written. */
function validTag(tag: string) {
  if (validTags.has(tag)) return;
  if (!TAG_NAME.test(tag)) throw new Error(`"${tag}" is not a valid tag name`);
  validTags.add(tag);
}
function element(el: Element_, keyed: boolean): string {
  // (Rendered, all of it, under the owner it takes its key under: as Solid's template makes its parts where it is made.)
  const under = el.owner ? keyOwnerOf(el.owner) : null;
  if (under && under !== getOwner()) return runWithOwner(under, () => element(el, keyed));
  if (el.ops && (!Object.hasOwn(el, "props") || el.props === el.made) && !el.skip && !el.sources && el.children === undefined && (sharedConfig.context as any)?.claims === undefined) return runOps(el.ops, el.values!, keyed);
  const { tag } = el;
  let is = el.tagIs;
  if (!is) validTag(tag), (is = { void: VOID.has(tag), raw: RAW_TEXT.has(tag) });
  if (tag === "html" || tag === "head") markHead();
  // The key first: what the props read is the element's, after it.
  let out = "<" + tag + (keyed ? ssrHydrationKey() : "");
  // (A template's element: its props as the template set them, their keys checked once for it.)
  const all = el.keys ? el.props : propsOf(el);
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
  for (const key of el.keys ?? Reflect.ownKeys(all)) {
    if (!el.keys && (typeof key !== "string" || el.skip?.(key) || !ATTR_NAME.test(key) || (tail && tail.has(key)))) continue;
    const k = key as string;
    // A void element has no children: never read.
    if (k === "children" && is.void) continue;
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
    if (k === "children") kids = !el.keys && (el.sources || hasSpread(el.props)) ? keyedKids(v) : v;
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
    else if (k === "innerHTML") markHead((content = v == null ? "" : String(v)));
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
  if (is.void) return out + (!el.keys && (el.sources || hasSpread(el.props)) ? " />" : ">");
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
    else if (kids !== NONE_CHOSEN) out += is.raw ? rawText(kids && kids[DYNAMIC_KIDS] ? read(kids[DYNAMIC_KIDS]) : kids) : children(kids);
  } finally {
    selecting = was;
  }
  return out + "</" + tag + ">";
}

/** An element's props: JSX props with their spreads, or ssrElement's sources merged (later ones winning). */
function propsOf(el: Element_): Record<string, any> {
  if (!el.sources) return expandSpreads(el.props, el.tag);
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
const keyedKids = (v: any): any =>
  Array.isArray(v) ? Object.assign(v.map(keyedKids), { [OWN]: (v as any)[OWN] }) : v && v[EL] && v.keyed === undefined ? Object.assign(Object.create(Object.getPrototypeOf(v)), v, { keyed: true }) : v;

/** Children that can change: rendered in an id scope of their own, a live frame's hole when there is one. */
function dynamicKids(raw: any): string {
  // (Rendered once, nothing to wait for or re-send: run in its scope at once.)
  if ((!render || !render.async) && !(sharedConfig.context as any)?.liveHoles) return inIdScope(readChildren, raw);
  return hole(idScope(() => liveHole(() => read(raw)) ?? children(read(raw))), true);
}
const readChildren = (raw: any) => children(read(raw));

function children(c: any): string {
  if (Array.isArray(c)) return list(c, !!(c as any)[OWN], true);
  if (typeof c === "function") return hole(() => list([c], true, true));
  if (c === null || typeof c !== "object") return html(c, false);
  if (c[DYNAMIC_KIDS]) return dynamicKids(c[DYNAMIC_KIDS]);
  return c[EL] ? element(c, c.keyed ?? false) : c[LAZY] ? lazyElement(c, c.keyed ?? false) : html(c, false);
}

/** HTML written part by part: text beside text split where the client would see two nodes. */
class Parts {
  out = "";
  empty = true;
  /** The first part's kind, and the last's. */
  firstText = false;
  firstSplit = false;
  text = false;
  split = false;
  add(s: string, text: boolean, split: boolean) {
    if (this.empty) (this.empty = false), (this.firstText = text), (this.firstSplit = split);
    else if (this.text && text && this.split && split) this.out += SEP;
    this.out += s;
    this.text = text;
    this.split = split;
  }
  /** Another's parts after these. */
  addAll(p: Parts) {
    if (p.empty) return;
    if (this.empty) (this.empty = false), (this.firstText = p.firstText), (this.firstSplit = p.firstSplit);
    else if (this.text && p.firstText && this.split && p.firstSplit) this.out += SEP;
    this.out += p.out;
    this.text = p.text;
    this.split = p.split;
  }
}

/**
 * A list as the client flattens it. Text next to text becomes two text nodes there, so a separator marks the split
 * here: between values a hole yields (what each resolves to decides), never between a template's own items.
 */
function list(items: any[], own: boolean, inTemplate: boolean): string {
  const parts = new Parts();
  collect(items, own, inTemplate, false, parts);
  return parts.out;
}

/** Dynamic holes being rendered in their scope, with the scoped run (a retry runs it again). */
const scoping = new Map<Function, () => Parts>();


function collect(items: any[], own: boolean, inTemplate: boolean, viaFn: boolean, parts: Parts) {
  for (let x of items) {
    let fn = viaFn;
    // (A bare function hole: the enclosing scope's next id before it renders, to see whether it took any.)
    const site = process.env.NODE_ENV !== "production" && typeof x === "function" && holeSites.has(x) ? (x as Function) : null;
    const siteOwner = site ? (getOwner() as any) : null;
    const siteBefore = siteOwner ? childIdCount(siteOwner) : 0;
    // A hole or a component beside other children: between markers the client claims it by.
    if (own && !viaFn && items.length > 1 && ((typeof x === "function" && !(x as any).$esc) || (x && x[COMP]))) {
      parts.add("<!--$-->" + (x[COMP] ? html(x, false) : list([x], false, inTemplate)) + "<!--/-->", false, false);
      continue;
    }
    // A dynamic hole of a template (an insert, in Solid's terms; not a component's children): rendered in an id scope
    // of its own, as the client's binding is, and retried in the same one.
    if (inTemplate && typeof x === "function" && isDynamic(x) && !scoping.has(x)) {
      const f = x;
      const run = idScope(() => {
        const ps = new Parts();
        scoping.set(f, run);
        try {
          collect([f], own, inTemplate, viaFn, ps);
        } finally {
          scoping.delete(f);
        }
        return ps;
      });
      parts.addAll(run());
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
          parts.add(live, false, false);
          continue;
        }
        while (typeof x === "function") (x = x()), (fn = true);
      } catch (e) {
        // A part of the shell not ready yet waits on its own, like any hole.
        const waits = e instanceof NotReadyError && rr?.async && settlesOf(e);
        if (!waits) throw e;
        parts.add(later(rr!, scoped ? () => scoped().out : () => list([f], own, inTemplate), waits, o, at), false, false);
        continue;
      }
    }
    if (x == null || typeof x === "boolean") continue;
    // (A function in a template's own list yields more of that list; an array nested in a list is a hole's.)
    if (Array.isArray(x)) {
      const stays = (own && fn && !viaFn) || !!(x as any)[OWN];
      collect(x, stays, inTemplate && own, stays ? false : fn, parts);
    }
    else if (typeof x === "string" || typeof x === "number") parts.add(typeof x === "string" ? escape(x) : String(x), true, !own || fn);
    else if (x[EL]) parts.add(element(x, x.keyed ?? !(inTemplate && own && !fn)), false, false);
    else if (x[LAZY]) parts.add(lazyElement(x, x.keyed ?? !(inTemplate && own && !fn)), false, false);
    else parts.add(html(x, false), false, false);
    if (siteOwner && childIdCount(siteOwner) !== siteBefore) unscopedHole(site!, siteBefore, childIdCount(siteOwner));
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
function expandSpreads(props: Record<string, any>, tag?: string) {
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
      // (A binding slot's return spread whole binds nothing by position: an error.)
      if (source && source.$slot === true) slotSpreadSource(tag, source);
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
  // (`className`, as React code writes it, and Solid 1's `classList`: the class.)
  if (name === "className" || name === "classList") name = "class";
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
  /** Its fragments still to come (a boundary's), by key: settles its record; what settled inside it, merged in. */
  fragments: Map<string, { resolve: (error?: unknown) => void; children?: Record<string, string> }>;
  /** The boundaries the shell waited on (its render record counts them). */
  waited: number;
  async: boolean;
  waiting: Set<Promise<void>>;
  /** Chunks after the shell: revealed boundaries, in the order they settled. */
  chunks: string[];
  wake: (() => void) | null;
  revealScript: boolean;
  options: { renderId?: string; noHydrate?: boolean; sink?: Partial<Sink> };
  /** What useHead registered, and whether the patch script has been sent. */
  head: HeadRegistry | null;
  headScript?: boolean;
  /** Whether the shell has gone out (later, nothing holds it). */
  shellSent: boolean;
  /** What the client hydrates with, as script text not yet sent. */
  data: string;
  serializer: ReturnType<typeof createHydrationSerializer> | null;
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
  const parts = h && !h.placed ? shellHeadParts(h) : null;
  // (Searched only where a head can be: outside a render's context, always.)
  const ctx = sharedConfig.context as any;
  const at = !ctx || ctx.headMarkup || h?.placed ? html.indexOf("</head>") : -1;
  if (at === -1) {
    onHead?.((parts ? parts.prelude + (parts.title != null ? `<title data-dh="title">${escape(parts.title)}</title>` : "") + parts.html : "") + renderHeadAssets(tracking, nonce));
    return html;
  }
  const SLOT = "\u0000assets\u0000";
  html = html.slice(0, at) + SLOT + html.slice(at);
  if (parts) return placeHead(html, { ...parts, html: parts.html + renderHeadAssets(tracking, nonce) }, SLOT);
  return html.replace(SLOT, () => renderHeadAssets(tracking, nonce));
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
/** `html` with the placeholder of fragment `key` (its template and fallback) replaced by `value`. */
function replacePlaceholder(html: string, key: string, value: string): string {
  const open = `<template id="pl-${key}">`;
  const close = `<!--pl-${key}-->`;
  const at = html.indexOf(open);
  if (at === -1) return html;
  const end = html.indexOf(close, at + open.length);
  return end === -1 ? html : html.slice(0, at) + value + html.slice(end + close.length);
}

/** A fragment settled inside one still to come: its head tags and styles become that one's. */
function adoptBoundary(r: Render, key: string, parentKey: string) {
  if (r.head) for (const g of r.head.groups) if (g.boundary === key) g.boundary = parentKey;
  const styles = r.tracking.boundaryStyles;
  const mine = styles.get(key);
  if (!mine) return;
  let theirs = styles.get(parentKey);
  if (!theirs) styles.set(parentKey, (theirs = new Set()));
  for (const s of mine) theirs.add(s);
  styles.delete(key);
}

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
/** Marks a server <Loading> boundary's content owner (what reads under it, on any later pass, is inside it). */
const LOADING_OWNER = Symbol("twist.ssr.loading");
/** Whether a render is inside a <Loading> now (Solid's `_loadingPhase`: a client-only read is the boundary's then). */
const insideLoading = () => !!(getOwner() as any)?._context?.[LOADING_OWNER];
/** A render context's `_loadingPhase`, as the layer reads it: inside a Loading now, or set by a boundary of its own. */
function loadingPhase(ctx: any) {
  Object.defineProperty(ctx, "_loadingPhase", {
    configurable: true,
    get: () => insideLoading(),
    // (A boundary's pass sets it on its own context, a clone of this one, while it runs; after, the owner says.)
    set(this: any, v) {
      let pass: true | undefined = v ? true : undefined;
      Object.defineProperty(this, "_loadingPhase", { configurable: true, enumerable: true, get: () => pass ?? insideLoading(), set: (next) => void (pass = next ? true : undefined) });
    },
  });
  return ctx;
}
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
    if (!waits) throw e;
    return later(r, fn, waits, o, at);
  }
}

/** A placeholder in the shell for `fn`, rendered again (from the same ids) once `waits` settles. */
function later(r: Render, fn: () => string, waits: Promise<void>, o: any, at: number): string {
  // (Thrown away with a pass of its boundary rendered again, or disposed: nothing to fill.)
  const owned = standing(o);
  // (Under the id it was made under: a hole's scope had given its owner one only while the hole ran.)
  const place = idPlace(o);
  // (In the context it was made in: a boundary's, a server component's clone.)
  const madeIn = sharedConfig.context;
  // (The boundary it renders in: what it registers in the head and as assets is that boundary's, when it comes.)
  const inAssets = r.tracking.currentBoundaryId;
  const scoped = () => {
    const ab = r.tracking.currentBoundaryId;
    r.tracking.currentBoundaryId = inAssets;
    try {
      return runWithOwner(o, fn);
    } finally {
      r.tracking.currentBoundaryId = ab;
    }
  };
  {
    const token = "\u0000hole" + holeCount++ + "\u0000";
    r.holes.set(
      token,
      new Promise<string>((ok, fail) => {
        const again = (w: Promise<void>) =>
          w.then(() => {
            // Thrown away with a pass of its boundary that was rendered again: nothing to fill.
            if (!owned()) return ok("");
            try {
              ok(
                place(() => {
                  // From the same ids: the hole takes again what it took the first time.
                  if (at >= 0) setChildIdCount(o, at);
                  return rendering(r, r.options, () => inContext(madeIn, scoped));
                }),
              );
            } catch (e2) {
              // (Client-only content: passed up as it is, its boundary hands it to the client.)
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
async function filled(r: Render, s: string, pass?: () => void): Promise<string> {
  for (;;) {
    const found = s.match(/\u0000hole\d+\u0000/g);
    if (!found) return s;
    // (Each hole awaited is a pass, the one that failed too; one failing fails them all, at once.)
    const vs = await Promise.all(found.map((h) => r.holes.get(h)!.finally(() => pass?.())));
    found.forEach((h, i) => (s = s.replace(h, () => vs[i]!)));
  }
}


/** The end of this turn of the event loop, as the platform has it when the module loads (as Solid's). */
declare const setImmediate: ((fn: () => void) => unknown) | undefined;
const deferFlush: (fn: () => void) => void = typeof setImmediate === "function" ? setImmediate : (fn) => void setTimeout(fn, 0);

/** Swaps a streamed template in for the fallback before it (written for Twist, not taken from Solid). */
/** Solid's fragment swap runtime (MIT, Ryan Carniato and contributors): `$df`, groups (`$dfj`), fallbacks (`$dflj`), style gates. */
const REVEAL = `function $df(e){return _$HY.f?_$HY.f(e):$dfr(e)}function $dfr(e,n,o,t){if(!(n=document.getElementById(e)))return 0;if(!(o=document.getElementById("pl-"+e)))return(_$HY.dq=_$HY.dq||{})[e]=1,0;for(;o&&(8!==o.nodeType||o.nodeValue!=="pl-"+e);)t=o.nextSibling,o.remove(),o=t;t=o.parentNode,o.replaceWith(n.content),n.remove(),(_$HY.v=_$HY.v||{})[e]=1,_$HY.fe(e,t),_$HY.hp&&_$HY.hp[e]&&($dh(_$HY.hp[e]),delete _$HY.hp[e]),$dfd();return 1}function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return(_$HY.dlq=_$HY.dlq||{})[e]=1,0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1,$dfd();return 1}n=n.nextSibling}return 0}function $dflj(e,i){for(i=0;i<e.length;i++)$dfl(e[i])}function $dfd(e,i){if(e=_$HY.dq){_$HY.dq=0;for(i in e)$df(i)}if(e=_$HY.dlq){_$HY.dlq=0;for(i in e)$dfl(i)}}function $dfs(e,c,d){(_$HY.sc=_$HY.sc||{})[e]=c,d&&((_$HY.sd=_$HY.sd||{})[e]=1)}function $dfg(e,g,i,k){if(!(g=_$HY.sg&&_$HY.sg[e]))return;for(i=0;i<g.length;i++)if(_$HY.sc&&_$HY.sc[g[i]]>0)return;for(i=0;i<g.length;i++)k=g[i],delete _$HY.sg[k],$df(k)}function $dfc(e){if(--_$HY.sc[e]<=0){delete _$HY.sc[e],_$HY.sg&&_$HY.sg[e]?$dfg(e):!(_$HY.sd&&_$HY.sd[e])&&$df(e);_$HY.sd&&delete _$HY.sd[e]}}function $dfj(e,i,n){for(i=0;i<e.length;i++)if(_$HY.sc&&_$HY.sc[e[i]]>0){for(n=0;n<e.length;n++)(_$HY.sg=_$HY.sg||{})[e[n]]=e;return}for(i=0;i<e.length;i++)$df(e[i])}function $dfe(e,t,k){(t=e.target)&&t.getAttribute&&!t._$dc&&(k=t.getAttribute("data-dfc"))&&(t._$dc=1,$dfc(k))}document.addEventListener("load",$dfe,!0);document.addEventListener("error",$dfe,!0)`;


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
const boundaryNow = (): string => (sharedConfig.context as any)?._currentBoundaryId ?? "";

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
  const headBoundary = boundaryNow();
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
      // (A stylesheet a streamed boundary asks for is one of its styles: its link gates the boundary's swap.)
      const p = d.props ?? {};
      if (headBoundary !== "" && d.tag === "link" && evalHead(p.rel) === "stylesheet" && evalHead(p.href) != null && (sharedConfig.context as any)?.registerAsset) {
        (sharedConfig.context as any).registerAsset("style", String(evalHead(p.href)));
        continue;
      }
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
  if (group.tags.length) {
    const h = head;
    h.groups.push(group);
    // (A boundary's pass rendered again: this pass's tags go with it.)
    if (headBoundary !== "" && getOwner()) onCleanup(() => void (h.groups = h.groups.filter((g) => g !== group)));
  }
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
  if (d.tag === "meta" && p.charset != null) return "charset";
  if (d.key != null) return d.tag + ":key:" + evalHead(d.key);
  if (d.tag === "meta") {
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

function headTag(d: HeadDesc, ident?: string): string {
  if (d.props?.[RAW]) return d.props[RAW];
  let out = "<" + d.tag;
  const a = headAttrs(d);
  for (const k of Object.keys(a)) out += a[k] === true ? " " + k : ` ${k}="${escape(a[k], true)}"`;
  if (ident !== undefined) out += ` data-dh="${escape(ident, true)}"`;
  if (VOID.has(d.tag)) return out + ">";
  const text = evalHead(d.props?.children);
  return out + ">" + (text == null ? "" : d.tag === "title" ? escape(String(text)) : String(text)) + "</" + d.tag + ">";
}

/** The winners of `groups`, last one per identity. */
function winners(groups: HeadGroup[]): HeadDesc[] {
  return [...winnersBy(groups).values()];
}
function winnersBy(groups: HeadGroup[]): Map<string, HeadDesc> {
  const by = new Map<string, HeadDesc>();
  let unique = 0;
  for (const g of groups) for (const d of g.tags) by.set(identity(d, unique++), d);
  return by;
}

/** The shell's head tags: the prelude (charset, base), the title's text, and the rest in Solid's order. */
function shellHeadParts(h: HeadRegistry): { prelude: string; html: string; title: string | null } {
  let prelude = "";
  let links = "";
  let metas = "";
  let others = "";
  let scripts = "";
  let title: string | null = null;
  for (const [ident, d] of winnersBy(h.groups.filter((g) => g.boundary === ""))) {
    if (ident === "title") {
      const text = evalHead(d.props?.children);
      title = text == null ? "" : String(text);
      continue;
    }
    const markup = headTag(d, ident);
    if (ident === "charset" || ident === "base") prelude += markup;
    else if (d.tag === "link" || d.tag === "style") links += markup;
    else if (d.tag === "meta") metas += markup;
    else if (d.tag === "script") scripts += markup;
    else others += markup;
  }
  // (The request's trace as <meta> tags beside the app's: shell-only, where the head's tags go.)
  const ctx = sharedConfig.context as object | undefined;
  const traceMetas = ctx ? traceMetaMarkup(traceOfRender(ctx)) : "";
  return { prelude, html: h.resources.join("") + links + metas + traceMetas + others + scripts, title };
}

/** The shell's head tags into the page: the prelude after <head>, the title over the shell's own (its text kept). */
function placeHead(html: string, parts: { prelude: string; html: string; title: string | null }, slot: string): string {
  let tags = parts.html;
  const open = html.match(/<head(?:\s[^>]*)?>/);
  if (parts.prelude && open) {
    const at = open.index! + open[0].length;
    html = html.slice(0, at) + parts.prelude + html.slice(at);
  } else tags = parts.prelude + tags;
  if (parts.title != null) {
    const winner = escape(parts.title);
    const from = open ? html.indexOf(open[0]) + open[0].length : 0;
    const end = html.indexOf(slot, from);
    const m = /<title(\s[^>]*)?>([\s\S]*?)<\/title>/.exec(html.slice(from, end === -1 ? undefined : end));
    if (m) {
      const at = from + m.index;
      html = html.slice(0, at) + `<title${m[1] || ""} data-dh="title" data-dhf="${m[2].replace(/"/g, "&quot;")}">${winner}</title>` + html.slice(at + m[0].length);
    } else tags = `<title data-dh="title">${winner}</title>` + tags;
  }
  return html.replace(slot, () => tags);
}

/** The head's slot filled: the shell's tags (and its resources). Waiting when `wait`: a tag not ready holds it. */
function fillHead(shell: string, h: HeadRegistry, wait: boolean): string | Promise<string> {
  // (The slot is written with the head: none, nothing to look for in the page.)
  if (!h.placed || !shell.includes(HEAD_SLOT)) return shell;
  try {
    return placeHead(shell, shellHeadParts(h), HEAD_SLOT);
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

/** A value still to come (a promise, or an async source's values): the stream stays open until it has all been written. */
function awaitData<V>(r: Render, v: V, id?: string): V {
  if (!isData(v)) return v;
  r.pendingData++;
  let open = true;
  const done = () => open && ((open = false), id != null && r.abandons.delete(id), queueMicrotask(() => (r.pendingData--, r.wake?.())));
  if (id != null) r.abandons.set(id, Object.assign(done, { [DATA]: true }));
  // (A promise or an answer's source as it is, the serializer's to write: a promise done when it settles — or, answering
  // with a source, when that ends; a source when it ends.)
  if ((v as any).__SEROVAL_STREAM__ === true) return held(v, done);
  if (typeof (v as any).then === "function") (v as any).then((x: any) => (x && x[SOURCE_ANSWER] ? endOf(x, done) : done()), done);
  else endOf(v, done);
  return v;
}
/** `done` called when an answer's source (one of the layer's channels, ours to change) ends, fails or is let go of. */
function endOf(source: any, done: () => void) {
  const open = source[Symbol.asyncIterator];
  // (A turn later: the serializer writes the end it read first.)
  const ended = () => deferFlush(done);
  source[Symbol.asyncIterator] = function (this: unknown) {
    const it = open.call(this);
    return {
      next: (...a: any[]) => Promise.resolve(it.next(...a)).then((x: IteratorResult<unknown>) => (x.done && ended(), x), (e: unknown) => (ended(), Promise.reject(e))),
      return: (x?: unknown) => (ended(), it.return ? it.return(x) : Promise.resolve({ done: true, value: x })),
    };
  };
}
// (A source counts only when it is an async node's answer: anything else goes to the serializer as it is.)
const isData = (v: any) => !!v && (typeof v.then === "function" || v.__SEROVAL_STREAM__ === true || (typeof v[Symbol.asyncIterator] === "function" && !!v[SOURCE_ANSWER]));
/**
 * A value as it crosses to the client (Solid's funnel, ported from its server.ts, MIT): every async iterable in it — the
 * channel itself, or one nested in a resolved answer — a seat on the shared stream of it (so the serializer and a memo
 * reading the same source see the whole sequence), and a failure the client may see sanitized. One guard per channel.
 */
const guardedChannels = new WeakMap<object, any>();
const verdictNow = (error: unknown) => {
  throw ssrSanitizeError(error, null);
};
const borderForm = (value: unknown) => toBorderForm(value, false);
const guardIterable = (iterable: any) => ({
  [Symbol.asyncIterator]() {
    const iterator = iterable[Symbol.asyncIterator]();
    return {
      next: (value?: unknown) => iterator.next(value).then(undefined, verdictNow),
      return: (value?: unknown) => (iterator.return ? iterator.return(value) : Promise.resolve({ done: true, value })),
      throw: (error?: unknown) => (iterator.throw ? iterator.throw(error) : Promise.reject(error)),
    };
  },
});
const guardStream = (source: ReadableStream) => {
  const reader = source.getReader();
  return new ReadableStream({
    pull: (c) =>
      reader.read().then(
        (r) => (r.done ? c.close() : c.enqueue(r.value)),
        (e) => {
          try {
            verdictNow(e);
          } catch (sanitized) {
            c.error(sanitized);
          }
        },
      ),
    cancel: (reason) => reader.cancel(reason),
  });
};
function guardChannel(p: any): any {
  if (!p || typeof p !== "object" || "__SEROVAL_STREAM__" in p) return p;
  let guarded = guardedChannels.get(p);
  if (guarded !== undefined) return guarded;
  if (typeof p.then === "function") guarded = p.then(borderForm, verdictNow);
  else if (typeof ReadableStream === "function" && p instanceof ReadableStream) guarded = guardStream(p);
  else {
    const border: any = borderForm(p);
    guarded = border && typeof border[Symbol.asyncIterator] === "function" ? guardIterable(border) : border;
    if (guarded === p) return p;
  }
  guardedChannels.set(p, guarded);
  return guarded;
}

/** A serialized stream: `done` when it returns or throws. */
function held(v: any, done: () => void): any {
  return v.on({ next() {}, throw: done, return: done }), v;
}

/** The data not yet sent, as a script (the scope's header ahead of the first). */
function takeData(r: Render): string {
  if (!r.data) return "";
  const s = (r.headerSent ? "" : headerScript(r.options.renderId)) + r.data;
  r.headerSent = true;
  r.data = "";
  return `<script${nonceAttr(r.nonce, "script")}>${s}</script>`;
}

/** `fn` with `ctx` as the render context (none given: as it is). */
function inContext<T>(ctx: unknown, fn: () => T): T {
  if (!ctx) return fn();
  const was = sharedConfig.context;
  sharedConfig.context = ctx as any;
  try {
    return fn();
  } finally {
    sharedConfig.context = was;
  }
}

/** `fn` in render `r` (its holes and head), the render context left as the caller set it (a boundary's buffered one). */
function inRender<T>(r: Render, fn: () => T): T {
  const wasRender = render;
  const wasHead = head;
  render = r;
  head = r.head;
  try {
    return fn();
  } finally {
    render = wasRender;
    head = wasHead;
  }
}

function rendering<T>(r: Render | null, options: { renderId?: string; noHydrate?: boolean }, fn: () => T): T {
  const wasRender = render;
  sharedConfig.context = options.noHydrate ? null : (r?.ctx ?? stringCtx ?? stringContext(options.renderId ?? ""));
  render = r;
  const wasHead = head;
  if (r) head = r.head;
  try {
    return fn();
  } finally {
    // (The context stays the global one: whichever render touched it last, as Solid leaves it.)
    render = wasRender;
    head = wasHead;
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
  // (Timed whenever records exist: the response's Server-Timing reads the shell's time from the trace.)
  const records = OBSERVE?.records as any;
  if (!records) return null;
  const at = Date.now();
  const started = performance.now();
  let route: any;
  let told = false;
  const timed: { shellMs?: number } = {};
  if (ctx.trace) ctx.trace.render = timed;
  ctx._declareRoute = (ref: unknown) => void (route = ref);
  return {
    shell: () => void (timed.shellMs ??= performance.now() - started),
    settle(outcome: "complete" | "abandoned" | "error", boundaries: number, released = false) {
      if (told) return;
      told = true;
      if (!records.observed("render")) return;
      const event: Record<string, unknown> = { mode, at, durationMs: performance.now() - started, boundaries, outcome };
      if (timed.shellMs !== undefined) event.shellMs = timed.shellMs;
      // (The route as it stands now: a match refined during the render is what lands.)
      if (route) {
        const named: Record<string, unknown> = {};
        for (const k of ["name", "to", "params"]) if (route[k] !== undefined) named[k] = route[k];
        event.route = named;
      }
      // (Told under an owner of the render: its listener reads this render's trace, whatever renders now. A render
      // already let go of, none.)
      const emit = () => records.emit("render", event, { trace: ctx.trace?.context, event: ctx.event ?? getRequestEvent() });
      if (released) return void runWithOwner(null, emit);
      const o = runWithOwner(null, () => createOwner()) as any;
      fileRenderRoot(o, ctx);
      runWithOwner(o, emit);
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
  // (Closed with the render: a late write is dropped.)
  let closed = false;
  ctx.serialize = (id: string, v: unknown) => {
    if (closed) return;
    if (v && typeof (v as any).then === "function") throw new Error(`Cannot serialize async value in renderToString (id: ${id}). Use renderToStream for async data.`);
    if (!serializer || written.has(id)) return;
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
          claimRender(ctx);
          try {
            // (No head rendered: no page to look through for one.)
            const page = fillHead(html(code(), false), head!, false) as string;
            const out = withHeadAssets(page, tracking, head, nonce, options.onHead);
            // (A string's shell is the whole document.)
            record?.shell();
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
    closed = true;
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

/**
 * Markup in Solid's template shape (`{ t, h, p }`), as the layer's boundaries take it: the strings, and between them
 * each hole that still waits — a function giving it once `p`'s promise settles. Twist's late holes are tokens in the
 * markup; a value that throws not-ready waits on what it named.
 */
class Template {
  t: string[] = [""];
  h: (() => unknown)[] = [];
  p: unknown[] = [];
  text(s: string) {
    const r = render;
    if (!r || !s.includes("\u0000hole")) return void (this.t[this.t.length - 1] += s);
    const bits = s.split(/(\u0000hole\d+\u0000)/);
    for (let i = 0; i < bits.length; i++) {
      if (i % 2 === 0) this.t[this.t.length - 1] += bits[i];
      else {
        const filled = r.holes.get(bits[i]!)!;
        this.wait(holeReader(bits[i]!, filled), filled);
      }
    }
  }
  wait(h: () => unknown, p: unknown) {
    this.h.push(h);
    this.p.push(p);
    this.t.push("");
  }
  add(v: any) {
    const again = typeof v === "function" ? v : () => v;
    try {
      while (typeof v === "function") v = v();
    } catch (e) {
      if (e instanceof NotReadyError) return this.wait(again, (e as any).source);
      // (A hole that failed: to the boundary it is in, as a template hole's error goes — its handler routes it, then throws.)
      return void ssrHandleError(e);
    }
    if (v == null || typeof v === "boolean") return;
    if (typeof v === "string") return this.text(v);
    if (typeof v === "number") return this.text(String(v));
    if (Array.isArray(v)) {
      for (const x of v) this.add(x);
      return;
    }
    if (typeof v.t === "string") return this.text(v.t);
    if (Array.isArray(v.t)) {
      for (let i = 0; i < v.t.length; i++) {
        this.text(v.t[i]);
        if (v.h && i < v.h.length) this.wait(v.h[i], v.p[i]);
      }
      return;
    }
    try {
      this.text(html(v, false));
    } catch (e) {
      if (e instanceof NotReadyError) return this.wait(again, (e as any).source);
      throw e;
    }
  }
  done() {
    return { t: this.t, h: this.h, p: this.p };
  }
}
/** A late hole's markup once it is filled: its value, or the failure it met (the token itself while it waits). */
function holeReader(token: string, filled: Promise<string>) {
  let state: { v: string } | { e: unknown } | undefined;
  filled.then(
    (v) => void (state = { v }),
    (e) => void (state = { e }),
  );
  return () => {
    if (!state) return { t: token };
    if ("e" in state) throw state.e;
    return { t: state.v };
  };
}
/** A value in Solid's template shape (ctx.resolve). */
function resolveTemplate(v: any) {
  const out = new Template();
  out.add(v);
  return out.done();
}
/** Template strings with values between them, in Solid's template shape (ctx.ssr). */
function templateOf(strings: string[] | string, ...nodes: any[]) {
  if (typeof strings === "string") return markHead(strings), { t: [strings], h: [], p: [] };
  const out = new Template();
  for (let i = 0; i < strings.length; i++) {
    markHead(strings[i]);
    out.text(strings[i]!);
    if (i < nodes.length) out.add(nodes[i]);
  }
  return out.done();
}

/** The context a string render's code reads: nothing waits, nothing is sent. */
function stringContext(id: string) {
  return loadingPhase({ id, count: 0, async: false, document: true, escape, ssr: templateOf, resolve: resolveTemplate, serialize() {}, block() {}, replace() {}, registerAsset() {}, hold: () => () => {} });
}

/** The context of a stream: Solid's render context API over this render. */
function streamContext(r: Render, options: StreamOptions) {
  return loadingPhase({
    errorPolicy: options.onError,
    id: options.renderId ?? "",
    count: 0,
    async: true,
    nonce: options.nonce,
    document: !options.sink,
    live: {},
    escape,
    ssr: (strings: string[] | string, ...nodes: any[]) => inRender(r, () => templateOf(strings, ...nodes)),
    resolve: (v: any) => inRender(r, () => resolveTemplate(v)),
    /** A boundary the shell waited on, recorded (the response's Server-Timing, the render record's count). */
    _recordBoundary(event: unknown) {
      (r.ctx as any).trace?.timing.push({ type: "boundary", event });
      r.waited++;
    },
    /** A failure nothing contains (reported already): before the shell, the request fails; after, the stream ends. */
    failRender: (e: unknown) => (r as any).failRender?.(e),
    serialize(id: string, p: unknown, deferStream?: boolean) {
      // (Data marked deferStream holds the shell until it lands.)
      if (deferStream && !r.shellSent && p && typeof (p as any).then === "function") r.blocks.add((p as Promise<unknown>).then(noopFn, noopFn));
      if (!r.serializer) return;
      r.serializer.write(id, guardChannel(awaitData(r, p, id)));
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
    /** A boundary's fragment: its record serialized now (the stream stays open until it settles), its content when given. */
    registerFragment(key: string, opts?: { revealGroup?: string }) {
      if (!r.fragments.has(key)) {
        let settle!: (v: unknown) => void;
        let fail!: (e: unknown) => void;
        const record = new Promise((ok, no) => ((settle = ok), (fail = no)));
        record.catch(() => {});
        r.serializer?.write(key + "_fr", record);
        r.holds++;
        let open = true;
        const resolve = (error?: unknown) => {
          if (!open) return;
          open = false;
          r.abandons.delete(key);
          queueMicrotask(() => {
            error ? fail(ssrSanitizeError(error, null)) : settle(true);
            queueMicrotask(() => (r.holds--, r.wake?.()));
          });
        };
        r.fragments.set(key, { resolve });
        r.abandons.set(key, () => {
          if (r.fragments.get(key)?.resolve === resolve) r.fragments.delete(key);
          resolve();
        });
      }
      return (value?: string, error?: unknown, escaped?: { frame?: string }) => {
        const item = r.fragments.get(key);
        if (!item) return r.shellSent;
        r.fragments.delete(key);
        // (The response over: nothing more is sent for it.)
        if ((r as any).ended) return item.resolve(), r.shellSent;
        if (error) abandonUnder(r, key, error);
        // (Escaped a server component: the frame as one value errors.)
        if (error && escaped) {
          const wire = ssrSanitizeError(error, null);
          const message = wire instanceof Error ? wire.message : String(wire);
          if (r.options.sink?.error) r.sink.error!("", message);
          else (r.ctx as any).live?.error?.(escaped.frame, message);
        }
        if (item.children && !error) for (const k in item.children) value = replacePlaceholder(value ?? "", k, item.children[k]!);
        // (Settled inside a fragment still to come: it goes with that one.)
        const parentKey = [...r.fragments.keys()].reverse().find((k) => key.startsWith(k));
        if (parentKey) {
          (r.fragments.get(parentKey)!.children ??= {})[key] = value ?? "";
          serializeFragmentAssets(key, r.tracking, r.ctx);
          adoptBoundary(r, key, parentKey);
          item.resolve();
          return r.shellSent;
        }
        if (error && r.head) r.head.groups = r.head.groups.filter((g) => g.boundary !== key);
        serializeFragmentAssets(key, r.tracking, r.ctx);
        // (Before the shell: inlined there, in place of its placeholder.)
        if (!r.shellSent) r.inlined.set(key, value ?? "");
        else {
          const patch = !error && r.head ? headPatch(r, key) : "";
          r.sink.fragment(key, value !== undefined ? value : " ", { styles: collectStreamStyles(key, r.tracking, r.headStyles), patch, revealGroup: opts?.revealGroup, error: error ? ssrSanitizeError(error, null) : undefined });
        }
        item.resolve(error);
        r.wake?.();
        return r.shellSent;
      };
    },
    revealFragments(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      r.sink.reveal(list, { fallback: false });
    },
    revealFallbacks(keys: string | string[]) {
      r.sink.reveal(Array.isArray(keys) ? keys : [keys], { fallback: true });
    },
    flushed: () => r.shellSent,
  });
}
const noopFn = () => {};

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
  const r: Render = { async: true, waiting: new Set(), chunks: [], wake: null, revealScript: false, options, fragments: new Map(), waited: 0, holes: new Map(), shellSent: false, head: null as any, data: "", serializer: null, written: new Set(), pendingData: 0, headerSent: false, sink: null as any, ctx: null, blocks: new Set(), holds: 0, inlined: new Map(), tracking: createAssetTracking(), headStyles: null, nonce: normalizeNonce(options.nonce), abandons: new Map() };
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
      let out = meta.patch ?? "";
      for (const entry of styles.inline) out += renderInlineStyle(entry, r.nonce);
      if (styles.links.length) {
        out += takeData(r) + script(r, `$dfs("${key}",${styles.links.length},${meta.revealGroup ? 1 : 0})`) + `<template id="${key}">${value}</template>`;
        for (const entry of styles.links)
          out += typeof entry === "string" ? `<link rel="stylesheet" href="${entry}" data-dfc="${key}">` : `<link${entry.attrHtml} data-dfc="${key}">`;
      } else out += `<template id="${key}">${value}</template>` + takeData(r) + (meta.revealGroup ? "" : script(r, `$df("${key}")`));
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
  // (Set in the render's callback: not narrowed to its first null.)
  let syncFailure = null as { error: unknown } | null;
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
            const macrotask = () => new Promise<void>((ok) => deferFlush(ok));
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
        claimRender(r.ctx);
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
    if (coalesce) {
      if (r.chunks.length > sent || r.data) scheduleOut();
    } else {
      const data = takeData(r);
      if (data) r.chunks.push(data);
      for (; sent < r.chunks.length && !done; sent++) for (const w of sinks) write(w, r.chunks[sent]!);
    }
    // A frame stream ends after its serializer's last record (a trace still writing is part of the response).
    if (!r.waiting.size && !r.pendingData && !r.holds && !done && (options.sink || (r as any).liveClosing) && (r.serializer as any)?.pending > 0) {
      deferFlush(() => r.wake?.());
      return;
    }
    if (!r.waiting.size && !r.pendingData && !r.holds && !done) {
      options.onCompleteAll?.({ write: (chunk) => void r.chunks.push(chunk) });
      flushAll();
      done = (r as any).ended = true;
      // (Awaited whole, the render is let go of as it resolves: the record settles after.)
      if (!whole) record?.settle("complete", r.waited);
      dispose();
      for (const w of sinks) w.end();
      finished();
      if (whole) record?.settle("complete", r.waited, true);
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
    done = (r as any).ended = true;
    record?.settle(outcome, r.waited);
    if (reason && process.env.NODE_ENV !== "production")
      emitDiagnostic({
        code: "SSR_STREAM_ABANDONED",
        kind: "ssr",
        severity: "warn",
        message: `[SSR_STREAM_ABANDONED] The response was abandoned (${reason}) before it finished: ${r.waiting.size + r.fragments.size} fragment(s) still to come were dropped and the render torn down.`,
        data: { reason, pendingFragments: r.waiting.size + r.fragments.size, shellFlushed: shellSent },
      });
    dispose?.();
    // (The serializer stops too: its close is what reaches a source it still reads.)
    (r.serializer as any)?.close?.();
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
  // After the shell, as Solid's: what settles in one turn of the event loop goes out as one write, the data it
  // serialized included (sooner past 16 KB). A custom sink takes each part as it comes.
  const coalesce = !options.sink;
  let outScheduled = false;
  const flushAll = () => {
    outScheduled = false;
    if (done) return;
    const data = takeData(r);
    if (data) r.chunks.push(data);
    if (sent >= r.chunks.length) return;
    const out = r.chunks.slice(sent).join("");
    r.chunks.splice(sent, r.chunks.length - sent, out);
    sent = r.chunks.length;
    for (const w of sinks) write(w, out);
  };
  const scheduleOut = () => {
    let pending = r.data.length;
    for (let i = sent; i < r.chunks.length; i++) pending += r.chunks[i]!.length;
    if (pending >= 16384) return flushAll();
    if (!outScheduled) (outScheduled = true), deferFlush(flushAll);
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
  // A failure nothing contains (a boundary's, reported already): before the shell the request fails; after, it ends.
  (r as any).failRender = (e: unknown) => (shellSent ? abandon(true, "error") : (r as any).failShell(e));
  const failed = shellReady.then(
    async (s) => {
      if (whole && !quiet()) await new Promise<void>((ok) => idle.push(ok));
      // (All settled before the shell: the live channel closes with it.)
      endLive(r);
      record?.shell();
      rendering(r, options, () => {
        serializeFragmentAssets("", r.tracking, r.ctx, options.renderId ?? "");
        r.headStyles = new Set([...r.tracking.emittedAssets].filter((u) => !r.tracking.currentBoundaryId && u.endsWith(".css")));
        r.sink.shell(inlineFragments(r, s), { preloads: r.tracking.emittedAssets, preloadLinks: r.tracking.preloadLinks });
      });
      shell = documentShell;
      shellSent = true;
      if (requestEvent?.response) commitResponseStub(requestEvent.response, { event: requestEvent });
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
      return new Promise<void>((ok) => {
        // A writable that errors (a reader cancelled, the transport gone): the response is abandoned, the pipe done.
        const gone = () => (abandon(false, "abandoned", "consumer"), ok());
        writer.closed.catch(gone);
        this.pipe({
          write: (c) => void writer.write(enc.encode(c)).catch(gone),
          end: () => void writer.close().then(ok, () => ok()),
        });
      });
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
