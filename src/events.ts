// Events as React DOM handles them: one listener per event type on each root's container (and each portal's), the
// handlers then found along the component tree, not the DOM: a portal's events reach its React ancestors, React's
// capture handlers run before native ones further down, and nested roots each answer for their own part.

// Events that do not bubble natively. React bubbles most of them along the component tree of the element's own
// root; they still pass the container on their way down, so it hears them in the capture phase.
const NOT_BUBBLING = new Set(
  "cancel close invalid load scroll scrollend toggle beforetoggle abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),
);
// Not bubbled by React either: only the target's own handlers.
const TARGET_ONLY = new Set(["scroll", "scrollend", "toggle", "beforetoggle"]);
export const delegated = (_type: string) => true;

// React's onMouseEnter/onMouseLeave (and the pointer ones): made from mouseover/mouseout at each root, entering and
// leaving each element between where the pointer was and where it is.
const ENTER_LEAVE: Record<string, [string, string, boolean]> = {
  mouseover: ["mouseenter", "mouseleave", true],
  mouseout: ["mouseenter", "mouseleave", false],
  pointerover: ["pointerenter", "pointerleave", true],
  pointerout: ["pointerenter", "pointerleave", false],
};
/** The native events an enter or leave prop needs heard. */
export const enterLeaveSources = (type: string) =>
  type === "mouseenter" || type === "mouseleave" ? ["mouseover", "mouseout"] : type === "pointerenter" || type === "pointerleave" ? ["pointerover", "pointerout"] : null;

/** What React's BeforeInputEventPlugin makes onBeforeInput from. */
export const BEFORE_INPUT_SOURCES = ["textInput", "keypress"];
/** The characters a native event types, as React's plugin reads them (textInput's data, or a keypress's character
 * where the browser has no TextEvent). */
function beforeInputChars(native: any): string | null {
  const textEvents = typeof window !== "undefined" && "TextEvent" in window;
  if (native.type === "textInput") return textEvents ? native.data ?? null : null;
  if (native.type === "keypress" && !textEvents) {
    if (native.ctrlKey || native.altKey || native.metaKey) return null;
    const code = native.charCode ?? native.which;
    return code && code >= 32 ? String.fromCharCode(code) : null;
  }
  return null;
}
/** onBeforeInput fired for a native event that types characters: on its target's path, as a polyfilled event. */
function beforeInputPlugin(native: Event, container: EventTarget, roots: Set<object>) {
  const chars = beforeInputChars(native);
  if (!chars) return;
  const ev: any = new Event("beforeinput", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "target", { value: native.target });
  ev.data = chars;
  // preventDefault on it prevents the typing (React's synthetic event reaches the native one).
  ev.preventDefault = () => native.preventDefault();
  dispatch(ev, container, roots, false, true);
}

/** What React's SelectEventPlugin watches to tell a selection changed. */
export const SELECT_SOURCES = ["focusin", "focusout", "keydown", "keyup", "mousedown", "mouseup", "dragend", "contextmenu"];
let selectFocus: HTMLElement | null = null;
let selectLast: any = null;
let mouseIsDown = false;
const selectable = (el: any) =>
  !!el && ((el.nodeName === "INPUT" && /^(|text|search|tel|url|password|email|number)$/.test(el.type ?? "")) || el.nodeName === "TEXTAREA" || el.contentEditable === "true");
function selectionOf(el: any): any {
  if ("selectionStart" in el && el.nodeName !== "DIV") return { start: el.selectionStart, end: el.selectionEnd };
  const sel = el.ownerDocument?.defaultView?.getSelection?.();
  return sel ? { anchorNode: sel.anchorNode, anchorOffset: sel.anchorOffset, focusNode: sel.focusNode, focusOffset: sel.focusOffset } : null;
}
const sameSelection = (a: any, b: any) => !!a && !!b && Object.keys(a).every((k) => a[k] === b[k]) && Object.keys(b).length === Object.keys(a).length;
/** The select plugin's part of a native event: tracks focus and the mouse, and fires onSelect when it is due. */
function selectPlugin(native: Event) {
  const t = native.type;
  if (t === "focusin") {
    if (selectable(native.target)) (selectFocus = native.target as HTMLElement), (selectLast = null);
    return;
  }
  if (t === "focusout") return void ((selectFocus = null), (selectLast = null));
  if (t === "mousedown") return void (mouseIsDown = true);
  if (t === "contextmenu" || t === "mouseup" || t === "dragend") mouseIsDown = false;
  if (t !== "selectionchange" && t !== "keydown" && t !== "keyup" && t !== "mouseup" && t !== "dragend" && t !== "contextmenu") return;
  const el = selectFocus;
  if (mouseIsDown || !el || el !== el.ownerDocument?.activeElement) return;
  const now = selectionOf(el);
  if (sameSelection(selectLast, now)) return;
  selectLast = now;
  const owner = nearestAny(el);
  if (!owner) return;
  for (const [container, c] of containers) {
    if (!c.roots.has(owner.root) || !(container as any).contains?.(el)) continue;
    const ev = new Event("select", { bubbles: true });
    Object.defineProperty(ev, "target", { value: el });
    dispatch(ev, container, new Set([owner.root]), false, true);
    return;
  }
}
let selectionDocs = new WeakSet<object>();
/** For a test runner: documents forgotten, as a fresh copy of React (jest.resetModules) listens on them again. */
export const forgetDocuments = () => void (selectionDocs = new WeakSet());

/** Host fibers from `f` up to its root, nearest first. */
function hostPath(f: FiberLike | null): FiberLike[] {
  const out: FiberLike[] = [];
  for (let p = f; p; p = p.parent) if (p.kind === HOST) out.push(p);
  return out;
}

function enterLeave(native: Event, roots: Set<object>, replay = false) {
  const [enter, leave, over] = ENTER_LEAVE[native.type]!;
  const related = (native as MouseEvent).relatedTarget as Node | null;
  // Coming from an element React draws: its mouseout already did this.
  if (over && related && nearestAny(related) && !replay) return;
  const fromNode = over ? null : (native.target as Node);
  const toNode = over ? (native.target as Node) : related;
  const from = fromNode ? nearest(fromNode, roots) : null;
  const to = toNode ? nearest(toNode, roots) : null;
  if (from === to) return;
  const up = hostPath(from);
  const down = hostPath(to);
  // What both share is neither left nor entered.
  while (up.length && down.length && up[up.length - 1] === down[down.length - 1]) up.pop(), down.pop();
  const run = (list: FiberLike[], type: string, target: Node | null, relatedTo: Node | null) => {
    const prop = type === "mouseenter" ? "onMouseEnter" : type === "mouseleave" ? "onMouseLeave" : type === "pointerenter" ? "onPointerEnter" : "onPointerLeave";
    for (const f of list) {
      const fn = f.props?.[prop];
      if (typeof fn !== "function") continue;
      const synthetic = wrap(native);
      synthetic.type = type;
      synthetic.target = target;
      synthetic.relatedTarget = relatedTo;
      synthetic.__current = f.dom;
      fn.call(undefined, synthetic);
    }
  };
  run(up, leave, fromNode, toNode);
  run(down.reverse(), enter, toNode, fromNode);
}

type FiberLike = { kind: number; props: any; parent: FiberLike | null; dom: any; root: object };

/** The containers listened on, the roots each belongs to, and the event types each listens for. */
const containers = new Map<EventTarget, { roots: Set<object>; types: Set<string> }>();
// Always heard, handlers or not: a controlled field is put back after them even when it has no onChange.
const wanted = new Set<string>(["input", "change", "click"]);

/** What maps a native event and phase to the React props it runs: given by props.ts (it knows onChange's rules). */
let propsFor: (el: Element, type: string, capture: boolean, props: any, native: Event) => string[] = () => [];
let after: (el: Element, e: Event) => void = () => {};
let onSubmit: (e: SubmitEvent, startedTransition: boolean) => void = () => {};
/** How many transitions have started (given by core): whether a submit's handlers started one. */
let transitionsStarted: () => number = () => 0;
export const countTransitionsWith = (fn: () => number) => void (transitionsStarted = fn);
export function configure(match: typeof propsFor, done: typeof after, submitted: typeof onSubmit) {
  propsFor = match;
  after = done;
  onSubmit = submitted;
}

/** `container` answers for `root`'s events (a root's own container, or one a portal of it renders into). */
export function addContainer(container: EventTarget, root: object) {
  let c = containers.get(container);
  if (!c) containers.set(container, (c = { roots: new Set(), types: new Set() }));
  c.roots.add(root);
  for (const t of wanted) listenOn(container, c, t);
  // The document's selectionchange, heard once per document (React's listenToAllSupportedEvents).
  const doc: any = (container as any).nodeType === 9 ? container : (container as any).ownerDocument;
  if (doc && !selectionDocs.has(doc)) {
    selectionDocs.add(doc);
    doc.addEventListener("selectionchange", selectPlugin, false);
  }
}

// The non-bubbling events React listens for on an element itself, by tag, from when it is made.
const MEDIA = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" ");
const BY_TAG: Record<string, string[]> = {
  dialog: ["cancel", "close", "toggle", "beforetoggle"],
  iframe: ["load"],
  object: ["load"],
  embed: ["load"],
  video: MEDIA,
  audio: MEDIA,
  source: ["error"],
  img: ["error", "load"],
  image: ["error", "load"],
  link: ["error", "load"],
  details: ["toggle"],
  input: ["invalid"],
  select: ["invalid"],
  textarea: ["invalid"],
};

/** An element just made: React's own listeners for the non-bubbling events its tag fires, bubbled in its root. */
export function listenOnElement(el: Element, tag: string) {
  // (Own entries only: a tag named like an object's property, <toString>, has none.)
  for (const type of Object.hasOwn(BY_TAG, tag) ? BY_TAG[tag]! : []) listenAt(el, type);
}

/** A listener on the element for a non-bubbling `type` (onScroll's, a popover's toggle), once. */
export function listenAt(el: Element, type: string) {
  const had: Set<string> = ((el as any).__nb ??= new Set());
  if (had.has(type)) return;
  had.add(type);
  el.addEventListener(type, (e) => {
    const f = (el as any)[FIBER];
    if (f && e.target === el) dispatch(e, el, new Set([f.root]), false);
  });
}

/** Events of `type` handled from now on, in every container. */
export function want(type: string) {
  if (wanted.has(type)) return;
  wanted.add(type);
  for (const [container, c] of containers) listenOn(container, c, type);
}

function listenOn(container: EventTarget, c: { roots: Set<object>; types: Set<string> }, type: string) {
  if (c.types.has(type)) return;
  c.types.add(type);
  if (NOT_BUBBLING.has(type)) {
    // Both phases at once, from the capture listener: the event will not come back up.
    // The capture phase here; the bubbling React emulates from the element's own listener (listenOnElement).
    container.addEventListener(type, (e) => dispatch(e, container, c.roots, true), true);
    return;
  }
  container.addEventListener(type, (e) => dispatch(e, container, c.roots, true), true);
  container.addEventListener(type, (e) => dispatch(e, container, c.roots, false), false);
}

const HOST = 2;
const done = new WeakMap<Event, Set<string>>();

/** Boundaries still as the server drew them (counted by core), their start comments marked. */
export const DEHYDRATED = Symbol.for("sluurp.dehydrated");
let dehydrated = 0;
export const countDehydrated = (d: number) => void (dehydrated += d);
/** Whether a node is inside a boundary not hydrated yet: an event there reaches no handler (React blocks it). */
function inDehydrated(target: Node | null): boolean {
  if (!dehydrated) return false;
  for (let n: any = target; n; n = n.parentNode) {
    // A node React already owns: the boundaries around it have hydrated.
    if (n[FIBER]) return false;
    let depth = 0;
    for (let s: any = n.previousSibling; s; s = s.previousSibling) {
      if (s.nodeType !== 8) continue;
      const d = s.data;
      if (d === "/$" || d === "/&") depth++;
      else if (d === "$" || d === "$?" || d === "$!" || d === "$~" || d === "&") {
        if (depth) depth--;
        else if (s[DEHYDRATED]) return true;
      }
    }
  }
  return false;
}

/** The nearest fiber of one of `roots` at or above the event's target. */
function nearest(target: Node | null, roots: Set<object>): FiberLike | null {
  if (inDehydrated(target)) return null;
  for (let n: any = target; n; n = n.parentNode) {
    const f: FiberLike | undefined = n[FIBER];
    if (f && roots.has(f.root)) return f;
  }
  return null;
}

/** The nearest fiber at or above a node, of any root. */
function nearestAny(target: Node | null): FiberLike | null {
  for (let n: any = target; n; n = n.parentNode) if (n[FIBER]) return n[FIBER];
  return null;
}

let rootIds = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => {
  let id = rootIds.get(o);
  if (id === undefined) rootIds.set(o, (id = nextId++));
  return id;
};

/** How an error thrown by a handler is told (core's report, as React's reportGlobalError). */
let reportHandlerError: (e: unknown) => void = (e) => {
  throw e;
};
export const reportHandlerErrorsWith = (fn: typeof reportHandlerError) => void (reportHandlerError = fn);

/** What core does first for an event whose target has not hydrated yet (React's attemptSynchronousHydration); true
 * when the target is still waiting to hydrate. */
let hydrateFor: (target: Node, roots: Set<object>, native: Event, continuous: boolean) => boolean = () => false;
export const hydrateBeforeEvents = (fn: typeof hydrateFor) => void (hydrateFor = fn);

/** Events that hover or move over what is still hydrating: the latest of each kind, replayed once it has hydrated. */
export const CONTINUOUS = new Set("focusin focusout dragenter dragleave mouseover mouseout pointerover pointerout gotpointercapture lostpointercapture".split(" "));
/** Those that enter something: queued; the others (out, leave, focusout…) clear what their kind queued. */
export const ENTERING = new Set("focusin dragenter mouseover pointerover gotpointercapture".split(" "));
const queued = new Map<string, { native: Event; target: Node; container: EventTarget; roots: Set<object> }>();
export const kindOf = (e: Event) =>
  e.type.startsWith("focus") ? "focus" : e.type.startsWith("drag") ? "drag" : e.type.startsWith("mouse") ? "mouse" : "pointer:" + ((e as PointerEvent).pointerId ?? "");
/** The queued events whose target has hydrated, dispatched again now: a copy of each on its target, as React
 * replays them (native listeners hear it too, and React's own only where the node still is in the root). */
let replaying: Event | null = null;
export function replayQueued() {
  for (const [kind, q] of [...queued]) {
    const target = q.target;
    if (target && !nearest(target, q.roots) && target.isConnected && q.roots.size && [...q.roots].some((r: any) => r.container?.contains?.(target))) continue;
    queued.delete(kind);
    if (!target) continue;
    const copy = new (q.native.constructor as any)(q.native.type, q.native);
    replaying = copy;
    try {
      target.dispatchEvent(copy);
    } finally {
      replaying = null;
    }
  }
}
/** Whether events wait to be replayed. */
export const replaysWaiting = () => queued.size > 0;

const hydrationAsked = new WeakMap<Event, boolean>();
/** Runs the handlers for one phase; true when one of them stopped propagation. */
function dispatch(native: Event, container: EventTarget, roots: Set<object>, capture: boolean, replay = native === replaying): boolean {
  // (The select plugin hears each event once, at its bubbling listener.)
  if (!capture && !replay && native.type !== "select" && SELECT_SOURCES.includes(native.type)) selectPlugin(native);
  if (!capture && !replay && (native.type === "textInput" || native.type === "keypress")) beforeInputPlugin(native, container, roots);
  if (native.target && !replay) {
    const continuous = CONTINUOUS.has(native.type);
    // (Asked once per event: its capture and bubble phases share the answer.)
    let blocked = hydrationAsked.get(native);
    if (blocked === undefined) hydrationAsked.set(native, (blocked = hydrateFor(native.target as Node, roots, native, continuous)));
    if (blocked && continuous && capture) {
      if (ENTERING.has(native.type)) queued.set(kindOf(native), { native, target: native.target as Node, container, roots });
      else queued.delete(kindOf(native));
      // (Its replay is what goes on: this one stops here, as React stops it.)
      native.stopPropagation();
      return true;
    }
    // A discrete event on what could not hydrate at once: stopped there, as React stops it (it cannot run it).
    if (blocked && !continuous) {
      native.stopPropagation();
      return true;
    }
  }
  const from = nearest(native.target as Node, roots);
  // Not committed yet: no handler hears it (React's getNearestMountedFiber).
  if (!from || (from as any).placed === false || (from as any).dead) return false;
  // A non-bubbling event bubbles only in the root that drew its target: an outer root hears its capture phase alone.
  if (!capture && NOT_BUBBLING.has(native.type)) {
    const owner = nearestAny(native.target as Node);
    if (owner && owner.root !== from.root) return false;
  }
  // A portal's container and its root's may both hear the event: each root runs it once per phase.
  const key = idOf(from.root) + (capture ? "c" : "b");
  let seen = done.get(native);
  if (!seen) done.set(native, (seen = new Set()));
  if (seen.has(key)) return false;
  seen.add(key);
  const path: [Element, string[]][] = [];
  // React's polyfilled events (onChange, onBeforeInput, onSelect, composition) run both their phases from the
  // root's bubbling listener: their capture handlers first, root by root.
  if (!capture) {
    const early: [Element, string[]][] = [];
    for (let f: FiberLike | null = from; f; f = f.parent) {
      if (f.kind !== HOST) continue;
      const names = propsFor(f.dom, native.type, true, f.dom[PROPS] ?? f.props, native).filter((n) => polyfilled(n) && (from.dom === native.target || !OWN_TARGET.test(n)));
      if (names.length) early.push([f.dom, names]);
    }
    path.push(...early.reverse());
  }
  for (let f: FiberLike | null = from; f; f = f.parent) {
    if (f.kind !== HOST) continue;
    if (!capture && TARGET_ONLY.has(native.type) && f.dom !== native.target) continue;
    let names = propsFor(f.dom, native.type, capture, f.dom[PROPS] ?? f.props, native);
    if (capture) names = names.filter((n) => !polyfilled(n));
    // A change or select is the root's that drew its target: an outer root does not hear an inner root's input.
    if (from.dom !== native.target) names = names.filter((n) => !OWN_TARGET.test(n));
    if (names.length) (capture ? path : bubbling).push([f.dom, names]);
  }
  if (capture) path.reverse();
  else path.push(...bubbling.splice(0));
  // A listener that is not a function: thrown before any runs (React's getListener).
  for (const [el, names] of path)
    for (const n of names) {
      const fn = (el as any)[PROPS]?.[n];
      if (fn && typeof fn !== "function") throw new Error(`Expected \`${n}\` listener to be a function, instead got a value of \`${typeof fn}\` type.`);
    }
  const synthetic = wrap(native);
  const transitionsBefore = !capture && native.type === "submit" ? transitionsStarted() : 0;
  for (const [el, names] of path) {
    if (synthetic.isPropagationStopped()) break;
    synthetic.__current = el;
    for (const n of names) {
      const fn = (el as any)[PROPS]?.[n];
      synthetic.__type = POLYFILLED[n.endsWith("Capture") ? n.slice(0, -7) : n];
      // What one throws is reported, and the others still run (React's reportGlobalError).
      if (typeof fn === "function")
        try {
          fn.call(undefined, synthetic);
        } catch (e) {
          reportHandlerError(e);
        }
    }
  }
  synthetic.__current = null;
  if (!capture && native.type in ENTER_LEAVE) enterLeave(native, roots, replay);
  // A form's action, after its onSubmit handlers (they may prevent it).
  if (!capture && native.type === "submit") onSubmit(native as SubmitEvent, transitionsStarted() !== transitionsBefore);
  if (!capture) after((native.target as Element) ?? (container as Element), native);
  return synthetic.isPropagationStopped();
}

const SYNTHETIC_TYPE: Record<string, string> = { focusin: "focus", focusout: "blur" };

/** React's polyfilled events, and the type their synthetic event has (whatever native event made them). */
const POLYFILLED: Record<string, string | undefined> = { onChange: "change", onBeforeInput: "beforeinput", onSelect: "select", onCompositionStart: undefined, onCompositionEnd: undefined, onCompositionUpdate: undefined };
const polyfilled = (n: string) => (n.endsWith("Capture") ? n.slice(0, -7) : n) in POLYFILLED;
const bubbling: [Element, string[]][] = [];
const OWN_TARGET = /^on(Change|Select)(Capture)?$/;

/** React's synthetic event: the native one, with React's currentTarget, nativeEvent and propagation flags. */
function wrap(native: Event): any {
  let stopped = false;
  const own: Record<PropertyKey, any> = {
    nativeEvent: native,
    __current: null,
    persist: () => {},
    isPropagationStopped: () => stopped,
    isDefaultPrevented: () => native.defaultPrevented,
    stopPropagation: () => {
      stopped = true;
      native.stopPropagation();
    },
  };
  return new Proxy(native, {
    get(t, k) {
      if (k === "currentTarget") return own.__current;
      if (k === "type") return own.__type ?? own.type ?? SYNTHETIC_TYPE[t.type] ?? t.type;
      if ((k === "target" || k === "relatedTarget") && k in own) return own[k];
      // A text node's event targets its element (React's getEventTarget).
      if (k === "target") {
        const tg: any = t.target;
        return tg && tg.nodeType === 3 ? tg.parentNode : tg;
      }
      if (k in own) return own[k as string];
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(_t, k, v) {
      own[k as string] = v;
      return true;
    },
    has: (t, k) => k in own || k in t,
  });
}
import { FIBER, PROPS } from "./warnings.ts";
