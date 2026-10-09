// Props on DOM elements, as React sets them: attributes or properties, styles, and events listened to on the
// element itself (no delegation), each event given what React's handlers expect of it.

import { XLINK_NS, XML_NS, attribute } from "./attributes.ts";
import { configure, delegated, want } from "./events.ts";
import { checkPropName } from "./warnings.ts";
import { valueChanged } from "./forms.ts";

export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATH_NS = "http://www.w3.org/1998/Math/MathML";

const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "defaultValue", "defaultChecked", "innerHTML"]);

// Numbers that stay numbers in a style (everything else gets px).
const UNITLESS = new Set(
  "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth".split(" "),
);



function styleValue(name: string, value: any) {
  if (value == null || typeof value === "boolean" || value === "") return "";
  if (typeof value === "number" && value !== 0 && !UNITLESS.has(name) && !name.startsWith("--")) return value + "px";
  return String(value).trim();
}
const cssName = (n: string) => (n.startsWith("--") ? n : n.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).replace(/^ms-/, "-ms-"));

function setStyle(el: HTMLElement, next: any, prev: any) {
  const s = el.style;
  if (typeof next === "string") {
    s.cssText = next;
    return;
  }
  if (typeof prev === "string") s.cssText = "";
  if (prev && typeof prev === "object") for (const k in prev) if (!next || !(k in next)) s.setProperty(cssName(k), "");
  if (next) for (const k in next) if (!prev || prev[k] !== next[k]) s.setProperty(cssName(k), styleValue(k, next[k]));
}

/** The DOM event a React event prop listens to, and whether in the capture phase. */
export function eventOf(el: Element, prop: string): [string, boolean] {
  let name = prop.slice(2);
  const capture = name.endsWith("Capture") && name !== "GotPointerCapture" && name !== "LostPointerCapture";
  if (capture) name = name.slice(0, -7);
  if (name === "DoubleClick") return ["dblclick", capture];
  if (name === "Focus") return ["focusin", capture];
  if (name === "Blur") return ["focusout", capture];
  if (name === "Change") {
    const tag = el.nodeName;
    const type = (el as HTMLInputElement).type;
    const input = tag === "TEXTAREA" || (tag === "INPUT" && type !== "checkbox" && type !== "radio" && type !== "file");
    return [input ? "input" : "change", capture];
  }
  if (name === "BeforeInput") return ["beforeinput", capture];
  return [name.toLowerCase(), capture];
}

type Listeners = Record<string, { handler: any; proxy: (e: Event) => void }>;

/** What runs after a handler: the updates it caused drawn at once, controlled fields put back. */
let afterEvent: (el: Element, e: Event) => void = () => {};
export function onAfterEvent(fn: typeof afterEvent) {
  afterEvent = fn;
}

/** The props of `el` that a native `type` event, in this phase, runs. */
function propsFor(el: Element, type: string, capture: boolean, props: any, native: Event): string[] {
  const out: string[] = [];
  for (const k in props) {
    if (k[0] !== "o" || k[1] !== "n" || k.length < 3 || k[2] !== k[2]!.toUpperCase() || typeof props[k] !== "function") continue;
    const [t, c] = eventOf(el, k);
    if (t !== type || c !== capture) continue;
    // A field's onChange only when its value really changed (React's value tracking): an event dispatched again
    // from inside its own handler does not call it again.
    if ((k === "onChange" || k === "onChangeCapture") && FIELDS.has(el.localName) && !changedOnce(el, native)) continue;
    out.push(k);
  }
  return out;
}

const FIELDS = new Set(["input", "textarea", "select"]);
/** Whether this event changed the field: asked once per event (both phases get the same answer). */
const answered = new WeakMap<Event, Map<Element, boolean>>();
function changedOnce(el: Element, native: Event) {
  let m = answered.get(native);
  if (!m) answered.set(native, (m = new Map()));
  if (!m.has(el)) m.set(el, valueChanged(el));
  return m.get(el)!;
}
configure(propsFor, (el, e) => afterEvent(el, e));

function asReactEvent(e: any, el: Element) {
  if (!("nativeEvent" in e)) {
    Object.defineProperties(e, {
      nativeEvent: { value: e, configurable: true },
      persist: { value: () => {}, configurable: true },
      isDefaultPrevented: { value: () => e.defaultPrevented, configurable: true },
      isPropagationStopped: { value: () => e.cancelBubble, configurable: true },
    });
  }
  return e;
}

function listen(el: Element, prop: string, handler: any) {
  const [type, capture] = eventOf(el, prop);
  // Most events: found at the root's listener from the element's props (React's delegation).
  if (delegated(type)) {
    if (handler != null && handler !== false) want(type);
    return;
  }
  const key = type + (capture ? "!" : "");
  const all: Listeners = ((el as any).__l ??= {});
  const had = all[key];
  if (handler == null || handler === false) {
    if (had) {
      el.removeEventListener(type, had.proxy, capture);
      delete all[key];
    }
    return;
  }
  if (had) {
    had.handler = handler;
    return;
  }
  const entry = {
    handler,
    proxy: (e: Event) => {
      // mouseenter/mouseleave fire on the element alone; React's onMouseEnter fires on each it enters, the same.
      entry.handler.call(el, asReactEvent(e, el));
      afterEvent(el, e);
    },
  };
  all[key] = entry;
  el.addEventListener(type, entry.proxy, capture);
}

/** A form's or button's action as a function: React 19 calls it with the form's data. */
function setAction(el: Element, name: string, fn: any) {
  const form = name === "action" ? el : (el as any).form;
  (el as any)[name === "action" ? "__action" : "__formAction"] = fn;
  if (!form || (form as any).__submits) return;
  (form as any).__submits = true;
  form.addEventListener("submit", (e: any) => {
    const by = e.submitter;
    const act = by?.__formAction ?? (form as any).__action;
    if (typeof act !== "function") return;
    e.preventDefault();
    const data = new FormData(form, by ?? undefined);
    Promise.resolve(act(data)).then(() => (form as HTMLFormElement).reset());
  });
}

/** One prop set on `el`, from `prev` to `next`. */
export function setProp(el: Element, name: string, next: any, prev: any, svg: boolean) {
  if (SKIP.has(name)) return;
  if (name === "style") return setStyle(el as HTMLElement, next, prev);
  if (name[0] === "o" && name[1] === "n" && name.length > 2 && name[2] === name[2]!.toUpperCase()) return listen(el, name, next);
  if ((name === "action" || name === "formAction") && typeof next === "function") return setAction(el, name, next);
  if (name === "value" || name === "checked" || name === "selected") {
    // Properties, compared with what is on the element (a person may have changed it since).
    const now = (el as any)[name];
    const want = name === "value" ? (next == null ? "" : String(next)) : !!next;
    if (now !== want) (el as any)[name] = want;
    if (name === "value" && el.nodeName === "SELECT") queueMicrotask(() => ((el as any).value !== want && ((el as any).value = want)));
    return;
  }
  if (name === "muted") return void ((el as any).muted = !!next);
  // React focuses it when it is made; there is no attribute.
  if (name === "autoFocus") return;
  const tag = el.localName;
  // A custom element takes what it has as a property (React 19).
  if (tag.includes("-") && name in el && typeof next !== "string") return void ((el as any)[name] = next);
  const out = attribute(tag, name, next, svg);
  if (!out) return;
  const [attr, value] = out;
  const ns = attr.startsWith("xlink:") ? XLINK_NS : attr.startsWith("xml:") ? XML_NS : null;
  if (value == null) ns ? el.removeAttributeNS(ns, attr.slice(attr.indexOf(":") + 1)) : el.removeAttribute(attr);
  else ns ? el.setAttributeNS(ns, attr, value) : el.setAttribute(attr, value);
}

/** Every prop of a new element, or the ones that changed on an update. */
export function setProps(el: Element, next: any, prev: any, svg: boolean) {
  if (!prev) for (const k in next) checkPropName(el.localName, k, next[k]);
  if (prev) for (const k in prev) if (!(k in next)) setProp(el, k, undefined, prev[k], svg);
  // An input's type first: setting it afterwards resets what `checked` and `value` set.
  if (next.type !== undefined && (!prev || prev.type !== next.type)) setProp(el, "type", next.type, prev?.type, svg);
  for (const k in next) {
    if (k === "type") continue;
    const v = next[k];
    if (!prev || prev[k] !== v || k === "value" || k === "checked") setProp(el, k, v, prev ? prev[k] : undefined, svg);
  }
  const html = next.dangerouslySetInnerHTML?.__html;
  if (html !== (prev?.dangerouslySetInnerHTML?.__html)) (el as HTMLElement).innerHTML = html ?? "";
}

/** `defaultValue` and `defaultChecked`, set once when the element is made. */
export function setDefaults(el: Element, props: any) {
  if (props.defaultValue !== undefined && props.value === undefined) {
    if (el.nodeName === "SELECT") queueMicrotask(() => ((el as any).value = String(props.defaultValue)));
    else (el as any).value = String(props.defaultValue);
    if (el.nodeName === "TEXTAREA") (el as HTMLTextAreaElement).defaultValue = String(props.defaultValue);
    else el.setAttribute("value", String(props.defaultValue));
  }
  if (props.defaultChecked !== undefined && props.checked === undefined) (el as any).checked = (el as any).defaultChecked = !!props.defaultChecked;
}
