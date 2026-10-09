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

/** Host fibers from `f` up to its root, nearest first. */
function hostPath(f: FiberLike | null): FiberLike[] {
  const out: FiberLike[] = [];
  for (let p = f; p; p = p.parent) if (p.kind === HOST) out.push(p);
  return out;
}

function enterLeave(native: Event, roots: Set<object>) {
  const [enter, leave, over] = ENTER_LEAVE[native.type]!;
  const related = (native as MouseEvent).relatedTarget as Node | null;
  // Coming from an element React draws: its mouseout already did this.
  if (over && related && nearestAny(related)) return;
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
      fn.call(f.dom, synthetic);
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
  for (const type of BY_TAG[tag] ?? []) listenAt(el, type);
}

/** A listener on the element for a non-bubbling `type` (onScroll's, a popover's toggle), once. */
export function listenAt(el: Element, type: string) {
  const had: Set<string> = ((el as any).__nb ??= new Set());
  if (had.has(type)) return;
  had.add(type);
  el.addEventListener(type, (e) => {
    const f = (el as any).__fiber;
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

/** The nearest fiber of one of `roots` at or above the event's target. */
function nearest(target: Node | null, roots: Set<object>): FiberLike | null {
  for (let n: any = target; n; n = n.parentNode) {
    const f: FiberLike | undefined = n.__fiber;
    if (f && roots.has(f.root)) return f;
  }
  return null;
}

/** The nearest fiber at or above a node, of any root. */
function nearestAny(target: Node | null): FiberLike | null {
  for (let n: any = target; n; n = n.parentNode) if (n.__fiber) return n.__fiber;
  return null;
}

let rootIds = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => {
  let id = rootIds.get(o);
  if (id === undefined) rootIds.set(o, (id = nextId++));
  return id;
};

/** Runs the handlers for one phase; true when one of them stopped propagation. */
function dispatch(native: Event, container: EventTarget, roots: Set<object>, capture: boolean): boolean {
  const from = nearest(native.target as Node, roots);
  if (!from) return false;
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
  for (let f: FiberLike | null = from; f; f = f.parent) {
    if (f.kind !== HOST) continue;
    if (!capture && TARGET_ONLY.has(native.type) && f.dom !== native.target) continue;
    const names = propsFor(f.dom, native.type, capture, f.props, native);
    if (names.length) path.push([f.dom, names]);
  }
  if (capture) path.reverse();
  const synthetic = wrap(native);
  const transitionsBefore = !capture && native.type === "submit" ? transitionsStarted() : 0;
  for (const [el, names] of path) {
    if (synthetic.isPropagationStopped()) break;
    synthetic.__current = el;
    for (const n of names) {
      const fn = (el as any).__props?.[n];
      if (typeof fn === "function") fn.call(el, synthetic);
    }
  }
  synthetic.__current = null;
  if (!capture && native.type in ENTER_LEAVE) enterLeave(native, roots);
  // A form's action, after its onSubmit handlers (they may prevent it).
  if (!capture && native.type === "submit") onSubmit(native as SubmitEvent, transitionsStarted() !== transitionsBefore);
  if (!capture) after((native.target as Element) ?? (container as Element), native);
  return synthetic.isPropagationStopped();
}

const SYNTHETIC_TYPE: Record<string, string> = { focusin: "focus", focusout: "blur" };

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
      if (k === "type") return own.type ?? SYNTHETIC_TYPE[t.type] ?? t.type;
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
