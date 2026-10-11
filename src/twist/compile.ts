// Twist's JSX pass, run before the JSX transform (Bun's): it marks what in the JSX can change, so the runtime binds
// it to the DOM instead of reading it once. The JSX stays JSX; only expressions are wrapped.
//
// - A dynamic expression (one that calls or reads a property) in a child or an attribute: `{__twist_d(() => e)}`.
// - A component's children: one lazy child, `{__twist_c(() => <>…</>)}` (a lone function child is left as it is).
// - A spread: `{...{"$spread$N": () => e}}`, so its getters are read where they are used.
// - `ref={el}` with a bare variable: `ref={__twist_ref(el, (v) => (el = v))}`.
import { parseSync } from "oxc-parser";
import { MATH_TAGS, SVG_TAGS, type Spec } from "./tags.ts";

type Edit = { start: number; end: number; text: string };
type AnyNode = { type: string; start: number; end: number; [k: string]: any };

const RUNTIME = "@solidjs/web";

/**
 * `source` with its JSX's dynamic parts marked (unchanged if it has no JSX). `hot`: each component's mark also names
 * it (hot reload keeps one component per name across edits).
 */
export function compile(source: string, filename = "file.tsx", options: { hot?: boolean } = {}): string {
  const named = (name: string) => (options.hot ? `, ${JSON.stringify(name)}` : "");
  if (!/<[A-Za-z>]/.test(source)) return source;
  const { program, errors } = parseSync(filename, source);
  if (errors.length) throw new SyntaxError(`${filename}: ${errors.map((e) => e.message).join("; ")}`);
  const edits: Edit[] = [];
  let spreads = 0;
  let used = false;

  const text = (n: AnyNode) => source.slice(n.start, n.end);

  /** Names a `ref` may assign to: declared with let or var (a const, a function or an import is only called). */
  const assignable = new Set<string>();
  const collect = (n: AnyNode | null | undefined) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "VariableDeclaration" && n.kind !== "const") for (const d of n.declarations) names(d.id);
    for (const k in n) {
      if (k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) for (const x of v) x && typeof x === "object" && "type" in x && collect(x);
      else if (v && typeof v === "object" && "type" in v) collect(v);
    }
  };
  const names = (id: AnyNode | null) => {
    if (!id) return;
    if (id.type === "Identifier") assignable.add(id.name);
    else if (id.type === "ObjectPattern") for (const pr of id.properties) names(pr.type === "RestElement" ? pr.argument : pr.value);
    else if (id.type === "ArrayPattern") for (const e of id.elements) names(e && (e.type === "RestElement" ? e.argument : e));
    else if (id.type === "AssignmentPattern") names(id.left);
  };
  collect(program as unknown as AnyNode);

  /** Whether an expression can change: it calls something or reads a property (functions and JSX aside). */
  const dynamic = (n: AnyNode | null | undefined): boolean => {
    if (!n || typeof n !== "object") return false;
    switch (n.type) {
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "Literal":
      case "Identifier":
      case "JSXElement":
      case "JSXFragment":
        return false;
      case "CallExpression":
      case "MemberExpression":
      case "TaggedTemplateExpression":
      case "NewExpression":
      case "ChainExpression":
        return true;
    }
    for (const k in n) {
      if (k === "start" || k === "end" || k === "type") continue;
      const v = n[k];
      if (Array.isArray(v)) {
        for (const x of v) if (x && typeof x === "object" && "type" in x && (dynamicInside(x) || dynamic(x))) return true;
      } else if (v && typeof v === "object" && "type" in v && dynamic(v)) return true;
    }
    return false;
  };
  // JSX inside an expression (`cond() && <a/>`) is static itself, but what decides it may not be.
  const dynamicInside = (_n: AnyNode) => false;

  const isComponent = (name: AnyNode) =>
    name.type === "JSXMemberExpression" || (name.type === "JSXIdentifier" && /^[A-Z_$]/.test(name.name)) || name.type === "JSXNamespacedName" && false;

  const wrap = (container: AnyNode, fn: string) => {
    used = true;
    const e = container.expression;
    edits.push({ start: e.start, end: e.end, text: `${fn}(() => (${text(e)}))` });
  };

  const visitElement = (el: AnyNode) => {
    const open = el.openingElement;
    const component = isComponent(open.name);
    for (const a of open.attributes) {
      if (a.type === "JSXSpreadAttribute") {
        used = true;
        edits.push({ start: a.start, end: a.end, text: `{...{"$spread$${spreads++}": () => (${text(a.argument)})}}` });
        continue;
      }
      const v = a.value;
      if (!v || v.type !== "JSXExpressionContainer" || v.expression.type === "JSXEmptyExpression") {
        if (v && (v.type === "JSXElement" || v.type === "JSXFragment")) visit(v);
        continue;
      }
      const name = a.name.type === "JSXIdentifier" ? a.name.name : "";
      if (name === "ref" && v.expression.type === "Identifier" && assignable.has(v.expression.name)) {
        used = true;
        const id = text(v.expression);
        edits.push({ start: v.expression.start, end: v.expression.end, text: `__twist_ref(${id}, (v) => (${id} = v))` });
        continue;
      }
      visit(v.expression);
      // An event handler is read when the event comes; a ref is called once.
      if (dynamic(v.expression) && name !== "ref" && !/^on[A-Z]/.test(name)) wrap(v, "__twist_d");
    }
    const kids = el.children.filter((c: AnyNode) => !(c.type === "JSXText" && !c.value.trim()) && !(c.type === "JSXExpressionContainer" && c.expression.type === "JSXEmptyExpression"));
    for (const c of el.children) visitChild(c, component);
    if (component && kids.length) {
      const lone = kids.length === 1 ? kids[0] : null;
      const loneFn = lone?.type === "JSXExpressionContainer" && (lone.expression.type === "ArrowFunctionExpression" || lone.expression.type === "FunctionExpression");
      if (!loneFn) {
        // All children as one lazy child: built when the component reads them.
        used = true;
        const first = el.children[0]!;
        const last = el.children[el.children.length - 1]!;
        edits.push({ start: first.start, end: first.start, text: `{__twist_c(() => <>` });
        edits.push({ start: last.end, end: last.end, text: `</>)}` });
      }
    }
  };

  const visitChild = (c: AnyNode, inComponent: boolean) => {
    if (c.type === "JSXElement") return visitElement(c);
    if (c.type === "JSXFragment") return visitFragment(c, inComponent);
    if (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression") {
      visit(c.expression);
      if (dynamic(c.expression)) wrap(c, "__twist_d");
    }
  };

  const visitFragment = (f: AnyNode, inComponent = false) => {
    for (const c of f.children) visitChild(c, inComponent);
  };

  /** Every JSX element in a subtree, outermost first. */
  const visit = (n: AnyNode | null | undefined) => {
    if (!n || typeof n !== "object") return;
    // JSX as a statement runs for what it does (a component that renders, say): kept, though its value is unused
    // (the JSX transform marks its call pure, and a bundler drops pure calls nobody reads).
    if (n.type === "ExpressionStatement" && (n.expression.type === "JSXElement" || n.expression.type === "JSXFragment")) {
      used = true;
      edits.push({ start: n.expression.start, end: n.expression.start, text: "__twist_k(" });
      edits.push({ start: n.expression.end, end: n.expression.end, text: ")" });
    }
    if (n.type === "JSXElement") return visitElement(n);
    if (n.type === "JSXFragment") return visitFragment(n);
    for (const k in n) {
      if (k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) for (const x of v) x && typeof x === "object" && "type" in x && visit(x);
      else if (v && typeof v === "object" && "type" in v) visit(v);
    }
  };

  visit(program as unknown as AnyNode);
  // The components this file declares are Solid-style: marked where declared (any React, ours or React itself, then
  // mounts them as such; an `export default X` below sees the marked one).
  let marks = 0;
  for (const top of (program as any).body as AnyNode[]) {
    let s = top;
    if ((s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") && s.declaration) s = s.declaration;
    if (s.type === "FunctionDeclaration" && s.id && /^[A-Z]/.test(s.id.name)) {
      edits.push({ start: top.end, end: top.end, text: `\n${s.id.name} = __twist_mark(${s.id.name}${named(s.id.name)});` });
      marks++;
    } else if (s.type === "VariableDeclaration")
      for (const d of s.declarations)
        if (d.id?.type === "Identifier" && /^[A-Z]/.test(d.id.name) && /FunctionExpression$/.test(d.init?.type ?? "")) {
          edits.push({ start: d.init.start, end: d.init.end, text: `__twist_mark(${text(d.init)}${named(d.id.name)})` });
          marks++;
        }
  }
  // Applied back to front, nested edits included (an outer wrap re-reads its inner edits' text).
  let out = edits.length ? applyEdits(source, edits) : source;
  if (used || marks) out = `import { __twist_d, __twist_c, __twist_ref, __twist_k, __twist_mark } from "${RUNTIME}";\n` + out;
  return templates(out, filename);
}

// ---------------------------------------------------------------- templates

/** Attributes a template may hold as written: plain lowercase names (state kept as properties, and style, set at run time). */
const FIXED_ATTR = /^[a-z][a-z0-9-]*$/;
const RUNTIME_ATTRS = new Set(["style", "value", "checked", "selected", "muted", "ref", "key"]);
const LIVE_CHILDREN = new Set(["select", "option", "optgroup"]);

/**
 * Host elements whose markup is fixed, as templates (`__twist_t`): made once and copied, each value set where it goes.
 * The rest of the JSX is left as it is. Runs on the marked source (what can change is wrapped already).
 */
function templates(source: string, filename: string): string {
  if (!/<[a-z]/.test(source)) return source;
  const { program, errors } = parseSync(filename, source);
  if (errors.length) return source;
  const specs: string[] = [];
  const text = (n: AnyNode) => rewrite(n.start, n.end, n);

  const tagOf = (el: AnyNode) => (el.openingElement.name.type === "JSXIdentifier" ? (el.openingElement.name.name as string) : "");
  const isHost = (el: AnyNode) => /^[a-z][a-z0-9]*$/.test(tagOf(el)) && !SVG_TAGS.has(tagOf(el)) && !MATH_TAGS.has(tagOf(el));
  // (A select's options are set before they join it, as the runtime does: left to it.)
  const templatable = (el: AnyNode) =>
    isHost(el) &&
    !LIVE_CHILDREN.has(tagOf(el)) &&
    el.openingElement.attributes.every((a: AnyNode) => a.type === "JSXAttribute" && (a.value?.type !== "Literal" || attrText(a.value) !== null));
  /** A string attribute as JSX reads it (entities decoded; null for one this pass does not know). */
  const attrText = (v: AnyNode) => decodeEntities(source.slice(v.start + 1, v.end - 1));

  /** `[start, end)` of the source, each outermost templatable element in `node` made a template. */
  function rewrite(start: number, end: number, node: AnyNode): string {
    const edits: Edit[] = [];
    const walk = (n: AnyNode, inJsx = false) => {
      if (!n || typeof n !== "object") return;
      if (n.type === "JSXElement") {
        // (A child or an attribute value in JSX: the call in braces.)
        if (templatable(n)) return void edits.push({ start: n.start, end: n.end, text: inJsx ? `{${template(n)}}` : template(n) });
        // SVG and MathML: left to the runtime, as they are.
        if (/^[a-z]/.test(tagOf(n)) && !isHost(n)) return;
      }
      const jsx = n.type === "JSXElement" || n.type === "JSXFragment" || n.type === "JSXAttribute";
      for (const k in n) {
        if (k === "start" || k === "end") continue;
        const v = n[k];
        if (Array.isArray(v)) for (const x of v) x && typeof x === "object" && "type" in x && walk(x, jsx);
        else if (v && typeof v === "object" && "type" in v) walk(v, jsx);
      }
    };
    walk(node);
    let out = "";
    let at = start;
    for (const e of edits) (out += source.slice(at, e.start) + e.text), (at = e.end);
    return out + source.slice(at, end);
  }

  /** An element as a template's call: its spec once at the top, its values in source order. */
  function template(el: AnyNode): string {
    const values: string[] = [];
    const spec = specOf(el, values);
    specs.push(`const _tmpl$${specs.length} = /*@__PURE__*/ __twist_t(${JSON.stringify(spec)});`);
    return `_tmpl$${specs.length - 1}([${values.join(", ")}])`;
  }

  function specOf(el: AnyNode, values: string[]): Spec {
    const fixed: string[] = [];
    const slots: string[] = [];
    for (const a of el.openingElement.attributes as AnyNode[]) {
      const name = a.name.type === "JSXIdentifier" ? (a.name.name as string) : source.slice(a.name.start, a.name.end);
      if (name === "key") continue;
      const v = a.value;
      if (v?.type === "Literal" && FIXED_ATTR.test(name) && !RUNTIME_ATTRS.has(name)) {
        fixed.push(name, attrText(v)!);
        continue;
      }
      slots.push(name);
      values.push(!v ? "true" : v.type === "JSXExpressionContainer" ? text(v.expression) : v.type === "Literal" ? JSON.stringify(attrText(v)) : text(v));
    }
    const kids: (string | Spec | 0)[] = [];
    for (const c of el.children as AnyNode[]) {
      if (c.type === "JSXText") {
        const t = jsxText(c.value);
        // An entity this pass does not know: the JSX transform decodes it.
        if (t === null) kids.push(0), values.push(`<>${c.value}</>`);
        else if (t) kids.push(t);
      } else if (c.type === "JSXExpressionContainer") {
        if (c.expression.type === "JSXEmptyExpression") continue;
        kids.push(0), values.push(text(c.expression));
      } else if (c.type === "JSXElement" && templatable(c)) kids.push(specOf(c, values));
      else kids.push(0), values.push(text(c));
    }
    return [tagOf(el), fixed, slots, kids];
  }

  const body = rewrite(0, source.length, program as unknown as AnyNode);
  if (!specs.length) return source;
  return `import { __twist_t } from "${RUNTIME}";\n${specs.join("\n")}\n${body}`;
}

/** JSX text as the JSX transform reads it: lines trimmed where they break, blank lines gone, the rest joined by a space. */
function jsxText(raw: string): string | null {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i]!)) last = i;
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.replace(/\t/g, " ");
    if (i !== 0) line = line.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, "");
    if (!line) continue;
    if (i !== last) line += " ";
    out += line;
  }
  return decodeEntities(out);
}
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** HTML entities in JSX text, as the JSX transform decodes them (null for a named one not listed here). */
function decodeEntities(s: string): string | null {
  let unknown = false;
  const out = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1));
    if (e in ENTITIES) return ENTITIES[e]!;
    unknown = true;
    return m;
  });
  return unknown ? null : out;
}

/** Edits applied to `source`; an edit spanning others takes their results into its text. */
function applyEdits(source: string, edits: Edit[]): string {
  // Insertions at the same place keep their order; wraps (start < end) contain the edits inside them.
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.start - b.start || b.end - a.end || a.i - b.i);
  const build = (from: number, to: number, list: typeof sorted): string => {
    let out = "";
    let at = from;
    for (let k = 0; k < list.length; k++) {
      const e = list[k]!;
      if (e.start < at) continue;
      out += source.slice(at, e.start);
      if (e.start === e.end) {
        out += e.text;
        at = e.start;
        continue;
      }
      // Inner edits of this one, rebuilt into the text it wraps.
      const inner = list.filter((x) => x !== e && x.start >= e.start && x.end <= e.end && !(x.start === e.start && x.end === e.end && x.i < e.i));
      const body = build(e.start, e.end, inner);
      out += e.text.replace(source.slice(e.start, e.end), () => body);
      at = e.end;
      while (k + 1 < list.length && list[k + 1]!.start < e.end) k++;
    }
    return out + source.slice(at, to);
  };
  return build(0, source.length, sorted);
}
