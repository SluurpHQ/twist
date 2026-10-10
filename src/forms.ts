// Form fields as React DOM handles them (ported from its ReactDOMInput, ReactDOMTextarea and ReactDOMSelect): the
// value and checked properties, the value attribute kept in step with a controlled value, defaults, radio groups put
// back by name after a change, select options chosen from value.
import { isEventProp, setProp } from "./props.ts";
import { checkControlled, checkControlledSwitch, dev, ownerName, warn, PROPS } from "./warnings.ts";
import { validateProps } from "./validate-props.ts";
import { fieldString } from "./coercion.ts";

export const FORM_TAGS = new Set(["input", "textarea", "select", "option"]);

/** React's ToStringValue: what a value prop shows as text (functions and symbols as nothing). */
function toStringValue(v: any): any {
  switch (typeof v) {
    case "bigint":
    case "boolean":
    case "number":
    case "string":
    case "undefined":
      return v;
    case "object":
      // Coerced as React does: warned about, then thrown, when it cannot be.
      if (v !== null) fieldString(v);
      return v;
    default:
      return "";
  }
}
const str = (v: any) => "" + toStringValue(v);
const usable = (v: any) => v != null && typeof v !== "function" && typeof v !== "symbol" && typeof v !== "boolean";

/** The props React reads itself for each field: everything else is an ordinary attribute. */
const OWN: Record<string, Set<string>> = {
  input: new Set(["name", "type", "checked", "defaultChecked", "value", "defaultValue", "children", "dangerouslySetInnerHTML"]),
  select: new Set(["value", "defaultValue"]),
  textarea: new Set(["value", "defaultValue", "children", "dangerouslySetInnerHTML"]),
  option: new Set(["selected"]),
};

function setDefaultValue(node: HTMLInputElement, value: any) {
  if (node.defaultValue !== str(value)) node.defaultValue = str(value);
}

// ---------------------------------------------------------------- input

function initInput(node: HTMLInputElement, p: any, hydrating: boolean) {
  const { value, defaultValue, checked, defaultChecked, type, name } = p;
  if (dev()) {
    // Controlled or uncontrolled, not both (React's validateInputProps).
    const who = ownerName() || "A component";
    if (checked !== undefined && defaultChecked !== undefined)
      warn(`${who} contains an input of type ${type} with both checked and defaultChecked props. Input elements must be either controlled or uncontrolled (specify either the checked prop, or the defaultChecked prop, but not both). Decide between using a controlled or uncontrolled input element and remove one of these props. More info: https://react.dev/link/controlled-components`, "input-checked-default");
    if (value !== undefined && defaultValue !== undefined)
      warn(`${who} contains an input of type ${type} with both value and defaultValue props. Input elements must be either controlled or uncontrolled (specify either the value prop, or the defaultValue prop, but not both). Decide between using a controlled or uncontrolled input element and remove one of these props. More info: https://react.dev/link/controlled-components`, "input-value-default");
  }
  if (usable(type)) node.type = type;
  if (value != null || defaultValue != null) {
    const isButton = type === "submit" || type === "reset";
    if (isButton && value == null) return;
    const defaultStr = defaultValue != null ? str(defaultValue) : "";
    const initial = value != null ? str(value) : defaultStr;
    // Taken over from the server: what the field holds now (a person may have typed already) is kept.
    if (!hydrating && initial !== node.value) node.value = initial;
    node.defaultValue = initial;
  }
  const checkedOrDefault = checked != null ? checked : defaultChecked;
  const initialChecked = typeof checkedOrDefault !== "function" && typeof checkedOrDefault !== "symbol" && !!checkedOrDefault;
  node.checked = hydrating ? node.checked : initialChecked;
  node.defaultChecked = initialChecked;
  if (usable(name)) node.name = name;
}

function updateInput(node: HTMLInputElement, p: any, lastDefaultValue: any) {
  const { value, defaultValue, checked, defaultChecked, type, name } = p;
  // Cleared first: a radio's checked would otherwise uncheck one of the same name in the old group.
  node.name = "";
  if (usable(type)) node.type = type;
  else node.removeAttribute("type");
  if (value != null) {
    if (type === "number") {
      if ((value === 0 && node.value === "") || node.value != value) node.value = str(value);
    } else if (node.value !== str(value)) node.value = str(value);
  } else if (type === "submit" || type === "reset") node.removeAttribute("value");
  if (value != null) {
    if (type === "number" && node.value == value) setDefaultValue(node, node.value);
    else setDefaultValue(node, value);
  } else if (defaultValue != null) setDefaultValue(node, defaultValue);
  else if (lastDefaultValue != null) node.removeAttribute("value");
  if (checked == null && defaultChecked != null) node.defaultChecked = !!defaultChecked;
  if (checked != null) node.checked = checked && typeof checked !== "function" && typeof checked !== "symbol";
  if (usable(name)) node.name = str(name);
  else node.removeAttribute("name");
}

// ---------------------------------------------------------------- textarea

function initTextarea(node: HTMLTextAreaElement, p: any) {
  let { value, defaultValue, children } = p;
  if (dev()) {
    // React's validateTextareaProps.
    if (value !== undefined && defaultValue !== undefined)
      warn(`${ownerName() || "A component"} contains a textarea with both value and defaultValue props. Textarea elements must be either controlled or uncontrolled (specify either the value prop, or the defaultValue prop, but not both). Decide between using a controlled or uncontrolled textarea and remove one of these props. More info: https://react.dev/link/controlled-components`, "textarea-value-default");
  }
  let initial = value;
  if (initial == null) {
    if (children != null) {
      if (defaultValue != null) throw new Error("If you supply `defaultValue` on a <textarea>, do not pass children.");
      if (Array.isArray(children)) {
        if (children.length > 1) throw new Error("<textarea> can only have at most one child.");
        children = children[0];
      }
      defaultValue = children;
    }
    if (defaultValue == null) defaultValue = "";
    initial = defaultValue;
  }
  const s = toStringValue(initial);
  node.defaultValue = s;
  const text = node.textContent;
  if (text === s && text !== "" && text !== null) node.value = text;
}

function updateTextarea(node: HTMLTextAreaElement, p: any) {
  const { value, defaultValue } = p;
  if (value != null) {
    const next = str(value);
    if (next !== node.value) node.value = next;
    if (defaultValue == null) {
      if (node.defaultValue !== next) node.defaultValue = next;
      return;
    }
  }
  node.defaultValue = defaultValue != null ? str(defaultValue) : "";
}

// ---------------------------------------------------------------- select

function updateOptions(node: HTMLSelectElement, multiple: boolean, value: any, setDefault: boolean) {
  const options = node.options;
  if (multiple) {
    const chosen = new Set((value as any[]).map((v) => "$" + v));
    for (let i = 0; i < options.length; i++) {
      const selected = chosen.has("$" + options[i]!.value);
      if (options[i]!.selected !== selected) options[i]!.selected = selected;
      if (selected && setDefault) options[i]!.defaultSelected = true;
    }
    return;
  }
  const want = str(value);
  let fallback: HTMLOptionElement | null = null;
  for (let i = 0; i < options.length; i++) {
    const o = options[i]!;
    if (o.value === want) {
      o.selected = true;
      if (setDefault) o.defaultSelected = true;
      return;
    }
    if (fallback === null && !o.disabled) fallback = o;
  }
  if (fallback !== null) fallback.selected = true;
}

function initSelect(node: HTMLSelectElement, p: any) {
  if (dev()) {
    for (const name of ["value", "defaultValue"]) {
      if (p[name] == null) continue;
      if (p.multiple && !Array.isArray(p[name])) warn(`The \`${name}\` prop supplied to <select> must be an array if \`multiple\` is true.`);
      else if (!p.multiple && Array.isArray(p[name])) warn(`The \`${name}\` prop supplied to <select> must be a scalar value if \`multiple\` is false.`);
    }
    if (p.value !== undefined && p.defaultValue !== undefined) {
      warn("Select elements must be either controlled or uncontrolled (specify either the value prop, or the defaultValue prop, but not both). Decide between using a controlled or uncontrolled select element and remove one of these props. More info: https://react.dev/link/controlled-components", "select-value-default");
    }
  }
  node.multiple = !!p.multiple;
  if (p.value != null) updateOptions(node, !!p.multiple, p.value, false);
  else if (p.defaultValue != null) updateOptions(node, !!p.multiple, p.defaultValue, true);
}

function updateSelect(node: HTMLSelectElement, p: any, wasMultiple: any) {
  if (p.value != null) updateOptions(node, !!p.multiple, p.value, false);
  else if (!!wasMultiple !== !!p.multiple) {
    if (p.defaultValue != null) updateOptions(node, !!p.multiple, p.defaultValue, true);
    else updateOptions(node, !!p.multiple, p.multiple ? [] : "", false);
  }
}

// ---------------------------------------------------------------- value tracking

/** What a field holds now, as React's inputValueTracking compares it. */
const isCheckable = (el: any) => el.nodeName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
const currentOf = (el: any) => (isCheckable(el) ? String(el.checked) : String(el.value));

/**
 * React's value tracker (`_valueTracker`, which testing libraries use too): the value React last knew. Code setting
 * `value` or `checked` on the element updates it (that is no change by the person); what a person types does not.
 */
function trackValueOnNode(node: any, field: string, current: string) {
  const d = Object.getOwnPropertyDescriptor(node.constructor.prototype, field);
  if (Object.prototype.hasOwnProperty.call(node, field) || !d || typeof d.get !== "function" || typeof d.set !== "function") return null;
  const { get, set } = d;
  Object.defineProperty(node, field, {
    configurable: true,
    enumerable: d.enumerable,
    get() {
      return get.call(this);
    },
    set(v: any) {
      current = "" + v;
      set.call(this, v);
    },
  });
  return {
    getValue: () => current,
    setValue: (v: any) => void (current = "" + v),
    stopTracking() {
      node._valueTracker = null;
      delete node[field];
    },
  };
}

/** The field's value noted as known (the tracker made the first time): set by us, so no change to report. */
export function track(el: Element) {
  const node = el as any;
  if (!node._valueTracker) node._valueTracker = trackValueOnNode(node, isCheckable(node) ? "checked" : "value", currentOf(node));
  else node._valueTracker.setValue(currentOf(node));
}

/** Whether the field's value differs from the last one known (and note it): onChange fires only then, as in React. */
export function valueChanged(el: Element): boolean {
  const tracker = (el as any)._valueTracker;
  if (!tracker) return true;
  const now = currentOf(el);
  if (tracker.getValue() === now) return false;
  tracker.setValue(now);
  return true;
}

// ---------------------------------------------------------------- the calls core makes

/** A new field's props set: the ordinary ones first (type, step, min, max before value), then React's own. */
export function initForm(el: Element, tag: string, props: any, svg: boolean, hydrating = false) {
  const own = OWN[tag]!;
  checkControlled(tag, props);
  validateProps(tag, props, true);
  // Taken over from the server: only its listeners (its attributes are left as the server wrote them).
  for (const k in props) if (!own.has(k) && props[k] != null && (!hydrating || isEventProp(k))) setProp(el, k, props[k], undefined, svg);
  if (!hydrating && !own.has("dangerouslySetInnerHTML")) innerHtml(el, props, null);
  if (tag === "input") initInput(el as HTMLInputElement, props, hydrating);
  else if (tag === "textarea") initTextarea(el as HTMLTextAreaElement, props);
  else if (tag === "select") initSelect(el as HTMLSelectElement, props);
  if (tag === "option" && props.value == null && props.dangerouslySetInnerHTML != null && (typeof props.children !== "object" || props.children === null))
    warn("Pass a `value` prop if you set dangerouslyInnerHTML so React knows which value should be selected.", "option-inner-html");
  if (tag === "option" && props.selected != null && dev()) warn("Use the `defaultValue` or `value` props on <select> instead of setting `selected` on <option>.", "option-selected");
  else if (tag === "option" && props.selected != null) (el as HTMLOptionElement).selected = !!props.selected && typeof props.selected !== "function" && typeof props.selected !== "symbol";
  if (tag !== "option") track(el);
}

/** An option's or select's dangerouslySetInnerHTML, as on any element. */
function innerHtml(el: Element, next: any, prev: any) {
  const html = next.dangerouslySetInnerHTML?.__html;
  if (html !== prev?.dangerouslySetInnerHTML?.__html) el.innerHTML = html ?? "";
}

/** A field's props changed from `prev` to `next`. */
export function updateForm(el: Element, tag: string, next: any, prev: any, svg: boolean) {
  const own = OWN[tag]!;
  validateProps(tag, next, true);
  checkControlledSwitch(tag, next, prev);
  for (const k in prev) if (!own.has(k) && !(k in next)) setProp(el, k, undefined, prev[k], svg);
  for (const k in next) if (!own.has(k) && next[k] !== prev[k]) setProp(el, k, next[k], prev[k], svg);
  if (!own.has("dangerouslySetInnerHTML")) innerHtml(el, next, prev);
  if (tag === "input") updateInput(el as HTMLInputElement, next, prev.defaultValue);
  else if (tag === "textarea") updateTextarea(el as HTMLTextAreaElement, next);
  else if (tag === "select") updateSelect(el as HTMLSelectElement, next, prev.multiple);
  else if (tag === "option" && next.selected !== prev.selected && next.selected != null) (el as HTMLOptionElement).selected = !!next.selected;
  if (tag !== "option") track(el);
}

/** After a field's change event: put back what its props say (React's restoreControlledState), radio groups too. */
export function restoreForm(el: Element) {
  const props = (el as any)[PROPS];
  if (!props) return;
  const tag = el.localName;
  if (tag === "input") {
    updateInput(el as HTMLInputElement, props, props.defaultValue);
    if (props.type === "radio" && props.name != null) {
      let top: Node = el;
      while (top.parentNode) top = top.parentNode;
      const group = (top as ParentNode).querySelectorAll(`input[name="${CSS.escape("" + props.name)}"][type="radio"]`);
      for (const other of group) {
        if (other === el || (other as HTMLInputElement).form !== (el as HTMLInputElement).form) continue;
        const theirs = (other as any)[PROPS];
        if (theirs) updateInput(other as HTMLInputElement, theirs, theirs.defaultValue);
      }
    }
  } else if (tag === "textarea") updateTextarea(el as HTMLTextAreaElement, props);
  else if (tag === "select" && props.value != null) updateOptions(el as HTMLSelectElement, !!props.multiple, props.value, false);
  track(el);
}
