// Tags made in the SVG and MathML namespaces (shared by the runtime and the compiler, which leaves them to the runtime).
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATH_NS = "http://www.w3.org/1998/Math/MathML";
export const SVG_TAGS = new Set(
  "svg,g,path,circle,ellipse,line,polygon,polyline,rect,text,tspan,textPath,defs,use,symbol,marker,mask,pattern,clipPath,linearGradient,radialGradient,stop,filter,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feFlood,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,feSpecularLighting,feTile,feTurbulence,foreignObject,image,switch,desc,metadata,title,animate,animateMotion,animateTransform,set,view".split(","),
);
export const MATH_TAGS = new Set("math,mi,mn,mo,ms,mtext,mrow,msup,msub,mfrac,msqrt,mroot,mtable,mtr,mtd,mspace,munder,mover,munderover,semantics,annotation".split(","));

/**
 * A template: `[tag, static attributes (name, value, …), attributes set at run time, children, mixed]`; a child is
 * text, a template, or 0 (a value given at run time); `mixed` (1) when an attribute set at run time follows a static one.
 * Values come in source order: an element's attributes, then its children.
 */
export type Spec = [string, string[], string[], (string | Spec | 0)[], 1?];

const holed = new WeakMap<Spec, boolean>();
/** Whether a template has values in it, at any depth (each part's answer kept, so a fixed part is not walked). */
export function hasHoles(spec: Spec): boolean {
  let any = holed.get(spec);
  if (any !== undefined) return any;
  any = spec[2].length > 0;
  for (const k of spec[3]) if (k === 0 || (typeof k !== "string" && hasHoles(k))) any = true;
  holed.set(spec, any);
  return any;
}

/** Where a value goes among its siblings, as Solid's compiled code places it. */
export const enum Place {
  /** At the end of its parent (an only child, or the last with no other value beside it). */
  End,
  /** Before a comment of its own (`<!>`): next to text or another value, or last among several values. */
  Comment,
  /** Before the element after it. */
  Before,
}
const placed = new WeakMap<Spec, Place[]>();
/** Each child's place (a value's; fixed children's unused), worked out once per template. */
export function places(spec: Spec): Place[] {
  let out = placed.get(spec);
  if (out) return out;
  const kids = spec[3];
  const values = kids.filter((k) => k === 0).length;
  out = kids.map((k, i) => {
    if (k !== 0 || kids.length === 1) return Place.End;
    const next = kids[i + 1];
    if (next === undefined) return values > 1 ? Place.Comment : Place.End;
    return typeof next === "object" ? Place.Before : Place.Comment;
  });
  placed.set(spec, out);
  return out;
}

/** A template as the JSX it stands for: what hydration and the server build from it. */
export function expand(spec: Spec, values: unknown[], at: { i: number }, jsx: (t: string, p: any) => any, jsxs: (t: string, p: any) => any): any {
  const [tag, fixed, slots, kids] = spec;
  const props: Record<string, any> = {};
  for (let i = 0; i < fixed.length; i += 2) props[fixed[i]!] = fixed[i + 1];
  for (const name of slots) props[name] = values[at.i++];
  const children = kids.map((k) => (k === 0 ? values[at.i++] : typeof k === "string" ? k : expand(k, values, at, jsx, jsxs)));
  if (children.length > 1) return jsxs(tag, ((props.children = children), props));
  if (children.length) props.children = children[0];
  return jsx(tag, props);
}
