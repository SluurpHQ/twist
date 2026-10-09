// What a ref on a Fragment gets (React's FragmentInstance): the fragment's top-level host nodes (elements and text,
// through components and portals, not inside hidden Activity) treated as one, for listeners, focus, observers,
// geometry and document position. Children added or removed later get or lose its listeners and observers.

/** The fiber shape this needs (core's): its kind, its node, its children, its parent. */
export type FNode = { kind: number; type: any; props: any; dom: any; children: FNode[]; parent: FNode | null; dead?: boolean };
/** Core's fiber kinds, as numbers. */
export const K = { TEXT: 1, HOST: 2, FRAG: 4, PORTAL: 6, ROOT: 7 };

const isHostOrText = (f: FNode) => f.kind === K.HOST || f.kind === K.TEXT;
const hiddenActivity = (f: FNode) => f.type === Symbol.for("react.activity") && f.props?.mode === "hidden";

/** Host and text nodes from `list`, depth first, not into hosts unless `deep`; `fn` true stops. */
function visit(list: FNode[], deep: boolean, fn: (f: FNode) => boolean): boolean {
  for (const c of list) {
    if (c.dead) continue;
    if (isHostOrText(c) && fn(c)) return true;
    if (!hiddenActivity(c) && (deep || !isHostOrText(c)) && visit(c.children, deep, fn)) return true;
  }
  return false;
}
/** The nearest host or root above: where the fragment's nodes are drawn into. */
function parentHost(f: FNode): FNode | null {
  for (let p = f.parent; p; p = p.parent) if (p.kind === K.HOST || p.kind === K.ROOT) return p;
  return null;
}
const nodeOf = (f: FNode): any => f.dom;
function portaledIntoHost(f: FNode) {
  let found = false;
  for (let p = f.parent; p; p = p.parent) {
    if (p.kind === K.PORTAL) found = true;
    if (p.kind === K.HOST || p.kind === K.ROOT) break;
  }
  return found;
}
/** The host or text nodes just before and after the fragment within its parent host. */
function siblings(f: FNode): [FNode | null, FNode | null] {
  const out: [FNode | null, FNode | null] = [null, null];
  const parent = parentHost(f);
  if (!parent) return out;
  let foundSelf = false;
  const walk = (list: FNode[]): boolean => {
    for (const c of list) {
      if (c.dead) continue;
      if (c === f) foundSelf = true;
      else if (isHostOrText(c)) {
        if (foundSelf) return (out[1] = c), true;
        out[0] = c;
      } else if (!hiddenActivity(c) && walk(c.children)) return true;
    }
    return false;
  };
  walk(parent.children);
  return out;
}
/** The fiber a DOM node belongs to (its element's, or the nearest element's above it). */
function fiberOfNode(node: any): FNode | null {
  for (let n = node; n; n = n.parentNode) if (n.__fiber) return n.__fiber;
  return null;
}

type Entry = { type: string; listener: any; options: any; attached: any; cleanup: (() => void) | null };
const captureKey = (o: any) => (o == null ? "c=0" : typeof o === "boolean" ? "c=" + (o ? "1" : "0") : "c=" + (o.capture ? "1" : "0"));
const attachOptions = (o: any) => (o != null && typeof o !== "boolean" && (o.once === true || (typeof AbortSignal !== "undefined" && o.signal instanceof AbortSignal)) ? { capture: o.capture, passive: o.passive } : o);

/** Intersection observers keep a removed child until after paint (its exit is reported first). */
let pendingUnobserves: { inst: FragmentInstance; observer: any; node: Element }[] = [];
let unobserveScheduled = false;
function scheduleUnobserve(inst: FragmentInstance, observer: any, node: Element) {
  pendingUnobserves.push({ inst, observer, node });
  if (unobserveScheduled) return;
  unobserveScheduled = true;
  const after = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => setTimeout(fn, 0)) : setTimeout(fn, 0));
  after(() => {
    unobserveScheduled = false;
    const list = pendingUnobserves;
    pendingUnobserves = [];
    for (const p of list) p.observer.unobserve(p.node);
  });
}

export class FragmentInstance {
  _fragmentFiber: FNode;
  _eventListeners: Entry[] | null = null;
  _observers: Set<any> | null = null;
  constructor(fiber: FNode) {
    this._fragmentFiber = fiber;
  }

  /** A host or text node put in under the fragment: its listeners and observers (and the fragment handle). */
  _childAdded(node: any) {
    for (const l of this._eventListeners ?? []) node.addEventListener(l.type, l.attached, attachOptions(l.options));
    if (node.nodeType === 3) return;
    for (const observer of this._observers ?? []) {
      pendingUnobserves = pendingUnobserves.filter((p) => !(p.inst === this && p.observer === observer && p.node === node));
      observer.observe(node);
    }
    (node.reactFragments ??= new Set()).add(this);
  }
  /** A host or text node taken out from under the fragment. */
  _childRemoved(node: any) {
    for (const l of this._eventListeners ?? []) node.removeEventListener(l.type, l.attached, attachOptions(l.options));
    if (node.nodeType === 3) return;
    for (const observer of this._observers ?? []) typeof observer.rootMargin === "string" ? scheduleUnobserve(this, observer, node) : observer.unobserve(node);
    node.reactFragments?.delete(this);
  }
  /** Every element under it gets the handle (on attach). */
  _attachHandles() {
    visit(this._fragmentFiber.children, false, (c) => (c.kind === K.HOST && (nodeOf(c).reactFragments ??= new Set()).add(this), false));
  }

  addEventListener(type: string, listener: any, options?: any) {
    let signal: AbortSignal | null = null;
    if (options != null && typeof options !== "boolean") {
      signal = options.signal || null;
      if (signal?.aborted) return;
    }
    const list = (this._eventListeners ??= []);
    if (list.some((l) => l.type === type && l.listener === listener && captureKey(l.options) === captureKey(options))) return;
    const self = this;
    const attached =
      options != null && typeof options !== "boolean" && options.once === true
        ? function (this: any, e: Event) {
            self.removeEventListener(type, listener, options);
            typeof listener === "function" ? listener.call(this, e) : listener.handleEvent(e);
          }
        : listener;
    let cleanup: (() => void) | null = null;
    if (signal) {
      const abort = () => this.removeEventListener(type, listener, options);
      signal.addEventListener("abort", abort, { once: true });
      cleanup = () => signal!.removeEventListener("abort", abort);
    }
    list.push({ type, listener, options, attached, cleanup });
    const opts = attachOptions(options);
    visit(this._fragmentFiber.children, false, (c) => (nodeOf(c).addEventListener(type, attached, opts), false));
  }

  removeEventListener(type: string, listener: any, options?: any) {
    const list = this._eventListeners;
    if (!list) return;
    const i = list.findIndex((l) => l.type === type && l.listener === listener && captureKey(l.options) === captureKey(options));
    if (i < 0) return;
    const e = list[i]!;
    const opts = attachOptions(e.options);
    visit(this._fragmentFiber.children, false, (c) => (nodeOf(c).removeEventListener(type, e.attached, opts), false));
    list.splice(i, 1);
    e.cleanup?.();
  }

  /** Dispatched from the fragment's place: its listeners hear it, then it bubbles from the parent. */
  dispatchEvent(event: Event): boolean {
    const parent = parentHost(this._fragmentFiber);
    if (!parent) return true;
    const node = nodeOf(parent) as any;
    const list = this._eventListeners;
    if ((list && list.length) || !event.bubbles) {
      const stand = node.nodeType === 9 ? node.createComment("") : (node.ownerDocument ?? document).createTextNode("");
      for (const l of list ?? []) stand.addEventListener(l.type, l.attached, attachOptions(l.options));
      node.appendChild(stand);
      const r = stand.dispatchEvent(event);
      for (const l of list ?? []) stand.removeEventListener(l.type, l.attached, attachOptions(l.options));
      node.removeChild(stand);
      return r;
    }
    return node.dispatchEvent(event);
  }

  focus(options?: FocusOptions) {
    visit(this._fragmentFiber.children, true, (c) => c.kind === K.HOST && tryFocus(nodeOf(c), options));
  }

  focusLast(options?: FocusOptions) {
    const all: FNode[] = [];
    visit(this._fragmentFiber.children, true, (c) => (all.push(c), false));
    for (let i = all.length - 1; i >= 0; i--) if (all[i]!.kind === K.HOST && tryFocus(nodeOf(all[i]!), options)) return;
  }

  blur() {
    const parent = parentHost(this._fragmentFiber);
    if (!parent) return;
    const node = nodeOf(parent);
    const active = (node.nodeType === 9 ? node : node.ownerDocument).activeElement;
    if (!active) return;
    visit(this._fragmentFiber.children, false, (c) => {
      if (c.kind === K.TEXT) return false;
      const el = nodeOf(c);
      if (el === active || el.contains(active)) return active.blur(), true;
      return false;
    });
  }

  observeUsing(observer: any) {
    let text = false, element = false;
    visit(this._fragmentFiber.children, false, (c) => (c.kind === K.TEXT ? ((text = true), false) : ((element = true), true)));
    if (text && !element) console.error("observeUsing() was called on a FragmentInstance with only text children. Observers do not work on text nodes.");
    (this._observers ??= new Set()).add(observer);
    visit(this._fragmentFiber.children, false, (c) => (c.kind === K.HOST && observer.observe(nodeOf(c)), false));
  }

  unobserveUsing(observer: any) {
    if (!this._observers?.has(observer)) {
      console.error("You are calling unobserveUsing() with an observer that is not being observed with this fragment instance. First attach the observer with observeUsing()");
      return;
    }
    this._observers.delete(observer);
    visit(this._fragmentFiber.children, false, (c) => (c.kind === K.HOST && observer.unobserve(nodeOf(c)), false));
    pendingUnobserves = pendingUnobserves.filter((p) => {
      if (p.inst === this && p.observer === observer) return observer.unobserve(p.node), false;
      return true;
    });
  }

  getClientRects(): DOMRect[] {
    const rects: DOMRect[] = [];
    visit(this._fragmentFiber.children, false, (c) => {
      const n = nodeOf(c);
      if (c.kind === K.TEXT) {
        const range = n.ownerDocument.createRange();
        range.selectNodeContents(n);
        rects.push(...range.getClientRects());
      } else rects.push(...n.getClientRects());
      return false;
    });
    return rects;
  }

  getRootNode(options?: GetRootNodeOptions): Node {
    const parent = parentHost(this._fragmentFiber);
    return parent ? nodeOf(parent).getRootNode(options) : (this as any);
  }

  compareDocumentPosition(other: Node): number {
    const N = Node;
    const frag = this._fragmentFiber;
    const parent = parentHost(frag);
    if (!parent) return N.DOCUMENT_POSITION_DISCONNECTED;
    const children: FNode[] = [];
    visit(frag.children, false, (c) => (children.push(c), false));
    const parentNode = nodeOf(parent);
    if (!children.length) {
      let anchor = parentNode;
      if (portaledIntoHost(frag)) {
        for (let p = frag.parent; p; p = p.parent) {
          if (p.kind === K.PORTAL) {
            anchor = p.dom;
            break;
          }
          if (p.kind === K.HOST || p.kind === K.ROOT) break;
        }
      }
      const pos = anchor.compareDocumentPosition(other);
      let result = pos;
      if (anchor === other) result = N.DOCUMENT_POSITION_CONTAINS;
      else if (pos & N.DOCUMENT_POSITION_CONTAINED_BY) {
        const next = siblings(frag)[1];
        if (!next) result = N.DOCUMENT_POSITION_PRECEDING;
        else {
          const r = nodeOf(next).compareDocumentPosition(other);
          result = r === 0 || r & N.DOCUMENT_POSITION_FOLLOWING ? N.DOCUMENT_POSITION_FOLLOWING : N.DOCUMENT_POSITION_PRECEDING;
        }
      }
      return result | N.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
    }
    const first = nodeOf(children[0]!), last = nodeOf(children[children.length - 1]!);
    const container = portaledIntoHost(frag) ? first.parentElement : parentNode;
    if (container == null) return N.DOCUMENT_POSITION_DISCONNECTED;
    const firstIn = container.compareDocumentPosition(first) & N.DOCUMENT_POSITION_CONTAINED_BY;
    const lastIn = container.compareDocumentPosition(last) & N.DOCUMENT_POSITION_CONTAINED_BY;
    const toFirst = first.compareDocumentPosition(other);
    const toLast = last.compareDocumentPosition(other);
    const within = toFirst & N.DOCUMENT_POSITION_CONTAINED_BY || toLast & N.DOCUMENT_POSITION_CONTAINED_BY;
    const between = firstIn && lastIn && toFirst & N.DOCUMENT_POSITION_FOLLOWING && toLast & N.DOCUMENT_POSITION_PRECEDING;
    const pos =
      (firstIn && first === other) || (lastIn && last === other) || within || between
        ? N.DOCUMENT_POSITION_CONTAINED_BY
        : (!firstIn && first === other) || (!lastIn && last === other)
          ? N.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC
          : toFirst;
    return pos & N.DOCUMENT_POSITION_DISCONNECTED || pos & N.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC || validPosition(pos, frag, children[0]!, children[children.length - 1]!, other)
      ? pos
      : N.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
  }

  scrollIntoView(alignToTop?: boolean) {
    if (typeof alignToTop === "object") throw new Error("FragmentInstance.scrollIntoView() does not support scrollIntoViewOptions. Use the alignToTop boolean instead.");
    const children: FNode[] = [];
    visit(this._fragmentFiber.children, false, (c) => (children.push(c), false));
    const top = alignToTop !== false;
    if (!children.length) {
      const [prev, next] = siblings(this._fragmentFiber);
      const target = top ? next || prev || parentHost(this._fragmentFiber) : prev || next;
      if (!target) return;
      if (target.kind === K.TEXT) return scrollText(nodeOf(target), top);
      const node = nodeOf(target);
      if (node.nodeType === 9) return;
      if (node.nodeType === 11) {
        const host = "host" in node ? node.host : null;
        if (host) host.scrollIntoView(alignToTop);
        else console.warn("You are attempting to scroll a FragmentInstance that is only mounted inside a detached DocumentFragment. No scroll was performed.");
        return;
      }
      node.scrollIntoView(alignToTop);
      return;
    }
    for (let i = top ? children.length - 1 : 0; i !== (top ? -1 : children.length); i += top ? -1 : 1) {
      const c = children[i]!;
      c.kind === K.TEXT ? scrollText(nodeOf(c), top) : nodeOf(c).scrollIntoView(alignToTop);
    }
  }
}

/** Whether a position found from the DOM agrees with the fiber tree (React's validateDocumentPositionWithFiberTree). */
function validPosition(pos: number, frag: FNode, firstChild: FNode, lastChild: FNode, other: Node): boolean {
  const N = Node;
  const otherFiber = fiberOfNode(other);
  if (pos & N.DOCUMENT_POSITION_CONTAINED_BY) {
    for (let f = otherFiber; f; f = f.parent) if (f === frag) return true;
    return false;
  }
  if (pos & N.DOCUMENT_POSITION_CONTAINS) {
    if (!otherFiber) {
      const d = (other as any).ownerDocument;
      return other === d || other === d?.documentElement || other === d?.body;
    }
    const parent = parentHost(frag);
    for (let f: FNode | null = frag; f; f = f.parent) if ((f.kind === K.HOST || f.kind === K.ROOT) && f === parent) return true;
    return false;
  }
  if (pos & (N.DOCUMENT_POSITION_PRECEDING | N.DOCUMENT_POSITION_FOLLOWING)) {
    if (!otherFiber) return false;
    const boundary = pos & N.DOCUMENT_POSITION_PRECEDING ? firstChild : lastChild;
    if (otherFiber === boundary) return true;
    const common = lowestCommonHost(boundary, otherFiber);
    if (!common) return false;
    let seenBoundary = false, found = false;
    visit([common], true, (c) => {
      if (pos & N.DOCUMENT_POSITION_PRECEDING) {
        if (c === boundary) return true;
        if (c === otherFiber) return (found = true), true;
        return false;
      }
      if (c === boundary) return (seenBoundary = true), false;
      if (c === otherFiber) return seenBoundary && (found = true), true;
      return false;
    });
    return found;
  }
  return false;
}
function hostParent(f: FNode | null): FNode | null {
  for (let p = f?.parent ?? null; p; p = p.parent) if (p.kind === K.HOST || p.kind === K.ROOT) return p;
  return null;
}
function lowestCommonHost(a: FNode, b: FNode): FNode | null {
  const depth = (f: FNode | null) => {
    let d = 0;
    for (let x = f; x; x = hostParent(x)) d++;
    return d;
  };
  let da = depth(a), db = depth(b);
  let x: FNode | null = a, y: FNode | null = b;
  while (da > db) (x = hostParent(x)), da--;
  while (db > da) (y = hostParent(y)), db--;
  while (da--) {
    if (x === y) return x;
    x = hostParent(x);
    y = hostParent(y);
  }
  return null;
}

function scrollText(text: Text, top: boolean) {
  const range = text.ownerDocument.createRange();
  range.selectNodeContents(text);
  const r = range.getBoundingClientRect();
  window.scrollTo(window.scrollX + r.left, top ? window.scrollY + r.top : window.scrollY + r.bottom - window.innerHeight);
}

function tryFocus(el: HTMLElement, options?: FocusOptions) {
  if (typeof el.focus !== "function") return false;
  const doc = el.ownerDocument;
  el.focus(options);
  return doc.activeElement === el;
}

/** Fragment instances above a host or text fiber (up to its host parent): told when it comes or goes. */
export function fragmentsAbove(f: FNode): FragmentInstance[] {
  const out: FragmentInstance[] = [];
  for (let p = f.parent; p; p = p.parent) {
    const inst = (p as any).fragment;
    if (p.kind === K.FRAG && inst) out.push(inst);
    if (p.kind === K.HOST || p.kind === K.ROOT) break;
  }
  return out;
}
