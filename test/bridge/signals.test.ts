// One state, read from both styles: a Sluurp signal in a Solid-style component, a Twist signal in a React one.
import { expect, test } from "bun:test";
import * as React from "../../src/react.ts";
import { createRoot as createReactRoot } from "../../src/client.ts";
import { flushSync } from "../../src/react-dom.ts";
import { installBridge } from "../../src/twist/bridge.ts";
import { installSignalsBridge } from "../../src/twist/signals-bridge.ts";
import { jsx as h, render, __twist_d } from "../../src/twist/web.ts";
import { createSignal, flush } from "../../src/twist/client/index.ts";
import { signal } from "../../src/signals.js";

const { createElement } = React;
installBridge(React as any, createReactRoot as any);
installSignalsBridge();

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

test("a Sluurp signal (what live() and the SDK give) read by a Solid-style component", async () => {
  const name = signal("Ada");
  const box = document.createElement("div");
  render(() => h("p", { children: __twist_d(() => name()) }), box);
  await tick();
  expect(box.textContent).toBe("Ada");
  name.set("Grace");
  await tick();
  expect(box.textContent).toBe("Grace");
});

test("a Twist signal read by a React component re-renders it", async () => {
  const [count, setCount] = createSignal(1);
  function Count() {
    return createElement("span", null, String(count()));
  }
  const box = document.createElement("div");
  flushSync(() => createReactRoot(box).render(createElement(Count)));
  await tick();
  expect(box.textContent).toBe("1");
  setCount(2);
  await tick();
  expect(box.textContent).toBe("2");
});
