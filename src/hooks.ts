// The hooks a component calls: the browser's (state in signals) or, while the server renders, the server's.
import { client } from "./core.ts";

type Hooks = typeof client;
let d: Hooks = client;
export function withHooks<T>(hooks: Hooks, fn: () => T): T {
  const was = d;
  d = hooks;
  try {
    return fn();
  } finally {
    d = was;
  }
}

export const useState: Hooks["useState"] = (init) => d.useState(init);
export const useReducer: Hooks["useReducer"] = (r, a, i) => d.useReducer(r, a, i);
export const useRef: Hooks["useRef"] = (v) => d.useRef(v);
export const useMemo: Hooks["useMemo"] = (fn, deps) => d.useMemo(fn, deps);
export const useCallback: Hooks["useCallback"] = (fn, deps) => d.useCallback(fn, deps);
export const useEffect: Hooks["useEffect"] = (fn, deps) => d.useEffect(fn, deps);
export const useLayoutEffect: Hooks["useLayoutEffect"] = (fn, deps) => d.useLayoutEffect(fn, deps);
export const useInsertionEffect: Hooks["useInsertionEffect"] = (fn, deps) => d.useInsertionEffect(fn, deps);
export const useImperativeHandle: Hooks["useImperativeHandle"] = (r, fn, deps) => d.useImperativeHandle(r, fn, deps);
export const useContext: Hooks["useContext"] = (c) => d.useContext(c);
export const useId: Hooks["useId"] = () => d.useId();
export const useSyncExternalStore = (sub: any, get: any, getServer?: any) => (d === client ? d.useSyncExternalStore(sub, get) : (d as any).useSyncExternalStore(sub, get, getServer));
export const useTransition: Hooks["useTransition"] = () => d.useTransition();
export const useDeferredValue: Hooks["useDeferredValue"] = (v, i) => d.useDeferredValue(v, i);
export const useDebugValue = (_v?: any, _f?: any) => {};
export const useActionState: Hooks["useActionState"] = (a, i) => d.useActionState(a, i);
export const useOptimistic: Hooks["useOptimistic"] = (s, f) => d.useOptimistic(s, f);
export const useEffectEvent: Hooks["useEffectEvent"] = (fn) => d.useEffectEvent(fn);
export const use: Hooks["use"] = (u) => d.use(u);

/** Whether the component rendering now is rendered on the server (renderToString or a stream). */
export const rendersOnServer = () => d !== client;
