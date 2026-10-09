// React's development warnings, in React's words (its tests and its users know them), each once per message as
// React dedupes them. Nothing in production.

export const dev = () => (globalThis as any).__DEV__ !== false && (globalThis as any).process?.env?.NODE_ENV !== "production";
const seen = new Set<string>();

/** Warnings held back while fn runs (props drawn on a scratch element to compare with the server's). */
let muted = 0;
export function muteWarnings<T>(fn: () => T): T {
  muted++;
  try {
    return fn();
  } finally {
    muted--;
  }
}

/** A development warning: every time, or once per `once` key where React keeps a flag for it. */
export function warn(message: string, once?: string) {
  if (!dev() || muted) return;
  if (once !== undefined) {
    if (seen.has(once)) return;
    seen.add(once);
  }
  console.error(message);
}

/** A warning React gives once (it remembers having given it). */
export const warnOnce = (message: string) => warn(message, message);

/** Forget what was warned (React's tests load React afresh for each test). */
export function resetWarnings() {
  seen.clear();
}

/** The component being rendered now, for "Check the render method of `X`.": set by core. */
let owner: () => string | null = () => null;
export function setOwner(fn: () => string | null) {
  owner = fn;
}

// ---------------------------------------------------------------- keys

/** Children given as an array (not as JSX siblings): each element in it should have a key. */
export function checkKeys(children: any[], parentType: any) {
  if (!dev()) return;
  const unchecked = children.filter((c) => c?._store && !c._store.validated);
  // Checked once: the same elements passed on again (a component returning its children) warn no more.
  for (const c of unchecked) c._store.validated = 1;
  for (const c of unchecked) {
    if (c && typeof c === "object" && c.$$typeof === Symbol.for("react.transitional.element") && c.key == null) {
      const who = owner();
      const where = who
        ? `\n\nCheck the render method of \`${who}\`.`
        : `\n\nCheck the top-level render call using <${typeof parentType === "string" ? parentType : parentType?.displayName ?? parentType?.name ?? "Component"}>.`;
      warn(`Each child in a list should have a unique "key" prop.${where} See https://react.dev/link/warning-keys for more information.`, "key:" + where);
      return;
    }
  }
}

export function duplicateKey(key: string) {
  warn(
    `Encountered two children with the same key, \`${key}\`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version.`,
  );
}

// ---------------------------------------------------------------- DOM props

// React's possibleStandardNames, for the mistakes people make: lowercase or HTML spellings of React's props.
const STANDARD: Record<string, string> = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", maxlength: "maxLength", minlength: "minLength",
  colspan: "colSpan", rowspan: "rowSpan", autofocus: "autoFocus", autocomplete: "autoComplete", autoplay: "autoPlay",
  contenteditable: "contentEditable", crossorigin: "crossOrigin", enctype: "encType", formaction: "formAction",
  frameborder: "frameBorder", novalidate: "noValidate", srcset: "srcSet", usemap: "useMap", accesskey: "accessKey",
  allowfullscreen: "allowFullScreen", cellpadding: "cellPadding", cellspacing: "cellSpacing", charset: "charSet",
  classname: "className", datetime: "dateTime", htmlfor: "htmlFor", httpequiv: "httpEquiv", "http-equiv": "httpEquiv",
  inputmode: "inputMode", spellcheck: "spellCheck", srcdoc: "srcDoc", srclang: "srcLang", onclick: "onClick",
  ondblclick: "onDoubleClick", onchange: "onChange", oninput: "onInput", onkeydown: "onKeyDown", onkeyup: "onKeyUp",
  onsubmit: "onSubmit", onfocus: "onFocus", onblur: "onBlur", onmousedown: "onMouseDown", onmouseup: "onMouseUp",
};
const KNOWN_EVENTS = new Set(
  "Abort AnimationEnd AnimationIteration AnimationStart AnimationCancel AuxClick BeforeInput BeforeToggle Blur Cancel CanPlay CanPlayThrough Change Click Close CompositionEnd CompositionStart CompositionUpdate ContextMenu Copy Cut DoubleClick Drag DragEnd DragEnter DragExit DragLeave DragOver DragStart Drop DurationChange Emptied Encrypted Ended Error Focus GotPointerCapture Input Invalid KeyDown KeyPress KeyUp Load LoadedData LoadedMetadata LoadStart LostPointerCapture MouseDown MouseEnter MouseLeave MouseMove MouseOut MouseOver MouseUp Paste Pause Play Playing PointerCancel PointerDown PointerEnter PointerLeave PointerMove PointerOut PointerOver PointerUp Progress RateChange Reset Resize Scroll ScrollEnd Seeked Seeking Select Stalled Submit Suspend TimeUpdate Toggle TouchCancel TouchEnd TouchMove TouchStart TransitionEnd TransitionRun TransitionStart TransitionCancel VolumeChange Waiting Wheel FullscreenChange FullscreenError".split(" "),
);

/** What React says of a prop name on a DOM element, if anything: before it is set. */
export function checkPropName(tag: string, name: string, value: any) {
  if (!dev() || tag.includes("-")) return;
  const lower = name.toLowerCase();
  if (name.startsWith("on") && name.length > 2) {
    if (name === "onFocusIn" || name === "onFocusOut") {
      warnOnce("React uses onFocus and onBlur instead of onFocusIn and onFocusOut. All React events are normalized to bubble, so onFocusIn and onFocusOut are not needed/supported by React.");
      return;
    }
    const rest = name.slice(2).replace(/Capture$/, "");
    if (name[2] === name[2]!.toUpperCase() && !KNOWN_EVENTS.has(rest)) {
      warnOnce(`Unknown event handler property \`${name}\`. It will be ignored.`);
      return;
    }
  }
  if (/^aria[A-Z]/.test(name) || (lower.startsWith("aria") && !lower.startsWith("aria-") && name !== "aria")) {
    warnOnce(`Invalid ARIA attribute \`${name}\`. ARIA attributes follow the pattern aria-* and must be lowercase.`);
    return;
  }
  const standard = STANDARD[name] ?? (STANDARD[lower] !== name ? STANDARD[lower] : undefined);
  if (standard && standard !== name && value !== undefined) warnOnce(`Invalid DOM property \`${name}\`. Did you mean \`${standard}\`?`);
}

/** An element whose tag the browser does not know (a component written in lowercase, say). */
export function checkTag(el: Element, tag: string) {
  if (!dev() || tag.includes("-") || el.namespaceURI !== "http://www.w3.org/1999/xhtml") return;
  if (typeof HTMLUnknownElement !== "undefined" && el instanceof HTMLUnknownElement) {
    warnOnce(`The tag <${tag}> is unrecognized in this browser. If you meant to render a React component, start its name with an uppercase letter.`);
  }
}

// ---------------------------------------------------------------- form fields

const READ_ONLY_TYPES = new Set(["button", "checkbox", "image", "hidden", "radio", "reset", "submit"]);

/** React's checkControlledValueProps: a value or checked that no handler can change. */
export function checkControlled(tag: string, props: any) {
  if (!dev()) return;
  const handled = props.onChange || props.readOnly || props.disabled;
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (props.value != null && !(tag === "input" && READ_ONLY_TYPES.has(props.type)) && !handled && !props.onInput) {
      warnOnce(
        tag === "select"
          ? "You provided a `value` prop to a form field without an `onChange` handler. This will render a read-only field. If the field should be mutable use `defaultValue`. Otherwise, set `onChange`."
          : "You provided a `value` prop to a form field without an `onChange` handler. This will render a read-only field. If the field should be mutable use `defaultValue`. Otherwise, set either `onChange` or `readOnly`.",
      );
    }
    if (tag === "input" && props.checked != null && !handled && !props.onClick) {
      warnOnce("You provided a `checked` prop to a form field without an `onChange` handler. This will render a read-only field. If the field should be mutable use `defaultChecked`. Otherwise, set either `onChange` or `readOnly`.");
    }
  }
  if ((tag === "input" || tag === "textarea" || tag === "select") && props.value === null && "value" in props) {
    warnOnce(
      tag === "select"
        ? "`value` prop on `select` should not be null. Consider using an empty string to clear the component or `undefined` for uncontrolled components."
        : `\`value\` prop on \`${tag}\` should not be null. Consider using an empty string to clear the component or \`undefined\` for uncontrolled components.`,
    );
  }
  if (tag === "textarea" && props.children != null && props.value == null) warnOnce("Use the `defaultValue` or `value` props instead of setting children on <textarea>.");
}

/** A field switching between controlled and uncontrolled across an update. */
export function checkControlledSwitch(tag: string, next: any, prev: any) {
  if (!dev() || tag !== "input") return;
  const isCheck = next.type === "checkbox" || next.type === "radio";
  const was = isCheck ? prev.checked != null : prev.value != null;
  const is = isCheck ? next.checked != null : next.value != null;
  if (was && !is) {
    warnOnce(
      "A component is changing a controlled input to be uncontrolled. This is likely caused by the value changing from a defined to undefined, which should not happen. Decide between using a controlled or uncontrolled input element for the lifetime of the component. More info: https://react.dev/link/controlled-components",
    );
  } else if (!was && is) {
    warnOnce(
      "A component is changing an uncontrolled input to be controlled. This is likely caused by the value changing from undefined to a defined value, which should not happen. Decide between using a controlled or uncontrolled input element for the lifetime of the component. More info: https://react.dev/link/controlled-components",
    );
  }
}
