// React and Solid-style components in one tree, both ways, sharing state.
import { expect, test } from "bun:test";
import * as React from "../../src/react.ts";
import { createRoot as createReactRoot } from "../../src/client.ts";
import { flushSync } from "../../src/react-dom.ts";
import { installBridge } from "../../src/twist/bridge.ts";

const { createElement, useState } = React;
installBridge(React as any, createReactRoot as any);
import { jsx as h, render, __twist_d, __twist_mark } from "../../src/twist/web.ts";
import { createSignal, flush } from "../../src/twist/client/index.ts";

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flush();
};

test("a Solid-style component inside React: rendered once, props kept current", async () => {
  let runs = 0;
  const Badge = __twist_mark((props: { label: string }) => {
    runs++;
    return h("b", { children: __twist_d(() => props.label) });
  });
  let setLabel!: (v: string) => void;
  function App() {
    const [label, set] = useState("one");
    setLabel = set;
    return createElement("div", null, createElement(Badge, { label }));
  }
  const box = document.createElement("div");
  flushSync(() => createReactRoot(box).render(createElement(App)));
  await tick();
  expect(box.textContent).toBe("one");
  flushSync(() => setLabel("two"));
  await tick();
  expect(box.textContent).toBe("two");
  expect(runs).toBe(1);
});

test("a React component inside a Solid-style tree: props live, Twist children passed through", async () => {
  function Card(props: { title: string; children?: any }) {
    const [n] = useState(1);
    return createElement("section", null, createElement("h2", null, props.title, " ", n), props.children);
  }
  const [title, setTitle] = createSignal("first");
  const box = document.createElement("div");
  render(() => h(Card, { title: __twist_d(() => title()), children: h("i", { children: "inside" }) }), box);
  await tick();
  expect(box.querySelector("h2")!.textContent).toBe("first 1");
  expect(box.querySelector("i")!.textContent).toBe("inside");
  setTitle("second");
  await tick();
  expect(box.querySelector("h2")!.textContent).toBe("second 1");
});
