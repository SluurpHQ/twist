// The runtime: React's API on Sluurp's signals. Each component renders inside a signals effect, so what it reads
// (its state, a context, any signal) re-renders it alone. A parent re-renders a child only when the child's props
// changed (shallowly); nothing cascades past that. Rendering is synchronous: no time slicing, no lanes.
import { effect, flush as flushSignals, runWithOwner, signal, untrack } from "../../signals/index.js";
import { ACTIVITY, VIEW_TRANSITION, CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, PROFILER, STRICT, SUSPENSE, SUSPENSE_LIST, createElement, invalidType, objectChild, readLazy, readThenable, unwrapChild } from "./element.ts";
import { MATH_NS, SVG_NS, styleText, eventOf, onAfterEvent, onSubmitAction, setDefaults, setProps } from "./props.ts";
import { addContainer, listenOnElement } from "./events.ts";
import { FragmentInstance } from "./fragment-ref.ts";
import { FORM_TAGS, initForm, restoreForm, updateForm } from "./forms.ts";
import { type Ancestors, ancestorsWith, checkNesting, checkTextNesting } from "./nesting.ts";
import { type Preview, tryTransition } from "./dryrun.ts";
import { checkKeys, checkTag, dev, duplicateKey, muteWarnings, setOwner, warn } from "./warnings.ts";
import { assertValidProps, checkTagName } from "./attributes.ts";
import { HOISTABLE, type Resource, acquireResource, claimHoistable, getResource, hoistableRoot, isHoistable, markHoistable, mountHoistable } from "./float-client.ts";

type Sig<T = any> = { (): T; set(v: T): void; peek(): T };

const TEXT = 1, HOST = 2, COMP = 3, FRAG = 4, PROVIDER = 5, PORTAL_F = 6, ROOT = 7;
/** A <title>, <meta> or <link> kept in <head>, or a shared resource (stylesheet, <style>, async script): not in its place. */
const HOIST = 8;

export type Fiber = {
  kind: number;
  type: any;
  key: string;
  props: any;
  parent: Fiber | null;
  children: Fiber[];
  dom: any;
  ns: string | null;
  root: RootState;
  dead?: boolean;
  // Committed once: before that, taken away without lifecycles (a render that was thrown away).
  committed?: boolean;
  // A DOM element (in development): what is open around what goes in it, for HTML's nesting rules.
  nesting?: Ancestors;
  // A component: how it renders, its hooks, the effect it renders in.
  render?: (f: Fiber, props: any) => any;
  hooks?: any[];
  stop?: () => void;
  out?: any;
  inst?: any;
  tick?: Sig<number>;
  pending?: Sig<number>;
  compare?: ((a: any, b: any) => boolean) | null;
  insertion?: (() => void)[];
  layout?: (() => void)[];
  passive?: (() => void)[];
  value?: Sig;
  refCleanup?: (() => void) | null;
};

type RootState = {
  ids: number;
  container: Node;
  top?: Fiber;
  /** React's root options: where errors go. */
  onUncaughtError?: (error: unknown, info: { componentStack: string }) => void;
  onCaughtError?: (error: unknown, info: { componentStack: string; errorBoundary: any }) => void;
};

/** Who hears an error no boundary caught, before the root's own option: `act` in tests, which rethrows it. */
let uncaughtListener: ((e: unknown) => void) | null = null;
export function onUncaught(fn: typeof uncaughtListener) {
  const was = uncaughtListener;
  uncaughtListener = fn;
  return () => (uncaughtListener = was);
}

/** An error nothing caught: the root is taken down (React unmounts it), and the error told. */
function uncaught(root: RootState, e: unknown) {
  (root as any).failed = true;
  layoutQueue.push(() => {
    const top = root.top;
    if (top) {
      for (const c of top.children) unmount(c, true);
      top.children = [];
    }
  });
  // Outside a render (an effect after paint): taken down now.
  if (depth === 0) commit();
  const tell = () => {
    if (uncaughtListener) uncaughtListener(e);
    else if (root.onUncaughtError) root.onUncaughtError(e, { componentStack: "" });
    else report(e);
  };
  // In a root's render: rendered once more first (as React does), and told after, once.
  if (rendering) {
    (root as any).threw = true;
    caughtThisRender.push(tell);
  } else tell();
}

let current: Fiber | null = null;
let hookAt = 0;
let depth = 0;
// Phases, as React's commit has them: insertion effects first (before any ref or layout effect: a ref may call
// what one set up), then refs and layout effects, then passive effects after paint.
const insertionQueue: (() => void)[] = [];
const layoutQueue: (() => void)[] = [];
const passiveQueue: (() => void)[] = [];
let passiveBooked = false;

/** An error told as a browser's reportError tells it: an `error` event on the window, then the console unless a
 * listener handled it. The browser's own when it has one; a test DOM's (jsdom, happy-dom) is not always callable. */
export function report(e: unknown) {
  const native = typeof reportError === "function" && /\[native code\]/.test(Function.prototype.toString.call(reportError));
  if (native && typeof navigator !== "undefined" && !/jsdom|HappyDOM/i.test(navigator.userAgent)) return reportError(e);
  const w: any = typeof window !== "undefined" ? window : null;
  let handled = false;
  if (w?.dispatchEvent && typeof w.ErrorEvent === "function") {
    try {
      const ev = new w.ErrorEvent("error", { error: e, message: (e as any)?.message ?? String(e), cancelable: true });
      handled = !w.dispatchEvent(ev);
    } catch {}
  }
  if (!handled) console.error(e);
}

// ---------------------------------------------------------------- children

const TEXT_NODE = Symbol("text");

/** An iterable child's items (Symbol.iterator, or the `@@iterator` React still accepts), or null. */
function iterated(c: any): any[] | null {
  if (!c || typeof c !== "object" || c.$$typeof || Array.isArray(c)) return null;
  const at = c[Symbol.iterator] ?? c["@@iterator"];
  return typeof at === "function" ? [...{ [Symbol.iterator]: () => at.call(c) }] : null;
}

/** What a component or element gives as children, as a list: arrays nest as fragments, text as text. */
function toList(children: any): any[] {
  if (children == null || typeof children === "boolean") return [];
  if (Array.isArray(children)) return children;
  const items = iterated(children);
  if (items) return items;
  return [children];
}

/** A child's key among its siblings, and the fiber kind it makes. */
export function keyOf(c: any, i: number) {
  return c && typeof c === "object" && c.key != null ? "k" + c.key : "i" + i;
}

export function typeOf(c: any): any {
  if (typeof c === "string" || typeof c === "number" || typeof c === "bigint") return TEXT_NODE;
  if (Array.isArray(c)) return FRAGMENT;
  if (c.$$typeof === PORTAL) return PORTAL;
  return c.type;
}

// ---------------------------------------------------------------- DOM placement

function hostParentOf(f: Fiber): Node {
  let p = f.parent;
  while (p && p.kind !== HOST && p.kind !== ROOT && p.kind !== PORTAL_F) p = p.parent;
  return p!.dom;
}

function firstDom(f: Fiber): Node | null {
  if (f.kind === HOST || f.kind === TEXT) return f.dom;
  if (f.kind === PORTAL_F) return null;
  for (const c of f.children) {
    const d = firstDom(c);
    if (d) return d;
  }
  return null;
}

/** The DOM node after everything `f` put on the page: where what it draws next goes before. */
function nextDomAfter(f: Fiber): Node | null {
  let at: Fiber | null = f;
  while (at && at.parent) {
    const sibs = at.parent.children;
    for (let i = sibs.indexOf(at) + 1; i < sibs.length; i++) {
      const d = firstDom(sibs[i]!);
      if (d) return d;
    }
    const p: Fiber = at.parent;
    if (p.kind === HOST || p.kind === ROOT || p.kind === PORTAL_F) return null;
    at = p;
  }
  return null;
}

/** A fragment's top-level elements: hosts directly in it, through components but not into elements or portals. */
function topElements(f: Fiber, out: Element[] = []): Element[] {
  for (const c of f.children) {
    if (c.kind === HOST) out.push(c.dom);
    else if (c.kind !== TEXT && c.kind !== PORTAL_F) topElements(c, out);
  }
  return out;
}

function domNodes(f: Fiber, out: Node[] = []): Node[] {
  // A singleton stays where the document has it: not moved or removed with its parent's nodes.
  if ((f as any).singleton) return out;
  if (f.kind === HOST || f.kind === TEXT) out.push(f.dom);
  else if (f.kind !== PORTAL_F) for (const c of f.children) domNodes(c, out);
  return out;
}

/** The document nodes are made in: the container's own (a test's jsdom, an iframe), else the page's. */
const docOf = (host: Node): Document => (host.nodeType === 9 ? (host as Document) : host.ownerDocument) ?? document;

/** A suspended tree's nodes hidden (React's display: none, text emptied) or shown again as they were. */
function hideNodes(f: Fiber, hide: boolean) {
  for (const n of domNodes(f)) {
    const box = n as any;
    if (hide === !!box.__hidden) continue;
    if (n.nodeType === 3) {
      if (hide) (box.__hidden = { text: (n as Text).data }), ((n as Text).data = "");
      else ((n as Text).data = box.__hidden.text), (box.__hidden = null);
    } else {
      const style = (n as HTMLElement).style;
      if (!style) continue;
      if (hide) (box.__hidden = { display: style.getPropertyValue("display"), priority: style.getPropertyPriority("display") }), style.setProperty("display", "none", "important");
      else style.setProperty("display", box.__hidden.display, box.__hidden.priority), (box.__hidden = null);
    }
  }
}

// ---------------------------------------------------------------- reconciling

/** `parent`'s children made to be `list`: kept by key and type, the rest made or taken away, in order. */
function reconcile(parent: Fiber, list: any[], host: Node, before: Node | null) {
  const old = parent.children;
  const byKey = new Map<string, Fiber>();
  for (const f of old) byKey.set(f.key, f);
  const next: Fiber[] = [];
  const seenKeys = new Set<string>();
  let i = 0;
  for (let c of list) {
    // A lazy or a promise as a child: what it gives, once it has (suspending until then).
    c = unwrapChild(c);
    // An iterable among the children (a Set, a generator, an old `@@iterator` object): a fragment of its items.
    const items = Array.isArray(c) ? null : iterated(c);
    if (items) checkKeys((c = items), parent.type);
    // A plain object is no child (an element, text, an array or an iterable is).
    if (c && typeof c === "object" && !Array.isArray(c) && !c.$$typeof) throw objectChild(c);
    if (c == null || typeof c === "boolean") {
      i++;
      continue;
    }
    const key = keyOf(c, i++);
    if (key[0] === "k" && seenKeys.has(key)) duplicateKey(key.slice(1));
    seenKeys.add(key);
    const type = typeOf(c);
    const had = byKey.get(key);
    if (had && had.type === type && !had.dead) {
      byKey.delete(key);
      update(had, c);
      next.push(had);
    } else {
      next.push(mount(c, key, type, parent, host, before));
    }
  }
  for (const f of byKey.values()) unmount(f, true);
  parent.children = next;
  // In order, back to front: each node before the one after it, moved only when it is not already there.
  // Taking over server markup, nodes are claimed or made in place: nothing to move.
  if (hydrating) return;
  let cursor = before;
  for (let j = next.length - 1; j >= 0; j--) {
    const nodes = domNodes(next[j]!);
    for (let k = nodes.length - 1; k >= 0; k--) {
      const n = nodes[k]!;
      if (n.parentNode !== host || pastComments(n.nextSibling) !== cursor) host.insertBefore(n, cursor);
      cursor = n;
    }
  }
}

// ---------------------------------------------------------------- profiling

/** The clock React's Profiler reads (React's scheduler's now): replaceable, as a test's mock scheduler does. */
let now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
export function setClock(fn: () => number) {
  now = fn;
}
/** When the render now under way began, and the time spent in nested draws of the draw running now. */
let renderStart = 0;
let nestedTime = 0;
/** Profilers whose subtree rendered since the last commit, with the time their components took. */
const profiled = new Map<Fiber, number>();
/** An update set while committing (in componentDidMount, a layout effect): the next render is a nested update. */
let nestedUpdate = false;
let renderIsNested = false;
export const scheduledInCommit = () => committing && (nestedUpdate = true);

/** Renders counted, so a Profiler knows whether it began in the one now under way. */
let renderSerial = 0;
/** A Profiler rendered again (mounted, or given new props): its own start time in this render. */
function profilerBegins(f: Fiber) {
  (f as any).began = now();
  (f as any).beganIn = renderSerial;
}

/** A component drawn in `self` time: counted in each Profiler around it. */
function profile(f: Fiber, self: number) {
  (f as any).selfTime = self;
  for (let p = f.parent; p; p = p.parent) if (p.type === PROFILER) profiled.set(p, (profiled.get(p) ?? 0) + self);
}

/** The time every component under `f` took when it last rendered (React's base duration). */
function baseOf(f: Fiber): number {
  let sum = (f as any).selfTime ?? 0;
  for (const c of f.children) sum += baseOf(c);
  return sum;
}

/** Each Profiler that rendered told, innermost first, as React calls onRender in its commit. */
function tellProfilers(commitTime: number) {
  if (!profiled.size) return;
  const depthOf = (f: Fiber) => {
    let d = 0;
    for (let p = f.parent; p; p = p.parent) d++;
    return d;
  };
  const list = [...profiled].filter(([p]) => !p.dead).sort((a, b) => depthOf(b[0]) - depthOf(a[0]));
  profiled.clear();
  const phase0 = renderIsNested ? "nested-update" : "update";
  for (const [p, actual] of list) {
    const phase = (p as any).profiledOnce ? phase0 : "mount";
    (p as any).profiledOnce = true;
    const onRender = p.props?.onRender;
    const start = (p as any).beganIn === renderSerial ? (p as any).began : renderStart;
    // What it throws goes to the nearest boundary, as an error in the commit does.
    if (typeof onRender === "function") lifecycle(p, () => onRender(p.props.id, phase, actual, baseOf(p), start, commitTime));
  }
}

/** Unmount lifecycles of what a render took away, run first in the commit. */
const deletions: (() => void)[] = [];
/** A commit running: what it takes away goes at once. */
let committing = false;

/** Fibers made since the last commit: committed by it. */
const fresh: Fiber[] = [];

function fiber(kind: number, type: any, key: string, props: any, parent: Fiber): Fiber {
  return remember({ kind, type, key, props, parent, children: [], dom: null, ns: parent.kind === HOST ? childNs(parent) : parent.ns, root: parent.root });
}
const remember = (f: Fiber) => (fresh.push(f), f);

/** The namespace what goes into `node` is made in: SVG inside an SVG element (a portal into a <g>), else HTML. */
function nsOf(node: Node): string | null {
  const ns = (node as Element).namespaceURI;
  return ns === SVG_NS && node.nodeName !== "foreignObject" ? SVG_NS : ns === MATH_NS ? MATH_NS : null;
}

function childNs(host: Fiber): string | null {
  if (host.type === "foreignObject") return null;
  return host.ns;
}

// ---------------------------------------------------------------- hydration

/** While a root takes over what the server drew: for each parent, the next of its server nodes to claim. */
let hydrating: Map<Node, Node | null> | null = null;
/** Whether this hydration found attributes that differ from the client's props: told once, as React does. */
let attrsDiffer = false;
const HYDRATION_ATTRS = "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\nhttps://react.dev/link/hydration-mismatch";

/** The server's attributes against those the props draw (on a scratch element): whether any differs. */
type Attrs = { names: Map<string, string>; css: string };
const attrsOf = (el: Element): Attrs => ({ names: new Map(el.getAttributeNames().map((n) => [n, el.getAttribute(n)!])), css: (el as HTMLElement).style?.cssText ?? "" });
function serverAttrsDiffer(server: Element, had: Attrs, type: string, ns: string | null, props: any): boolean {
  const doc = server.ownerDocument;
  const probe = ns ? doc.createElementNS(ns, type) : doc.createElement(type);
  const { children: _c, dangerouslySetInnerHTML: _d, ...rest } = props;
  try {
    muteWarnings(() => setProps(probe, rest, null, ns === SVG_NS));
  } catch {
    return false;
  }
  // Form state is the element's, not an attribute; style is compared as text with what React would have written.
  const skip = new Set(["value", "checked", "selected", "style"]);
  const names = new Set([...had.names.keys(), ...probe.getAttributeNames()]);
  for (const n of names) if (!skip.has(n) && (had.names.get(n) ?? null) !== probe.getAttribute(n)) return true;
  const want = props.style == null ? null : styleText(props.style) || null;
  return (had.names.get("style") ?? null) !== want;
}

/** Whether this hydration found markup that differs from the client's, reported once to onRecoverableError. */
let mismatched = false;

/** Past comments (the server's separators and markers, left in place). */
const pastComments = (n: Node | null) => {
  while (n && n.nodeType === 8) n = n.nextSibling;
  return n;
};

/** The next server node in `host`, past comments (React's separators and markers). */
function nextServerNode(host: Node, scripts = false): Node | null {
  if (!hydrating) return null;
  let n = hydrating.has(host) ? hydrating.get(host)! : host.firstChild;
  const limit = regionIn(host)?.end;
  // Past comments and a doctype: markers and the document's preamble are no fiber's; past the server's own
  // scripts (bootstrap, runtime) too, unless a <script> is what is being claimed.
  while (n && n !== limit && (n.nodeType === 8 || n.nodeType === 10 || (!scripts && (n as Element).localName === "script"))) n = n.nextSibling;
  return n === limit ? null : n;
}

// ---------------------------------------------------------------- Suspense boundaries from the server

/** A Suspense boundary the server drew, between its comments (`$` complete, `$?` pending, `$!` given to the
 * client): hydrated on its own, as React does — what goes wrong inside stays inside. */
type Region = { fiber: Fiber; host: Node; start: Comment; end: Comment; suspended: PromiseLike<any> | null; mismatch: boolean; text: boolean; made: Node[]; errored?: { error: unknown } };
const regions: Region[] = [];
const regionIn = (host: Node) => {
  for (let i = regions.length - 1; i >= 0; i--) if (regions[i]!.host === host) return regions[i];
  return undefined;
};
/** Markup that differs from the client's: the innermost boundary's to deal with, or the root's. */
function markMismatch(text = false) {
  const r = regions[regions.length - 1];
  if (r) {
    // After it suspended, nothing of the boundary counts yet: it is hydrated again later.
    if (!r.suspended && !r.mismatch) (r.mismatch = true), (r.text = text);
  } else if (!mismatched) (mismatched = true), (mismatchedText = text);
}
/** Whether the root's mismatch was text (React says "server rendered text" then). */
let mismatchedText = false;
const failedMessage = (text: boolean) => (text ? HYDRATION_FAILED.replace("server rendered HTML", "server rendered text") : HYDRATION_FAILED);
/** The comment closing the boundary opened by `start`. */
function boundaryEnd(start: Comment): Comment | null {
  const activity = start.data === "&";
  const close = activity ? "/&" : "/$";
  let depth = 0;
  for (let n = start.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType !== 8) continue;
    const d = (n as Comment).data;
    if (d === close) {
      if (depth === 0) return n as Comment;
      depth--;
    } else if (activity ? d === "&" : d === "$" || d === "$?" || d === "$!") depth++;
  }
  return null;
}
/** The boundary's server markup taken away, its comments too (it is drawn on the client instead): where it was. */
function removeRegion(r: { start: Comment; end: Comment }): Node | null {
  const after = r.end.nextSibling;
  clearRegion(r);
  r.start.remove();
  r.end.remove();
  return after;
}
/** The boundary's server nodes between its comments taken away (it is drawn on the client instead). */
function clearRegion(r: { start: Comment; end: Comment }) {
  for (let n = r.start.nextSibling; n && n !== r.end; ) {
    const next = n.nextSibling;
    n.parentNode!.removeChild(n);
    n = next;
  }
}
const HYDRATION_FAILED = "Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\nhttps://react.dev/link/hydration-mismatch";
/** A recoverable error told in the commit, after what replaced the boundary is drawn, as React tells it. */
const recoverable = (f: Fiber, message: string) => {
  const error = new Error(message);
  layoutQueue.push(() => ((f.root as any).onRecoverable ?? report)(error, { componentStack: "" }));
};

/** A Suspense boundary mounted while hydrating: taken over from its server markup, on its own. */
/** How a boundary draws its children: a Suspense starts its effect, an Activity reconciles them. */
function drawBoundary(f: Fiber, host: Node, before: Node | null) {
  if (f.type === ACTIVITY) {
    for (const c of f.children) unmount(c, false);
    f.children = [];
    reconcile(f, toList(f.props?.children), host, before);
  } else {
    f.stop?.();
    f.children = [];
    start(f, host, before);
  }
}

function hydrateBoundary(f: Fiber, host: Node, before: Node | null) {
  let raw: Node | null = hydrating!.has(host) ? hydrating!.get(host)! : host.firstChild;
  while (raw && raw.nodeType === 3 && !(raw as Text).data.trim()) raw = raw.nextSibling;
  const kind = raw && raw.nodeType === 8 ? (raw as Comment).data : null;
  const expected = f.type === ACTIVITY ? kind === "&" : kind === "$" || kind === "$?" || kind === "$!";
  const end = expected ? boundaryEnd(raw as Comment) : null;
  if (!end) {
    // Not the server's boundary here: drawn as any other (a mismatch, found by what it holds).
    if (f.type === ACTIVITY) reconcile(f, toList(f.props?.children), host, before);
    else start(f, host, before);
    return;
  }
  const region = { start: raw as Comment, end };
  hydrating!.set(host, end.nextSibling);
  (f as any).region = region;
  if (kind === "$?") {
    // Still streaming: the server's fallback stays until its content arrives (the stream's script says so).
    (raw as any)._reactRetry = () => deferTransition(() => retryBoundary(f));
    (f as any).dehydrated = true;
    return;
  }
  if (kind === "$!") {
    serverGaveUp(f, region);
    drawFresh(f, host, removeRegion(region));
    return;
  }
  hydrateRegion(f, host, region, () => (f.type === ACTIVITY ? reconcile(f, toList(f.props?.children), host, before) : start(f, host, before)));
}

/** The boundary's children hydrated inside its region: kept dehydrated if they suspend, drawn on the client if
 * they do not match. */
function hydrateRegion(f: Fiber, host: Node, region: { start: Comment; end: Comment }, draw: () => void) {
  const r: Region = { fiber: f, host, start: region.start, end: region.end, suspended: null, mismatch: false, text: false, made: [], errored: undefined };
  const was = hydrating!.get(host);
  hydrating!.set(host, region.start.nextSibling);
  regions.push(r);
  try {
    draw();
    // What the server drew there and nothing claimed: a mismatch of the boundary's.
    if (!r.suspended && nextServerNode(host)) r.mismatch = true;
  } finally {
    regions.pop();
    hydrating!.set(host, was ?? region.end.nextSibling);
  }
  if (r.errored) {
    for (const c of f.children) unmount(c, false);
    f.children = [];
    for (const n of r.made) n.parentNode?.removeChild(n);
    const error: any = new Error("There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.");
    error.cause = r.errored.error;
    layoutQueue.push(() => ((f.root as any).onRecoverable ?? report)(error, { componentStack: "" }));
    (f as any).dehydrated = false;
    drawFresh(f, host, removeRegion(region));
    return;
  }
  if (r.suspended && !r.mismatch) {
    // Left as the server drew it, and hydrated again once what it waits for is there.
    for (const c of f.children) unmount(c, false);
    f.children = [];
    for (const n of r.made) n.parentNode?.removeChild(n);
    (f as any).dehydrated = true;
    const again = () => deferTransition(() => retryBoundary(f));
    r.suspended.then(again, again);
    return;
  }
  (f as any).dehydrated = false;
  if (r.mismatch) {
    for (const c of f.children) unmount(c, false);
    f.children = [];
    for (const n of r.made) n.parentNode?.removeChild(n);
    recoverable(f, failedMessage(r.text));
    drawFresh(f, host, removeRegion(region));
  }
}

/** A boundary the server gave to the client: reported with the server's reason (in development) and digest. */
function serverGaveUp(f: Fiber, region: { start: Comment }) {
  const t = region.start.nextSibling as HTMLElement | null;
  const data: any = t && t.nodeName === "TEMPLATE" ? (t as any).dataset ?? {} : {};
  const error: any = new Error(
    dev() && data.msg ? data.msg : "The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.",
  );
  error.digest = data.dgst;
  layoutQueue.push(() => ((f.root as any).onRecoverable ?? report)(error, { componentStack: dev() ? data.cstck ?? "" : "" }));
}

/** The boundary drawn on the client, not hydrated, before its closing comment. */
function drawFresh(f: Fiber, host: Node, end: Node | null) {
  const was = hydrating;
  hydrating = null;
  try {
    drawBoundary(f, host, end);
  } finally {
    hydrating = was;
  }
}

/** A dehydrated boundary hydrated again (its data is there, or its content streamed in). */
function retryBoundary(f: Fiber) {
  const region = (f as any).region as { start: Comment; end: Comment } | undefined;
  if (!region || f.dead || hydrating || !(f as any).dehydrated) return;
  const host = region.start.parentNode;
  if (!host) return;
  if (region.start.data === "$!") {
    serverGaveUp(f, region);
    const after = removeRegion(region);
    (f as any).region = undefined;
    (f as any).dehydrated = false;
    drawFresh(f, host, after);
    flushSignals();
    return;
  }
  hydrating = new Map();
  depth++;
  try {
    hydrateRegion(f, host, region, () => drawBoundary(f, host, region.end));
  } finally {
    hydrating = null;
    if (--depth === 0) commit();
  }
  flushSignals();
}

/** Where a node made while hydrating goes: before the next server node, which stays next (the new node is not one). */
function serverCursor(host: Node): Node | null {
  const n = nextServerNode(host);
  hydrating!.set(host, n);
  return n;
}
/** Where React hydrates loosely (skipping what does not match): a root's container, or <html>, <head>, <body>. */
const rootContainers = new WeakSet<Node>();
const rootOrSingleton = (host: Node) => rootContainers.has(host) || !!(host as any).__fiber?.singleton || host.nodeType === 9;
/** A server node Float owns (a resource or a node Float made), never a fiber's. */
function isResourceNode(n: Node) {
  if (n.nodeType !== 1) return false;
  const el = n as Element;
  if ((el as any)[HOISTABLE]) return true;
  switch (el.localName) {
    case "link":
      return el.getAttribute("rel") === "stylesheet" && el.hasAttribute("data-precedence");
    case "style":
      return el.hasAttribute("data-precedence");
  }
  return false;
}
/** A document's containers emptied as React's clearContainerSparingly does: scripts, styles and stylesheets stay. */
function clearSparingly(container: Node) {
  let n = container.firstChild;
  if (n && n.nodeType === 10) n = n.nextSibling;
  while (n) {
    const node = n;
    n = n.nextSibling;
    switch (node.nodeName) {
      case "HTML":
      case "HEAD":
      case "BODY":
        clearSparingly(node);
        continue;
      case "SCRIPT":
      case "STYLE":
        continue;
      case "LINK":
        if ((node as HTMLLinkElement).rel?.toLowerCase() === "stylesheet") continue;
    }
    container.removeChild(node);
  }
}

/** Whether an element renders inside a container (not directly in the document or <html>): React's containerTagInScope. */
function inContainer(parent: Fiber): boolean {
  for (let p: Fiber | null = parent; p; p = p.parent) {
    if (p.kind === HOST) return p.type !== "html";
    if (p.kind === ROOT || p.kind === PORTAL_F) {
      const n = p.dom as Node;
      return n.nodeType !== 9 && (n as Element).localName !== "html";
    }
  }
  return false;
}

/** A hoistable or resource fiber: its element found or made, and put in place, when the render commits. */
function mountHoist(f: Fiber, host: Node) {
  const root = hoistableRoot(host);
  const resource = getResource(root, f.type, f.props);
  (f as any).resource = resource;
  (f as any).hoistRoot = root;
  layoutQueue.push(() => {
    if (f.dead) return;
    f.dom = resource ? acquireResource(root, resource, f.props) : placeHoistable(root, f.type, f.props);
    if (f.dom && !resource) hide(f.dom, "__fiber", f);
    if (f.props.ref != null) setRef(f, f.props.ref, f.dom);
  });
}

/** React's hydrateHoistable: the document's matching <title>, <meta> or <link> taken over, or a new one into <head>. */
function placeHoistable(root: Document | ShadowRoot, type: string, props: any): Element {
  const d: Document = (root as any).ownerDocument || root;
  let el: Element | null = null;
  if (type === "title") {
    const t = d.getElementsByTagName("title")[0];
    if (t && !(t as any)[HOISTABLE] && !(t as any).__fiber && t.namespaceURI !== SVG_NS && !t.hasAttribute("itemprop")) el = t;
    else {
      el = d.createElement("title");
      d.head.insertBefore(el, d.querySelector("head > title"));
    }
    setProps(el, props, null, false);
    titleText(el, props.children);
  } else {
    el = claimHoistable(d, type, props);
    if (!el) {
      el = d.createElement(type);
      setProps(el, props, null, false);
      mountHoistable(root, type, el);
    }
  }
  markHoistable(el);
  return el;
}

/** A <title>'s text: its one child as a string (React keeps a title to text). */
function titleText(el: Element, children: any) {
  const c = Array.isArray(children) ? (children.length < 2 ? children[0] : null) : children;
  const text = typeof c === "string" || typeof c === "number" || typeof c === "bigint" ? String(c) : c && typeof c === "object" && c.toString !== Object.prototype.toString ? String(c) : "";
  if (el.textContent !== text) el.textContent = text;
}

function updateHoist(f: Fiber, props: any) {
  const prev = f.props;
  if (prev === props) return;
  const root = (f as any).hoistRoot as Document | ShadowRoot;
  const was = (f as any).resource as Resource | null;
  const next = getResource(root, f.type, props);
  f.props = props;
  if (was !== next) {
    // Another resource, or a hoistable that becomes one (or the other way): let go of the old, take the new.
    (f as any).resource = next;
    const old = f.dom;
    layoutQueue.push(() => {
      if (f.dead) return;
      if (was) was.count--;
      else old?.parentNode?.removeChild(old);
      f.dom = next ? acquireResource(root, next, props) : placeHoistable(root, f.type, props);
    });
  } else if (!next) {
    layoutQueue.push(() => {
      if (f.dead || !f.dom) return;
      setProps(f.dom as Element, props, prev, false);
      if (f.type === "title") titleText(f.dom as Element, props.children);
    });
  }
  if (prev.ref !== props.ref)
    layoutQueue.push(() => {
      if (prev.ref != null) clearRef(f, prev.ref);
      if (props.ref != null && !f.dead) setRef(f, props.ref, f.dom);
    });
}

/** A hoistable taken out of <head>; a resource kept (it may be shared), one user fewer. */
function releaseHoist(f: Fiber) {
  const r = (f as any).resource as Resource | null;
  if (r) r.count--;
  else f.dom?.parentNode?.removeChild(f.dom);
}

/** The document's own <html>, <head> or <body> for `type` (made if the document has none), or null. */
function singleton(host: Node, type: string): Element | null {
  if (type !== "html" && type !== "head" && type !== "body") return null;
  const doc = docOf(host);
  const root = doc.documentElement;
  if (type === "html") return root;
  if (!root) return null;
  const existing = type === "head" ? doc.head : doc.body;
  if (existing) return existing;
  const made = doc.createElement(type);
  type === "head" ? root.insertBefore(made, root.firstChild) : root.appendChild(made);
  return made;
}

/** Our own fields on a DOM node, kept out of enumeration (snapshot serializers, devtools listing its keys). */
const hide = (node: any, key: string, value: any) => Object.defineProperty(node, key, { value, writable: true, configurable: true, enumerable: false });

/** What this hydration inserted (not the server's): removed if it is given up. */
let madeWhileHydrating: Node[] = [];
/** An error thrown while hydrating outside any boundary: the whole root is drawn on the client instead. */
let hydrationError: { error: unknown } | null = null;
/** What this hydration waits for (a component suspended with no boundary around it): tried again when it settles. */
let hydrationWaits: PromiseLike<any> | null = null;

/** A server node taken for a fiber: the next one, if it is the same kind of thing. */
function claim(host: Node, match: (n: Node) => boolean): Node | null {
  const first = nextServerNode(host, true);
  let n = first && match(first) && !isResourceNode(first) ? first : nextServerNode(host);
  if (n && (!match(n) || isResourceNode(n)) && rootOrSingleton(host)) {
    const limit = regionIn(host)?.end;
    let m: Node | null = n.nextSibling;
    while (m && m !== limit && (m.nodeType === 8 || !match(m) || isResourceNode(m))) m = m.nextSibling;
    n = m === limit ? null : m;
  }
  if (!n || !match(n)) return null;
  hydrating!.set(host, n.nextSibling);
  return n;
}

/** What the server drew in `host` and the client did not claim: taken away, as React does on a mismatch. */
function dropUnclaimed(host: Node) {
  if (!hydrating) return;
  const limit = regionIn(host)?.end;
  let n = nextServerNode(host);
  while (n && n !== limit) {
    const next = n.nextSibling;
    if (n.nodeType !== 8) {
      host.removeChild(n);
      markMismatch();
    }
    n = next;
  }
  hydrating.delete(host);
}

/** What is open where a fiber's children go: its nearest element's, or its root's or portal's container's. */
function nestingAt(f: Fiber | null): Ancestors | null {
  for (let p = f; p; p = p.parent) {
    if (p.kind === HOST) return p.nesting ?? null;
    if (p.kind === PORTAL_F || p.kind === ROOT) return ((p as any).nesting ??= ancestorsWith(null, containerTag(p.dom)));
  }
  return null;
}
const containerTag = (n: Node) => (n.nodeType === 9 ? "#document" : n.nodeType === 11 ? "#fragment" : (n as Element).localName ?? "#document");

/** Whether the element `tag` around `f` is further up than its direct parent (a component between them). */
function behindComponents(f: Fiber, tag: string): boolean {
  for (let p = f.parent; p; p = p.parent) if (p.kind === HOST && p.type === tag) return p !== f.parent;
  return false;
}

function mount(c: any, key: string, type: any, parent: Fiber, host: Node, before: Node | null): Fiber {
  if (type === TEXT_NODE) {
    const f = fiber(TEXT, type, key, c, parent);
    const text = "" + c;
    if (dev()) {
      const around = nestingAt(parent);
      checkTextNesting(text, around?.current?.tag, around?.implicitRoot ?? false);
    }
    // A server text node holds this one and maybe the next (adjacent text runs together in HTML): split off.
    const had = hydrating && text !== "" ? (claim(host, (n) => n.nodeType === 3 && (n as Text).data.startsWith(text)) as Text | null) : null;
    if (had) {
      if (had.data.length > text.length) hydrating!.set(host, had.splitText(text.length));
      f.dom = had;
    } else {
      if (hydrating && text !== "") markMismatch(nextServerNode(host)?.nodeType === 3);
      f.dom = docOf(host).createTextNode(text);
      host.insertBefore(f.dom, hydrating ? serverCursor(host) : before);
      if (hydrating) madeWhileHydrating.push(f.dom), regions[regions.length - 1]?.made.push(f.dom);
    }
    return f;
  }
  if (type === FRAGMENT) {
    const props = Array.isArray(c) ? null : c.props;
    const f = fiber(FRAG, type, key, props, parent);
    reconcile(f, props ? toList(props.children) : c, host, before);
    // A ref on a Fragment: an instance that treats its top-level elements as one (React 19.2's fragment refs).
    if (props?.ref != null) {
      const inst = ((f as any).fragment = new FragmentInstance(() => topElements(f), () => hostParentOf(f) as Element));
      layoutQueue.push(() => (inst.sync(), setRef(f, props.ref, inst)));
    }
    return f;
  }
  if (type === PORTAL) {
    const f = fiber(PORTAL_F, type, key, c, parent);
    f.dom = c.containerInfo;
    f.ns = nsOf(f.dom);
    addContainer(f.dom, f.root);
    reconcile(f, toList(c.children), f.dom, null);
    return f;
  }
  const props = c.props;
  if (typeof type === "string") {
    const f = fiber(HOST, type, key, props, parent);
    const ns = type === "svg" ? SVG_NS : type === "math" ? MATH_NS : f.ns;
    f.ns = ns;
    checkTagName(type);
    assertValidProps(type, props);
    if (dev()) {
      const around = nestingAt(parent);
      checkNesting(type, around, (tag) => behindComponents(f, tag));
      f.nesting = ancestorsWith(around, type);
    }
    if (ns !== MATH_NS && isHoistable(type, props, ns === SVG_NS, inContainer(parent), warn)) {
      f.kind = HOIST;
      mountHoist(f, host);
      return f;
    }
    // <html>, <head> and <body> are the document's own (React's singletons), wherever they are rendered.
    const single = !ns ? singleton(host, type) : null;
    if (single) (f as any).singleton = true;
    // Taken over while hydrating: what follows it in its parent comes next.
    if (single && hydrating && single.parentNode === host) hydrating.set(host, single.nextSibling);
    if (single && !hydrating && type !== "html") clearSparingly(single);
    const server = single ?? (hydrating ? (claim(host, (n) => n.nodeType === 1 && (n as Element).localName === type.toLowerCase()) as Element | null) : null);
    const el = (f.dom = server ?? (ns ? docOf(host).createElementNS(ns, type) : docOf(host).createElement(type)));
    // Its fiber, for tools that look from the page into the tree.
    hide(el, "__fiber", f);
    hide(el, "__props", null);
    listenOnElement(el, type);
    if (!server) {
      if (hydrating) markMismatch();
      checkTag(el, type);
    }
    // As the server drew it, to compare once the props are applied (and have warned as they do).
    const had = server && dev() && !attrsDiffer && !props.suppressHydrationWarning ? attrsOf(server) : null;
    (el as any).__props = props;
    if (FORM_TAGS.has(type) && !ns) {
      // A select chooses among its options, so they come first; a textarea's children are its value, not nodes.
      if (type !== "textarea" && type !== "input") reconcile(f, toList(props.children), el, null);
      initForm(el, type, props, false);
    } else {
      setProps(el, props, null, ns === SVG_NS);
      setDefaults(el, props);
      // A noscript's children are not drawn on the client (React leaves them to the server).
      if (props.dangerouslySetInnerHTML == null && type !== "noscript") reconcile(f, toList(props.children), el, null);
    }
    if (had && !attrsDiffer && serverAttrsDiffer(el, had, type, ns, props)) {
      attrsDiffer = true;
    }
    if (server) {
      if (props.dangerouslySetInnerHTML == null && type !== "noscript" && !single && !hydrationWaits && !regions.some((r) => r.suspended)) dropUnclaimed(el);
    } else {
      host.insertBefore(el, hydrating ? serverCursor(host) : before);
      if (hydrating) madeWhileHydrating.push(el), regions[regions.length - 1]?.made.push(el);
    }
    if (props.ref != null) layoutQueue.push(() => !f.dead && setRef(f, props.ref, el));
    return f;
  }
  if (type === FRAGMENT || type === STRICT || type === PROFILER || type === SUSPENSE_LIST || type === ACTIVITY || type === VIEW_TRANSITION) {
    const f = fiber(FRAG, type, key, props, parent);
    if (type === PROFILER) profilerBegins(f);
    if (type === ACTIVITY && props.mode !== "hidden" && hydrating) hydrateBoundary(f, host, before);
    else if (!(type === ACTIVITY && props.mode === "hidden")) reconcile(f, toList(props.children), host, before);
    return f;
  }
  if (type && type.$$typeof === CONTEXT) {
    const f = fiber(PROVIDER, type, key, props, parent);
    f.value = signal(props.value);
    reconcile(f, toList(props.children), host, before);
    return f;
  }
  const f = fiber(COMP, type, key, props, parent);
  f.render = renderer(type, f);
  f.hooks = [];
  // In a render that can stop between components: drawn when the work loop reaches it, where it is then.
  if (work && work.deferring) {
    work.units.splice(work.at++, 0, () => !f.dead && start(f, hostParentOf(f), nextDomAfter(f)));
    return f;
  }
  // Its boundary has suspended while hydrating: the rest of it waits, as React stops rendering there.
  if (hydrating && regions[regions.length - 1]?.suspended) return f;
  if (type === SUSPENSE && hydrating) hydrateBoundary(f, host, before);
  else start(f, host, before);
  return f;
}

// ---------------------------------------------------------------- work loop

/**
 * A root's first render done as React's concurrent render is: component by component, off the page (in a
 * fragment), able to stop between two components and go on later; committed, and put on the page, once all are
 * drawn. In the browser it runs to the end at once; a test's scheduler steps through it (waitFor).
 */
type Work = { units: (() => void)[]; at: number; deferring: boolean; finish: () => void };
let work: Work | null = null;
/** When the work loop runs: at once by default; a test's scheduler can take it over. */
let scheduleWork: (run: () => void) => void = (run) => run();
/** What is scheduled now started (a root's render begun), without finishing a concurrent render: for a test. */
export const flushScheduled = () => flushSignals();
export function setWorkScheduler(fn: typeof scheduleWork) {
  scheduleWork = fn;
}

/** The work loop: units drawn until none are left (then the render is committed) or `shouldYield` says stop. */
export function performWork(shouldYield: () => boolean = () => false): boolean {
  if (!work) return false;
  const w = work;
  while (w.units.length) {
    if (shouldYield()) return true;
    const unit = w.units.shift()!;
    w.at = 0;
    w.deferring = true;
    try {
      unit();
    } finally {
      w.deferring = false;
    }
  }
  work = null;
  w.finish();
  return true;
}

function update(f: Fiber, c: any) {
  if (f.kind === TEXT) {
    if (f.props !== c) (f.dom as Text).data = "" + (f.props = c);
    return;
  }
  if (f.kind === FRAG) {
    const host = hostParentOf(f);
    const prev = f.props;
    if (f.type === PROFILER) (f.props = c.props), profilerBegins(f);
    reconcile(f, Array.isArray(c) ? c : toList(c.props?.children), host, nextDomAfter(f));
    f.props = c.props;
    // A fragment ref: its new elements get its listeners; a changed ref is moved over at commit.
    const inst = (f as any).fragment as FragmentInstance | undefined;
    if (inst) {
      layoutQueue.push(() => inst.sync());
      if (prev?.ref !== c.props?.ref) {
        layoutQueue.push(() => {
          if (prev?.ref != null) clearRef(f, prev.ref);
          if (c.props?.ref != null) setRef(f, c.props.ref, inst);
        });
      }
    }
    return;
  }
  if (f.kind === PORTAL_F) {
    if (f.dom !== c.containerInfo) {
      // Moved to another container: what it drew goes with it.
      for (const n of f.children) unmount(n, true);
      f.children = [];
      f.dom = c.containerInfo;
      f.ns = nsOf(f.dom);
      addContainer(f.dom, f.root);
    }
    reconcile(f, toList(c.children), f.dom, null);
    return;
  }
  const props = c.props;
  if (f.kind === HOIST) return updateHoist(f, props);
  if (f.kind === HOST) {
    const prev = f.props;
    if (prev === props) return;
    assertValidProps(f.type, props);
    f.props = props;
    const el = f.dom as Element;
    (el as any).__props = props;
    if (FORM_TAGS.has(f.type) && !f.ns) {
      if (f.type !== "textarea" && f.type !== "input") reconcile(f, toList(props.children), el, null);
      updateForm(el, f.type, props, prev, false);
    } else {
      setProps(el, props, prev, f.ns === SVG_NS);
      if (props.dangerouslySetInnerHTML == null && f.type !== "noscript") reconcile(f, toList(props.children), el, null);
      else if (f.children.length) {
        for (const n of f.children) unmount(n, false);
        f.children = [];
      }
    }
    if (prev.ref !== props.ref) {
      layoutQueue.push(() => {
        clearRef(f, prev.ref);
        if (props.ref != null) setRef(f, props.ref, el);
      });
    }
    return;
  }
  if (f.kind === PROVIDER) {
    f.props = props;
    f.value!.set(props.value);
    reconcile(f, toList(props.children), hostParentOf(f), nextDomAfter(f));
    return;
  }
  // A component: drawn again only if what it was given changed.
  if (f.props === props) return;
  if ((f as any).dehydrated && !hydrating) {
    // Hydrated first as the server drew it (the props it had), then updated.
    retryBoundary(f);
    if (!(f as any).dehydrated) {
      f.props = props;
      restart(f);
      return;
    }
    f.props = props;
    {
      // Still waiting: what the server drew goes, and the boundary is drawn on the client (its fallback, if it
      // suspends), as React does when an update cannot wait for hydration.
      const region = (f as any).region;
      const host = region.start.parentNode;
      const after = removeRegion(region);
      (f as any).region = undefined;
      (f as any).dehydrated = false;
      drawFresh(f, host, after);
    }
    return;
  }
  const same = f.compare ? f.compare(f.props, props) : false;
  f.props = props;
  if (!same) restart(f);
}

function shallowEqual(a: any, b: any) {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  let n = 0;
  for (const k in a) {
    if (!Object.is(a[k], b[k])) return false;
    n++;
  }
  for (const _ in b) n--;
  return n === 0;
}

function unmount(f: Fiber, removeDom: boolean) {
  if (f.dead) return;
  // A singleton let go: emptied, its attributes taken off, the element kept (React's releaseSingletonInstance).
  if ((f as any).singleton && f.dom) {
    const el = f.dom as Element;
    for (const c of f.children) unmount(c, false);
    f.children = [];
    if (f.type !== "html") el.replaceChildren();
    for (const a of [...el.attributes]) el.removeAttribute(a.name);
  }
  // A boundary still as the server drew it: its markup goes with it.
  if (removeDom && (f as any).dehydrated && (f as any).region) {
    removeRegion((f as any).region);
    (f as any).dehydrated = false;
  }
  if (removeDom) for (const n of domNodes(f)) n.parentNode?.removeChild(n);
  f.dead = true;
  if (!f.committed) {
    // Never committed: nothing ran for it, nothing to undo.
    f.stop?.();
    for (const c of f.children) unmount(c, false);
    return;
  }
  // Its unmount lifecycles run in the commit, as React's do, when this is a render; now otherwise.
  const later = depth > 0 && !committing ? (fn: () => void) => deletions.push(fn) : (fn: () => void) => fn();
  if (f.kind === COMP) {
    f.stop?.();
    const inst = f.inst;
    later(() => {
      if (inst && (f as any).classRef != null) clearRef(f, (f as any).classRef);
      if (inst?.componentWillUnmount) untrack(() => lifecycle(f, () => inst.componentWillUnmount()));
      for (const h of f.hooks!) if (h && h.cleanup) untrack(() => lifecycle(f, h.cleanup)), (h.cleanup = null);
    });
  } else if (f.kind === HOST && f.props.ref != null) {
    later(() => clearRef(f, f.props.ref));
  } else if (f.kind === HOIST) {
    later(() => {
      if (f.props.ref != null) clearRef(f, f.props.ref);
      releaseHoist(f);
    });
  } else if (f.kind === FRAG && (f as any).fragment && f.props?.ref != null) {
    later(() => clearRef(f, f.props.ref));
  }
  for (const c of f.children) unmount(c, f.kind === PORTAL_F);
}

/** A lifecycle or cleanup of `f` run, what it throws handed to `f`'s nearest boundary. */
function lifecycle(f: Fiber, fn: () => void) {
  try {
    fn();
  } catch (e) {
    caught(f, e);
  }
}

function guard(fn: () => void) {
  try {
    fn();
  } catch (e) {
    report(e);
  }
}

function setRef(f: Fiber, ref: any, value: any) {
  if (typeof ref === "function") {
    const back = ref(value);
    f.refCleanup = typeof back === "function" ? back : null;
  } else if (ref && typeof ref === "object") ref.current = value;
}

function clearRef(f: Fiber, ref: any) {
  if (typeof ref === "function") {
    if (f.refCleanup) f.refCleanup(), (f.refCleanup = null);
    else ref(null);
  } else if (ref && typeof ref === "object") ref.current = null;
}

// ---------------------------------------------------------------- components

/** How a component type renders: functions, classes, forwardRef, memo, lazy, Consumer, Suspense. */
function renderer(type: any, f: Fiber): (f: Fiber, props: any) => any {
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      f.tick = signal(0);
      return renderClass;
    }
    return (_f, props) => type(props);
  }
  if (type === SUSPENSE) {
    f.pending = signal(0);
    // Children once shown stay mounted while it waits again, hidden beside the fallback (their state kept, as React
    // keeps it); before they were ever shown, only the fallback.
    let shown = false;
    return (fb, props) => {
      const waiting = fb.pending!() > 0;
      if (!waiting) shown = true;
      layoutQueue.push(() => {
        const kept = fb.children.find((c) => c.key === "kc");
        if (kept) hideNodes(kept, waiting);
      });
      return [
        shown ? createElement(FRAGMENT, { key: "c" }, props.children) : null,
        waiting ? createElement(FRAGMENT, { key: "f" }, props.fallback) : null,
      ];
    };
  }
  switch (type?.$$typeof) {
    case FORWARD_REF:
      return (_f, props) => {
        if (!("ref" in props)) return type.render(props, null);
        const { ref, ...rest } = props;
        return type.render(rest, ref);
      };
    case MEMO:
      f.compare = type.compare ?? shallowEqual;
      return typeof type.type === "function" && !type.type.prototype?.isReactComponent
        ? (_f, props) => type.type(props)
        : (_f, props) => createElement(type.type, props);
    case LAZY:
      return (_f, props) => createElement(readLazy(type._payload), props);
    case CONSUMER:
      return (fb, props) => props.children(readContext(fb, type._context));
  }
  throw invalidType(type);
}


/** The component's effect started, rendering it now into `host` before `before`. */
function start(f: Fiber, host?: Node, before?: Node | null) {
  let place: [Node, Node | null] | null = host ? [host, before ?? null] : null;
  f.stop = effect(() => {
    if (f.tick) f.tick();
    if (f.dead) return;
    const at = place;
    place = null;
    draw(f, at);
  });
}

/** Drawn again now with new props: a fresh effect, so what it reads is tracked as its own. */
function restart(f: Fiber) {
  f.stop?.();
  start(f, hostParentOf(f), nextDomAfter(f));
}

/** A component's name, for messages. */
export const nameOf = (t: any): string =>
  typeof t === "string" ? t : t?.displayName ?? t?.name ?? (t?.render ? nameOf(t.render) : t?.type ? nameOf(t.type) : "Anonymous");

// Draws per component within one task: past the limit it is a loop (it sets state on every draw), stopped and named,
// as React's "Maximum update depth exceeded".
let drawsReset = false;
const LIMIT = 50;

function draw(f: Fiber, place: [Node, Node | null] | null) {
  (f as any).draws = ((f as any).draws ?? 0) + 1;
  if (!drawsReset) {
    drawsReset = true;
    // Once this synchronous run ends: a loop renders without ever yielding, so it is still caught.
    queueMicrotask(() => {
      drawsReset = false;
      loops.clear();
    });
  }
  loops.add(f);
  if ((f as any).draws > LIMIT) {
    // Handled as a render error would be: the nearest boundary, else the root goes down and the error is told.
    if ((f as any).draws === LIMIT + 1) caught(f, new Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops."));
    return;
  }
  // A unit of a concurrent render is part of that render: its passive effects come after its commit.
  if (depth++ === 0 && !work) {
    runPassive(false);
    startRender();
  }
  const began = now();
  const outerNested = nestedTime;
  nestedTime = 0;
  f.insertion = [];
  f.layout = [];
  f.passive = [];
  let out: any;
  const prevCurrent = current;
  const prevAt = hookAt;
  current = f;
  hookAt = 0;
  try {
    for (let pass = 0; ; pass++) {
      (f as any).again = false;
      out = f.render!(f, f.props);
      if (!(f as any).again) break;
      if (pass >= 24) throw new Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
      // Again, with what this render set: its hooks from the top, the effects it asked for asked again.
      hookAt = 0;
      f.insertion = [];
      f.layout = [];
      f.passive = [];
    }
  } catch (e) {
    // An update that suspends in a transition, or with no Suspense around it: what was on the page stays (React
    // keeps the committed UI and tries again when the data is there), rather than its children going and coming.
    const keep = f.committed && e && typeof (e as any).then === "function" && (applyingTransition || !suspenseAbove(f));
    out = keep ? KEEP : null;
    current = prevCurrent;
    hookAt = prevAt;
    caught(f, e);
  } finally {
    current = prevCurrent;
    hookAt = prevAt;
  }
  const kept = out === KEEP;
  if (kept) out = f.out;
  f.out = out;
  // A component returning an array: its elements are a list, each needing a key (React checks at render).
  if (Array.isArray(out)) checkKeys(out, f.type);
  const [host, before] = place ?? [hostParentOf(f), nextDomAfter(f)];
  drawing.add(f);
  try {
    reconcile(f, toList(out), host, before);
  } catch (e) {
    caught(f, e);
  }
  // A boundary that caught while mounting: its children dropped, and mounted again in its error state.
  for (let tries = 0; (f as any).redo && tries < 3; tries++) {
    (f as any).redo = false;
    for (const c of f.children) unmount(c, true);
    f.children = [];
    f.insertion = [];
    f.layout = [];
    f.passive = [];
    // Mounting: mounted again; updating: updated again, with the error's state.
    if (!f.committed && f.type.getDerivedStateFromError) f.inst.__remount = true;
    current = f;
    hookAt = 0;
    try {
      // A boundary with componentDidCatch alone has no state for the error yet: it shows nothing until its
      // componentDidCatch (in the commit) sets some, as React has it.
      out = f.type.getDerivedStateFromError ? f.render!(f, f.props) : null;
    } catch (e) {
      out = null;
      caught(f, e);
    } finally {
      current = prevCurrent;
      hookAt = prevAt;
    }
    f.out = out;
    try {
      reconcile(f, toList(out), host, before);
    } catch (e) {
      caught(f, e);
    }
  }
  drawing.delete(f);
  {
    const took = now() - began;
    if (!kept) profile(f, took - nestedTime);
    nestedTime = outerNested + took;
  }
  insertionQueue.push(...f.insertion);
  layoutQueue.push(...f.layout);
  passiveQueue.push(...f.passive);
  if (--depth === 0) commit();
}

/** A render beginning: its start time, and whether an update set in the last commit set it off. */
function startRender() {
  renderSerial++;
  renderStart = now();
  renderIsNested = nestedUpdate;
  nestedUpdate = false;
}

/** A root's render in progress (not an update drawn later): errors caught in it are told after any retry. */
let rendering = false;
const caughtThisRender: (() => void)[] = [];

/** Components whose draw is running: a boundary among them that catches redoes its mount in the same draw. */
const drawing = new Set<Fiber>();

const loops = {
  seen: new Set<Fiber>(),
  add(f: Fiber) {
    this.seen.add(f);
  },
  clear() {
    for (const f of this.seen) (f as any).draws = 0;
    this.seen.clear();
  },
};

/** A class component's render, its lifecycle around it. */
const KEEP = Symbol("keep");
function renderClass(f: Fiber, withRef: any) {
  const C = f.type;
  let props = withRef;
  if (withRef && "ref" in withRef) {
    const { ref: _ref, ...rest } = withRef;
    props = rest;
    // The same props object while nothing else changed, so an update with equal props still bails out.
    if (f.inst && shallowEqual(f.inst.props, rest)) props = f.inst.props;
  }
  const ref = withRef?.ref;
  const ctx = C.contextType ? readContext(f, C.contextType) : undefined;
  // React calls the legacy will-lifecycles only for a class that does not use the newer static ones.
  const legacy = !C.getDerivedStateFromProps && !f.inst?.getSnapshotBeforeUpdate && !C.prototype.getSnapshotBeforeUpdate;
  const call = (name: string, ...args: any[]) => {
    const fn = inst[name] ?? inst["UNSAFE_" + name];
    if (legacy && typeof fn === "function") untrack(() => fn.apply(inst, args));
  };
  /** setState calls queued so far, applied to `state`. */
  const apply = (state: any, nextProps: any) => {
    let force = false;
    for (const u of inst.__queue.splice(0)) {
      if (u === FORCE) force = true;
      else state = { ...state, ...(typeof u === "function" ? u.call(inst, state, nextProps) : u) };
    }
    return [state, force] as const;
  };
  let inst = f.inst;
  const remount = inst?.__remount;
  if (!inst || remount) {
    if (remount) inst.__remount = false;
    else {
      inst = f.inst = new C(props, ctx);
      inst.props = props;
      inst.context = ctx;
      if (inst.state === undefined) inst.state = null;
      inst.__f = f;
      inst.__queue = [];
    }
    if (C.getDerivedStateFromProps) inst.state = { ...inst.state, ...C.getDerivedStateFromProps(props, inst.state) };
    call("componentWillMount");
    // setState in componentWillMount: taken into this first render.
    inst.state = apply(inst.state, props)[0];
    const out = inst.render();
    if (inst.componentDidMount) f.layout!.push(() => !f.dead && lifecycle(f, () => inst.componentDidMount()));
    if (ref != null) f.layout!.push(() => !f.dead && setRef(f, ref, inst));
    (f as any).classRef = ref;
    const done = inst.__done?.splice(0);
    if (done?.length) f.layout!.push(() => done.forEach((cb: any) => cb.call(inst)));
    return out;
  }
  const prevProps = inst.props;
  const prevState = inst.state;
  const prevCtx = inst.context;
  const prevRef = (f as any).classRef;
  if (prevRef !== ref) {
    (f as any).classRef = ref;
    f.layout!.push(() => {
      if (prevRef != null) clearRef(f, prevRef);
      if (ref != null) setRef(f, ref, inst);
    });
  }
  if (prevProps !== props || prevCtx !== ctx) call("componentWillReceiveProps", props, ctx);
  let [state, force] = apply(prevState, props);
  if (C.getDerivedStateFromProps) state = { ...state, ...C.getDerivedStateFromProps(props, state) };
  if (!force && prevProps === props && state === prevState && prevCtx === ctx) return KEEP;
  if (!force && inst.shouldComponentUpdate && !untrack(() => inst.shouldComponentUpdate(props, state, ctx))) {
    inst.props = props;
    inst.state = state;
    inst.context = ctx;
    return KEEP;
  }
  call("componentWillUpdate", props, state, ctx);
  inst.props = props;
  inst.state = state;
  inst.context = ctx;
  const snapshot = inst.getSnapshotBeforeUpdate ? inst.getSnapshotBeforeUpdate(prevProps, prevState) : undefined;
  const out = inst.render();
  if (inst.componentDidUpdate) f.layout!.push(() => !f.dead && lifecycle(f, () => inst.componentDidUpdate(prevProps, prevState, snapshot)));
  const done = inst.__done?.splice(0);
  if (done?.length) f.layout!.push(() => done.forEach((cb: any) => cb.call(inst)));
  return out;
}
const FORCE = Symbol("force");

export class Component<P = any, S = any> {
  props: P;
  state!: S;
  context: any;
  refs = {};
  declare __f: Fiber;
  declare __queue: any[];
  declare __done: any[];
  constructor(props: P, context?: any) {
    this.props = props;
    this.context = context;
  }
  setState(partial: any, done?: () => void) {
    if (!this.__f) {
      this.state = { ...this.state, ...(typeof partial === "function" ? partial(this.state, this.props) : partial) };
      return;
    }
    const apply = () => {
      this.__queue.push(partial);
      scheduledInCommit();
      if (done) (this.__done ??= []).push(done);
      this.__f.tick!.set(this.__f.tick!.peek() + 1);
    };
    const preview = (p: Preview) => {
      const list = p.classes.get(this) ?? [];
      list.push(partial);
      p.classes.set(this, list);
    };
    if (!inTransition(apply, preview, this.__f)) apply();
  }
  forceUpdate(done?: () => void) {
    if (!this.__f) return;
    this.__queue.push(FORCE);
    if (done) (this.__done ??= []).push(done);
    this.__f.tick!.set(this.__f.tick!.peek() + 1);
  }
  render(): any {
    return null;
  }
}
(Component.prototype as any).isReactComponent = {};

export class PureComponent<P = any, S = any> extends Component<P, S> {
  shouldComponentUpdate(props: P, state: S) {
    return !shallowEqual(this.props, props) || !shallowEqual(this.state, state);
  }
}
(PureComponent.prototype as any).isPureReactComponent = true;

/** React's default for an error a boundary caught: told on the console, naming where it came from and who caught it. */
const toldCaught = (from: Fiber, boundary: Fiber) => (error: unknown) => {
  const name = from.kind === COMP ? nameOf(from.type) : null;
  console.error(
    "%o\n\n%s\n\n%s\n",
    error,
    name ? `The above error occurred in the <${name}> component.` : "The above error occurred in one of your React components.",
    `React will try to recreate this component tree from scratch using the error boundary you provided, ${nameOf(boundary.type) || "Anonymous"}.`,
  );
};

/** Something a render threw: a promise suspends the nearest Suspense; an error goes to the nearest boundary. */
function caught(f: Fiber, e: any) {
  if (e && typeof e.then === "function") {
    (f as any).suspended = true;
    // Its boundary is being hydrated: that boundary stays as the server drew it, and is hydrated again later.
    if (hydrating) {
      for (let p = f.parent; p; p = p.parent) {
        if (p.type !== SUSPENSE && !(p.type === ACTIVITY && regions.some((x) => x.fiber === p))) continue;
        const r = regions.find((x) => x.fiber === p);
        // A boundary that already does not match is drawn on the client: there it shows its fallback.
        if (r && !r.mismatch) {
          r.suspended ??= e;
          return;
        }
        break;
      }
    }
    // In a transition, an update keeps what is shown (no fallback) and is drawn again once the data is there.
    if (applyingTransition && f.committed) {
      // React still renders the boundary's fallback, then throws that attempt away: so do we, off the page.
      for (let p = f.parent; p; p = p.parent) {
        if (p.type !== SUSPENSE || p.dead) continue;
        const scratch: Fiber = fiber(FRAG, FRAGMENT, "scratch", null, p);
        try {
          reconcile(scratch, toList(p.props?.fallback), docOf(hostParentOf(f)).createDocumentFragment(), null);
        } catch {}
        for (const c of scratch.children) unmount(c, false);
        break;
      }
      transitionWaits.push(e);
      e.then(() => !f.dead && (restart(f), flushSignals()), () => {});
      return;
    }
    for (let p = f.parent; p; p = p.parent) {
      if (p.type === SUSPENSE && p.pending && !p.dead) {
        const s = p;
        s.pending!.set(s.pending!.peek() + 1);
        // Settled: the boundary shows its children again, and this component (kept, if the children kept
        // their shape) tries again.
        const done = () => {
          s.pending!.set(Math.max(0, s.pending!.peek() - 1));
          if (!f.dead) restart(f);
          flushSignals();
        };
        e.then(done, done);
        return;
      }
    }
    // No boundary while taking over server markup: the server's stays, and hydration is tried again later.
    if (hydrating) {
      hydrationWaits = e;
      return;
    }
    // No boundary: drawn again when it settles.
    e.then(() => !f.dead && (restart(f), flushSignals()), () => {});
    return;
  }
  if (hydrating) {
    const r = regions[regions.length - 1];
    if (r && !r.errored && !r.suspended) {
      r.errored = { error: e };
      return;
    }
    if (!r) {
      hydrationError ??= { error: e };
      return;
    }
  }
  for (let p = f.parent; p; p = p.parent) {
    const inst = p.inst;
    if (inst && !p.dead && (p.type.getDerivedStateFromError || inst.componentDidCatch)) {
      if (p.type.getDerivedStateFromError) inst.__queue.push(p.type.getDerivedStateFromError(e));
      if (inst.componentDidCatch) layoutQueue.push(() => !p.dead && guard(() => inst.componentDidCatch(e, { componentStack: "" })));
      if (rendering) (p.root as any).threw = true;
      const tell = () => (p.root.onCaughtError ?? toldCaught(f, p))(e, { componentStack: "", errorBoundary: inst });
      if (rendering) caughtThisRender.push(() => !p.dead && tell());
      else tell();
      // Rendering now (its draw under way): it renders again when its own render is done, in its error state.
      if (drawing.has(p)) (p as any).redo = true;
      else p.tick!.set(p.tick!.peek() + 1);
      return;
    }
  }
  uncaught(f.root, e);
}

// ---------------------------------------------------------------- effects and commit

// Counted as rendering while it runs: an event it fires (a focus() in a layout effect) does not flush from inside.
function commit() {
  // A concurrent render under way: committed when it is done.
  if (work) return;
  depth++;
  const wasCommitting = committing;
  committing = true;
  try {
    untrack(() => {
      // What was taken away first (componentWillUnmount, effect cleanups, refs let go), then what was made.
      for (let i = 0; i < deletions.length; i++) guard(deletions[i]!);
      deletions.length = 0;
      for (let i = 0; i < insertionQueue.length; i++) guard(insertionQueue[i]!);
      insertionQueue.length = 0;
      const commitTime = now();
      for (let i = 0; i < layoutQueue.length; i++) guard(layoutQueue[i]!);
      layoutQueue.length = 0;
      for (const f of fresh.splice(0)) f.committed = true;
      tellProfilers(commitTime);
    });
  } finally {
    committing = wasCommitting;
    depth--;
  }
  if (passiveQueue.length && !passiveBooked) {
    passiveBooked = true;
    afterPaint(() => runPassive(true));
  }
}

const afterPaint: (fn: () => void) => void =
  typeof MessageChannel !== "undefined"
    ? (fn) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => fn();
        ch.port2.postMessage(null);
      }
    : (fn) => setTimeout(fn, 0);

/** Passive effects run; `drawAfter` when called on its own (not from inside a render), so what they set is drawn. */
/** Updates and effects run until nothing more is pending. */
function settleAll() {
  for (let i = 0; i < 50; i++) {
    flushSignals();
    performWork();
    if (passiveQueue.length) runPassive(true);
    else if (!flushTransitions()) return;
  }
}

/**
 * React's act: runs `fn`, then everything it set off (updates, effects after paint), so a test sees the result.
 * Returns a thenable either way, as React's does; for an async `fn`, settled once it has.
 */
export function act<T>(fn: () => T | Promise<T>): PromiseLike<T> {
  // An error no boundary caught is thrown from act, as React's is (one, or all of them together).
  const errors: unknown[] = [];
  const off = onUncaught((e) => errors.push(e));
  const done = () => {
    off();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors);
  };
  let r: T | Promise<T>;
  try {
    r = fn();
  } catch (e) {
    off();
    throw e;
  }
  if (r && typeof (r as any).then === "function") {
    return (r as Promise<T>).then(
      (v) => {
        try {
          settleAll();
        } finally {
          done();
        }
        return v;
      },
      (e) => {
        off();
        throw e;
      },
    );
  }
  try {
    settleAll();
  } finally {
    done();
  }
  return { then: (ok?: any, no?: any) => Promise.resolve(r as T).then(ok, no) };
}

/** Effects waiting for after paint, run now (React's act does this): for tests and tools. */
export function flushPassiveEffects() {
  if (depth === 0) runPassive(true);
}

function runPassive(drawAfter: boolean) {
  passiveBooked = false;
  if (!passiveQueue.length) return;
  const run = passiveQueue.splice(0);
  untrack(() => run.forEach(guard));
  if (drawAfter) flushSignals();
}

// ---------------------------------------------------------------- hooks

/**
 * A component's state: its value, and a signal that says when it changed. Set by the component while it renders,
 * the same render goes again at once (React's render-phase update); set from anywhere else, the signal tells.
 */
function state(f: Fiber, initial: any) {
  const sig: Sig<number> = signal(0);
  const box: any = {
    v: initial,
    read: () => (sig(), box.v),
    put: (next: any) => {
      if (Object.is(next, box.v)) return;
      box.v = next;
      if (current === f) (f as any).again = true;
      else scheduledInCommit(), sig.set(sig.peek() + 1);
    },
  };
  return box;
}

/** Inside a hook's own function (a useState initializer, a useMemo calculation): a hook called there is warned about
 * and given a value of its own, leaving the component's list of hooks as it is. */
let inHook = 0;
const INVALID_HOOK_CALL = "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.";
export function insideHook<T>(fn: () => T): T {
  inHook++;
  try {
    return fn();
  } finally {
    inHook--;
  }
}

function hook<T>(make: () => T): T {
  const f = current;
  // Outside a function component's render (none, or a class's): React's error.
  if (!f || f.inst) throw new Error(INVALID_HOOK_CALL);
  if (inHook) {
    warn("Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. You can only call Hooks at the top level of your React function. For more information, see https://react.dev/link/rules-of-hooks");
    return make();
  }
  const hooks = f.hooks!;
  const i = hookAt++;
  if (i >= hooks.length) hooks.push(insideHook(make));
  return hooks[i];
}

export const depsChanged = (a: any[] | undefined, b: any[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

export const client = {
  useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
    const f = current!;
    const h = hook(() => {
      const box = state(f, typeof init === "function" ? (init as () => T)() : init);
      box.set = (v: any) => {
        const apply = () => box.put(typeof v === "function" ? v(box.v) : v);
        const preview = (p: Preview) => {
          const was = p.states.has(box) ? p.states.get(box) : box.v;
          p.states.set(box, typeof v === "function" ? v(was) : v);
        };
        if (current === f || !inTransition(apply, preview, f)) apply();
      };
      return box;
    });
    return [h.read(), h.set];
  },
  useReducer(reducer: any, arg: any, init?: any) {
    const f = current!;
    const h = hook(() => {
      const box = state(f, init ? init(arg) : arg);
      box.reducer = reducer;
      box.dispatch = (a: any) => {
        const apply = () => box.put(box.reducer(box.v, a));
        const preview = (p: Preview) => p.states.set(box, box.reducer(p.states.has(box) ? p.states.get(box) : box.v, a));
        if (current === f || !inTransition(apply, preview, f)) apply();
      };
      return box;
    });
    h.reducer = reducer;
    return [h.read(), h.dispatch];
  },
  useRef<T>(init: T) {
    return hook(() => ({ current: init }));
  },
  useMemo<T>(fn: () => T, deps?: any[]): T {
    const h = hook(() => ({ deps: undefined as any, value: undefined as any }));
    if (!deps || depsChanged(h.deps, deps)) {
      h.value = insideHook(fn);
      h.deps = deps;
    }
    return h.value;
  },
  useCallback<T>(fn: T, deps?: any[]): T {
    return client.useMemo(() => fn, deps);
  },
  useEffect(create: () => any, deps?: any[]) {
    effectHook(create, deps, "passive");
  },
  useLayoutEffect(create: () => any, deps?: any[]) {
    effectHook(create, deps, "layout");
  },
  useInsertionEffect(create: () => any, deps?: any[]) {
    effectHook(create, deps, "insertion");
  },
  useImperativeHandle(ref: any, create: () => any, deps?: any[]) {
    effectHook(
      () => {
        if (typeof ref === "function") {
          ref(create());
          return () => ref(null);
        }
        if (ref) {
          ref.current = create();
          return () => (ref.current = null);
        }
      },
      deps ? [...deps, ref] : undefined,
      "layout",
    );
  },
  useContext(ctx: any) {
    return readContext(current!, ctx);
  },
  useId() {
    const f = current!;
    return hook(() => `_r_${(f.root.ids++).toString(32)}_`);
  },
  useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T {
    const h = hook(() => {
      const box = { v: signal(0) as Sig<number>, get: getSnapshot, value: undefined as any, warned: false, check: () => {} };
      // A store whose snapshot differs from what was shown (or whose getSnapshot throws): drawn again, where the
      // error, if any, reaches the boundary.
      box.check = () => {
        let same = false;
        try {
          same = Object.is(box.get(), box.value);
        } catch {}
        if (!same) box.v.set(box.v.peek() + 1);
      };
      return box;
    });
    h.v();
    // Taking over server markup: the server's snapshot first, the client's after (as React does).
    if (isHydrating() && !getServerSnapshot) {
      throw new Error("Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.");
    }
    const value = isHydrating() ? getServerSnapshot!() : getSnapshot();
    if (dev() && !h.warned && !isHydrating() && !Object.is(value, getSnapshot())) {
      h.warned = true;
      console.error("The result of getSnapshot should be cached to avoid an infinite loop");
    }
    // The newest getSnapshot and what this render showed: a change in the store re-renders only when what this
    // component reads from it is different (a store updated for others leaves it alone).
    h.get = getSnapshot;
    h.value = value;
    effectHook(() => subscribe(h.check), [subscribe], "layout");
    // After each commit: changed between render and commit (or never stable), drawn again.
    effectHook(() => h.check(), undefined, "layout");
    return value;
  },
  useTransition(): [boolean, (fn: () => any) => void] {
    const h = hook(() => {
      const p: Sig<number> = signal(0);
      return { p, start: (fn: () => any) => startTransitionWith(fn, p) };
    });
    return [h.p() > 0, h.start];
  },
  useDeferredValue<T>(value: T, initial?: T) {
    // The value shown so far in an urgent render, the new one drawn after as a transition (React's deferred lane).
    const f = current!;
    const h = hook(() => {
      const box = state(f, initial !== undefined ? initial : value);
      box.mounted = initial === undefined;
      return box;
    });
    const shown = h.read();
    if (Object.is(value, shown) || applyingTransition) {
      if (!Object.is(value, shown)) h.v = value;
      return value;
    }
    h.wanted = value;
    if (!h.booked) {
      h.booked = true;
      deferTransition(() => {
        h.booked = false;
        h.put(h.wanted);
      });
    }
    return shown;
  },
  useDebugValue() {},
  useActionState(action: (state: any, payload: any) => any, initial: any) {
    const h = hook(() => {
      const box: any = { v: initial, changed: signal(0), going: signal(0), queue: [] as any[], running: false, error: undefined, action };
      const bump = () => box.changed.set(box.changed.peek() + 1);
      const next = () => {
        box.going.set(box.going.peek() - 1);
        if (box.queue.length) run();
        else box.running = false;
        flushSignals();
      };
      const fail = (e: unknown) => {
        // Thrown where the state is read, so the component's boundary gets it (React's behaviour).
        box.error = e;
        box.going.set(0);
        box.current?.done();
        for (const q of box.queue.splice(0)) q.done();
        box.running = false;
        bump();
        flushSignals();
      };
      // One after another, each with the state the last one left; the first one at once.
      const run = () => {
        box.running = true;
        const entry = (box.current = box.queue.shift());
        let r: any;
        try {
          r = box.action(box.v, entry.payload);
        } catch (e) {
          return fail(e);
        }
        const take = (v: any) => {
          if (!Object.is(v, box.v)) (box.v = v), bump();
          box.current = null;
          entry.done();
          next();
        };
        if (r && typeof r.then === "function") r.then(take, fail);
        else take(r);
      };
      // Settles once this action has run: a form whose action this is stays pending until then.
      box.dispatch = (payload: any) => {
        let done!: () => void;
        const settled = new Promise<void>((r) => (done = r));
        box.going.set(box.going.peek() + 1);
        box.queue.push({ payload, done });
        if (!box.running) run();
        return settled;
      };
      return box;
    });
    h.action = action;
    h.changed();
    if (h.error !== undefined) {
      const e = h.error;
      h.error = undefined;
      throw e;
    }
    return [h.v, h.dispatch, h.going() > 0];
  },
  useOptimistic(state: any, change?: (s: any, a: any) => any) {
    const h = hook(() => ({ base: state, list: signal([]) as Sig<any[]> }));
    if (!Object.is(h.base, state)) {
      h.base = state;
      if (h.list.peek().length) h.list = signal([]);
    }
    const list = h.list;
    const shown = list().reduce((s: any, a: any) => (change ? change(s, a) : a), state);
    return [shown, (a: any) => list.set([...list.peek(), a])];
  },
  useEffectEvent<T extends (...a: any[]) => any>(fn: T): T {
    const h = hook(() => {
      const box: any = { fn };
      box.call = (...a: any[]) => box.fn(...a);
      return box;
    });
    h.fn = fn;
    return h.call;
  },
  use(usable: any) {
    if (usable && usable.$$typeof === CONTEXT) return readContext(current!, usable);
    return readThenable(usable);
  },
};

function effectHook(create: () => any, deps: any[] | undefined, phase: "insertion" | "layout" | "passive") {
  const f = current!;
  const h = hook(() => ({ deps: undefined as any, cleanup: null as any, first: true }));
  // Compared with the deps of the effect that ran: a render that never committed (a render-phase pass) sets none.
  if (!h.first && deps && !depsChanged(h.deps, deps)) return;
  f[phase]!.push(() => {
    if (f.dead) return;
    h.first = false;
    h.deps = deps;
    try {
      if (typeof h.cleanup === "function") h.cleanup();
      const back = create();
      h.cleanup = typeof back === "function" ? back : null;
    } catch (e) {
      caught(f, e);
    }
  });
}

// ---------------------------------------------------------------- transitions

/** Inside startTransition: the updates set are a transition's, drawn after what is urgent. */
let transitioning = 0;
type TransitionUpdate = { apply: () => void; preview?: (p: Preview) => void; fiber?: Fiber };
const transitionWork: TransitionUpdate[] = [];
let transitionBooked = false;
/** A transition's updates being drawn now. */
let applyingTransition = false;
/** Whether a Suspense boundary is around `f`. */
const suspenseAbove = (f: Fiber) => {
  for (let p = f.parent; p; p = p.parent) if (p.type === SUSPENSE) return true;
  return false;
};
/** An update of a transition: applied once the urgent updates set with it have been drawn. */
export function inTransition(apply: () => void, preview?: (p: Preview) => void, fiber?: Fiber): boolean {
  if (!transitioning) return false;
  deferTransition(apply, preview, fiber);
  return true;
}
function deferTransition(apply: () => void, preview?: (p: Preview) => void, fiber?: Fiber) {
  transitionWork.push({ apply, preview, fiber });
  if (transitionBooked) return;
  transitionBooked = true;
  scheduleTransitions(flushTransitions);
}

/** When a transition's updates are drawn: in a task of their own, after what is urgent has been painted (as React's
 * scheduler runs the transition lane); a test's scheduler can take this over. */
let scheduleTransitions: (run: () => void) => void = (run) => {
  if (typeof MessageChannel === "function") {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => run();
    ch.port2.postMessage(null);
  } else setTimeout(run, 0);
};
export function setTransitionScheduler(fn: typeof scheduleTransitions) {
  scheduleTransitions = fn;
}

/** What ends a transition (isPending going false, a form's status reset): only once it has rendered without
 * suspending, as React holds the whole transition until its data is there. */
const transitionEnds: (() => void)[] = [];
/** What the transition being drawn suspended on. */
const transitionWaits: PromiseLike<any>[] = [];
function endTransition(fn: () => void) {
  transitionEnds.push(fn);
  if (transitionBooked) return;
  transitionBooked = true;
  scheduleTransitions(flushTransitions);
}

/** The transitions waiting, drawn now (act does, as React's act flushes every lane): whether there were any. */
/** Whether rendering `f` again could suspend where a transition is held: a Suspense on the page below it, or a
 * component below it that has suspended before. */
function mightSuspend(f: Fiber): boolean {
  if ((f as any).suspended) return true;
  if (f.type === SUSPENSE) return true;
  return f.children.some(mightSuspend);
}

/** What a held transition waits for: it is not tried again before that settles. */
let transitionHeld: PromiseLike<any> | null = null;
let transitionRetried = false;

export function flushTransitions(): boolean {
  transitionBooked = false;
  if (!transitionWork.length && !transitionEnds.length) return false;
  if (transitionHeld) return false;
  // Tried first, off the page: what suspends holds the whole transition, the screen and state as they are.
  const previewed = transitionWork.filter((w) => w.preview && w.fiber && !w.fiber.dead);
  // Only where it can be held (a boundary on the page below, or something that has suspended there): a dry run
  // costs a second render.
  const retried = transitionRetried;
  transitionRetried = false;
  if (!retried && previewed.length && previewed.some((w) => mightSuspend(w.fiber!))) {
    const preview: Preview = { states: new Map(), classes: new Map() };
    for (const w of previewed) w.preview!(preview);
    const waits = tryTransition(previewed.map((w) => w.fiber!), preview);
    if (waits) {
      transitionHeld = waits;
      const retry = () => {
        transitionHeld = null;
        // Its data is there: drawn once now, as React renders the retry (the screen is kept if it suspends again).
        transitionRetried = true;
        if (!transitionBooked) (transitionBooked = true), scheduleTransitions(flushTransitions);
      };
      waits.then(retry, retry);
      return true;
    }
  }
  applyingTransition = true;
  try {
    for (const w of transitionWork.splice(0)) w.apply();
    flushSignals();
    if (transitionWaits.length) {
      // Suspended: its end waits for the data, then the transition is drawn again.
      const waits = transitionWaits.splice(0);
      let left = waits.length;
      const settled = () => {
        if (--left) return;
        if (!transitionBooked && transitionEnds.length) (transitionBooked = true), scheduleTransitions(flushTransitions);
      };
      for (const p of waits) p.then(settled, settled);
      return true;
    }
    for (const w of transitionEnds.splice(0)) w();
    flushSignals();
  } finally {
    applyingTransition = false;
  }
  return true;
}

function startTransitionWith(fn: () => any, pending?: Sig<number>) {
  // Pending at once, as an urgent update; no longer pending with the transition's own updates (or when its action
  // settles, for an async one).
  if (pending) pending.set(pending.peek() + 1);
  transitioning++;
  let r: any;
  try {
    r = fn();
  } finally {
    transitioning--;
  }
  if (!pending) return;
  const done = () => endTransition(() => pending.set(pending.peek() - 1));
  if (r && typeof r.then === "function") r.then(done, done);
  else done();
}
export const startTransition = (fn: () => any) => startTransitionWith(fn);


export function readContext(f: Fiber, ctx: any) {
  for (let p = f.parent; p; p = p.parent) if (p.kind === PROVIDER && p.type === ctx) return p.value!();
  return ctx._defaultValue;
}

// ---------------------------------------------------------------- roots

/** What React accepts as a root's container: an element, a document, a fragment, or its mount-point comment. */
const validContainer = (n: any) =>
  !!n && (n.nodeType === 1 || n.nodeType === 9 || n.nodeType === 11 || (n.nodeType === 8 && n.nodeValue === " react-mount-point-unstable "));
const HYDRATE = Symbol("hydrate");

export function createRoot(container: Element | DocumentFragment, options?: any) {
  if (!validContainer(container)) throw new Error("Target container is not a DOM element.");
  const hydrating_ = !!options?.[HYDRATE];
  if (dev()) {
    if ((container as any).__root) {
      console.error("You are calling ReactDOMClient.createRoot() on a container that has already been passed to createRoot() before. Instead, call root.render() on the existing root instead if you want to update it.");
    }
    if (!hydrating_ && options?.hydrate) console.warn("hydrate through createRoot is deprecated. Use ReactDOMClient.hydrateRoot(container, <App />) instead.");
    else if (options && typeof options === "object" && options.$$typeof === Symbol.for("react.transitional.element")) {
      console.error("You passed a JSX element to createRoot. You probably meant to call root.render instead. Example usage:\n\n  let root = createRoot(domContainer);\n  root.render(<App />);");
    }
  }
  (container as any).__root = true;
  rootContainers.add(container);
  let unmounted = false;
  const state: RootState = { ids: 0, container };
  const top: Fiber = { kind: ROOT, type: null, key: "", props: null, parent: null, children: [], dom: container, ns: nsOf(container), root: state };
  addContainer(container, state);
  state.top = top;
  state.onUncaughtError = options?.onUncaughtError;
  state.onCaughtError = options?.onCaughtError;
  (state as any).onRecoverable = options?.onRecoverableError;
  let first = true;
  // Renders of this root started while it is already rendering or committing (componentDidMount rendering the
  // root again): past React's limit it is a loop, thrown as React throws it.
  let nested = 0;
  // What render() was last given and not drawn yet: drawn by the root's effect, as an update is (on the next
  // microtask, or at once in flushSync and act), so render() schedules work as React's root.render does.
  const NONE = {};
  let pending: any = NONE;
  let pendingInTransition = false;
  // What render() was given last: what a hydration that waited tries again with.
  let latest: any = NONE;
  const asked = signal(0);
  // A hydration still to do comes first, on its own: an update given meanwhile is drawn after it.
  let hydrateFirst: any = NONE;
  effect(() => {
    asked();
    if (pending !== NONE && pendingInTransition && hydrateFirst === NONE && first && !hydrating_ && !top.children.length && !work && depth === 0 && !syncing) {
      const children = pending;
      pending = NONE;
      untrack(() => runWithOwner(null, () => renderConcurrently(children)));
      return;
    }
    if (hydrateFirst !== NONE) {
      const children = hydrateFirst;
      hydrateFirst = NONE;
      untrack(() => runWithOwner(null, () => renderNow(children)));
    }
    if (pending === NONE) return;
    const children = pending;
    pending = NONE;
    untrack(() => runWithOwner(null, () => renderNow(children)));
  });
  /** The first render, off the page and able to stop between components (see the work loop). */
  function renderConcurrently(children: any) {
    first = false;
    const frag = docOf(container).createDocumentFragment();
    const finish = () => {
      top.dom = container;
      (container as Element).replaceChildren?.();
      container.appendChild(frag);
      commit();
      flushSignals();
    };
    work = { units: [], at: 0, deferring: true, finish };
    top.dom = frag;
    depth++;
    rendering = true;
    startRender();
    try {
      reconcile(top, [children], frag, null);
    } catch (e) {
      uncaught(state, e);
    } finally {
      rendering = false;
      depth--;
      if (work) work.deferring = false;
    }
    scheduleWork(() => performWork());
  }
  function renderNow(children: any) {
      if (depth > 0) {
        if (++nested > LIMIT) {
          nested = 0;
          throw new Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.");
        }
        if (nested === 1) queueMicrotask(() => (nested = 0));
      }
      const hydrate = first && hydrating_;
      if (first) {
        first = false;
        if (!hydrate) {
          if (container.nodeType === 9 || (container as Element).localName === "html") clearSparingly(container);
          else (container as Element).replaceChildren?.();
        }
      }
      depth++;
      if (hydrate) (hydrating = new Map()), (mismatched = false), (attrsDiffer = false), (madeWhileHydrating = []), (hydrationWaits = null), (hydrationError = null);
      const wasRendering = rendering;
      rendering = true;
      if (depth === 1) startRender();
      // What the root's own elements throw (no component between): uncaught, as React has it.
      const draw = () => {
        try {
          reconcile(top, [children], container, null);
        } catch (e) {
          uncaught(state, e);
        }
      };
      try {
        draw();
        // An error thrown while rendering, caught by a boundary: React renders once more before committing (the
        // render may have raced with something that has settled). Here on a first render, where nothing committed.
        if ((state as any).threw && !hydrate && top.children.every((c) => !c.committed)) {
          (state as any).threw = false;
          caughtThisRender.length = 0;
          for (const c of top.children) unmount(c, true);
          top.children = [];
          draw();
        }
        (state as any).threw = false;
        for (const tell of caughtThisRender.splice(0)) tell();
        if (hydrate && hydrationError) {
          // Thrown while hydrating, outside any boundary: the root drawn on the client, the error its cause.
          const cause = hydrationError.error;
          hydrationError = null;
          mismatched = false;
          attrsDiffer = false;
          for (const c of top.children) unmount(c, false);
          top.children = [];
          hydrating = null;
          (container as Element).replaceChildren?.();
          const error: any = new Error("There was an error while hydrating but React was able to recover by instead client rendering the entire root.");
          error.cause = cause;
          // Told only if the root then renders without an error of its own (React reports it with the commit).
          (state as any).failed = false;
          draw();
          if (!(state as any).failed) layoutQueue.push(() => (options?.onRecoverableError ?? report)(error, { componentStack: "" }));
        } else if (hydrate && hydrationWaits) {
          // Suspended with no boundary: nothing of this attempt is kept, the server's markup stays as it was.
          const waits = hydrationWaits;
          hydrationWaits = null;
          mismatched = false;
          attrsDiffer = false;
          for (const n of madeWhileHydrating.splice(0)) n.parentNode?.removeChild(n);
          for (const c of top.children) unmount(c, false);
          top.children = [];
          first = true;
          const again = () => ((hydrateFirst = latest), (pending = NONE), asked.set(asked.peek() + 1), flushSignals());
          waits.then(again, again);
        } else if (hydrate) dropUnclaimed(container);
      } finally {
        rendering = wasRendering;
        if (hydrate) {
          hydrating = null;
          // Attributes are told only where the markup matched: a mismatch draws the whole root anew.
          if (attrsDiffer && !mismatched) console.error(HYDRATION_ATTRS);
          if (mismatched) {
            mismatched = false;
            const recover = options?.onRecoverableError ?? report;
            recover(new Error((mismatchedText ? "Hydration failed because the server rendered text didn't match the client." : "Hydration failed because the server rendered HTML didn't match the client.") + " As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\nhttps://react.dev/link/hydration-mismatch"), { componentStack: "" });
          }
        }
        if (--depth === 0) commit();
      }
      // Called from inside a render or commit (a root made in componentDidMount): flushed when that one ends.
      if (depth === 0) flushSignals();
  }
  return {
    render(children: any, ...rest: any[]) {
      if (unmounted) throw new Error("Cannot update an unmounted root.");
      if (dev()) {
        if (typeof rest[0] === "function") console.error("does not support the second callback argument. To execute a side effect after rendering, declare it in a component body with useEffect().");
        else if (validContainer(rest[0])) console.error("You passed a container to the second argument of root.render(...). You don't need to pass it again since you already passed it to create the root.");
        else if (rest.length && rest[0] !== undefined) console.error("You passed a second argument to root.render(...) but it only accepts one argument.");
      }
      // Inside a render or a commit (a root made in componentDidMount): drawn with it, as before.
      latest = children;
      // Given in a transition: a first render that can stop between components (the work loop).
      pendingInTransition = transitioning > 0;
      if (depth > 0) return renderNow(children);
      if (first && hydrating_ && hydrateFirst === NONE && pending === NONE) hydrateFirst = children;
      else pending = children;
      asked.set(asked.peek() + 1);
    },
    unmount(...rest: any[]) {
      if (dev() && typeof rest[0] === "function") console.error("does not support a callback argument. To execute a side effect after rendering, declare it in a component body with useEffect().");
      if (unmounted) return;
      if (dev() && depth > 0) console.error("Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.");
      unmounted = true;
      (container as any).__root = false;
      pending = NONE;
      for (const c of top.children) unmount(c, true);
      top.children = [];
    },
  };
}

/** Taken over as the server drew it: its nodes claimed in order and kept, what differs drawn anew. */
export function hydrateRoot(container: Element, children: any, options?: any) {
  if (!validContainer(container)) throw new Error("Target container is not a DOM element.");
  if (dev() && children === undefined) console.error("Must provide initial children as second argument to hydrateRoot. Example usage: hydrateRoot(domContainer, <App />)");
  const root = createRoot(container, { ...options, [HYDRATE]: true });
  root.render(children);
  return root;
}

// ---------------------------------------------------------------- form actions

const IDLE_FORM = Object.freeze({ pending: false, data: null, method: null, action: null });

/** A form's status, kept on its fiber: what useFormStatus reads below it. */
const formStatus = (f: Fiber): Sig<any> => ((f as any).formStatus ??= signal(IDLE_FORM));

/**
 * A form submitted to a function (React 19's form actions): its status pending while the action runs, the form
 * reset once it is done, an error handed to the nearest boundary.
 */
export function submitForm(form: HTMLFormElement, act: (data: FormData) => any, data: FormData, submitter?: HTMLElement | null) {
  const f: Fiber | undefined = (form as any).__fiber;
  const status = f ? formStatus(f) : null;
  const method = ((submitter as any)?.getAttribute?.("formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase();
  status?.set({ pending: true, data, method, action: act });
  flushSignals();
  // Done: no longer pending, with the action's own updates (a transition's), and the form reset.
  const settle = (error?: unknown, failed = false) => {
    endTransition(() => {
      status?.set(IDLE_FORM);
      if (failed) f ? caught(f, error) : report(error);
      else form.reset();
    });
  };
  let r: any;
  // The action runs as a transition, as React wraps it in one.
  transitioning++;
  try {
    r = act(data);
  } catch (e) {
    return settle(e, true);
  } finally {
    transitioning--;
  }
  if (r && typeof r.then === "function") r.then(() => settle(), (e: unknown) => settle(e, true));
  else settle();
}

/** The status of the form around the component rendering now (React DOM's useFormStatus). */
export function useFormStatus() {
  for (let p = current?.parent ?? null; p; p = p.parent) {
    if (p.kind !== HOST || p.type !== "form") continue;
    const status = formStatus(p)();
    // Pending is optimistic, as React's: shown by urgent renders, already over in the transition's own render.
    return applyingTransition ? IDLE_FORM : status;
  }
  return IDLE_FORM;
}

/** Inside flushSync: a root's render is drawn at once, not as a concurrent render. */
let syncing = false;
export function flushSync<T>(fn?: () => T): T {
  const was = syncing;
  syncing = true;
  try {
    const r = fn ? fn() : (undefined as T);
    if (depth === 0) flushSignals();
    performWork();
    return r;
  } finally {
    syncing = was;
  }
}

// After a handler: what it changed drawn now (React draws a discrete event's updates before the next one), and a
// controlled field put back to what its state says when the handler did not take what was typed.
onAfterEvent((el, e) => {
  if (depth > 0) return;
  flushSignals();
  // Only once the field's own change has been told: a checkbox's click comes before its change, and putting it
  // back then would undo the toggle the change is about to report.
  if (e.type !== eventOf(el, "onChange")[0]) return;
  if (FORM_TAGS.has(el.localName)) restoreForm(el);
});

/** The DOM node a class component instance (or an element) draws first: React's findDOMNode. */
export function findDOMNode(x: any): Node | null {
  if (x == null) return null;
  if (typeof x.nodeType === "number") return x;
  const f: Fiber | undefined = x.__f;
  if (!f) throw new Error("Argument appears to not be a ReactComponent.");
  return firstDom(f);
}

export const version = "19.3.0";
export { ELEMENT };

// Which component is rendering, for "Check the render method of `X`." in warnings.
setOwner(() => (current ? nameOf(current.type) : null));

// A form's action runs through submitForm (its status, its reset, its boundary).
onSubmitAction(submitForm);

/** Whether the root rendering now is taking over server markup (hydrateRoot's first render). */
export const isHydrating = () => hydrating !== null;
