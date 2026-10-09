// What a hydration found different from the server's markup, printed as React prints it (its describeDiff): the
// path from the root to each difference, `+` for the client's side and `-` for the server's.
import { ACTIVITY, ELEMENT, LAZY, SUSPENSE, SUSPENSE_LIST } from "./element.ts";

type F = { kind: number; type: any; props: any; parent: F | null; children: F[] };
const TEXT = 1, HOST = 2, COMP = 3, HOIST = 8;
/** A fiber's children, those so far while it is being hydrated. */
const kidsOf = (f: F): F[] => (f as any).building ?? f.children;

/** A server node as the diff shows it: an element's type and attributes as props, a boundary, or text. */
export type ServerNode = string | { type: string; props: Record<string, any> };
/** What one fiber differs by: nothing (undefined), missing on the server (null), the server's text, or its props. */
export type Entry = { serverProps: undefined | null | string | Record<string, any>; tail: ServerNode[] };

/** The differences of one hydration (the root's, or a boundary's), recorded until the first that stops it. */
export class DiffScope {
  entries = new Map<F, Entry>();
  /** Where hydration stopped matching: the fiber the error is told for. */
  at: F | null = null;
  entry(f: F): Entry | null {
    if (this.at) return null;
    let e = this.entries.get(f);
    if (!e) this.entries.set(f, (e = { serverProps: undefined, tail: [] }));
    return e;
  }
  /** A difference that stops hydrating here. */
  stop(f: F): Entry | null {
    const e = this.entry(f);
    if (e) this.at = f.kind === TEXT && f.parent ? f.parent : f;
    return e;
  }
}

type Node_ = { fiber: F; children: Node_[]; serverProps: Entry["serverProps"]; serverTail: ServerNode[]; distanceFromLeaf: number };

function tree(scope: DiffScope): Node_ | null {
  let root: Node_ | null = null;
  const build = (f: F, distance: number): Node_ => {
    if (!f.parent) {
      if (!root) root = { fiber: f, children: [], serverProps: undefined, serverTail: [], distanceFromLeaf: distance };
      else if (root.distanceFromLeaf > distance) root.distanceFromLeaf = distance;
      return root;
    }
    const siblings = build(f.parent, distance + 1).children;
    const last = siblings[siblings.length - 1];
    if (last?.fiber === f) {
      if (last.distanceFromLeaf > distance) last.distanceFromLeaf = distance;
      return last;
    }
    const n: Node_ = { fiber: f, children: [], serverProps: undefined, serverTail: [], distanceFromLeaf: distance };
    siblings.push(n);
    return n;
  };
  for (const [f, e] of scope.entries) {
    const n = build(f, 0);
    n.serverProps = e.serverProps;
    n.serverTail.push(...e.tail);
  }
  // In the fibers' order, as they are printed.
  const order = (n: Node_) => {
    const at = new Map(kidsOf(n.fiber).map((c, i) => [c, i]));
    n.children.sort((a, b) => (at.get(a.fiber) ?? Infinity) - (at.get(b.fiber) ?? Infinity));
    n.children.forEach(order);
  };
  if (root) order(root);
  return root;
}

/** The diff as React appends it to its hydration error ("\n\n" and the tree), or "" when nothing was recorded. */
export function describeDiff(scope: DiffScope): string {
  const root = tree(scope);
  if (!root) return "";
  try {
    return "\n\n" + describeNode(root, 0);
  } catch {
    return "";
  }
}

/** The fiber an attribute-only diff is told for: the first difference's, down the first children. */
export function firstDiffFiber(scope: DiffScope): F | null {
  let n = tree(scope);
  while (n && n.children.length) n = n.children[0]!;
  return n?.fiber ?? null;
}

/** A server node described for the diff (React's describeHydratableInstanceForDevWarnings). */
export function describeServerNode(n: Node): ServerNode {
  if (n.nodeType === 1) {
    const el = n as Element;
    const props: Record<string, any> = {};
    for (const a of Array.from(el.attributes)) props[propName(a.name)] = a.name.toLowerCase() === "style" ? styleObject(el) : a.value;
    return { type: el.nodeName.toLowerCase(), props };
  }
  if (n.nodeType === 8) return { type: (n as Comment).data === "&" ? "Activity" : "Suspense", props: {} };
  return n.nodeValue ?? "";
}
export const propName = (attr: string) => (attr === "class" ? "className" : attr === "for" ? "htmlFor" : attr);
export function styleObject(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const style = (el as HTMLElement).style;
  for (let i = 0; i < style.length; i++) out[style[i]!] = style.getPropertyValue(style[i]!);
  return out;
}

// ---------------------------------------------------------------- React's printer

const needsEscaping = /["'&<>\n\t]|^\s|\s$/;
const indentation = (i: number) => "  " + "  ".repeat(i);
const added = (i: number) => "+ " + "  ".repeat(i);
const removed = (i: number) => "- " + "  ".repeat(i);

function findNotableNode(node: Node_, indent: number): Node_ {
  return node.serverProps === undefined && node.serverTail.length === 0 && node.children.length === 1 && node.distanceFromLeaf > 3 && node.distanceFromLeaf > 15 - indent
    ? findNotableNode(node.children[0]!, indent)
    : node;
}

const nameOf = (t: any) => (t ? t.displayName || t.name || null : null);
function describeFiberType(f: F): string | null {
  if (f.kind === HOST || f.kind === HOIST) return f.type;
  if (f.kind !== COMP) return null;
  const t = f.type;
  if (t === SUSPENSE) return "Suspense";
  if (t === ACTIVITY) return "Activity";
  if (t === SUSPENSE_LIST) return "SuspenseList";
  if (t?.$$typeof === LAZY) return "Lazy";
  if (typeof t === "function") return nameOf(t);
  if (t && typeof t === "object") return nameOf(t.render) ?? nameOf(t.type) ?? t.displayName ?? null;
  return null;
}

function describeTextNode(content: string, maxLength: number): string {
  if (needsEscaping.test(content)) {
    const s = JSON.stringify(content);
    return s.length > maxLength - 2 ? (maxLength < 8 ? '{"..."}' : "{" + s.slice(0, maxLength - 7) + '..."}') : "{" + s + "}";
  }
  return content.length > maxLength ? (maxLength < 5 ? '{"..."}' : content.slice(0, maxLength - 3) + "...") : content;
}

function describeTextDiff(clientText: string, serverProps: any, indent: number): string {
  const maxLength = 120 - 2 * indent;
  if (serverProps === null) return added(indent) + describeTextNode(clientText, maxLength) + "\n";
  if (typeof serverProps === "string") {
    let firstDiff = 0;
    while (firstDiff < serverProps.length && firstDiff < clientText.length && serverProps.charCodeAt(firstDiff) === clientText.charCodeAt(firstDiff)) firstDiff++;
    if (firstDiff > maxLength - 8 && firstDiff > 10) {
      clientText = "..." + clientText.slice(firstDiff - 8);
      serverProps = "..." + serverProps.slice(firstDiff - 8);
    }
    return added(indent) + describeTextNode(clientText, maxLength) + "\n" + removed(indent) + describeTextNode(serverProps, maxLength) + "\n";
  }
  return indentation(indent) + describeTextNode(clientText, maxLength) + "\n";
}

const objectName = (o: any) => Object.prototype.toString.call(o).replace(/^\[object (.*)\]$/, (_m, p0) => p0);
const elementName = (t: any): string | null => (typeof t === "string" ? t : typeof t === "function" ? nameOf(t) : t === SUSPENSE ? "Suspense" : null);

function describeValue(value: any, maxLength: number): string {
  switch (typeof value) {
    case "string": {
      const s = JSON.stringify(value);
      return s.length > maxLength ? (maxLength < 5 ? '"..."' : s.slice(0, maxLength - 4) + '..."') : s;
    }
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value)) return "[...]";
      if (value.$$typeof === ELEMENT) {
        const n = elementName(value.type);
        return n ? "<" + n + ">" : "<...>";
      }
      let name = objectName(value);
      if (name !== "Object") return name;
      name = "";
      maxLength -= 2;
      for (let k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        const json = JSON.stringify(k);
        if (json !== '"' + k + '"') k = json;
        maxLength -= k.length - 2;
        const v = describeValue(value[k], maxLength < 15 ? maxLength : 15);
        maxLength -= v.length;
        if (maxLength < 0) {
          name += name === "" ? "..." : ", ...";
          break;
        }
        name += (name === "" ? "" : ",") + k + ":" + v;
      }
      return "{" + name + "}";
    }
    case "function": {
      const n = value.displayName || value.name;
      return n ? "function " + n : "function";
    }
    default:
      return String(value);
  }
}

function describePropValue(value: any, maxLength: number): string {
  if (typeof value !== "string" || needsEscaping.test(value)) return "{" + describeValue(value, maxLength - 2) + "}";
  return value.length > maxLength - 2 ? (maxLength < 5 ? '"..."' : '"' + value.slice(0, maxLength - 5) + '..."') : '"' + value + '"';
}

function describeExpandedElement(type: string, props: any, rowPrefix: string): string {
  let remaining = 120 - rowPrefix.length - type.length;
  const properties: string[] = [];
  for (const k in props) {
    if (!Object.prototype.hasOwnProperty.call(props, k) || k === "children") continue;
    const v = describePropValue(props[k], 120 - rowPrefix.length - k.length - 1);
    remaining -= k.length + v.length + 2;
    properties.push(k + "=" + v);
  }
  if (properties.length === 0) return rowPrefix + "<" + type + ">\n";
  if (remaining > 0) return rowPrefix + "<" + type + " " + properties.join(" ") + ">\n";
  return rowPrefix + "<" + type + "\n" + rowPrefix + "  " + properties.join("\n" + rowPrefix + "  ") + "\n" + rowPrefix + ">\n";
}

function describePropertiesDiff(client: any, server: any, indent: number): string {
  let out = "";
  const rest = { ...server };
  for (const k in client) {
    if (!Object.prototype.hasOwnProperty.call(client, k)) continue;
    delete rest[k];
    const max = 120 - 2 * indent - k.length - 2;
    const c = describeValue(client[k], max);
    if (Object.prototype.hasOwnProperty.call(server, k)) out += added(indent) + k + ": " + c + "\n" + removed(indent) + k + ": " + describeValue(server[k], max) + "\n";
    else out += added(indent) + k + ": " + c + "\n";
  }
  for (const k in rest) if (Object.prototype.hasOwnProperty.call(rest, k)) out += removed(indent) + k + ": " + describeValue(rest[k], 120 - 2 * indent - k.length - 2) + "\n";
  return out;
}

const isText = (v: any) => typeof v === "string" || typeof v === "number" || typeof v === "bigint";

function describeElementDiff(type: string, clientProps: any, serverProps: any, indent: number): string {
  let content = "";
  const serverNames = new Map<string, string>();
  for (const k in serverProps) if (Object.prototype.hasOwnProperty.call(serverProps, k)) serverNames.set(k.toLowerCase(), k);
  if (serverNames.size === 1 && serverNames.has("children")) content += describeExpandedElement(type, clientProps, indentation(indent));
  else {
    for (const k in clientProps) {
      if (!Object.prototype.hasOwnProperty.call(clientProps, k) || k === "children") continue;
      const max = 120 - 2 * (indent + 1) - k.length - 1;
      const serverName = serverNames.get(k.toLowerCase());
      if (serverName !== undefined) {
        serverNames.delete(k.toLowerCase());
        const c = clientProps[k];
        const s = serverProps[serverName];
        const cv = describePropValue(c, max);
        const sv = describePropValue(s, max);
        if (
          typeof c === "object" && c !== null && typeof s === "object" && s !== null && objectName(c) === "Object" && objectName(s) === "Object" &&
          (Object.keys(c).length > 2 || Object.keys(s).length > 2 || cv.includes("...") || sv.includes("..."))
        )
          content += indentation(indent + 1) + k + "={{\n" + describePropertiesDiff(c, s, indent + 2) + indentation(indent + 1) + "}}\n";
        else content += added(indent + 1) + k + "=" + cv + "\n" + removed(indent + 1) + k + "=" + sv + "\n";
      } else content += indentation(indent + 1) + k + "=" + describePropValue(clientProps[k], max) + "\n";
    }
    serverNames.forEach((k) => {
      if (k !== "children") content += removed(indent + 1) + k + "=" + describePropValue(serverProps[k], 120 - 2 * (indent + 1) - k.length - 1) + "\n";
    });
    content = content === "" ? indentation(indent) + "<" + type + ">\n" : indentation(indent) + "<" + type + "\n" + content + indentation(indent) + ">\n";
  }
  const sc = serverProps.children;
  const cc = clientProps.children;
  if (isText(sc)) content += describeTextDiff(isText(cc) ? "" + cc : "", "" + sc, indent + 1);
  else if (isText(cc)) content += describeTextDiff("" + cc, sc == null ? null : undefined, indent + 1);
  return content;
}

function describeSiblingFiber(f: F, indent: number): string {
  const type = describeFiberType(f);
  if (type === null) return kidsOf(f).map((c) => describeSiblingFiber(c, indent)).join("");
  return indentation(indent) + "<" + type + ">\n";
}

function describeNode(node: Node_, indent: number): string {
  const skipTo = findNotableNode(node, indent);
  if (skipTo !== node && (node.children.length !== 1 || node.children[0] !== skipTo)) return indentation(indent) + "...\n" + describeNode(skipTo, indent + 1);
  let self = "";
  const props = node.fiber.props;
  if (node.fiber.kind === TEXT) {
    self = describeTextDiff("" + props, node.serverProps, indent);
    indent++;
  } else {
    const name = describeFiberType(node.fiber);
    if (name !== null) {
      if (node.serverProps === undefined) {
        let max = 120 - 2 * indent - name.length - 2;
        let content = "";
        for (const k in props) {
          if (!Object.prototype.hasOwnProperty.call(props, k) || k === "children") continue;
          const v = describePropValue(props[k], 15);
          max -= k.length + v.length + 2;
          if (max < 0) {
            content += " ...";
            break;
          }
          content += " " + k + "=" + v;
        }
        self = indentation(indent) + "<" + name + content + ">\n";
      } else if (node.serverProps === null) self = describeExpandedElement(name, props, added(indent));
      else if (typeof node.serverProps !== "string") self = describeElementDiff(name, props, node.serverProps, indent);
      indent++;
    }
  }
  let kids = "";
  let i = 0;
  let c = 0;
  const fibers = kidsOf(node.fiber);
  for (; c < fibers.length && i < node.children.length; c++) {
    const child = node.children[i]!;
    if (child.fiber === fibers[c]) (kids += describeNode(child, indent)), i++;
    else kids += describeSiblingFiber(fibers[c]!, indent);
  }
  // One being mounted now: not among its parent's children yet.
  for (; i < node.children.length; i++) kids += describeNode(node.children[i]!, indent);
  if (c < fibers.length && node.children.length > 0) kids += indentation(indent) + "...\n";
  if (node.serverProps === null) indent--;
  for (const s of node.serverTail) kids += typeof s === "string" ? removed(indent) + describeTextNode(s, 120 - 2 * indent) + "\n" : describeExpandedElement(s.type, s.props, removed(indent));
  return self + kids;
}
