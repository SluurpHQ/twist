// Which attribute a prop becomes, and with what value: React DOM 19's rules, shared by the browser and the server
// so both write the same markup. In development, the mistakes React warns about are warned about here too.

const BOOLEAN = new Set(
  "allowFullScreen async autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden inert loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" "),
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

const dev = () => (globalThis as any).__DEV__ !== false && (globalThis as any).process?.env?.NODE_ENV !== "production";
const warned = new Set<string>();
/** A development warning, once per message (as React dedupes them). */
export function warn(message: string) {
  if (!dev() || warned.has(message)) return;
  warned.add(message);
  console.error(message);
}

const dataOrAria = (n: string) => /^(data|aria)-/i.test(n);

/**
 * The attribute `name` on `tag` becomes, and its value: [attribute, value] to write, [attribute, null] to leave out,
 * or null when the prop is not an attribute at all (events, children, value…, handled elsewhere).
 */
export function attribute(tag: string, name: string, value: any, svg: boolean): [string, string | null] | null {
  const t = typeof value;
  if (BOOLEAN.has(name)) {
    if (t === "function" || t === "symbol") warn(`Invalid value for prop \`${name}\` on <${tag}> tag.`);
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
      warn(`An empty string ("") was passed to the ${name} attribute. This may cause the browser to download the whole page again over the network. To fix this, either do not render the element at all or pass null to ${name} instead of an empty string.`);
      return [name, null];
    }
    if (value == null || t === "function" || t === "symbol" || t === "boolean") {
      if (t === "boolean") warn(`Received \`${value}\` for a non-boolean attribute \`${name}\`.`);
      return [name, null];
    }
    return [name, sanitizeURL(String(value))];
  }
  if (KNOWN.has(name)) {
    const attr = ALIASES[name] ?? name;
    if (value == null || t === "function" || t === "symbol" || t === "boolean") {
      if (t === "boolean") warn(`Received \`${value}\` for a non-boolean attribute \`${name}\`.`);
      return [attr, null];
    }
    return [attr, String(value)];
  }
  // Everything else: data- and aria- take booleans as text; any other attribute leaves booleans out.
  let attr = ALIASES[name] ?? name;
  if (svg && SVG_HYPHEN.test(name)) attr = name.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  if (value == null) return [attr, null];
  if (t === "function" || t === "symbol") {
    warn(`Invalid value for prop \`${name}\` on <${tag}> tag. Either remove it from the element, or pass a string or number value to keep it in the DOM.`);
    return [attr, null];
  }
  if (t === "boolean" && !dataOrAria(name)) {
    warn(`Received \`${value}\` for a non-boolean attribute \`${name}\`.`);
    return [attr, null];
  }
  return [attr, String(value)];
}
