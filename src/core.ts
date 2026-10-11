// The runtime: React's API on Sluurp's signals. Each component renders inside a signals effect, so what it reads
// (its state, a context, any signal) re-renders it alone. A parent re-renders a child only when the child's props
// changed (shallowly); nothing cascades past that. Rendering is synchronous: no time slicing, no lanes.
import { effect, flush as flushSignals, holdFlushes, runWithOwner, signal, untrack } from "../../signals/index.js";
import { ACTIVITY, VIEW_TRANSITION, CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, PROFILER, STRICT, SUSPENSE, SUSPENSE_LIST, createElement, invalidType, objectChild, ownerNow, readLazy, readThenable, setOwnerSource, unwrapChild } from "./element.ts";
import { inOrder } from "./shared/in-order.ts";
import { DiffScope, describeDiff, describeServerNode, firstDiffFiber, propName, styleObject } from "./hydration-diff.ts";
import { MATH_NS, SVG_NS, styleText, eventOf, hydrateProps, noop, onAfterEvent, onSubmitAction, setDefaults, setProps, unbindProps } from "./props.ts";
import { reportHandlerErrorsWith } from "./events.ts";
import { CONTINUOUS, DEHYDRATED, ENTERING, addContainer, countDehydrated, countTransitionsWith, hydrateBeforeEvents, kindOf, listenOnElement, replayQueued, replaysWaiting, want } from "./events.ts";
import { configureViewTransitions, renderInViewTransition, resetViewTransitions, viewTransitionUnmounted, viewTransitionsBegin, viewTransitionsCommit } from "./view-transition.ts";
import { FragmentInstance, fragmentsAbove } from "./fragment-ref.ts";
import { checkClassInstance, checkDerivedState, checkShouldUpdate, checkSnapshot, flushUnsafeLifecycleWarnings, recordUnsafeLifecycles } from "./class-checks.ts";
import { FORM_TAGS, initForm, restoreForm, updateForm } from "./forms.ts";
import { type Ancestors, ancestorsWith, checkNesting, checkTextNesting } from "./nesting.ts";
import { type Preview, tryTransition } from "./dryrun.ts";
import { checkKeys, checkTag, dev, duplicateKey, muteWarnings, setOwner, shown, warn, FIBER, PROPS, ROOT_FIBER } from "./warnings.ts";
import { assertValidProps, checkTagName, customTag, inertEmpty } from "./attributes.ts";
import { getOffsets, setOffsets } from "./dom-selection.ts";
import { type TreeContext, ROOT_TREE, makeId, pushTree } from "./tree-id.ts";
import { HOISTABLE, type CommitWait, type Resource, acquireResource, claimHoistable, commitWhenReady, getResource, hoistableRoot, isHoistable, markHoistable, mountHoistable, newCommitWait, suspendResource } from "./float-client.ts";

type Sig<T = any> = { (): T; set(v: T): void; peek(): T };

const TEXT = 1, HOST = 2, COMP = 3, FRAG = 4, PROVIDER = 5, PORTAL_F = 6, ROOT = 7;
/** A <title>, <meta> or <link> kept in <head>, or a shared resource (stylesheet, <style>, async script): not in its place. */
const HOIST = 8;
const RECOVERABLE = Symbol.for("react.recoverable");
/** A useActionState whose action threw: its state signal moved to one of these, so the component renders to throw. */
const FAILED = Symbol("failed"), FAILED_AGAIN = Symbol("failed again");

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
  placed?: boolean;
  strict?: boolean;
  again?: boolean;
  draws?: number;
  tree?: TreeContext;
  unbind?: () => void;
  doc?: Document;
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

/** The last error an error boundary caught (a hydration error caught again on the client is the boundary's). */
let lastCaughtByBoundary: unknown = null;
/** An error nothing caught: the root is taken down (React unmounts it), and the error told. */
/**
 * React's component stack for what happened at `f`: a frame for it and each component and element above it
 * ("\n    in Name"), as errorInfo.componentStack gives it.
 */
export function componentStackOf(f: Fiber | null | undefined): string {
  let out = "";
  for (let p = f ?? null; p; p = p.parent) {
    let name: string | null = null;
    let component = false;
    if (p.kind === HOST || p.kind === HOIST) name = p.type;
    else if (p.kind === COMP) {
      const t = p.type;
      component = typeof t === "function" || !!t?.render || (!!t?.type && t.$$typeof !== LAZY);
      name =
        t === SUSPENSE ? "Suspense" : t === ACTIVITY ? "Activity" : t === SUSPENSE_LIST ? "SuspenseList" : t?.$$typeof === LAZY ? "Lazy" : component ? nameOf(t) : null;
    }
    // A component's frame has a place in source, as a stack frame does; a built-in one (an element) has none.
    if (name) out += component ? `\n    in ${name} (at ${name}.js:1:1)` : `\n    in ${name}`;
  }
  return out;
}

function uncaught(root: RootState, e: unknown, at?: Fiber | null) {
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
    try {
      tellNow();
    } catch (x) {
      // What telling it threw (a broken console.error, a handler that throws): thrown on its own later, so React
      // goes on (React's logUncaughtError).
      setTimeout(() => {
        throw x;
      });
    }
  };
  const tellNow = () => {
    // The root's own handler takes it; only React's default (reporting it) is what act rethrows.
    if (root.onUncaughtError) root.onUncaughtError(e, { componentStack: componentStackOf(at) });
    else {
      if (uncaughtListener) uncaughtListener(e);
      else report(e);
      // React's default adds, in development, which component it was and what would have caught it (not under act,
      // which collects the error and throws it instead).
      if (dev() && !uncaughtListener) {
        const name = at && typeof at.type !== "string" && typeof at.type !== "symbol" ? nameOf(at.type) : null;
        console.warn(
          "%s\n\n%s\n",
          name ? `An error occurred in the <${name}> component.` : "An error occurred in one of your React components.",
          "Consider adding an error boundary to your tree to customize error handling behavior.\nVisit https://react.dev/link/error-boundaries to learn more about error boundaries.",
        );
      }
    }
  };
  // In a root's render: rendered once more first (as React does), and told after, once.
  if (rendering) {
    (root as any).threw = true;
    caughtThisRender.push(tell);
  } else tell();
}

let current: Fiber | null = null;
/** What libraries find on React's internals: H the hooks (set by api.ts), A the async dispatcher while rendering. */
export const internals: { H: any; A: any; T: any; S: any } = { H: null, A: null, T: null, S: null };
const asyncDispatcher: any = { getCacheForType: (make: () => any) => make() };
if (dev()) asyncDispatcher.getOwner = () => current;
/** React's warning for a setState or forceUpdate callback that is no function (once per value). */
function warnOnInvalidCallback(cb: any) {
  if (dev() && cb != null && typeof cb !== "function") warn(`Expected the last optional \`callback\` argument to be a function. Instead received: ${shown(cb)}.`, "invalid-callback:" + shown(cb));
}
/** A setState or forceUpdate callback run in the commit: React's error when it is no function. */
function callCallback(cb: any, inst: any) {
  if (typeof cb !== "function") throw new Error("Invalid argument passed as callback. Expected a function. Instead received: " + cb);
  cb.call(inst);
}
/** An update that replaces a class's state (this.state assigned where React makes it a replaceState). */
const REPLACE = Symbol("replace state");
/** A class's context when it has no (valid) contextType, as React gives it. */
const EMPTY_CONTEXT = Object.freeze({});
/** The component that rendered the element being made now (a form field's warnings name it). */
let hostOwner: Fiber | null = null;
setOwnerSource(() => current);
let hookAt = 0;

/** The fiber an error or warning is told for (React's runWithFiberInDEV): captureOwnerStack starts from it. */
let toldFor: Fiber | null = null;
export function withFiber<T>(f: Fiber | null, fn: () => T): T {
  const was = toldFor;
  toldFor = f;
  try {
    return fn();
  } finally {
    toldFor = was;
  }
}
const BUILT_IN = new Set<any>([SUSPENSE, SUSPENSE_LIST, ACTIVITY]);
/** React.captureOwnerStack: the fiber told for (or rendering), then the components that rendered it, one frame each. */
export function captureOwnerStack(): string | null {
  if (!dev()) return null;
  let f = toldFor ?? current;
  if (!f) {
    // A server render's component: the components that rendered it.
    const o = ownerNow();
    if (!o) return null;
    let out = "";
    for (let p = o.owner; p; p = p.owner) out += "\n    at " + nameOf(p.type) + " (<anonymous>)";
    return out;
  }
  if (f.kind === TEXT && f.parent) f = f.parent;
  const frame = (name: string) => "\n    at " + name + " (<anonymous>)";
  let out = "";
  if (f.kind === HOST || f.kind === HOIST) out += frame(f.type);
  else if (BUILT_IN.has(f.type)) out += frame(f.type === SUSPENSE ? "Suspense" : f.type === ACTIVITY ? "Activity" : "SuspenseList");
  for (let o = (f as any).owner as Fiber | null; o; o = (o as any).owner) out += frame(nameOf(o.type));
  return out;
}
let depth = 0;
// Phases, as React's commit has them: insertion effects first (before any ref or layout effect: a ref may call
// what one set up), then refs and layout effects, then passive effects after paint.
const insertionQueue: (() => void)[] = [];
const layoutQueue: (() => void)[] = [];
const passiveQueue: (() => void)[] = [];
/** Passive cleanups of what was taken away: run before any passive effect, as React runs them. */
const passiveUnmounts: (() => void)[] = [];
let passiveBooked = false;

reportHandlerErrorsWith((e) => report(e));
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
  if (typeof at !== "function") return null;
  // React's warnings, once: an iterator is used up by reading it; a Map's entries are pairs, not children.
  if (dev()) {
    if (at.call(c) === c)
      warn("Using Iterators as children is unsupported and will likely yield unexpected results because enumerating a generator mutates it. You may convert it to an array with `Array.from()` or the `[...spread]` operator before rendering. You can also use an Iterable that can iterate multiple times over the same items.", "iterator-child");
    else if (c.entries === at) warn("Using Maps as children is not supported. Use an array of keyed ReactElements instead.", "map-child");
  }
  return [...{ [Symbol.iterator]: () => at.call(c) }];
}

/** What a component or element gives as children, as a list: arrays nest as fragments, text as text. */
/** A list made of one child that was not an array (no fork in the tree, React's). */
const LONE = Symbol("lone");
function toList(children: any): any[] {
  if (children == null || typeof children === "boolean") return [];
  if (Array.isArray(children)) return children;
  const items = iterated(children);
  // (An iterable's items are a list: keys checked, as an array's are.)
  if (items) return checkKeys(items, null), items;
  const one: any = [children];
  one[LONE] = true;
  return one;
}

/** A value a bound text node shows (text, a number, or nothing); anything else is drawn as a child is. */
const textValue = (v: any) => v == null || typeof v === "string" || typeof v === "number" || typeof v === "bigint" || typeof v === "boolean";
const textOf = (v: any) => (v == null || typeof v === "boolean" ? "" : "" + v);

/**
 * A text node kept equal to a signal by an effect of its own: a change sets its data, nothing renders. A value that is
 * no longer text draws its component again (which then reads it as a child).
 */
function bindText(f: Fiber, sig: () => any) {
  (f as any).unbind = runWithOwner(null, () =>
    effect(() => {
      const v = sig();
      if (f.dead) return;
      if (!textValue(v)) {
        let p = f.parent;
        while (p && p.kind !== COMP) p = p.parent;
        if (p) untrack(() => restart(p!));
        return;
      }
      const s = textOf(v);
      setText(f.dom as Text, s);
    }),
  );
}

/** A child's key among its siblings, and the fiber kind it makes. */
export function keyOf(c: any, i: number) {
  return c && typeof c === "object" && c.key != null ? "k" + c.key : "i" + i;
}

export function typeOf(c: any): any {
  if (typeof c === "string" || typeof c === "number" || typeof c === "bigint" || typeof c === "function") return TEXT_NODE;
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
  // A boundary still as the server drew it: its start comment.
  if ((f as any).dehydrated && (f as any).region) return (f as any).region.start;
  for (const c of f.children) {
    const d = firstDom(c);
    if (d) return d;
  }
  return null;
}

/** The DOM node after everything `f` put on the page: where what it draws next goes before. */
function nextDomAfter(f: Fiber, passDehydrated = false): Node | null {
  let at: Fiber | null = f;
  while (at && at.parent) {
    const sibs = at.parent.children;
    for (let i = sibs.indexOf(at) + 1; i < sibs.length; i++) {
      if (passDehydrated && (sibs[i] as any).dehydrated) continue;
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

configureViewTransitions(
  (f) => f.type === VIEW_TRANSITION,
  (f) => topElements(f as Fiber),
);

/** The first node in `into` of what comes after the <html> holding `body`, among the root's children already there. */
function afterSingleton(body: Fiber, into: Node): Node | null {
  let html: Fiber | null = body.parent;
  while (html && !(html as any).singleton) html = html.parent;
  // (Rendered into <html> itself: the <body>'s own siblings come after it.)
  html ??= body;
  if (!html.parent) return null;
  const sibs = html.parent.children;
  for (let i = sibs.indexOf(html) + 1; i < sibs.length; i++) {
    if (!sibs[i]!.committed) continue;
    const first = domNodes(sibs[i]!).find((n) => n.parentNode === into);
    if (first) return first;
  }
  return null;
}

/** The nodes a fiber put on the page, through singletons (what <html>'s <body> holds). */
function singletonNodes(f: Fiber, out: Node[] = []): Node[] {
  if (!(f as any).singleton) return domNodes(f, out);
  for (const c of f.children) if (c.committed) singletonNodes(c, out);
  return out;
}

function domNodes(f: Fiber, out: Node[] = []): Node[] {
  // A singleton stays where the document has it: not moved or removed with its parent's nodes.
  if ((f as any).singleton) return out;
  if (f.kind === HOST || f.kind === TEXT) out.push(f.dom);
  else if ((f as any).dehydrated && (f as any).region) {
    const { start, end } = (f as any).region;
    for (let n: Node | null = start; n; n = n.nextSibling) {
      out.push(n);
      if (n === end) break;
    }
  } else if (f.kind !== PORTAL_F) for (const c of f.children) domNodes(c, out);
  return out;
}

/** Where a node goes in `host`: a document's (or a root <html>'s) children go in its <body>, as React's do. */
function domParent(host: Node): Node {
  if (host.nodeType === 9) return (host as Document).body ?? host;
  // (The set first: reading localName crosses into the DOM.)
  if (rootContainers.has(host) && (host as Element).localName === "html") return host.ownerDocument!.body ?? host;
  return host;
}

/** The document nodes are made in: the container's own (a test's jsdom, an iframe), else the page's. */
/** Where `parent`'s child nodes go in `host` (an element's own children go straight in it). */
const intoOf = (parent: Fiber, host: Node) => (parent.kind === HOST && !(parent as any).singleton ? host : domParent(host));
const docOf = (host: Node): Document => (host.nodeType === 9 ? (host as Document) : host.ownerDocument) ?? document;

/** A suspended tree's nodes hidden (React's display: none, text emptied) or shown again as they were. */
function hideNodes(f: Fiber, hide: boolean) {
  // (Through <html>, <head> and <body>: what they hold is hidden, they stay.)
  for (const n of hiddenNodes(f)) hideNode(n, hide);
}
function hiddenNodes(f: Fiber, out: Node[] = []): Node[] {
  if ((f as any).singleton) {
    for (const c of f.children) hiddenNodes(c, out);
    return out;
  }
  if (f.kind === HOST || f.kind === TEXT || (f as any).dehydrated || f.kind === PORTAL_F) return domNodes(f, out);
  for (const c of f.children) hiddenNodes(c, out);
  return out;
}
/** A text's content: kept for when it shows again while a suspended tree hides it. */
function setText(n: Text, s: string) {
  const hidden = (n as any).__hidden;
  if (hidden) hidden.text = s;
  else if (n.data !== s) n.data = s;
}
/** One node hidden (display none, a text emptied) or shown as it was; counted, as two things may hide it. */
function hideNode(n: Node, hide: boolean) {
  const box = n as any;
  if (hide) {
    if (box.__hidden) return void box.__hidden.count++;
    if (n.nodeType === 3) (box.__hidden = { text: (n as Text).data, count: 1 }), ((n as Text).data = "");
    else {
      const style = (n as HTMLElement).style;
      if (!style) return;
      box.__hidden = { display: style.getPropertyValue("display"), priority: style.getPropertyPriority("display"), count: 1 };
      style.setProperty("display", "none", "important");
    }
    return;
  }
  if (!box.__hidden || --box.__hidden.count > 0) return;
  if (n.nodeType === 3) (n as Text).data = box.__hidden.text;
  else {
    const el = n as HTMLElement;
    el.style?.setProperty("display", box.__hidden.display, box.__hidden.priority);
    // (As a browser leaves it: an emptied style attribute stays.)
    if (el.style && !el.hasAttribute("style")) el.setAttribute("style", "");
  }
  box.__hidden = null;
}

// ---------------------------------------------------------------- Activity

/** Hidden Activities mounted: while there are none, nothing checks for them. */
let hiddenActivities = 0;
/** Whether `f` is inside a hidden Activity. */
function insideHidden(f: Fiber): boolean {
  for (let p = f.parent; p; p = p.parent) if ((p as any).hidden) return true;
  return false;
}
/** Whether a host node is a top-level one of a hidden Activity (or of a portal inside one): hidden itself. */
function topInHidden(f: Fiber): number {
  // Each hidden Activity it is a top-level node of hides it once (a portal's children are top-level again).
  let count = 0, top = true, portalChild = false;
  for (let p = f.parent; p; p = p.parent) {
    if ((p as any).hidden && (top || portalChild)) count++;
    if (p.kind === PORTAL_F && top) portalChild = true;
    if (p.kind === HOST) top = false;
  }
  return count;
}
/** An Activity's top-level nodes, and those of the portals in it (React hides a portal's children too). */
function activityNodes(f: Fiber, out: Node[] = [], top = true): Node[] {
  // Still as the server drew it: the nodes between its markers.
  if ((f as any).dehydrated && (f as any).region) {
    const { start, end } = (f as any).region;
    if (top) for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) if (n.nodeType === 1 || n.nodeType === 3) out.push(n);
    return out;
  }
  for (const c of f.children) {
    if (c.kind === HOST || c.kind === TEXT) {
      if (top) out.push(c.dom);
      // Portals anywhere below: their own top-level nodes too.
      if (c.kind === HOST) activityNodes(c, out, false);
    } else if (c.kind === PORTAL_F) activityNodes(c, out, true);
    else activityNodes(c, out, top);
  }
  return out;
}
function hideActivity(f: Fiber, hide: boolean) {
  for (const n of activityNodes(f)) hideNode(n, hide);
}
/** Hidden: the subtree's effects cleaned up, class components told they unmount, refs let go — at commit, outer first. */
function disappear(f: Fiber) {
  const each = (x: Fiber) => {
    if (x.kind === COMP) {
      for (const h of x.hooks ?? []) if (h && (h.phase === "layout" || h.phase === "passive") && typeof h.cleanup === "function") lifecycle(x, h.cleanup), (h.cleanup = null);
      const inst = x.inst;
      if (inst && (x as any).classRef != null) clearRef(x, (x as any).classRef);
      if (inst?.componentWillUnmount) lifecycle(x, () => inst.componentWillUnmount());
      (x as any).gone = true;
    } else if ((x.kind === HOST || x.kind === HOIST) && x.props?.ref != null) clearRef(x, x.props.ref);
    else if (x.kind === FRAG && (x as any).fragment && x.props?.ref != null) clearRef(x, x.props.ref);
    // (A hidden node is no fragment's while hidden: their listeners and observers let go of it, as React does.)
    if (fragmentRefs && (x.kind === HOST || x.kind === TEXT) && x.dom) for (const inst of fragmentsAbove(x as any)) inst._childRemoved(x.dom);
    if (x.kind === HOIST && !(x as any).resource) x.dom?.parentNode?.removeChild(x.dom);
    for (const c of x.children) if (!(c as any).hidden) each(c);
  };
  layoutQueue.push(() => {
    if (f.dead) return;
    for (const c of f.children) each(c);
  });
}
/** Shown again: refs, layout effects and componentDidMount at commit (inner first), then the effects after paint. */
function reappear(f: Fiber) {
  const passive: (() => void)[] = [];
  const each = (x: Fiber) => {
    // (Not the children a waiting boundary keeps hidden: they come back when it shows them.)
    const waiting = x.type === SUSPENSE && x.pending!.peek() > 0;
    for (const c of x.children) if (!(c as any).hidden && !(waiting && c.key === "kc")) each(c);
    // (Shown again: the fragments above it take it back, the nearest first.)
    if (fragmentRefs && (x.kind === HOST || x.kind === TEXT) && x.dom) for (const inst of fragmentsAbove(x as any)) inst._childAdded(x.dom);
    if (x.kind === COMP) {
      (x as any).gone = false;
      (x as any).waitsToAppear = false;
      for (const h of x.hooks ?? []) {
        if (!h || typeof h.create !== "function") continue;
        const run = () => {
          if (x.dead || h.ranIn === renderSerial) return;
          h.first = false;
          try {
            if (typeof h.cleanup === "function") h.cleanup();
            const back = h.create();
            h.cleanup = typeof back === "function" ? back : null;
          } catch (e) {
            caught(x, e);
          }
        };
        if (h.phase === "layout") run();
        else if (h.phase === "passive") passive.push(run);
      }
      const inst = x.inst;
      if (inst && (x as any).classRef != null) setRef(x, (x as any).classRef, inst);
      if (inst?.componentDidMount) lifecycle(x, () => inst.componentDidMount());
    } else if ((x.kind === HOST || x.kind === HOIST) && x.props?.ref != null && x.dom) setRef(x, x.props.ref, x.dom);
    else if (x.kind === FRAG && (x as any).fragment && x.props?.ref != null) setRef(x, x.props.ref, (x as any).fragment);
    if (x.kind === HOIST && !(x as any).resource) {
      if (!x.dom) x.dom = placeHoistable((x as any).hoistRoot, x.type, x.props);
      else if (!x.dom.parentNode) mountHoistable((x as any).hoistRoot, x.type, x.dom);
      // Shown again as React shows what it hid: its display unset, an empty style left behind.
      if (x.dom && !x.dom.hasAttribute("style")) x.dom.setAttribute("style", "");
    }
  };
  layoutQueue.push(() => {
    if (f.dead) return;
    for (const c of f.children) each(c);
    passiveQueue.push(...passive);
  });
}

// ---------------------------------------------------------------- reconciling

/** `parent`'s children made to be `list`: kept by key and type, the rest made or taken away, in order. */
/** The Suspense boundary a fiber is in (its nearest), if any. */
function boundaryOf(f: Fiber): Fiber | null {
  for (let p: Fiber | null = f; p; p = p.parent) if (p.type === SUSPENSE) return p;
  return null;
}

/** React's warnings for a function or a symbol given as a child. */
function invalidChild(parent: Fiber, c: any) {
  const atRoot = parent.kind === ROOT;
  const parentName = atRoot ? "Component" : parent.kind === HOST ? parent.type : nameOf(parent.type) || "Component";
  if (typeof c === "function") {
    const n = c.displayName || c.name || "Component";
    warn(
      atRoot
        ? `Functions are not valid as a React child. This may happen if you return ${n} instead of <${n} /> from render. Or maybe you meant to call this function rather than return it.\n  root.render(${n})`
        : `Functions are not valid as a React child. This may happen if you return ${n} instead of <${n} /> from render. Or maybe you meant to call this function rather than return it.\n  <${parentName}>{${n}}</${parentName}>`,
      "function-child:" + parentName,
    );
  } else {
    const n = String(c);
    warn(atRoot ? `Symbols are not valid as a React child.\n  root.render(${n})` : `Symbols are not valid as a React child.\n  <${parentName}>${n}</${parentName}>`, "symbol-child:" + parentName);
  }
}

/** How a root is named in the key warning (React's "top-level render call using <Root>"). */
const ROOT_NAME = { displayName: "Root" };

function reconcile(parent: Fiber, list: any[], host: Node, before: Node | null) {
  const old = parent.children;
  // The thenables it stopped at last time: asked again now (still pending, they hold the boundary again).
  const holds = (parent as any).holds as Hold[] | undefined;
  if (holds) for (const h of holds.splice(0)) release(h);
  // (None to look up in a fresh list.)
  const byKey = old.length ? new Map<string, Fiber>() : null;
  if (byKey) for (const f of old) byKey.set(f.key, f);
  const next: Fiber[] = [];
  // While hydrating, the children so far: a mismatch's diff prints the siblings before it.
  if (hydrating && dev()) (parent as any).building = next;
  // Duplicate keys only warn: looked for in development.
  const seenKeys = dev() ? new Set<string>() : null;
  let i = 0;
  // A thenable child the parent suspended at (the children after it not drawn).
  let stoppedAt: unknown = null;
  const skipAfter = !syncing ? boundaryOf(parent) : null;
  for (let c of list) {
    if (skipAfter && (skipAfter as any).resuspend && !(skipAfter as any).shown) break;
    // A lazy or a promise as a child: what it gives, once it has. Until then the parent suspends there (React throws
    // from its reconcile): the children after it are not drawn, those it had stay as they were.
    try {
      c = unwrapChild(c);
    } catch (e: any) {
      if (!e || typeof e.then !== "function") throw e;
      lastHold = null;
      caught(parent, e);
      if (lastHold) ((parent as any).holds ??= []).push(lastHold);
      stoppedAt = e;
      // Its component did not finish: its effects wait for a render that does (React unwinds it).
      for (let p: Fiber | null = parent; p; p = p.parent) if (p.kind === COMP) { (p as any).unfinished = true; break; }
      break;
    }
    // An iterable among the children (a Set, a generator, an old `@@iterator` object): a fragment of its items.
    const items = Array.isArray(c) ? null : iterated(c);
    if (items) checkKeys((c = items), parent.type);
    // An array in a list: a fragment of its own, its elements checked for keys there (React's returnFiber Fragment).
    else if (Array.isArray(c)) checkKeys(c, FRAGMENT);
    // A plain object is no child (an element, text, an array or an iterable is).
    if (c && typeof c === "object" && !Array.isArray(c) && (!c.$$typeof || c.$$typeof === Symbol.for("react.element"))) throw objectChild(c);
    // A signal holding text: a text node bound to it, set when it changes (its component does not render again).
    // Holding anything else (an element, a list): read here, so the component renders again when it changes.
    if (typeof c === "function" && c.isSignal === true && !textValue(untrack(c))) c = c();
    // A function or a symbol: no node, and React's warning (once per parent).
    if ((typeof c === "function" && c.isSignal !== true) || typeof c === "symbol") {
      if (dev()) invalidChild(parent, c);
      i++;
      continue;
    }
    // Nothing, a boolean or an empty string: no node (React makes none for "").
    if (c == null || typeof c === "boolean" || c === "") {
      i++;
      continue;
    }
    const key = keyOf(c, i++);
    if (seenKeys) {
      if (key[0] === "k" && seenKeys.has(key)) duplicateKey(key.slice(1));
      seenKeys.add(key);
    }
    const type = typeOf(c);
    const had = byKey?.get(key);
    if (had && (had.type === type || sameFamily(had.type, type)) && !had.dead) {
      byKey!.delete(key);
      update(had, c);
      next.push(had);
    } else {
      if (hydrating && !(list as any)[LONE]) nextTree = pushTree(childBase(parent), list.length, i - 1);
      nextOwner = c?._owner ?? null;
      next.push(mount(c, key, type, parent, host, before));
      nextTree = null;
      nextOwner = null;
    }
  }
  // Stopped at a suspending child: what it had and did not reach stays as it was, in its place.
  if (stoppedAt && byKey) for (const f of old) if (byKey.get(f.key) === f) next.push(f), byKey.delete(f.key);
  if (byKey) for (const f of byKey.values()) unmount(f, true);
  parent.children = next;
  if ((parent as any).building) (parent as any).building = undefined;
  // In order, back to front: each node before the one after it, moved only when it is not already there.
  // Taking over server markup, nodes are claimed or made in place: nothing to move.
  if (hydrating) return;
  // All new: each was put in place as it was made.
  if (!old.length && !((parent as any).singleton && host.nodeName === "BODY") && intoOf(parent, host) === host) return;
  // The same children in the same order (most updates): nothing moves.
  if (next.length === old.length) {
    let same = true;
    for (let j = 0; j < next.length; j++) if (next[j] !== old[j]) (same = false), (j = next.length);
    if (same) return;
  }
  // What moves: new children, and kept ones outside the longest run still in their old order (that run stays; React
  // keeps only those after the last one placed, so a swap moves every row between the two, where this moves two).
  // The others stay where they are (other nodes may sit between them, as a sibling portal's in the same container).
  const oldIndex = new Map<Fiber, number>();
  old.forEach((f, idx) => oldIndex.set(f, idx));
  const placed = new Set<Fiber>();
  const stayAt = inOrder(next, (f) => oldIndex.get(f));
  const stay = new Set<Fiber>();
  for (const j of stayAt) stay.add(next[j]!);
  for (const f of next) if (!stay.has(f)) placed.add(f);
  // Nothing new and nothing moved: every node is where it was.
  if (!placed.size) return;
  const into = intoOf(parent, host);
  // A document's children go in its <body>, beside what the <body> holds: each new one before the next sibling that
  // was already there (React's getHostSibling, which passes over singletons and what is being placed).
  if (into !== host) {
    for (let j = 0; j < next.length; j++) {
      const f = next[j]!;
      if (oldIndex.has(f)) continue;
      let anchor: Node | null = null;
      for (let k = j + 1; k < next.length; k++) {
        if (!oldIndex.has(next[k]!)) continue;
        // (Through <html> and <body>: what the <body> holds comes next.)
        const first = singletonNodes(next[k]!).find((n) => n.parentNode === into);
        if (first && first.parentNode === into) {
          anchor = first;
          break;
        }
      }
      // (None after it: it stays where it was put, after what came before.)
      if (anchor) for (const n of domNodes(f)) into.insertBefore(n, anchor);
    }
    return;
  }
  // The <body>'s children: before what the document's children after <html> put in it (React climbs out of it).
  if (before === null && (parent as any).singleton && host.nodeName === "BODY") before = afterSingleton(parent, into);
  let cursor = before;
  for (let j = next.length - 1; j >= 0; j--) {
    const f = next[j]!;
    const nodes = domNodes(f);
    for (let k = nodes.length - 1; k >= 0; k--) {
      const n = nodes[k]!;
      if (n.parentNode !== into || (placed.has(f) && pastComments(n.nextSibling) !== cursor)) into.insertBefore(n, cursor);
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
export const scheduledInCommit = () => {
  if (committing) nestedUpdate = true;
  updatedFromRef = refRunning;
  // An update from a passive effect: past React's limit of them in a row, the loop is warned about (in development).
  if (inPassive) {
    updatedInPassive = true;
    if (dev() && nestedPassive > 50) {
      nestedPassive = 0;
      withFiber(effectFiber, () =>
        console.error(
          "Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.",
        ),
      );
    }
  }
};
/** The fiber whose ref callback runs now, and the one whose ref callback asked the latest update: an update loop
 * from a ref is that fiber's error, as React throws it inside the callback. */
let refRunning: Fiber | null = null;
let updatedFromRef: Fiber | null = null;
/** Passive effects running now, whether they updated, how many runs of them in a row did, and whose effect runs. */
let inPassive = false;
let updatedInPassive = false;
let nestedPassive = 0;
let effectFiber: Fiber | null = null;

/** Renders counted, so a Profiler knows whether it began in the one now under way. */
let renderSerial = 0;
/** A Profiler rendered again (mounted, or given new props): its own start time in this render. */
function profilerBegins(f: Fiber) {
  (f as any).began = now();
  (f as any).beganIn = renderSerial;
  // Rendered itself (its parent did): told even when nothing below it renders, as React tells it.
  if (!profiled.has(f)) profiled.set(f, 0);
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

/** Whether any Profiler has been rendered: only then are effects timed. */
let profilersMounted = false;
/** Time a commit's layout effects (and lifecycles, refs, cleanups) took, and its passive effects, per Profiler. */
const effectTime = new Map<Fiber, number>();
const passiveTime = new Map<Fiber, number>();
/** Profilers whose onPostCommit is due once the commit's passive effects have run. */
const postCommits = new Set<Fiber>();
/** A queued effect run, its time added to every Profiler above the fiber it belongs to. */
function timed(fn: () => void, into: Map<Fiber, number>) {
  const owner: Fiber | undefined = profilersMounted ? (fn as any).owner : undefined;
  if (!owner) return guard(fn);
  const began = now();
  guard(fn);
  const took = now() - began;
  for (let p = owner.kind === COMP && owner.type === PROFILER ? owner : owner.parent; p; p = p.parent) if (p.type === PROFILER) into.set(p, (into.get(p) ?? 0) + took);
}
/** onPostCommit, after a commit's passive effects: the time they took, with that commit's phase and time. */
function tellPostCommit() {
  if (!postCommits.size) return;
  const list = [...postCommits];
  postCommits.clear();
  for (const p of list) {
    const last = (p as any).lastCommit;
    const onPostCommit = p.props?.onPostCommit;
    if (!p.dead && last && typeof onPostCommit === "function") lifecycle(p, () => onPostCommit(p.props.id, last.phase, passiveTime.get(p) ?? 0, last.commitTime));
  }
  passiveTime.clear();
}

/** Each Profiler that rendered told, innermost first, as React calls onRender (and onCommit) in its commit. */
function tellProfilers(commitTime: number) {
  for (const p of effectTime.keys()) if (!profiled.has(p)) profiled.set(p, 0);
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
    const onCommit = p.props?.onCommit;
    if (typeof onCommit === "function") lifecycle(p, () => onCommit(p.props.id, phase, effectTime.get(p) ?? 0, commitTime));
    (p as any).lastCommit = { phase, commitTime };
    if (typeof p.props?.onPostCommit === "function") postCommits.add(p);
  }
  effectTime.clear();
}

/** StrictMode's check that effects clean up: what it just mounted is unmounted, then mounted again. */
function doubleInvoke(list: Fiber[]) {
  const live = list.filter((f) => !f.dead && !(hiddenActivities && insideHidden(f)));
  const hooksOf = (f: Fiber, phase: string) => (f.kind === COMP ? (f.hooks ?? []).filter((h: any) => h && h.phase === phase) : []);
  for (const f of live) {
    for (const h of hooksOf(f, "layout")) if (typeof h.cleanup === "function") lifecycle(f, h.cleanup), (h.cleanup = null);
    const inst = f.inst;
    if (inst && (f as any).classRef != null) clearRef(f, (f as any).classRef);
    if (inst?.componentWillUnmount) lifecycle(f, () => inst.componentWillUnmount());
    if ((f.kind === HOST || f.kind === HOIST) && f.props?.ref != null) clearRef(f, f.props.ref);
    if (f.kind === FRAG && (f as any).fragment && f.props?.ref != null) clearRef(f, f.props.ref);
  }
  for (const f of live) for (const h of hooksOf(f, "passive")) if (typeof h.cleanup === "function") lifecycle(f, h.cleanup), (h.cleanup = null);
  const again = (h: any, f: Fiber) => {
    try {
      const back = h.create();
      h.cleanup = typeof back === "function" ? back : null;
    } catch (e) {
      caught(f, e);
    }
  };
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i]!;
    for (const h of hooksOf(f, "layout")) if (typeof h.create === "function") again(h, f);
    const inst = f.inst;
    if (inst && (f as any).classRef != null) setRef(f, (f as any).classRef, inst);
    if (inst?.componentDidMount) lifecycle(f, () => inst.componentDidMount());
    if ((f.kind === HOST || f.kind === HOIST) && f.props?.ref != null && f.dom) setRef(f, f.props.ref, f.dom);
    if (f.kind === FRAG && (f as any).fragment && f.props?.ref != null) setRef(f, f.props.ref, (f as any).fragment);
  }
  for (let i = live.length - 1; i >= 0; i--) for (const h of hooksOf(live[i]!, "passive")) if (typeof h.create === "function") again(h, live[i]!);
}

/** In StrictMode (development), `fn` called twice: the first result kept (useMemo, initializers), or the last. */
function strictTwice<T>(f: Fiber, fn: () => T, last = false): T {
  const a = fn();
  if (!(f as any).strict || !dev()) return a;
  const b = replaying(fn);
  return last ? b : a;
}
/** Told when StrictMode calls something a second time (React tells devtools; its test scheduler logs nothing then). */
let strictReplay: (on: boolean) => void = () => {};
export function onStrictReplay(fn: typeof strictReplay) {
  strictReplay = fn;
}
function replaying<T>(fn: () => T): T {
  strictReplay(true);
  try {
    return fn();
  } finally {
    strictReplay(false);
  }
}

/** Fragment refs in use: while there are some, hosts coming and going tell the ones above them. */
let fragmentRefs = 0;
function toldFragmentsAdded(f: Fiber) {
  if (!fragmentRefs) return;
  layoutQueue.push(() => {
    if (f.dead || !f.dom) return;
    for (const inst of fragmentsAbove(f as any)) inst._childAdded(f.dom);
  });
}

/** Unmount lifecycles of what a render took away, run first in the commit. */
const deletions: (() => void)[] = [];
/** A commit running: what it takes away goes at once. */
let committing = false;

/** Fibers made since the last commit: committed by it. */
const fresh: Fiber[] = [];

/**
 * A fiber with every field it uses often set from the start, so all fibers share one shape (engines then read their
 * fields at a fixed place; a field added later makes a new shape, and code reading many shapes slows down). Rarer
 * fields (hydration, boundaries, fragments) are still added as needed.
 */
class FiberNode {
  kind: number;
  type: any;
  key: string;
  props: any;
  parent: Fiber | null;
  children: Fiber[] = [];
  dom: any = null;
  ns: string | null;
  root: RootState;
  dead = false;
  committed = false;
  placed = false;
  strict = false;
  again = false;
  draws = 0;
  tree: TreeContext | undefined = undefined;
  render: ((f: Fiber, props: any) => any) | undefined = undefined;
  hooks: any[] | undefined = undefined;
  stop: (() => void) | undefined = undefined;
  out: any = undefined;
  inst: any = undefined;
  tick: Sig<number> | undefined = undefined;
  compare: ((a: any, b: any) => boolean) | null | undefined = undefined;
  insertion: (() => void)[] | undefined = undefined;
  layout: (() => void)[] | undefined = undefined;
  passive: (() => void)[] | undefined = undefined;
  unbind: (() => void) | undefined = undefined;
  doc: Document | undefined;
  constructor(kind: number, type: any, key: string, props: any, parent: Fiber | null, ns: string | null, root: RootState) {
    this.kind = kind;
    this.type = type;
    this.key = key;
    this.props = props;
    this.parent = parent;
    this.ns = ns;
    this.root = root;
    this.doc = parent?.doc;
  }
  /** What React's fiber holds as its stateNode (an element's owner is a fiber): the instance, or the node. */
  get stateNode(): any {
    return this.inst ?? this.dom ?? null;
  }
}

function fiber(kind: number, type: any, key: string, props: any, parent: Fiber): Fiber {
  const f = new FiberNode(kind, type, key, props, parent, parent.kind === HOST ? childNs(parent) : parent.ns, parent.root) as Fiber;
  if (nextTree) (f.tree = nextTree), (nextTree = null);
  if (nextOwner) Object.defineProperty(f, "owner", { value: nextOwner, enumerable: false }), (nextOwner = null);
  if (parent.strict || parent.type === STRICT) f.strict = true;
  return remember(f);
}

// ---------------------------------------------------------------- tree ids (useId while hydrating)

/** The owner of the next fiber made (its element's, in development): set by reconcile. */
let nextOwner: Fiber | null = null;
/** The tree position the next fiber made takes (it is a child of an array): set by reconcile. */
let nextTree: TreeContext | null = null;
/** A fiber's tree position: its own if it is forked, else what its parent gives its children. */
function treeOf(f: Fiber | null): TreeContext {
  return f ? ((f as any).tree ?? childBase(f.parent)) : ROOT_TREE;
}
/** What a fiber gives its children: a fork of its own position when it called useId (React's materialized id). */
function childBase(f: Fiber | null): TreeContext {
  if (!f) return ROOT_TREE;
  const t = treeOf(f);
  return (f as any).usedId ? pushTree(t, 1, 0) : t;
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
const HYDRATION_ATTRS_FORMAT = "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\n%s%s";
const HYDRATION_ATTRS = "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\nhttps://react.dev/link/hydration-mismatch";

/** A custom element's properties the browser does not let React set: told when hydrating. */
const READ_ONLY = new Set(["offsetParent", "offsetTop", "offsetLeft", "offsetWidth", "offsetHeight", "isContentEditable", "outerText", "outerHTML"]);

/** The server's attributes against those the props draw (on a scratch element): whether any differs. */
type Attrs = { names: Map<string, string>; css: string; html: string; style: Record<string, string> };
const attrsOf = (el: Element): Attrs => ({
  names: new Map(el.getAttributeNames().map((n) => [n, el.getAttribute(n)!])),
  css: (el as HTMLElement).style?.cssText ?? "",
  html: el.innerHTML,
  style: styleObject(el),
});
/** What the server's element differs by from the client's props, keyed by prop as React's diff shows it. */
function serverDifferences(server: Element, had: Attrs, type: string, ns: string | null, props: any): Record<string, any> | null {
  const doc = server.ownerDocument;
  const probe = ns ? doc.createElementNS(ns, type) : doc.createElement(type);
  const { children: _c, dangerouslySetInnerHTML: inner, ...rest } = props;
  try {
    muteWarnings(() => setProps(probe, rest, null, ns === SVG_NS));
  } catch {
    return null;
  }
  const out: Record<string, any> = {};
  let any = false;
  const keyFor = (attr: string) => {
    for (const k in props) if (k.toLowerCase() === attr || (attr === "class" && k === "className") || (attr === "for" && k === "htmlFor")) return k;
    return propName(attr);
  };
  const skip = new Set(["value", "checked", "selected", "style"]);
  // A function action: the client's URL that throws, the server's its own.
  if (typeof props.action === "function") skip.add("action");
  if (typeof props.formAction === "function") skip.add("formaction");
  const names = new Set([...had.names.keys(), ...probe.getAttributeNames()]);
  // A custom element's object, function and read-only props have no attribute to compare (React's diffHydratedCustomComponent).
  const custom = customTag(type);
  const unseen = (n: string) => {
    if (!custom) return false;
    if (READ_ONLY.has(keyFor(n))) return true;
    if (had.names.has(n)) return false;
    const v = props[keyFor(n)];
    return (v !== null && typeof v === "object") || typeof v === "function" || typeof v === "symbol";
  };
  // The server's view transition annotations (vt-*) are the client's to read, not props.
  for (const n of names) if (!skip.has(n) && !n.startsWith("vt-") && !unseen(n) && !sameMarkup(had.names.get(n), probe.getAttribute(n))) (out[keyFor(n)] = had.names.get(n) ?? null), (any = true);
  const want = props.style == null ? null : styleText(props.style) || null;
  if ((had.names.get("style") ?? null) !== want) (out.style = had.names.has("style") ? had.style : null), (any = true);
  if (inner?.__html != null) {
    // The client's HTML as the parser leaves it, as React normalizes it before comparing.
    const parsed = probe.cloneNode() as Element;
    parsed.innerHTML = String(inner.__html);
    if (had.html !== parsed.innerHTML) (out.dangerouslySetInnerHTML = { __html: had.html }), (any = true);
  }
  return any ? out : null;
}
/** Text or an attribute as an HTML parser leaves it (React's normalizeMarkupForTextOrAttribute). */
const parsedMarkup = (v: string) => v.replace(/\r\n?/g, "\n").replace(/\u0000|\uFFFD/g, "");
const sameMarkup = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null) || (a != null && b != null && parsedMarkup(a) === parsedMarkup(b));
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
  for (const n of names) if (!skip.has(n) && !sameMarkup(had.names.get(n), probe.getAttribute(n))) return true;
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
  // scripts (bootstrap, runtime) too, unless a <script> is what is being claimed; past empty text (no parser makes it).
  while (n && n !== limit && ((n.nodeType === 8 && !boundaryStart(n)) || n.nodeType === 10 || (n.nodeType === 3 && (n as Text).data === "") || (!scripts && (n as Element).localName === "script"))) n = n.nextSibling;
  return n === limit ? null : n;
}

// ---------------------------------------------------------------- Suspense boundaries from the server

/** A Suspense boundary the server drew, between its comments (`$` complete, `$?` pending, `$!` given to the
 * client): hydrated on its own, as React does — what goes wrong inside stays inside. */
type Region = { fiber: Fiber; host: Node; start: Comment; end: Comment; suspended: PromiseLike<any> | null; mismatch: boolean; text: boolean; made: Node[]; errored?: { error: unknown }; diff: DiffScope };
/** The root hydration's differences (in development), for its error's diff. */
let rootDiff: DiffScope | null = null;
/** Where a difference found now is recorded: the innermost boundary's, or the root's; none in production. */
function diffScope(): DiffScope | null {
  if (!dev()) return null;
  const r = regions[regions.length - 1];
  if (r) return r.suspended ? null : r.diff;
  return rootDiff;
}
/** The server nodes left from `n` on, as the diff lists them (a boundary as one). */
function serverTail(n: Node | null, limit?: Node | null): ReturnType<typeof describeServerNode>[] {
  const out: ReturnType<typeof describeServerNode>[] = [];
  while (n && n !== limit) {
    if (n.nodeType === 8) {
      const d = (n as Comment).data;
      if (d === "$" || d === "$?" || d === "$!" || d === "$~" || d === "&") {
        out.push(describeServerNode(n));
        n = boundaryEnd(n as Comment) ?? n;
      }
    } else if (!(n.nodeType === 3 && (n as Text).data === "")) out.push(describeServerNode(n));
    n = n.nextSibling;
  }
  return out;
}
/** A client fiber with no server node for it: the rejected candidate, if any, on its tail. */
function diffMissing(f: Fiber, candidate: Node | null) {
  const e = diffScope()?.stop(f);
  if (!e) return;
  e.serverProps = null;
  if (candidate) e.tail.push(describeServerNode(candidate));
}
/** The diff's text, then the error told for the fiber where hydration stopped. */
function mismatchError(scope: DiffScope | null, text: boolean): Error {
  return new Error(failedMessage(text) + (scope ? describeDiff(scope) : ""));
}
const regions: Region[] = [];
const regionIn = (host: Node) => {
  for (let i = regions.length - 1; i >= 0; i--) if (regions[i]!.host === host) return regions[i];
  return undefined;
};
/** Markup that differs from the client's: the innermost boundary's to deal with, or the root's. */
/** A recoverable error (a mismatch) met in the render under way: no pre-warming after it. */
let recoveredThisRender = false;
function markMismatch(text = false) {
  recoveredThisRender = true;
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
    } else if (activity ? d === "&" : d === "$" || d === "$?" || d === "$!" || d === "$~") depth++;
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
    // A mark where it gave the document its <html>, <head> or <body>: what it set there goes too (React's
    // clearSingletonPreambleContribution; the <head>'s children too, but for resources).
    if (n.nodeType === 8 && /^(html|head|body)$/.test((n as Comment).data)) {
      const d = n.ownerDocument!;
      const el = (n as Comment).data === "html" ? d.documentElement : (n as Comment).data === "head" ? d.head : d.body;
      if (el) {
        for (const a of [...el.attributes]) el.removeAttribute(a.name);
        if (el === d.head) clearHead(el);
      }
    }
    n.parentNode!.removeChild(n);
    n = next;
  }
}
/** The document's <head> emptied but for what React keeps there (resources, scripts, styles, stylesheets). */
function clearHead(head: Element) {
  for (let n = head.firstChild; n; ) {
    const next = n.nextSibling;
    const name = n.nodeName;
    if (!((n as any)[HOISTABLE] || name === "SCRIPT" || name === "STYLE" || (name === "LINK" && (n as HTMLLinkElement).rel?.toLowerCase() === "stylesheet"))) head.removeChild(n);
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
  // (Past blank text, and hidden inputs, which a form action's server fields put there: React passes them too.)
  while (raw && ((raw.nodeType === 3 && !(raw as Text).data.trim()) || hiddenInput(raw))) raw = raw.nextSibling;
  const kind = raw && raw.nodeType === 8 ? (raw as Comment).data : null;
  const expected = f.type === ACTIVITY ? kind === "&" : kind === "$" || kind === "$?" || kind === "$!" || kind === "$~";
  const end = expected ? boundaryEnd(raw as Comment) : null;
  if (!end) {
    diffMissing(f, raw);
    // Not the server's boundary here: drawn as any other (a mismatch, found by what it holds).
    if (f.type === ACTIVITY) reconcile(f, toList(f.props?.children), host, before);
    else start(f, host, before);
    return;
  }
  const region = { start: raw as Comment, end };
  hydrating!.set(host, end.nextSibling);
  (f as any).region = region;
  if (kind === "$?" || kind === "$~") {
    // Still streaming (or its content here, its stylesheets loading): the server's fallback stays until the
    // stream's script says it is done.
    (raw as any)._reactRetry = () => deferTransition(() => retryBoundary(f));
    setDehydrated(f, true);
    return;
  }
  if (kind === "$!") {
    serverGaveUp(f, region);
    drawFresh(f, host, removeRegion(region));
    return;
  }
  (region.start as any)[BOUNDARY] = f;
  // A continuous event's target inside: it hydrates before the others (React raises its lane).
  for (const t of hoverTargets.values()) if (inRegion(region, t.node)) (f as any).targeted = Math.min((f as any).targeted ?? Infinity, t.seq);
  // Hydrated in a pass of its own after this one (React's OffscreenLane: the server's content is shown already), unless
  // an event is hydrating its way to a target inside.
  if ((!selectiveTarget || !inRegion(region, selectiveTarget)) && !holdsSingleton(region) && !rendersSingleton(f.props?.children)) {
    setDehydrated(f, true);
    scheduleHydration(f);
    return;
  }
  hydrateRegion(f, host, region, () => (f.type === ACTIVITY ? reconcile(f, toList(f.props?.children), host, before) : start(f, host, before)));
}

/** Dehydrated boundaries ready to hydrate, done together after what is urgent (React's lower hydration lanes). */
const toHydrate = new Set<Fiber>();
/** Counted up by the test runner's reset (resetAct): what was queued before it is dropped. */
let hydrationEra = 0;
/** Events that targeted a boundary still waiting, counted: it hydrates first, in their order (React raises its lane). */
let targetSeq = 0;
function scheduleHydration(f: Fiber) {
  // (A boundary of a test the runner has since reset, its promise settling late: forgotten with that test.)
  if ((f as any).era !== undefined && (f as any).era !== hydrationEra) return;
  toHydrate.add(f);
  // (A run each time, which takes all that are waiting then: the later ones find nothing left.)
  deferTransition(runHydrations);
}
/** Document order of two boundaries. */
const byPlace = (a: Fiber, b: Fiber) => {
  const sa = (a as any).region?.start as Node | undefined, sb = (b as any).region?.start as Node | undefined;
  return sa && sb ? (sa.compareDocumentPosition(sb) & 4 ? -1 : 1) : 0;
};
/** A replay is scheduled: hydration runs wait behind it (it is the higher priority). */
let replayScheduled = false;
/** useDeferredValue's updates booked and not yet drawn. */
let deferredWaiting = 0;
function scheduleReplay() {
  if (replayScheduled) return;
  replayScheduled = true;
  deferTransition(() => {
    replayScheduled = false;
    replayQueued();
  });
}
function runHydrations() {
  if (!toHydrate.size) return;
  // (Behind a replay, and behind deferred values waiting to be drawn: both are the higher priority.)
  if (replayScheduled || deferredWaiting) return void deferTransition(runHydrations);
  const ready = [...toHydrate].sort((a, b) => ((a as any).targeted ?? Infinity) - ((b as any).targeted ?? Infinity) || byPlace(a, b));
  toHydrate.clear();
  // Those an event targeted each in a render of its own (their raised lanes); the rest together, in one render and
  // one commit (React's OffscreenLane).
  const rest: Fiber[] = [];
  let targetedRan = false;
  for (const g of ready) {
    if ((g as any).targeted === undefined) rest.push(g);
    else retryBoundary(g), (targetedRan = true);
  }
  // The events those were waiting for, replayed as a task of their own before the rest hydrates (React's normal
  // priority, above the offscreen pass).
  if (targetedRan && replaysWaiting()) {
    for (const g of rest) toHydrate.add(g);
    scheduleReplay();
    deferTransition(runHydrations);
    return;
  }
  // (With those the targeted ones left waiting inside them, in document order.)
  for (const g of toHydrate) if ((g as any).targeted === undefined) rest.push(g), toHydrate.delete(g);
  rest.sort(byPlace);
  if (!rest.length) return;
  depth++;
  try {
    for (const g of rest) retryBoundary(g);
  } finally {
    if (--depth === 0) commit();
  }
  flushSignals();
  if (replaysWaiting()) scheduleReplay();
}
/** Where continuous events went before what they hovered could hydrate: its boundary goes first, when there is one. */
const hoverTargets = new Map<string, { node: Node; seq: number }>();
/** The kind of continuous event, of which only the latest counts (React's queuedFocus, queuedDrag, queuedMouse…). */
const hoverKind = kindOf;

/** The node an event hydrates for (React's selective hydration): boundaries not holding it wait. */
let selectiveTarget: Node | null = null;
const BOUNDARY = Symbol("boundary");
/** Whether a boundary's region holds <html>, <head> or <body> (the document's preamble, hydrated with the root). */
function holdsSingleton(region: { start: Comment; end: Comment }): boolean {
  for (let s: Node | null = region.start.nextSibling; s && s !== region.end; s = s.nextSibling)
    if (s.nodeType === 1 && /^(html|head|body)$/.test((s as Element).localName)) return true;
  return false;
}
/** Whether children written in place (not behind a component) include <html>, <head> or <body>: the server hoisted
 * those to its preamble, out of the boundary's region. */
function rendersSingleton(c: any): boolean {
  if (Array.isArray(c)) return c.some(rendersSingleton);
  if (!c || typeof c !== "object" || c.$$typeof !== ELEMENT) return false;
  if (typeof c.type === "string") return /^(html|head|body)$/.test(c.type) || rendersSingleton(c.props?.children);
  return c.type === FRAGMENT && rendersSingleton(c.props?.children);
}
/** Whether `n` is between a boundary's comments. */
function inRegion(region: { start: Comment; end: Comment }, n: Node): boolean {
  for (let p: Node | null = n; p; p = p.parentNode) {
    if (p.parentNode !== region.start.parentNode) continue;
    for (let s: Node | null = region.start.nextSibling; s && s !== region.end; s = s.nextSibling) if (s === p) return true;
    return false;
  }
  return false;
}

// An event on what has not hydrated: its root hydrated now, then the dehydrated boundaries around its target,
// outermost first (each with the target, so the boundaries beside it wait).
hydrateBeforeEvents((target, roots, native, continuous) => {
  if (continuous) {
    // Not hydrated at once: its boundary raised, the root's hydration left to its turn, the event queued.
    const pending = [...roots].some((r) => (r as any).hydratePending?.());
    const f = dehydratedAround(target, roots);
    // Leaving: what its kind queued is cleared, nothing raised.
    if (!ENTERING.has(native.type)) {
      hoverTargets.delete(hoverKind(native));
      return !!f || pending;
    }
    if (f) {
      (f as any).targeted = ++targetSeq;
      scheduleHydration(f);
      return true;
    }
    if (pending) {
      hoverTargets.set(hoverKind(native), { node: target, seq: ++targetSeq });
      return true;
    }
    return false;
  }
  for (const r of roots) (r as any).hydrateNow?.(target);
  for (let guard = 0; guard < 20; guard++) {
    let f: Fiber | null = null;
    for (let n: Node | null = target; n && !f; n = n.parentNode) {
      for (let s: Node | null = n.previousSibling, depthIn = 0; s; s = s.previousSibling) {
        if (s.nodeType !== 8) continue;
        const d = (s as Comment).data;
        if (d === "/$" || d === "/&") depthIn++;
        else if (d === "$" || d === "$?" || d === "$!" || d === "$~" || d === "&") {
          if (depthIn) depthIn--;
          else if ((s as any)[DEHYDRATED] && (s as any)[BOUNDARY] && roots.has((s as any)[BOUNDARY].root)) f = (s as any)[BOUNDARY];
          if (!depthIn && f) break;
        }
      }
    }
    if (!f || !(f as any).dehydrated) return false;
    const was = selectiveTarget;
    selectiveTarget = target;
    try {
      retryBoundary(f);
    } finally {
      selectiveTarget = was;
    }
    // Still waiting (it suspended): it goes first once it can.
    if ((f as any).dehydrated) return void ((f as any).targeted ??= ++targetSeq), true;
  }
  return false;
});

/** The innermost dehydrated boundary of one of `roots` holding `target`. */
function dehydratedAround(target: Node, roots: Set<object>): Fiber | null {
  for (let n: Node | null = target; n; n = n.parentNode) {
    for (let s: Node | null = n.previousSibling, depthIn = 0; s; s = s.previousSibling) {
      if (s.nodeType !== 8) continue;
      const d = (s as Comment).data;
      if (d === "/$" || d === "/&") depthIn++;
      else if (d === "$" || d === "$?" || d === "$!" || d === "$~" || d === "&") {
        if (depthIn) depthIn--;
        else if ((s as any)[DEHYDRATED] && (s as any)[BOUNDARY] && roots.has((s as any)[BOUNDARY].root)) return (s as any)[BOUNDARY];
      }
    }
  }
  return null;
}

/** The boundary's children hydrated inside its region: kept dehydrated if they suspend, drawn on the client if
 * they do not match. */
function hydrateRegion(f: Fiber, host: Node, region: { start: Comment; end: Comment }, draw: () => void) {
  const r: Region = { fiber: f, host, start: region.start, end: region.end, suspended: null, mismatch: false, text: false, made: [], errored: undefined, diff: new DiffScope() };
  const was = hydrating!.get(host);
  hydrating!.set(host, region.start.nextSibling);
  regions.push(r);
  try {
    draw();
    // What the server drew there and nothing claimed: a mismatch of the boundary's.
    const left = !r.suspended ? nextServerNode(host) : null;
    if (left) {
      r.mismatch = true;
      const e = r.diff.stop(f);
      if (e) e.tail.push(...serverTail(left, region.end));
    }
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
    // A recovery in this render: no pre-warming after it (React renders it again synchronously).
    recoveredThisRender = true;
    // (Not when its client render failed too and an error boundary took that: nothing was recovered.)
    layoutQueue.push(() => !(f as any).caughtInClient && ((f.root as any).onRecoverable ?? report)(error, { componentStack: "" }));
    setDehydrated(f, false);
    drawFresh(f, host, removeRegion(region));
    return;
  }
  if (r.suspended && !r.mismatch) {
    // Left as the server drew it, and hydrated again once what it waits for is there.
    for (const c of f.children) unmount(c, false);
    f.children = [];
    for (const n of r.made) n.parentNode?.removeChild(n);
    setDehydrated(f, true);
    const again = () => scheduleHydration(f);
    r.suspended.then(again, again);
    return;
  }
  setDehydrated(f, false);
  if (r.mismatch) {
    const error = mismatchError(dev() ? r.diff : null, r.text);
    const at = (r.diff.at as Fiber | null) ?? f;
    for (const c of f.children) unmount(c, false);
    f.children = [];
    for (const n of r.made) n.parentNode?.removeChild(n);
    const tell = () => withFiber(at, () => ((f.root as any).onRecoverable ?? report)(error, { componentStack: "" }));
    // (Its client render waiting: told when its content is committed.)
    // (A region inside a boundary that now waits, an Activity's, has not committed: told when it does. The boundary's
    // own region commits its fallback now.)
    const sb = f.type === SUSPENSE ? null : boundaryOf(f);
    if (sb && sb.pending) {
      // An Activity's: its client render drawn off the page first. If it suspends, the boundary above shows its
      // fallback and the server's markup stays, dehydrated, as React leaves it (the client render did not commit).
      const before = sb.pending.peek();
      const frag = docOf(host).createDocumentFragment();
      lastHold = null;
      drawFresh(f, frag, null);
      if (sb.pending.peek() > before) {
        for (const c of f.children) unmount(c, false);
        f.children = [];
        setDehydrated(f, true);
        // Tried again once what it waits for is there.
        const waits = lastHold?.waits;
        const again = () => !f.dead && scheduleHydration(f);
        waits?.then(again, again);
        return;
      }
      layoutQueue.push(() => (sb.pending!.peek() ? ((sb as any).recoverLater ??= []).push(tell) : tell()));
      host.insertBefore(frag, removeRegion(region));
      return;
    }
    layoutQueue.push(tell);
    drawFresh(f, host, removeRegion(region));
    return;
  }
  // Hydrated: the root's onHydrated told, with the boundary's start comment (React's hydration callbacks).
  const onHydrated = (f.root as any).onHydrated;
  if (typeof onHydrated === "function") layoutQueue.push(() => onHydrated(region.start));
}

/** A boundary the server gave to the client: reported with the server's reason (in development) and digest. */
function serverGaveUp(f: Fiber, region: { start: Comment }) {
  const t = region.start.nextSibling as HTMLElement | null;
  const data: any = t && t.nodeName === "TEMPLATE" ? (t as any).dataset ?? {} : {};
  const error: any = new Error(
    dev() && data.msg ? data.msg : "The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.",
  );
  error.digest = data.dgst;
  // Given up on purpose (browser()): rendered here, nothing to report.
  if (data.dgst === "") return;
  // (Not when its client render failed too and an error boundary took that: the boundary handles it.)
  layoutQueue.push(() => !(f as any).caughtInClient && ((f.root as any).onRecoverable ?? report)(error, { componentStack: dev() ? data.cstck ?? "" : "" }));
}

/** The boundary drawn on the client, not hydrated, before its closing comment. */
function drawFresh(f: Fiber, host: Node, end: Node | null) {
  const was = hydrating;
  hydrating = null;
  const wasCaught = lastCaughtByBoundary;
  lastCaughtByBoundary = null;
  try {
    drawBoundary(f, host, end);
  } finally {
    hydrating = was;
    (f as any).caughtInClient = lastCaughtByBoundary !== null;
    lastCaughtByBoundary = wasCaught;
  }
  // Drawn while the rest still hydrates: once it has, put where the fibers after it say (React places a client
  // rendered boundary before its next host sibling, not where the server's markup was).
  if (was)
    layoutQueue.push(() => {
      // (Not one whose client render was thrown away: the server's markup stays where it is.)
      if (f.dead || (f as any).dehydrated) return;
      const parent = domParent(hostParentOf(f));
      const before = nextDomAfter(f);
      for (const n of domNodes(f)) if (n.parentNode !== parent || n.nextSibling !== before) parent.insertBefore(n, before);
    });
}

/** A boundary kept as the server drew it (or not any more): its start comment marked, so events in it are not
 * dispatched until it hydrates (React blocks them). */
function setDehydrated(f: Fiber, on: boolean) {
  const was = !!(f as any).dehydrated;
  (f as any).dehydrated = on;
  if (on) (f as any).era = hydrationEra;
  // The context values it is hydrated with later: those of now.
  if (on && !was) {
    const then = new Map<Fiber, any>();
    for (let p = f.parent; p; p = p.parent) if (p.kind === PROVIDER && !then.has(p)) then.set(p, untrack(() => p.value!()));
    (f as any).contextThen = then;
  }
  const start: any = (f as any).region?.start;
  if (on && !was) countDehydrated(1);
  else if (!on && was) countDehydrated(-1);
  if (start) start[DEHYDRATED] = on;
}

/** A dehydrated boundary let go (deleted, or drawn on the client instead): the root's onDeleted told, in the commit. */
function tellDeleted(f: Fiber) {
  const onDeleted = (f.root as any).onDeleted;
  if (typeof onDeleted !== "function") return;
  const start = (f as any).region.start;
  depth > 0 && !committing ? deletions.push(() => onDeleted(start)) : onDeleted(start);
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
    setDehydrated(f, false);
    drawFresh(f, host, after);
    flushSignals();
    return;
  }
  hydrating = new Map();
  depth++;
  const outerThen = contextThen;
  contextThen = (f as any).contextThen ?? null;
  try {
    hydrateRegion(f, host, region, () => drawBoundary(f, host, region.end));
  } finally {
    contextThen = outerThen;
    hydrating = null;
    if (--depth === 0) commit();
  }
  // What read a context that has changed since: drawn again with its value now.
  if (!contextThen && staleReaders.size) {
    const readers = [...staleReaders];
    staleReaders.clear();
    for (const r of readers) if (!r.dead) restart(r);
  }
  // Hydrated, with a transition's props that waited for it: given now.
  const waiting = (f as any).propsAfterHydration;
  if (waiting !== undefined && !(f as any).dehydrated) {
    (f as any).propsAfterHydration = undefined;
    if (f.kind === COMP) (f.props = waiting), restart(f);
    // (An Activity: updated as an element of its own would be.)
    else {
      depth++;
      try {
        update(f, { props: waiting });
      } finally {
        if (--depth === 0) commit();
      }
    }
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
const rootOrSingleton = (host: Node) => rootContainers.has(host) || !!(host as any)[FIBER]?.singleton || host.nodeType === 9;
/**
 * In a root or singleton, whether a server element of the right tag is this one: hoisted tags and what scripts or
 * extensions inject are told apart by their telling attributes (React's canHydrateInstance).
 */
function looseMatch(el: Element, type: string, props: any): boolean {
  const attr = (v: any) => (v == null ? null : "" + v);
  switch (type) {
    case "meta":
      return el.hasAttribute("itemprop");
    case "link": {
      const rel = el.getAttribute("rel");
      if (rel === "stylesheet" && el.hasAttribute("data-precedence")) return false;
      return rel === props.rel && el.getAttribute("href") === (props.href == null || props.href === "" ? null : props.href) && el.getAttribute("crossorigin") === attr(props.crossOrigin) && el.getAttribute("title") === attr(props.title);
    }
    case "style":
      return !el.hasAttribute("data-precedence");
    case "script": {
      const src = el.getAttribute("src");
      const differs = src !== attr(props.src) || el.getAttribute("type") !== attr(props.type) || el.getAttribute("crossorigin") !== attr(props.crossOrigin);
      return !(differs && src && el.hasAttribute("async") && !el.hasAttribute("itemprop"));
    }
  }
  return true;
}

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
/** A <script> as React makes one: parsed (so the browser never runs it), and told about once in development. */
function inertScript(doc: Document): Element {
  warn("Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).", "script-tag");
  const div = doc.createElement("div");
  div.innerHTML = "<script></" + "script>";
  return div.removeChild(div.firstChild!) as Element;
}

/** A root's container emptied before it is drawn: the document and its <html>, <head>, <body> keep their scripts,
 * styles and stylesheets (React's clearContainer). */
function clearContainer(container: Node) {
  if (container.nodeType === 9 || /^(HTML|HEAD|BODY)$/.test(container.nodeName)) clearSparingly(container);
  else (container as Element).replaceChildren?.();
}

function clearSparingly(container: Node, root?: object) {
  let n = container.firstChild;
  if (n && n.nodeType === 10) n = n.nextSibling;
  while (n) {
    const node = n;
    n = n.nextSibling;
    // Drawn by this root already (its nodes placed before the singleton was taken over): kept.
    if (root && (node as any)[FIBER]?.root === root && !(node as any)[FIBER].dead) continue;
    switch (node.nodeName) {
      case "HTML":
      case "HEAD":
      case "BODY":
        clearSparingly(node, root);
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
  // Its container's (a portal's, or the root's): the host may not be on the page yet.
  let container: Node = host;
  for (let p: Fiber | null = f.parent; p; p = p.parent) if (p.kind === ROOT || p.kind === PORTAL_F) {
    container = p.dom as Node;
    break;
  }
  const root = hoistableRoot(container);
  const resource = getResource(root, f.type, f.props);
  (f as any).resource = resource;
  (f as any).hoistRoot = root;
  // A stylesheet not in the document yet: a render that can wait commits once it has loaded.
  if (resource && work) suspendResource(work.wait, root, resource, f.props);
  // Inside a Suspense, outside a transition: the boundary shows its fallback until the stylesheet has loaded.
  else if (resource?.type === "stylesheet" && !hydrating && !applyingTransition && suspenseAbove(f)) {
    const st = newCommitWait();
    suspendResource(st, root, resource, f.props);
    const ready = commitWhenReady(st);
    if (ready) caught(f, new Promise<void>((done) => ready(done)));
  }
  layoutQueue.push(() => {
    if (f.dead) return;
    if (!resource && hiddenActivities && insideHidden(f)) return;
    f.dom = resource ? acquireResource(root, resource, f.props) : placeHoistable(root, f.type, f.props);
    if (f.dom && !resource) (f.dom as any)[FIBER] = f;
    if (f.props.ref != null) setRef(f, f.props.ref, f.dom);
  });
}

/** React's hydrateHoistable: the document's matching <title>, <meta> or <link> taken over, or a new one into <head>. */
function placeHoistable(root: Document | ShadowRoot, type: string, props: any): Element {
  const d: Document = (root as any).ownerDocument || root;
  let el: Element | null = null;
  if (type === "title") {
    const t = d.getElementsByTagName("title")[0];
    if (t && !(t as any)[HOISTABLE] && !(t as any)[FIBER] && t.namespaceURI !== SVG_NS && !t.hasAttribute("itemprop")) el = t;
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

/** A <title>'s text, as React's client sets it: a string or number child; anything else leaves the text as it is
 * (the server wrote it). */
function titleText(el: Element, children: any) {
  if (typeof children !== "string" && typeof children !== "number" && typeof children !== "bigint") return;
  const text = String(children);
  if (el.textContent !== text) el.textContent = text;
}

/** A <link> as React describes it in its resource errors: rel, href and precedence, "..." for the rest. */
function describeLink(props: any): string {
  let shown = 0;
  let out = "<link";
  for (const k of ["rel", "href", "precedence"]) {
    if (typeof props[k] === "string") shown++, (out += ` ${k}="${props[k]}"`);
    else if (Object.hasOwn(props, k)) {
      shown++;
      const v = props[k] === null ? "null" : "invalid type " + typeof props[k];
      out += k === "precedence" ? ` precedence={${v}}` : ` ${k}="${v}"`;
    }
  }
  if (Object.getOwnPropertyNames(props).length > shown) out += " ...";
  return out + " />";
}

function updateHoist(f: Fiber, props: any) {
  const prev = f.props;
  if (prev === props) return;
  const root = (f as any).hoistRoot as Document | ShadowRoot;
  const was = (f as any).resource as Resource | null;
  const next = getResource(root, f.type, props);
  // A <link> that changes between an element and a stylesheet resource: React does not support it, and says so.
  if (f.type === "link" && !was !== !next && (was?.type === "stylesheet" || next?.type === "stylesheet")) {
    const diff = dev() ? `\n\n  - ${describeLink(prev)}\n  + ${describeLink(props)}` : "";
    throw new Error(
      (was ? "Expected stylesheet with precedence to not be updated to a different kind of <link>." : "Expected <link> not to update to be updated to a stylesheet with precedence.") +
        " Check the `rel`, `href`, and `precedence` props of this component. Alternatively, check whether two different <link> components render in the same slot or share the same key." +
        diff,
    );
  }
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
  if (prev.ref !== props.ref) {
    if (prev.ref != null) deletions.push(() => clearRef(f, prev.ref));
    if (props.ref != null) layoutQueue.push(() => !f.dead && setRef(f, props.ref, f.dom));
  }
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
  // In a root or singleton, other elements are passed over (an extension's); a boundary or text stops the search.
  if (n && n.nodeType === 1 && (!match(n) || isResourceNode(n)) && rootOrSingleton(host)) {
    const limit = regionIn(host)?.end;
    let m: Node | null = n.nextSibling;
    while (m && m !== limit && ((m.nodeType === 8 && !boundaryStart(m)) || (m.nodeType === 1 && (!match(m) || isResourceNode(m))))) m = m.nextSibling;
    if (m && m !== limit && !match(m)) m = null;
    n = m === limit ? null : m;
  }
  // Elsewhere, hidden inputs the server added (a form action's) are passed over, as React does.
  while (n && !match(n) && hiddenInput(n) && !rootOrSingleton(host)) n = nextAfter(host, n);
  if (!n || !match(n)) return null;
  hydrating!.set(host, n.nextSibling);
  return n;
}
const hiddenInput = (n: Node) => n.nodeType === 1 && (n as Element).localName === "input" && (n as HTMLInputElement).type === "hidden";
/** The next server node in `host` after `n`. */
function nextAfter(host: Node, n: Node): Node | null {
  const was = hydrating!.get(host);
  hydrating!.set(host, n.nextSibling);
  const next = nextServerNode(host);
  hydrating!.set(host, was as any);
  return next;
}

/** A server boundary's opening comment (Suspense or Activity): a node hydration claims, as React counts it. */
function boundaryStart(n: Node) {
  const d = (n as Comment).data;
  return d === "$" || d === "$?" || d === "$!" || d === "$~" || d === "&";
}

/** Elements whose leftovers React does not check: <form> and <button> (a form action's hidden inputs), and those
 * that set their own text (React's shouldSetTextContent). */
function noTailCheck(f: Fiber) {
  if (f.kind !== HOST) return false;
  const t = f.type;
  const c = f.props?.children;
  return t === "form" || t === "button" || t === "textarea" || t === "noscript" || typeof c === "string" || typeof c === "number" || typeof c === "bigint" || f.props?.dangerouslySetInnerHTML?.__html != null;
}

/** What the server drew in `host` and the client did not claim: taken away, as React does on a mismatch. */
function dropUnclaimed(host: Node, f: Fiber) {
  if (!hydrating) return;
  // A root's container and <html>, <head>, <body> keep what else is in them (React checks no tail there).
  if (rootOrSingleton(host) || noTailCheck(f)) return void hydrating.delete(host);
  const limit = regionIn(host)?.end;
  let n = nextServerNode(host);
  if (n && n !== limit) {
    const e = diffScope()?.stop(f);
    if (e) e.tail.push(...serverTail(hydrating.has(host) ? hydrating.get(host)! : host.firstChild, limit));
  }
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
  // (Or its direct parent, made by another component: React's check also compares their owners.)
  for (let p = f.parent; p; p = p.parent) if (p.kind === HOST && p.type === tag) return p !== f.parent || (p as any).owner !== (f as any).owner;
  return false;
}

function mount(c: any, key: string, type: any, parent: Fiber, host: Node, before: Node | null): Fiber {
  if (type === TEXT_NODE) {
    const f = fiber(TEXT, type, key, c, parent);
    const text = typeof c === "function" ? textOf(untrack(c)) : "" + c;
    if (dev()) {
      const around = nestingAt(parent);
      checkTextNesting(text, around?.current?.tag, around?.implicitRoot ?? false);
    }
    // A server text node holds this one and maybe the next (adjacent text runs together in HTML): split off.
    // In an element that suppresses hydration warnings: the server's text kept as it is (React tells nothing and does
    // not fix it).
    const suppressed = hydrating && parent.kind === HOST && parent.props?.suppressHydrationWarning === true;
    // (Compared as the HTML parser leaves text: CR and CRLF as LF, no NUL — React's normalizeMarkupForTextOrAttribute.)
    const parsedText = parsedMarkup(text);
    const had = hydrating && text !== "" ? (claim(host, (n) => n.nodeType === 3 && (suppressed || parsedMarkup((n as Text).data).startsWith(parsedText))) as Text | null) : null;
    if (had) {
      if (!suppressed && had.data.length > parsedText.length) hydrating!.set(host, had.splitText(parsedText.length));
      f.dom = had;
    } else if (suppressed && text !== "" && /^(string|number|bigint)$/.test(typeof parent.props?.children)) {
      // Its only text missing from the server's element, warnings suppressed: left as the server drew it (React does
      // not fix it): the node kept out of the page until an update places it.
      f.dom = (parent.doc ?? docOf(host)).createTextNode("");
    } else {
      if (hydrating && text !== "") {
        const next = nextServerNode(host);
        // An element's only text (React sets it as its text content): the element's difference. Not a singleton's:
        // React hydrates its text as a text node.
        const content = parent.kind === HOST && !(parent as any).singleton && /^(string|number|bigint)$/.test(typeof parent.props?.children);
        markMismatch(content || next?.nodeType === 3);
        const scope = diffScope();
        if (content) {
          const e = scope?.stop(parent);
          if (e) e.serverProps = { ...(e.serverProps as any), children: host.textContent ?? "" };
        } else if (next?.nodeType === 3) {
          const e = scope?.stop(f);
          if (e) e.serverProps = (next as Text).data;
        } else diffMissing(f, next);
      }
      f.dom = (parent.doc ?? docOf(host)).createTextNode(text);
      (hydrating ? host : intoOf(parent, host)).insertBefore(f.dom, hydrating ? serverCursor(host) : before);
      if (hydrating) madeWhileHydrating.push(f.dom), regions[regions.length - 1]?.made.push(f.dom);
    }
    toldFragmentsAdded(f);
    if (hiddenActivities) for (let k = topInHidden(f); k > 0; k--) hideNode(f.dom, true);
    if (typeof c === "function") bindText(f, c);
    return f;
  }
  if (type === FRAGMENT) {
    const props = Array.isArray(c) ? null : c.props;
    const f = fiber(FRAG, type, key, props, parent);
    // A prop a Fragment cannot take: React's warning (the first one).
    if (dev() && props) {
      const bad = Object.keys(props).find((k) => k !== "children" && k !== "key" && k !== "ref");
      if (bad) withFiber(parent, () => console.error(`Invalid prop \`${bad}\` supplied to \`React.Fragment\`. React.Fragment can only have \`key\`, \`ref\`, and \`children\` props.`));
    }
    // A ref on a Fragment: an instance that treats its top-level elements as one (React 19.2's fragment refs),
    // attached ahead of its children's refs, as React does.
    if (props?.ref != null) {
      const inst = ((f as any).fragment = new FragmentInstance(f as any));
      fragmentRefs++;
      layoutQueue.push(() => (inst._attachHandles(), setRef(f, props.ref, inst)));
    }
    reconcile(f, props ? toList(props.children) : c, host, before);
    return f;
  }
  if (type === PORTAL) {
    const f = fiber(PORTAL_F, type, key, c, parent);
    f.dom = c.containerInfo;
    f.doc = docOf(f.dom);
    f.ns = nsOf(f.dom);
    // iOS Safari sends clicks only to elements it thinks clickable: React gives a portal's container a no-op onclick.
    if (f.dom.nodeType === 1 && f.dom.onclick == null) f.dom.onclick = () => {};
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
    const hoisted = ns !== MATH_NS && isHoistable(type, props, ns === SVG_NS, inContainer(parent), warn);
    if (dev()) {
      const around = nestingAt(parent);
      if (!hoisted) checkNesting(type, around, (tag) => behindComponents(f, tag));
      f.nesting = ancestorsWith(around, type);
    }
    if (hoisted) {
      assertValidProps(type, props, true);
      f.kind = HOIST;
      mountHoist(f, host);
      return f;
    }
    // <html>, <head> and <body> are the document's own (React's singletons), wherever they are rendered.
    const single = !ns ? singleton(host, type) : null;
    if (single) (f as any).singleton = true;
    // Taken over while hydrating: what follows it in its parent comes next.
    if (single && hydrating && single.parentNode === host) hydrating.set(host, single.nextSibling);
    if (single && !hydrating && type !== "html") clearSparingly(single, f.root);
    // Taken over on a fresh render: its attributes go too (React's acquireSingletonInstance), the props set after.
    // (Pre-warmed while another fiber holds it, a fallback: left to that one, as React never commits the pre-warm.)
    const held = !!single && prewarming && !!(single as any)[FIBER] && !(single as any)[FIBER].dead;
    if (held) ((f as any).singletonLent = true), ((single as any).lentTo = f);
    // Taken from a fiber still there (a fallback over shown content): it gets the element back when this one lets go.
    else if (single && !hydrating && (single as any)[FIBER] && !(single as any)[FIBER].dead && (single as any)[FIBER] !== f) {
      const other: Fiber = (single as any)[FIBER];
      ((single as any).displaced ??= []).push(other);
      // Two of them at once (the other one still there at commit, not let go in it): React's warning
      // (acquireSingletonInstance).
      if (dev())
        insertionQueue.push(() => {
          if (other.dead || f.dead) return;
          withFiber(f, () =>
            warn(
              `You are mounting a new ${type} component when a previous one has not first unmounted. It is an error to render more than one ${type} component at a time and attributes and children of these components will likely fail in unpredictable ways. Please only render a single instance of <${type}> and if you need to mount a new one, ensure any previous ones have unmounted first.`,
            ),
          );
        });
    }
    if (single && !hydrating && !held) while (single.attributes.length) single.removeAttributeNode(single.attributes[0]!);
    const server = single ?? (hydrating ? (claim(host, (n) => n.nodeType === 1 && (n as Element).localName.toLowerCase() === type.toLowerCase() && (!hiddenInput(n) || (props.type === "hidden" && (n as Element).getAttribute("name") === (props.name == null ? null : "" + props.name))) && (!rootOrSingleton(host) || looseMatch(n as Element, type, props))) as Element | null) : null);
    // A customized built-in (is="…") is made as one.
    const doc = parent.doc ?? docOf(host);
    const el = (f.dom = server ?? (ns ? doc.createElementNS(ns, type) : type === "script" ? inertScript(doc) : typeof props.is === "string" ? doc.createElement(type, { is: props.is }) : doc.createElement(type)));
    // Its fiber, for tools that look from the page into the tree.
    if (!held) (el as any)[FIBER] = f;
    if (!held) (el as any)[PROPS] = null;
    (f as any).placed = false;
    listenOnElement(el, type);
    if (!server) {
      if (hydrating) markMismatch(), diffMissing(f, nextServerNode(host));
      checkTag(el, type);
    }
    assertValidProps(type, props, true);
    // Hydration stops at a mismatch: the root or boundary is drawn on the client instead.
    if (!server && hydrationStopped()) return f;
    // As the server drew it, to compare once the props are applied (and have warned as they do).
    const had = server && dev() && !props.suppressHydrationWarning ? attrsOf(server) : null;
    // (Taken over, its props are not set: what React's hydration diff warns of itself.)
    if (server && "inert" in props) inertEmpty(props.inert);
    if (!held) (el as any)[PROPS] = props;
    if (FORM_TAGS.has(type) && !ns) {
      // A select chooses among its options, so they come first; a textarea's children are its value, not nodes.
      // A select's multiple and size before its options: they decide whether the browser picks the first one.
      if (type === "select" && !server) {
        if (props.multiple) (el as HTMLSelectElement).multiple = true;
        if (props.size != null && typeof props.size !== "function" && typeof props.size !== "symbol") el.setAttribute("size", String(props.size));
      }
      if (type !== "textarea" && type !== "input") reconcile(f, toList(props.children), el, null);
      // (Its owner named in the field's warnings, as React names the component that rendered it.)
      const wasOwner = hostOwner;
      hostOwner = (f as any).owner ?? null;
      try {
        initForm(el, type, props, false, !!server);
      } finally {
        hostOwner = wasOwner;
      }
    } else {
      // Taken over from the server: listeners only (a custom element's properties too are left alone, as React does).
      if (server && hydrating) {
        hydrateProps(el, props, ns === SVG_NS);
        if (dev() && customTag(type)) for (const k in props) if (READ_ONLY.has(k)) console.error(`Assignment to read-only property will result in a no-op: \`${k}\``);
      }
      else if (!held) setProps(el, props, null, ns === SVG_NS), setDefaults(el, props);
      // A noscript's children are not drawn on the client (React leaves them to the server).
      // (Hydrating <html>: what it holds besides <head> and <body> the server wrote in <body>, as React does.)
      const into = hydrating && single && type === "html" && (el as Element).ownerDocument?.body ? (el as Element).ownerDocument!.body : el;
      if (props.dangerouslySetInnerHTML == null && type !== "noscript") reconcile(f, toList(props.children), into, null);
    }
    const differences = had ? serverDifferences(el, had, type, ns, props) : null;
    if (differences) {
      const e = diffScope()?.entry(f);
      if (e) (e.serverProps = { ...(e.serverProps as any), ...differences }), (attrsDiffer = true);
    }
    if (server) {
      if (props.dangerouslySetInnerHTML == null && type !== "noscript" && !single && !hydrationWaits && !regions.some((r) => r.suspended)) dropUnclaimed(el, f);
    } else {
      (hydrating ? host : intoOf(parent, host)).insertBefore(el, hydrating ? serverCursor(host) : before);
      if (hydrating) madeWhileHydrating.push(el), regions[regions.length - 1]?.made.push(el);
    }
    toldFragmentsAdded(f);
    // A new top-level node in a hidden Activity (or a portal's in one) is hidden as it comes.
    if (hiddenActivities) for (let k = topInHidden(f); k > 0; k--) hideNode(el, true);
    if (props.autoFocus && !ns && !server && (type === "input" || type === "button" || type === "select" || type === "textarea")) {
      insertionQueue.push(() => !f.dead && (el as HTMLElement).focus());
    }
    // An image loaded again once committed: a load it fired before then reached no handler (React's commitMount).
    if (type === "img" && !ns && !server && (props.src || props.srcSet)) {
      insertionQueue.push(() => {
        if (f.dead) return;
        if (props.src) (el as any).src = props.src;
        else (el as any).srcset = props.srcSet;
      });
    }
    if (props.ref != null) layoutQueue.push(() => !f.dead && !(hiddenActivities && insideHidden(f)) && setRef(f, props.ref, el));
    return f;
  }
  if (type === FRAGMENT || type === STRICT || type === PROFILER || type === SUSPENSE_LIST || type === ACTIVITY || type === VIEW_TRANSITION) {
    const f = fiber(FRAG, type, key, props, parent);
    if (type === PROFILER) (profilersMounted = true), profilerBegins(f);
    if (type === PROFILER && dev() && typeof f.props?.id !== "string") console.error(`Profiler must specify an "id" of type \`string\` as a prop. Received the type \`${typeof f.props?.id}\` instead.`);
    if (type === ACTIVITY && props.mode !== "hidden" && hydrating) hydrateBoundary(f, host, before);
    else if (type === ACTIVITY && props.mode === "hidden") {
      // Hidden: its children drawn (their state kept for when it is shown), out of sight, their effects not run.
      // (Not in the server's markup: drawn on the client, after hydration, as for a client render.)
      // (Then after the boundaries beside it still waiting to hydrate, as React places it.)
      (f as any).hidden = true;
      hiddenActivities++;
      const afterHydration = hydrating;
      deferTransition(() => {
        if (f.dead || !(f as any).hidden) return;
        reconcile(f, toList(f.props?.children), hostParentOf(f), nextDomAfter(f, afterHydration));
      });
    } else reconcile(f, toList(props.children), host, before);
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
type Work = {
  units: (() => void)[];
  at: number;
  deferring: boolean;
  finish: () => void;
  wait: CommitWait;
  /** A root's render that recovers from an error by rendering again synchronously, and what it met. */
  recover?: boolean;
  root?: RootState;
  errored?: { error: unknown };
};
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

/** A boundary still as the server drew it, given new props: hydrated first (with the props it had), then updated;
 * if it cannot hydrate yet, what the server drew goes and it is drawn on the client, as React does. */
function updateDehydrated(f: Fiber, props: any, redraw: () => void) {
  retryBoundary(f);
  // Hydrated with the props it had: the render that brought new ones starts again from the top, as React's does.
  if (!(f as any).dehydrated && drawing.size && props !== f.props) throw RESTART;
  // Still waiting, in a transition: it keeps what the server drew, and takes the new props once it has hydrated.
  if ((f as any).dehydrated && applyingTransition) {
    (f as any).propsAfterHydration = props;
    return;
  }
  f.props = props;
  if (!(f as any).dehydrated) return redraw();
  const region = (f as any).region;
  const host = region.start.parentNode;
  tellDeleted(f);
  const after = removeRegion(region);
  (f as any).region = undefined;
  setDehydrated(f, false);
  drawFresh(f, host, after);
}

function update(f: Fiber, c: any) {
  if (f.kind === TEXT) {
    if (f.props === c) return;
    (f as any).unbind?.();
    (f as any).unbind = undefined;
    f.props = c;
    if (typeof c === "function") bindText(f, c);
    else setText(f.dom as Text, "" + c);
    // Left out by hydration (its element's warnings suppressed): put in place now.
    if (!f.dom!.parentNode && !hydrating) hostParentOf(f).insertBefore(f.dom!, nextDomAfter(f));
    return;
  }
  if (f.kind === FRAG) {
    if (f.type === ACTIVITY && (f as any).dehydrated && !hydrating) {
      // (The same props: left as the server drew it, waiting for its hydration.)
      if (c.props === f.props) return;
      // (Then updated as any Activity is below: shown or hidden, its children drawn.)
      updateDehydrated(f, c.props, () => {});
    }
    const host = hostParentOf(f);
    const prev = f.props;
    // The same element again (a parent that bailed out on its children): nothing of it renders again.
    if (f.type === PROFILER && c.props !== prev) (f.props = c.props), profilerBegins(f);
    const wasHidden = !!(f as any).hidden;
    const nowHidden = f.type === ACTIVITY && c.props?.mode === "hidden";
    if (wasHidden !== nowHidden) {
      (f as any).hidden = nowHidden;
      hiddenActivities += nowHidden ? 1 : -1;
      // Hidden now: its effects and refs let go, at commit; its children then drawn as hidden ones are.
      if (nowHidden) disappear(f);
    }
    if (nowHidden) {
      // What is shown now hides at once; the hidden children are drawn after the visible work.
      if (!wasHidden) hideActivity(f, true);
      f.props = c.props;
      deferTransition(() => {
        if (f.dead || !(f as any).hidden) return;
        reconcile(f, toList(f.props?.children), hostParentOf(f), nextDomAfter(f));
      });
    } else {
      // A fragment ref: a changed ref is moved over at commit, ahead of its children's (React detaches and attaches
      // the Fragment's first).
      const inst = (f as any).fragment as FragmentInstance | undefined;
      if (inst && prev?.ref !== c.props?.ref) {
        if (prev?.ref != null) deletions.push(() => clearRef(f, prev.ref));
        if (c.props?.ref != null) layoutQueue.push(() => setRef(f, c.props.ref, inst));
      }
      reconcile(f, Array.isArray(c) ? c : toList(c.props?.children), host, nextDomAfter(f));
    }
    if (wasHidden !== nowHidden && !nowHidden) {
      hideActivity(f, false);
      if (!insideHidden(f)) reappear(f);
    }
    f.props = c.props;
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
    assertValidProps(f.type, props, true);
    f.props = props;
    const el = f.dom as Element;
    // Its handlers change at commit: an event during the render still reaches the committed ones.
    insertionQueue.push(() => ((el as any)[PROPS] = props));
    // What setting them throws is this element's commit error (React's captureCommitPhaseError): the rest goes on.
    const commitProps = (set: () => void) => {
      try {
        set();
      } catch (e) {
        caught(f, e);
      }
    };
    if (FORM_TAGS.has(f.type) && !f.ns) {
      if (f.type !== "textarea" && f.type !== "input") reconcile(f, toList(props.children), el, null);
      commitProps(() => updateForm(el, f.type, props, prev, false));
    } else {
      commitProps(() => setProps(el, props, prev, f.ns === SVG_NS));
      if (props.dangerouslySetInnerHTML == null && f.type !== "noscript") reconcile(f, toList(props.children), el, null);
      else if (f.children.length) {
        for (const n of f.children) unmount(n, false);
        f.children = [];
      }
    }
    if (prev.ref !== props.ref) {
      // Every old ref let go before any new one is set (React's mutation, then layout): a ref moving between
      // elements ends on its new one.
      if (prev.ref != null) deletions.push(() => clearRef(f, prev.ref));
      if (props.ref != null) layoutQueue.push(() => setRef(f, props.ref, el));
    }
    return;
  }
  if (f.kind === PROVIDER) {
    f.props = props;
    f.value!.set(props.value);
    reconcile(f, toList(props.children), hostParentOf(f), nextDomAfter(f));
    return;
  }
  // A new version of its component (Fast Refresh): drawn with the new code, its state kept.
  if (f.kind === COMP && c?.type !== undefined && c.type !== f.type && latestOf(c.type) !== f.type && sameFamily(f.type, c.type)) {
    f.type = latestOf(c.type);
    f.render = renderer(f.type, f);
    f.props = props;
    restart(f);
    return;
  }
  // A component: drawn again only if what it was given changed.
  if (f.props === props) return;
  if ((f as any).dehydrated && !hydrating) return updateDehydrated(f, props, () => restart(f));
  // A memo's compare decides, unless the ref changed (React checks it apart).
  const same = f.compare ? f.compare(f.props, props) && f.props?.ref === props?.ref : false;
  const was = f.props;
  f.props = props;
  if (same) return;
  try {
    restart(f);
  } catch (e) {
    // Its render starts again from above: it gets these props then, compared with the ones it had.
    if (e === RESTART) f.props = was;
    throw e;
  }
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

/** A root's hydration attempt being thrown away: the server's nodes in the singletons stay. */
let discardingHydration = false;
function unmount(f: Fiber, removeDom: boolean) {
  if (f.dead) return;
  // A singleton let go: what React set on it unset, the element kept (React's releaseSingletonInstance): what others
  // set on it (attributes, styles, an onclick of theirs) stays.
  if ((f as any).singleton && f.dom) {
    const el = f.dom as HTMLElement;
    // Its children's nodes go with them; what others put in it (resources, extensions' nodes) stays.
    // (A hydration attempt thrown away: the server's markup stays, as it was, for the next attempt.)
    for (const c of f.children) unmount(c, !discardingHydration);
    f.children = [];
    // (Taken over since by another fiber, a fallback's say: what it set stays.)
    if ((el as any)[FIBER] === f && !discardingHydration) {
      const props = f.props ?? {};
      setProps(el, {}, props, false);
      if (props.dangerouslySetInnerHTML != null) el.textContent = "";
      if (el.onclick === noop) el.onclick = null;
      // Lent to a pre-warmed fiber meanwhile, or taken from one still there: now that one's.
      let lent = (el as any).lentTo as Fiber | undefined;
      (el as any).lentTo = undefined;
      if (lent?.dead) lent = undefined;
      const displaced = (el as any).displaced as Fiber[] | undefined;
      while (!lent && displaced?.length) {
        const d = displaced.pop()!;
        if (!d.dead) lent = d;
      }
      if (lent && !lent.dead) {
        (lent as any).singletonLent = false;
        (el as any)[FIBER] = lent;
        (el as any)[PROPS] = lent.props;
        setProps(el, lent.props, null, false);
      }
    }
  }
  // A boundary still as the server drew it: its markup goes with it.
  if ((f as any).dehydrated && (f as any).region) {
    tellDeleted(f);
    if (removeDom) removeRegion((f as any).region);
    setDehydrated(f, false);
  }
  // A host or text node going from under fragment refs: they let go of it (listeners, observers) in the commit.
  if (fragmentRefs && (f.kind === HOST || f.kind === TEXT) && f.dom && f.committed) {
    const node = f.dom;
    const list = fragmentsAbove(f as any);
    if (list.length) {
      const tell = () => list.forEach((i) => i._childRemoved(node));
      depth > 0 && !committing ? deletions.push(tell) : tell();
    }
  }
  if (removeDom) for (const n of domNodes(f)) n.parentNode?.removeChild(n);
  f.dead = true;
  // Bound to signals: let go.
  (f as any).unbind?.();
  if (f.kind === HOST && f.dom) unbindProps(f.dom as Element);
  if (f.type === VIEW_TRANSITION && f.committed) viewTransitionUnmounted(f);
  if (!f.committed) {
    // Never committed: nothing ran for it, nothing to undo.
    f.stop?.();
    for (const c of f.children) unmount(c, false);
    return;
  }
  // Its unmount lifecycles run in the commit, as React's do, when this is a render; now otherwise.
  const inRender = depth > 0 && !committing;
  // (Tagged with the fiber, for the time a Profiler above it is told.)
  const later = (fn: () => void) => (inRender ? (profilersMounted && ((fn as any).owner = f), deletions.push(fn)) : fn());
  if (f.kind === COMP) {
    f.stop?.();
    const inst = f.inst;
    later(() => {
      if (inst && (f as any).classRef != null) lifecycle(f, () => clearRef(f, (f as any).classRef));
      if (inst?.componentWillUnmount && !(f as any).gone) untrack(() => lifecycle(f, () => inst.componentWillUnmount()));
      for (const h of f.hooks!) if (h && h.cleanup && h.phase !== "passive") untrack(() => lifecycle(f, h.cleanup)), (h.cleanup = null);
    });
    // Passive cleanups with the passive effects, after the commit, as React runs them.
    const passive = () => {
      for (const h of f.hooks!) if (h && h.cleanup && h.phase === "passive") untrack(() => lifecycle(f, h.cleanup)), (h.cleanup = null);
    };
    if (inRender) (profilersMounted && ((passive as any).owner = f), passiveUnmounts.push(passive));
    else passive();
  } else if (f.kind === HOST && f.props.ref != null) {
    later(() => lifecycle(f, () => clearRef(f, f.props.ref)));
  } else if (f.kind === HOIST) {
    later(() => {
      if (f.props.ref != null) lifecycle(f, () => clearRef(f, f.props.ref));
      releaseHoist(f);
    });
  } else if (f.kind === FRAG && (f as any).fragment && f.props?.ref != null) {
    later(() => lifecycle(f, () => clearRef(f, f.props.ref)));
  }
  if ((f as any).hidden) hiddenActivities--;
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
    // What it throws is this fiber's commit error (React's captureCommitPhaseError), its stack from here.
    let back: any;
    const was = refRunning;
    refRunning = f;
    try {
      back = ref(value);
    } catch (e) {
      return caught(f, e);
    } finally {
      refRunning = was;
    }
    f.refCleanup = typeof back === "function" ? back : null;
  } else if (ref && typeof ref === "object") {
    if (dev() && !Object.hasOwn(ref, "current")) {
      const n = f.kind === HOST ? f.type : nameOf(f.type) || "Component";
      withFiber(f, () => warn(`Unexpected ref object provided for ${n}. Use either a ref-setter function or React.createRef().`, "ref-object:" + n));
    }
    ref.current = value;
  }
  // Thrown in the commit, as React does: to the nearest boundary, or uncaught.
  else if (ref != null) caught(f, new Error("Expected ref to be a function, an object returned by React.createRef(), or undefined/null."));
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
    if (dev() && type.contextTypes)
      warn(`${nameOf(type) || "Unknown"} uses the legacy contextTypes API which was removed in React 19. Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)`, "legacy-fn-context:" + nameOf(type));
    if (dev() && type.childContextTypes)
      warn(`childContextTypes cannot be defined on a function component.\n  ${type.displayName || type.name || "Component"}.childContextTypes = ...`, "function-child-context:" + nameOf(type));
    if (dev() && typeof type.getDerivedStateFromProps === "function")
      warn(`${nameOf(type) || "Unknown"}: Function components do not support getDerivedStateFromProps.`, "function-gdsfp:" + nameOf(type));
    if (dev() && typeof type.contextType === "object" && type.contextType !== null)
      warn(`${nameOf(type)}: Function components do not support contextType.`, "function-context-type:" + nameOf(type));
    if (dev() && type.prototype && typeof type.prototype.render === "function") {
      const n = type.displayName || type.name || "Component";
      warn(`The <${n} /> component appears to have a render method, but doesn't extend React.Component. This is likely to cause errors. Change ${n} to extend React.Component instead.`, "render-not-extended:" + n);
    }
    return (_f, props) => type(props);
  }
  if (type === SUSPENSE) {
    f.pending = signal(0);
    // Children once shown stay mounted while it waits again, hidden beside the fallback (their state kept, as React
    // keeps it); before they were ever shown, only the fallback.
    let shown = false;
    let last: { waiting: boolean; props: any; out: any } | null = null;
    return (fb, props) => {
      const waiting = fb.pending!() > 0;
      (fb as any).shown = shown;
      if (last && last.waiting === waiting && last.props === props && waiting) return last.out;
      // Shown once its children are committed without waiting: children that suspend before that are dropped
      // (React keeps nothing of a first mount that suspends), not kept hidden.
      if (!waiting)
        ((fb as any).warmed = false),
          layoutQueue.push(() => {
            if (fb.dead || fb.pending!.peek() !== 0 || (fb as any).dehydrated) return;
            shown = true;
            // What its hydration recovered from, told once its content is in (React reports at that commit).
            for (const tell of ((fb as any).recoverLater ?? []).splice(0)) tell();
          });
      // Its fallback committed: its children are pre-warmed once after the commit.
      // (Not in a sync render, nor one that met a recoverable error: React renders those again synchronously.)
      else if (!(fb as any).warmed && !prewarming && !syncing) ((fb as any).warmed = true), layoutQueue.push(() => !recoveredThisRender && prewarms.push(fb));
      layoutQueue.push(() => {
        const kept = fb.children.find((c) => c.key === "kc");
        // (Shown again only what it hid itself: a hidden Activity around may hide the same nodes.)
        if (!kept || !!(fb as any).keptHidden === waiting) return;
        (fb as any).keptHidden = waiting;
        hideNodes(kept, waiting);
      });
      const out: any = [
        shown || !waiting ? createElement(FRAGMENT, { key: "c" }, props.children) : null,
        waiting ? createElement(FRAGMENT, { key: "f" }, props.fallback) : null,
      ];
      // Its own two slots are not a fork of the tree (React keeps them in fibers of its own).
      out[LONE] = true;
      last = { waiting, props, out };
      return out;
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
  const error = invalidType(type);
  // Naming the component whose render made the element, as React does (in development).
  const owner: Fiber | undefined = (f as any).owner;
  if (dev() && owner) error.message += `\n\nCheck the render method of \`${nameOf(owner.type)}\`.`;
  throw error;
}


/** The component's effect started, rendering it now into `host` before `before`. */
function start(f: Fiber, host?: Node, before?: Node | null) {
  // Placed where asked the first time; after, where it is.
  let first = !!host;
  f.stop = effect(() => {
    if (f.tick) f.tick();
    if (f.dead) return;
    if (first) (first = false), draw(f, host!, before ?? null);
    else draw(f);
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

/** Whether the hydration under way has found a mismatch (the innermost boundary's, or the root's): React stops it. */
const hydrationStopped = () => hydrating !== null && (regions.length ? regions[regions.length - 1]!.mismatch : mismatched);

function draw(f: Fiber, placeHost?: Node, placeBefore: Node | null = null) {
  if (hydrationStopped()) return;
  // A boundary whose hydration threw: nothing more of it renders (React unwinds to it), it is drawn on the client.
  if (hydrating && regions.length && regions[regions.length - 1]!.errored) return;
  if (!restarting) (f as any).draws = ((f as any).draws ?? 0) + 1;
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
    let at = f;
    for (let p = updatedFromRef; p; p = p.parent) if (p === f) at = updatedFromRef!;
    if ((f as any).draws === LIMIT + 1) caught(at, new Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops."));
    return;
  }
  // A unit of a concurrent render is part of that render: its passive effects come after its commit.
  if (depth++ === 0 && !work) {
    runPassive(false);
    startRender();
  }
  // Timed only once a Profiler is about (two clock reads and a walk up per component otherwise).
  const began = profilersMounted ? now() : 0;
  const outerNested = nestedTime;
  nestedTime = 0;
  f.insertion = [];
  f.layout = [];
  f.passive = [];
  let out: any;
  const prevCurrent = current;
  const prevAt = hookAt;
  const prevA = internals.A;
  current = f;
  hookAt = 0;
  internals.A = asyncDispatcher;
  try {
    for (let pass = 0; ; pass++) {
      (f as any).again = false;
      out = f.render!(f, f.props);
      if (!(f as any).again && (f as any).strict && f.render !== renderClass && typeof f.type === "function" && dev()) {
        // StrictMode: rendered once more, its hooks as the first render left them (React's double render).
        hookAt = 0;
        f.insertion = [];
        f.layout = [];
        f.passive = [];
        out = replaying(() => f.render!(f, f.props));
      }
      if (!(f as any).again) break;
      if (pass >= 24) throw new Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
      // Again, with what this render set: its hooks from the top, the effects it asked for asked again.
      hookAt = 0;
      f.insertion = [];
      f.layout = [];
      f.passive = [];
    }
  } catch (e) {
    // An update that suspends: what was on the page stays (React
    // keeps the committed UI and tries again when the data is there), rather than its children going and coming.
    // (Under a Suspense outside a transition too: the committed output stays, hidden behind the fallback.)
    const keep = f.committed && e && typeof (e as any).then === "function";
    out = keep ? KEEP : null;
    current = prevCurrent;
    hookAt = prevAt;
    caught(f, e);
  } finally {
    current = prevCurrent;
    hookAt = prevAt;
    internals.A = prevA;
  }
  const kept = out === KEEP;
  if (kept) out = f.out;
  f.out = out;
  // A component returning an array: its elements are a list, each needing a key (React checks at render).
  if (Array.isArray(out)) checkKeys(out, f.type);
  const host = placeHost ?? hostParentOf(f);
  const before = placeHost ? placeBefore : nextDomAfter(f);
  drawing.add(f);
  try {
    reconcile(f, toList(out), host, before);
  } catch (e) {
    // A dehydrated boundary below hydrated for an update: the render goes again from the outermost component drawn.
    if (e === RESTART) {
      let outer = true;
      for (let p = f.parent; p && outer; p = p.parent) if (drawing.has(p)) outer = false;
      if (!outer) {
        drawing.delete(f);
        depth--;
        throw e;
      }
      (f as any).restartDraw = true;
    } else caught(f, e, true);
  }
  // A Suspense whose children suspended as it drew them: drawn again now, its fallback in place.
  if ((f as any).resuspend) {
    (f as any).resuspend = false;
    current = f;
    hookAt = 0;
    try {
      out = f.render!(f, f.props);
    } finally {
      current = prevCurrent;
      hookAt = prevAt;
    }
    f.out = out;
    try {
      reconcile(f, toList(out), host, before);
    } catch (e) {
      caught(f, e, true);
    }
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
    (f as any).retrying = true;
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
      caught(f, e, true);
    } finally {
      (f as any).retrying = false;
    }
  }
  drawing.delete(f);
  // Started again (a boundary below hydrated for this update): this pass's effects dropped, the next one's kept.
  if ((f as any).restartDraw) {
    (f as any).restartDraw = false;
    // (Not an update loop: one update, its render started again; its draws are not counted.)
    restarting++;
    try {
      draw(f, placeHost, placeBefore);
    } finally {
      restarting--;
    }
    if (--depth === 0) commit();
    return;
  }
  if (profilersMounted) {
    const took = now() - began;
    if (!kept) profile(f, took - nestedTime);
    nestedTime = outerNested + took;
  }
  insertionQueue.push(...f.insertion);
  if ((f as any).unfinished) (f as any).unfinished = false;
  else if (hiddenActivities && insideHidden(f)) (f as any).waitsToAppear = true;
  else {
    if (profilersMounted) for (const fn of f.layout) (fn as any).owner = f;
    if (profilersMounted) for (const fn of f.passive) (fn as any).owner = f;
    layoutQueue.push(...f.layout);
    passiveQueue.push(...f.passive);
  }
  if (--depth === 0) commit();
}
/** Thrown up to the outermost component drawn, which draws again (React's SelectiveHydrationException). */
const RESTART = Symbol("restart");
let restarting = 0;

/** A render beginning: its start time, and whether an update set in the last commit set it off. */
function startRender() {
  renderSerial++;
  if (focusedBefore === undefined && typeof document !== "undefined") {
    focusedBefore = document.activeElement;
    selectionBefore = focusedBefore && selectable(focusedBefore) ? selectionIn(focusedBefore) : null;
  }
  renderStart = now();
  renderIsNested = nestedUpdate;
  nestedUpdate = false;
}

/** What had focus when the render began: focused again at commit if moving nodes took it away (React's restoreSelection). */
let focusedBefore: Element | null | undefined;
function restoreFocus() {
  const el = focusedBefore;
  const selection = selectionBefore;
  focusedBefore = undefined;
  selectionBefore = null;
  if (!el || !el.isConnected || el.ownerDocument.activeElement === el || el === el.ownerDocument.body) return;
  // Its selection put back first, then the focus (React's restoreSelection).
  if (selection) setSelectionIn(el, selection);
  (el as HTMLElement).focus?.();
}
/** The focused element's selection when the render began. */
let selectionBefore: { start: number; end: number } | null = null;
/** An element with a selection of its own (React's hasSelectionCapabilities): a text field, or editable content. */
const selectable = (el: Element) => {
  const name = el.nodeName.toLowerCase();
  return (name === "input" && /^(text|search|tel|url|password)$/.test((el as HTMLInputElement).type)) || name === "textarea" || (el as HTMLElement).contentEditable === "true";
};
function selectionIn(el: Element): { start: number; end: number } | null {
  if ("selectionStart" in el && (el as any).selectionStart != null) return { start: (el as any).selectionStart, end: (el as any).selectionEnd };
  return getOffsets(el);
}
function setSelectionIn(el: Element, sel: { start: number; end: number }) {
  if ("selectionStart" in el) {
    (el as any).selectionStart = sel.start;
    (el as any).selectionEnd = Math.min(sel.end, (el as any).value?.length ?? sel.end);
  } else setOffsets(el, sel);
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
    // One object per props given (React resolves them once per element): rendered again with the same, it is the same.
    if ((f as any).propsGiven === withRef) props = (f as any).propsResolved;
    else {
      const { ref: _ref, ...rest } = withRef;
      props = rest;
      (f as any).propsGiven = withRef;
      (f as any).propsResolved = rest;
    }
  }
  const ref = withRef?.ref;
  const ct = C.contextType;
  const validCt = ct != null && ct.$$typeof === CONTEXT;
  // An invalid contextType: React's warning (once per class), and the empty context.
  if (dev() && !f.inst && "contextType" in C && ct !== null && !validCt) {
    const why =
      ct === undefined
        ? " However, it is set to undefined. This can be caused by a typo or by mixing up named and default imports. This can also happen due to a circular dependency, so try moving the createContext() call to a separate file."
        : typeof ct !== "object"
          ? ` However, it is set to a ${typeof ct}.`
          : ct.$$typeof === CONSUMER
            ? " Did you accidentally pass the Context.Consumer instead?"
            : ` However, it is set to an object with keys {${Object.keys(ct).join(", ")}}.`;
    warn(`${nameOf(C)} defines an invalid contextType. contextType should point to the Context object returned by React.createContext().${why}`, "invalid-context-type:" + nameOf(C));
  }
  const ctx = validCt ? readContext(f, ct) : EMPTY_CONTEXT;
  // React calls the legacy will-lifecycles only for a class that does not use the newer static ones.
  const legacy = !C.getDerivedStateFromProps && !f.inst?.getSnapshotBeforeUpdate && !C.prototype.getSnapshotBeforeUpdate;
  // Both names when both are there, as React calls them; this.state assigned in one is React's replaceState,
  // with its warning.
  const call = (name: string, ...args: any[]) => {
    if (!legacy) return;
    const before = inst.state;
    for (const fn of [inst[name], inst["UNSAFE_" + name]]) if (typeof fn === "function") untrack(() => fn.apply(inst, args));
    if (inst.state !== before) {
      if (dev()) warn(`${nameOf(C)}.${name}(): Assigning directly to this.state is deprecated (except inside a component's constructor). Use setState instead.`, "assign-state:" + name + nameOf(C));
      inst.__queue.push({ [REPLACE]: inst.state });
      inst.state = before;
    }
  };
  /** setState calls queued so far, applied to `state`. */
  const apply = (state: any, nextProps: any) => {
    let force = false;
    for (const u of inst.__queue.splice(0)) {
      if (u === FORCE) force = true;
      else {
        // this.state assigned in a will-lifecycle: the state replaced (React's replaceState).
        if (u && typeof u === "object" && REPLACE in u) {
          state = u[REPLACE];
          continue;
        }
        // Nothing (null or undefined) from an update: the state as it was, the same object (no render for it).
        const part = typeof u === "function" ? strictTwice(f, () => u.call(inst, state, nextProps), true) : u;
        if (part != null) state = { ...state, ...part };
      }
    }
    return [state, force] as const;
  };
  let inst = f.inst;
  const remount = inst?.__remount;
  if (!inst || remount) {
    if (remount) inst.__remount = false;
    else {
      if ((f as any).strict && dev()) new C(props, ctx);
      inst = f.inst = new C(props, ctx);
      checkClassInstance(C, inst, props);
      recordUnsafeLifecycles(C, inst, !!(f as any).strict);
      inst.props = props;
      inst.context = ctx;
      if (inst.state === undefined) inst.state = null;
      inst.__f = f;
      inst.__queue = [];
    }
    if (C.getDerivedStateFromProps) inst.state = { ...inst.state, ...derived(f, C, props, inst.state) };
    call("componentWillMount");
    // setState in componentWillMount: taken into this first render.
    inst.state = apply(inst.state, props)[0];
    const out = strictTwice(f, () => classRender(inst), true);
    propsReassigned(C, inst, props);
    if (inst.componentDidMount) f.layout!.push(() => !f.dead && lifecycle(f, () => inst.componentDidMount()));
    (f as any).classRef = ref;
    const done = inst.__done?.splice(0);
    if (done?.length) f.layout!.push(() => lifecycle(f, () => done.forEach((cb: any) => callCallback(cb, inst))));
    if (ref != null) f.layout!.push(() => !f.dead && setRef(f, ref, inst));
    return out;
  }
  const prevProps = inst.props;
  const prevState = inst.state;
  const prevCtx = inst.context;
  const prevRef = (f as any).classRef;
  // Its ref attached after its other layout work (pushed last, below), the old one let go first.
  const attach = prevRef !== ref && ref != null ? () => f.layout!.push(() => setRef(f, ref, inst)) : null;
  if (prevRef !== ref) {
    (f as any).classRef = ref;
    if (prevRef != null) deletions.push(() => clearRef(f, prevRef));
  }
  if (prevProps !== props || prevCtx !== ctx) call("componentWillReceiveProps", props, ctx);
  let [state, force] = apply(prevState, props);
  if (C.getDerivedStateFromProps) state = { ...state, ...derived(f, C, props, state) };
  if (!force && prevProps === props && state === prevState && prevCtx === ctx) return attach?.(), KEEP;
  // A PureComponent compares shallowly, unless it has a shouldComponentUpdate of its own (React's checkShouldComponentUpdate).
  const skip = () => (inst.shouldComponentUpdate ? !untrack(() => shouldUpdate(f, C, inst, props, state, ctx)) : !!C.prototype?.isPureReactComponent && shallowEqual(prevProps, props) && shallowEqual(prevState, state));
  // A new value of its contextType updates it whatever shouldComponentUpdate said (still asked), as React has it.
  if (!force && skip() && prevCtx === ctx) {
    inst.props = props;
    inst.state = state;
    inst.context = ctx;
    // Its setState callbacks are called even so (React's).
    const skipped = inst.__done?.splice(0);
    if (skipped?.length) f.layout!.push(() => lifecycle(f, () => skipped.forEach((cb: any) => callCallback(cb, inst))));
    attach?.();
    return KEEP;
  }
  call("componentWillUpdate", props, state, ctx);
  inst.props = props;
  inst.state = state;
  inst.context = ctx;
  const out = strictTwice(f, () => classRender(inst), true);
  // After its render, before its output changes the page (React calls it at commit, before the mutations).
  const snapshot = inst.getSnapshotBeforeUpdate ? inst.getSnapshotBeforeUpdate(prevProps, prevState) : undefined;
  if (inst.getSnapshotBeforeUpdate) checkSnapshot(C, snapshot);
  propsReassigned(C, inst, props);
  if (inst.componentDidUpdate) f.layout!.push(() => !f.dead && lifecycle(f, () => inst.componentDidUpdate(prevProps, prevState, snapshot)));
  const done = inst.__done?.splice(0);
  if (done?.length) f.layout!.push(() => lifecycle(f, () => done.forEach((cb: any) => callCallback(cb, inst))));
  attach?.();
  return out;
}
const FORCE = Symbol("force");
function propsReassigned(C: any, inst: any, props: any) {
  if (dev() && inst.props !== props)
    warn(`It looks like ${C.displayName || C.name || "Component"} is reassigning its own \`this.props\` while rendering. This is not supported and can lead to confusing bugs.`, "props-reassigned:" + (C.displayName || C.name));
}
/** getDerivedStateFromProps' partial state (twice in StrictMode), checked as React checks it. */
function derived(f: Fiber, C: any, props: any, state: any) {
  const partial = strictTwice(f, () => C.getDerivedStateFromProps(props, state), true);
  checkDerivedState(C, partial);
  return partial;
}
function shouldUpdate(f: Fiber, C: any, inst: any, props: any, state: any, ctx: any) {
  const r = strictTwice(f, () => inst.shouldComponentUpdate(props, state, ctx), true);
  checkShouldUpdate(C, r);
  return r;
}

/** setState or forceUpdate on an instance React has not mounted: nothing, and React's warning (once per class). */
/** An update asked while a component renders: React's warnings (another function component, or any class). */
/** An update made outside act where the test said it uses act (IS_REACT_ACT_ENVIRONMENT): React's warning. */
function updateOutsideAct(target: Fiber) {
  if (actDepth > 0 || current || !dev() || (globalThis as any).IS_REACT_ACT_ENVIRONMENT !== true) return;
  warn(
    `An update to ${nameOf(target.type) || "Component"} inside a test was not wrapped in act(...).\n\nWhen testing, code that causes React state updates should be wrapped into act(...):\n\nact(() => {\n  /* fire events that update state */\n});\n/* assert on the output */\n\nThis ensures that you're testing the behavior the user would see in the browser. Learn more at https://react.dev/link/wrap-tests-with-act`,
  );
}

/** A class's render method running now. */
let inClassRender = false;
function classRender(inst: any) {
  const was = inClassRender;
  inClassRender = true;
  try {
    return inst.render();
  } finally {
    inClassRender = was;
  }
}

function updateWhileRendering(target: Fiber) {
  updateOutsideAct(target);
  // A render thrown away before it committed (a hydration that suspended): React warns, from what is mounted above.
  let b: Fiber | null = target.dead ? target.parent : null;
  while (b && !(b as any).dehydrated && b.type !== SUSPENSE) b = b.parent;
  if (b && !(b as any).dehydrated) b = null;
  if (dev() && !current && target.dead && (!target.committed || b)) {
    let at: Fiber | null = target.parent;
    while (at && !(at.kind === COMP && at.committed && !at.dead)) at = at.parent;
    notYetMounted(at ?? target);
  }
  // (Its boundary, still as the server drew it, tries hydrating again for it.)
  if (b && !b.dead) scheduleHydration(b);
  if (!current || !dev()) return;
  if (target.inst) {
    // Only from a render method (React's isRendering): a will-lifecycle may set state.
    if (inClassRender) warn("Cannot update during an existing state transition (such as within `render`). Render methods should be a pure function of props and state.", "update-in-render");
    return;
  }
  if (current === target) return;
  const rendering = nameOf(current.type) || "Unknown";
  warn(
    `Cannot update a component (\`${nameOf(target.type) || "Unknown"}\`) while rendering a different component (\`${rendering}\`). To locate the bad setState() call inside \`${rendering}\`, follow the stack trace as described in https://react.dev/link/setstate-in-render`,
    "update-other:" + rendering,
  );
}

function notYetMounted(f: Fiber) {
  withFiber(f, () =>
    warn(
      "Can't perform a React state update on a component that hasn't mounted yet. This indicates that you have a side-effect in your render function that asynchronously tries to update the component. Move this work to useEffect instead.",
      "not-yet-mounted:" + nameOf(f.type),
    ),
  );
}

function notMounted(inst: any, what: string) {
  const name = inst.constructor?.displayName || inst.constructor?.name || "ReactClass";
  warn(
    `Can't call ${what} on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to \`this.state\` directly or define a \`state = {};\` class property with the desired state in the ${name} component.`,
    "notMounted:" + name + "." + what,
  );
}

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
    warnOnInvalidCallback(done);
    if (!this.__f) return notMounted(this, "setState");
    // Drawn but not committed yet, set from the commit (a sibling's componentWillUnmount): React warns.
    if (dev() && inDeletions && !current && !this.__f.committed && !this.__f.dead) notYetMounted(this.__f);
    updateWhileRendering(this.__f);
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
    warnOnInvalidCallback(done);
    if (!this.__f) return notMounted(this, "forceUpdate");
    this.__queue.push(FORCE);
    if (done) (this.__done ??= []).push(done);
    this.__f.tick!.set(this.__f.tick!.peek() + 1);
  }
  /** Each class gives its own (React's Component has none: a class without one fails to render). */
  declare render: () => any;
}
(Component.prototype as any).isReactComponent = {};
// The old createClass methods: a warning on reading them in development, as React's Component has.
for (const [name, why] of [
  ["isMounted", "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."],
  ["replaceState", "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."],
])
  Object.defineProperty(Component.prototype, name, {
    get() {
      if (dev()) console.warn(`${name}(...) is deprecated in plain JavaScript React classes. ${why}`);
      return undefined;
    },
  });
// React's updater, which a class may reach into (this.updater.enqueueReplaceState…).
(Component.prototype as any).updater = {
  isMounted: (inst: any) => !!inst.__f?.committed && !inst.__f.dead,
  enqueueSetState: (inst: any, partial: any, done?: () => void) => inst.setState(partial, done),
  enqueueForceUpdate: (inst: any, done?: () => void) => inst.forceUpdate(done),
  enqueueReplaceState: (inst: any, state: any, done?: () => void) => {
    if (!inst.__f) return;
    inst.__queue.push({ [REPLACE]: state });
    if (done) (inst.__done ??= []).push(done);
    inst.__f.tick!.set(inst.__f.tick!.peek() + 1);
  },
};

export class PureComponent<P = any, S = any> extends Component<P, S> {}
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
/** (`inclusive`: thrown by `f`'s own elements, below it: `f` itself may be the boundary that takes it.) */
/** A boundary kept waiting by one thenable: let go when it settles, or when what threw it renders without it. */
type Hold = { s: Fiber; held: boolean; waits: PromiseLike<unknown> };
let lastHold: Hold | null = null;
function release(h: Hold) {
  if (!h.held) return;
  h.held = false;
  h.s.pending!.set(Math.max(0, h.s.pending!.peek() - 1));
}

function caught(f: Fiber, e: any, inclusive = false) {
  // A pre-warming render's: thrown away with it.
  if (prewarming) return;
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
    // (Not inside a hidden Activity: nothing there is seen, so its fallback is drawn, hidden, as React does.)
    if (applyingTransition && f.committed && !(hiddenActivities && insideHidden(f))) {
      // No boundary above: rendered once more after the commit, off the page (React's pre-warming).
      if (!boundaryOf(f.parent ?? f)) prewarmFibers.push(f);
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
      // Tried again as a transition, in a task of its own (not in the microtask its data settles in).
      e.then(() => deferTransition(() => !f.dead && restart(f)), () => {});
      return;
    }
    for (let p = f.parent; p; p = p.parent) {
      if (p.type === SUSPENSE && p.pending && !p.dead) {
        const s = p;
        s.pending!.set(s.pending!.peek() + 1);
        const hold = (lastHold = { s, held: true, waits: e });
        // Drawing now: it draws again at once with its fallback (React shows it in the same render); before its
        // children were ever shown, the siblings after this one are not rendered (React skips them).
        if (drawing.has(s)) (s as any).resuspend = true;
        // Settled: the boundary shows its children again, and this component (kept, if the children kept
        // their shape) tries again.
        const done = () => {
          release(hold);
          if (!f.dead && f.kind === COMP) restart(f);
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
    // No boundary: drawn again when it settles (a root drawn off the page waits for it instead).
    if (offPage) return void (offPage.waits ??= e);
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
  for (let p = inclusive ? f : f.parent; p; p = p.parent) {
    const inst = p.inst;
    // (Not one rendering its error state now: what fails there goes further up, as React does.)
    if (!inst || p.dead || (p as any).retrying) continue;
    // A boundary that fails while asked (a throwing componentDidCatch getter): its error goes to the next one up.
    let handles: boolean;
    try {
      handles = !!(p.type.getDerivedStateFromError || inst.componentDidCatch);
    } catch (x) {
      (e = x), (f = p);
      continue;
    }
    if (handles) {
      lastCaughtByBoundary = e;
      // From the commit: asked when the boundary renders again (React's error update), after the other effects.
      if (p.type.getDerivedStateFromError) inst.__queue.push(committing ? () => p.type.getDerivedStateFromError(e) : p.type.getDerivedStateFromError(e));
      if (inst.componentDidCatch)
        layoutQueue.push(() => {
          if (p.dead) return;
          const tick = p.tick?.peek();
          const queued = inst.__queue.length;
          guard(() => inst.componentDidCatch(e, { componentStack: componentStackOf(f) }));
          // With no getDerivedStateFromError and no update of its own, it swallows the error: React says so.
          if (dev() && !p.type.getDerivedStateFromError && p.tick?.peek() === tick && inst.__queue.length === queued)
            withFiber(p, () => warn(`${nameOf(p.type)}: Error boundaries should implement getDerivedStateFromError(). In that method, return a state update to display an error message or fallback UI.`));
        });
      if (rendering) (p.root as any).threw = true;
      // What fails while telling it (a name getter that throws) is an error of its own, reported.
      const tell = () => {
        try {
          (p.root.onCaughtError ?? toldCaught(f, p))(e, { componentStack: componentStackOf(f), errorBoundary: inst });
        } catch (x) {
          uncaughtListener ? uncaughtListener(x) : report(x);
        }
      };
      if (rendering) caughtThisRender.push(() => !p.dead && tell());
      else tell();
      // Rendering now (its draw under way): it renders again when its own render is done, in its error state.
      if (drawing.has(p)) (p as any).redo = true;
      else scheduledInCommit(), p.tick!.set(p.tick!.peek() + 1);
      return;
    }
  }
  // In a concurrent render: it stops, and the root is rendered again synchronously once (React's recovery).
  if (work?.recover && work.root === f.root && !work.errored) {
    work.errored = { error: e };
    // (In a task of its own: the work loop can yield before it.)
    work.units.length = 0;
    work.units.push(() => {});
    return;
  }
  uncaught(f.root, e, f);
}

// ---------------------------------------------------------------- effects and commit

let flushHeld = false;
holdFlushes(() => committing && (flushHeld = true));

// Counted as rendering while it runs: an event it fires (a focus() in a layout effect) does not flush from inside.
/** Commits so far (a test's scheduler waits for a paint by it). */
let commitCount = 0;
/** The commit is taking away what went (componentWillUnmount, cleanups): what it drew is not mounted yet. */
let inDeletions = false;
export const commits = () => commitCount;
function commit() {
  // A concurrent render under way: committed when it is done.
  if (work) return;
  commitCount++;
  depth++;
  const wasCommitting = committing;
  committing = true;
  if (dev()) flushUnsafeLifecycleWarnings();
  try {
    untrack(() => {
      // What was taken away first (componentWillUnmount, effect cleanups, refs let go), then what was made.
      // The commit's time is its start's, before anything changes (React's commitStartTime).
      const commitTime = now();
      inDeletions = true;
      try {
        for (let i = 0; i < deletions.length; i++) timed(deletions[i]!, effectTime);
      } finally {
        inDeletions = false;
      }
      deletions.length = 0;
      for (let i = 0; i < insertionQueue.length; i++) guard(insertionQueue[i]!);
      insertionQueue.length = 0;
      // In the page from now on: events reach their handlers (before, React finds no mounted fiber).
      for (const f of fresh) (f as any).placed = true;
      restoreFocus();
      inEffects++;
      try {
        for (let i = 0; i < layoutQueue.length; i++) timed(layoutQueue[i]!, effectTime);
      } finally {
        inEffects--;
        effectsDone();
      }
      layoutQueue.length = 0;
      const made = fresh.splice(0);
      for (const f of made) (f.committed = true), ((f as any).placed = true);
      viewTransitionsCommit(
        made.filter((f) => f.type === VIEW_TRANSITION),
        applyingTransition || transitionCommit,
      );
      if (dev()) {
        // Only where the topmost fiber placed is in strict mode (React's PlacementDEV walk): a new non-strict parent's
        // nested StrictMode doubles nothing.
        const madeSet = new Set(made);
        const topStrict = (f: Fiber) => {
          let t = f;
          // (A fragment given to the root is no fiber of its own in React: its children are the ones placed.)
          while (t.parent && madeSet.has(t.parent) && !(t.parent.type === FRAGMENT && !t.parent.parent?.parent)) t = t.parent;
          return !!(t as any).strict || t.type === STRICT;
        };
        const strictMade = made.filter((f) => (f as any).strict && !f.dead && topStrict(f));
        if (strictMade.length) passiveQueue.push(() => doubleInvoke(strictMade));
      }
      tellProfilers(commitTime);
    });
  } finally {
    committing = wasCommitting;
    depth--;
  }
  // A flush its microtask asked for during the commit (React's commit context): done now.
  if (!committing && flushHeld) {
    flushHeld = false;
    flushSignals();
  }
  if (depth === 0) recoveredThisRender = false;
  if (depth === 0 && typeof document !== "undefined" && (document as any).$$reactFormReplay?.length) replayFormActions(document);
  if (prewarms.length && depth === 0) prewarm();
  // (What a transition left suspended, pre-warmed in a later task, as React schedules it.)
  if (prewarmFibers.length && depth === 0 && !prewarmBooked) {
    prewarmBooked = true;
    deferTransition(() => {
      prewarmBooked = false;
      prewarm();
    });
  }
  if ((passiveQueue.length || passiveUnmounts.length) && !passiveBooked) {
    passiveBooked = true;
    afterPaint(() => runPassive(true));
  }
}

/** Boundaries that have just shown their fallback: their children rendered once more off the page after the commit,
 * and thrown away (React's pre-warming, which starts loading what they wait for). */
const prewarms: Fiber[] = [];
let prewarming = false;
/** Components a transition suspended with no boundary above: rendered again after the commit, off the page. */
const prewarmFibers: Fiber[] = [];
let prewarmBooked = false;
function prewarm() {
  const list = prewarms.splice(0);
  const lone = prewarmFibers.splice(0);
  prewarming = true;
  // Inside a render of its own: nothing it makes is committed, none of its effects run.
  depth++;
  const freshBefore = fresh.length;
  const queued = [layoutQueue.length, passiveQueue.length, insertionQueue.length];
  try {
    for (const f of lone) if (!f.dead) renderAgain(f);
    for (const s of list) {
      if (s.dead || !s.pending!.peek()) continue;
      const kept = s.children.find((c) => c.key === "kc");
      if (kept) {
        // Its children are still there (hidden): what suspended in them renders again, its output dropped.
        const waiting: Fiber[] = [];
        const walk = (f: Fiber) => {
          if (f.kind === COMP && (f as any).suspended && f.render) waiting.push(f);
          for (const c of f.children) walk(c);
        };
        walk(kept);
        for (const f of waiting) renderAgain(f);
        continue;
      }
      const scratch: Fiber = fiber(FRAG, FRAGMENT, "prewarm", null, s);
      try {
        reconcile(scratch, toList(s.props?.children), docOf(hostParentOf(s)).createDocumentFragment(), null);
      } catch {}
      for (const c of scratch.children) unmount(c, false);
      scratch.dead = true;
    }
  } finally {
    fresh.length = freshBefore;
    layoutQueue.length = queued[0]!;
    passiveQueue.length = queued[1]!;
    insertionQueue.length = queued[2]!;
    depth--;
    prewarming = false;
  }
}

/** A mounted component's render run again, its output and effects dropped (pre-warming). */
function renderAgain(f: Fiber) {
  const was = { current, hookAt, insertion: f.insertion, layout: f.layout, passive: f.passive };
  current = f;
  hookAt = 0;
  f.insertion = [];
  f.layout = [];
  f.passive = [];
  try {
    untrack(() => f.render!(f, f.props));
  } catch {
  } finally {
    current = was.current;
    hookAt = was.hookAt;
    f.insertion = was.insertion;
    f.layout = was.layout;
    f.passive = was.passive;
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
    if (passiveQueue.length || passiveUnmounts.length) runPassive(true);
    else if (!flushTransitions()) return;
  }
}

/**
 * React's act: runs `fn`, then everything it set off (updates, effects after paint), so a test sees the result.
 * Returns a thenable either way, as React's does; for an async `fn`, settled once it has.
 */
/** Inside React.act: updates wait (events included) and are drawn when the outermost act ends. */
let actDepth = 0;
export const insideAct = () => actDepth > 0;
/** For a test runner: what a test left hanging (an act, an async action, a suspended transition) forgotten. */
export const resetAct = () => void ((actDepth = 0), (actionsRunning = 0), actionsEra++, (transitionsSuspended = 0), (transitionEnds.length = 0), (transitionWork.length = 0), (prewarms.length = 0), (nestedSync = 0), (nestedPassive = 0), (passiveQueue.length = 0), (passiveUnmounts.length = 0), (focusedBefore = undefined), toHydrate.clear(), hoverTargets.clear(), (replayScheduled = false), (deferredWaiting = 0), hydrationEra++, (transitionHeld = null), (transitionRetried = false), resetViewTransitions());

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
  const depthBefore = actDepth;
  actDepth++;
  try {
    r = fn();
  } catch (e) {
    actDepth--;
    off();
    throw e;
  }
  if (r && typeof (r as any).then === "function") {
    // Another act begun and not ended inside this one's time (not awaited in turn): React's warning, at its end.
    const overlapping = () => {
      if (dev() && depthBefore !== actDepth - 1)
        console.error("You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. ");
    };
    const settled = (r as Promise<T>).then(
      async (v) => {
        overlapping();
        try {
          // What it set off, then what that sets off (promises settling, effects updating), until nothing is left
          // (still inside act while it does).
          if (actDepth === 1) await drainAct();
        } finally {
          actDepth--;
          done();
        }
        return v;
      },
      (e) => {
        overlapping();
        actDepth--;
        off();
        throw e;
      },
    );
    // Not awaited (nothing asked for its result in a few microtasks): React's warning.
    let awaited = false;
    if (dev())
      queueMicrotask(() =>
        queueMicrotask(() => {
          if (!awaited)
            console.error("You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);");
        }),
      );
    return { then: (ok?: any, no?: any) => ((awaited = true), settled.then(ok, no)) };
  }
  try {
    if (actDepth === 1) settleAll();
  } finally {
    actDepth--;
    done();
  }
  // Awaited: what promises set off meanwhile is drawn before it resolves, as React's act does then (not inside an
  // outer act, which does it when it ends).
  return { then: (ok?: any, no?: any) => (depthBefore > 0 ? Promise.resolve(r as T) : drainAct().then(() => r as T)).then(ok, no) };
}

/** Act's last turns: promises settling and the updates they make, drawn until nothing more comes (inside act). */
async function drainAct() {
  actDepth++;
  try {
    for (let i = 0; i < 20; i++) {
      const before = renderSerial;
      settleAll();
      for (let k = 0; k < 5; k++) await Promise.resolve();
      if (renderSerial === before && !somethingPending()) break;
    }
    settleAll();
  } finally {
    actDepth--;
  }
}

/** Whether updates, effects or transitions are still waiting to be drawn. */
export const somethingPending = () => passiveQueue.length > 0 || passiveUnmounts.length > 0 || transitionWork.length > 0 || continuousWork.length > 0;
/** Updates made during a continuous event (a hover, a move, a scroll): React gives them a lane flushSync() leaves. */
const continuousWork: (() => void)[] = [];
const CONTINUOUS_EVENTS = new Set("drag dragenter dragexit dragleave dragover mousemove mouseout mouseover pointermove pointerout pointerover scroll touchmove wheel mouseenter mouseleave pointerenter pointerleave".split(" "));
/** A state update given its lane: at once while its component renders, as a transition inside one, after the
 * urgent ones during a continuous event, else now. */
function enqueueUpdate(f: Fiber, apply: () => void, preview: (p: Preview) => void) {
  if (current === f) return apply();
  if (inTransition(apply, preview, f)) return;
  if (!duringContinuousEvent()) return apply();
  continuousWork.push(apply);
  scheduleTransitions(flushTransitions);
}
function duringContinuousEvent(): boolean {
  if (syncing) return false;
  const e: any = typeof window !== "undefined" ? (window as any).event : undefined;
  return !!e && CONTINUOUS_EVENTS.has(e.type);
}

/** Effects waiting for after paint, run now (React's act does this): for tests and tools. */
export function flushPassiveEffects() {
  if (depth === 0) runPassive(true);
}

function runPassive(drawAfter: boolean) {
  passiveBooked = false;
  if (!passiveQueue.length && !passiveUnmounts.length) return;
  const run = [...passiveUnmounts.splice(0), ...passiveQueue.splice(0)];
  untrack(() => {
    inEffects++;
    const wasPassive = inPassive;
    inPassive = true;
    updatedInPassive = false;
    try {
      for (const fn of run) timed(fn, passiveTime);
    } finally {
      inEffects--;
      inPassive = wasPassive;
      nestedPassive = updatedInPassive ? nestedPassive + 1 : 0;
      effectsDone();
    }
    tellPostCommit();
  });
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
      const box = state(f, typeof init === "function" ? strictTwice(f, init as () => T) : init);
      box.set = (v: any) => {
        updateWhileRendering(f);
        const apply = () => box.put(typeof v === "function" ? strictTwice(f, () => v(box.v), true) : v);
        const preview = (p: Preview) => {
          const was = p.states.has(box) ? p.states.get(box) : box.v;
          p.states.set(box, typeof v === "function" ? v(was) : v);
        };
        enqueueUpdate(f, apply, preview);
      };
      return box;
    });
    return [h.read(), h.set];
  },
  useReducer(reducer: any, arg: any, init?: any) {
    const f = current!;
    const h = hook(() => {
      const box = state(f, init ? strictTwice(f, () => init(arg)) : arg);
      box.reducer = reducer;
      box.dispatch = (a: any) => {
        updateWhileRendering(f);
        // While its own component renders: kept for the next pass, reduced there with the reducer given then.
        if (current === f) return void (box.rendering ??= []).push(a), ((f as any).again = true);
        const apply = () => box.put(strictTwice(f, () => box.reducer(box.v, a), true));
        const preview = (p: Preview) => p.states.set(box, box.reducer(p.states.has(box) ? p.states.get(box) : box.v, a));
        enqueueUpdate(f, apply, preview);
      };
      return box;
    });
    h.reducer = reducer;
    if (h.rendering?.length) for (const a of h.rendering.splice(0)) h.v = insideHook(() => reducer(h.v, a));
    return [h.read(), h.dispatch];
  },
  useRef<T>(init: T) {
    return hook(() => ({ current: init }));
  },
  useMemo<T>(fn: () => T, deps?: any[]): T {
    const f = current!;
    const h = hook(() => ({ deps: undefined as any, value: undefined as any }));
    if (!deps || depsChanged(h.deps, deps)) {
      h.value = strictTwice(f, () => insideHook(fn));
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
          const cleanup = ref(create());
          return () => (typeof cleanup === "function" ? cleanup() : ref(null));
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
  // dispatcher.readContext: a context read allowed anywhere React renders (a class's render method too).
  readContext(ctx: any) {
    if (!current) throw new Error(INVALID_HOOK_CALL);
    // Inside a hook's own function (React's nested-hooks dispatcher): read, and warned about.
    if (inHook)
      warn("Context can only be read while React is rendering. In classes, you can read it in the render method or getDerivedStateFromProps. In function components, you can read it directly in the function body, but not inside Hooks like useReducer() or useMemo().");
    return readContext(current, ctx);
  },
  useContext(ctx: any) {
    // A hook like the others: not in a class's render (React's dispatcher there throws).
    if (!current || current.inst) throw new Error(INVALID_HOOK_CALL);
    return readContext(current, ctx);
  },
  useId() {
    const f = current!;
    // While hydrating, from the tree position (as the server made it); otherwise a counter (React's client ids).
    return hook(() => {
      const local = ((f as any).idCalls = ((f as any).idCalls ?? 0) + 1) - 1;
      (f as any).usedId = true;
      const prefix = (f.root as any).idPrefix ?? "";
      return hydrating ? makeId(prefix, "R", treeOf(f), local) : makeId(prefix, "r", f.root.ids++, 0);
    });
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
    // (Mounting while hydrating, even in a transition: the initial value, as the server drew it.)
    const hydratingMount = hydrating && !h.seen;
    h.seen = true;
    if (Object.is(value, shown) || (applyingTransition && !hydratingMount && !eagerTransition)) {
      if (!Object.is(value, shown)) h.v = value;
      return value;
    }
    h.wanted = value;
    if (!h.booked) {
      h.booked = true;
      deferredWaiting++;
      deferTransition(() => {
        h.booked = false;
        // (Waited on until it is committed.)
        layoutQueue.push(() => void deferredWaiting--);
        h.put(h.wanted);
      });
    }
    return shown;
  },
  useDebugValue() {},
  useActionState(action: (state: any, payload: any) => any, initial: any) {
    const f = current!;
    const h = hook(() => {
      // shown: the state rendered; v: the state the queue has reached (actions chain on it, unseen until the end).
      const box: any = { shown: signal(initial), v: initial, pending: signal(false), queue: [] as any[], running: false, error: undefined, action };
      // The queue's end: its state shown (and pending off) in one update — a transition's, when it was dispatched in one.
      const finish = (inTransition: boolean) => {
        const apply = () => {
          box.shown.set(box.v);
          box.pending.set(false);
        };
        if (inTransition) deferTransition(apply);
        else apply();
        flushSignals();
      };
      const fail = (e: unknown, inTransition: boolean) => {
        // Thrown where the state is read, so the component's boundary gets it; what was queued is dropped.
        box.error = { e };
        for (const q of box.queue.splice(0)) q.done();
        box.running = false;
        const apply = () => {
          box.pending.set(false);
          box.shown.set(box.shown.peek() === FAILED ? FAILED_AGAIN : FAILED);
        };
        if (inTransition) deferTransition(apply);
        else apply();
        flushSignals();
      };
      // One after another, each with the state the last one reached, with the action it was dispatched with.
      const run = () => {
        box.running = true;
        const entry = box.queue.shift();
        let r: any;
        const was = transitioning;
        if (entry.inTransition) transitioning++;
        try {
          r = entry.action(box.v, entry.payload);
        } catch (e) {
          entry.done();
          return fail(e, entry.inTransition);
        } finally {
          transitioning = was;
        }
        const take = (v: any) => {
          box.v = v;
          entry.done();
          if (box.queue.length) return run();
          box.running = false;
          finish(entry.inTransition);
        };
        if (r && typeof r.then === "function") {
          if (!entry.inTransition)
            warn(
              "An async function with useActionState was called outside of a transition. This is likely not what you intended (for example, isPending will not update correctly). Either call the returned function inside startTransition, or pass it to an `action` or `formAction` prop.",
            );
          r.then(take, (e: unknown) => (entry.done(), fail(e, entry.inTransition)));
        } else take(r);
      };
      // Settles once this action has run: a form whose action this is stays pending until then.
      box.dispatch = (payload: any) => {
        if (current) throw new Error("Cannot update action state while rendering.");
        let done!: () => void;
        const settled = new Promise<void>((r) => (done = r));
        // Pending at once (an urgent update, even inside a transition), and until the queue is done.
        if (!box.pending.peek()) box.pending.set(true);
        box.queue.push({ payload, done, action: box.action, inTransition: transitioning > 0 });
        if (!box.running) run();
        flushSignals();
        return settled;
      };
      return box;
    });
    void f;
    h.action = action;
    const shown = h.shown();
    if (h.error !== undefined) {
      const e = h.error.e;
      h.error = undefined;
      throw e;
    }
    return [shown === FAILED || shown === FAILED_AGAIN ? h.v : shown, h.dispatch, h.pending()];
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
    // browser(): in the browser, nothing to wait for.
    if (usable && usable.$$typeof === RECOVERABLE) return undefined;
    return readThenable(usable);
  },
};

function effectHook(create: () => any, deps: any[] | undefined, phase: "insertion" | "layout" | "passive") {
  const f = current!;
  const h = hook(() => ({ deps: undefined as any, cleanup: null as any, first: true, phase: "passive" as typeof phase, create: create, ranIn: 0 }));
  // Compared with the deps of the effect that ran: a render that never committed (a render-phase pass) sets none.
  if (!h.first && deps && !depsChanged(h.deps, deps)) return;
  h.phase = phase;
  h.create = create;
  f[phase]!.push(() => {
    if (f.dead) return;
    h.ranIn = renderSerial;
    h.first = false;
    h.deps = deps;
    const wasFiber = effectFiber;
    effectFiber = f;
    // A cleanup runs once, and one that throws does not keep the effect from running (React's separate passes).
    const cleanup = h.cleanup;
    h.cleanup = null;
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch (e) {
        caught(f, e);
      }
    }
    try {
      const back = create();
      h.cleanup = typeof back === "function" ? back : null;
    } catch (e) {
      caught(f, e);
    } finally {
      effectFiber = wasFiber;
    }
  });
}

// ---------------------------------------------------------------- transitions

/** Inside startTransition: the updates set are a transition's, drawn after what is urgent. */
let transitioning = 0;
type TransitionUpdate = { apply: () => void; preview?: (p: Preview) => void; fiber?: Fiber };
const transitionWork: TransitionUpdate[] = [];
/** Transitions drawn that suspended, their data still awaited: their ends wait. */
let transitionsSuspended = 0;
/** Async actions running (React's async action scope): every transition's end waits for them all. */
let actionsRunning = 0;
let actionsEra = 0;
/** An async action started: its end (and every transition's) waits until it settles. */
function actionStarted(r: PromiseLike<any>) {
  actionsRunning++;
  const era = actionsEra;
  const over = () => {
    if (era !== actionsEra) return;
    actionsRunning--;
    if (!transitionBooked && transitionEnds.length) (transitionBooked = true), scheduleTransitions(flushTransitions);
  };
  r.then(over, over);
}
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
  // Started during a popstate (the browser restoring a page): drawn with that event's urgent updates, in one render
  // (React's eager transition), still a transition that may wait for data.
  if (typeof window !== "undefined" && (window as any).event?.type === "popstate" && !eagerBooked) {
    eagerBooked = true;
    queueMicrotask(() => {
      eagerBooked = false;
      eagerTransition = true;
      try {
        flushTransitions();
      } finally {
        eagerTransition = false;
      }
    });
  }
  return true;
}
let eagerBooked = false;
/** A popstate's transition being drawn at once (React's SyncLane for it): deferred values still wait in it. */
let eagerTransition = false;
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
  // What continuous events updated (their own lane, ahead of transitions).
  if (continuousWork.length) {
    for (const apply of continuousWork.splice(0)) apply();
    flushSignals();
  }
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
  // With boundaries on the page, drawn inside the browser's view transition (the old state captured first).
  if (!viewTransitionWaiting) {
    viewTransitionWaiting = true;
    const wrapped = renderInViewTransition(() => {
      viewTransitionWaiting = false;
      applyTransitions();
      // What was asked for meanwhile, drawn next.
      if (transitionWork.length && !transitionBooked) (transitionBooked = true), scheduleTransitions(flushTransitions);
    });
    // Drawn when the browser calls back (at once in a test's stand-in, on its next frame in a browser).
    if (wrapped) return true;
    viewTransitionWaiting = false;
  } else return false;
  return applyTransitions();
}

/** A view transition started, its render not run yet: transitions wait for it. */
let viewTransitionWaiting = false;

function applyTransitions(): boolean {
  applyingTransition = true;
  viewTransitionsBegin();
  try {
    for (const w of transitionWork.splice(0)) w.apply();
    flushSignals();
    if (transitionWaits.length) {
      // Suspended: its end waits for the data, then the transition is drawn again.
      const waits = transitionWaits.splice(0);
      let left = waits.length;
      transitionsSuspended++;
      const settled = () => {
        if (--left) return;
        transitionsSuspended--;
        if (!transitionBooked && transitionEnds.length) (transitionBooked = true), scheduleTransitions(flushTransitions);
      };
      for (const p of waits) p.then(settled, settled);
      return true;
    }
    // A transition still suspended: the ends (pending states, form resets) wait for it.
    if (!transitionsSuspended && !actionsRunning) for (const w of transitionEnds.splice(0)) w();
    flushSignals();
  } finally {
    applyingTransition = false;
  }
  return true;
}

/** A root drawn off the page (in place of server markup that did not match): what suspends with no boundary holds it. */
let offPage: { waits: PromiseLike<any> | null } | null = null;

// ---------------------------------------------------------------- Fast Refresh (react-refresh's renderer contract)

/** How react-refresh tells which components are versions of one another (set by it, through the hook). */
let resolveFamily: ((type: any) => any) | null = null;
const familyOf = (type: any) => (resolveFamily && type != null && typeof type !== "string" ? resolveFamily(type) : undefined);
/** The newest version of a component (an element may still name an older one, from a module not run again). */
const latestOf = (type: any) => (typeof type === "function" ? (familyOf(type)?.current ?? type) : type);
function sameFamily(a: any, b: any): boolean {
  if (!resolveFamily || a == null || b == null || typeof a === "string" || typeof b === "string") return false;
  const fa = familyOf(a);
  return fa !== undefined && fa === familyOf(b);
}

/** Each root as react-refresh keeps it (an object it asks `current.memoizedState.element` of), to the root's top. */
type RefreshRoot = { current: { memoizedState: { element: any } | null; alternate: any }; top: Fiber; render?: (element: any) => void };
let hookId: any;
let registered = false;
const devHook = (): any => (typeof window !== "undefined" && dev() ? (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ : undefined);

/** A refresh: components whose code changed drawn again with it (their state kept), stale ones mounted afresh. */
function scheduleRefresh(root: RefreshRoot, update: { updatedFamilies: Set<any>; staleFamilies: Set<any> }) {
  const walk = (f: Fiber) => {
    if (f.dead) return;
    if (f.kind === COMP) {
      const family = familyOf(f.type) ?? familyOf(f.type?.type) ?? familyOf(f.type?.render);
      if (family && (update.staleFamilies.has(family) || update.updatedFamilies.has(family))) {
        const latest = family.current;
        // A memo or forwardRef keeps its wrapper: the code inside it is the new one.
        if (f.type?.type !== undefined && familyOf(f.type.type) === family) f.type = { ...f.type, type: latest };
        else if (f.type?.render !== undefined && familyOf(f.type.render) === family) f.type = { ...f.type, render: latest };
        else f.type = latest;
        if (update.staleFamilies.has(family)) {
          // Its hooks changed shape: mounted again, from nothing.
          for (const c of f.children) unmount(c, true);
          f.children = [];
          for (const h of f.hooks ?? []) if (h?.cleanup) lifecycle(f, h.cleanup);
          f.hooks = [];
          f.inst = undefined;
        }
        f.render = renderer(f.type, f);
        restart(f);
      }
    }
    for (const c of [...f.children]) walk(c);
  };
  for (const c of [...root.top.children]) walk(c);
  flushSignals();
}

/** This renderer, made known to react-refresh (through the DevTools hook it patches, or one made now). */
function registerWithRefresh(): boolean {
  if (registered) return true;
  const w = typeof window !== "undefined" ? (window as any) : null;
  if (!w || !dev()) return false;
  // react-refresh patches the hook when it loads; if we load first, a minimal one it will find and patch.
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
    renderers: new Map(),
    supportsFiber: true,
    inject(r: any) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
  // The id as the hook answers it (react-refresh keys us by it, even when it is none).
  hookId = devHook().inject({
    bundleType: 1,
    version: "19.3.0",
    rendererPackageName: "react-dom",
    scheduleRefresh,
    setRefreshHandler: (handler: ((type: any) => any) | null) => (resolveFamily = handler),
    scheduleRoot: (root: RefreshRoot, element: any) => root.render?.(element),
    findFiberByHostInstance: () => null,
  });
  return (registered = true);
}
/** A root committed (mounted, updated or gone): told to the hook, so react-refresh knows it. */
function tellCommit(root: RefreshRoot, element: any) {
  if (!registerWithRefresh()) return;
  const was = root.current;
  root.current = { memoizedState: { element }, alternate: was.memoizedState?.element != null ? was : null };
  try {
    devHook()?.onCommitFiberRoot?.(hookId, root, undefined, false);
  } catch {}
}

/** A root's first render, done in a transition, committing now (its view transitions animate). */
let transitionCommit = false;

/** Transitions started so far: a submit's handlers that start one make its form pending. */
let transitionsStartedCount = 0;
function startTransitionWith(fn: () => any, pending?: Sig<number>) {
  transitionsStartedCount++;
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
  const async = r && typeof r.then === "function";
  if (async) actionStarted(r);
  if (!pending) return;
  const done = () => endTransition(() => pending.set(pending.peek() - 1));
  if (async) r.then(done, done);
  else done();
}
export const startTransition = (fn: () => any) => startTransitionWith(fn);


export function readContext(f: Fiber, ctx: any) {
  for (let p = f.parent; p; p = p.parent)
    if (p.kind === PROVIDER && p.type === ctx) {
      const now = p.value!();
      // Hydrating a boundary left dehydrated: the value it had then; its reader drawn again after with this one.
      if (contextThen?.has(p)) {
        const then = contextThen.get(p);
        if (!Object.is(then, now)) staleReaders.add(f);
        return then;
      }
      return now;
    }
  return ctx._defaultValue;
}
/** While a dehydrated boundary hydrates: the providers' values when it was left so (see setDehydrated). */
let contextThen: Map<Fiber, any> | null = null;
const staleReaders = new Set<Fiber>();

// ---------------------------------------------------------------- roots

/** What React accepts as a root's container: an element, a document, a fragment, or its mount-point comment. */
const validContainer = (n: any) =>
  !!n && (n.nodeType === 1 || n.nodeType === 9 || n.nodeType === 11);
const HYDRATE = Symbol("hydrate");

export function createRoot(container: Element | DocumentFragment, options?: any) {
  if (!validContainer(container)) throw new Error("Target container is not a DOM element.");
  const hydrating_ = !!options?.[HYDRATE];
  // Heard from the start while it hydrates (React listens to every event at once): what hovers or moves over markup
  // not hydrated yet is queued and replayed.
  if (hydrating_) for (const t of CONTINUOUS) want(t);
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
  const refreshRoot = { current: { memoizedState: null, alternate: null } } as unknown as RefreshRoot;
  (state as any).idPrefix = options?.identifierPrefix ?? "";
  const top = new FiberNode(ROOT, null, "", null, null, nsOf(container), state) as Fiber;
  top.dom = container;
  top.doc = docOf(container);
  // The whole root in strict mode (React's unstable_strictMode option).
  if (options?.unstable_strictMode && dev()) top.strict = true;
  addContainer(container, state);
  state.top = top;
  // The container finds its root fiber (React's container key), as an element finds its own.
  (container as any)[ROOT_FIBER] = top;
  state.onUncaughtError = options?.onUncaughtError;
  state.onCaughtError = options?.onCaughtError;
  (state as any).onRecoverable = options?.onRecoverableError;
  (state as any).onHydrated = options?.onHydrated;
  (state as any).onDeleted = options?.onDeleted;
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
  // An event on its server markup before it has hydrated: hydrated now, for that event's target (the boundaries not
  // holding it wait for later).
  /** The hydration suspended with no boundary, waiting for its data; and whether an update has made it a client render. */
  let hydrationWaiting = false;
  let clientInstead = false;
  let earlyTold = false;
  // (Suspended with no boundary: tried again at once too, as React attempts a sync hydration.)
  const waitingAgain = () => hydrationWaiting && !clientInstead && first && latest !== NONE;
  (state as any).hydratePending = () => hydrateFirst !== NONE || (first && hydrating_ && pending !== NONE) || waitingAgain();
  (state as any).hydrateNow = (target: Node) => {
    const children = hydrateFirst !== NONE ? hydrateFirst : first && hydrating_ && pending !== NONE ? pending : waitingAgain() ? latest : NONE;
    if (children === NONE || depth > 0) return;
    if (hydrateFirst !== NONE) hydrateFirst = NONE;
    else if (children === latest && hydrationWaiting) hydrationWaiting = false;
    else pending = NONE;
    const was = selectiveTarget;
    selectiveTarget = target;
    try {
      untrack(() => runWithOwner(null, () => renderNow(children)));
    } finally {
      selectiveTarget = was;
    }
  };
  /** The first render, off the page and able to stop between components (see the work loop). */
  function renderConcurrently(children: any) {
    first = false;
    const frag = docOf(container).createDocumentFragment();
    const wait = newCommitWait();
    const finish = () => {
      // An error with no boundary: what it drew goes, and the root renders again at once; told if that works.
      if (w.errored) {
        for (const c of top.children) unmount(c, false);
        top.children = [];
        top.dom = container;
        caughtThisRender.length = 0;
        first = true;
        renderNow(children);
        if (!(state as any).failed) {
          const error: any = new Error("There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.");
          error.cause = w.errored.error;
          (options?.onRecoverableError ?? report)(error, { componentStack: "" });
        }
        return;
      }
      const go = () => {
        top.dom = container;
        clearContainer(container);
        container.appendChild(frag);
        transitionCommit = true;
        try {
          commit();
        } finally {
          transitionCommit = false;
        }
        // What this render's errors are told, once it is committed (as renderNow does).
        (state as any).threw = false;
        for (const tell of caughtThisRender.splice(0)) tell();
        flushSignals();
      };
      // Its stylesheets loaded first, when it has some that are not (React's suspensey commit).
      const ready = commitWhenReady(wait);
      if (ready) ready(go);
      else go();
    };
    const w: Work = (work = { units: [], at: 0, deferring: true, finish, wait, recover: true, root: state });
    top.dom = frag;
    depth++;
    rendering = true;
    startRender();
    try {
      reconcile(top, toList(children), frag, null);
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
      const hydrate = first && hydrating_ && !clientInstead;
      // (Updated while its hydration waited: drawn on the client, the server's markup cleared, React's error told.)
      if (first && clientInstead && !earlyTold) {
        earlyTold = true;
        layoutQueue.push(() =>
          (options?.onRecoverableError ?? report)(new Error("This root received an early update, before anything was able hydrate. Switched the entire root to client rendering."), { componentStack: "" }),
        );
      }
      if (first) {
        first = false;
        if (!hydrate) {
          clearContainer(container);
        }
      }
      depth++;
      if (hydrate) (hydrating = new Map()), (mismatched = false), (attrsDiffer = false), (madeWhileHydrating = []), (hydrationWaits = null), (hydrationError = null), (rootDiff = dev() ? new DiffScope() : null);
      const wasRendering = rendering;
      rendering = true;
      if (depth === 1) startRender();
      // What the root's own elements throw (no component between): uncaught, as React has it.
      const draw = (into: Node = container) => {
        try {
          // (Hydrating a document: what the root holds besides its singletons the server wrote in <body>.)
          reconcile(top, toList(children), hydrating && into.nodeType === 9 && (into as Document).body ? (into as Document).body : into, null);
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
          const error: any = new Error("There was an error while hydrating but React was able to recover by instead client rendering the entire root.");
          error.cause = cause;
          const told = () => {
            (state as any).threw = false;
            for (const tell of caughtThisRender.splice(0)) tell();
            // (Caught by an error boundary on the client: that boundary handles it, as React has it; nothing to recover.)
            const handled = lastCaughtByBoundary !== null;
            if (!(state as any).failed && !handled) layoutQueue.push(() => (options?.onRecoverableError ?? report)(error, { componentStack: "" }));
          };
          const recoverOnClient = () => {
            // Told only if the root then renders without an error of its own (React reports it with the commit).
            (state as any).failed = false;
            lastCaughtByBoundary = null;
            // A document (or its <html>, <head>, <body>) is drawn in place: its singletons are the document's.
            if (container.nodeType === 9 || /^(HTML|HEAD|BODY)$/.test(container.nodeName)) {
              clearContainer(container);
              draw();
              return told();
            }
            // Off the page first: suspended with no boundary, the server's markup stays until it can be drawn whole.
            const frag = docOf(container).createDocumentFragment();
            const hold = { waits: null as PromiseLike<any> | null };
            const was = offPage;
            offPage = hold;
            top.dom = frag;
            try {
              draw(frag);
            } finally {
              offPage = was;
              top.dom = container;
            }
            if (hold.waits) {
              for (const c of top.children) unmount(c, false);
              top.children = [];
              caughtThisRender.length = 0;
              const again = () => {
                depth++;
                try {
                  recoverOnClient();
                } finally {
                  if (--depth === 0) commit();
                }
                flushSignals();
              };
              hold.waits.then(again, again);
              return;
            }
            clearContainer(container);
            container.appendChild(frag);
            told();
          };
          recoverOnClient();
        } else if (hydrate && hydrationWaits) {
          // Suspended with no boundary: nothing of this attempt is kept, the server's markup stays as it was.
          const waits = hydrationWaits;
          hydrationWaits = null;
          mismatched = false;
          attrsDiffer = false;
          for (const n of madeWhileHydrating.splice(0)) n.parentNode?.removeChild(n);
          discardingHydration = true;
          try {
            for (const c of top.children) unmount(c, false);
          } finally {
            discardingHydration = false;
          }
          top.children = [];
          first = true;
          hydrationWaiting = true;
          const again = () => {
            // (Updated meanwhile: drawn on the client already; or hydrated by an event since.)
            if (clientInstead || !first || !hydrationWaiting) return;
            hydrationWaiting = false;
            hydrateFirst = latest;
            pending = NONE;
            asked.set(asked.peek() + 1);
            flushSignals();
          };
          waits.then(again, again);
        } else if (hydrate) {
          dropUnclaimed(container, top);
          // (Unless an error no boundary caught already took the root down.)
          if (mismatched && !(state as any).failed) {
            // Markup that does not match: React throws away what it hydrated and draws the root on the client.
            const scope = rootDiff;
            const error = mismatchError(scope, mismatchedText);
            const at = scope?.at as Fiber | null;
            rootDiff = null;
            mismatched = false;
            attrsDiffer = false;
            for (const c of top.children) unmount(c, false);
            top.children = [];
            hydrating = null;
            const recover = options?.onRecoverableError ?? report;
            // Drawn off the page first: if it suspends with no boundary, the server's markup stays until it can be
            // drawn whole (React suspends the root's commit), then the mismatch is told.
            const clientRender = () => {
              // A document (or its <html>, <head>, <body>) is drawn in place: its singletons are the document's.
              if (container.nodeType === 9 || /^(HTML|HEAD|BODY)$/.test(container.nodeName)) {
                clearContainer(container);
                draw();
                (state as any).threw = false;
                for (const tell of caughtThisRender.splice(0)) tell();
                layoutQueue.push(() => withFiber(at, () => recover(error, { componentStack: "" })));
                return;
              }
              const frag = docOf(container).createDocumentFragment();
              const hold = { waits: null as PromiseLike<any> | null };
              const was = offPage;
              offPage = hold;
              top.dom = frag;
              try {
                draw(frag);
              } finally {
                offPage = was;
                top.dom = container;
              }
              if (hold.waits) {
                for (const c of top.children) unmount(c, false);
                top.children = [];
                caughtThisRender.length = 0;
                const again = () => {
                  depth++;
                  try {
                    clientRender();
                  } finally {
                    if (--depth === 0) commit();
                  }
                  flushSignals();
                };
                hold.waits.then(again, again);
                return;
              }
              clearContainer(container);
              container.appendChild(frag);
              (state as any).threw = false;
              for (const tell of caughtThisRender.splice(0)) tell();
              layoutQueue.push(() => withFiber(at, () => recover(error, { componentStack: "" })));
            };
            clientRender();
          }
        }
      } finally {
        rendering = wasRendering;
        if (hydrate) {
          hydrating = null;
          // Attributes are told only where the markup matched: a mismatch draws the whole root anew.
          const scope = rootDiff;
          rootDiff = null;
          if (attrsDiffer && !mismatched && scope) {
            const diff = describeDiff(scope);
            withFiber(firstDiffFiber(scope) as Fiber | null, () => console.error(HYDRATION_ATTRS_FORMAT, "https://react.dev/link/hydration-mismatch", diff));
          } else if (attrsDiffer && !mismatched) console.error(HYDRATION_ATTRS);
          mismatched = false;
        }
        if (--depth === 0) commit();
      }
      // Called from inside a render or commit (a root made in componentDidMount): flushed when that one ends.
      if (depth === 0) flushSignals();
  }
  refreshRoot.top = top;
  const api = {
    render(children: any, ...rest: any[]) {
      if (unmounted) throw new Error("Cannot update an unmounted root.");
      if (dev()) tellCommit(refreshRoot, children);
      if (dev()) {
        if (typeof rest[0] === "function") console.error("does not support the second callback argument. To execute a side effect after rendering, declare it in a component body with useEffect().");
        else if (validContainer(rest[0])) console.error("You passed a container to the second argument of root.render(...). You don't need to pass it again since you already passed it to create the root.");
        else if (rest.length && rest[0] !== undefined) console.error("You passed a second argument to root.render(...) but it only accepts one argument.");
        // Asked for while a component renders: React warns (the render goes ahead).
        if (current) {
          const owner = current;
          withFiber(owner, () => console.error(`Render methods should be a pure function of props and state; triggering nested component updates from render is not allowed. If necessary, trigger nested updates in componentDidUpdate.

Check the render method of ${nameOf(owner.type)}.`));
        }
        // An array as the root's children: its elements need keys.
        if (Array.isArray(children)) checkKeys(children, ROOT_NAME);
      }
      // Inside a render or a commit (a root made in componentDidMount): drawn with it, as before.
      latest = children;
      // Given in a transition: a first render that can stop between components (the work loop).
      pendingInTransition = transitioning > 0;
      if (depth > 0) return renderNow(children);
      // An update in a transition: drawn with the transition (held while it suspends, its end after it).
      if (transitioning > 0 && !first && top.children.length) {
        deferTransition(() => ((pending = children), asked.set(asked.peek() + 1)));
        return;
      }
      // An update while the hydration waits for data (none of it committed): the root is drawn on the client.
      if (hydrationWaiting && first && hydrating_) clientInstead = true;
      if (first && hydrating_ && !clientInstead && hydrateFirst === NONE && pending === NONE) hydrateFirst = children;
      else pending = children;
      asked.set(asked.peek() + 1);
    },
    /** What holds `target` hydrated before the rest, the last one asked first (React's scheduleHydration). */
    unstable_scheduleHydration(target: Node) {
      if (!target) return;
      const f = dehydratedAround(target, new Set([state]));
      if (f) {
        (f as any).targeted = -++targetSeq;
        scheduleHydration(f);
      } else hoverTargets.set("explicit:" + targetSeq, { node: target, seq: -++targetSeq });
    },
    unmount(...rest: any[]) {
      if (dev() && typeof rest[0] === "function") console.error("does not support a callback argument. To execute a side effect after rendering, declare it in a component body with useEffect().");
      if (unmounted) return;
      if (dev() && (depth > 0 || committing || inPassive)) withFiber(effectFiber, () => console.error("Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition."));
      unmounted = true;
      // Its nodes taken out of the container by someone else: React's removal fails, as the DOM's does.
      const into = domParent(container);
      const moved = top.children.some((c) => domNodes(c).some((n) => n.parentNode !== into));
      (container as any).__root = false;
      pending = NONE;
      for (const c of top.children) unmount(c, true);
      top.children = [];
      if (dev()) tellCommit(refreshRoot, null);
      if (moved) throw new Error("The node to be removed is not a child of this node.");
    },
  };
  refreshRoot.render = (element: any) => api.render(element);
  return api;
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

/** Forms submitted before they hydrated (queued by the server's replaying runtime): their actions run once they have,
 * with the data of the moment they were submitted, as React replays them. */
function replayFormActions(doc: any) {
  const queue: any[] = doc.$$reactFormReplay;
  for (let i = 0; i < queue.length; i += 3) {
    const form = queue[i], submitter = queue[i + 1], data = queue[i + 2];
    const f: Fiber | undefined = form?.[FIBER];
    // (Not hydrated yet: it waits, and the ones after it with it, to keep their order.)
    if (!f || f.dead || !(f as any).placed) return void queue.splice(0, i);
    const act = typeof submitter?.[PROPS]?.formAction === "function" ? submitter[PROPS].formAction : form[PROPS]?.action;
    if (typeof act === "function") submitForm(form, act, data, submitter);
  }
  queue.length = 0;
}

/** A form's status, kept on its fiber: what useFormStatus reads below it. */
const formStatus = (f: Fiber): Sig<any> => ((f as any).formStatus ??= signal(IDLE_FORM));

/**
 * A form submitted to a function (React 19's form actions): its status pending while the action runs, the form
 * reset once it is done, an error handed to the nearest boundary.
 */
export function submitForm(form: HTMLFormElement, act: (data: FormData) => any, data: FormData, submitter?: HTMLElement | null) {
  const f: Fiber | undefined = (form as any)[FIBER];
  const status = f ? formStatus(f) : null;
  const method = ((submitter as any)?.getAttribute?.("formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase();
  // Drawn after the action has started, as React draws its optimistic pending state.
  status?.set({ pending: true, data, method, action: act });
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
  if (r && typeof r.then === "function") actionStarted(r), r.then(() => settle(), (e: unknown) => settle(e, true));
  else settle();
}

/** A form whose submit handlers started a transition: pending until that transition (and its actions) ends. */
function formPendingWhile(form: HTMLFormElement, action: any, data: FormData, submitter?: HTMLElement | null) {
  const f: Fiber | undefined = (form as any)[FIBER];
  if (!f) return;
  const status = formStatus(f);
  const method = ((submitter as any)?.getAttribute?.("formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase();
  status.set({ pending: true, data, method, action });
  endTransition(() => status.set(IDLE_FORM));
}

/** React DOM's requestFormReset: the form reset once the transition it is called in is drawn. */
export function requestFormReset(form: any) {
  const f: Fiber | undefined = form?.[FIBER];
  if (!f || f.kind !== HOST || f.type !== "form") throw new Error("Invalid form element. requestFormReset must be passed a form that was rendered by React.");
  if (transitioning) return endTransition(() => !f.dead && form.reset());
  // Outside one: reset now, as React does with a synchronous update (almost certainly a mistake).
  if (dev()) console.error("requestFormReset was called outside a transition or action. To fix, move to an action, or wrap with startTransition.");
  form.reset();
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
/** Effects (layout or passive) running now, and how many synchronous renders they forced in a row: past React's
 * limit (NESTED_UPDATE_LIMIT) it is a loop, React's error thrown where the next one is asked. */
let inEffects = 0;
let nestedSync = 0;
/** Whether the effects running now forced a synchronous render (if they did not, the run of them ends). */
let syncInEffects = false;
/** An effect phase ended: one that forced no synchronous render breaks the chain. */
function effectsDone() {
  if (inEffects) return;
  if (!syncInEffects) nestedSync = 0;
  syncInEffects = false;
}
export function flushSync<T>(fn?: () => T): T {
  // Inside a render or a commit (a lifecycle): React cannot flush there, and says so (what fn does still happens).
  if (dev() && (depth > 0 || committing) && !inPassive)
    console.error("flushSync was called from inside a lifecycle method. React cannot flush when React is already rendering. Consider moving this call to a scheduler task or micro task.");
  if (inEffects) {
    syncInEffects = true;
    if (++nestedSync > 50) {
      nestedSync = 0;
      throw new Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.");
    }
  } else nestedSync = 0;
  const was = syncing;
  // Asked for from outside React (not by a render, a commit or an effect): a new update, not a loop's next turn.
  if (!was && depth === 0 && !committing && !inEffects && !inPassive) loops.clear();
  syncing = true;
  try {
    const r = fn ? fn() : (undefined as T);
    if (depth === 0) flushSignals();
    performWork();
    // A sync commit's passive effects run at its end (React flushes the sync lane's at once).
    if (depth === 0 && !was && !inPassive) runPassive(true);
    return r;
  } finally {
    syncing = was;
  }
}

// After a handler: what it changed drawn now (React draws a discrete event's updates before the next one), and a
// controlled field put back to what its state says when the handler did not take what was typed.
onAfterEvent((el, e) => {
  if (depth > 0 || actDepth > 0) return;
  // Updates are drawn on the next microtask; only a controlled field's change is drawn at once, so the field can be
  // put back to what its state says (React's finishEventHandler).
  // Only once the field's own change has been told: a checkbox's click comes before its change, and putting it
  // back then would undo the toggle the change is about to report.
  if (e.type !== eventOf(el, "onChange")[0] || !FORM_TAGS.has(el.localName)) return;
  flushSignals();
  restoreForm(el);
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
setOwner(() => (current ? nameOf(current.type) : hostOwner ? nameOf(hostOwner.type) : null));

// A form's action runs through submitForm (its status, its reset, its boundary).
onSubmitAction(submitForm, formPendingWhile);
countTransitionsWith(() => transitionsStartedCount);

/** Whether the root rendering now is taking over server markup (hydrateRoot's first render). */
export const isHydrating = () => hydrating !== null;
