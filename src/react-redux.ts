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

// ---------------------------------------------------------------- connect

const strictEqual = (a: any, b: any) => a === b;
const isPlainObject = (v: any) => {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null;
};
const reduxWarning = (message: string) => {
  if ((globalThis as any).process?.env?.NODE_ENV !== "production") console.error(message);
};

type MapFn = ((a: any, own?: any) => any) & { dependsOnOwnProps?: boolean };
const dependsOnOwn = (f: MapFn) => (f.dependsOnOwnProps != null ? !!f.dependsOnOwnProps : f.length !== 1);

/** A constant mapping (an object of action creators, or none): never depends on own props. */
function constantMap(get: (dispatch: any) => any) {
  return (dispatch: any) => {
    const value = get(dispatch);
    const f: MapFn = () => value;
    f.dependsOnOwnProps = false;
    return f;
  };
}

/** A mapping function, maybe a factory (it returns the real mapping on its first call), its result checked. */
function functionMap(map: MapFn, name: string) {
  return (_dispatch: any, displayName: string) => {
    const proxy: any = (a: any, own: any) => (proxy.dependsOnOwnProps ? proxy.map(a, own) : proxy.map(a, undefined));
    proxy.dependsOnOwnProps = true;
    proxy.map = (a: any, own: any) => {
      proxy.map = map;
      proxy.dependsOnOwnProps = dependsOnOwn(map);
      let props = proxy(a, own);
      if (typeof props === "function") {
        proxy.map = props;
        proxy.dependsOnOwnProps = dependsOnOwn(props);
        props = proxy(a, own);
      }
      if (!isPlainObject(props)) reduxWarning(`${name}() in ${displayName} must return a plain object. Instead received ${props}.`);
      return props;
    };
    return proxy as MapFn;
  };
}

const invalidArg = (arg: any, name: string) => (_d: any, _n: string, wrapped: string) => {
  throw new Error(`Invalid value of type ${typeof arg} for ${name} argument when connecting component ${wrapped}.`);
};

function bindActionCreators(creators: any, dispatch: any) {
  const bound: any = {};
  for (const k in creators) if (typeof creators[k] === "function") bound[k] = (...a: any[]) => dispatch(creators[k](...a));
  return bound;
}

/** Per instance: state props, dispatch props and merged props, each recomputed only when what it depends on changed. */
function propsSelector(dispatch: any, init: any, cmp: any) {
  const mapState: MapFn = init.state(dispatch, cmp.displayName, cmp.wrappedName);
  const mapDispatch: MapFn = init.dispatch(dispatch, cmp.displayName, cmp.wrappedName);
  const merge: any = init.merge(dispatch, cmp.displayName, cmp.wrappedName);
  let ran = false;
  let state: any, own: any, stateProps: any, dispatchProps: any, merged: any;
  return (nextState: any, nextOwn: any) => {
    if (!ran) {
      ran = true;
      state = nextState;
      own = nextOwn;
      stateProps = mapState(state, own);
      dispatchProps = mapDispatch(dispatch, own);
      return (merged = merge(stateProps, dispatchProps, own));
    }
    const propsChanged = !cmp.areOwnPropsEqual(nextOwn, own);
    const stateChanged = !cmp.areStatesEqual(nextState, state, nextOwn, own);
    state = nextState;
    own = nextOwn;
    if (propsChanged && stateChanged) {
      stateProps = mapState(state, own);
      if (mapDispatch.dependsOnOwnProps) dispatchProps = mapDispatch(dispatch, own);
      return (merged = merge(stateProps, dispatchProps, own));
    }
    if (propsChanged) {
      if (mapState.dependsOnOwnProps) stateProps = mapState(state, own);
      if (mapDispatch.dependsOnOwnProps) dispatchProps = mapDispatch(dispatch, own);
      return (merged = merge(stateProps, dispatchProps, own));
    }
    if (stateChanged) {
      const next = mapState(state, own);
      const changed = !cmp.areStatePropsEqual(next, stateProps);
      stateProps = next;
      if (changed) merged = merge(stateProps, dispatchProps, own);
    }
    return merged;
  };
}

const REACT_STATICS = new Set("childContextTypes contextType contextTypes defaultProps displayName getDefaultProps getDerivedStateFromError getDerivedStateFromProps mixins propTypes type".split(" "));
const KNOWN_STATICS = new Set("name length prototype caller callee arguments arity".split(" "));
function hoistStatics(target: any, source: any) {
  if (typeof source === "string") return target;
  for (const key of [...Object.getOwnPropertyNames(source), ...Object.getOwnPropertySymbols(source)]) {
    if (REACT_STATICS.has(key as string) || KNOWN_STATICS.has(key as string) || (source.$$typeof && (key === "$$typeof" || key === "render" || key === "type" || key === "compare"))) continue;
    const d = Object.getOwnPropertyDescriptor(source, key);
    try {
      if (d) Object.defineProperty(target, key, d);
    } catch {}
  }
  return target;
}

const isElementType = (t: any) =>
  typeof t === "string" || typeof t === "function" || (typeof t === "object" && t !== null && typeof t.$$typeof === "symbol");
let warnedPure = false;

/** The older connect() API, as react-redux defines it, on signals: an instance re-renders when its merged props change. */
export function connect(mapStateToProps?: any, mapDispatchToProps?: any, mergeProps?: any, options: any = {}) {
  const {
    pure,
    areStatesEqual = strictEqual,
    areOwnPropsEqual = shallowEqual,
    areStatePropsEqual = shallowEqual,
    areMergedPropsEqual = shallowEqual,
    forwardRef = false,
    context = ReactReduxContext,
  } = options;
  if (pure !== undefined && !warnedPure) {
    warnedPure = true;
    reduxWarning('The `pure` option has been removed. `connect` is now always a "pure/memoized" component');
  }
  const init = {
    state: !mapStateToProps ? constantMap(() => ({})) : typeof mapStateToProps === "function" ? functionMap(mapStateToProps, "mapStateToProps") : invalidArg(mapStateToProps, "mapStateToProps"),
    dispatch:
      mapDispatchToProps && typeof mapDispatchToProps === "object"
        ? constantMap((d) => bindActionCreators(mapDispatchToProps, d))
        : !mapDispatchToProps
          ? constantMap((d) => ({ dispatch: d }))
          : typeof mapDispatchToProps === "function"
            ? functionMap(mapDispatchToProps, "mapDispatchToProps")
            : invalidArg(mapDispatchToProps, "mapDispatchToProps"),
    merge: !mergeProps
      ? () => (s: any, d: any, o: any) => ({ ...o, ...s, ...d })
      : typeof mergeProps === "function"
        ? (_d: any, displayName: string) => {
            let ran = false;
            let merged: any;
            return (s: any, d: any, o: any) => {
              const next = mergeProps(s, d, o);
              if (!ran) {
                ran = true;
                merged = next;
                if (!isPlainObject(merged)) reduxWarning(`mergeProps() in ${displayName} must return a plain object. Instead received ${merged}.`);
              } else if (!areMergedPropsEqual(next, merged)) merged = next;
              return merged;
            };
          }
        : invalidArg(mergeProps, "mergeProps"),
  };
  return (Wrapped: any) => {
    if ((globalThis as any).process?.env?.NODE_ENV !== "production" && !isElementType(Wrapped)) {
      throw new Error(`You must pass a component to the function returned by connect. Instead received ${typeof Wrapped === "object" ? JSON.stringify(Wrapped) : String(Wrapped)}`);
    }
    const wrappedName = Wrapped.displayName || Wrapped.name || "Component";
    const displayName = `Connect(${wrappedName})`;
    const cmp = { displayName, wrappedName, areStatesEqual, areOwnPropsEqual, areStatePropsEqual };
    function Connect(all: any) {
      const { reactReduxForwardedRef, context: propsContext, ...wrapperProps } = all;
      const ctx: any = useContext(propsContext?.Consumer ? propsContext : context);
      const fromProps = !!(wrapperProps.store && wrapperProps.store.getState && wrapperProps.store.dispatch);
      if (!fromProps && !ctx?.store) {
        throw new Error(
          `Could not find "store" in the context of "${displayName}". Either wrap the root component in a <Provider>, or pass a custom React context provider to <Provider> and the corresponding React context consumer to ${displayName} in connect options.`,
        );
      }
      const store: Store = fromProps ? wrapperProps.store : ctx.store;
      // A store given as a prop is held (subscribed) by this component; one from context, by its Provider.
      useLayoutEffect(() => (fromProps ? hold(store) : undefined), [store, fromProps]);
      const select = useMemo(() => propsSelector(store.dispatch, init, cmp), [store]);
      const own = useRef(wrapperProps);
      own.current = wrapperProps;
      const box = useMemo(() => {
        const state = stateOf(store);
        // The merged props for the current state: a new object only when they changed, which re-renders this.
        return computed(() => {
          try {
            return { props: select(state(), own.current) };
          } catch (e) {
            reduxWarning(`An error occurred in \`mapStateToProps\` (or a selector) of the \`connect()\`-ed component "${displayName}". See https://github.com/reduxjs/react-redux/issues/1942 for details.`);
            return { error: e };
          }
        }, { equals: (a: any, b: any) => a.props !== undefined && a.props === b.props });
      }, [store, select]);
      const result: any = box();
      // Own props changed since: the selector decides with them (it keeps the same object when nothing changed).
      const merged = result.error ? null : select(stateOf(store).peek(), wrapperProps);
      if (result.error) throw result.error;
      return createElement(Wrapped, forwardRef ? { ...merged, ref: reactReduxForwardedRef } : merged);
    }
    Connect.displayName = displayName;
    (Connect as any).WrappedComponent = Wrapped;
    if (forwardRef) {
      const forwarded: any = forwardRefOf((props: any, ref: any) => createElement(Connect, { ...props, reactReduxForwardedRef: ref }));
      forwarded.displayName = displayName;
      forwarded.WrappedComponent = Wrapped;
      return hoistStatics(forwarded, Wrapped);
    }
    return hoistStatics(Connect, Wrapped);
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
