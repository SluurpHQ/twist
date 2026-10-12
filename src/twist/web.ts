// Twist's web runtime (`@solidjs/web`): what JSX marked by Twist's pass (the core's twist_compile.rs) and transformed
// by Bun's JSX calls. Elements are made at once, fixed markup copied from templates; each marked part is bound to its
// node by an effect of its own; components run once. Written from Solid 2's design (RFCs 03 and 07) and its tests,
// not its code.
declare const process: { env: Record<string, string | undefined> };
import { diagnose, OBSERVE } from "./diagnostics.ts";
import {
  flush,
  createLoadingBoundary,
  createMemo,
  isAccessor,
  resetErrorHalt,
  createEffect,
  createRenderEffect,
  createRoot,
  flatten,
  getOwner,
  ROOT_ERROR_HOOK,
  onCleanup,
  runWithOwner,
  untrack,
  NotReadyError,
  getNextChildId,
  scopeIdOf,
  sharedConfig,
  createSignal,
  createOwner,
  ownerUnder,
  peekNextChildId,
  resetOwner,
  keyOwnerOf,
  Computation,
  startEffect,
  RENDER_EFFECT,
  hydrationFlag,
  runAgain,
  type Owner,
} from "./signals.ts";
import { checkHydrationComplete, enableHydration, fragmentAbort, hydrationPaused, initBoundaryResume } from "./hydration.ts";
import { merge, omit, isStatic, leafDescriptor, LIVE } from "./flow.ts";
import { $PROXY, $TARGET } from "./store.ts";
export { isStatic };
import { __twist_c, __twist_d, __twist_ref, componentProps, createComponent, callComponent, callInline, renderComponent, isChildren, isDynamic, spreadSource, Loading, Errored, isTwist, __twist_mark, builtin, setDescribedNode, erroredFallback, $DEVCOMP } from "./control.ts";

export * from "./control.ts";
export * from "./response.ts";
import { inOrder } from "../shared/in-order.ts";
import { MATH_NS, MATH_TAGS, SVG_NS, SVG_TAGS, Place, expand, hasHoles, places, type Spec } from "./tags.ts";

export { createRoot, untrack, getOwner, flatten, merge, omit };

/**
 * Solid's `template(html)`: markup parsed once, a copy made each call (flag 1: imported, for a custom element's
 * document; 2: the inside of an outer element). A document shell cannot be made this way: hydrate() adopts it.
 */
export function template(html: string, flag?: number): (() => Node) & { _html: string } {
  let node: Node | undefined;
  const create = () => {
    if (process.env.NODE_ENV !== "production" && /^<(html|head|body)[\s>]/i.test(html))
      throw new Error(
        "Document shell templates (<html>, <head>, <body>) cannot be client-created: a <template> parse strips those tags. Render this component through hydrate(), where the document shell already exists.",
      );
    const t = document.createElement("template");
    t.innerHTML = html;
    return flag === 2 ? t.content.firstChild!.firstChild! : t.content.firstChild!;
  };
  const fn: any = flag === 1 ? () => document.importNode((node ??= create()), true) : () => (node ??= create()).cloneNode(true);
  fn._html = flag === 2 ? html.replace(/^<[^>]+>/, "") : html;
  return fn;
}
export const isServer = false;

// ---------------------------------------------------------------- jsx

export const Fragment = (props: { children?: unknown }) => props.children;

/** What `<type {...props}>` makes: an element, or what a component returns. */
export function jsx(type: any, props: Record<string, any>) {
  // Hydrating: descriptions, claimed from the server's page top-down (in the order the server rendered them).
  if (describing()) return type === Fragment ? props.children : typeof type === "function" ? { [COMP]: true, fn: type, props } : { [EL]: true, tag: type, props };
  if (typeof type === "function") {
    if (type === Fragment) return childrenOf(props);
    // (A component of React's is mounted as a React subtree, when the bridge is there.)
    return callComponent(type, componentProps(props));
  }
  return element(type, props);
}

/** Several children written in the JSX (while hydrating, the template's own list: no separators between them). */
export function jsxs(type: any, props: Record<string, any>) {
  if (describing() && Array.isArray(props.children)) (props.children as any)[OWN] = true;
  return jsx(type, props);
}

export function jsxDEV(type: any, props: Record<string, any>, _key?: unknown, staticChildren?: boolean) {
  return staticChildren ? jsxs(type, props) : jsx(type, props);
}

const childrenOf = (props: Record<string, any>) => {
  const c = props.children;
  return isChildren(c) || isDynamic(c) ? c : c;
};

// ---------------------------------------------------------------- elements

/** Form state kept as properties (RFC 07): the rest are attributes. */
const PROPS: Record<string, Set<string>> = {
  value: new Set(["INPUT", "SELECT", "OPTION", "TEXTAREA"]),
  defaultValue: new Set(["INPUT", "TEXTAREA"]),
  checked: new Set(["INPUT"]),
  defaultChecked: new Set(["INPUT"]),
  selected: new Set(["OPTION"]),
  defaultSelected: new Set(["OPTION"]),
  muted: new Set(["VIDEO", "AUDIO"]),
  defaultMuted: new Set(["VIDEO", "AUDIO"]),
};

function element(tag: string, props: Record<string, any>): Element {
  // With a spread: every prop as one merged source (later ones winning, a key the spread drops falling back).
  const merged = hasSpread(props) ? mergedProps(props) : null;
  // `xmlns`, read once (untracked): the namespace it is made in, over what its tag says.
  const xmlns = untrack(() => {
    const v = (merged ?? props).xmlns;
    return isDynamic(v) ? v() : v;
  });
  const el =
    typeof xmlns === "string"
      ? document.createElementNS(xmlns, tag)
      : SVG_TAGS.has(tag) && tag !== "title"
        ? document.createElementNS(SVG_NS, tag)
        : MATH_TAGS.has(tag)
          ? document.createElementNS(MATH_NS, tag)
          : document.createElement(tag);
  if (merged) return spreadOn(el, merged, false, false), el;
  for (const k of Object.keys(props)) if (k !== "children") set(el, k, props[k]);
  if ("children" in props) insertHosted(el, props.children, null);
  // A select's static value, as Solid's compiled code sets it: once its options are in, and again after a microtask
  // (for options that come later).
  if (tag === "select" && "value" in props && !isDynamic(props.value) && !hydrating) {
    const v = props.value;
    (el as HTMLSelectElement).value = v;
    queueMicrotask(() => ((el as HTMLSelectElement).value = v));
  }
  return el;
}

/**
 * A template (compiled from JSX whose markup is fixed): made once, copied for each use, its values set where they go.
 * Hydrating, the JSX it stands for.
 */
export function __twist_t(spec: Spec) {
  let made: Node | null = null;
  const plan = planOf(spec);
  return (values: unknown[]) => {
    if (describing()) {
      // (Keyed under the owner that made it, as Solid's template takes its key where it is made.)
      const d = expand(spec, values, { i: 0 }, jsx, jsxs);
      if (d && d[EL]) d.owner = getOwner();
      return d;
    }
    const el = (made ??= build(spec)).cloneNode(true) as Element;
    fill(el, plan, values, { i: 0 });
    return el;
  };
}
/**
 * How a copy is filled, worked out once: the element's attributes set at run time, and a step per child up to the
 * last one with something to do (null: none) — past a fixed node, into a fixed element with values below, or a value
 * put before its marker.
 */
type Plan = { slots: string[]; events: string[]; steps: Step[] | null };
type Step = { place: Place; value: boolean; inner: Plan | null };
function planOf(spec: Spec): Plan {
  const where = places(spec);
  const steps: Step[] = spec[3].map((k, i) => ({ place: where[i]!, value: k === 0, inner: k !== 0 && typeof k !== "string" && hasHoles(k) ? planOf(k) : null }));
  while (steps.length && !steps[steps.length - 1]!.value && !steps[steps.length - 1]!.inner) steps.pop();
  return { slots: spec[2], events: spec[2].map(eventOf), steps: steps.length ? steps : null };
}
function build(spec: Spec): Element {
  const [tag, fixed, , kids] = spec;
  const el = document.createElement(tag);
  for (let i = 0; i < fixed.length; i += 2) el.setAttribute(fixed[i]!, fixed[i + 1]!);
  const where = places(spec);
  kids.forEach((k, i) => {
    if (k !== 0) el.appendChild(typeof k === "string" ? document.createTextNode(k) : build(k));
    else if (where[i] === Place.Comment) el.appendChild(document.createComment(""));
  });
  return el;
}
/** A copy's values in place, as its plan says: attributes set, then each child value before its marker (the walk first, as values move nodes). */
function fill(el: Element, plan: Plan, values: unknown[], at: { i: number }) {
  const slots = plan.slots;
  for (let i = 0; i < slots.length; i++) {
    const type = plan.events[i]!;
    type ? addEvent(el, type, values[at.i++], BUBBLING.has(type)) : set(el, slots[i]!, values[at.i++]);
  }
  const steps = plan.steps;
  if (!steps) return;
  let node = el.firstChild;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    // (Put before the node the walk is at, or at the end: never in the way of what is left to walk.)
    if (step.value) {
      insertHosted(el, values[at.i++], step.place === Place.End ? null : node);
      if (step.place === Place.Comment) node = node!.nextSibling;
      continue;
    }
    if (step.inner) fill(node as Element, step.inner, values, at);
    node = node!.nextSibling;
  }
}

const hasSpread = (props: Record<string, any>) => Object.keys(props).some((k) => k.startsWith("$spread$"));

/** JSX props with spreads as one source, in their order: a marked part read where used, a spread read each time. */
function mergedProps(props: Record<string, any>) {
  const sources: any[] = [];
  let own: Record<string, any> | null = null;
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (k.startsWith("$spread$")) {
      if (own) sources.push(own), (own = null);
      sources.push(spreadSource(v));
      continue;
    }
    own ??= {};
    if (isDynamic(v) && !/^on[A-Z]/.test(k) && k !== "ref") Object.defineProperty(own, k, { enumerable: true, configurable: true, get: v });
    else own[k] = v;
  }
  if (own) sources.push(own);
  return merge(...sources);
}

/** A prop on an element: bound when it can change, set once when it cannot. */
/** An element's prop bound to a value: its state on the effect. */
class PropBinding extends Computation<any> {
  declare el: Element;
  declare prop: string;
  declare source: () => any;
  /** Hydrating: its first value is what the page shows already, nothing written (what the user typed stays). */
  declare adopt: boolean;
}
// (A style or class object is read whole: one changed in place applies again.)
function propCompute(this: PropBinding) {
  const v = this.source();
  return this.prop === "style" || this.prop === "class" ? readShallow(v) : v;
}
Object.assign(PropBinding.prototype, { adopt: false, apply: propApply, transparent: true });
function propApply(this: PropBinding, v: any, prev: any) {
  if (this.adopt) {
    this.adopt = false;
    if (this.prop === "class") (this.el as any).$$cls = classes(v);
    return;
  }
  assignProp(this.el, this.prop, v, prev);
}

/** An event prop's type, by its name (onClick: click; "" for a prop that is no event). */
const eventTypes = new Map<string, string>();
function eventOf(name: string) {
  let type = eventTypes.get(name);
  if (type === undefined) eventTypes.set(name, (type = /^on[A-Z]/.test(name) ? name.slice(2).toLowerCase() : ""));
  return type;
}
function set(el: Element, name: string, value: any) {
  // (A ref given through a getter: its value, read once, applied.)
  if (name === "ref") return applyRef(isDynamic(value) ? untrack(value) : value, el);
  const type = eventOf(name);
  if (type) return addEvent(el, type, value, BUBBLING.has(type));
  if (isDynamic(value)) {
    // (A binding takes no id: the server makes none for it.)
    const b = new PropBinding(RENDER_EFFECT, propCompute, bindingNamed(el, name));
    b.el = el;
    // (Development: the element it writes, shown beside a finding about it.)
    if (process.env.NODE_ENV !== "production") (b as any)._devElement = el;
    b.prop = name;
    b.source = value;
    if (hydrating) b.adopt = true;
    startEffect(b);
    return;
  }
  // Hydrating: a static value is in the page already.
  if (hydrating) return;
  assignProp(el, name, value, undefined);
}

/** One attribute, class, style or property written. */
/**
 * Props applied to an element as a whole, once (Solid's `assign`): those gone from `prevProps` cleared, the rest set;
 * handlers listened to, `ref` called (unless `skipRef`), `children` inserted (unless `skipChildren`). `prevProps` is
 * updated in place, for the next call.
 */
export function assign(node: Element, props: Record<string, any> | null | undefined, skipChildren?: boolean, prevProps: Record<string, any> = {}, skipRef = false) {
  props ||= {};
  for (const k in prevProps) if (!(k in props) && k !== "children") prevProps[k] = assignOne(node, k, null, prevProps[k], skipRef);
  for (const k in props) {
    if (k === "children") {
      if (!skipChildren) insert(node, props.children);
      continue;
    }
    prevProps[k] = assignOne(node, k, props[k], prevProps[k], skipRef);
  }
}

/** An element's own (not delegated) listeners, by handler and event type: what to remove when a handler changes. */
const listenersOf = new WeakMap<Element, Map<unknown, Map<string, EventListener>>>();

function assignOne(el: Element, name: string, value: any, prev: any, skipRef: boolean) {
  // (The same ref as last time: called once, not again.)
  if (name === "ref") return value !== prev && !skipRef && value && applyRef(value, el), value;
  if (/^on[A-Z]/.test(name)) {
    // The same handler (a tuple too): nothing rebound.
    if (value === prev) return prev;
    const type = name.slice(2).toLowerCase();
    const delegate = BUBBLING.has(type);
    // (Each listener is found by its handler: two spreads on one element listen apart.)
    const own = delegate ? undefined : (listenersOf.get(el) ?? listenersOf.set(el, new Map()).get(el)!);
    const was = prev && own?.get(prev)?.get(type);
    if (was) el.removeEventListener(type, was), own!.get(prev)!.delete(type);
    // (A delegated one gone: nothing left on the element for the root's listener to find.)
    if (delegate && !value) {
      const [key, data] = keysOf(type);
      (el as any)[key] = (el as any)[data] = undefined;
    }
    if (value) {
      if (delegate) addEvent(el, type, value, true);
      else {
        const l = listenerFor(value);
        (own!.get(value) ?? own!.set(value, new Map()).get(value)!).set(type, l);
        el.addEventListener(type, l);
      }
    }
    return value;
  }
  if (value === prev && name !== "value" && name !== "checked") return prev;
  assignProp(el, name, value, prev);
  return value;
}

/** One prop on an element: class, style, the content props, DOM properties, else an attribute. */
export function assignProp(el: Element, name: string, value: any, prev: any) {
  // (`className`, as React code writes it: the class.)
  if (name === "class" || name === "className") return className(el, value, prev);
  if (name === "style") return style(el as HTMLElement, value, prev);
  if (name === "innerHTML" || name === "textContent" || name === "innerText") return void ((el as any)[name] = value ?? "");
  if (PROPS[name]?.has(el.nodeName)) return setProperty(el, name, value);
  setAttribute(el, name, value);
}

export function setAttribute(el: Element, name: string, value: any) {
  // `onclick={fn}`: an attribute in Solid 2, not a handler (said once per name).
  if (process.env.NODE_ENV !== "production" && typeof value === "function" && name.startsWith("on")) lowercaseEventAttribute(name, el);
  if (value == null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? "" : String(value));
  if (claimHandlers !== null && (name === "href" || name === "action")) claimElement(el);
}

// Element claims: consumers (a router's link layer, frames) told of every `a[href]` and `form[action]`.
let claimHandlers: ((el: Element) => void)[] | null = null;
const CLAIM_SEAM = Symbol.for("solid.element-claims");
const CLAIMED_ELEMENTS = "a[href], form[action]";

/** Register a consumer of element claims; returns its unregister. @internal */
export function registerElementClaim(handler: (el: Element) => void): () => void {
  (claimHandlers ??= (globalThis as any)[CLAIM_SEAM] = []).push(handler);
  return () => {
    const i = claimHandlers!.indexOf(handler);
    i > -1 && claimHandlers!.splice(i, 1);
  };
}

/** Claim one element for the registered consumers. @internal */
export function claimElement<T extends Element>(node: T): T {
  if (claimHandlers !== null) for (const h of claimHandlers) h(node);
  return node;
}

/** Replays events caught before hydration; Twist catches none yet. @internal */
/**
 * Events the page's bootstrap queued before hydration (`_$HY.events`), run in order once their target is claimed (the
 * first not claimed yet waits, and those after it); dropped once hydration is done and the queue is empty.
 */
export function runHydrationEvents() {
  const events = (sc as any).events as ([EventTarget, Event][] & { queued?: boolean }) | null | undefined;
  if (!events || events.queued) return;
  events.queued = true;
  queueMicrotask(() => {
    events.queued = false;
    const completed = (sc as any).completed as WeakSet<object> | undefined;
    while (events.length) {
      const [el, e] = events[0]!;
      if (!completed?.has(el)) return;
      events.shift();
      for (const root of roots) if (root.contains(el as Node)) dispatch(e, root);
    }
    const hy = (globalThis as any)._$HY;
    if (hy?.done) (sc as any).events = (sc as any).completed = hy.events = hy.completed = null;
  });
}

/** Claim every `a[href]` and `form[action]` in a subtree (content that arrives as markup). @internal */
export function claimElementTree<T extends Node>(root: T): T {
  const handlers: ((el: Element) => void)[] | undefined = (globalThis as any)[CLAIM_SEAM];
  if (!handlers?.length || (root.nodeType !== 1 && root.nodeType !== 11)) return root;
  if (root.nodeType === 1 && (root as any as Element).matches(CLAIMED_ELEMENTS)) for (const h of handlers) h(root as any);
  for (const el of (root as any as ParentNode).querySelectorAll(CLAIMED_ELEMENTS)) for (const h of handlers) h(el);
  return root;
}

export function setProperty(el: Element, name: string, value: any) {
  (el as any)[name] = name === "value" || name === "defaultValue" ? (value ?? "") : value;
}

/** A class: a string, an object of name → on, or an array of either (nested). */
export function className(el: Element, value: any, prev?: any) {
  // A number is its text (0 included).
  if (typeof value === "number") value = String(value);
  if (typeof prev === "number") prev = String(prev);
  // A string is the whole class (kept as given: an object later diffs against it).
  if (typeof value === "string" || value == null || value === false) {
    (el as any).$$cls = value || undefined;
    if (!value) return el.removeAttribute("class");
    return el.setAttribute("class", value);
  }
  const now = classes(value);
  // What it applied last (an object changed in place is not what it was): the diff is against that.
  const was = (el as any).$$cls;
  const before: Set<string> = was instanceof Set ? was : classes(was ?? prev);
  (el as any).$$cls = now;
  for (const c of before) if (!now.has(c)) el.classList.remove(c);
  for (const c of now) if (!before.has(c)) el.classList.add(c);
}

function classes(v: any, out = new Set<string>()): Set<string> {
  if (v == null || typeof v === "boolean" || v === "") return out;
  if (typeof v === "string") for (const c of v.split(/\s+/)) c && out.add(c);
  else if (typeof v === "number") out.add(String(v));
  else if (Array.isArray(v)) for (const x of v) classes(x, out);
  else if (typeof v === "object") for (const k of Object.keys(v)) if (v[k]) classes(k, out);
  return out;
}

/** A style: a string, or an object of CSS property → value. */
export function style(el: HTMLElement, value: any, prev?: any) {
  // What it applied last (an object changed in place is not what it was): the diff is against that.
  const applied = (el as any).$$style;
  if (value == null || value === false || value === "") return void ((el as any).$$style = undefined), el.removeAttribute("style");
  if (typeof value === "string") return void ((el as any).$$style = undefined), void (el.style.cssText = value);
  prev = applied ?? prev;
  // (Over a string it set, cleared first; over nothing of its own, the properties already there stay.)
  if (typeof prev === "string") el.style.cssText = "";
  if (typeof prev !== "object" || prev == null) prev = {};
  const now: Record<string, any> = {};
  for (const k of Object.keys(value)) now[k] = value[k];
  for (const k of Object.keys(prev)) if (now[k] == null) el.style.removeProperty(k);
  for (const k of Object.keys(now)) if (now[k] != null && now[k] !== prev[k]) el.style.setProperty(k, String(now[k]));
  (el as any).$$style = now;
}

/** `ref`: a function called with the element, or a list of them (nested). */
export function applyRef(r: any, el: Element) {
  if (Array.isArray(r)) for (const x of r) applyRef(x, el);
  else if (typeof r === "function") runWithOwner(null, () => r(el));
}

/** Props given as a whole: each applied, kept current. */
/**
 * Props given as a whole (Solid's spread): an object, an accessor, or a list of them (later ones win; only the
 * winning key read); `skip` names keys left alone. One effect applies them, ref included (called again when it
 * changes); children inserted on their own, with no effect when they are plain data.
 */
export function spread(el: Element, props: any, skipChildren?: boolean, skip?: (key: string) => boolean, name?: string) {
  spreadOn(el, props, !!skipChildren, false, skip, name ?? null);
  return props;
}

const isEvent = (k: string) => /^on[A-Z]/.test(k);
/** The sources a spread reads, each as an object (an accessor called, nothing dropped). */
const sourcesOf = (props: any): any[] => (Array.isArray(props) ? props : [props]).map((p) => (typeof p === "function" ? p() : p)).filter((p) => p != null);

/** A spread applied: `claiming` the server's element, its first value is what the page shows already. */
function spreadOn(el: Element, props: any, skipChildren: boolean, claiming: boolean, skip?: (key: string) => boolean, name: string | null = el.localName) {
  if (!props) return;
  // (Whether the children are claimed is decided now: the attribute effect below clears its own flag.)
  const claimingChildren = claiming;
  const prev: Record<string, any> = {};
  createRenderEffect(
    () => {
      const next: Record<string, any> = {};
      const sources = sourcesOf(props);
      // From the last source back: the first to have a key wins, and a key shadowed is never read.
      for (let i = sources.length - 1; i >= 0; i--)
        for (const k of Object.keys(sources[i])) {
          if (k === "children" || k in next || skip?.(k)) continue;
          const v = sources[i][k];
          next[k] = k === "style" || k === "class" ? readShallow(v) : v;
        }
      return next;
    },
    (next: Record<string, any>) => {
      const r = next.ref;
      if (r !== prev.ref && (typeof r === "function" || Array.isArray(r))) runWithOwner(null, () => applyRef(r, el));
      // Claiming the server's element: what it shows already is the first value (handlers attached, nothing written).
      if (claiming) {
        claiming = false;
        if ("class" in next) (el as any).$$cls = classes(next.class);
        for (const k of Object.keys(next)) prev[k] = isEvent(k) ? assignOne(el, k, next[k], undefined, true) : next[k];
        return;
      }
      assign(el, next, true, prev, true);
    },
    bindingOptions(name && `${name}.spread`),
  );
  if (skipChildren || skip?.("children")) return;
  if (claimingChildren) return void claims!.children(untrack(() => props.children), { parent: el, next: el.firstChild });
  // Plain data children: put in once, no effect for them.
  const plain = !Array.isArray(props) && typeof props !== "function" ? untrack(() => leafDescriptor(props, "children")) : undefined;
  if (plain && !plain.get) return void insertHosted(el, plain.value, null, undefined, undefined, name && `${name}.children`);
  // (An object without them: nothing to insert. A source that is called is read only by the effect; a store or a live
  // view can grow them later.)
  if (!plain && !Array.isArray(props) && typeof props !== "function" && !(props as any)[LIVE] && !($PROXY in props) && !untrack(() => Object.hasOwn(props, "children"))) return;
  insertHosted(el, () => {
    const sources = sourcesOf(props);
    for (let i = sources.length - 1; i >= 0; i--) if (Object.hasOwn(sources[i], "children")) return sources[i].children;
  }, null, undefined, undefined, name && `${name}.children`);
}

// ---------------------------------------------------------------- events, delegated per render root

const delegated = new Set<string>();
const roots = new Set<Node>();
const listening = new WeakMap<Node, Set<string>>();

/** `onX` handlers: kept on the element, run by the root's listener as the event bubbles. */
const eventKeys = new Map<string, [string, string]>();
/** Where an event type's handler and its data are kept on an element. */
function keysOf(type: string) {
  let keys = eventKeys.get(type);
  if (!keys) eventKeys.set(type, (keys = [EVENT_KEY + type, EVENT_KEY + type + "Data"]));
  return keys;
}
export function addEvent(el: Element, type: string, handler: any, delegate = true) {
  // Not delegated: a listener of its own on the element (a handler given as [fn, data] is called with data first).
  if (!delegate) return void el.addEventListener(type, listenerFor(handler));
  // (Where Solid keeps it: `_$$type`, a [fn, data] handler's data beside it.)
  const keys = keysOf(type);
  if (Array.isArray(handler)) ((el as any)[keys[0]] = handler[0]), ((el as any)[keys[1]] = handler[1]);
  else if (((el as any)[keys[0]] = handler), (el as any)[keys[1]] !== undefined) (el as any)[keys[1]] = undefined;
  if (!delegated.has(type)) {
    delegated.add(type);
    for (const r of roots) listen(r, type);
    for (const c of containers.keys()) listen(c, type);
  }
}

/** Events that bubble, handled by one listener per root; the rest get a listener on their element. */
const BUBBLING = new Set(
  "beforeinput,click,dblclick,contextmenu,focusin,focusout,input,keydown,keyup,mousedown,mousemove,mouseout,mouseover,mouseup,pointerdown,pointermove,pointerout,pointerover,pointerup,touchend,touchmove,touchstart".split(","),
);

/** A handler as a DOM listener: [fn, data] calls fn(data, event). */
function listenerFor(handler: any): EventListener {
  const l: EventListener = Array.isArray(handler) ? (e) => handler[0].call(e.currentTarget, handler[1], e) : typeof handler === "function" ? handler : (e) => handler?.handleEvent?.(e);
  // (Development: run as the interaction the event is, so what it writes is told as that interaction's.)
  return process.env.NODE_ENV !== "production" ? function (this: unknown, e: Event) { return dispatchAsInteraction(e, () => (l as any).call(this, e)); } : l;
}

/** `button#next "Next →"`, `input[name=q]`, `a "Docs"` — what the user hit. */
function describeEventTarget(target: any): string | undefined {
  if (!target || typeof target.tagName !== "string") return undefined;
  const tag = target.tagName.toLowerCase();
  let out = tag;
  if (target.id) out += `#${target.id}`;
  else if (typeof target.name === "string" && target.name) out += `[name=${target.name}]`;
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    const text = (target.textContent || "").trim().replace(/\s+/g, " ");
    if (text) out += ` "${text.length > 30 ? text.slice(0, 29) + "…" : text}"`;
  }
  return out;
}
/** When the browser made the event, on the performance clock (none when its clock is another). */
function interactionStart(e: Event): number | undefined {
  const at = e.timeStamp;
  return typeof at === "number" && at >= 0 && at <= performance.now() ? at : undefined;
}
/**
 * Runs `fn` as a handler of the DOM event `e`, inside the interaction the runtime opens for `e` (development tools
 * then tell what it writes as that interaction's). For listeners the runtime did not attach; in production, `fn()`.
 */
export function dispatchAsInteraction<T>(e: Event, fn: () => T): T {
  return process.env.NODE_ENV !== "production" && OBSERVE ? OBSERVE.attribution.withInteraction({ type: e.type, target: describeEventTarget(e.target), at: interactionStart(e), event: e }, fn) : fn();
}

/** The event names compiled code says it needs. */
export function delegateEvents(names: string[]) {
  for (const n of names) if (!delegated.has(n)) (delegated.add(n), roots.forEach((r) => listen(r, n)));
}

function listen(root: Node, type: string) {
  let types = listening.get(root);
  if (!types) listening.set(root, (types = new Set()));
  if (types.has(type)) return;
  types.add(type);
  // (A portal's mount outside every root listens for the root its portal is in: events go on there.)
  root.addEventListener(type, (e) => (process.env.NODE_ENV !== "production" ? dispatchAsInteraction(e, () => dispatch(e, containers.get(root) ?? root)) : dispatch(e, containers.get(root) ?? root)));
}

/** Portal mounts outside every render root → the root their portal sits in. */
const containers = new Map<Node, Node>();
/** The next node an event bubbles to: up the DOM, except from a portal's content: on from where the portal sits. */
const bubbleFrom = (node: any): Node | null => node._$host ?? node.parentNode;
/** A node's logical host (a portal's place in the tree, for events): read live from `host`. */
function tagHost(n: Node, host: () => Node | null) {
  if (Object.getOwnPropertyDescriptor(n, "_$host")?.get !== host) Object.defineProperty(n, "_$host", { get: host, configurable: true });
}

const EVENT_KEY = "_$$";

function dispatch(e: Event, root: Node) {
  const [key, dataKey] = keysOf(e.type);
  let node = e.target as any;
  const target = node;
  Object.defineProperty(e, "currentTarget", { configurable: true, get: () => node ?? root });
  // (Roots inside one another, or a portal's mount and its root, may both see the event: each handler runs once.)
  let ran: Set<Node> | undefined = (e as any).$$ran;
  while (node && node !== root) {
    let handler = node[key];
    if (handler) {
      if (ran?.has(node)) handler = null;
      else (ran ??= (e as any).$$ran = new Set<Node>()).add(node);
    }
    if (handler && !node.disabled) {
      if (isDynamic(handler)) handler = handler();
      const data = node[dataKey];
      if (data !== undefined) handler.call(node, data, e);
      else if (Array.isArray(handler)) handler[0].call(node, handler[1], e);
      else if (typeof handler === "function") handler.call(node, e);
      else handler?.handleEvent?.(e);
      if (e.cancelBubble) break;
    }
    node = bubbleFrom(node);
  }
  void target;
}

// ---------------------------------------------------------------- inserting

/** What a value puts in the page: nodes, text (as text nodes), nothing; accessors read. */
/**
 * The nodes a description claimed while hydrating: what it stands for after (a list keeps the row it made then, the
 * description, and gives it again when it changes).
 */
/** Hydration's claim pass, reached through here: `hydrate()` fills it, so a page that never hydrates carries none of it. */
let claims: { html: typeof claimHtml; list: typeof claimList; children: typeof claimChildren } | null = null;
const claimedNodes = new WeakMap<object, Node[]>();
const claimedBy = (d: object, nodes: Node[]) => (claimedNodes.set(d, nodes), nodes);

function nodesOf(value: any, out: Node[], reuse: Node[], top = true): Node[] {
  if (value === "" && top) {
    // (Text emptied: the node it showed in stays, empty.)
    const old = reuse.find((n) => n.nodeType === 3);
    if (old) ((old as Text).data !== "" && ((old as Text).data = "")), out.push(old);
    return out;
  }
  if (value == null || value === true || value === false || value === "") return out;
  if ((value as Node).nodeType) return out.push(value), out;
  const claimed = typeof value === "object" && claimedNodes.get(value);
  if (claimed) return out.push(...claimed), out;
  // A description made while hydrating but never claimed (a fallback built then, shown later): drawn now.
  if (typeof value === "object" && (value[EL] || value[COMP])) {
    const made = clientOnlyRun(() => (value[EL] ? jsx(value.tag, value.props) : jsx(value.fn, value.props)));
    claimedNodes.set(value, nodesOf(made, [], []));
    return out.push(...claimedNodes.get(value)!), out;
  }
  if (typeof value === "function") return nodesOf(value(), out, reuse);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      v && v.nodeType ? out.push(v) : nodesOf(v, out, reuse, false);
    }
    return out;
  }
  // Neither text, a node, a list nor something to call: skipped, and said (as Solid's insert).
  if (typeof value === "object" || typeof value === "symbol") {
    if (process.env.NODE_ENV !== "production") diagnose({
      code: "UNRECOGNIZED_INSERT_VALUE",
      kind: "render",
      severity: "warn",
      message: `[UNRECOGNIZED_INSERT_VALUE] Unrecognized value. Skipped inserting (${typeof value}).`,
      data: { type: typeof value, value },
    }, getOwner());
    return out;
  }
  const text = String(value);
  const old = reuse.find((n) => n.nodeType === 3 && !out.includes(n));
  if (old) {
    if ((old as Text).data !== text) (old as Text).data = text;
    out.push(old);
  } else out.push(document.createTextNode(text));
  return out;
}

/**
 * `value` put in `parent` (before `marker`, else at the end), kept current when it can change. Lists move by the
 * longest run still in order; nodes kept stay.
 */
export function insert(parent: Node, value: any, marker?: Node | null, initial?: Node[] | string | number, options?: { name?: string; host?: () => Node | null }) {
  // (A marker given, null included: a slot among siblings, its place held when it shows nothing.)
  const slot = marker !== undefined;
  marker ??= null;
  // (The text it shows now, given as such: what the parent holds.)
  if (initial != null && !Array.isArray(initial)) initial = marker === null ? [...parent.childNodes] : [];
  // In a claim window over server nodes: claimed where they are.
  if (claims && initial?.length && sharedConfig.hydrating && (!sc.isClaiming || sc.isClaiming())) {
    const was = hydrating;
    hydrating ??= { registry: sc.registry ?? new Map() };
    try {
      // Nodes made here, never in the page, over the server's: a mismatch — the server's stay.
      if (madeHere(value)) return;
      // What the server had there and the value did not claim: gone, as an insert over `initial` replaces it.
      const claimed = claims.html(value, false, { parent, next: initial[0]! });
      for (const n of initial) if (!claimed.includes(n) && n.parentNode === parent) parent.removeChild(n);
      return;
    } finally {
      hydrating = was;
    }
  }
  // (A plain function: run in a memo of its own, as Solid's insert, so what it returns changing inside — a memo in it —
  // does not run it again.)
  if (typeof value === "function" && !isAccessor(value)) value = createMemo(value, { transparent: true, name: options?.name ?? "effect" });
  insertHosted(parent, value, marker, initial, options?.host, options?.name ?? null, slot);
}

/** Whether a value is nodes made outside the page (not one of them in it). */
const madeHere = (v: any): boolean =>
  Array.isArray(v) ? v.length > 0 && v.every(madeHere) : v != null && typeof v === "object" && typeof v.nodeType === "number" && !v.isConnected;

/** A fragment's placeholder range gone (its boundary disposed before it arrived). */
function cleanupFragment(id: string) {
  const tpl = document.getElementById("pl-" + id);
  if (!tpl) return;
  for (let n = tpl.nextSibling; n; ) {
    const next = n.nextSibling;
    const end = n.nodeType === 8 && (n as Comment).nodeValue === "pl-" + id;
    n.remove();
    if (end) break;
    n = next;
  }
  tpl.remove();
}

/** `insert`, with each node told its portal host. */
function insertHosted(parent: Node, value: any, marker: Node | null, initial?: Node[], host?: () => Node | null, name?: string | null, slot = false) {
  // Children given as a list: static ones put in place; a part that can change, bound where it sits (before an empty
  // anchor of its own when more follows it).
  if (Array.isArray(value) && value.some((v) => typeof v === "function")) {
    const last = value.length - 1;
    value.forEach((v, i) => {
      if (typeof v !== "function" || i === last) return insertHosted(parent, v, marker, i === last ? initial : undefined, host, name);
      const anchor = document.createTextNode("");
      if (host) tagHost(anchor, host);
      parent.insertBefore(anchor, marker);
      bind(parent, v, anchor, undefined, host, undefined, name);
    });
    return;
  }
  if (typeof value !== "function") {
    const next = nodesOf(value, [], initial ?? []);
    if (slot && !next.length) next.push(document.createTextNode(""));
    if (host) for (const n of next) tagHost(n, host);
    if (initial?.length) reconcile(parent, initial, next, marker);
    else for (const n of next) parent.insertBefore(n, marker);
    return;
  }
  bind(parent, value, marker, undefined, host, initial, name);
}

/** A part that can change, rendered before `end` (at the end of `parent` when null) and kept current. */
function bind(parent: Node, value: () => any, end: Node | null, claimed?: Cursor, host?: () => Node | null, initial?: Node[], name?: string | null, scoped = false) {
  const options = name === undefined ? bindingNamed(parent, "children") : bindingOptions(name);
  // A template's dynamic hole: an id scope of its own, as Solid's insert effect (and the server's hole) is.
  const o = scoped && isDynamic(value) ? getOwner() : null;
  const id = o ? scopeIdOf(o) : undefined;
  const b = new Binding(RENDER_EFFECT, bindingCompute, id === undefined ? options : { ...options, id });
  if (id !== undefined) b.transparent = false;
  b.place = parent;
  b.source = value;
  if (end) b.endAt = end;
  if (initial?.length) b.nodes = initial;
  if (claimed) b.first = claimed;
  if (host) b.host = host;
  startEffect(b);
  return b;
}
/** Bindings whose first value was pending as they were claimed (counted: a marked range keeps its nodes for them). */
let pendingClaims = 0;
/** A node's children bound to a value: its state on the effect (one object a binding, no closures). */
const NO_NODES: Node[] = [];
/** Its text is the one node its element has (set as textContent: not looked up until it changes). */
const IN_PLACE = {} as Text;
class Binding extends Computation<any> {
  declare place: Node;
  declare source: () => any;
  declare endAt: Node | null;
  /** The nodes it shows now: one text node, or a list. */
  declare text: Text | null;
  /** The text it last wrote there (undefined: adopted, not written yet). */
  declare said: string | undefined;
  declare nodes: Node[];
  /** Hydrating: where its first value claims the server's nodes. */
  declare first: Cursor | undefined;
  /** A first claim made after the walk (its value was pending): the server's keys it claims from. */
  declare lateRegistry: Map<string, Element> | undefined;
  declare host: (() => Node | null) | undefined;
  /** A value's nodes in place: claimed from the server's the first time when hydrating. */
  show(v: any) {
    // Hydrating: its first value claims the server's nodes where it sits (under this binding, as the server ran it).
    const at = this.first;
    if (!at) return v;
    this.first = undefined;
    // A hole the server marked (<!--$-->…<!--/-->): claimed between its markers, the end one its anchor.
    const open = at.next && at.next.nodeType === 8 && (at.next as Comment).data === "$" ? at.next : null;
    if (open) at.next = open.nextSibling;
    const claim = () => untrack(() => claims!.list(Array.isArray(v) ? v : [v], false, false, true, at));
    // (Claimed after the walk: in a window of its own, the keys the walk had.)
    const late = this.lateRegistry;
    let current: Node[];
    if (late && !hydrating) {
      this.lateRegistry = undefined;
      hydrating = { registry: late };
      try {
        current = (sc as any).hydrateWindow ? (sc as any).hydrateWindow(undefined, claim, { registry: late }, this) : claim();
      } finally {
        hydrating = null;
      }
    } else current = claim();
    this.nodes = current;
    if (open) {
      let n = at.next;
      while (n && !(n.nodeType === 8 && (n as Comment).data === "/")) {
        // Not what it renders (the server's page differed): gone.
        const x = n.nextSibling;
        if (!current.includes(n)) n.parentNode!.removeChild(n);
        n = x;
      }
      this.endAt = n;
      at.next = n ? n.nextSibling : null;
    } else this.endAt = at.next;
    return CLAIMED;
  }
}
Object.assign(Binding.prototype, { text: null, said: undefined, nodes: NO_NODES, endAt: null, first: undefined, lateRegistry: undefined, host: undefined, apply: bindingApply, transparent: true });
/** A list with nothing to call and nothing nested in it: shown as it is. */
function plainList(v: any[]) {
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (typeof x === "function" || Array.isArray(x)) return false;
  }
  return true;
}
function bindingCompute(this: Binding) {
  const raw = this.source();
  if (Array.isArray(raw) && plainList(raw)) return this.show(raw);
  // Accessors in what it made: read by an effect of their own, so a change there is shown again, not made again.
  if (!hasAccessor(raw)) return this.show(resolveDeep(raw));
  createRenderEffect<any>(() => this.show(resolveDeep(raw)), (v) => bindingApply.call(this, v), bindingOptions((this as any).name ?? null));
  return NESTED;
}
function bindingApply(this: Binding, v: any) {
  if (v === CLAIMED || v === NESTED) return;
  const parent = this.place;
  const end = this.endAt;
  let text = this.text;
  if (text === IN_PLACE) text = this.text = parent.firstChild as Text;
  // Text as text: its one node written in place, or made.
  if ((typeof v === "string" && v !== "") || typeof v === "number") {
    const t = String(v);
    // (Checked against what it wrote last: reading the node's text copies it; adopted text is read once.)
    if (text) {
      if (this.said !== t && (this.said !== undefined || text.data !== t)) text.data = t;
      return void (this.said = t);
    }
    const current = this.nodes;
    if (current.length === 1 && current[0]!.nodeType === 3) return void (((this.text = current[0] as Text), (this.nodes = NO_NODES)), bindingApply.call(this, t));
    // Into an empty element, at its end: its text set, the node the browser makes kept (as Solid does).
    if (!current.length && end === null && !this.host && !parent.firstChild && parent.nodeType === 1) {
      (parent as Element).textContent = t;
      return void ((this.text = IN_PLACE), (this.said = t));
    }
    if (!current.length) {
      const n = (this.text = document.createTextNode(t));
      this.said = t;
      if (this.host) tagHost(n, this.host);
      parent.insertBefore(n, end);
      return;
    }
  }
  const current = text ? [text as Node] : this.nodes;
  if (text) (this.text = null), (this.said = undefined);
  // (What it makes, a description drawn late, belongs where the binding was made.)
  const next = runWithOwner(this.parent, () => untrack(() => nodesOf(v, [], current)));
  if (this.host) for (const n of next) tagHost(n, this.host);
  reconcile(parent, current, next, end);
  this.nodes = next;
}

const NESTED = Symbol("nested");
/** Whether a value has an accessor in it (in a list, at any depth). */
const hasAccessor = (v: any): boolean => typeof v === "function" || (Array.isArray(v) && v.some(hasAccessor));

const BINDING = { transparent: true } as any;

/** A binding's options: transparent, named `tag.prop` as Solid's compiled bindings are (owner paths say where). */
const bindingNamed = (el: Node, prop: string) => {
  // (Its name is for diagnostics: none in production.)
  if (process.env.NODE_ENV !== "production") {
    const tag = (el as Element).localName ?? "#fragment";
    let byProp = bindingNames.get(tag);
    if (!byProp) bindingNames.set(tag, (byProp = new Map()));
    let o = byProp.get(prop);
    if (!o) byProp.set(prop, (o = { ...BINDING, name: `${tag}.${prop}` }));
    return o;
  }
  return BINDING;
};
/** A binding's options for a name (none: a plain binding), one object per name. */
const bindingOptions = (name: string | null) => {
  if (!name) return BINDING;
  let o = bindingsByName.get(name);
  if (!o) bindingsByName.set(name, (o = { ...BINDING, name }));
  return o;
};
const bindingsByName = new Map<string, any>();
/** Binding options by tag and prop (read only, so shared). */
const bindingNames = new Map<string, Map<string, any>>();

const lowercaseReported = new Set<string>();
function lowercaseEventAttribute(name: string, el: Element) {
  if (lowercaseReported.has(name)) return;
  lowercaseReported.add(name);
  const event = name.slice(name.charAt(2) === ":" ? 3 : 2);
  const handler = "on" + event.charAt(0).toUpperCase() + event.slice(1);
  if (process.env.NODE_ENV !== "production") diagnose({
    code: "LOWERCASE_EVENT_ATTRIBUTE",
    kind: "render",
    severity: "warn",
    message:
      `[LOWERCASE_EVENT_ATTRIBUTE] \`${name}\` received a function, but \`${name}\` is an attribute ` +
      `in Solid 2.0, not an event handler: the function was set as the attribute's text. ` +
      `Use \`${handler}\` for event handlers.`,
    data: { name, handler, tag: el.localName },
  });
}
const CLAIMED = Symbol("claimed");

/** A value with its accessors called, all the way down (arrays flattened). */
function resolveDeep(v: any): any {
  while (typeof v === "function") v = v();
  if (!Array.isArray(v)) return v;
  const out: any[] = [];
  for (const x of v) {
    const r = resolveDeep(x);
    Array.isArray(r) ? out.push(...r) : out.push(r);
  }
  return out;
}

/** `parent`'s nodes `a` turned into `b` with the fewest moves, in place (Solid's reconcileArrays). */
export const reconcileArrays = (parent: Node, a: Node[], b: Node[]) => reconcile(parent, a, b, a.length ? a[a.length - 1]!.nextSibling : null);

function reconcile(parent: Node, old: Node[], next: Node[], end: Node | null) {
  // The old nodes are all the parent holds and none stays: emptied at once (as Solid clears), the new ones put in.
  if (end === null && old.length > 1 && parent.firstChild === old[0] && parent.lastChild === old[old.length - 1] && parent.childNodes.length === old.length && !next.some((n) => n.parentNode === parent)) {
    (parent as Element).textContent = "";
    for (const n of next) parent.appendChild(n);
    return;
  }
  // Nothing there before: put in, nothing to compare.
  if (!old.length) {
    for (const n of next) parent.insertBefore(n, end);
    return;
  }
  // The same at both ends: only what lies between is compared, put before what follows it.
  let from = 0;
  let oldEnd = old.length;
  let nextEnd = next.length;
  while (from < oldEnd && from < nextEnd && old[from] === next[from]) from++;
  while (oldEnd > from && nextEnd > from && old[oldEnd - 1] === next[nextEnd - 1]) oldEnd--, nextEnd--;
  const after = nextEnd < next.length ? next[nextEnd]! : end;
  if (from === oldEnd) {
    for (let j = from; j < nextEnd; j++) parent.insertBefore(next[j]!, after);
    return;
  }
  if (from === nextEnd) {
    for (let i = from; i < oldEnd; i++) if (old[i]!.parentNode === parent) parent.removeChild(old[i]!);
    return;
  }
  // Two swapped, the rest in place: the two moved.
  if (oldEnd === nextEnd && old[from] === next[nextEnd - 1] && old[oldEnd - 1] === next[from]) {
    let i = from + 1;
    while (i < oldEnd - 1 && old[i] === next[i]) i++;
    if (i === oldEnd - 1) {
      parent.insertBefore(next[from]!, old[from]!);
      parent.insertBefore(old[from]!, after);
      return;
    }
  }
  const keep = new Set<Node>();
  for (let j = from; j < nextEnd; j++) keep.add(next[j]!);
  for (let i = from; i < oldEnd; i++) if (!keep.has(old[i]!) && old[i]!.parentNode === parent) parent.removeChild(old[i]!);
  const at = new Map<Node, number>();
  for (let i = from; i < oldEnd; i++) at.set(old[i]!, i);
  const middle = next.slice(from, nextEnd);
  const stay = inOrder(middle, (n) => at.get(n));
  let cursor: Node | null = after;
  for (let j = middle.length - 1; j >= 0; j--) {
    const n = middle[j]!;
    if (!stay.has(j) || n.parentNode !== parent) parent.insertBefore(n, cursor);
    cursor = n;
  }
}

// ---------------------------------------------------------------- render

/** `code()` put in `element`, kept current; answers a function that takes it away. */
export function render(code: () => any, element: Element | ShadowRoot | Document, _init?: unknown, options?: { onError?: (error: unknown, context: unknown) => void }) {
  if (!element) throw new Error("The `element` passed to `render(..., element)` doesn't exist. Make sure `element` exists in the document.");
  // A fresh mount is a new app: in development, scheduling revives after an earlier halt (playgrounds, hot reload).
  if (process.env.NODE_ENV !== "production") resetErrorHalt();
  roots.add(element);
  for (const t of delegated) listen(element, t);
  let disposer: (() => void) | undefined;
  try {
    createRoot((dispose) => {
      disposer = dispose;
      // (What a boundary under it catches is told here first, over the page's own hook.)
      if (options?.onError) (getOwner() as any)[ROOT_ERROR_HOOK] = options.onError;
      // Held as a whole while what it shows first waits on a first load (no half-made page): a boundary with no fallback.
      insert(element, createLoadingBoundary(code, () => undefined, { mountRoot: true } as any));
    });
    // Rendered by the time render returns.
    flush();
  } catch (e) {
    // (Failed to start: nothing of it stays — its scope disposed, the element no longer a root.)
    disposer?.();
    roots.delete(element);
    throw e;
  }
  return () => {
    disposer!();
    roots.delete(element);
    (element as Element).textContent = "";
  };
}

/** The element if render() or hydrate() made it a root its delegated events are handled at. */
export const getDelegatedRoot = (element: Node) => (roots.has(element as any) ? element : undefined);

/** A node rendered elsewhere (document.body unless `mount` is given); its events still reach this root. */
export const Portal = /* @__PURE__ */ builtin(function Portal(props: { mount?: Node; children?: any }) {
  // An owner of its own: the id the server's Portal took (it draws nothing there; its children are the browser's).
  return runWithOwner(createOwner(), () => portal(props));
});

function portal(props: { mount?: Node; children?: any }) {
  const tree = document.createTextNode("");
  const start = document.createTextNode("");
  const end = document.createTextNode("");
  const mount = () => props.mount || document.body;
  // Its content, the browser's own (the server drew nothing for it), after a start marker.
  const content = createMemo(() => [start, clientOnlyRun(() => props.children)]);
  createRenderEffect(
    () => [mount(), content(), getOwner()] as const,
    ([, c, o]) => {
      const m = untrack(mount);
      m.appendChild(end);
      const dispose = runWithOwner(o, () =>
        createRoot((d) => {
          insertHosted(m, c, end, undefined, () => tree.parentNode);
          return d;
        }),
      );
      return () => {
        dispose();
        for (let n: Node | null = start; n; ) {
          const next: Node | null = n.nextSibling;
          if (n.parentNode === m) m.removeChild(n);
          if (n === end) break;
          n = next;
        }
      };
    },
    // (After what it sits in is mounted: where it sits is known.)
    { schedule: true } as any,
  );
  // A mount outside the root the portal sits in listens for that root (one inside it needs nothing: events reach it).
  createEffect(mount, () => {
    const m = untrack(mount);
    let root: Node | null = tree.parentNode;
    while (root && !roots.has(root)) root = root.parentNode;
    if (!root || root.contains(m) || containers.has(m) || roots.has(m)) return;
    containers.set(m, root);
    for (const t of delegated) listen(m, t);
    return () => void containers.delete(m);
  });
  return tree;
}

/** `fn` run as when not hydrating: what it makes is new, nothing of the server's claimed. */
function clientOnlyRun<T>(fn: () => T): T {
  const was = hydrating;
  const window = sc.windowOpen;
  hydrating = null;
  // (A claim window open around it is not this: made, not described.)
  sc.windowOpen = false;
  try {
    return hydrationPaused(fn);
  } finally {
    hydrating = was;
    sc.windowOpen = window;
  }
}

/** The component (or tag name) `component` names, given the other props. */
export const Dynamic = /* @__PURE__ */ builtin(function Dynamic<P>(props: P & { component: any }) {
  const Comp = dynamic<P>(() => props.component);
  return createComponent(Comp, omit(props as any, "component") as any);
});

// Server rendering, asked for in the browser (shared code imports it): said, and nothing done.
const serverOnly = (name: string) => console.error(new Error(name + " is not supported in the browser, returning undefined"));
export function renderToString(_code: () => any, _options?: unknown): string {
  return serverOnly("renderToString") as never;
}
export function renderToStream(_code: () => any, _options?: unknown): any {
  return serverOnly("renderToStream") as never;
}
// The server's request and response layer, as Solid's browser build answers it: nothing in scope, nothing written,
// and what only a server can do said.
const nothing = (): undefined => undefined;
export const getRequestEvent = nothing;
export const getTraceContext = nothing;
export const getHydrationWriter = nothing;
export function httpStatus(_code: number, _text?: string) {}
export function httpHeader(_name: string, _value: string, _options?: { append?: boolean }) {}
export function configureServerErrors(_config: unknown) {}
export function reportRequestFailure(_error: unknown, _event?: unknown) {}
export const createSSRResponse = (..._a: unknown[]) => serverOnly("createSSRResponse");
export const commitEventResponse = (..._a: unknown[]) => serverOnly("commitEventResponse");
export const composeMiddleware = (..._a: unknown[]) => serverOnly("composeMiddleware");
export const createResponseStub = (..._a: unknown[]) => serverOnly("createResponseStub");
export const createRequestEvent = (..._a: unknown[]) => serverOnly("createRequestEvent");
export const getExpectedRedirectStatus = (..._a: unknown[]) => serverOnly("getExpectedRedirectStatus");
export { getServerFunctionMetadata, getServerFunctionRPC, isServerFunction } from "./server-functions/registry.ts";

// Server rendering's helpers, which compiled server code calls: nothing in the browser (as Solid's browser build).
export function ssr(_template: unknown, ..._nodes: unknown[]) {}
export function ssrElement(_name: string, _props: unknown, _children?: unknown, _needsId?: boolean, _skip?: unknown, _attrs?: string) {}
export function ssrElementAttribute(_key: string, _value: unknown) {}
export function ssrClassName(_value: unknown) {}
export function ssrStyle(_value: unknown) {}
export function ssrStyleProperty(_name: string, _value: unknown) {}
export function ssrStyleProperties(..._entries: unknown[]) {}
export function ssrAttribute(_key: string, _value: unknown) {}
export function ssrGroup(_fn: unknown, _n?: number) {}
export function ssrHydrationKey() {}
export function resolveSSRNode(_node: unknown, _result?: unknown, _top?: boolean, _nested?: boolean) {}
export function escape(_s: unknown, _attr?: boolean) {}

/**
 * A value the server sent for hydration, taken once: resolved, rejected or still pending (a streamed promise),
 * or nothing when the page has none under that key.
 */
export function takeHydrationValue(key: string) {
  const registry = (globalThis as any)._$HY?.r;
  if (!registry || !(key in registry)) return;
  const v = registry[key];
  delete registry[key];
  if (v !== null && typeof v === "object" && typeof v.then === "function") {
    if (v.s === 1) return { status: "resolved", value: v.v };
    if (v.s === 2) return v.then(undefined, nothing), { status: "rejected", error: v.v };
    return { status: "pending", promise: v };
  }
  return { status: "resolved", value: v };
}

const assetGates = new WeakMap<PromiseLike<unknown>, () => unknown>();
/** A wait on an asset (a stylesheet, a font): one memo per promise, read so what reads it waits until it lands. */
export function waitAsset(promise: PromiseLike<unknown>) {
  let gate = assetGates.get(promise);
  if (!gate) {
    runWithOwner(null, () => void (gate = createMemo(() => promise, { transparent: true } as any)));
    assetGates.set(promise, gate!);
  }
  gate!();
}

/** The hydration script is the server's to write: nothing in the browser. */
export const HydrationScript = (_props?: unknown) => null;
export const generateHydrationScript = (_options?: unknown) => "";

/** A component whose identity (a component, or a tag name) follows `source`. */
type DynamicOptions = { static?: boolean; deferStream?: boolean };
// (Hydrating: a description, so the server's element is claimed rather than one made beside it.)
const tagArm = (tag: string, props: any) => {
  const raw = componentRaw(props);
  // (Its children as described, claimed one by one; not one dynamic value over the lot.)
  if (describing() && "children" in props) raw.children = untrack(() => props.children);
  return jsx(tag, raw);
};

export function dynamic<P>(source: () => any, options?: DynamicOptions): (props: P) => any {
  return __twist_mark(dynamicOf<P>(source, options, tagArm));
}

/** `dynamic` for a source that only answers with components, never a tag name. */
export function dynamicComponent<P>(source: () => any, options?: DynamicOptions): (props: P) => any {
  return __twist_mark(dynamicOf<P>(source, options));
}

// A server component's answer: one component per function, the call's address beside it.
const COMPONENT_BINDING = Symbol.for("solid.component-binding");
const FLIGHT = Symbol("solid.dynamic-flight");
const bindingOf = (v: any): { component: Function; address: string } | undefined =>
  (v !== null && (typeof v === "function" || typeof v === "object") && v[COMPONENT_BINDING]) || undefined;

function dynamicOf<P>(source: () => any, options?: DynamicOptions, tag?: typeof tagArm): (props: P) => any {
  if (options?.static) return staticDynamic(untrack(source), tag);
  // (A bound answer for the component already shown: the same instance, at the answer's address, not a remount.)
  const sameComponent = (prev: any, next: any) => prev === next || (!!bindingOf(prev) && bindingOf(prev)!.component === bindingOf(next)?.component);
  const cached = createMemo<any>(
    () => {
      const next = source();
      return next && typeof next.then === "function" ? { [FLIGHT]: next } : next;
    },
    { lazy: true } as any,
  );
  return (props: P) => {
    if (sharedConfig.hydrating) {
      try {
        untrack(cached);
      } catch {}
    }
    const value = createMemo<any>(() => {
      const c = cached();
      return c && c[FLIGHT] ? c[FLIGHT] : c;
    });
    // The address derives from the answer: a switch's new address lands in the switch's transaction, and the content
    // it waits for holds that transaction (the source stays pending until the new address's first content applies).
    // (Transparent: no ids of their own, so the server's memos and the client's keep the same ids.)
    const shown = createMemo<any>(() => value(), { equals: sameComponent, transparent: true } as any);
    const address = createMemo(() => bindingOf(value())?.address as string, { transparent: true } as any);
    return createMemo(() => {
      const c = shown();
      if (typeof c === "function") {
        // (In development, what it resolved to is marked as a component, as Solid's dynamic marks it.)
        if (process.env.NODE_ENV !== "production") (c as any)[$DEVCOMP] = true;
        const binding = bindingOf(c);
        if (binding) return untrack(() => (binding.component as any)(props, address));
        return callInline(c, props);
      }
      if (typeof c === "string") return tag ? untrack(() => tag(c, props)) : undefined;
      return undefined;
    });
  };
}

function staticDynamic(c: any, tag?: typeof tagArm): (props: any) => any {
  if (c && typeof c.then === "function") throw new Error("dynamic(): a static source must resolve synchronously (to a component or a tag), not to a promise.");
  if (typeof c === "function") {
    if (process.env.NODE_ENV !== "production") (c as any)[$DEVCOMP] = true;
    const binding = bindingOf(c);
    if (binding) return (props) => untrack(() => (binding.component as any)(props, () => binding.address));
    return (props) => callInline(c, props);
  }
  if (typeof c === "string" && tag) return (props) => tag(c, props);
  return () => undefined;
}
function componentRaw(props: Record<string, any>) {
  const raw: Record<string, any> = {};
  for (const k of Object.keys(props)) {
    const d = Object.getOwnPropertyDescriptor(props, k)!;
    raw[k] = d.get ? __twist_d(d.get) : d.value;
  }
  return raw;
}

// ---------------------------------------------------------------- hydration

const EL = Symbol("twist.hydrate.element");
const COMP = Symbol("twist.hydrate.component");
// (A Switch reading its Matches while hydrating: their descriptions made into what they describe.)
setDescribedNode((v) => (v && v[COMP] ? callComponent(v.fn, componentProps(v.props)) : v));
const OWN = Symbol("twist.hydrate.own");

/** How a React component the server drew is hydrated where it is (installed by the bridge). */
let foreignClaim: ((type: any, props: Record<string, any>, el: Element) => void) | null = null;
export const setForeignClaim = (fn: typeof foreignClaim) => void (foreignClaim = fn);

/** Hydrating: the server's keyed elements by key (also `sharedConfig.registry`, which a claim window swaps). */
let hydrating: { registry: Map<string, Element> } | null = null;
const sc = sharedConfig as any;
/** Whether JSX is described, to be claimed: hydrating, or in a claim window over server nodes. */
const describing = () => hydrating !== null || (sc.windowOpen === true && sc.isClaiming());

/** The keyed elements under `element` into the registry: those under `root`'s prefix, or all outside frame regions. */
function gatherHydratable(element: Element | Document, root?: string) {
  const found = element.querySelectorAll(root ? `[_hk^="${root.replace(/["\\]/g, "\\$&")}"]` : "*[_hk]");
  const frames = root ? null : element.querySelectorAll("[data-fid]");
  const registry: Map<string, Element> = sc.registry;
  for (const el of found) {
    if (frames?.length && [...frames].some((fr) => fr !== el && fr.contains(el))) continue;
    const key = el.getAttribute("_hk")!;
    if (!registry.has(key)) registry.set(key, el);
  }
}

/** Where claiming goes on in a parent: the next node not yet claimed. */
type Cursor = { parent: Node; next: Node | null };

/** The page the server rendered into `element`, adopted: `code()` claims its nodes and binds to them. */
/** The client modules parts of the page rendered with (by hydration key), imported into `_$HY.modules`. */
function loadModuleAssets(mapping: Record<string, string>): Promise<void> | undefined {
  const hy = (globalThis as any)._$HY;
  if (!hy) return;
  hy.modules ??= {};
  hy.loading ??= {};
  const pending: Promise<void>[] = [];
  for (const key in mapping) {
    if (hy.modules[key]) continue;
    hy.loading[key] ??= import(/* @vite-ignore */ new URL(mapping[key]!, document.baseURI).href).then(
      (mod) => void (hy.modules[key] = mod),
      (e) => {
        delete hy.loading[key];
        throw e;
      },
    );
    pending.push(hy.loading[key]);
  }
  return pending.length ? Promise.all(pending).then(() => {}) : undefined;
}
/** A module a part of the page needed did not load: said, and the part goes on without it. */
const reportAssetFailure = (e: unknown) => console.error("Hydration module preload failed:", e);

export function hydrate(code: () => any, element: Element | Document, options: { renderId?: string } = {}) {
  // (The head's prelude the server put first — charset, base — is no node of the shell's: moved past what it claims.)
  const head = ((element as Document).nodeType === 9 ? (element as Document) : element.ownerDocument)?.head;
  if (head && element.contains(head))
    for (let n = head.firstChild; n && n.nodeType === 1 && (n as Element).hasAttribute("data-dh") && !(n as Element).hasAttribute("data-dhf"); ) {
      const next = n.nextSibling;
      head.appendChild(n);
      n = next;
    }
  roots.add(element);
  for (const t of delegated) listen(element, t);
  enableHydration();
  claims ??= { html: claimHtml, list: claimList, children: claimChildren };
  const hy = ((globalThis as any)._$HY ??= { r: {}, fe() {} });
  // (What the bootstrap queued before now, and the elements claimed so far: queued events run as theirs are.)
  (sc as any).events = hy.events;
  (sc as any).completed = hy.completed;
  sc.load = (id: string) => hy.r[id];
  sc.has = (id: string) => id in hy.r;
  sc.cleanupFragment = cleanupFragment;
  const registry = (sc.registry = new Map<string, Element>());
  sc.gather = (root?: string) => gatherHydratable(element, root);
  sc.boundaryScopes ??= new Map();
  sc.captureBoundaryScope = (id: string) => sc.registry && sc.boundaryScopes.set(id, { registry: sc.registry, gather: sc.gather });
  gatherHydratable(element, options.renderId || undefined);
  let disposer: (() => void) | undefined;
  const claimRoot = () => {
    const was = hydrating;
    hydrating = { registry };
    sc.registry = registry;
    sharedConfig.hydrating = true;
    try {
      createRoot(
        (dispose) => {
          disposer = dispose;
          claimHtml(code(), false, { parent: element, next: element.firstChild });
        },
        { id: options.renderId ?? "" },
      );
      flush();
    } finally {
      hydrating = was;
      sharedConfig.hydrating = !!was;
    }
    runHydrationEvents();
  };
  // The root's own client modules (a lazy page at the top): hydrated once they have loaded.
  const rootMapping = hy.r?.[(options.renderId ?? "") + "_assets"] ?? hy.r?.["_assets"];
  const rootAssets = rootMapping && typeof rootMapping === "object" ? loadModuleAssets(rootMapping) : undefined;
  if (rootAssets) {
    sharedConfig.hydrating = true;
    rootAssets.then(claimRoot, (e) => {
      sharedConfig.hydrating = false;
      sc.registry = undefined;
      // A document shell cannot be made again on the client: hydration given up, said plainly.
      if ((element as Document).nodeType === 9) {
        console.error("Hydration module preload failed for a document root; a document shell cannot be client-rendered, so hydration was abandoned and the page is not interactive.");
        ((globalThis as any).reportError || console.error)(e);
        return;
      }
      console.error("Hydration module preload failed, falling back to client render:", e);
      (element as Element).textContent = "";
      disposer = render(code, element as Element);
    });
  } else claimRoot();
  return () => {
    disposer?.();
    roots.delete(element);
    (element as Element).textContent = "";
  };
}

/** A value where the server rendered it (a hole, or the top of the page): mirrors the server's html(). */
function claimHtml(v: any, inTemplate: boolean, at: Cursor): Node[] {
  if (v == null || typeof v === "boolean") return [];
  if (Array.isArray(v)) return claimList(v, !!(v as any)[OWN], inTemplate, false, at);
  if (typeof v === "function") return bindAt(v, at, inTemplate);
  if (v[COMP]) {
    // A React component the server drew in <sluurp-react>: hydrated there as a React root (the bridge's).
    if (foreignClaim && !isTwist(v.fn)) {
      const el = nextNode(at) as Element | null;
      if (el && el.nodeType === 1 && el.localName === "sluurp-react") {
        at.next = el.nextSibling;
        foreignClaim(v.fn, componentProps(v.props), el);
        return [el];
      }
    }
    if (v.fn === Loading) return claimLoading(componentProps(v.props), at, v);
    if (v.fn === Errored) return claimErrored(componentProps(v.props), at);
    return renderComponent(v.fn, componentProps(v.props), (out) => claimHtml(out, false, at));
  }
  if (v[EL]) return [claimDescribed(v, v.keyed ?? !inTemplate, at)];
  // A node made here (a Portal's marker: the server drew nothing for it): put where it belongs.
  if ((v as Node).nodeType) {
    if (!(v as Node).parentNode) at.parent.insertBefore(v as Node, at.next);
    // (One already in the page where the walk is, adopted: the walk goes past it.)
    else if (nextNode(at) === v) at.next = (v as Node).nextSibling;
    return [v as Node];
  }
  return claimText(v, at);
}

/**
 * A Loading boundary whose content the server drew in place: a live boundary (its fallback can show later, `on`
 * re-arms it), its content's first pass claiming the server's nodes, later ones drawing anew. The boundary's content
 * takes the id the server's boundary took.
 */
function claimLiveBoundary(props: { fallback?: any; children?: any; on?: unknown }, at: Cursor): Node[] {
  let claimed: Node[] | null = null;
  const read = createLoadingBoundary(
    () => {
      if (claimed === null) return (claimed = claimHtml(props.children, false, at));
      return props.children;
    },
    () => props.fallback,
    "on" in props ? { on: () => props.on } : undefined,
  );
  const nodes = untrack(() => nodesOf(read(), [], []));
  // Kept current from here (the nodes are where they belong: the binding starts from them, not moving them).
  bind(at.parent, read, at.next, undefined, undefined, nodes);
  return nodes;
}

/** A boundary the server rendered as its fallback for good ("$$f"): the fallback claimed, then the content made here. */
function claimFallbackThenRender(props: { fallback?: any; children?: any; on?: unknown }, at: Cursor, parent: Owner, id: string): Node[] {
  const claimed = runWithOwner(ownerUnder(parent, { id }), () => claimHtml(props.fallback, false, at));
  let shown = false;
  const read = createLoadingBoundary(
    () => {
      // (Made, not claimed: nothing of it is in the page.)
      const was = hydrating;
      const wasShared = sharedConfig.hydrating;
      hydrating = null;
      sharedConfig.hydrating = false;
      try {
        return untrack(() => props.children);
      } finally {
        hydrating = was;
        sharedConfig.hydrating = wasShared;
      }
    },
    () => (shown ? props.fallback : ((shown = true), claimed)),
    "on" in props ? { on: () => props.on } : undefined,
  );
  const nodes = untrack(() => nodesOf(read(), [], []));
  bind(at.parent, read, at.next);
  return nodes;
}

/**
 * A Loading boundary the server rendered: its owner takes the id the server's did. Content rendered in place is claimed
 * under it; content the server streamed later shows its fallback (claimed) until the fragment record settles, the
 * reveal script having swapped the content in, which is claimed then.
 */
function claimLoading(props: { fallback?: any; children?: any; on?: unknown }, at: Cursor, described?: any): Node[] {
  const parent = getOwner();
  // The id the server's boundary took, looked at (not taken) to tell the two shapes apart.
  let id: string | undefined;
  try {
    id = parent ? peekNextChildId(parent) : undefined;
  } catch {
    id = undefined;
  }
  // The client modules its content rendered with, still loading: nothing claimed now — the boundary claims its server
  // nodes where they are once they land (hydration waits for it).
  const mapping = id != null ? (globalThis as any)._$HY?.r?.[id + "_assets"] : undefined;
  const assets = described && mapping && typeof mapping === "object" ? loadModuleAssets(mapping) : undefined;
  if (assets) {
    const release = runWithOwner(parent, () => initBoundaryResume(parent!, id!));
    // (Transparent: it takes no id — the boundary claims under the one the server gave it.)
    const landed = createMemo(
      () =>
        assets.then(
          () => true,
          (e) => (reportAssetFailure(e), true),
        ),
      { transparent: true } as any,
    );
    return bindAt(() => {
      landed();
      queueMicrotask(() => release() && checkHydrationComplete());
      return described;
    }, at);
  }
  // Its fallback final on the server: claimed, the content rendered fresh after it.
  if (id != null && (globalThis as any)._$HY?.r?.[id] === "$$f") return claimFallbackThenRender(props, at, parent!, id);
  const pl = at.next as Element | null;
  if (id == null || !pl || pl.nodeName !== "TEMPLATE" || pl.id !== "pl-" + id) return claimLiveBoundary(props, at);
  const boundary = ownerUnder(parent) as any;
  // (Its content's ids as the server's: under <id>00, <id>01 after `on`.)
  boundary.id = id + ("on" in props ? "01" : "00");
  // The fallback, between the placeholder template and its end comment.
  const end = (() => {
    for (let n = pl.nextSibling; n; n = n.nextSibling) if (n.nodeType === 8 && (n as Comment).data === "pl-" + id) return n;
    return null;
  })();
  at.next = pl.nextSibling;
  const fallback = runWithOwner(ownerUnder(parent, { id }), () => claimHtml(props.fallback, false, at));
  at.next = end ? end.nextSibling : at.next;
  // What comes before the boundary stays put: the content, once revealed, starts right after it.
  const ahead = pl.previousSibling;
  const host = at.parent;
  // Its parent knows only the fallback: what is revealed or made later in its place goes with the boundary.
  const past = at.next;
  runWithOwner(boundary, () =>
    onCleanup(() => {
      if (past && past.parentNode !== host) return;
      for (let n = ahead ? (ahead.parentNode === host ? ahead.nextSibling : null) : host.firstChild; n && n !== past; ) {
        const next = n.nextSibling;
        host.removeChild(n);
        n = next;
      }
    }),
  );
  const record = (globalThis as any)._$HY?.r?.[id + "_fr"];
  const release = record ? runWithOwner(boundary, () => initBoundaryResume(boundary, id!)) : () => false;
  const reveal = () => {
    if (!release() || boundary.disposed) return void checkHydrationComplete();
    const was = hydrating;
    const prevRegistry = sc.registry;
    const registry = new Map<string, Element>();
    for (const el of (host as Element).querySelectorAll?.("[_hk]") ?? []) registry.set(el.getAttribute("_hk")!, el);
    hydrating = { registry };
    sc.registry = registry;
    sharedConfig.hydrating = true;
    try {
      runWithOwner(boundary, () => claimHtml(props.children, false, { parent: host, next: ahead ? ahead.nextSibling : host.firstChild }));
      flush();
    } finally {
      hydrating = was;
      sc.registry = prevRegistry;
      sharedConfig.hydrating = !!was;
    }
    runHydrationEvents();
  };
  // Its content handed to the client (the record false, or failed): made here in the fallback's place, a live boundary.
  const fresh = () => {
    if (!release() || boundary.disposed) return void checkHydrationComplete();
    const after = end ? end.nextSibling : null;
    pl.remove();
    end?.remove();
    let shown = false;
    runWithOwner(boundary, () => {
      const read = createLoadingBoundary(
        () => made(() => untrack(() => props.children)),
        () => (shown ? props.fallback : ((shown = true), fallback)),
        "on" in props ? { on: () => props.on } : undefined,
      );
      bind(host, read, after, undefined, undefined, fallback);
    });
    flush();
    checkHydrationComplete();
  };
  // (Its content streamed but not swapped in yet — a stylesheet holds the swap: claimed once it is.)
  const afterSwap = () => {
    const tpl = document.getElementById(id!);
    const fr = (globalThis as any)._$HY?.fr;
    if (!tpl || tpl.nodeName !== "TEMPLATE" || !fr) return reveal();
    const off = fr.subscribe((fid: string) => fid === id && (off(), reveal()));
  };
  const settled = (v: unknown) => queueMicrotask(v === false ? fresh : afterSwap);
  // (Raced against the stream ending before it: a cut-off fragment renders fresh.)
  if (record && typeof record.then === "function" && record.s !== 1 && record.s !== 2) Promise.race([record, fragmentAbort(id)]).then(settled, () => queueMicrotask(fresh));
  else if (record) record.s === 2 ? queueMicrotask(fresh) : settled(record.v);
  return fallback;
}

/**
 * An Errored boundary the server rendered: its owner takes the server's id. Its content is claimed; if that throws (as
 * it did on the server, which then rendered the fallback), the fallback is claimed from the same place instead.
 */
function claimErrored(props: { fallback?: any; children?: any }, at: Cursor): Node[] {
  // As the server made it: the boundary (its content under an owner of its own), then the output owner of its fallback.
  const boundary = createOwner() as any;
  const output = createOwner() as any;
  const content = ownerUnder(boundary) as any;
  const start = at.next;
  const fallback = (e: unknown) => {
    at.next = start;
    const f = props.fallback;
    return runWithOwner(output, () => claimHtml(erroredFallback(f, () => e, () => {}), false, at));
  };
  // The server caught an error here: it sent it under the boundary's id, and rendered the fallback.
  const sent = (globalThis as any)._$HY?.r;
  if (sent && boundary.id != null && boundary.id in sent) {
    const v = sent[boundary.id];
    return fallback(v && typeof v === "object" && "s" in v && "v" in v ? v.v : v);
  }
  // (An error something under it reports while it is claimed comes back here.)
  content.catch = (e: unknown) => {
    throw e;
  };
  let nodes: Node[];
  const before = start ? start.previousSibling : at.parent.lastChild;
  try {
    nodes = runWithOwner(content, () => claimHtml(props.children, false, at));
  } catch (e) {
    if (e instanceof NotReadyError) throw e;
    // (What the failed attempt made goes with it: its owners, and the nodes it put in before the server's.)
    resetOwner(content);
    for (let n = before ? before.nextSibling : at.parent.firstChild; n && n !== start; ) {
      const next = n.nextSibling;
      n.parentNode!.removeChild(n);
      n = next;
    }
    return fallback(e);
  } finally {
    content.catch = undefined;
  }
  // Claimed: from here an error under it shows the fallback, made here; the content stays alive behind it, and a reset
  // runs again what threw (the content made anew only when what threw is not known).
  const [error, setError] = createSignal<unknown>(NO_ERROR, { equals: false });
  let shown: unknown = NO_ERROR;
  let fresh = false;
  const failedBelow = new Set<Computation<any>>();
  let unknownThrower = false;
  let kept: Node[] | null = null;
  const caught = (e: unknown, from?: Computation<any>) => {
    if (from) failedBelow.add(from);
    else unknownThrower = true;
    if (shown !== e) (shown = e), setError(() => e);
    return true;
  };
  content.catch = caught;
  const reset = () => {
    fresh = true;
    shown = NO_ERROR;
    setError(NO_ERROR);
  };
  // (Its range: bindings inside it change their own nodes, so what it held is what lies between these two.)
  const after = at.next;
  const parent = at.parent;
  const read = runWithOwner(output, () =>
    createMemo(() => {
      const e = error();
      if (e === NO_ERROR && !fresh) return nodes;
      // (What it shows now taken out: the content's nodes kept, to show again after a reset.)
      const out: Node[] = [];
      for (let n = before ? before.nextSibling : parent.firstChild; n && n !== after; ) {
        const next = n.nextSibling;
        out.push(n);
        (n as ChildNode).remove();
        n = next;
      }
      kept ??= out;
      if (e === NO_ERROR) {
        fresh = false;
        const again = unknownThrower || !failedBelow.size ? null : [...failedBelow];
        failedBelow.clear();
        unknownThrower = false;
        const back = kept;
        kept = null;
        if (again) {
          for (const c of again) untrack(() => runAgain(c));
          return back;
        }
        resetOwner(content);
        return made(() => runWithOwner(content, () => untrack(() => props.children)));
      }
      const f = props.fallback;
      return made(() => untrack(() => erroredFallback(f, () => e, reset)));
    }),
  );
  bind(at.parent, read, at.next);
  return nodes;
}
const NO_ERROR = Symbol("twist.no-error");

/** `fn` run as a fresh render, not a claim (nothing of what it makes is in the page). */
function made<T>(fn: () => T): T {
  const was = hydrating;
  const wasShared = sharedConfig.hydrating;
  hydrating = null;
  sharedConfig.hydrating = false;
  try {
    return fn();
  } finally {
    hydrating = was;
    sharedConfig.hydrating = wasShared;
  }
}

const noopFn = () => {};

/** An element's children: mirrors the server's children(). */
function claimChildren(c: any, at: Cursor) {
  if (Array.isArray(c)) claimList(c, !!(c as any)[OWN], true, false, at);
  else if (typeof c === "function") bindAt(c, at, true);
  else if (c && c[EL]) claimDescribed(c, c.keyed ?? false, at);
  else claimHtml(c, false, at);
}

/** A list's items in place: a part that can change bound where it sits, the rest claimed. */
function claimList(items: any[], own: boolean, inTemplate: boolean, viaFn: boolean, at: Cursor): Node[] {
  const out: Node[] = [];
  for (const x of items) {
    if (x == null || typeof x === "boolean") continue;
    if (typeof x === "function") {
      if (viaFn) out.push(...claimList([resolveDeep(x)].flat(), own, inTemplate, true, at));
      else out.push(...bindAt(x, at, inTemplate));
    } else if (Array.isArray(x)) out.push(...claimList(x, !!(x as any)[OWN], inTemplate && own, viaFn, at));
    else if (x[EL]) out.push(...claimedBy(x, [claimDescribed(x, x.keyed ?? !(inTemplate && own && !viaFn), at)]));
    else if (x[COMP]) out.push(...claimedBy(x, marked(at, () => claimHtml(x, false, at))));
    else if ((x as Node).nodeType) {
      // (One already in the page where the walk is, adopted: the walk goes past it.)
      if (nextNode(at) === x) at.next = (x as Node).nextSibling;
      out.push(x as Node);
    }
    else out.push(...claimText(x, at));
  }
  return out;
}

/** A part that can change, bound to the nodes the server rendered for it. */
function bindAt(fn: () => any, at: Cursor, inTemplate = false): Node[] {
  const before = at.next;
  const b = bind(at.parent, fn, null, at, undefined, undefined, undefined, inTemplate);
  // (Its first value pending: it claims later, where it sits now, not where the walk will have gone by then — with
  // the keys the server rendered, as the walk had them.)
  if (b.first === at) (b.first = { parent: at.parent, next: before }), (b.lateRegistry = hydrating?.registry), pendingClaims++;
  const out: Node[] = [];
  for (let n = before; n && n !== at.next; n = n.nextSibling) if (!isSeparator(n)) out.push(n);
  return out;
}

const isSeparator = (n: Node | null) => !!n && n.nodeType === 8 && (n as Comment).data === "!$";
const isComment = (n: Node | null, data: string) => !!n && n.nodeType === 8 && (n as Comment).data === data;

/** What the server put between <!--$--> and <!--/--> claimed: the markers passed over, anything left between gone. */
function marked(at: Cursor, claim: () => Node[]): Node[] {
  if (!isComment(at.next, "$")) return claim();
  at.next = at.next!.nextSibling;
  const pending = pendingClaims;
  const out = claim();
  // (A part in it still pending claims what is left when its value comes: kept for it.)
  const keep = pendingClaims !== pending;
  let n = at.next;
  while (n && !isComment(n, "/")) {
    const x = n.nextSibling;
    if (!keep && !out.includes(n)) n.parentNode!.removeChild(n);
    n = x;
  }
  at.next = n ? n.nextSibling : null;
  return out;
}

/** The next node, separators the server put between two texts passed over. */
function nextNode(at: Cursor): Node | null {
  while (isSeparator(at.next)) at.next = at.next!.nextSibling;
  return at.next;
}

function claimText(v: any, at: Cursor): Node[] {
  const text = String(v);
  if (text === "") return [];
  const n = nextNode(at);
  if (n && n.nodeType === 3) {
    at.next = n.nextSibling;
    if ((n as Text).data !== text) (n as Text).data = text;
    return [n];
  }
  // Not what the server rendered: made here.
  const t = document.createTextNode(text);
  at.parent.insertBefore(t, n);
  return [t];
}

function claimDescribed(d: { tag: string; props: Record<string, any>; owner?: any }, keyed: boolean, at: Cursor): Element {
  // (Claimed, all of it, under the owner it takes its key under: as Solid's template makes its parts where it is made.)
  const under = d.owner ? keyOwnerOf(d.owner) : null;
  if (under && under !== getOwner()) return runWithOwner(under, () => claimDescribed(d, keyed, at));
  const owner = getOwner() as any;
  const key = keyed && owner?.id != null ? getNextChildId(owner) : undefined;
  const registry: Map<string, Element> | undefined = sc.registry ?? hydrating?.registry;
  const hit = key != null ? registry?.get(key) : undefined;
  let el = hit || (nextNode(at) as Element | null);
  if (process.env.NODE_ENV !== "production") {
    if (hit) hit.localName !== d.tag && console.warn(`Hydration tag mismatch for key "${key}": expected <${d.tag}> but found`, hit);
    else if (!keyed && (!el || el.nodeType !== 1 || el.localName !== d.tag)) warnStructure(d.tag, el, at);
  }
  if (key != null) registry?.delete(key);
  // (Its own key claimed too: taken by position, or by a key that missed.)
  if (el?.nodeType === 1 && (el as Element).hasAttribute("_hk")) registry?.delete((el as Element).getAttribute("_hk")!);
  if (!el || el.nodeType !== 1) {
    // Not what the server rendered: made here.
    el = element(d.tag, {});
    at.parent.insertBefore(el, at.next);
  } else {
    if (el === at.next) at.next = el.nextSibling;
    // (The server's element, claimed: events queued on it before hydration may run now.)
    (sc as any).completed?.add(el);
  }
  const props = d.props;
  if (hasSpread(props)) return spreadOn(el, mergedProps(props), false, true), el;
  for (const k of Object.keys(props)) if (k !== "children") set(el, k, props[k]);
  if ("children" in props) claimChildren(props.children, { parent: el, next: el.firstChild });
  return el;
}

/** A template's element not where the server's page has it: said where, with the parent's elements drawn. */
function warnStructure(tag: string, found: Node | null, at: Cursor) {
  const parent = at.parent as Element;
  let prev = found ? found.previousSibling : parent.lastChild;
  while (prev && prev.nodeType !== 1) prev = prev.previousSibling;
  const missing = !found || found.nodeType !== 1;
  const viz = "\n  " + describeSiblings(parent, found, tag, missing);
  if (prev) console.warn("Hydration structure mismatch: expected <" + tag + "> after", prev, "in", parent, viz);
  else console.warn("Hydration structure mismatch: expected <" + tag + "> as first child of", parent, viz);
}
function describeSiblings(parent: Element, mismatch: Node | null, tag: string, missing: boolean): string {
  const children = [...parent.children];
  const p = parent.localName || "#fragment";
  if (missing) return `<${p}>${children.map((c) => `<${c.localName}>`).join("")}<${tag} \u2190 missing></${p}>`;
  const i = children.indexOf(mismatch as Element);
  let start = 0;
  let end = children.length;
  if (children.length > 6) (start = Math.max(0, i - 2)), (end = Math.min(children.length, i + 3));
  const tags = children
    .slice(start, end)
    .map((c) => (c === mismatch ? `<${c.localName} \u2190 expected ${tag}>` : `<${c.localName}>`))
    .join("");
  return `<${p}>${start > 0 ? "..." : ""}${tags}${end < children.length ? "..." : ""}</${p}>`;
}

/** A derived value, as compiled code makes one (Solid's `memo`). */
export const memo = <T>(fn: () => T): (() => T) => createMemo(() => fn());

/** A render effect, as compiled code makes one (its options' name is for development tools). */
export function effect<T>(compute: (prev?: T) => T, apply: (v: T, prev?: T) => void, options?: { name?: string }) {
  // (The compiled name, Solid's sourceNames.bindings, on its node.)
  createRenderEffect(compute, apply, options?.name ? { ...BINDING, name: options.name } : BINDING);
}

/**
 * A value read whole: a store object copied into a plain one (its keys and values tracked, so an in-place change
 * applies again), an array re-mapped when an item is a store; anything else as is.
 */
export function readShallow<T>(v: T): T {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(readShallow) as T;
  if (!(v as any)[$TARGET]) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = (v as any)[k];
  return out as T;
}

// ---------------------------------------------------------------- head

export { useHead } from "./head.ts";
export { acquireAsset } from "./assets.ts";

// ---------------------------------------------------------------- client-only components

type ClientOnlyOptions = { lazy?: boolean; export?: string };

/**
 * A component that only ever renders in the browser: its fallback until its module has loaded (on the server, and
 * while hydrating, the fallback alone), then the component, without the fallback prop.
 */
export function clientOnly<P extends object>(load: () => Promise<any>, options: ClientOnlyOptions = {}) {
  const [loaded, setLoaded] = createSignal<((props: any) => any) | null>(null);
  let loading: Promise<unknown> | null = null;
  const start = () => (loading ??= load().then((m) => setLoaded(() => m[options.export ?? "default"])));
  if (!options.lazy) start();
  return __twist_mark((props: P & { fallback?: any }) => {
    start();
    const rest = omit(props, "fallback" as any);
    // (Hydrating: the fallback, as the server rendered it, until hydration is over.)
    const hydrated = sharedConfig.hydrating ? hydrationFlag() : null;
    return createMemo(() => {
      const C = loaded();
      // (The server rendered none of it: made, never claimed.)
      return C && (!hydrated || hydrated()) ? clientOnlyRun(() => callComponent(C, rest)) : props.fallback;
      // (No id of its own: the server, rendering only the fallback, made no owner here.)
    }, { transparent: true });
  });
}

export { NotReadyError };
export { assignProp as setProp };
export { merge as mergeProps };
