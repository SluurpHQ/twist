// Ported from Solid's frames/src/bind-tier.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
/** `@solidjs/web/frames/bind` — the frames client's BIND tier (frames */
import { createRenderEffect, createSignal, onCleanup, untrack } from "../client/index.ts";
// `assign` MUST be the shared @solidjs/web instance (external in
import { assign, runHydrationEvents } from "../web.ts";
import { sharedConfig } from "../internal.ts";
// The eager frames client — the SHARED instance the app runs (see above).
import { isAsyncValue } from "./client.ts";
// Own copies: the marker constants and the dev-only shape finders.
import { SLOT_MARKER, SLOT_TEXT, shapeOf, slotShapeFinding } from "./frame-client.ts";

declare const process: { env: Record<string, string | undefined> };
// Development only: guidance folds out of production builds.
const IS_DEV = process.env.NODE_ENV !== "production";

// === The marker grammar's readers ===

/** One marker entry, `<occurrence>:<key>[=<name>]`, as `[occurrence, */
function slotEntry(entry: string, pos: string): [string, any] | null {
  const colon = entry.indexOf(":");
  if (colon < 1) return null;
  const eq = entry.indexOf("=", colon);
  return [
    entry.slice(0, colon),
    {
      pos,
      key: decodeURIComponent(eq === -1 ? entry.slice(colon + 1) : entry.slice(colon + 1, eq)),
      name: eq === -1 ? undefined : decodeURIComponent(entry.slice(eq + 1))
    }
  ];
}

/** An occurrence's consumer list, created on first use; null when a slot */
function consumersOf(elements: Map<string, any>, occurrence: string): any[] | null {
  let consumers = elements.get(occurrence);
  if (consumers === undefined) elements.set(occurrence, (consumers = []));
  return Array.isArray(consumers) ? consumers : null;
}

/** Register a text start marker's position on its parent element's consumer */
export function text(start: Comment, elements: Map<string, any>): void {
  const parsed = slotEntry(start.data.slice(SLOT_TEXT.length), "text");
  const consumers = parsed && consumersOf(elements, parsed[0]);
  if (!consumers) return;
  const element = start.parentNode;
  let consumer;
  for (let i = consumers.length; i-- && !consumer; )
    if (consumers[i].element === element) consumer = consumers[i];
  consumer || consumers.push((consumer = { element, positions: [] }));
  parsed![1].start = start;
  consumer.positions.push(parsed![1]);
}

/** Parse one element's `_s:*` markers into positions grouped by occurrence: */
function slotPositions(el: Element): Record<string, any[]> | null {
  const attrs = el.attributes;
  let out: Record<string, any[]> | null = null;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!attr.name.startsWith(SLOT_MARKER)) continue;
    const pos = attr.name.slice(SLOT_MARKER.length);
    for (const entry of attr.value.split(",")) {
      const parsed = slotEntry(entry, pos);
      if (!parsed) continue;
      out || (out = Object.create(null));
      (out![parsed[0]] || (out![parsed[0]] = [])).push(parsed[1]);
    }
  }
  return out;
}

/** An element's positions join each occurrence's consumer list, in document */
export function positions(el: Element, elements: Map<string, any>): void {
  const byOccurrence = slotPositions(el);
  if (byOccurrence !== null) {
    for (const occurrence in byOccurrence) {
      const consumers = consumersOf(elements, occurrence);
      if (consumers) consumers.push({ element: el, positions: byOccurrence[occurrence] });
    }
  }
}

/** Whether a data occurrence's consumer set changed (elements or positions). */
function consumersEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.element !== y.element || x.positions.length !== y.positions.length) return false;
    for (let j = 0; j < x.positions.length; j++) {
      const p = x.positions[j];
      const q = y.positions[j];
      if (p.pos !== q.pos || p.key !== q.key || p.name !== q.name || p.start !== q.start)
        return false;
    }
  }
  return true;
}

// === The per-frame consumer set ===

/** One data occurrence's state on a frame: the consumer set last handed */
interface Occurrence {
  consumers: any[] | undefined;
  rebind: ((consumers: any[]) => void) | undefined;
}
// Per frame: occurrence -> state.
const byFrame = new WeakMap<object, Map<string, Occurrence>>();
function occurrencesOf(frame: object): Map<string, Occurrence> {
  let slots = byFrame.get(frame);
  if (!slots) byFrame.set(frame, (slots = new Map()));
  return slots;
}

/** The consumer set the slot sync found for a MOUNTED data occurrence — at */
export function sync(frame: object, occurrence: string, consumers: any[]): void {
  const slots = occurrencesOf(frame);
  const entry = slots.get(occurrence);
  // The mount: the invocation registered its rebinder first (`rebinder`),
  if (!entry) slots.set(occurrence, { consumers, rebind: undefined });
  else if (!entry.consumers) entry.consumers = consumers;
  else if (!consumersEqual(entry.consumers, consumers)) {
    entry.consumers = consumers;
    entry.rebind && entry.rebind(consumers);
  }
}

/** The mount's rebind callback (`ctx.onRebind`), registered during the */
export function rebinder(frame: object, occurrence: string, fn: (consumers: any[]) => void): void {
  const slots = occurrencesOf(frame);
  const entry = slots.get(occurrence);
  if (entry) entry.rebind = fn;
  else slots.set(occurrence, { consumers: undefined, rebind: fn });
}

/** The occurrence is gone (unmounted, or re-invoked: the new invocation */
export function unmount(frame: object, occurrence: string): void {
  byFrame.get(frame)?.delete(occurrence);
}

// === The morph's owned-position arms ===

/** The positions of an incoming element a client fill writes (see */
interface Owned {
  attrs: Set<string>;
  class: string[] | null;
  style: string[] | null;
}

// Binding-slot ownership (principles §9.2.3).
export function owned(el: Element): Owned | null {
  const attrs = el.attributes;
  let out: Owned | null = null;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i].name;
    if (!name.startsWith(SLOT_MARKER)) continue;
    const pos = name.slice(SLOT_MARKER.length);
    if (pos === "ref" || pos.startsWith("on:")) continue;
    out || (out = { attrs: new Set(), class: null, style: null });
    if (pos !== "class" && pos !== "style") {
      out.attrs.add(pos);
      continue;
    }
    for (const entry of attrs[i].value.split(",")) {
      const eq = entry.indexOf("=");
      if (eq === -1) {
        out.attrs.add(pos); // a whole-value read owns the attribute
        continue;
      }
      (out[pos] || (out[pos] = [])).push(decodeURIComponent(entry.slice(eq + 1)));
    }
  }
  return out;
}

/** Set `class` to the server's value with the fill-owned class names' live */
function morphOwnedClass(oldEl: Element, value: string, names: string[]): boolean {
  const list = oldEl.classList;
  const set = new Set(value ? value.split(/\s+/) : []);
  set.delete("");
  for (const name of names) list.contains(name) ? set.add(name) : set.delete(name);
  const next = [...set].join(" ");
  if (next === (oldEl.getAttribute("class") || "")) return false;
  next ? oldEl.setAttribute("class", next) : oldEl.removeAttribute("class");
  return true;
}

/** Set `style` to the server's value with the fill-owned properties' live */
function morphOwnedStyle(oldEl: HTMLElement, value: string, names: string[]): boolean {
  const style = oldEl.style;
  const saved = names.map(name => [
    name,
    style.getPropertyValue(name),
    style.getPropertyPriority(name)
  ]);
  const before = oldEl.getAttribute("style");
  value ? oldEl.setAttribute("style", value) : oldEl.removeAttribute("style");
  for (const [name, v, priority] of saved) {
    v ? style.setProperty(name, v, priority) : style.removeProperty(name);
  }
  return oldEl.getAttribute("style") !== before;
}

/** Apply the server's value for `name` (null: absent) to an element with */
export function apply(
  oldEl: Element,
  name: string,
  value: string,
  owned: Owned
): boolean | undefined {
  if (owned.attrs.has(name)) return false;
  if ((name === "class" || name === "style") && owned[name] !== null) {
    return name === "class"
      ? morphOwnedClass(oldEl, value, owned.class!)
      : morphOwnedStyle(oldEl as HTMLElement, value, owned.style!);
  }
  return undefined;
}

// === The binding ===

interface ElementState {
  /** `assign`'s diff state: the props last written to the element. */
  prev: Record<string, any>;
  /** Bound handler props (`onclick`): the key and the value read at bind. */
  handlers: Record<string, { key: string; value: any }>;
  /** The ref dispatcher for the element's current ref keys, and those keys. */
  ref: ((el: Element) => void) | undefined;
  refId: string;
}

/** The occurrence holding each handler prop of an element. */
const handlerOwners = new WeakMap<Element, Record<string, object>>();

/** Bind a binding-slot occurrence (principles §9.2.3). */
export function bind(
  fill: (args: any) => any,
  args: any,
  ctx: any,
  label: string | undefined
): void {
  const [consumers, setConsumers] = createSignal<any[]>(ctx.positions);
  ctx.onRebind(setConsumers);
  const raw = untrack(() => fill(args), label);
  // Content where data was expected: a DOM node is an object, so it is
  const node = typeof Node === "function" && raw instanceof Node;
  const pending = isAsyncValue(raw);
  if (IS_DEV && (raw == null || typeof raw !== "object" || Array.isArray(raw) || node || pending)) {
    const shape = shapeOf(raw);
    slotShapeFinding(
      { reason: "fill-shape", occurrence: ctx.key, shape },
      `[BINDING_SLOT_POSITION] The fill for \`${ctx.key}\` returned ${shape}; server markup reads ` +
        `its properties at bound positions, so it must return an object (\`{ done, onToggle, … }\`). ` +
        `Nothing binds.`
    );
  }
  const out = raw == null || typeof raw !== "object" || node || pending ? {} : raw;
  const token = {};
  const state = new WeakMap<Element, ElementState>();
  // The elements written last time: one that drops out of the consumer
  let bound = new Set<Element>();
  createRenderEffect(
    () => consumers().map(valuesFor),
    writes => {
      const next = new Set<Element>();
      for (const { element, positions, values, texts } of writes) {
        next.add(element);
        write(element, positions, values);
        for (const [start, v, key] of texts) writeText(start, v, key);
      }
      for (const element of bound) if (!next.has(element)) release(element);
      bound = next;
    }
  );
  // The occurrence's end (a later response dropped it, a positional id now
  onCleanup(() => {
    for (const element of bound) release(element);
  });
  // Value positions are READ in the compute phase: a getter read here
  function valuesFor({ element, positions }: { element: Element; positions: any[] }) {
    const props: Record<string, any> = {};
    const texts: [Comment, unknown, string][] = [];
    let classNames: Record<string, boolean> | null = null;
    let styleProps: Record<string, any> | null = null;
    for (const { pos, key, name, start } of positions) {
      if (pos === "ref" || pos.startsWith("on:")) continue;
      if (pos === "text") texts.push([start, out[key], key]);
      else if (pos === "class" || pos === "style") {
        if (name === undefined) props[pos] = out[key];
        else if (pos === "class") (classNames || (classNames = {}))[name] = !!out[key];
        else (styleProps || (styleProps = {}))[name] = out[key];
      } else props[pos] = out[key];
    }
    if (classNames !== null && !("class" in props)) props.class = classNames;
    if (styleProps !== null && !("style" in props)) props.style = styleProps;
    return { element, positions, values: props, texts };
  }
  function write(element: Element, positions: any[], props: Record<string, any>) {
    let st = state.get(element);
    if (!st) state.set(element, (st = { prev: {}, handlers: {}, ref: undefined, refId: "" }));
    // Handler positions: the marker's event name (`onClick` compiled to
    const handlers: Record<string, string> = {};
    const refKeys: string[] = [];
    for (const { pos, key } of positions) {
      if (pos === "ref") refKeys.push(key);
      else if (pos.startsWith("on:")) handlers["on" + pos[3].toUpperCase() + pos.slice(4)] = key;
    }
    let owners = handlerOwners.get(element);
    if (!owners) handlerOwners.set(element, (owners = {}));
    let events = false;
    for (const prop in handlers) {
      events = true;
      const key = handlers[prop];
      let h = st.handlers[prop];
      if (h === undefined || h.key !== key)
        st.handlers[prop] = h = { key, value: untrack(() => out[key]) };
      props[prop] = h.value;
      owners[prop] = token;
    }
    // A handler the server released (or this occurrence let go of) is
    const clearing: Record<string, true> = {};
    for (const prop in st.handlers) {
      if (prop in handlers) continue;
      delete st.handlers[prop];
      if (owners[prop] === token) {
        delete owners[prop];
        clearing[prop] = true;
      }
    }
    if (refKeys.length) {
      // One stable ref per key set: `assign` fires a ref when its value
      const id = refKeys.join(",");
      if (st.refId !== id) {
        const refs = refKeys.map(k => untrack(() => out[k]));
        st.refId = id;
        st.ref = (el: Element) => {
          for (const r of refs) typeof r === "function" && r(el);
        };
      }
      props.ref = st.ref;
    }
    // A value position the server RELEASED (a rebind whose incoming markup
    for (const k in st.prev) {
      if (k in props || k === "ref" || k in clearing) continue;
      delete st.prev[k];
    }
    assign(element, props, true, st.prev);
    // Option (a) of the replay-window ruling (frames-rulings 3.1, C6): an
    if (events && sharedConfig.completed && !sharedConfig.completed.has(element)) {
      sharedConfig.completed.add(element);
      runHydrationEvents();
    }
  }
  function release(element: Element) {
    if (!state.has(element)) return;
    write(element, [], {});
    state.delete(element);
  }
  // A text position renders as a client insert renders a primitive: a
  function writeText(start: Comment, v: unknown, key: string) {
    let s = "";
    if (typeof v === "string" || typeof v === "number") s = "" + v;
    else if (IS_DEV && v != null && typeof v !== "boolean") {
      const shape = shapeOf(v);
      slotShapeFinding(
        { reason: "text-shape", occurrence: ctx.key, key, shape },
        `[BINDING_SLOT_POSITION] \`${key}\` of \`${ctx.key}\` is placed as text, but the fill ` +
          `returned ${shape} for it. A text position renders a string or number; markup belongs ` +
          `in a template slot. The text is cleared.`
      );
    }
    const n = start.nextSibling;
    if (n && n.nodeType === 3) {
      if ((n as Text).data !== s) (n as Text).data = s;
    } else if (s) start.after(s);
  }
}
