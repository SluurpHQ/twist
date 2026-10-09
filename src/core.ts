// The runtime: React's API on Sluurp's signals. Each component renders inside a signals effect, so what it reads
// (its state, a context, any signal) re-renders it alone. A parent re-renders a child only when the child's props
// changed (shallowly); nothing cascades past that. Rendering is synchronous: no time slicing, no lanes.
import { effect, flush as flushSignals, signal, untrack } from "../../signals/index.js";
import { ACTIVITY, CONSUMER, CONTEXT, ELEMENT, FORWARD_REF, FRAGMENT, LAZY, MEMO, PORTAL, PROFILER, STRICT, SUSPENSE, SUSPENSE_LIST, createElement, invalidType, objectChild, readLazy, readThenable, unwrapChild } from "./element.ts";
import { MATH_NS, SVG_NS, eventOf, onAfterEvent, onSubmitAction, setDefaults, setProps } from "./props.ts";
import { addContainer } from "./events.ts";
import { FragmentInstance } from "./fragment-ref.ts";
import { FORM_TAGS, initForm, restoreForm, updateForm } from "./forms.ts";
import { checkTag, duplicateKey, setOwner } from "./warnings.ts";
import { assertValidProps, checkTagName } from "./attributes.ts";

type Sig<T = any> = { (): T; set(v: T): void; peek(): T };

const TEXT = 1, HOST = 2, COMP = 3, FRAG = 4, PROVIDER = 5, PORTAL_F = 6, ROOT = 7;

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
  layoutQueue.push(() => {
    const top = root.top;
    if (top) {
      for (const c of top.children) unmount(c, true);
      top.children = [];
    }
  });
  // Outside a render (an effect after paint): taken down now.
  if (depth === 0) commit();
  if (uncaughtListener) uncaughtListener(e);
  else if (root.onUncaughtError) root.onUncaughtError(e, { componentStack: "" });
  else report(e);
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

const report = (e: unknown) => (typeof reportError === "function" ? reportError(e) : console.error(e));

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
function keyOf(c: any, i: number) {
  return c && typeof c === "object" && c.key != null ? "k" + c.key : "i" + i;
}

function typeOf(c: any): any {
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
  if (f.kind === HOST || f.kind === TEXT) out.push(f.dom);
  else if (f.kind !== PORTAL_F) for (const c of f.children) domNodes(c, out);
  return out;
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
    if (items) c = items;
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

function fiber(kind: number, type: any, key: string, props: any, parent: Fiber): Fiber {
  return { kind, type, key, props, parent, children: [], dom: null, ns: parent.kind === HOST ? childNs(parent) : parent.ns, root: parent.root };
}

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
/** Whether this hydration found markup that differs from the client's, reported once to onRecoverableError. */
let mismatched = false;

/** Past comments (the server's separators and markers, left in place). */
const pastComments = (n: Node | null) => {
  while (n && n.nodeType === 8) n = n.nextSibling;
  return n;
};

/** The next server node in `host`, past comments (React's separators and markers). */
function nextServerNode(host: Node): Node | null {
  if (!hydrating) return null;
  let n = hydrating.has(host) ? hydrating.get(host)! : host.firstChild;
  while (n && n.nodeType === 8) n = n.nextSibling;
  return n;
}

/** A server node taken for a fiber: the next one, if it is the same kind of thing. */
function claim(host: Node, match: (n: Node) => boolean): Node | null {
  const n = nextServerNode(host);
  if (!n || !match(n)) return null;
  hydrating!.set(host, n.nextSibling);
  return n;
}

/** What the server drew in `host` and the client did not claim: taken away, as React does on a mismatch. */
function dropUnclaimed(host: Node) {
  if (!hydrating) return;
  let n = nextServerNode(host);
  while (n) {
    const next = n.nextSibling;
    if (n.nodeType !== 8) {
      host.removeChild(n);
      mismatched = true;
    }
    n = next;
  }
  hydrating.delete(host);
}

function mount(c: any, key: string, type: any, parent: Fiber, host: Node, before: Node | null): Fiber {
  if (type === TEXT_NODE) {
    const f = fiber(TEXT, type, key, c, parent);
    const text = "" + c;
    // A server text node holds this one and maybe the next (adjacent text runs together in HTML): split off.
    const had = hydrating && text !== "" ? (claim(host, (n) => n.nodeType === 3 && (n as Text).data.startsWith(text)) as Text | null) : null;
    if (had) {
      if (had.data.length > text.length) hydrating!.set(host, had.splitText(text.length));
      f.dom = had;
    } else {
      if (hydrating && text !== "") mismatched = true;
      f.dom = document.createTextNode(text);
      host.insertBefore(f.dom, hydrating ? nextServerNode(host) : before);
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
    const server = hydrating ? (claim(host, (n) => n.nodeType === 1 && (n as Element).localName === type.toLowerCase()) as Element | null) : null;
    const el = (f.dom = server ?? (ns ? document.createElementNS(ns, type) : document.createElement(type)));
    // Its fiber, for tools that look from the page into the tree.
    (el as any).__fiber = f;
    if (!server) {
      if (hydrating) mismatched = true;
      checkTag(el, type);
    }
    (el as any).__props = props;
    if (FORM_TAGS.has(type) && !ns) {
      // A select chooses among its options, so they come first; a textarea's children are its value, not nodes.
      if (type !== "textarea" && type !== "input") reconcile(f, toList(props.children), el, null);
      initForm(el, type, props, false);
    } else {
      setProps(el, props, null, ns === SVG_NS);
      setDefaults(el, props);
      if (props.dangerouslySetInnerHTML == null) reconcile(f, toList(props.children), el, null);
    }
    if (server) {
      if (props.dangerouslySetInnerHTML == null) dropUnclaimed(el);
    } else host.insertBefore(el, hydrating ? nextServerNode(host) : before);
    if (props.ref != null) layoutQueue.push(() => setRef(f, props.ref, el));
    return f;
  }
  if (type === FRAGMENT || type === STRICT || type === PROFILER || type === SUSPENSE_LIST || type === ACTIVITY) {
    const f = fiber(FRAG, type, key, props, parent);
    if (!(type === ACTIVITY && props.mode === "hidden")) reconcile(f, toList(props.children), host, before);
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
  start(f, host, before);
  return f;
}

function update(f: Fiber, c: any) {
  if (f.kind === TEXT) {
    if (f.props !== c) (f.dom as Text).data = "" + (f.props = c);
    return;
  }
  if (f.kind === FRAG) {
    const host = hostParentOf(f);
    const prev = f.props;
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
      if (props.dangerouslySetInnerHTML == null) reconcile(f, toList(props.children), el, null);
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
  const same = f.compare ? f.compare(f.props, props) : shallowEqual(f.props, props);
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
  if (removeDom) for (const n of domNodes(f)) n.parentNode?.removeChild(n);
  f.dead = true;
  if (f.kind === COMP) {
    f.stop?.();
    const inst = f.inst;
    if (inst && (f as any).classRef != null) clearRef(f, (f as any).classRef);
    if (inst?.componentWillUnmount) untrack(() => lifecycle(f, () => inst.componentWillUnmount()));
    for (const h of f.hooks!) if (h && h.cleanup) untrack(() => lifecycle(f, h.cleanup)), (h.cleanup = null);
  } else if (f.kind === HOST && f.props.ref != null) {
    clearRef(f, f.props.ref);
  } else if (f.kind === FRAG && (f as any).fragment && f.props?.ref != null) {
    clearRef(f, f.props.ref);
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
    return (fb, props) => (fb.pending!() > 0 ? props.fallback : props.children);
  }
  switch (type?.$$typeof) {
    case FORWARD_REF:
      return (_f, props) => {
        if (!("ref" in props)) return type.render(props, null);
        const { ref, ...rest } = props;
        return type.render(rest, ref);
      };
    case MEMO:
      f.compare = type.compare;
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
    if ((f as any).draws === LIMIT + 1) caught(f, new Error(`Maximum update depth exceeded. This can happen when a component calls setState on every render: <${nameOf(f.type)}> (inside ${path(f)}).`));
    return;
  }
  if (depth++ === 0) runPassive(false);
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
    out = null;
    current = prevCurrent;
    hookAt = prevAt;
    caught(f, e);
  } finally {
    current = prevCurrent;
    hookAt = prevAt;
  }
  if (out === KEEP) out = f.out;
  f.out = out;
  const [host, before] = place ?? [hostParentOf(f), nextDomAfter(f)];
  try {
    reconcile(f, toList(out), host, before);
  } catch (e) {
    caught(f, e);
  }
  insertionQueue.push(...f.insertion);
  layoutQueue.push(...f.layout);
  passiveQueue.push(...f.passive);
  if (--depth === 0) commit();
}

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

/** Where a fiber is, by its components' names: for messages. */
function path(f: Fiber) {
  const names: string[] = [];
  for (let p = f.parent; p && names.length < 6; p = p.parent) if (p.kind === COMP) names.push(nameOf(p.type));
  return names.join(" < ") || "the root";
}

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
  if (!inst) {
    inst = f.inst = new C(props, ctx);
    inst.props = props;
    inst.context = ctx;
    if (inst.state === undefined) inst.state = null;
    inst.__f = f;
    inst.__queue = [];
    if (C.getDerivedStateFromProps) inst.state = { ...inst.state, ...C.getDerivedStateFromProps(props, inst.state) };
    call("componentWillMount");
    // setState in componentWillMount: taken into this first render.
    inst.state = apply(inst.state, props)[0];
    const out = inst.render();
    if (inst.componentDidMount) f.layout!.push(() => lifecycle(f, () => inst.componentDidMount()));
    if (ref != null) f.layout!.push(() => setRef(f, ref, inst));
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
  if (inst.componentDidUpdate) f.layout!.push(() => lifecycle(f, () => inst.componentDidUpdate(prevProps, prevState, snapshot)));
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
    this.__queue.push(partial);
    if (done) (this.__done ??= []).push(done);
    this.__f.tick!.set(this.__f.tick!.peek() + 1);
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

/** Something a render threw: a promise suspends the nearest Suspense; an error goes to the nearest boundary. */
function caught(f: Fiber, e: any) {
  if (e && typeof e.then === "function") {
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
    // No boundary: drawn again when it settles.
    e.then(() => !f.dead && (restart(f), flushSignals()), () => {});
    return;
  }
  for (let p = f.parent; p; p = p.parent) {
    const inst = p.inst;
    if (inst && !p.dead && (p.type.getDerivedStateFromError || inst.componentDidCatch)) {
      if (p.type.getDerivedStateFromError) inst.__queue.push(p.type.getDerivedStateFromError(e));
      if (inst.componentDidCatch) layoutQueue.push(() => guard(() => inst.componentDidCatch(e, { componentStack: "" })));
      p.root.onCaughtError?.(e, { componentStack: "", errorBoundary: inst });
      p.tick!.set(p.tick!.peek() + 1);
      return;
    }
  }
  uncaught(f.root, e);
}

// ---------------------------------------------------------------- effects and commit

// Counted as rendering while it runs: an event it fires (a focus() in a layout effect) does not flush from inside.
function commit() {
  depth++;
  try {
    untrack(() => {
      for (let i = 0; i < insertionQueue.length; i++) guard(insertionQueue[i]!);
      insertionQueue.length = 0;
      for (let i = 0; i < layoutQueue.length; i++) guard(layoutQueue[i]!);
      layoutQueue.length = 0;
    });
  } finally {
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
    if (!passiveQueue.length) return;
    runPassive(true);
  }
}

/**
 * React's act: runs `fn`, then everything it set off (updates, effects after paint), so a test sees the result.
 * Returns a thenable either way, as React's does; for an async `fn`, settled once it has.
 */
export function act<T>(fn: () => T | Promise<T>): PromiseLike<T> {
  const r = fn();
  if (r && typeof (r as any).then === "function") {
    return (r as Promise<T>).then((v) => {
      settleAll();
      return v;
    });
  }
  settleAll();
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
      else sig.set(sig.peek() + 1);
    },
  };
  return box;
}

function hook<T>(make: () => T): T {
  const f = current;
  if (!f) throw new Error("Invalid hook call. Hooks can only be called inside of the body of a function component.");
  const hooks = f.hooks!;
  const i = hookAt++;
  if (i >= hooks.length) hooks.push(make());
  return hooks[i];
}

export const depsChanged = (a: any[] | undefined, b: any[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

export const client = {
  useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
    const f = current!;
    const h = hook(() => {
      const box = state(f, typeof init === "function" ? (init as () => T)() : init);
      box.set = (v: any) => box.put(typeof v === "function" ? v(box.v) : v);
      return box;
    });
    return [h.read(), h.set];
  },
  useReducer(reducer: any, arg: any, init?: any) {
    const f = current!;
    const h = hook(() => {
      const box = state(f, init ? init(arg) : arg);
      box.reducer = reducer;
      box.dispatch = (a: any) => box.put(box.reducer(box.v, a));
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
      h.value = fn();
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
  useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T {
    const h = hook(() => ({ v: signal(0) as Sig<number>, get: getSnapshot, value: undefined as any }));
    h.v();
    const value = getSnapshot();
    // The newest getSnapshot and what this render showed: a change in the store re-renders only when what this
    // component reads from it is different (a store updated for others leaves it alone).
    h.get = getSnapshot;
    h.value = value;
    effectHook(
      () => {
        const check = () => {
          if (!Object.is(h.get(), h.value)) h.v.set(h.v.peek() + 1);
        };
        const off = subscribe(check);
        check();
        return off;
      },
      [subscribe],
      "layout",
    );
    return value;
  },
  useTransition(): [boolean, (fn: () => any) => void] {
    const h = hook(() => {
      const p: Sig<number> = signal(0);
      return { p, start: (fn: () => any) => startTransitionWith(fn, p) };
    });
    return [h.p() > 0, h.start];
  },
  useDeferredValue<T>(value: T, _initial?: T) {
    return value;
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
  if (!h.first && deps && !depsChanged(h.deps, deps)) return;
  h.first = false;
  h.deps = deps;
  f[phase]!.push(() => {
    if (f.dead) return;
    try {
      if (typeof h.cleanup === "function") h.cleanup();
      const back = create();
      h.cleanup = typeof back === "function" ? back : null;
    } catch (e) {
      caught(f, e);
    }
  });
}

function startTransitionWith(fn: () => any, pending?: Sig<number>) {
  const r = fn();
  if (pending && r && typeof r.then === "function") {
    pending.set(pending.peek() + 1);
    const done = () => pending.set(pending.peek() - 1);
    r.then(done, done);
  }
}
export const startTransition = (fn: () => any) => startTransitionWith(fn);


export function readContext(f: Fiber, ctx: any) {
  for (let p = f.parent; p; p = p.parent) if (p.kind === PROVIDER && p.type === ctx) return p.value!();
  return ctx._defaultValue;
}

// ---------------------------------------------------------------- roots

export function createRoot(container: Element | DocumentFragment, options?: any) {
  const state: RootState = { ids: 0, container };
  const top: Fiber = { kind: ROOT, type: null, key: "", props: null, parent: null, children: [], dom: container, ns: nsOf(container), root: state };
  addContainer(container, state);
  state.top = top;
  state.onUncaughtError = options?.onUncaughtError;
  state.onCaughtError = options?.onCaughtError;
  let first = true;
  // Renders of this root started while it is already rendering or committing (componentDidMount rendering the
  // root again): past React's limit it is a loop, thrown as React throws it.
  let nested = 0;
  return {
    render(children: any) {
      if (depth > 0) {
        if (++nested > LIMIT) {
          nested = 0;
          throw new Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.");
        }
        if (nested === 1) queueMicrotask(() => (nested = 0));
      }
      const hydrate = first && options?.hydrate;
      if (first) {
        first = false;
        if (!hydrate) (container as Element).replaceChildren?.();
      }
      depth++;
      if (hydrate) (hydrating = new Map()), (mismatched = false);
      try {
        reconcile(top, [children], container, null);
        if (hydrate) dropUnclaimed(container);
      } finally {
        if (hydrate) {
          hydrating = null;
          if (mismatched) {
            mismatched = false;
            const report = options?.onRecoverableError ?? globalThis.reportError;
            report?.(new Error("Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:\n\n- A server/client branch `if (typeof window !== 'undefined')`.\n- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n- Date formatting in a user's locale which doesn't match the server.\n- External changing data without sending a snapshot of it along with the HTML.\n- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\nhttps://react.dev/link/hydration-mismatch"), { componentStack: "" });
          }
        }
        if (--depth === 0) commit();
      }
      // Called from inside a render or commit (a root made in componentDidMount): flushed when that one ends.
      if (depth === 0) flushSignals();
    },
    unmount() {
      for (const c of top.children) unmount(c, true);
      top.children = [];
    },
  };
}

/** Taken over as the server drew it: its nodes claimed in order and kept, what differs drawn anew. */
export function hydrateRoot(container: Element, children: any, options?: any) {
  const root = createRoot(container, { ...options, hydrate: true });
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
  const settle = (error?: unknown, failed = false) => {
    status?.set(IDLE_FORM);
    if (failed) f ? caught(f, error) : report(error);
    else form.reset();
    flushSignals();
  };
  let r: any;
  try {
    r = act(data);
  } catch (e) {
    return settle(e, true);
  }
  if (r && typeof r.then === "function") r.then(() => settle(), (e: unknown) => settle(e, true));
  else settle();
}

/** The status of the form around the component rendering now (React DOM's useFormStatus). */
export function useFormStatus() {
  for (let p = current?.parent ?? null; p; p = p.parent) if (p.kind === HOST && p.type === "form") return formStatus(p)();
  return IDLE_FORM;
}

export function flushSync<T>(fn?: () => T): T {
  const r = fn ? fn() : (undefined as T);
  if (depth === 0) flushSignals();
  return r;
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
