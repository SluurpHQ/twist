// Solid's API as it runs on a server: solid-js's server layer (./server), with the boundaries Twist's renderer draws
// and the marks its JSX pass leaves (Solid-style components, for the React bridge).
import { lazy as layerLazy } from "./server/component.ts";
import { markControlFlow, __twist_mark } from "./server/control.ts";

export * from "./server/index.ts";
export { NoHydration, Hydration, Loading, Errored, Reveal, isHydratable } from "./server.ts";
export { createComponent } from "./server/control.ts";
markControlFlow();

/** A component whose code loads when first rendered: Solid's, marked Solid-style. */
export function lazy(...args: Parameters<typeof layerLazy>): ReturnType<typeof layerLazy> {
  const wrap: any = (layerLazy as any)(...args);
  const marked: any = __twist_mark(wrap);
  for (const k of ["preload", "moduleUrl"]) {
    const d = Object.getOwnPropertyDescriptor(wrap, k);
    if (d) Object.defineProperty(marked, k, d.get ? { ...d, get: () => wrap[k] } : d);
  }
  return marked;
}
