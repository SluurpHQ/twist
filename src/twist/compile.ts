// Twist's JSX pass, run before the JSX transform (Bun's): it marks what in the JSX can change, so the runtime binds
// it to the DOM instead of reading it once. The JSX stays JSX; only expressions are wrapped.
//
// - A dynamic expression (one that calls or reads a property) in a child or an attribute: `{__twist_d(() => e)}`.
// - A component's children: one lazy child, `{__twist_c(() => <>…</>)}` (a lone function child is left as it is).
// - A spread: `{...{"$spread$N": () => e}}`, so its getters are read where they are used.
// - `ref={el}` with a bare variable: `ref={__twist_ref(el, (v) => (el = v))}`.
import { parseSync } from "oxc-parser";

type Edit = { start: number; end: number; text: string };
type AnyNode = { type: string; start: number; end: number; [k: string]: any };

const RUNTIME = "@solidjs/web";

/** `source` with its JSX's dynamic parts marked (unchanged if it has no JSX). */
export function compile(source: string, filename = "file.tsx"): string {
  if (!/<[A-Za-z>]/.test(source)) return source;
  const { program, errors } = parseSync(filename, source);
  if (errors.length) return source;
  const edits: Edit[] = [];
  let spreads = 0;
  let used = false;

  const text = (n: AnyNode) => source.slice(n.start, n.end);

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
      if (name === "ref" && v.expression.type === "Identifier") {
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
  if (!edits.length) return source;
  // Applied back to front, nested edits included (an outer wrap re-reads its inner edits' text).
  let out = applyEdits(source, edits);
  if (used) out = `import { __twist_d, __twist_c, __twist_ref } from "${RUNTIME}";\n` + out;
  return out;
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
