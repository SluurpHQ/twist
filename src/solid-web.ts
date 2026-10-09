// What JSX compiled by Solid's compiler (dom-expressions, `moduleName: "@sluurp/dom/solid"`) calls: templates cloned,
// expressions inserted and kept current by effects of their own. No fibers, no diffing of elements.
import { collect, effect as signalEffect, untrack } from "../../signals/index.js";

export { createComponent, For, Show, mapArray, createSignal, createMemo, createEffect, createRoot, getOwner, untrack, flush } from "./solid.ts";

type Node_ = Node & { [k: string]: any };

/** A template's element, made once from its markup and cloned for each use. */
export function template(html: string, flag?: number) {
  let node: Node | null = null;
  const make = () => {
    const t = document.createElement("template");
    t.innerHTML = html;
    // (Flag 2: markup wrapped in an <svg> so the browser parses it as SVG.)
    return flag === 2 ? t.content.firstChild!.firstChild! : t.content.firstChild!;
  };
  return flag === 1 ? () => document.importNode((node ??= make()), true) : () => (node ??= make()).cloneNode(true);
}

/**
 * Compiled JSX's effect: `compute` tracks, `apply` writes to the DOM with what it gave (and what it gave before).
 * Owning: what `compute` builds goes when it runs again.
 */
export function effect<T>(compute: (prev?: T) => T, apply: (value: T, prev?: T) => void) {
  let prev: T | undefined;
  let first = true;
  signalEffect(
    () => {
      const value = compute(prev);
      untrack(() => apply(value, first ? undefined : prev));
      prev = value;
      first = false;
    },
    { owns: true },
  );
}

/** A value worked out once per change of what it reads (compiled JSX's conditionals). */
export { createMemo as memo } from "./solid.ts";

// ---------------------------------------------------------------- inserting

/** What `value` puts in the page: text, a node, a list of nodes, or nothing; functions read (they are accessors). */
function nodesOf(value: any, out: Node[], current: any): Node[] {
  if (value == null || value === true || value === false || value === "") return out;
  if (typeof value === "function") return nodesOf(value(), out, current);
  if (Array.isArray(value)) {
    for (const v of value) nodesOf(v, out, current);
    return out;
  }
  if ((value as Node).nodeType) return out.push(value), out;
  // Text: the text node already there for it reused.
  const text = "" + value;
  const reuse = Array.isArray(current) ? current.find((n: Node) => n.nodeType === 3 && !out.includes(n)) : null;
  if (reuse) {
    if ((reuse as Text).data !== text) (reuse as Text).data = text;
    out.push(reuse);
  } else out.push(document.createTextNode(text));
  return out;
}

/**
 * `value` put in `parent` before `marker` (at the end without one), replacing what `current` put there; answers what
 * is there now. Lists are reconciled: nodes kept stay, the longest run in order is not moved.
 */
function put(parent: Node, value: any, current: any, marker: Node | null | undefined): any {
  if (value === current) return current;
  const t = typeof value;
  // Text alone in its element (the commonest case): its text node set.
  if ((t === "string" || t === "number") && marker === undefined) {
    const text = "" + value;
    if (current != null && typeof current !== "object") {
      const first = parent.firstChild as Text | null;
      if (first && first.nodeType === 3) return (first.data !== text && (first.data = text)), text;
    }
    clear(parent, current, marker);
    parent.textContent = text;
    return text;
  }
  const next = nodesOf(value, [], current);
  const old: Node[] = Array.isArray(current) ? current : current && typeof current === "object" ? [current] : [];
  if (current != null && !Array.isArray(current) && typeof current !== "object") clear(parent, current, marker);
  reconcile(parent, old, next, marker ?? null);
  return next;
}

/** What `current` put in `parent` taken out. */
function clear(parent: Node, current: any, marker: Node | null | undefined) {
  if (current == null) return;
  if (Array.isArray(current)) for (const n of current) n.parentNode === parent && parent.removeChild(n);
  else if (typeof current === "object") current.parentNode === parent && parent.removeChild(current);
  else if (marker === undefined) parent.textContent = "";
}

/** `old` nodes made `next` in `parent`, before `marker`: gone ones removed, kept ones moved only off the longest run. */
function reconcile(parent: Node, old: Node[], next: Node[], marker: Node | null) {
  if (!old.length) {
    // All new: put in one go (a fragment when there are many).
    if (next.length > 1) {
      const frag = document.createDocumentFragment();
      for (const n of next) frag.appendChild(n);
      parent.insertBefore(frag, marker);
    } else if (next.length) parent.insertBefore(next[0]!, marker);
    return;
  }
  if (!next.length) {
    // All gone: the element emptied at once when they were all it held.
    if (marker == null && parent.firstChild === old[0] && parent.lastChild === old[old.length - 1]) (parent as Element).textContent = "";
    else for (const n of old) n.parentNode === parent && parent.removeChild(n);
    return;
  }
  const at = new Map<Node, number>();
  for (let i = 0; i < old.length; i++) at.set(old[i]!, i);
  const nextSet = new Set(next);
  for (const n of old) if (!nextSet.has(n) && n.parentNode === parent) parent.removeChild(n);
  const stay = longestInOrder(next, at);
  let cursor: Node | null = marker;
  for (let j = next.length - 1; j >= 0; j--) {
    const n = next[j]!;
    if (!stay.has(n) || n.parentNode !== parent) parent.insertBefore(n, cursor);
    cursor = n;
  }
}

/** The nodes of `next` (with their old places) forming the longest run still in order: those need not move. */
function longestInOrder(next: Node[], at: Map<Node, number>): Set<Node> {
  const tails: number[] = [];
  const prev = new Int32Array(next.length);
  for (let j = 0; j < next.length; j++) {
    const oi = at.get(next[j]!);
    if (oi === undefined) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at.get(next[tails[mid]!]!)! < oi) lo = mid + 1;
      else hi = mid;
    }
    prev[j] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = j;
  }
  const stay = new Set<Node>();
  for (let j = tails.length ? tails[tails.length - 1]! : -1; j >= 0; j = prev[j]!) stay.add(next[j]!);
  return stay;
}

/**
 * An expression put in `parent` (before `marker`): a value once, an accessor kept current. `initial` is what is
 * there already.
 */
export function insert(parent: Node, value: any, marker?: Node | null, initial?: any) {
  let current = initial;
  if (marker !== undefined && current === undefined) current = [];
  if (typeof value !== "function") return void (current = put(parent, value, current, marker));
  effect(
    () => {
      let v = value();
      // An accessor giving an accessor (a component's list): read inside, so its changes are this effect's.
      while (typeof v === "function") v = v();
      return v;
    },
    (v) => (current = put(parent, v, current, marker)),
  );
}

// ---------------------------------------------------------------- attributes and properties

export function className(node: Element, value: any, prev?: any) {
  if (value == null || value === false) return prev != null && node.removeAttribute("class");
  if (typeof value !== "object") return void (value !== prev && (node.className = "" + value));
  // { name: on }: each class on or off.
  for (const k in prev ?? {}) if (k && !value[k]) node.classList.remove(k);
  for (const k in value) if (k && !!value[k] !== !!prev?.[k]) node.classList.toggle(k, !!value[k]);
}

export function setAttribute(node: Element, name: string, value: any) {
  if (value == null || value === false) node.removeAttribute(name);
  else node.setAttribute(name, value === true ? "" : "" + value);
}

export function setAttributeNS(node: Element, ns: string, name: string, value: any) {
  if (value == null || value === false) node.removeAttributeNS(ns, name.slice(name.indexOf(":") + 1));
  else node.setAttributeNS(ns, name, value === true ? "" : "" + value);
}

export function setProperty(node: Node_, name: string, value: any) {
  node[name] = name === "value" && value == null ? "" : value;
}
export const setProp = setProperty;

export function style(node: HTMLElement, value: any, prev?: any) {
  if (!value) return prev && node.removeAttribute("style");
  if (typeof value === "string") return void (node.style.cssText = value);
  // { "css-name": value }, as Solid writes styles (CSS names, values as given).
  if (typeof prev === "string") (node.style.cssText = ""), (prev = undefined);
  for (const k in prev) if (value[k] == null) node.style.removeProperty(k);
  for (const k in value) if (value[k] != null && value[k] !== prev?.[k]) node.style.setProperty(k, "" + value[k]);
}

export function setStyleProperty(node: HTMLElement, name: string, value: any) {
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
}

/** `ref={fn}` (or a list of them): called with the element. */
export function ref(r: any, node: Element) {
  if (Array.isArray(r)) for (const f of r) ref(f, node);
  else if (typeof r === "function") untrack(() => r(node));
}
export const applyRef = (r: any, node: Element) => ref(r, node);
export const use = (fn: (el: Element, arg: any) => any, node: Element, arg: any) => untrack(() => fn(node, arg));

/** Props given as a whole (`{...props}`): each applied, kept current as the object's getters change. */
export function spread(node: Element, props: any, skipChildren?: boolean) {
  let prev: Record<string, any> = {};
  effect(
    () => {
      const next: Record<string, any> = {};
      for (const k in props) if (k !== "children" && k !== "ref") next[k] = props[k];
      return next;
    },
    (next) => {
      for (const k in prev) if (!(k in next)) assign(node, k, undefined, prev[k]);
      for (const k in next) if (next[k] !== prev[k]) assign(node, k, next[k], prev[k]);
      prev = next;
    },
  );
  if (props.ref) ref(props.ref, node);
  if (!skipChildren && "children" in props) insert(node, () => props.children);
}

function assign(node: Element, name: string, value: any, prev: any) {
  if (name === "class" || name === "className") return className(node, value, prev);
  if (name === "style") return style(node as HTMLElement, value, prev);
  if (name.startsWith("on")) {
    const type = name.slice(2).toLowerCase();
    if (prev) node.removeEventListener(type, prev);
    if (value) node.addEventListener(type, value);
    return;
  }
  if (name === "value" || name === "checked" || name === "selected" || name === "innerHTML" || name === "textContent") return setProperty(node, name, value);
  setAttribute(node, name, value);
}

export function addEventListener(node: Element, name: string, handler: any, delegate?: boolean) {
  if (delegate) return void ((node as Node_)["$$" + name] = handler);
  node.addEventListener(name, handler);
}

// ---------------------------------------------------------------- events, delegated to the document

const delegated = new Set<string>();

/** Events listened to once on the document; each reaches the `$$name` handlers from its target up. */
export function delegateEvents(names: string[]) {
  for (const name of names) {
    if (delegated.has(name)) continue;
    delegated.add(name);
    document.addEventListener(name, onDelegated);
  }
}

function onDelegated(e: Event) {
  const key = "$$" + e.type;
  let node = e.target as Node_ | null;
  Object.defineProperty(e, "currentTarget", { configurable: true, get: () => node ?? document });
  while (node) {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[key + "Data"];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node = node.parentNode as Node_ | null;
  }
}

// ---------------------------------------------------------------- render

/** `code()` put in `element`, kept current; answers a function that takes it away. */
export function render(code: () => any, element: Element) {
  const [, dispose] = collect(() => insert(element, code()));
  return () => {
    dispose();
    element.textContent = "";
  };
}

/** Props from several sources (later ones win), read where they are used. */
export function mergeProps(...sources: any[]) {
  const out: any = {};
  for (const s of sources) {
    if (!s) continue;
    for (const k of Object.keys(s)) {
      const d = Object.getOwnPropertyDescriptor(s, k)!;
      Object.defineProperty(out, k, { enumerable: true, configurable: true, get: d.get ?? (() => s[k]) });
    }
  }
  return out;
}
