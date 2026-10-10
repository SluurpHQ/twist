// The hooks a component calls: the browser's (state in signals) or, while the server renders, the server's.
import { client } from "./core.ts";

type Hooks = typeof client;
// Set while another renderer (the server, a dry run) renders; the browser's otherwise (read late: core imports this).
let d: Hooks | null = null;
const cur = (): Hooks => d ?? client;
export function withHooks<T>(hooks: Hooks, fn: () => T): T {
  const was = d;
  d = hooks;
  try {
    return fn();
  } finally {
    d = was;
  }
}

export const useState: Hooks["useState"] = (init) => cur().useState(init);
export const useReducer: Hooks["useReducer"] = (r, a, i) => cur().useReducer(r, a, i);
export const useRef: Hooks["useRef"] = (v) => cur().useRef(v);
export const useMemo: Hooks["useMemo"] = (fn, deps) => cur().useMemo(fn, deps);
export const useCallback: Hooks["useCallback"] = (fn, deps) => cur().useCallback(fn, deps);
export const useEffect: Hooks["useEffect"] = (fn, deps) => cur().useEffect(fn, deps);
export const useLayoutEffect: Hooks["useLayoutEffect"] = (fn, deps) => cur().useLayoutEffect(fn, deps);
export const useInsertionEffect: Hooks["useInsertionEffect"] = (fn, deps) => cur().useInsertionEffect(fn, deps);
export const useImperativeHandle: Hooks["useImperativeHandle"] = (r, fn, deps) => cur().useImperativeHandle(r, fn, deps);
export const useContext: Hooks["useContext"] = (c) => cur().useContext(c);
/** A context read outside the hook rules (React's dispatcher.readContext: class render methods may call it). */
export const readContext = (c: any) => ((cur() as any).readContext ?? cur().useContext)(c);
export const useId: Hooks["useId"] = () => cur().useId();
export const useSyncExternalStore = (sub: any, get: any, getServer?: any) => (cur() as any).useSyncExternalStore(sub, get, getServer);
export const useTransition: Hooks["useTransition"] = () => cur().useTransition();
export const useDeferredValue: Hooks["useDeferredValue"] = (v, i) => cur().useDeferredValue(v, i);
export const useDebugValue = (_v?: any, _f?: any) => {};
export const useActionState: Hooks["useActionState"] = (a, i) => cur().useActionState(a, i);
export const useOptimistic: Hooks["useOptimistic"] = (s, f) => cur().useOptimistic(s, f);
export const useEffectEvent: Hooks["useEffectEvent"] = (fn) => cur().useEffectEvent(fn);
export const use: Hooks["use"] = (u) => cur().use(u);

/** A transition's dry run (dryrun.ts): not the server, though its hooks are not the browser's either. */
// (`var`: set by dryrun.ts while this module may still be loading, in an import cycle through core.ts.)
var dryHooks: Hooks | null | undefined; // (no initializer: one here would undo what dryrun.ts set first)
export function setDryHooks(hooks: Hooks) {
  dryHooks = hooks;
}

/** Whether the component rendering now is rendered on the server (renderToString or a stream). */
export const rendersOnServer = () => d !== null && d !== client && d !== dryHooks;
