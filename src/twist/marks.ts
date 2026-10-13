// The marks Twist's JSX pass leaves for the runtime, and the bridge's hooks on components: no reactive core here, so
// the browser's runtime and the server's share them.

const DYNAMIC = Symbol("twist.dynamic");
const CHILDREN = Symbol("twist.children");

/**
 * A component written Solid-style (it runs once): marked, so a React tree that meets it mounts it as a Twist subtree,
 * and Twist calls it directly (an unmarked component is React's: Twist mounts it as a React subtree, when the bridge is
 * there). Twist's compile pass marks what a Solid-style file declares.
 */
export const TWIST = Symbol.for("twist.component");
/** How React draws a Solid-style component it calls (installed by the bridge, with its host). */
let reactHost: ((component: any, props: any) => any) | null = null;
export const setReactHost = (fn: typeof reactHost) => void (reactHost = fn);

/**
 * A Solid-style component, marked; returned as one any React can call: React gets the bridge's host for it, Twist the
 * component itself (the mark holds it).
 */
export function __twist_mark<T>(f: T, name?: string): T {
  if (typeof f !== "function") return f;
  const own = f as any;
  // (A component declared as `const X = () => …`: the name the wrapping took from it.)
  if (name && !own.name) Object.defineProperty(own, "name", { value: name });
  own[TWIST] = true;
  // (Called as a plain function — a marked helper taking several arguments — it gets them all.)
  const asReact = (props: any, ...rest: any[]) => (reactHost ? reactHost(own, props) : own(props, ...rest));
  Object.defineProperty(asReact, "name", { value: own.name });
  (asReact as any)[TWIST] = own;
  return asReact as T;
}
export const isTwist = (f: any) => typeof f === "function" && !!f[TWIST];
/** The Solid-style component itself, for a marked one React calls. */
export const ownOf = (f: any) => (typeof f?.[TWIST] === "function" ? f[TWIST] : f);

/** How a React component is mounted inside a Twist tree (installed by the bridge; none, and it is called as is). */
export let foreign: ((type: any, props: any) => any) | null = null;
export const setForeignComponent = (fn: typeof foreign) => void (foreign = fn);

/** A part that can change: read where it is used (bound to its node, or a prop getter). */
export const __twist_d = <T>(fn: () => T) => (((fn as any)[DYNAMIC] = true), fn);
/** A component's children: built when the component reads them. */
export const __twist_c = <T>(fn: () => T) => (((fn as any)[CHILDREN] = true), fn);
/** JSX used as a statement: its value passed through, so the call is kept. */
export const __twist_k = <T>(v: T) => v;
/** `ref={el}` with a bare variable: called when it is a function, else assigned. */
export const __twist_ref = (current: unknown, assign: (el: unknown) => void) => (typeof current === "function" ? current : assign);

export const isDynamic = (v: any): v is () => any => typeof v === "function" && v[DYNAMIC] === true;
export const isChildren = (v: any): v is () => any => typeof v === "function" && v[CHILDREN] === true;

/** Twist's own components (control flow, boundaries): their bodies read what they need, as Solid's computations do. */
export const builtins = new WeakSet<Function>();
export const markBuiltin = (...fs: Function[]) => fs.forEach((f) => builtins.add(f));
/** A built-in component, marked as one where it is defined (a pure call: unused, it is dropped). */
export const builtin = <F extends Function>(f: F): F => (__twist_mark(f), markBuiltin(f), f);
