// `react-redux` on signals: a store's state is one signal (one subscription per store), and each useSelector a
// computed over it with the selector's equality, so a component re-renders only when what it selects changes, and
// a dispatch recomputes only selections whose inputs changed. Redux itself (the store, reducers, middleware) is
// whatever the app uses; only the binding to components is ours.
import { computed, signal } from "../../signals/index.js";
import { createElement, forwardRef as forwardRefOf } from "./element.ts";
import { createContext } from "./element.ts";
import { useContext, useMemo, useRef } from "./hooks.ts";

type Store = { getState(): any; dispatch(action: any): any; subscribe(fn: () => void): () => void };
type Equality = (a: any, b: any) => boolean;

export const ReactReduxContext: any = createContext<{ store: Store } | null>(null);

/** The store's state as a signal: one subscription however many components read it. */
const states = new WeakMap<Store, { (): any; set(v: any): void; peek(): any }>();
function stateOf(store: Store) {
  let s = states.get(store);
  if (!s) {
    const sig = signal(store.getState());
    store.subscribe(() => sig.set(store.getState()));
    states.set(store, (s = sig as any));
  }
  return s!;
}

/** What react-redux's context holds besides the store: a subscription libraries reach for (Recharts subscribes
 * through it), here going straight to the store. */
function subscriptionOf(store: Store) {
  const subs = new Set<() => void>();
  return {
    addNestedSub: (listener: () => void) => store.subscribe(listener),
    notifyNestedSubs: () => subs.forEach((f) => f()),
    handleChangeWrapper: () => {},
    isSubscribed: () => true,
    trySubscribe: () => {},
    tryUnsubscribe: () => {},
    getListeners: () => ({ get: () => [...subs] }),
  };
}

export function Provider({ store, context, children, serverState }: { store: Store; context?: any; children?: any; serverState?: any }) {
  const value = useMemo(
    () => ({ store, subscription: subscriptionOf(store), getServerState: serverState ? () => serverState : undefined, stabilityCheck: "once", identityFunctionCheck: "once" }),
    [store, serverState],
  );
  return createElement(context ?? ReactReduxContext, { value }, children);
}

const missing = () => {
  throw new Error("could not find react-redux context value; please ensure the component is wrapped in a <Provider>");
};

export function createStoreHook(context: any = ReactReduxContext) {
  return function useStore(): Store {
    const v = useContext(context) as { store: Store } | null;
    if (!v) missing();
    return v!.store;
  };
}

export function createDispatchHook(context: any = ReactReduxContext) {
  const useStoreHere = createStoreHook(context);
  return function useDispatch() {
    return useStoreHere().dispatch;
  };
}

export function createSelectorHook(context: any = ReactReduxContext) {
  const useStoreHere = createStoreHook(context);
  return function useSelector<T>(selector: (state: any) => T, options?: Equality | { equalityFn?: Equality }): T {
    const store = useStoreHere();
    const equals = (typeof options === "function" ? options : options?.equalityFn) ?? Object.is;
    // The newest selector, read by the computed (an inline selector is a new function every render).
    const latest = useRef(selector);
    latest.current = selector;
    const selection = useMemo(() => {
      const state = stateOf(store);
      return computed(() => latest.current(state()), { equals });
    }, [store, equals]);
    return selection();
  };
}

export const useStore = createStoreHook();
export const useDispatch = createDispatchHook();
export const useSelector = createSelectorHook();

export function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  return true;
}

/** Updates in a batch: signals already batch to the next microtask, so this only runs `fn`. */
export const batch = (fn: () => void) => fn();

/** The older connect() API: mapState and mapDispatch become props, recomputed as useSelector is. */
export function connect(mapState?: any, mapDispatch?: any, mergeProps?: any, options: any = {}) {
  const context = options.context ?? ReactReduxContext;
  const useStoreHere = createStoreHook(context);
  const useSelectorHere = createSelectorHook(context);
  return (Component: any) => {
    function Connected(props: any) {
      const store = useStoreHere();
      const own = props;
      const stateProps = useSelectorHere(
        (state: any) => (mapState ? (mapState.length !== 1 ? mapState(state, own) : mapState(state)) : {}),
        options.areStatePropsEqual ?? shallowEqual,
      );
      const dispatchProps = useMemo(() => {
        if (!mapDispatch) return { dispatch: store.dispatch };
        if (typeof mapDispatch === "function") return mapDispatch(store.dispatch, own);
        const bound: any = {};
        for (const k in mapDispatch) bound[k] = (...a: any[]) => store.dispatch(mapDispatch[k](...a));
        return bound;
      }, [store, mapDispatch, typeof mapDispatch === "function" && mapDispatch.length > 1 ? own : null]);
      const merged = mergeProps ? mergeProps(stateProps, dispatchProps, own) : { ...own, ...stateProps, ...dispatchProps };
      return createElement(Component, merged);
    }
    Connected.displayName = `Connect(${Component.displayName ?? Component.name ?? "Component"})`;
    (Connected as any).WrappedComponent = Component;
    return options.forwardRef ? forwardRefOf((p: any, ref: any) => createElement(Connected, { ...p, ref })) : Connected;
  };
}
