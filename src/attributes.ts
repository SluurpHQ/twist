// Which attribute a prop becomes, and with what value: React DOM 19's rules, shared by the browser and the server
// so both write the same markup. In development, the mistakes React warns about are warned about here too.

const BOOLEAN = new Set(
  "allowFullScreen async autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden inert loop multiple noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope credentialless".split(" "),
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
import { attributeString } from "./coercion.ts";
export { warn };

const dataOrAria = (n: string) => /^(data|aria)-/i.test(n);

/** A custom element (a tag with a dash, or a built-in one given `is`): React writes its props as they are. */
/** SVG and MathML elements with a hyphen that are not custom elements (React's list). */
const HYPHENATED_BUILT_IN = new Set(["annotation-xml", "color-profile", "font-face", "font-face-src", "font-face-uri", "font-face-format", "font-face-name", "missing-glyph"]);
/** A tag that names a custom element (a hyphen, and not one of the built-in hyphenated ones). */
const customTags = new Map<string, boolean>();
export const customTag = (tag: string) => {
  let got = customTags.get(tag);
  if (got === undefined) customTags.set(tag, (got = tag.includes("-") && !HYPHENATED_BUILT_IN.has(tag)));
  return got;
};
export const isCustomElement = (tag: string, _props?: any) => customTag(tag);

/**
 * A custom element's attribute, as React 19 writes it: className as class (and htmlFor as for, on an `is` element),
 * true as present, false and null as absent, and no warnings. Functions and symbols are not attributes.
 */
export function customAttribute(tag: string, name: string, value: any): [string, string | null] | null {
  const t = typeof value;
  if (t === "function" || t === "symbol") return null;
  if (!attributeNameSafe(name)) return null;
  const attr = name === "className" ? "class" : name === "htmlFor" && !tag.includes("-") ? "for" : name;
  if (value == null || value === false) return [attr, null];
  return [attr, value === true ? "" : attributeString(value, name)];
}

/** `inert` once took "" for true: React says it now means false (once on each side, as its client and server keep a
 * flag each; hydrating counts as the client). */
export function inertEmpty(value: any, side = "client") {
  if (value === "")
    warn(
      "Received an empty string for a boolean attribute `inert`. This will treat the attribute as if it were false. Either pass `false` to silence this warning, or pass `true` if you used an empty string in earlier versions of React to indicate this attribute is true.",
      side + ":inert-empty",
    );
}

/**
 * The attribute `name` on `tag` becomes, and its value: [attribute, value] to write, [attribute, null] to leave out,
 * or null when the prop is not an attribute at all (events, children, value…, handled elsewhere).
 */
/** What kind of attribute a prop name is, worked out once per name (a render asks for the same few many times). */
// (Plain numbers, not an enum: the source runs as it is where types are only stripped.)
const K_HANDLER = 0;
const K_BOOLEAN = 1;
const K_BOOLEANISH = 2;
const K_OVERLOADED = 3;
const K_POSITIVENUMBER = 4;
const K_NUMBER = 5;
const K_XML = 6;
const K_URL = 7;
const K_KNOWN = 8;
const K_OTHER = 9;
const kinds = new Map<string, number>();
function kindOf(name: string): number {
  const known = kinds.get(name);
  if (known !== undefined) return known;
  // Anything named on… is never written (an event handler, or a string posing as one).
  const k =
    name.length > 2 && (name[0] === "o" || name[0] === "O") && (name[1] === "n" || name[1] === "N") ? K_HANDLER
    : BOOLEAN.has(name) ? K_BOOLEAN
    : BOOLEANISH.has(name) ? K_BOOLEANISH
    : OVERLOADED_BOOLEAN.has(name) ? K_OVERLOADED
    : POSITIVE_NUMBER.has(name) ? K_POSITIVENUMBER
    : NUMBER.has(name) ? K_NUMBER
    : name in XML ? K_XML
    : URL.has(name) ? K_URL
    : KNOWN.has(name) ? K_KNOWN
    : K_OTHER;
  kinds.set(name, k);
  return k;
}

export function attribute(tag: string, name: string, value: any, svg: boolean, side = "client"): [string, string | null] | null {
  const t = typeof value;
  switch (kindOf(name)) {
    case K_HANDLER:
      return null;
    case K_BOOLEAN:
      if (name === "inert") inertEmpty(value, side);
      return [name.toLowerCase(), value && t !== "function" && t !== "symbol" ? "" : null];
    case K_BOOLEANISH:
      if (value == null || t === "function" || t === "symbol") return [name, null];
      return [name, attributeString(value, name)];
    case K_OVERLOADED:
      if (value === true) return [name, ""];
      if (value == null || value === false || t === "function" || t === "symbol") return [name, null];
      return [name, attributeString(value, name)];
    case K_POSITIVENUMBER:
      return [name, value != null && t !== "function" && t !== "symbol" && t !== "boolean" && !isNaN(value) && value >= 1 ? attributeString(value, name) : null];
    case K_NUMBER:
      return [name.toLowerCase(), value != null && t !== "function" && t !== "symbol" && t !== "boolean" && !isNaN(value) ? attributeString(value, name) : null];
    case K_XML:
      if (value == null || t === "function" || t === "symbol" || t === "boolean") return [XML[name]!, null];
      return [XML[name]!, name === "xlinkHref" ? sanitizeURL(attributeString(value, name)) : attributeString(value, name)];
    case K_URL:
      // data is a URL only on <object> (React sanitizes it there alone).
      if (name !== "data" || tag === "object") {
        if (value === "" && !(tag === "a" && name === "href") && (name === "src" || name === "href" || name === "data")) {
          warn(`An empty string ("") was passed to the ${name} attribute. ${name === "src" ? "This may cause the browser to download the whole page again over the network. " : ""}To fix this, either do not render the element at all or pass null to ${name} instead of an empty string.`);
          return [name, null];
        }
        if (value == null || t === "function" || t === "symbol" || t === "boolean") return [name, null];
        return [name, sanitizeURL(attributeString(value, name))];
      }
      break;
    case K_KNOWN: {
      const attr = ALIASES[name] ?? name;
      if (value == null || t === "function" || t === "symbol" || t === "boolean") return [attr, null];
      return [attr, attributeString(value, name)];
    }
  }
  // Everything else: data- and aria- take booleans as text; any other attribute leaves booleans out.
  if (!attributeNameSafe(name)) return null;
  let attr = ALIASES[name] ?? name;
  if (svg && SVG_HYPHEN.test(name)) attr = name.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  if (value == null) return [attr, null];
  if (t === "function" || t === "symbol") return [attr, null];
  if (t === "boolean" && !dataOrAria(name)) return [attr, null];
  return [attr, attributeString(value, name)];
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
  if (safeNames.has(name)) return true;
  if (ATTRIBUTE_NAME.test(name)) return safeNames.set(name, true), true;
  warn(`Invalid attribute name: \`${name}\``, "attribute-name:" + name);
  return false;
}

/** A tag React refuses to write (a name that is not one, or markup smuggled in as one). */
/** Tags already found valid. */
const validTags = new Set<string>();
export function checkTagName(tag: string) {
  if (validTags.has(tag)) return;
  if (VALID_TAG.test(tag)) validTags.add(tag);
  else throw new Error(`Invalid tag: ${tag}`);
}

/** React DOM's assertValidProps: children of void elements, dangerouslySetInnerHTML's shape, style's type. */
export function assertValidProps(tag: string, props: any, client = false) {
  if (!props) return;
  if (VOID_TAGS.has(tag) && (props.children != null || props.dangerouslySetInnerHTML != null)) {
    throw new Error(`${tag} is a void element tag and must neither have \`children\` nor use \`dangerouslySetInnerHTML\`.`);
  }
  if (props.dangerouslySetInnerHTML != null) {
    // The client checks the form first, and children only beside some HTML; the server children first.
    const inner = props.dangerouslySetInnerHTML;
    const badForm = typeof inner !== "object" || !("__html" in inner);
    if (!client && props.children != null) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
    if (badForm) throw new Error("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://react.dev/link/dangerously-set-inner-html for more information.");
    if (client && props.children != null && inner.__html != null) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
  }
  if (props.style != null && typeof props.style !== "object") {
    throw new Error("The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.");
  }
}
