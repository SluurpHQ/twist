// `react-redux` on signals: a store's state is one signal (one subscription per store), and each useSelector a
// computed over it with the selector's equality, so a component re-renders only when what it selects changes, and
// a dispatch recomputes only selections whose inputs changed. Redux itself (the store, reducers, middleware) is
// whatever the app uses; only the binding to components is ours.
import { computed, signal } from "../../signals/index.js";
import { createElement, forwardRef as forwardRefOf } from "./element.ts";
import { createContext } from "./element.ts";
import { useContext, useLayoutEffect, useMemo, useRef } from "./hooks.ts";

type Store = { getState(): any; dispatch(action: any): any; subscribe(fn: () => void): () => void };
type Equality = (a: any, b: any) => boolean;

export const ReactReduxContext: any = createContext<{ store: Store } | null>(null);

/** The store's state as a signal, and its one subscription to the store, held while a Provider is mounted. */
type Held = { state: { (): any; set(v: any): void; peek(): any }; holders: number; off: (() => void) | null };
const states = new WeakMap<Store, Held>();
function heldOf(store: Store): Held {
  let h = states.get(store);
  if (!h) states.set(store, (h = { state: signal(store.getState()) as any, holders: 0, off: null }));
  return h;
}
const stateOf = (store: Store) => heldOf(store).state;

/** Subscribed while held: the first holder subscribes, the last one to let go unsubscribes. */
function hold(store: Store) {
  const h = heldOf(store);
  if (h.holders++ === 0) {
    h.state.set(store.getState());
    h.off = store.subscribe(() => h.state.set(store.getState()));
  }
  return () => {
    if (--h.holders === 0) {
      h.off?.();
      h.off = null;
    }
  };
}

/** What react-redux's context holds besides the store: a subscription libraries reach for (Recharts subscribes
 * through it), here going straight to the store. */
function subscriptionOf(store: Store) {
  const subs = new Set<() => void>();
  return {
    /** A mounted useSelector, counted (react-redux's listener count); the returned function forgets it. */
    track: () => {
      const token = () => {};
      subs.add(token);
      return () => void subs.delete(token);
    },
    addNestedSub: (listener: () => void) => store.subscribe(listener),
    notifyNestedSubs: () => subs.forEach((f) => f()),
    handleChangeWrapper: () => {},
    isSubscribed: () => true,
    trySubscribe: () => {},
    tryUnsubscribe: () => {},
    getListeners: () => ({ get: () => [...subs] }),
  };
}

export function Provider({ store, context, children, serverState, stabilityCheck = "once", identityFunctionCheck = "once" }: { store: Store; context?: any; children?: any; serverState?: any; stabilityCheck?: string; identityFunctionCheck?: string }) {
  const value = useMemo(
    () => ({ store, subscription: subscriptionOf(store), getServerState: serverState ? () => serverState : undefined, stabilityCheck, identityFunctionCheck }),
    [store, serverState, stabilityCheck, identityFunctionCheck],
  );
  // Subscribed to the store while mounted (before its children's effects run; let go when it unmounts).
  useLayoutEffect(() => hold(store), [store]);
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
  const useContextHere = createReduxContextHook(context);
  return function useSelector<T>(selector: (state: any) => T, options: Equality | { equalityFn?: Equality; devModeChecks?: any } = {}): T {
    const dev = (globalThis as any).process?.env?.NODE_ENV !== "production";
    const equals = (typeof options === "function" ? options : options.equalityFn) ?? Object.is;
    if (dev) {
      if (!selector) throw new Error("You must pass a selector to useSelector");
      if (typeof selector !== "function") throw new Error("You must pass a function as a selector to useSelector");
      if (typeof equals !== "function") throw new Error("You must pass a function as an equality function to useSelector");
    }
    const ctx: any = useContextHere();
    const store: Store = ctx.store;
    const firstRun = useRef(true);
    // react-redux's development checks: a selector that answers differently twice, or returns the whole state.
    const checked = (state: any): T => {
      const selected = selector(state);
      if (dev) {
        const checks = { stabilityCheck: ctx.stabilityCheck, identityFunctionCheck: ctx.identityFunctionCheck, ...(typeof options === "function" ? {} : options.devModeChecks) };
        const name = selector.name || "unknown";
        if (checks.stabilityCheck === "always" || (checks.stabilityCheck === "once" && firstRun.current)) {
          const again = selector(state);
          if (!equals(selected, again)) {
            console.warn(
              `Selector ${name} returned a different result when called with the same parameters. This can lead to unnecessary rerenders.\nSelectors that return a new reference (such as an object or an array) should be memoized: https://redux.js.org/usage/deriving-data-selectors#optimizing-selectors-with-memoization`,
              { state, selected, selected2: again, stack: new Error().stack },
            );
          }
        }
        if ((checks.identityFunctionCheck === "always" || (checks.identityFunctionCheck === "once" && firstRun.current)) && selected === state) {
          console.warn(
            `Selector ${name} returned the root state when called. This can lead to unnecessary rerenders.\nSelectors that return the entire state are almost certainly a mistake, as they will cause a rerender whenever *anything* in state changes.`,
            { stack: new Error().stack },
          );
        }
        firstRun.current = false;
      }
      return selected;
    };
    // The newest selector, run by the computed when the state changes (an inline selector is new every render).
    const latest = useRef(checked);
    latest.current = checked;
    const box = useMemo(() => {
      const state = stateOf(store);
      const b: any = { state, rendered: undefined, has: false, lastState: undefined, lastSelector: undefined };
      // Wakes the component only when what it selects differs from what it last rendered. Its selection is kept
      // with the state and selector it came from, so the render does not select again.
      const NONE = {};
      b.wake = computed(
        () => {
          const st = state();
          if (!b.has) return NONE;
          const v = latest.current(st);
          b.cState = st;
          b.cSelector = b.lastSelector;
          b.cValue = v;
          return v;
        },
        { equals: (_old: any, next: any) => next === NONE || (b.has && equals(b.rendered, next)) },
      );
      return b;
    }, [store, equals]);
    box.wake();
    // What it renders: reused while the state and the selector are the ones it was taken with.
    const now = box.state.peek();
    let out: T;
    if (box.has && box.lastState === now && box.lastSelector === selector) out = box.rendered;
    else if (box.has && box.cState === now && box.cSelector === selector) out = equals(box.rendered, box.cValue) ? box.rendered : box.cValue;
    else {
      out = checked(now);
      if (box.has && equals(box.rendered, out)) out = box.rendered;
    }
    box.lastState = now;
    box.lastSelector = selector;
    box.rendered = out;
    box.has = true;
    // Counted on the Provider's subscription while mounted (react-redux keeps one listener per useSelector).
    useLayoutEffect(() => ctx.subscription?.track?.(), [ctx.subscription]);
    return out;
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
      const ownSeen = useRef<any>(null);
      if (!ownSeen.current || !shallowEqual(ownSeen.current, own)) ownSeen.current = own;
      const ownStable = ownSeen.current;
      const select = useMemo(
        () => (state: any) => (mapState ? (mapState.length !== 1 ? mapState(state, ownStable) : mapState(state)) : {}),
        [ownStable],
      );
      const stateProps = useSelectorHere(
        select,
        // connect's mapState returns a new object each call (compared shallowly): no useSelector checks on it.
        { equalityFn: options.areStatePropsEqual ?? shallowEqual, devModeChecks: { stabilityCheck: "never", identityFunctionCheck: "never" } },
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

/** The context value react-redux's components read (its store and subscription): the hook its own code uses. */
export function createReduxContextHook(context: any = ReactReduxContext) {
  return function useReduxContext() {
    const v = useContext(context);
    if (!v) missing();
    return v;
  };
}
export const useReduxContext = createReduxContextHook();
