// Props on DOM elements, as React sets them: attributes or properties, styles, and events listened to on the
// element itself (no delegation), each event given what React's handlers expect of it.

export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATH_NS = "http://www.w3.org/1998/Math/MathML";

const SKIP = new Set(["children", "key", "ref", "dangerouslySetInnerHTML", "suppressHydrationWarning", "suppressContentEditableWarning", "defaultValue", "defaultChecked", "innerHTML"]);

// Numbers that stay numbers in a style (everything else gets px).
const UNITLESS = new Set(
  "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth".split(" "),
);

// React's names for attributes that are written otherwise.
const ALIASES: Record<string, string> = { className: "class", htmlFor: "for", acceptCharset: "accept-charset", httpEquiv: "http-equiv", tabIndex: "tabindex" };

// SVG attributes React writes in camelCase but the DOM wants hyphenated (strokeWidth → stroke-width); the
// camelCase SVG attributes (viewBox, preserveAspectRatio…) are left as they are.
const SVG_HYPHEN = /^(accent|alignment|arabic|baseline|cap|clip|color|dominant|enable|fill|flood|font|glyph|horiz|image|letter|lighting|marker|overline|paint|panose|pointer|rendering|shape|stop|strikethrough|stroke|text|underline|unicode|units|v|vector|vert|word|writing|x)[A-Z]/;
const XLINK = "http://www.w3.org/1999/xlink";

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
  let attr = ALIASES[name] ?? name;
  if (svg) {
    if (name === "xlinkHref") return next == null ? el.removeAttributeNS(XLINK, "href") : el.setAttributeNS(XLINK, "xlink:href", next);
    if (SVG_HYPHEN.test(name)) attr = name.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  } else if (
    attr !== "class" && attr !== "for" && attr !== "width" && attr !== "height" && attr !== "href" && attr !== "list" && attr !== "form" &&
    attr !== "tabIndex" && attr !== "download" && attr !== "rowSpan" && attr !== "colSpan" && attr !== "role" && attr !== "popover" &&
    attr !== "src" && attr !== "type" && !attr.includes("-") && attr in el && typeof next !== "function"
  ) {
    try {
      (el as any)[attr] = next == null ? "" : next;
      if (next == null || next === false) el.removeAttribute(attr);
      return;
    } catch {}
  }
  if (typeof next === "function" || typeof next === "symbol") return;
  if (next == null || (next === false && !/^(aria|data)-/.test(attr))) el.removeAttribute(attr);
  else el.setAttribute(attr, next === true && !/^(aria|data)-/.test(attr) ? "" : String(next));
}

/** Every prop of a new element, or the ones that changed on an update. */
export function setProps(el: Element, next: any, prev: any, svg: boolean) {
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
