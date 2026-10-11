// HTML's nesting rules, as React DOM checks them in development: an element the browser's parser would move or
// close (a <tr> straight in a <table>, a <p> in a <p>, a <div> in a <p>) is warned about, since server markup
// holding it would not hydrate.
declare const process: { env: Record<string, string | undefined> };
import { dev, warn } from "./warnings.ts";

type Info = { tag: string };
/** What is open around an element, for the parser's rules: the tags that change what may come next. */
export type Ancestors = {
  current: Info | null;
  form: Info | null;
  a: Info | null;
  button: Info | null;
  nobr: Info | null;
  pInButtonScope: Info | null;
  li: Info | null;
  dlItem: Info | null;
  container: Info | null;
  implicitRoot: boolean;
};

const SPECIAL = new Set(
  "address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input isindex li link listing main marquee menu menuitem meta nav noembed noframes noscript object ol p param plaintext pre script section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp".split(" "),
);
const IN_SCOPE = new Set("applet caption html table td th marquee object select template foreignObject desc title".split(" "));
const BUTTON_SCOPE = new Set([...IN_SCOPE, "button"]);
const IMPLIED_END = new Set("dd dt li option optgroup p rp rt".split(" "));
const HEADINGS = new Set("h1 h2 h3 h4 h5 h6".split(" "));
const P_CLOSERS = new Set("address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p section summary ul pre listing table hr xmp h1 h2 h3 h4 h5 h6".split(" "));

const EMPTY: Ancestors = { current: null, form: null, a: null, button: null, nobr: null, pInButtonScope: null, li: null, dlItem: null, container: null, implicitRoot: false };

/** What is open inside `tag`, given what was open around it (null: nothing, the top of a root). */
export function ancestorsWith(old: Ancestors | null, tag: string): Ancestors {
  const next = { ...(old ?? EMPTY) };
  const info = { tag };
  if (IN_SCOPE.has(tag)) next.a = next.button = next.nobr = null;
  if (BUTTON_SCOPE.has(tag)) next.pInButtonScope = null;
  if (SPECIAL.has(tag) && tag !== "address" && tag !== "div" && tag !== "p") next.li = next.dlItem = null;
  next.current = info;
  if (tag === "form") next.form = info;
  if (tag === "a") next.a = info;
  if (tag === "button") next.button = info;
  if (tag === "nobr") next.nobr = info;
  if (tag === "p") next.pInButtonScope = info;
  if (tag === "li") next.li = info;
  if (tag === "dd" || tag === "dt") next.dlItem = info;
  if (tag === "#document" || tag === "html") next.container = null;
  else if (!next.container) next.container = info;
  next.implicitRoot = old === null && (tag === "#document" || tag === "html" || tag === "body") ? true : false;
  return next;
}

function validWithParent(tag: string, parent: string | null | undefined, implicitRoot: boolean): boolean {
  switch (parent) {
    case "tr":
      return tag === "th" || tag === "td" || tag === "style" || tag === "script" || tag === "template";
    case "tbody":
    case "thead":
    case "tfoot":
      return tag === "tr" || tag === "style" || tag === "script" || tag === "template";
    case "colgroup":
      return tag === "col" || tag === "template";
    case "table":
      return tag === "caption" || tag === "colgroup" || tag === "tbody" || tag === "tfoot" || tag === "thead" || tag === "style" || tag === "script" || tag === "template";
    case "head":
      return "base basefont bgsound link meta title noscript noframes style script template".split(" ").includes(tag);
    case "html":
      if (implicitRoot) break;
      return tag === "head" || tag === "body" || tag === "frameset";
    case "frameset":
      return tag === "frame";
    case "#document":
      if (implicitRoot) break;
      return tag === "html";
  }
  if (HEADINGS.has(tag)) return !HEADINGS.has(parent ?? "");
  switch (tag) {
    case "rp":
    case "rt":
      return !IMPLIED_END.has(parent ?? "");
    case "caption":
    case "col":
    case "colgroup":
    case "input":
      return parent !== "select";
    case "frameset":
    case "frame":
    case "tbody":
    case "td":
    case "tfoot":
    case "th":
    case "thead":
    case "tr":
      return parent == null;
    case "head":
      return implicitRoot || parent == null;
    case "html":
      return (implicitRoot && parent === "#document") || parent == null;
    case "body":
      return (implicitRoot && (parent === "#document" || parent === "html")) || parent == null;
  }
  return true;
}

function invalidAncestor(tag: string, a: Ancestors): Info | null {
  if (P_CLOSERS.has(tag)) return a.pInButtonScope;
  switch (tag) {
    case "form":
      return a.form || a.pInButtonScope;
    case "li":
      return a.li;
    case "dd":
    case "dt":
      return a.dlItem;
    case "button":
      return a.button;
    case "a":
      return a.a;
    case "nobr":
      return a.nobr;
  }
  return null;
}

/**
 * An element `tag` placed where `a` says: warned about, as React does, when the parser would not keep it there.
 * `nested` says the offending ancestor is not its direct parent (a component between): React adds a second line.
 */
export function checkNesting(tag: string, a: Ancestors | null, nested: (ancestorTag: string) => boolean) {
  if (!(process.env.NODE_ENV !== "production" && dev())) return;
  const at = a ?? EMPTY;
  const parent = at.current;
  const badParent = validWithParent(tag, parent?.tag, at.implicitRoot) ? null : parent;
  const bad = badParent ?? invalidAncestor(tag, at);
  if (!bad) return;
  const key = `nesting:${!!badParent}|${tag}|${bad.tag}`;
  const shown = `<${tag}>`;
  if (badParent) {
    const tip = bad.tag === "table" && tag === "tr" ? " Add a <tbody>, <thead> or <tfoot> to your code to match the DOM tree generated by the browser." : "";
    warn(`In HTML, ${shown} cannot be a child of <${bad.tag}>.${tip}\nThis will cause a hydration error.`, key);
  } else {
    warn(`In HTML, ${shown} cannot be a descendant of <${bad.tag}>.\nThis will cause a hydration error.`, key);
  }
  if (nested(bad.tag)) warn(`<${bad.tag}> cannot contain a nested ${shown}.\nSee this log for the ancestor stack trace.`, key + "|nested");
}

/** Text placed in `parentTag`: warned about where HTML allows none (a table, a row). */
export function checkTextNesting(text: string, parentTag: string | undefined, implicitRoot: boolean) {
  if (!(process.env.NODE_ENV !== "production" && dev()) || !parentTag || implicitRoot || validWithParent("#text", parentTag, false)) return;
  const key = "nesting:#text|" + parentTag;
  if (/\S/.test(text)) warn(`In HTML, text nodes cannot be a child of <${parentTag}>.\nThis will cause a hydration error.`, key);
  else warn(`In HTML, whitespace text nodes cannot be a child of <${parentTag}>. Make sure you don't have any extra whitespace between tags on each line of your source code.\nThis will cause a hydration error.`, key);
}
