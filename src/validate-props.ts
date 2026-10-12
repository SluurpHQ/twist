// React DOM's development checks of an element's props, in React's words: misspelled and unknown props, event
// handlers, ARIA attributes, values of the wrong type, a null value on a form field, contentEditable with children
// and style values. Run when an element is made (and its props change), on the browser and on the server alike.
declare const process: { env: Record<string, string | undefined> };
import { ARIA_NAMES, standardName } from "./standard-names.ts";
import { dev, warn } from "./warnings.ts";
import { isCustomElement } from "./attributes.ts";

const EVENTS =
  /* @__PURE__ */ "Abort AnimationEnd AnimationIteration AnimationStart AuxClick BeforeInput BeforeToggle Blur Cancel CanPlay CanPlayThrough Change Click Close CompositionEnd CompositionStart CompositionUpdate ContextMenu Copy Cut DoubleClick Drag DragEnd DragEnter DragExit DragLeave DragOver DragStart Drop DurationChange Emptied Encrypted Ended Error Focus GotPointerCapture Input Invalid KeyDown KeyPress KeyUp Load LoadedData LoadedMetadata LoadStart LostPointerCapture MouseDown MouseEnter MouseLeave MouseMove MouseOut MouseOver MouseUp Paste Pause Play Playing PointerCancel PointerDown PointerEnter PointerLeave PointerMove PointerOut PointerOver PointerUp Progress RateChange Reset Resize Scroll ScrollEnd Seeked Seeking Select SelectionChange Stalled Submit Suspend TimeUpdate Toggle TouchCancel TouchEnd TouchMove TouchStart TransitionEnd TransitionRun TransitionStart TransitionCancel VolumeChange Waiting Wheel FullscreenChange FullscreenError".split(" ");
/** React's event props (onClick, onClickCapture…). */
const REGISTERED = /* @__PURE__ */ new Set(/* @__PURE__ */ EVENTS.flatMap((e) => [`on${e}`, `on${e}Capture`]));
/** What a lowercase event prop most likely meant. */
const POSSIBLE = /* @__PURE__ */ new Map<string, string>([.../* @__PURE__ */ [...REGISTERED].map((n) => [n.toLowerCase(), n] as [string, string]), ["ondblclick", "onDoubleClick"]]);

const BOOLEANS = /* @__PURE__ */ new Set(
  /* @__PURE__ */ "autoFocus checked multiple muted selected contentEditable spellCheck draggable value autoReverse externalResourcesRequired focusable preserveAlpha allowFullScreen async autoPlay controls credentialless default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope capture download inert".split(" "),
);
const STRING_BOOLEANS = /* @__PURE__ */ new Set(
  /* @__PURE__ */ "checked selected multiple muted allowFullScreen async autoPlay controls credentialless default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope inert".split(" "),
);
const RESERVED = /* @__PURE__ */ new Set(/* @__PURE__ */ "dangerouslySetInnerHTML children style suppressContentEditableWarning suppressHydrationWarning defaultValue defaultChecked innerHTML ref innerText textContent".split(" "));
const ARIA = /^aria-[:A-Z_a-zÀ-�\-.0-9·]*$/;
const ARIA_CAMEL = /^aria[A-Z][:A-Z_a-zÀ-�\-.0-9·]*$/;

/** One prop: false when its value is of a type React leaves out with a warning (gathered by the caller). */
function validProp(tag: string, name: string, value: any, client: boolean): boolean {
  const once = (message: string) => (warn(message, "prop:" + name), true);
  const lower = name.toLowerCase();
  if (lower === "onfocusin" || lower === "onfocusout") {
    return once("React uses onFocus and onBlur instead of onFocusIn and onFocusOut. All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.");
  }
  if (typeof value === "function" && ((tag === "form" && name === "action") || ((tag === "input" || tag === "button") && name === "formAction"))) return true;
  if (client) {
    if (REGISTERED.has(name)) return true;
    const meant = POSSIBLE.get(lower);
    if (meant) return once(`Invalid event handler property \`${name}\`. Did you mean \`${meant}\`?`);
    if (/^on./.test(name)) return once(`Unknown event handler property \`${name}\`. It will be ignored.`);
  } else if (/^on./.test(name)) {
    if (/^on[^A-Z]/.test(name)) once(`Invalid event handler property \`${name}\`. React events use the camelCase naming convention, for example \`onClick\`.`);
    return true;
  }
  if (ARIA.test(name) || ARIA_CAMEL.test(name)) return true;
  if (lower === "innerhtml") return once("Directly setting property `innerHTML` is not permitted. For more information, lookup documentation on `dangerouslySetInnerHTML`.");
  if (lower === "aria") return once("The `aria` attribute is reserved for future use in React. Pass individual `aria-` attributes instead.");
  if (lower === "is" && value != null && typeof value !== "string") return once(`Received a \`${typeof value}\` for a string attribute \`is\`. If this is expected, cast the value to a string.`);
  if (typeof value === "number" && isNaN(value)) return once(`Received NaN for the \`${name}\` attribute. If this is expected, cast the value to a string.`);
  const standard = standardName(lower);
  if (standard !== undefined) {
    if (standard !== name) return once(`Invalid DOM property \`${name}\`. Did you mean \`${standard}\`?`);
  } else if (name !== lower) {
    return once(`React does not recognize the \`${name}\` prop on a DOM element. If you intentionally want it to appear in the DOM as a custom attribute, spell it as lowercase \`${lower}\` instead. If you accidentally passed it from a parent component, remove it from the DOM element.`);
  }
  if (RESERVED.has(name)) return true;
  // A select's value chooses among its options: not an attribute to check.
  if (name === "value" && tag === "select") return true;
  switch (typeof value) {
    case "boolean": {
      if (BOOLEANS.has(name)) return true;
      const prefix = lower.slice(0, 5);
      if (prefix === "data-" || prefix === "aria-") return true;
      const write = `Received \`${value}\` for a non-boolean attribute \`${name}\`.\n\nIf you want to write it to the DOM, pass a string instead: ${name}="${value}" or ${name}={value.toString()}.`;
      return once(value ? write : `${write}\n\nIf you used to conditionally omit it with ${name}={condition && value}, pass ${name}={condition ? value : undefined} instead.`);
    }
    case "function":
    case "symbol":
      return false;
    case "string":
      if ((value === "false" || value === "true") && STRING_BOOLEANS.has(name)) {
        const why = value === "false" ? "The browser will interpret it as a truthy value." : 'Although this works, it will not work as expected if you pass the string "false".';
        return once(`Received the string \`${value}\` for the boolean attribute \`${name}\`. ${why} Did you mean ${name}={${value}}?`);
      }
  }
  return true;
}

function validAria(name: string): boolean {
  const once = (message: string) => (warn(message, "aria:" + name), true);
  if (ARIA_CAMEL.test(name)) {
    const aria = "aria-" + name.slice(4).toLowerCase();
    if (!ARIA_NAMES.has(aria)) return once(`Invalid ARIA attribute \`${name}\`. ARIA attributes follow the pattern aria-* and must be lowercase.`);
    if (name !== aria) return once(`Invalid ARIA attribute \`${name}\`. Did you mean \`${aria}\`?`);
  }
  if (ARIA.test(name)) {
    const lower = name.toLowerCase();
    if (!ARIA_NAMES.has(lower)) return false;
    if (name !== lower) return once(`Unknown ARIA attribute \`${name}\`. Did you mean \`${lower}\`?`);
  }
  return true;
}

const list = (names: string[]) => names.map((n) => "`" + n + "`").join(", ");

/** React's checks of a DOM element's props, as it runs them when the element is made or updated. */
export function validateProps(tag: string, props: any, client: boolean) {
  if (!(process.env.NODE_ENV !== "production" && dev()) || !props) return;
  const aria: string[] = [];
  for (const k in props) if (!validAria(k)) aria.push(k);
  if (aria.length === 1) warn(`Invalid aria prop ${list(aria)} on <${tag}> tag. For details, see https://react.dev/link/invalid-aria-props`);
  else if (aria.length > 1) warn(`Invalid aria props ${list(aria)} on <${tag}> tag. For details, see https://react.dev/link/invalid-aria-props`);
  if ((tag === "input" || tag === "textarea" || tag === "select") && props.value === null) {
    warn(
      tag === "select" && props.multiple
        ? `\`value\` prop on \`${tag}\` should not be null. Consider using an empty array when \`multiple\` is set to \`true\` to clear the component or \`undefined\` for uncontrolled components.`
        : `\`value\` prop on \`${tag}\` should not be null. Consider using an empty string to clear the component or \`undefined\` for uncontrolled components.`,
      "null-value",
    );
  }
  if (!isCustomElement(tag, props) && typeof props.is !== "string") {
    const bad: string[] = [];
    for (const k in props) if (!validProp(tag, k, props[k], client)) bad.push(k);
    if (bad.length === 1) warn(`Invalid value for prop ${list(bad)} on <${tag}> tag. Either remove it from the element, or pass a string or number value to keep it in the DOM. For details, see https://react.dev/link/attribute-behavior `);
    else if (bad.length > 1) warn(`Invalid values for props ${list(bad)} on <${tag}> tag. Either remove them from the element, or pass a string or number value to keep them in the DOM. For details, see https://react.dev/link/attribute-behavior `);
  }
  if (props.contentEditable && !props.suppressContentEditableWarning && props.children != null) {
    warn("A component is `contentEditable` and contains `children` managed by React. It is now your responsibility to guarantee that none of those nodes are unexpectedly modified or duplicated. This is probably not intentional.");
  }
}

/** A style property and its value, checked as React checks them. */
export function validateStyle(name: string, value: any) {
  if (!(process.env.NODE_ENV !== "production" && dev())) return;
  if (name.indexOf("-") > -1) {
    if (!name.startsWith("--")) warn(`Unsupported style property ${name}. Did you mean ${name.replace(/^-ms-/, "ms-").replace(/-(.)/g, (_, c) => c.toUpperCase())}?`, "style:" + name);
  } else if (/^(?:webkit|moz|o)[A-Z]/.test(name)) {
    warn(`Unsupported vendor-prefixed style property ${name}. Did you mean ${name.charAt(0).toUpperCase() + name.slice(1)}?`, "style:" + name);
  } else if (typeof value === "string" && /;\s*$/.test(value)) {
    warn(`Style property values shouldn't contain a semicolon. Try "${name}: ${value.replace(/;\s*$/, "")}" instead.`, "style-value:" + value);
  }
  if (typeof value === "number") {
    if (isNaN(value)) warn(`\`NaN\` is an invalid value for the \`${name}\` css style property.`, "style-nan");
    else if (!isFinite(value)) warn(`\`Infinity\` is an invalid value for the \`${name}\` css style property.`, "style-infinity");
  }
}
