// React itself (not Sluurp's) with a Solid-style component: drawn on the server, hydrated in the browser, then live.
import { expect, test } from "bun:test";
import * as React from "react";
import { renderToString as reactToString } from "react-dom/server";
import { createRoot, hydrateRoot } from "react-dom/client";
import { installBridge } from "../../src/twist/bridge.ts";
import { installServerBridge } from "../../src/twist/bridge-server.ts";
import * as server from "../../src/twist/server.ts";
import * as web from "../../src/twist/web.ts";
import { createSignal, flush } from "../../src/twist/signals.ts";

const { createElement } = React;
const settle = async () => {
  await new Promise((r) => setTimeout(r, 20));
  flush();
};

const counter = (rt: typeof web | typeof server, count: () => number) =>
  rt.__twist_mark((props: { label: string }) => rt.jsx("p", { children: [rt.__twist_d(() => props.label), ": ", rt.__twist_d(() => count())] }));

test("React itself draws a Solid-style component on the server and hydrates it", async () => {
  const [count, setCount] = createSignal(1);
  installServerBridge(React as any, reactToString);
  const page = (C: any) => createElement("main", null, createElement("h1", null, "Shop"), createElement(C, { label: "items" }));
  const html = reactToString(page(counter(server, count)));
  expect(html).toContain("<sluurp-twist");
  expect(html).toContain("items");

  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  const p = box.querySelector("p")!;
  installBridge(React as any, createRoot as any, hydrateRoot as any);
  hydrateRoot(box, page(counter(web, count)));
  await settle();
  expect(box.querySelector("p")).toBe(p);
  setCount(2);
  await settle();
  expect(p.textContent).toBe("items: 2");
  box.remove();
});

test("React itself mounts a Solid-style component and keeps its props current", async () => {
  installBridge(React as any, createRoot as any, hydrateRoot as any);
  const [count] = createSignal(5);
  const C = counter(web, count);
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  root.render(createElement(C, { label: "a" }));
  await settle();
  expect(box.textContent).toBe("a: 5");
  root.render(createElement(C, { label: "b" }));
  await settle();
  expect(box.textContent).toBe("b: 5");
  root.unmount();
  box.remove();
});
