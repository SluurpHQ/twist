// React and Solid-style (Twist) components in one tree, either way round. Installed once by an app that mixes them.
//
// - A React tree meeting a Solid-style component (marked by Twist's compile pass) renders it through TwistHost: a
//   Twist subtree mounted in an element of its own, its props kept current from React's.
// - A Twist tree meeting a React component (shadcn, the kit) mounts it as a React root in an element of its own, its
//   props read live (a change renders it again); Twist children given to it arrive as a React child.
//
// Installed with the app's React (Sluurp's @sluurp/dom, or React itself): `installBridge(React, createRoot)`.
import { createRenderEffect, createRoot, createSignal, flush, onCleanup, untrack } from "./signals.ts";
import { createComponent, isTwist, setForeignComponent } from "./control.ts";
import { insert } from "./web.ts";

/** An element that takes no box of its own: what is mounted in it lays out as its parent's children. */
function box(tag: string) {
  const el = document.createElement(tag);
  el.style.display = "contents";
  return el;
}

// ---------------------------------------------------------------- Solid-style inside React

/** Props as Twist reads them: a getter per key over a signal holding React's latest props. */
function liveProps(read: () => Record<string, any>) {
  return new Proxy({} as Record<string, any>, {
    get: (_t, k) => (k === "children" ? reactChildren(read().children) : read()[k as string]),
    has: (_t, k) => k in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_t, k) => (k in read() ? { enumerable: true, configurable: true, get: () => read()[k as string] } : undefined),
  });
}

/** React children handed to a Solid-style component: mounted as a React subtree where it puts them. */
function reactChildren(children: any) {
  if (children == null || typeof children !== "object" || !("$$typeof" in children || Array.isArray(children))) return children;
  return mountReact(() => children, {});
}

/** React's face of a Solid-style component: an element of its own, the component mounted in it once. */
export function TwistHost({ component, props }: { component: (p: any) => any; props: Record<string, any> }) {
  const ref = useRef<HTMLElement | null>(null);
  const live = useRef<{ set: (p: Record<string, any>) => void; dispose: () => void } | null>(null);
  useLayoutEffect(() => {
    const [read, set] = createSignal(props, { equals: false });
    const dispose = createRoot((d) => {
      insert(ref.current!, () => createComponent(component, liveProps(read)));
      return d;
    });
    flush();
    live.current = { set, dispose };
    return () => {
      dispose();
      live.current = null;
    };
  }, [component]);
  // Later props: written to the signal its props read, applied at once.
  useLayoutEffect(() => {
    if (!live.current) return;
    live.current.set(props);
    flush();
  }, [props]);
  return createElement("sluurp-twist", { ref, style: { display: "contents" } });
}

// ---------------------------------------------------------------- React inside Solid-style

/** A React component in a Twist tree: a React root in an element of its own, rendered again as its props change. */
function mountReact(type: any, props: Record<string, any>) {
  const host = box("sluurp-react");
  const root = createReactRoot(host);
  createRenderEffect(
    () => {
      // Every prop read here (tracked); Twist children become a React child mounting them.
      const p: Record<string, any> = {};
      for (const k of Object.keys(props)) p[k] = k === "children" ? twistChildren(props, k) : props[k];
      return p;
    },
    (p: Record<string, any>) => untrack(() => root.render(createElement(type, p))),
  );
  onCleanup(() => root.unmount());
  return host;
}

/** Twist content handed to a React component as its children: a React element that mounts it, read untracked. */
function twistChildren(props: Record<string, any>, key: string) {
  const content = untrack(() => props[key]);
  if (content == null || typeof content === "string" || typeof content === "number") return content;
  return createElement(TwistContent, { content: () => props[key] });
}

function TwistContent({ content }: { content: () => any }) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dispose = createRoot((d) => {
      insert(ref.current!, content);
      return d;
    });
    flush();
    return dispose;
  }, [content]);
  return createElement("sluurp-twist", { ref, style: { display: "contents" } });
}

// ---------------------------------------------------------------- installed

type ReactApi = { createElement: (...a: any[]) => any; useLayoutEffect: (f: () => any, deps?: any[]) => void; useRef: <T>(v: T) => { current: T } };
let createElement: ReactApi["createElement"];
let useLayoutEffect: ReactApi["useLayoutEffect"];
let useRef: ReactApi["useRef"];
let createReactRoot: (el: Element) => { render(e: any): void; unmount(): void };

/** React and Solid-style components in one tree, from now on: given the app's React and its createRoot. */
export function installBridge(react: ReactApi, createRoot: typeof createReactRoot) {
  ({ createElement, useLayoutEffect, useRef } = react);
  createReactRoot = createRoot;
  (globalThis as any)[Symbol.for("twist.host")] = TwistHost;
  setForeignComponent((type, props) => (isTwist(type) ? createComponent(type, props) : mountReact(type, props)));
}
