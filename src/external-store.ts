// `use-sync-external-store` and its `/shim`, `/with-selector` forms, which libraries (Redux, Recharts…) import: ours,
// on the runtime's own useSyncExternalStore, so no other copy is loaded.
import { useMemo, useRef, useSyncExternalStore as useStore } from "./hooks.ts";

export const useSyncExternalStore = useStore;

/** A store read through a selector: a component re-renders only when what it selects changes (by `isEqual`). */
export function useSyncExternalStoreWithSelector<S, T>(
  subscribe: (cb: () => void) => () => void,
  getSnapshot: () => S,
  getServerSnapshot: (() => S) | undefined | null,
  selector: (snapshot: S) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const last = useRef<{ snapshot: S; selection: T } | null>(null);
  const [getSelection, getServerSelection] = useMemo(() => {
    let had = false;
    let snap: S;
    let sel: T;
    const pick = (next: S): T => {
      if (!had) {
        had = true;
        snap = next;
        const chosen = selector(next);
        if (isEqual && last.current && isEqual(last.current.selection, chosen)) return (sel = last.current.selection);
        return (sel = chosen);
      }
      if (Object.is(snap, next)) return sel;
      const chosen = selector(next);
      if (isEqual && isEqual(sel, chosen)) {
        snap = next;
        return sel;
      }
      snap = next;
      return (sel = chosen);
    };
    return [() => pick(getSnapshot()), getServerSnapshot ? () => pick(getServerSnapshot()) : undefined];
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);
  const value = useStore(subscribe, getSelection, getServerSelection);
  last.current = { snapshot: undefined as any, selection: value };
  return value;
}
