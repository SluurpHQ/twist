// Events as React DOM handles them: one listener per event type on each root's container (and each portal's), the
// handlers then found along the component tree, not the DOM: a portal's events reach its React ancestors, React's
// capture handlers run before native ones further down, and nested roots each answer for their own part.

// Events that do not bubble, listened to on the element itself (as React does).
const NOT_DELEGATED = new Set(
  "cancel close invalid load scroll scrollend toggle beforetoggle abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting mouseenter mouseleave pointerenter pointerleave".split(" "),
);
export const delegated = (type: string) => !NOT_DELEGATED.has(type);

type FiberLike = { kind: number; props: any; parent: FiberLike | null; dom: any; root: object };

/** The containers listened on, the roots each belongs to, and the event types each listens for. */
const containers = new Map<EventTarget, { roots: Set<object>; types: Set<string> }>();
// Always heard, handlers or not: a controlled field is put back after them even when it has no onChange.
const wanted = new Set<string>(["input", "change", "click"]);

/** What maps a native event and phase to the React props it runs: given by props.ts (it knows onChange's rules). */
let propsFor: (el: Element, type: string, capture: boolean, props: any, native: Event) => string[] = () => [];
let after: (el: Element, e: Event) => void = () => {};
export function configure(match: typeof propsFor, done: typeof after) {
  propsFor = match;
  after = done;
}

/** `container` answers for `root`'s events (a root's own container, or one a portal of it renders into). */
export function addContainer(container: EventTarget, root: object) {
  let c = containers.get(container);
  if (!c) containers.set(container, (c = { roots: new Set(), types: new Set() }));
  c.roots.add(root);
  for (const t of wanted) listenOn(container, c, t);
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

let rootIds = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => {
  let id = rootIds.get(o);
  if (id === undefined) rootIds.set(o, (id = nextId++));
  return id;
};

function dispatch(native: Event, container: EventTarget, roots: Set<object>, capture: boolean) {
  const from = nearest(native.target as Node, roots);
  if (!from) return;
  // A portal's container and its root's may both hear the event: each root runs it once per phase.
  const key = idOf(from.root) + (capture ? "c" : "b");
  let seen = done.get(native);
  if (!seen) done.set(native, (seen = new Set()));
  if (seen.has(key)) return;
  seen.add(key);
  const path: [Element, string[]][] = [];
  for (let f: FiberLike | null = from; f; f = f.parent) {
    if (f.kind !== HOST) continue;
    const names = propsFor(f.dom, native.type, capture, f.props, native);
    if (names.length) path.push([f.dom, names]);
  }
  if (capture) path.reverse();
  const synthetic = wrap(native);
  for (const [el, names] of path) {
    if (synthetic.isPropagationStopped()) break;
    synthetic.__current = el;
    for (const n of names) {
      const fn = (el as any).__props?.[n];
      if (typeof fn === "function") fn.call(el, synthetic);
    }
  }
  synthetic.__current = null;
  if (!capture) after((native.target as Element) ?? (container as Element), native);
}

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
