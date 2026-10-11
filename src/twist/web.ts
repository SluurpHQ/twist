import { diagnose } from "./diagnostics.ts";
// Twist's web runtime (`@solidjs/web`): what JSX marked by Twist's pass (compile.ts) and transformed by Bun's JSX
// calls. Elements are made at once; each marked part is bound to its node by an effect of its own; components run
// once. Written from Solid 2's design (RFCs 03 and 07) and its tests, not its code.
import {
  flush,
  createLoadingBoundary,
  createMemo,
  createEffect,
  createRenderEffect,
  createRoot,
  flatten,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  NotReadyError,
  getNextChildId,
  sharedConfig,
  createSignal,
  createOwner,
  ownerUnder,
  peekNextChildId,
} from "./signals.ts";
import { checkHydrationComplete, enableHydration, initBoundaryResume } from "./hydration.ts";
import { merge, omit, isStatic } from "./flow.ts";
import { $TARGET } from "./store.ts";
export { isStatic };
import { __twist_c, __twist_d, __twist_ref, componentProps, createComponent, callComponent, callInline, renderComponent, isChildren, isDynamic, spreadSource, Loading, Errored, isTwist, __twist_mark, markBuiltin } from "./control.ts";

export * from "./control.ts";
export * from "./response.ts";
import { inOrder } from "../shared/in-order.ts";
import { MATH_NS, MATH_TAGS, SVG_NS, SVG_TAGS, Place, expand, hasHoles, places, type Spec } from "./tags.ts";

export { createRoot, untrack, getOwner, flatten, merge, omit };
export const isServer = false;

// ---------------------------------------------------------------- jsx

export const Fragment = (props: { children?: unknown }) => props.children;

/** What `<type {...props}>` makes: an element, or what a component returns. */
export function jsx(type: any, props: Record<string, any>) {
  // Hydrating: descriptions, claimed from the server's page top-down (in the order the server rendered them).
  if (hydrating) return type === Fragment ? props.children : typeof type === "function" ? { [COMP]: true, fn: type, props } : { [EL]: true, tag: type, props };
  if (typeof type === "function") {
    if (type === Fragment) return childrenOf(props);
    // (A component of React's is mounted as a React subtree, when the bridge is there.)
    return callComponent(type, componentProps(props));
  }
  return element(type, props);
}

/** Several children written in the JSX (while hydrating, the template's own list: no separators between them). */
export function jsxs(type: any, props: Record<string, any>) {
  if (hydrating && Array.isArray(props.children)) (props.children as any)[OWN] = true;
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
  hasHoles(spec);
  return (values: unknown[]) => {
    if (hydrating) return expand(spec, values, { i: 0 }, jsx, jsxs);
    const el = (made ??= build(spec)).cloneNode(true) as Element;
    fill(el, spec, values, { i: 0 });
    return el;
  };
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
/** A copy's values in place: attributes set, then each child value before its marker (the walk first, as values move nodes). */
function fill(el: Element, spec: Spec, values: unknown[], at: { i: number }) {
  for (const name of spec[2]) set(el, name, values[at.i++]);
  const kids = spec[3];
  const where = places(spec);
  const puts: [unknown, Node | null][] = [];
  let node = el.firstChild;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]!;
    if (k === 0) {
      const p = where[i];
      puts.push([values[at.i++], p === Place.Comment ? node : p === Place.Before ? node : null]);
      if (p === Place.Comment) node = node!.nextSibling;
      continue;
    }
    if (typeof k !== "string" && hasHoles(k)) fill(node as Element, k, values, at);
    node = node!.nextSibling;
  }
  for (const [v, marker] of puts) insertHosted(el, v, marker);
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
function set(el: Element, name: string, value: any) {
  // (A ref given through a getter: its value, read once, applied.)
  if (name === "ref") return applyRef(isDynamic(value) ? untrack(value) : value, el);
  if (/^on[A-Z]/.test(name)) {
    const type = name.slice(2).toLowerCase();
    return addEvent(el, type, value, BUBBLING.has(type));
  }
  if (isDynamic(value)) {
    // (A binding takes no id: the server makes none for it.) Hydrating, its first value is what the page shows already:
    // nothing written (what the user typed, styles the page has, stay).
    let adopt = !!hydrating;
    createRenderEffect(
      // (A style or class object is read whole: one changed in place applies again.)
      name === "style" || name === "class" ? () => readShallow(value()) : value,
      (v: any, prev: any) => {
        if (adopt) {
          adopt = false;
          if (name === "class") (el as any).$$cls = classes(v);
          return;
        }
        assignProp(el, name, v, prev);
      },
      bindingNamed(el, name),
    );
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
  if (name === "ref") return !skipRef && value && applyRef(value, el), value;
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
    if (delegate && !value) (el as any)[EVENT_KEY + type] = (el as any)[EVENT_KEY + type + "Data"] = undefined;
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
  if (typeof value === "function" && name.startsWith("on")) lowercaseEventAttribute(name, el);
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
export function runHydrationEvents() {}

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
  const now = classes(value);
  // What it applied last (an object changed in place is not what it was): the diff is against that.
  const before: Set<string> = (el as any).$$cls ?? classes(prev);
  (el as any).$$cls = now;
  if (typeof value === "string" || value == null || value === false) {
    if (value == null || value === false || value === "") return el.removeAttribute("class");
    return el.setAttribute("class", value);
  }
  for (const c of before) if (!now.has(c)) el.classList.remove(c);
  for (const c of now) if (!before.has(c)) el.classList.add(c);
  if (!el.classList.length) el.removeAttribute("class");
}

function classes(v: any, out = new Set<string>()): Set<string> {
  if (!v) return out;
  if (typeof v === "string") for (const c of v.split(/\s+/)) c && out.add(c);
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
  if (typeof prev !== "object" || prev == null) (el.style.cssText = ""), (prev = {});
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
  if (claimingChildren) return void claimChildren(untrack(() => props.children), { parent: el, next: el.firstChild });
  // Plain data children: put in once, no effect for them.
  const plain = !Array.isArray(props) && typeof props !== "function" ? untrack(() => Object.getOwnPropertyDescriptor(props, "children")) : undefined;
  if (plain && !plain.get) return void insertHosted(el, plain.value, null, undefined, undefined, name && `${name}.children`);
  // (An object without them: nothing to insert. A source that is called is read only by the effect.)
  if (!plain && !Array.isArray(props) && typeof props !== "function" && !untrack(() => "children" in props)) return;
  insertHosted(el, () => {
    const sources = sourcesOf(props);
    for (let i = sources.length - 1; i >= 0; i--) if ("children" in sources[i]) return sources[i].children;
  }, null, undefined, undefined, name && `${name}.children`);
}

// ---------------------------------------------------------------- events, delegated per render root

const delegated = new Set<string>();
const roots = new Set<Node>();
const listening = new WeakMap<Node, Set<string>>();

/** `onX` handlers: kept on the element, run by the root's listener as the event bubbles. */
export function addEvent(el: Element, type: string, handler: any, delegate = true) {
  // Not delegated: a listener of its own on the element (a handler given as [fn, data] is called with data first).
  if (!delegate) return void el.addEventListener(type, listenerFor(handler));
  // (Where Solid keeps it: `_$$type`, a [fn, data] handler's data beside it.)
  const key = EVENT_KEY + type;
  if (Array.isArray(handler)) ((el as any)[key] = handler[0]), ((el as any)[key + "Data"] = handler[1]);
  else (el as any)[key] = handler;
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
  return Array.isArray(handler) ? (e) => handler[0].call(e.currentTarget, handler[1], e) : typeof handler === "function" ? handler : (e) => handler?.handleEvent?.(e);
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
  root.addEventListener(type, (e) => dispatch(e, containers.get(root) ?? root));
}

/** Portal mounts outside every render root → the root their portal sits in. */
const containers = new Map<Node, Node>();
/** The next node an event bubbles to: up the DOM, except from a portal's content: on from where the portal sits. */
const bubbleFrom = (node: any): Node | null => node._$host ?? node.parentNode;

const EVENT_KEY = "_$$";

function dispatch(e: Event, root: Node) {
  const key = EVENT_KEY + e.type;
  let node = e.target as any;
  const target = node;
  Object.defineProperty(e, "currentTarget", { configurable: true, get: () => node ?? root });
  // (Roots inside one another, or a portal's mount and its root, may both see the event: each handler runs once.)
  const ran: Set<Node> = ((e as any).$$ran ??= new Set());
  while (node && node !== root) {
    let handler = ran.has(node) ? null : node[key];
    if (handler) ran.add(node);
    if (handler && !node.disabled) {
      if (isDynamic(handler)) handler = handler();
      const data = node[key + "Data"];
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
const claimedNodes = new WeakMap<object, Node[]>();
const claimedBy = (d: object, nodes: Node[]) => (claimedNodes.set(d, nodes), nodes);

function nodesOf(value: any, out: Node[], reuse: Node[]): Node[] {
  if (value == null || value === true || value === false || value === "") return out;
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
    for (const v of value) nodesOf(v, out, reuse);
    return out;
  }
  if ((value as Node).nodeType) return out.push(value), out;
  // Neither text, a node, a list nor something to call: skipped, and said (as Solid's insert).
  if (typeof value === "object" || typeof value === "symbol") {
    diagnose({
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
export function insert(parent: Node, value: any, marker: Node | null = null, initial?: Node[], options?: { name?: string }) {
  // In a claim window over server nodes: claimed where they are.
  if (initial?.length && sharedConfig.hydrating && (!sc.isClaiming || sc.isClaiming())) {
    const was = hydrating;
    hydrating ??= { registry: sc.registry ?? new Map() };
    try {
      // What the server had there and the value did not claim: gone, as an insert over `initial` replaces it.
      const claimed = claimHtml(value, false, { parent, next: initial[0]! });
      for (const n of initial) if (!claimed.includes(n) && n.parentNode === parent) parent.removeChild(n);
      return;
    } finally {
      hydrating = was;
    }
  }
  insertHosted(parent, value, marker, initial, undefined, options?.name ?? null);
}

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
function insertHosted(parent: Node, value: any, marker: Node | null, initial?: Node[], host?: () => Node | null, name?: string | null) {
  // Children given as a list: static ones put in place; a part that can change, bound where it sits (before an empty
  // anchor of its own when more follows it).
  if (Array.isArray(value) && value.some((v) => typeof v === "function")) {
    const last = value.length - 1;
    value.forEach((v, i) => {
      if (typeof v !== "function" || i === last) return insertHosted(parent, v, marker, i === last ? initial : undefined, host, name);
      const anchor = document.createTextNode("");
      if (host) (anchor as any)._$host = host();
      parent.insertBefore(anchor, marker);
      bind(parent, v, anchor, undefined, host, undefined, name);
    });
    return;
  }
  if (typeof value !== "function") {
    const next = nodesOf(value, [], initial ?? []);
    if (host) for (const n of next) (n as any)._$host = host();
    if (initial?.length) reconcile(parent, initial, next, marker);
    else for (const n of next) parent.insertBefore(n, marker);
    return;
  }
  bind(parent, value, marker, undefined, host, initial, name);
}

/** A part that can change, rendered before `end` (at the end of `parent` when null) and kept current. */
function bind(parent: Node, value: () => any, end: Node | null, claimed?: Cursor, host?: () => Node | null, initial?: Node[], name?: string | null) {
  let current: Node[] = initial ?? [];
  // What the apply step makes (a description drawn late) belongs where the binding was made.
  const home = getOwner();
  let first: Cursor | undefined = claimed;
  const named = name === undefined ? bindingNamed(parent, "children") : bindingOptions(name);
  const apply = (v: any) => {
    if (v === CLAIMED || v === NESTED) return;
    // Text as text: its one node written in place, or made.
    if ((typeof v === "string" && v !== "") || typeof v === "number") {
      const t = String(v);
      const only = current.length === 1 && current[0]!.nodeType === 3 ? (current[0] as Text) : null;
      if (only) return void (only.data !== t && (only.data = t));
      if (!current.length) {
        const n = document.createTextNode(t);
        if (host) (n as any)._$host = host();
        parent.insertBefore(n, end);
        return void (current = [n]);
      }
    }
    const next = runWithOwner(home, () => untrack(() => nodesOf(v, [], current)));
    if (host) for (const n of next) (n as any)._$host = host();
    reconcile(parent, current, next, end);
    current = next;
  };
  createRenderEffect<any>(
    () => {
      const raw = value();
      // Accessors in what it made: read by an effect of their own, so a change there is shown again, not made again.
      if (!hasAccessor(raw)) return show(resolveDeep(raw));
      createRenderEffect<any>(() => show(resolveDeep(raw)), apply, named);
      return NESTED;
    },
    apply,
    named,
  );
  /** A value's nodes in place: claimed from the server's the first time when hydrating. */
  function show(v: any) {
    // Hydrating: its first value claims the server's nodes where it sits (under this binding, as the server ran it).
    if (first) {
      const at = first;
      first = undefined;
      // A hole the server marked (<!--$-->…<!--/-->): claimed between its markers, the end one its anchor.
      const open = at.next && at.next.nodeType === 8 && (at.next as Comment).data === "$" ? at.next : null;
      if (open) at.next = open.nextSibling;
      current = untrack(() => claimList(Array.isArray(v) ? v : [v], false, false, true, at));
      if (open) {
        let n = at.next;
        while (n && !(n.nodeType === 8 && (n as Comment).data === "/")) {
          // Not what it renders (the server's page differed): gone.
          const x = n.nextSibling;
          if (!current.includes(n)) n.parentNode!.removeChild(n);
          n = x;
        }
        end = n;
        at.next = n ? n.nextSibling : null;
      } else end = at.next;
      return CLAIMED;
    }
    return v;
  }
}

const NESTED = Symbol("nested");
/** Whether a value has an accessor in it (in a list, at any depth). */
const hasAccessor = (v: any): boolean => typeof v === "function" || (Array.isArray(v) && v.some(hasAccessor));

const BINDING = { transparent: true } as any;

/** A binding's options: transparent, named `tag.prop` as Solid's compiled bindings are (owner paths say where). */
const bindingNamed = (el: Node, prop: string) => {
  const tag = (el as Element).localName ?? "#fragment";
  let byProp = bindingNames.get(tag);
  if (!byProp) bindingNames.set(tag, (byProp = new Map()));
  let o = byProp.get(prop);
  if (!o) byProp.set(prop, (o = { ...BINDING, name: `${tag}.${prop}` }));
  return o;
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
  diagnose({
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

function reconcile(parent: Node, old: Node[], next: Node[], end: Node | null) {
  const keep = new Set(next);
  for (const n of old) if (!keep.has(n) && n.parentNode === parent) parent.removeChild(n);
  if (!old.length) {
    for (const n of next) parent.insertBefore(n, end);
    return;
  }
  const at = new Map<Node, number>();
  old.forEach((n, i) => at.set(n, i));
  const stay = inOrder(next, (n) => at.get(n));
  let cursor: Node | null = end;
  for (let j = next.length - 1; j >= 0; j--) {
    const n = next[j]!;
    if (!stay.has(j) || n.parentNode !== parent) parent.insertBefore(n, cursor);
    cursor = n;
  }
}

// ---------------------------------------------------------------- render

/** `code()` put in `element`, kept current; answers a function that takes it away. */
export function render(code: () => any, element: Element | ShadowRoot | Document, _init?: unknown, _options?: unknown) {
  roots.add(element);
  for (const t of delegated) listen(element, t);
  let disposer!: () => void;
  createRoot((dispose) => {
    disposer = dispose;
    // Held as a whole while what it shows first waits on a first load (no half-made page): a boundary with no fallback.
    insert(element, createLoadingBoundary(code, () => undefined, { mountRoot: true } as any));
  });
  // Rendered by the time render returns.
  flush();
  return () => {
    disposer();
    roots.delete(element);
    (element as Element).textContent = "";
  };
}

/** A node rendered elsewhere (document.body unless `mount` is given); its events still reach this root. */
export const Portal = __twist_mark(function Portal(props: { mount?: Node; children?: any }) {
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
  const shared = sharedConfig.hydrating;
  hydrating = null;
  sharedConfig.hydrating = false;
  try {
    return fn();
  } finally {
    hydrating = was;
    sharedConfig.hydrating = shared;
  }
}

/** The component (or tag name) `component` names, given the other props. */
export function Dynamic<P>(props: P & { component: any }) {
  const Comp = dynamic<P>(() => props.component);
  return createComponent(Comp, omit(props as any, "component") as any);
}
__twist_mark(Dynamic);
markBuiltin(Dynamic, (Portal as any)[Symbol.for("twist.component")]);

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
const tagArm = (tag: string, props: any) => element(tag, componentRaw(props));

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
  // Mounted sites of a bound component: a new address for the same component is delivered to them, not remounted.
  const sites = new Set<(a: string) => void>();
  let deliveredAddress: string | undefined;
  const resolveBinding = (next: any, prev: any) => {
    const binding = bindingOf(next);
    if (!binding) return next;
    deliveredAddress = binding.address;
    const prevBinding = bindingOf(prev);
    if (prevBinding && prevBinding.component === binding.component) {
      for (const deliver of sites) deliver(binding.address);
      return prev;
    }
    return next;
  };
  const sameInstance = (prev: any, next: any) => {
    if (prev === next) return true;
    const held = bindingOf(prev);
    const incoming = bindingOf(next);
    if (!held || !incoming || held.component !== incoming.component) return false;
    if (held.address === incoming.address) return true;
    if (deliveredAddress === undefined) return false;
    if (incoming.address !== deliveredAddress) {
      deliveredAddress = incoming.address;
      for (const deliver of sites) deliver(incoming.address);
    }
    return true;
  };
  const cached = createMemo<any>(
    (prev: any) => {
      const next = source();
      if (!next || typeof next.then !== "function") return resolveBinding(next, prev);
      return { [FLIGHT]: next };
    },
    { lazy: true, equals: sameInstance } as any,
  );
  return (props: P) => {
    if (sharedConfig.hydrating) {
      try {
        untrack(cached);
      } catch {}
    }
    let latest = 0;
    const value = createMemo<any>(
      (prev: any) => {
        const c = cached();
        if (!c || !c[FLIGHT]) return resolveBinding(c, prev);
        const next: PromiseLike<any> = c[FLIGHT];
        const token = ++latest;
        return {
          then: (onFulfilled: any, onRejected: any) =>
            next.then((resolved: any) => {
              const landed = token === latest ? resolveBinding(resolved, prev) : resolved;
              return onFulfilled ? onFulfilled(landed) : landed;
            }, onRejected),
        };
      },
      { equals: sameInstance } as any,
    );
    return createMemo(() => {
      const c = value();
      if (typeof c === "function") {
        const binding = bindingOf(c);
        if (binding) {
          const [address, setAddress] = createSignal((deliveredAddress ??= binding.address), { ownedWrite: true });
          sites.add(setAddress);
          onCleanup(() => sites.delete(setAddress));
          return untrack(() => (binding.component as any)(props, address));
        }
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
const OWN = Symbol("twist.hydrate.own");

/** How a React component the server drew is hydrated where it is (installed by the bridge). */
let foreignClaim: ((type: any, props: Record<string, any>, el: Element) => void) | null = null;
export const setForeignClaim = (fn: typeof foreignClaim) => void (foreignClaim = fn);

/** Hydrating: the server's keyed elements by key (also `sharedConfig.registry`, which a claim window swaps). */
let hydrating: { registry: Map<string, Element> } | null = null;
const sc = sharedConfig as any;

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
export function hydrate(code: () => any, element: Element | Document, options: { renderId?: string } = {}) {
  roots.add(element);
  for (const t of delegated) listen(element, t);
  enableHydration();
  const hy = ((globalThis as any)._$HY ??= { r: {}, fe() {} });
  sc.load = (id: string) => hy.r[id];
  sc.has = (id: string) => id in hy.r;
  sc.cleanupFragment = cleanupFragment;
  const registry = (sc.registry = new Map<string, Element>());
  sc.gather = (root?: string) => gatherHydratable(element, root);
  sc.boundaryScopes ??= new Map();
  sc.captureBoundaryScope = (id: string) => sc.registry && sc.boundaryScopes.set(id, { registry: sc.registry, gather: sc.gather });
  gatherHydratable(element, options.renderId || undefined);
  const was = hydrating;
  hydrating = { registry };
  sharedConfig.hydrating = true;
  let disposer!: () => void;
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
  return () => {
    disposer();
    roots.delete(element);
    (element as Element).textContent = "";
  };
}

/** A value where the server rendered it (a hole, or the top of the page): mirrors the server's html(). */
function claimHtml(v: any, inTemplate: boolean, at: Cursor): Node[] {
  if (v == null || typeof v === "boolean") return [];
  if (Array.isArray(v)) return claimList(v, !!(v as any)[OWN], inTemplate, false, at);
  if (typeof v === "function") return bindAt(v, at);
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
    if (v.fn === Loading) return claimLoading(componentProps(v.props), at);
    if (v.fn === Errored) return claimErrored(componentProps(v.props), at);
    return renderComponent(v.fn, componentProps(v.props), (out) => claimHtml(out, false, at));
  }
  if (v[EL]) return [claimDescribed(v, v.keyed ?? !inTemplate, at)];
  // A node made here (a Portal's marker: the server drew nothing for it): put where it belongs.
  if ((v as Node).nodeType) {
    if (!(v as Node).parentNode) at.parent.insertBefore(v as Node, at.next);
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
  // Kept current from here (the nodes are where they belong: the binding puts them before what follows them).
  bind(at.parent, read, at.next);
  return nodes;
}

/**
 * A Loading boundary the server rendered: its owner takes the id the server's did. Content rendered in place is claimed
 * under it; content the server streamed later shows its fallback (claimed) until the fragment record settles, the
 * reveal script having swapped the content in, which is claimed then.
 */
function claimLoading(props: { fallback?: any; children?: any }, at: Cursor): Node[] {
  const parent = getOwner();
  // The id the server's boundary took, looked at (not taken) to tell the two shapes apart.
  let id: string | undefined;
  try {
    id = parent ? peekNextChildId(parent) : undefined;
  } catch {
    id = undefined;
  }
  const pl = at.next as Element | null;
  if (id == null || !pl || pl.nodeName !== "TEMPLATE" || pl.id !== "pl-" + id) return claimLiveBoundary(props, at);
  const boundary = ownerUnder(parent) as any;
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
  };
  if (record && typeof record.then === "function" && record.s !== 1) record.then(() => queueMicrotask(reveal), noopFn);
  else if (record) queueMicrotask(reveal);
  return fallback;
}

/**
 * An Errored boundary the server rendered: its owner takes the server's id. Its content is claimed; if that throws (as
 * it did on the server, which then rendered the fallback), the fallback is claimed from the same place instead.
 */
function claimErrored(props: { fallback?: any; children?: any }, at: Cursor): Node[] {
  // As the server made it: the boundary, its content under a first owner, its fallback under a second.
  const boundary = createOwner() as any;
  const content = ownerUnder(boundary) as any;
  const start = at.next;
  const fallback = (e: unknown) => {
    at.next = start;
    const f = props.fallback;
    return runWithOwner(ownerUnder(boundary), () => claimHtml(typeof f === "function" ? f(() => e, () => {}) : f, false, at));
  };
  // The server caught an error here: it sent it under the content's id, and rendered the fallback.
  const sent = (globalThis as any)._$HY?.r;
  if (sent && content.id != null && content.id in sent) {
    const v = sent[content.id];
    return fallback(v && typeof v === "object" && "s" in v && "v" in v ? v.v : v);
  }
  // (An error something under it reports while it is claimed comes back here.)
  content.catch = (e: unknown) => {
    throw e;
  };
  try {
    return runWithOwner(content, () => claimHtml(props.children, false, at));
  } catch (e) {
    if (e instanceof NotReadyError) throw e;
    return fallback(e);
  } finally {
    content.catch = undefined;
  }
}

const noopFn = () => {};

/** An element's children: mirrors the server's children(). */
function claimChildren(c: any, at: Cursor) {
  if (Array.isArray(c)) claimList(c, !!(c as any)[OWN], true, false, at);
  else if (typeof c === "function") bindAt(c, at);
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
      else out.push(...bindAt(x, at));
    } else if (Array.isArray(x)) out.push(...claimList(x, !!(x as any)[OWN], inTemplate && own, viaFn, at));
    else if (x[EL]) out.push(...claimedBy(x, [claimDescribed(x, x.keyed ?? !(inTemplate && own && !viaFn), at)]));
    else if (x[COMP]) out.push(...claimedBy(x, marked(at, () => claimHtml(x, false, at))));
    else if ((x as Node).nodeType) out.push(x as Node);
    else out.push(...claimText(x, at));
  }
  return out;
}

/** A part that can change, bound to the nodes the server rendered for it. */
function bindAt(fn: () => any, at: Cursor): Node[] {
  const before = at.next;
  bind(at.parent, fn, null, at);
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
  const out = claim();
  let n = at.next;
  while (n && !isComment(n, "/")) {
    const x = n.nextSibling;
    if (!out.includes(n)) n.parentNode!.removeChild(n);
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

function claimDescribed(d: { tag: string; props: Record<string, any> }, keyed: boolean, at: Cursor): Element {
  const owner = getOwner() as any;
  const key = keyed && owner?.id != null ? getNextChildId(owner) : undefined;
  const registry: Map<string, Element> | undefined = sc.registry ?? hydrating?.registry;
  let el = (key != null && registry?.get(key)) || (nextNode(at) as Element | null);
  if (key != null) registry?.delete(key);
  if (!el || el.nodeType !== 1) {
    // Not what the server rendered: made here.
    el = element(d.tag, {});
    at.parent.insertBefore(el, at.next);
  } else if (el === at.next) at.next = el.nextSibling;
  const props = d.props;
  if (hasSpread(props)) return spreadOn(el, mergedProps(props), false, true), el;
  for (const k of Object.keys(props)) if (k !== "children") set(el, k, props[k]);
  if ("children" in props) claimChildren(props.children, { parent: el, next: el.firstChild });
  return el;
}

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
  if (Array.isArray(v)) return (v.some((x) => x && typeof x === "object" && (x as any)[$TARGET]) ? v.map(readShallow) : v) as T;
  if (!(v as any)[$TARGET]) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = (v as any)[k];
  return out as T;
}

// ---------------------------------------------------------------- head

type HeadDesc = { tag: string; props?: Record<string, any>; key?: any };
const HEAD_TAGS = new Set(["title", "meta", "link", "style", "script", "base"]);

/**
 * Tags for the document's head, kept current: a title sets the document's title, the rest are elements this call owns
 * (gone when it re-runs or its owner ends). Its props are read where it runs, so one not ready holds its Loading.
 */
export function useHead(tags: HeadDesc | HeadDesc[] | (() => HeadDesc | HeadDesc[])) {
  let owned: Element[] = [];
  const read = (v: any) => (typeof v === "function" ? v() : v);
  createRenderEffect(
    () => {
      const list = typeof tags === "function" ? tags() : tags;
      return (Array.isArray(list) ? list : [list])
        .filter((d) => d && HEAD_TAGS.has(d.tag))
        .map((d) => {
          const attrs: Record<string, any> = {};
          for (const k of Object.keys(d.props ?? {})) if (k !== "children" && !/^on[A-Z]/.test(k)) attrs[k] = read(d.props![k]);
          // A stylesheet holds what shows with it until it has loaded (no unstyled flash): preloaded meanwhile.
          if (d.tag === "link" && attrs.rel === "stylesheet" && attrs.href) {
            const gate = sheetGate(String(attrs.href));
            if (!gate.loaded) gate.ready();
          }
          return { tag: d.tag, attrs, text: read(d.props?.children) };
        });
    },
    (descs: { tag: string; attrs: Record<string, any>; text: any }[]) => {
      for (const el of owned) el.remove();
      owned = [];
      for (const d of descs) {
        if (d.tag === "title") {
          document.title = d.text == null ? "" : String(d.text);
          continue;
        }
        // The warmed link becomes the stylesheet; a resource link the server wrote already is taken over.
        const warm = d.tag === "link" && d.attrs.rel === "stylesheet" ? sheets.get(String(d.attrs.href))?.link : undefined;
        const el = warm ?? (d.tag === "link" ? serverLink(d.attrs) : null) ?? document.createElement(d.tag);
        if (warm) el.removeAttribute("as");
        for (const k of Object.keys(d.attrs)) setAttribute(el, k, d.attrs[k]);
        if (d.text != null) el.textContent = String(d.text);
        document.head.appendChild(el);
        owned.push(el);
      }
    },
  );
  onCleanup(() => {
    for (const el of owned) el.remove();
    owned = [];
  });
}

const RESOURCE_RELS = new Set(["preload", "modulepreload", "prefetch", "preconnect", "dns-prefetch", "stylesheet"]);
const QUALIFIERS = ["as", "crossorigin", "type", "media", "imagesrcset", "imagesizes"];
/** A qualifier as resources compare it (Solid's rule): `as` lower case, any CORS spelling but credentials anonymous. */
function qualifier(name: string, v: any): string | null {
  if (v == null || v === false) return null;
  if (name === "imagesrcset" || name === "imagesizes") return typeof v === "string" && v !== "" ? v : null;
  const s = v === true ? "" : String(v);
  if (name === "as") return s.toLowerCase();
  if (name !== "crossorigin") return s;
  return s.toLowerCase() === "use-credentials" ? "use-credentials" : "anonymous";
}
/** The head's resource link these attributes name (its href, or none for a source set, and the same qualifiers). */
function serverLink(attrs: Record<string, any>): Element | null {
  if (!RESOURCE_RELS.has(attrs.rel)) return null;
  const href = attrs.href == null ? null : String(attrs.href);
  for (const el of document.head.querySelectorAll(`link[rel="${attrs.rel}"]`))
    if (el.getAttribute("href") === href && QUALIFIERS.every((q) => qualifier(q, attrs[q]) === qualifier(q, el.getAttribute(q)))) return el;
  return null;
}

/** Stylesheets warming up, by href: a preload link, settled when it loads (or fails: shown anyway). */
const sheets = new Map<string, { link: HTMLLinkElement; loaded: boolean; promise: Promise<void>; ready: () => unknown }>();

function sheetGate(href: string) {
  let g = sheets.get(href);
  if (g) return g;
  const link = document.createElement("link");
  link.setAttribute("rel", "preload");
  link.setAttribute("as", "style");
  link.setAttribute("href", href);
  let done!: () => void;
  const promise = new Promise<void>((ok) => (done = ok));
  // (Read as an async value: a reveal waiting on it holds as for any data, the committed view staying.)
  const ready = createRoot(() => createMemo(() => promise.then(() => true)));
  sheets.set(href, (g = { link, loaded: false, promise, ready }));
  const settle = () => ((g!.loaded = true), done());
  link.addEventListener("load", settle);
  link.addEventListener("error", settle);
  document.head.appendChild(link);
  return g;
}

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
    return createMemo(() => {
      const C = loaded();
      return C ? callComponent(C, rest) : props.fallback;
    });
  });
}

export { NotReadyError };
export { assignProp as setProp };
export { merge as mergeProps };
