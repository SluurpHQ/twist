// Hot reload (development): Solid's refresh runtime, what a compiled module calls. Each component a module declares is
// registered by id; the first module run's registration is kept across edits, and an edit swaps in the new code where
// its signature (or dependencies) changed: every instance of it draws again, its own state starting over, the rest of
// the page as it is. A removed component, or a module that cannot be taken in place, is passed on to its importers.
import { createMemo, createSignal, onCleanup, resetErrorHalt, runWithOwner, untrack } from "./signals.ts";
import { __twist_mark, ownOf } from "./control.ts";

declare const process: { env: Record<string, string | undefined> };

type Component = (props: any) => any;
type Hot = {
  data?: Record<string, any>;
  accept: (cb?: (mod?: unknown) => void) => void;
  dispose?: (cb: (data: Record<string, any>) => void) => void;
  invalidate?: () => void;
  decline?: () => void;
};
/** How the module is hot: Vite's `import.meta.hot`, or webpack's (Rspack's…) `module.hot`. */
type HotType = "vite" | "standard" | "esm" | "webpack5" | "rspack-esm";
export type RegistrationOptions = { signature?: string; dependencies?: () => Record<string, unknown> };
export type Registration = {
  id: string;
  /** The code drawn now. */
  component: Component;
  proxy: Component;
  signature?: string;
  dependencies?: () => Record<string, unknown>;
  /** The instances drawn now. */
  mounted: number;
  /** The code swapped in (`fn` given the code drawn now): every instance draws again. */
  update: (fn: (prev: Component) => Component) => void;
  /** The registration of the first module run it renders through (itself when it is that one). */
  to: Registration;
  read: () => { C: Component };
};
export type Registry = { components: Map<string, Registration> };

const dev = () => process.env.NODE_ENV !== "production";
let warned = false;
function inert() {
  if (!warned) (warned = true), console.warn("Solid Refresh: the hot reload runtime is inert in production builds.");
}

let invalidateWith: ((hot: Hot) => void) | undefined;
/** How a module that cannot be taken in place is passed on (default: the bundler's invalidate, else a reload). */
export function configureRefresh(options: { invalidate?: (hot: Hot) => void }) {
  invalidateWith = options.invalidate;
}
function bail(hot: Hot) {
  if (invalidateWith) invalidateWith(hot);
  else if (hot.invalidate) hot.invalidate();
  else if (hot.decline) hot.decline();
  else globalThis.location?.reload();
}

export function $$registry(): Registry {
  return { components: new Map() };
}

/** Every proxy made, so an edit can tell a module exporting components only. */
const proxies = new WeakSet<Function>();

/** `component` registered as `id`: what the module uses in its place (the component itself in production). */
export function $$component<T extends Component>(registry: Registry, id: string, component: T, options?: RegistrationOptions): T {
  if (!dev()) return component;
  // (Owner-free: module code runs outside any, maybe while hydrating, and takes no hydration id.)
  const [current, set] = runWithOwner(null, () => createSignal({ C: component as Component }, { equals: false, ownedWrite: true }));
  const r: Registration = {
    id,
    get component() {
      return untrack(current).C;
    },
    proxy: undefined!,
    signature: options?.signature,
    dependencies: options?.dependencies,
    mounted: 0,
    update: (fn) => set({ C: fn(untrack(current).C) }),
    to: undefined!,
    read: current,
  };
  r.to = r;
  const label = `<${id}>`;
  r.proxy = __twist_mark(function (props: any) {
    const at = r.to;
    at.mounted++;
    onCleanup(() => at.mounted--);
    // Drawn again when the code changes. Transparent (no id of its own: a page the server drew hydrates) and plumbing
    // (no node of anyone's: its owner path and records are the body's).
    return createMemo(
      () => {
        const { C } = at.read();
        return untrack(() => ownOf(C)(props), label);
      },
      { transparent: true, _plumbing: true } as any,
    );
  }, id);
  Object.defineProperty(r.proxy, "name", { value: id });
  proxies.add(r.proxy);
  registry.components.set(id, r);
  return r.proxy as T;
}

const sameDependencies = (a?: () => Record<string, unknown>, b?: () => Record<string, unknown>) => {
  if (!a || !b) return a === b;
  const x = a();
  const y = b();
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => Object.is(x[k], y[k]));
};

/** The edit `next` taken into `first` (the first run's registry): false when a component it had is gone. */
function patch(first: Registry, next: Registry): boolean {
  if (first === next) return true;
  for (const id of first.components.keys()) if (!next.components.has(id)) return false;
  for (const [id, n] of next.components) {
    const o = first.components.get(id);
    if (!o) {
      first.components.set(id, n);
      continue;
    }
    n.to = o;
    const changed = !n.signature || n.signature !== o.signature || !sameDependencies(o.dependencies, n.dependencies);
    // (Nothing drawn: the new code taken whatever changed, so nothing renders the old closures again.)
    if (!changed && o.mounted) continue;
    const C = n.component as any;
    // (A context: its id kept while a provider of the old one is drawn, so its consumers still find it.)
    if (o.mounted && typeof C.id === "symbol" && typeof (o.component as any).id === "symbol") C.id = (o.component as any).id;
    o.signature = n.signature;
    o.dependencies = n.dependencies;
    // (A system an uncaught error halted runs again: the edit is the fix.)
    resetErrorHalt();
    o.update(() => C);
  }
  return true;
}

/** Whether a module's new exports can be taken in place: components only (any other value its importers hold). */
const componentsOnly = (mod: unknown) => Object.values(mod as object).every((v) => typeof v === "function" && proxies.has(v));

/** The module's registry made hot: its edits taken in place where they can be, else passed on. */
export function $$refresh(type: HotType, hot: Hot, registry: Registry) {
  if (!dev()) return inert();
  if (type === "vite") {
    const data = hot.data!;
    data["solid-refresh"] ??= registry;
    data["solid-refresh-prev"] = registry;
    hot.accept((mod) => {
      if (!mod || !componentsOnly(mod) || !patch(data["solid-refresh"], data["solid-refresh-prev"])) bail(hot);
    });
    return;
  }
  // (webpack's: the old module's registry handed over through `dispose`, the new one patched as it runs.)
  const first: Registry | undefined = hot.data?.["solid-refresh"];
  if (first && !patch(first, registry)) return bail(hot);
  hot.dispose?.((data) => {
    data["solid-refresh"] = first ?? registry;
    data["solid-refresh-prev"] = registry;
  });
  hot.accept();
}

/** A module that cannot be taken in place (`inline`: now; else on its next edit): passed on to its importers. */
export function $$decline(type: HotType, hot: Hot, inline?: boolean) {
  if (!dev()) return inert();
  if (inline) return bail(hot);
  if (type === "vite") hot.accept(() => bail(hot));
  else hot.dispose?.(() => bail(hot)), hot.accept();
}
