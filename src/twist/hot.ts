// Hot reload for Solid-style components (development, Vite's import.meta.hot): each component a module declares is
// one stable component per name, kept across edits; an edit gives it the new code and every instance of it draws
// again (its own state starts over; the rest of the page stays as it is).
import { createMemo, createSignal, untrack } from "./signals.ts";
import { __twist_mark, createComponent } from "./control.ts";

type Hot = { data: Record<string, any> };
type Entry = { proxy: any; set: (v: { C: any }) => void };

/** `component` as the module's `name`: the same component as before the edit, now running the new code. */
export function hotComponent<T>(hot: Hot | undefined, name: string, component: T): T {
  if (!hot) return component;
  const entries: Record<string, Entry> = (hot.data.twistComponents ??= {});
  const known = entries[name];
  if (known) {
    known.set({ C: component });
    return known.proxy;
  }
  const [current, set] = createSignal({ C: component as any }, { equals: false, ownedWrite: true });
  const proxy = __twist_mark(function Hot(props: any) {
    // The instance drawn again when the code changes (untracked: its own reads stay its own). Transparent: it takes
    // no id of its own, so a page the server drew (with no such layer) hydrates.
    return createMemo(
      () => {
        const { C } = current();
        return untrack(() => createComponent(C, props));
      },
      { transparent: true },
    );
  });
  Object.defineProperty(proxy, "name", { value: name });
  entries[name] = { proxy, set };
  return proxy as T;
}

/**
 * Whether an edit can be taken in place: the module exports components only (as React's Fast Refresh asks). Any other
 * export is a value its importers hold, so they must run again.
 */
export function hotAccepts(hot: Hot, next: Record<string, unknown> | undefined) {
  if (!next) return false;
  const proxies = new Set(Object.values((hot.data.twistComponents ?? {}) as Record<string, Entry>).map((e) => e.proxy));
  return Object.values(next).every((v) => proxies.has(v));
}
