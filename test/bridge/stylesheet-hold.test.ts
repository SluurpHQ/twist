// A stylesheet not loaded yet: updates that render it keep the old UI until it has (no flash of unstyled content),
// as React's suspended commit; a sync update does not wait.
import { expect, test } from "bun:test";
import { createElement as h, startTransition, useState } from "../../src/react.ts";
import { createRoot, flushSync } from "../../src/core.ts";

// (Stylesheets and preloads never fetched: they load when the test says so.)
(window as any).happyDOM.settings.fetch.interceptor = { beforeAsyncRequest: () => new Promise(() => {}) };

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const fire = (sel: string, type = "load") => document.querySelector(sel)!.dispatchEvent(new Event(type));

function setup(href: string) {
  const container = document.createElement("div");
  document.body.append(container);
  let set!: (v: boolean) => void;
  function App() {
    const [on, setOn] = useState(false);
    set = setOn;
    return on
      ? h("div", null, h("link", { rel: "stylesheet", href, precedence: "default" }), "new")
      : h("div", null, h("link", { rel: "stylesheet", href: "base.css", precedence: "default" }), "old");
  }
  createRoot(container).render(h(App));
  return { container, set: (v: boolean) => set(v) };
}

test("a default-priority update waits for its stylesheet", async () => {
  const { container, set } = setup("late.css");
  await settle();
  fire('link[rel="stylesheet"][href="base.css"]');
  set(true);
  await settle();
  expect(container.textContent).toBe("old");
  fire('link[rel="preload"][href="late.css"]');
  await settle();
  expect(container.textContent).toBe("old");
  fire('link[rel="stylesheet"][href="late.css"]');
  await settle();
  expect(container.textContent).toBe("new");
});

test("a transition waits for its stylesheet", async () => {
  const { container, set } = setup("route.css");
  await settle();
  startTransition(() => set(true));
  await settle();
  expect(container.textContent).toBe("old");
  fire('link[rel="preload"][href="route.css"]');
  await settle();
  fire('link[rel="stylesheet"][href="route.css"]');
  await settle();
  expect(container.textContent).toBe("new");
});

test("a sync update does not wait", async () => {
  const { container, set } = setup("sync.css");
  await settle();
  flushSync(() => set(true));
  expect(container.textContent).toBe("new");
});
