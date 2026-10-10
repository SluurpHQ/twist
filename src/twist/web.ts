// Twist's web runtime (`@solidjs/web`): what JSX marked by Twist's pass (compile.ts) and transformed by Bun's JSX
// calls. Elements are made at once; each marked part is bound to its node by an effect of its own; components run
// once. Written from Solid 2's design (RFCs 03 and 07) and its tests, not its code.
import {
  flush,
  createLoadingBoundary,
  createMemo,
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
} from "./signals.ts";
import { merge, omit, isStatic } from "./flow.ts";
import { $TARGET } from "./store.ts";
export { isStatic };
import { __twist_c, __twist_d, __twist_ref, componentProps, createComponent, callComponent, isChildren, isDynamic, spreadSource, Loading, Errored, isTwist, __twist_mark } from "./control.ts";

export * from "./control.ts";
import { inOrder } from "../shared/in-order.ts";

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

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const SVG_TAGS = new Set(
  "svg,g,path,circle,ellipse,line,polygon,polyline,rect,text,tspan,textPath,defs,use,symbol,marker,mask,pattern,clipPath,linearGradient,radialGradient,stop,filter,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feFlood,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,feSpecularLighting,feTile,feTurbulence,foreignObject,image,switch,desc,metadata,title,animate,animateMotion,animateTransform,set,view".split(","),
);
const MATH_TAGS = new Set("math,mi,mn,mo,ms,mtext,mrow,msup,msub,mfrac,msqrt,mroot,mtable,mtr,mtd,mspace,munder,mover,munderover,semantics,annotation".split(","));
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
  const el = SVG_TAGS.has(tag) && tag !== "title" ? document.createElementNS(SVG_NS, tag) : MATH_TAGS.has(tag) ? document.createElementNS(MATH_NS, tag) : document.createElement(tag);
  // With a spread: every prop as one merged source (later ones winning, a key the spread drops falling back).
  if (hasSpread(props)) return spreadOn(el, mergedProps(props), false, false), el;
  for (const k of Object.keys(props)) if (k !== "children") set(el, k, props[k]);
  if ("children" in props) insert(el, props.children);
  return el;
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
  if (name === "ref") return applyRef(value, el);
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
        assign(el, name, v, prev);
      },
      BINDING,
    );
    return;
  }
  // Hydrating: a static value is in the page already.
  if (hydrating) return;
  assign(el, name, value, undefined);
}

/** One attribute, class, style or property written. */
export function assign(el: Element, name: string, value: any, prev: any) {
  if (name === "class") return className(el, value, prev);
  if (name === "style") return style(el as HTMLElement, value, prev);
  if (name === "innerHTML" || name === "textContent" || name === "innerText") return void ((el as any)[name] = value ?? "");
  if (PROPS[name]?.has(el.nodeName)) return setProperty(el, name, value);
  setAttribute(el, name, value);
}

export function setAttribute(el: Element, name: string, value: any) {
  if (value == null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? "" : String(value));
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
export function spread(el: Element, props: any, skipChildren?: boolean) {
  // (An accessor is read where each key is read.)
  spreadOn(el, typeof props === "function" ? spreadSource(props) : props, !!skipChildren, false);
}

/** A spread applied: `claiming` the server's element, its first value is what the page shows already. */
function spreadOn(el: Element, props: any, skipChildren: boolean, claiming: boolean) {
  if (!props) return;
  // A spread's handlers: listeners of their own, swapped as the spread changes.
  const isEvent = (k: string) => /^on[A-Z]/.test(k);
  const listeners = new Map<string, EventListener>();
  const listenOn = (k: string, h: any) => {
    if (h == null) return;
    const l = listenerFor(h);
    listeners.set(k, l);
    el.addEventListener(k.slice(2).toLowerCase(), l);
  };
  const unlisten = (k: string) => {
    const l = listeners.get(k);
    if (l) el.removeEventListener(k.slice(2).toLowerCase(), l), listeners.delete(k);
  };
  let prev: Record<string, any> = {};
  createRenderEffect(
    () => {
      const next: Record<string, any> = {};
      for (const k of Object.keys(props)) if (k !== "children" && k !== "ref") next[k] = k === "style" || k === "class" ? readShallow(props[k]) : props[k];
      return next;
    },
    (next: Record<string, any>) => {
      // Claiming the server's element: what it shows already is the first value (nothing written).
      if (claiming) {
        claiming = false;
        if ("class" in next) (el as any).$$cls = classes(next.class);
        // (Handlers are not in the page: attached.)
        for (const k of Object.keys(next)) if (isEvent(k)) listenOn(k, next[k]);
        prev = next;
        return;
      }
      for (const k of Object.keys(prev)) if (!(k in next)) isEvent(k) ? unlisten(k) : assign(el, k, undefined, prev[k]);
      for (const k of Object.keys(next)) if (next[k] !== prev[k]) isEvent(k) ? (unlisten(k), listenOn(k, next[k])) : assign(el, k, next[k], prev[k]);
      prev = next;
    },
  );
  // (Read untracked: a change to the spread is its effect's, never the enclosing computation's.)
  const ref = untrack(() => props.ref);
  if (ref) applyRef(ref, el);
  if (skipChildren || !untrack(() => "children" in props)) return;
  if (claiming) claimChildren(props.children, { parent: el, next: el.firstChild });
  else insert(el, () => props.children);
}

// ---------------------------------------------------------------- events, delegated per render root

const delegated = new Set<string>();
const roots = new Set<Node>();
const listening = new WeakMap<Node, Set<string>>();

/** `onX` handlers: kept on the element, run by the root's listener as the event bubbles. */
export function addEvent(el: Element, type: string, handler: any, delegate = true) {
  // Not delegated: a listener of its own on the element (a handler given as [fn, data] is called with data first).
  if (!delegate) return void el.addEventListener(type, listenerFor(handler));
  (el as any)["$$" + type] = handler;
  if (!delegated.has(type)) {
    delegated.add(type);
    for (const r of roots) listen(r, type);
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
  root.addEventListener(type, (e) => dispatch(e, root));
}

function dispatch(e: Event, root: Node) {
  const key = "$$" + e.type;
  let node = e.target as any;
  const target = node;
  Object.defineProperty(e, "currentTarget", { configurable: true, get: () => node ?? root });
  while (node && node !== root) {
    let handler = node[key];
    if (handler && !node.disabled) {
      if (isDynamic(handler)) handler = handler();
      if (Array.isArray(handler)) handler[0].call(node, handler[1], e);
      else if (typeof handler === "function") handler.call(node, e);
      else handler?.handleEvent?.(e);
      if (e.cancelBubble) break;
    }
    node = node._$host ?? node.parentNode;
  }
  void target;
}

// ---------------------------------------------------------------- inserting

/** What a value puts in the page: nodes, text (as text nodes), nothing; accessors read. */
function nodesOf(value: any, out: Node[], reuse: Node[]): Node[] {
  if (value == null || value === true || value === false || value === "") return out;
  if (typeof value === "function") return nodesOf(value(), out, reuse);
  if (Array.isArray(value)) {
    for (const v of value) nodesOf(v, out, reuse);
    return out;
  }
  if ((value as Node).nodeType) return out.push(value), out;
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
export function insert(parent: Node, value: any, marker: Node | null = null) {
  // Children given as a list: static ones put in place; a part that can change, bound where it sits (before an empty
  // anchor of its own when more follows it).
  if (Array.isArray(value) && value.some((v) => typeof v === "function")) {
    const last = value.length - 1;
    value.forEach((v, i) => {
      if (typeof v !== "function" || i === last) return insert(parent, v, marker);
      const anchor = document.createTextNode("");
      parent.insertBefore(anchor, marker);
      bind(parent, v, anchor);
    });
    return;
  }
  if (typeof value !== "function") {
    for (const n of nodesOf(value, [], [])) parent.insertBefore(n, marker);
    return;
  }
  bind(parent, value, marker);
}

/** A part that can change, rendered before `end` (at the end of `parent` when null) and kept current. */
function bind(parent: Node, value: () => any, end: Node | null, claimed?: Cursor) {
  let current: Node[] = [];
  let first: Cursor | undefined = claimed;
  createRenderEffect(
    // Every accessor in it read here, tracked (a list of rows that are accessors, say); nodes made in the apply.
    () => {
      const v = resolveDeep(value());
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
    },
    (v: any) => {
      if (v === CLAIMED) return;
      const next = untrack(() => nodesOf(v, [], current));
      reconcile(parent, current, next, end);
      current = next;
    },
    BINDING,
  );
}

const BINDING = { transparent: true } as any;
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
    insert(element, createLoadingBoundary(code, () => undefined));
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
  const mount = props.mount ?? document.body;
  const marker = document.createTextNode("");
  const box = document.createDocumentFragment();
  createRoot((dispose) => {
    insert(box, () => props.children);
    const nodes = [...box.childNodes];
    for (const n of nodes) ((n as any)._$host = marker), mount.appendChild(n);
    onCleanup(() => {
      dispose();
      for (const n of nodes) n.parentNode === mount && mount.removeChild(n);
    });
  });
  roots.add(mount);
  for (const t of delegated) listen(mount, t);
  return marker;
});

/** A component whose identity (a component, or a tag name) follows `source`. */
export function dynamic<P>(source: () => any, options?: { static?: boolean }): (props: P) => any {
  return __twist_mark(dynamicOf<P>(source, options));
}

function dynamicOf<P>(source: () => any, options?: { static?: boolean }): (props: P) => any {
  // Static: the source read once (it cannot change).
  const which = options?.static ? (() => { const v = untrack(source); return () => v; })() : createMemo(source);
  return (props: P) =>
    createMemo(() => {
      const c = which();
      if (!c) return undefined;
      return untrack(() => (typeof c === "string" ? element(c, componentRaw(props as any)) : callComponent(c, props)));
    });
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

/** Hydrating: the server's keyed elements by key. */
let hydrating: { registry: Map<string, Element> } | null = null;

/** Where claiming goes on in a parent: the next node not yet claimed. */
type Cursor = { parent: Node; next: Node | null };

/** The page the server rendered into `element`, adopted: `code()` claims its nodes and binds to them. */
export function hydrate(code: () => any, element: Element | Document, options: { renderId?: string } = {}) {
  roots.add(element);
  for (const t of delegated) listen(element, t);
  const registry = new Map<string, Element>();
  for (const el of (element as Element).querySelectorAll("[_hk]")) registry.set(el.getAttribute("_hk")!, el);
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
    if (v.fn === Loading) return claimLoading(componentProps(v.props), at);
    if (v.fn === Errored) return claimErrored(componentProps(v.props), at);
    return claimHtml(createComponent(v.fn, componentProps(v.props)), false, at);
  }
  if (v[EL]) return [claimElement(v, v.keyed ?? !inTemplate, at)];
  return claimText(v, at);
}

/**
 * A Loading boundary the server rendered: its owner takes the id the server's did. Content rendered in place is claimed
 * under it; content the server streamed later shows its fallback (claimed) until the fragment record settles, the
 * reveal script having swapped the content in, which is claimed then.
 */
function claimLoading(props: { fallback?: any; children?: any }, at: Cursor): Node[] {
  const parent = getOwner();
  const boundary = createOwner(parent) as any;
  const id = boundary.id as string | undefined;
  const pl = at.next as Element | null;
  if (id == null || !pl || pl.nodeName !== "TEMPLATE" || pl.id !== "pl-" + id) return runWithOwner(boundary, () => claimHtml(props.children, false, at));
  // The fallback, between the placeholder template and its end comment.
  const end = (() => {
    for (let n = pl.nextSibling; n; n = n.nextSibling) if (n.nodeType === 8 && (n as Comment).data === "pl-" + id) return n;
    return null;
  })();
  at.next = pl.nextSibling;
  const fallback = runWithOwner(parent, () => claimHtml(props.fallback, false, at));
  at.next = end ? end.nextSibling : at.next;
  // What comes before the boundary stays put: the content, once revealed, starts right after it.
  const ahead = pl.previousSibling;
  const host = at.parent;
  const record = (globalThis as any)._$HY?.r?.[id + "_fr"];
  const reveal = () => {
    const was = hydrating;
    const registry = new Map<string, Element>();
    for (const el of (host as Element).querySelectorAll?.("[_hk]") ?? []) registry.set(el.getAttribute("_hk")!, el);
    hydrating = { registry };
    sharedConfig.hydrating = true;
    try {
      runWithOwner(boundary, () => claimHtml(props.children, false, { parent: host, next: ahead ? ahead.nextSibling : host.firstChild }));
      flush();
    } finally {
      hydrating = was;
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
  const boundary = createOwner(getOwner()) as any;
  const content = createOwner(boundary) as any;
  const start = at.next;
  const fallback = (e: unknown) => {
    at.next = start;
    const f = props.fallback;
    return runWithOwner(createOwner(boundary), () => claimHtml(typeof f === "function" ? f(() => e, () => {}) : f, false, at));
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
  else if (c && c[EL]) claimElement(c, c.keyed ?? false, at);
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
    else if (x[EL]) out.push(claimElement(x, x.keyed ?? !(inTemplate && own && !viaFn), at));
    else if (x[COMP]) out.push(...marked(at, () => claimHtml(x, false, at)));
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

function claimElement(d: { tag: string; props: Record<string, any> }, keyed: boolean, at: Cursor): Element {
  const owner = getOwner() as any;
  const key = keyed && owner?.id != null ? getNextChildId(owner) : undefined;
  let el = (key != null && hydrating!.registry.get(key)) || (nextNode(at) as Element | null);
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
  createRenderEffect(compute, apply, BINDING);
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
        // The warmed link becomes the stylesheet.
        const warm = d.tag === "link" && d.attrs.rel === "stylesheet" ? sheets.get(String(d.attrs.href))?.link : undefined;
        const el = warm ?? document.createElement(d.tag);
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
export { assign as setProp };
export { merge as mergeProps };
