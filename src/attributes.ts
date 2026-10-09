// Which attribute a prop becomes, and with what value: React DOM 19's rules, shared by the browser and the server
// so both write the same markup. In development, the mistakes React warns about are warned about here too.

const BOOLEAN = new Set(
  "allowFullScreen async autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden inert loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope credentialless".split(" "),
);
const OVERLOADED_BOOLEAN = new Set(["capture", "download"]);
// Written as the strings "true" and "false".
const BOOLEANISH = new Set(["contentEditable", "draggable", "spellCheck", "autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"]);
const POSITIVE_NUMBER = new Set(["cols", "rows", "size", "span"]);
const NUMBER = new Set(["rowSpan", "start"]);
// Known attributes whose value is a string: true/false/functions leave them out.
const KNOWN = new Set(["className", "tabIndex", "dir", "role", "viewBox", "width", "height"]);
const URL = new Set(["src", "href", "action", "formAction", "xlinkHref", "poster", "cite", "data"]);
const ALIASES: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  acceptCharset: "accept-charset",
  httpEquiv: "http-equiv",
  tabIndex: "tabindex",
  crossOrigin: "crossorigin",
};
// SVG attributes React writes hyphenated (strokeWidth → stroke-width); the others keep their case (viewBox).
const SVG_HYPHEN = /^(accent|alignment|arabic|baseline|cap|clip|color|dominant|enable|fill|flood|font|glyph|horiz|image|letter|lighting|marker|overline|paint|panose|pointer|rendering|shape|stop|strikethrough|stroke|text|underline|unicode|units|v|vector|vert|word|writing|x)[A-Z]/;
const XML: Record<string, string> = { xlinkActuate: "xlink:actuate", xlinkArcrole: "xlink:arcrole", xlinkRole: "xlink:role", xlinkShow: "xlink:show", xlinkTitle: "xlink:title", xlinkType: "xlink:type", xlinkHref: "xlink:href", xmlBase: "xml:base", xmlLang: "xml:lang", xmlSpace: "xml:space" };
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** The URL React writes instead of a javascript: one. */
const BLOCKED = "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')";
const JAVASCRIPT = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
export const sanitizeURL = (v: string) => (JAVASCRIPT.test(v) ? BLOCKED : v);

import { warn } from "./warnings.ts";
export { warn };

const dataOrAria = (n: string) => /^(data|aria)-/i.test(n);

/** A custom element (a tag with a dash, or a built-in one given `is`): React writes its props as they are. */
export const isCustomElement = (tag: string, props: any) => tag.includes("-") || (props != null && props.is != null);

/**
 * A custom element's attribute, as React 19 writes it: className as class (and htmlFor as for, on an `is` element),
 * true as present, false and null as absent, and no warnings. Functions and symbols are not attributes.
 */
export function customAttribute(tag: string, name: string, value: any): [string, string | null] | null {
  const t = typeof value;
  if (t === "function" || t === "symbol") return null;
  const attr = name === "className" ? "class" : name === "htmlFor" && !tag.includes("-") ? "for" : name;
  if (value == null || value === false) return [attr, null];
  return [attr, value === true ? "" : String(value)];
}

/**
 * The attribute `name` on `tag` becomes, and its value: [attribute, value] to write, [attribute, null] to leave out,
 * or null when the prop is not an attribute at all (events, children, value…, handled elsewhere).
 */
export function attribute(tag: string, name: string, value: any, svg: boolean): [string, string | null] | null {
  const t = typeof value;
  if (BOOLEAN.has(name)) {
    return [name.toLowerCase(), value && t !== "function" && t !== "symbol" ? "" : null];
  }
  if (BOOLEANISH.has(name)) {
    if (value == null || t === "function" || t === "symbol") return [name, null];
    return [name, String(value)];
  }
  if (OVERLOADED_BOOLEAN.has(name)) {
    if (value === true) return [name, ""];
    if (value == null || value === false || t === "function" || t === "symbol") return [name, null];
    return [name, String(value)];
  }
  if (POSITIVE_NUMBER.has(name)) return [name, value != null && t !== "function" && t !== "symbol" && t !== "boolean" && !isNaN(value) && value >= 1 ? String(value) : null];
  if (NUMBER.has(name)) return [name.toLowerCase(), value != null && t !== "function" && t !== "symbol" && t !== "boolean" && !isNaN(value) ? String(value) : null];
  if (name in XML) {
    if (value == null || t === "function" || t === "symbol" || t === "boolean") return [XML[name]!, null];
    return [XML[name]!, name === "xlinkHref" ? sanitizeURL(String(value)) : String(value)];
  }
  if (URL.has(name)) {
    if (value === "" && !(tag === "a" && name === "href") && (name === "src" || name === "href")) {
      warn(`An empty string ("") was passed to the ${name} attribute. ${name === "src" ? "This may cause the browser to download the whole page again over the network. " : ""}To fix this, either do not render the element at all or pass null to ${name} instead of an empty string.`);
      return [name, null];
    }
    if (value == null || t === "function" || t === "symbol" || t === "boolean") {
      return [name, null];
    }
    return [name, sanitizeURL(String(value))];
  }
  if (KNOWN.has(name)) {
    const attr = ALIASES[name] ?? name;
    if (value == null || t === "function" || t === "symbol" || t === "boolean") {
      return [attr, null];
    }
    return [attr, String(value)];
  }
  // Everything else: data- and aria- take booleans as text; any other attribute leaves booleans out.
  if (!attributeNameSafe(name)) return null;
  let attr = ALIASES[name] ?? name;
  if (svg && SVG_HYPHEN.test(name)) attr = name.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  if (value == null) return [attr, null];
  if (t === "function" || t === "symbol") return [attr, null];
  if (t === "boolean" && !dataOrAria(name)) return [attr, null];
  return [attr, String(value)];
}

// ---------------------------------------------------------------- validation (React DOM's assertValidProps and friends)

export const VOID_TAGS = new Set("area base br col embed hr img input keygen link meta param source track wbr menuitem".split(" "));
const VALID_TAG = /^[a-zA-Z][a-zA-Z:_.\-\d]*$/;
// React's isAttributeNameSafe: what may be written as an attribute name.
const START_CHAR = ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
const ATTRIBUTE_NAME = new RegExp("^[" + START_CHAR + "][" + START_CHAR + "\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$");
const safeNames = new Map<string, boolean>();

/** Whether `name` may be an attribute; one that may not is warned about once and left out. */
export function attributeNameSafe(name: string): boolean {
  let ok = safeNames.get(name);
  if (ok === undefined) {
    ok = ATTRIBUTE_NAME.test(name);
    safeNames.set(name, ok);
    if (!ok) warn(`Invalid attribute name: \`${name}\``);
  }
  return ok;
}

/** A tag React refuses to write (a name that is not one, or markup smuggled in as one). */
export function checkTagName(tag: string) {
  if (!VALID_TAG.test(tag)) throw new Error(`Invalid tag: ${tag}`);
}

/** React DOM's assertValidProps: children of void elements, dangerouslySetInnerHTML's shape, style's type. */
export function assertValidProps(tag: string, props: any) {
  if (!props) return;
  if (VOID_TAGS.has(tag) && (props.children != null || props.dangerouslySetInnerHTML != null)) {
    throw new Error(`${tag} is a void element tag and must neither have \`children\` nor use \`dangerouslySetInnerHTML\`.`);
  }
  if (props.dangerouslySetInnerHTML != null) {
    if (props.children != null) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
    if (typeof props.dangerouslySetInnerHTML !== "object" || !("__html" in props.dangerouslySetInnerHTML)) {
      throw new Error("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.");
    }
  }
  if (props.style != null && typeof props.style !== "object") {
    throw new Error("The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.");
  }
}
