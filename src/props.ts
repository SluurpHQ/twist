// Props on DOM elements, as React sets them: attributes or properties, styles, and events listened to on the
// element itself (no delegation), each event given what React's handlers expect of it.
declare const process: { env: Record<string, string | undefined> };

import { effect, runWithOwner, untrack } from "../../signals/index.js";
import { XLINK_NS, XML_NS, attribute, attributeNameSafe, customAttribute, customTag, isCustomElement } from "./attributes.ts";
import { BEFORE_INPUT_SOURCES, SELECT_SOURCES, configure, delegated, enterLeaveSources, listenAt, want } from "./events.ts";
import { validateProps, validateStyle } from "./validate-props.ts";
import { cssString } from "./coercion.ts";
import { shorthandToLonghand } from "./css-shorthand.ts";
import { valueChanged } from "./forms.ts";
import { dev, shown, warn, PROPS } from "./warnings.ts";

export const SVG_NS = "http://www.w3.org/2000/svg";
export const noop = () => {};
export const MATH_NS = "http://www.w3.org/1998/Math/MathML";

const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "defaultValue", "defaultChecked", "innerHTML"]);

// Numbers that stay numbers in a style (everything else gets px).
const UNITLESS = new Set(
  "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth".split(" "),
);



/** A style object as React writes it in markup (name:value;…): what the server sends, and what hydration expects. */
export function styleText(s: any): string {
  if (typeof s === "string") return s;
  let out = "";
  for (const k in s) {
    const v = s[k];
    if (v == null || typeof v === "boolean" || v === "") continue;
    out += `${out ? ";" : ""}${cssName(k)}:${styleValue(k, v)}`;
  }
  return out;
}

function styleValue(name: string, value: any) {
  if (value == null || typeof value === "boolean" || value === "") return "";
  if (typeof value === "number" && value !== 0 && !UNITLESS.has(name) && !name.startsWith("--")) return value + "px";
  return cssString(value, name).trim();
}
const cssName = (n: string) => (n.startsWith("--") ? n : n.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).replace(/^ms-/, "-ms-"));

/** React's warning for a shorthand and its longhand mixed in an update (one wipes the other). */
function shorthandCollisions(prev: any, next: any) {
  const longhands = (k: string) => shorthandToLonghand[k] ?? [k];
  const updates: Record<string, string> = {};
  for (const k in prev) if (Object.hasOwn(prev, k) && !Object.hasOwn(next, k)) for (const l of longhands(k)) updates[l] = k;
  for (const k in next) if (Object.hasOwn(next, k) && prev[k] !== next[k]) for (const l of longhands(k)) updates[l] = k;
  const expanded: Record<string, string> = {};
  for (const k in next) for (const l of longhands(k)) expanded[l] = k;
  const told = new Set<string>();
  for (const l in updates) {
    const was = updates[l]!, is = expanded[l];
    if (!is || was === is || told.has(was + "," + is)) continue;
    told.add(was + "," + is);
    const v = next[was];
    warn(
      `${v == null || typeof v === "boolean" || v === "" ? "Removing" : "Updating"} a style property during rerender (${was}) when a conflicting property is set (${is}) can lead to styling bugs. To avoid this, don't mix shorthand and non-shorthand properties for the same value; instead, replace the shorthand with separate values.`,
    );
  }
}

function setStyle(el: HTMLElement, next: any, prev: any) {
  // Read-only in development, as React makes it: a style object changed after render is a bug.
  if ((process.env.NODE_ENV !== "production" && dev()) && next && typeof next === "object" && !Object.isFrozen(next)) Object.freeze(next);
  const s = el.style;
  if (typeof next === "string") {
    s.cssText = next;
    return;
  }
  if (typeof prev === "string") s.cssText = "";
  if ((process.env.NODE_ENV !== "production" && dev()) && prev && typeof prev === "object" && next) shorthandCollisions(prev, next);
  if (prev && typeof prev === "object") for (const k in prev) if (!next || !(k in next)) s.setProperty(cssName(k), "");
  if (next) for (const k in next) if (!prev || prev[k] !== next[k]) process.env.NODE_ENV !== "production" && validateStyle(k, next[k]), s.setProperty(cssName(k), styleValue(k, next[k]));
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
    // A checkbox or radio changes by its click (React's ChangeEventPlugin), its value tracked.
    const clicked = tag === "INPUT" && (type === "checkbox" || type === "radio");
    return [input ? "input" : clicked ? "click" : "change", capture];
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
    // (Any value set, as React reads it: one that is not a function is thrown about at dispatch.)
    if (k[0] !== "o" || k[1] !== "n" || k.length < 3 || k[2] !== k[2]!.toUpperCase() || !props[k]) continue;
    const change = k === "onChange" || k === "onChangeCapture";
    // onChange is the target's change, whoever listens: a text field's input event is every ancestor's onChange.
    const target = change && native.target instanceof Element ? native.target : el;
    // Only a field or a custom element changes (React's ChangeEventPlugin): a div's change event reaches no onChange.
    if (change && !FIELDS.has(target.localName) && !customTag(target.localName)) continue;
    const [t, c] = eventOf(target, k);
    if (t !== type || c !== capture) continue;
    // A field's onChange only when its value really changed (React's value tracking): an event dispatched again
    // from inside its own handler does not call it again.
    if (change && FIELDS.has(target.localName) && !changedOnce(target, native)) continue;
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
configure(propsFor, (el, e) => afterEvent(el, e), submitted);

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
  // A listener that is no function: React's warning (and nothing listens).
  if ((process.env.NODE_ENV !== "production" && dev()) && handler != null && typeof handler !== "function" && REACT_EVENTS.has(prop.endsWith("Capture") ? prop.slice(0, -7) : prop))
    warn(
      handler === false
        ? `Expected \`${prop}\` listener to be a function, instead got \`false\`.\n\nIf you used to conditionally omit it with ${prop}={condition && value}, pass ${prop}={condition ? value : undefined} instead.`
        : `Expected \`${prop}\` listener to be a function, instead got a value of \`${typeof handler}\` type.`,
    );
  const [type, capture] = eventOf(el, prop);
  // Most events: found at the root's listener from the element's props (React's delegation).
  if (delegated(type)) {
    if (handler != null && handler !== false) {
      // onBeforeInput is made from textInput, or keypress (React's plugin), not the native beforeinput.
      if (type === "beforeinput") for (const t of BEFORE_INPUT_SOURCES) want(t);
      else want(type);
      // onChange on an element that is not a field hears its fields' changes, typed or picked.
      if (type === "change") want("input");
      // Entering and leaving are made from over and out events.
      for (const t of enterLeaveSources(type) ?? []) want(t);
      // A selection's change is found after keys, mouse releases and drags, on the focused field.
      if (type === "select") for (const t of SELECT_SOURCES) want(t);
      // Scrolling and a popover's toggle are heard on the element itself, as React listens for them there.
      if (type === "scroll" || type === "scrollend" || type === "toggle" || type === "beforetoggle") listenAt(el, type);
    }
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
      entry.handler.call(undefined, asReactEvent(e, el));
      afterEvent(el, e);
    },
  };
  all[key] = entry;
  el.addEventListener(type, entry.proxy, capture);
}

/** A function given as action or formAction: run by React's submit dispatch (submitted, below). Written as React
 * writes it: a URL that throws, should the form be submitted some other way (form.submit()). */
const ACTION_URL = "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')";
function setAction(el: Element, name: string, _fn: any) {
  want("submit");
  el.setAttribute(name, ACTION_URL);
}

/** React's warnings for an action or formAction where it does not belong, or with props it overrides. */
function checkFormAction(tag: string, name: string, value: any, props: any) {
  if (tag === "form") {
    if (name === "formAction") return warn("You can only pass the formAction prop to <input> or <button>. Use the action prop on <form>.");
    if (typeof value !== "function") return;
    if (props.encType != null || props.method != null)
      warn("Cannot specify a encType or method for a form that specifies a function as the action. React provides those automatically. They will get overridden.", "form-action-method");
    if (props.target != null) warn("Cannot specify a target for a form that specifies a function as the action. The function will always be executed in the same window.", "form-action-target");
    return;
  }
  if (tag !== "input" && tag !== "button") return warn(name === "action" ? "You can only pass the action prop to <form>." : "You can only pass the formAction prop to <input> or <button>.");
  if (name === "action") return warn("You can only pass the action prop to <form>. Use the formAction prop on <input> or <button>.");
  if (tag === "input" && props.type !== "submit" && props.type !== "image") return warn('An input can only specify a formAction along with type="submit" or type="image".', "form-action-type");
  if (tag === "button" && props.type != null && props.type !== "submit") return warn('A button can only specify a formAction along with type="submit" or no type.', "form-action-type");
  if (typeof value !== "function") return;
  if (props.name != null)
    warn('Cannot specify a "name" prop for a button that specifies a function as a formAction. React needs it to encode which action should be invoked. It will get overridden.', "form-action-name");
  if (props.formEncType != null || props.formMethod != null)
    warn("Cannot specify a formEncType or formMethod for a button that specifies a function as a formAction. React provides those automatically. They will get overridden.", "form-action-method");
  if (props.formTarget != null) warn("Cannot specify a formTarget for a button that specifies a function as a formAction. The function will always be executed in the same window.", "form-action-target");
}

/** The action useFormStatus shows: nothing for what is no action, else as given (an object too, as a URL-like). */
const statusAction = (v: any) => (v == null || typeof v === "symbol" || typeof v === "boolean" ? null : v);

/** React's coerceFormActionProp: a function as it is, nothing for what is no URL, else the text. */
function formActionOf(v: any): any {
  if (v == null || typeof v === "symbol" || typeof v === "boolean") return null;
  return typeof v === "function" ? v : "" + v;
}

/** A form submitted (after its onSubmit handlers): its action run, as React's form action plugin does. */
function submitted(e: SubmitEvent, startedTransition: boolean) {
  const form = e.target as HTMLFormElement;
  const props = (form as any)[PROPS];
  if (!props || form.localName !== "form") return;
  // The button that submitted it (some DOMs give the form itself when requestSubmit() had none).
  const submitter = e.submitter && e.submitter !== (form as any) ? e.submitter : null;
  // Prevented, but its handlers started a transition: the form is pending while it runs (React's host transition).
  if (e.defaultPrevented && startedTransition) return pendingWhile(form, statusAction(props.action), formDataWith(form, submitter), submitter);
  let act = props.action;
  let by: HTMLElement | null = submitter;
  if (by) {
    const own = (by as any)[PROPS];
    const theirs = own ? formActionOf(own.formAction) : by.getAttribute("formAction");
    if (theirs !== null) (act = theirs), (by = null);
  }
  if (e.defaultPrevented || typeof act !== "function") return;
  e.preventDefault();
  submit(form, act, formDataWith(form, by), submitter);
}

/**
 * A form's data with the button that submitted it, as React builds it (createFormDataWithSubmitter): its name and
 * value put in by a hidden input beside it for the moment (not every DOM takes the submitter argument), so the
 * formdata event sees it too.
 */
function formDataWith(form: HTMLFormElement, submitter: HTMLElement | null): FormData {
  const name = submitter && (submitter as any).name;
  if (!submitter || !name || !submitter.parentNode) return new FormData(form);
  // (An image button gives its click's coordinates, not its name: the DOM's own submitter handling.)
  if ((submitter as any).type === "image") return new FormData(form, submitter as any);
  const temp = submitter.ownerDocument.createElement("input");
  temp.name = name;
  temp.value = (submitter as any).value;
  if (form.id) temp.setAttribute("form", form.id);
  submitter.parentNode.insertBefore(temp, submitter);
  try {
    return new FormData(form);
  } finally {
    temp.remove();
  }
}

/** How a form's action runs: given by core (it knows the form's fiber, its status and its boundary). */
let submit: (form: HTMLFormElement, act: any, data: FormData, by?: HTMLElement | null) => void = (_f, act, data) => act(data);
let pendingWhile: (form: HTMLFormElement, action: any, data: FormData, by?: HTMLElement | null) => void = () => {};
export function onSubmitAction(fn: typeof submit, pending: typeof pendingWhile) {
  submit = fn;
  pendingWhile = pending;
}

/** The event props React knows (its plugins' events): any other on* on a custom element is the element's own. */
const REACT_EVENTS = new Set(
  ("abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll scrollEnd toggle touchMove waiting wheel " +
    "change select beforeInput compositionEnd compositionStart compositionUpdate mouseEnter mouseLeave pointerEnter pointerLeave focus blur doubleClick animationEnd animationIteration animationStart transitionEnd transitionRun transitionStart transitionCancel focusIn focusOut")
    .split(" ")
    .map((e) => "on" + e[0]!.toUpperCase() + e.slice(1)),
);

let toldPopoverTarget = false;

/** One prop set on `el`, from `prev` to `next`. */
export function setProp(el: Element, name: string, next: any, prev: any, svg: boolean) {
  // The commonest prop, straight on (SVG's className is not a string).
  if (name === "className" && typeof next === "string" && !svg) return void (el.className = next);
  if (SKIP.has(name)) return;
  if (name === "style") return setStyle(el as HTMLElement, next, prev);
  // A custom element's own events (any on* React does not know): listened to on it, the name as written.
  if (name[0] === "o" && name[1] === "n" && name.length > 2 && customTag(el.localName) && !REACT_EVENTS.has(name.endsWith("Capture") ? name.slice(0, -7) : name)) {
    const capture = name.endsWith("Capture");
    const type = name.slice(2, capture ? name.length - 7 : undefined);
    if (typeof prev === "function") el.removeEventListener(type, prev, capture);
    if (typeof next === "function") {
      if (typeof prev !== "function" && prev !== null) name in el ? ((el as any)[name] = null) : el.removeAttribute(name);
      return el.addEventListener(type, next, capture);
    }
  }
  if (name[0] === "o" && name[1] === "n" && name.length > 2 && name[2] === name[2]!.toUpperCase()) {
    // iOS Safari only sends clicks to elements it thinks are clickable: React gives them an onclick that does nothing.
    if (name === "onClick" && next != null) (el as HTMLElement).onclick ??= noop;
    return listen(el, name, next);
  }
  if ((name === "action" || name === "formAction") && next != null && (process.env.NODE_ENV !== "production" && dev())) checkFormAction(el.localName, name, next, (el as any)[PROPS] ?? {});
  if ((name === "action" || name === "formAction") && typeof next === "function") return setAction(el, name, next);
  // A form field's value is its property; on any other element (progress, li, data…) it is an attribute.
  if ((name === "value" && /^(INPUT|TEXTAREA|SELECT)$/.test(el.nodeName)) || name === "checked" || name === "selected") {
    // Properties, compared with what is on the element (a person may have changed it since).
    const now = (el as any)[name];
    const want = name === "value" ? (next == null ? "" : String(next)) : !!next;
    if (now !== want) (el as any)[name] = want;
    if (name === "value" && el.nodeName === "SELECT") queueMicrotask(() => ((el as any).value !== want && ((el as any).value = want)));
    return;
  }
  // A popover fires toggle events React bubbles: listened to on it, as React does.
  if (name === "popover" && next != null) listenAt(el, "toggle"), listenAt(el, "beforetoggle");
  if (name === "popoverTarget" && (process.env.NODE_ENV !== "production" && dev()) && typeof next === "object" && next !== null && !toldPopoverTarget) {
    toldPopoverTarget = true;
    warn(`The \`popoverTarget\` prop expects the ID of an Element as a string. Received ${shown(next)} instead.`);
  }
  if (name === "muted") return void ((el as any).muted = !!next);
  // React focuses it when it is made; there is no attribute.
  if (name === "autoFocus") return;
  const tag = el.localName;
  // A custom element (React 19's setPropOnCustomElement): what it has as a property is set as one, whatever its
  // type; anything else an attribute; innerText and textContent are not props.
  if (customTag(tag)) {
    if (name === "innerText" || name === "textContent" || name === "innerHTML") return;
    if (name in el) return void ((el as any)[name] = next);
    if (!attributeNameSafe(name)) return;
    if (next === true) return el.setAttribute(name, "");
    if (next == null || next === false || typeof next === "function" || typeof next === "symbol") return el.removeAttribute(name);
    return el.setAttribute(name === "className" ? "class" : name, String(next));
  }
  const out = isCustomElement(tag, (el as any)[PROPS]) ? customAttribute(tag, name, next) : attribute(tag, name, next, svg);
  if (!out) return;
  const [attr, value] = out;
  const ns = attr.startsWith("xlink:") ? XLINK_NS : attr.startsWith("xml:") ? XML_NS : null;
  if (value == null) ns ? el.removeAttributeNS(ns, attr.slice(attr.indexOf(":") + 1)) : el.removeAttribute(attr);
  else ns ? el.setAttributeNS(ns, attr, value) : el.setAttribute(attr, value);
}

/** A prop given a signal (not a handler or a ref): bound to the element, set again whenever the signal changes. */
const isBound = (k: string, v: any) => typeof v === "function" && v.isSignal === true && k !== "ref" && k !== "children" && !isEventProp(k);
type Binding = { src: any; stop: () => void };
const BINDINGS = Symbol("bindings");

/** Its bound props made to match `next`: those gone or given another signal let go, new ones bound. */
function bindProps(el: Element, next: any, svg: boolean) {
  let binds: Map<string, Binding> | undefined = (el as any)[BINDINGS];
  if (binds) for (const [k, b] of binds) if (next[k] !== b.src) b.stop(), binds.delete(k);
  for (const k in next) {
    const v = next[k];
    if (!isBound(k, v) || binds?.get(k)?.src === v) continue;
    if (!binds) (el as any)[BINDINGS] = binds = new Map();
    let last: any;
    // Its own effect, owned by no render: let go when the prop is, or the element goes.
    const stop = runWithOwner(null, () =>
      effect(() => {
        const value = v();
        untrack(() => setProp(el, k, value, last, svg));
        last = value;
      }),
    );
    binds.set(k, { src: v, stop });
  }
}

/** Its bindings let go (it is gone). */
export function unbindProps(el: Element) {
  const binds: Map<string, Binding> | undefined = (el as any)[BINDINGS];
  if (!binds) return;
  for (const b of binds.values()) b.stop();
  binds.clear();
}

/** Every prop of a new element, or the ones that changed on an update. */
export function setProps(el: Element, next: any, prev: any, svg: boolean) {
  let bound = false;
  for (const k in next)
    if (isBound(k, next[k])) {
      bound = true;
      break;
    }
  // Checked as the values the signals hold now.
  let shown = next;
  if (bound) {
    shown = { ...next };
    for (const k in shown) if (isBound(k, shown[k])) shown[k] = untrack(shown[k]);
  }
  if (process.env.NODE_ENV !== "production") validateProps(el.localName, shown, true);
  if (bound || (el as any)[BINDINGS]) bindProps(el, next, svg);
  if (prev) for (const k in prev) if (!(k in next) && !isBound(k, prev[k])) setProp(el, k, undefined, prev[k], svg);
  // (A signal no longer given: what it had set taken off.)
  if (prev) for (const k in prev) if (!(k in next) && isBound(k, prev[k])) setProp(el, k, undefined, untrack(prev[k]), svg);
  // An input's type first: setting it afterwards resets what `checked` and `value` set.
  if (next.type !== undefined && (!prev || prev.type !== next.type)) setProp(el, "type", next.type, prev?.type, svg);
  for (const k in next) {
    if (k === "type") continue;
    const v = next[k];
    if (bound && isBound(k, v)) continue;
    // A field's value and checked are set again even when unchanged (a person may have changed them); else only what changed.
    if (!prev || prev[k] !== v || ((k === "value" || k === "checked") && /^(INPUT|TEXTAREA|SELECT)$/.test(el.nodeName))) setProp(el, k, v, prev ? prev[k] : undefined, svg);
  }
  const html = next.dangerouslySetInnerHTML?.__html;
  if (html !== (prev?.dangerouslySetInnerHTML?.__html)) (el as HTMLElement).innerHTML = html ?? "";
  if (prev) afterFunctionAction(el, next, prev, svg);
}

/**
 * An action that was a function and is not any more: what the server wrote in its place for the form (encType,
 * method, target, or a button's name and form* fields) is out of date, so set again from the props now, whatever
 * they were before (React's switch off a hydrated Server Action).
 */
export function afterFunctionAction(el: Element, next: any, prev: any, svg: boolean) {
  const tag = el.localName;
  if (typeof prev.action === "function" && typeof next.action !== "function")
    for (const k of ["encType", "method", "target"]) setProp(el, k, next[k], FORCE, svg);
  if (typeof prev.formAction === "function" && typeof next.formAction !== "function")
    for (const k of tag === "input" ? ["formEncType", "formMethod", "formTarget"] : ["name", "formEncType", "formMethod", "formTarget"]) setProp(el, k, next[k], FORCE, svg);
}
/** A previous value no prop can have: the property set whatever it is. */
const FORCE = Symbol("force");

/** An event prop React listens for (onClick, onClickCapture…), as opposed to an attribute. */
export const isEventProp = (k: string) => k.length > 2 && k[0] === "o" && k[1] === "n" && k[2] === k[2]!.toUpperCase() && k[2] !== k[2]!.toLowerCase();

/**
 * A server element taken over: its listeners added, its attributes left as the server wrote them (React does not
 * patch them while hydrating; a difference is told, not fixed).
 */
export function hydrateProps(el: Element, props: any, svg: boolean) {
  if (process.env.NODE_ENV !== "production") validateProps(el.localName, props, true);
  for (const k in props) if (isEventProp(k)) setProp(el, k, props[k], undefined, svg);
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
