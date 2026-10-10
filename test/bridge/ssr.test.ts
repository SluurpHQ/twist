// A Solid-style component in a React page: drawn on the server, adopted (hydrated) in the browser, then live.
import { expect, test } from "bun:test";
import * as React from "../../src/react.ts";
import { hydrateRoot } from "../../src/client.ts";
import { createRoot as createReactRoot } from "../../src/client.ts";
import { renderToString as reactToString } from "../../src/server.ts";
import { installBridge } from "../../src/twist/bridge.ts";
import { installServerBridge } from "../../src/twist/bridge-server.ts";
import * as server from "../../src/twist/server.ts";
import * as web from "../../src/twist/web.ts";
import { createSignal, flush } from "../../src/twist/signals.ts";

const { createElement } = React;

// The same component, compiled once per side as an app's would be (its JSX from that side's runtime).
const counter = (rt: typeof web | typeof server, count: () => number) =>
  rt.__twist_mark((props: { label: string }) => rt.jsx("p", { children: [rt.__twist_d(() => props.label), ": ", rt.__twist_d(() => count())] }));

test("server-drawn Solid-style component is hydrated in place and stays live", async () => {
  const [count, setCount] = createSignal(1);
  installServerBridge(React as any, reactToString);
  const OnServer = counter(server, count);
  const page = (C: any) => createElement("main", null, createElement("h1", null, "Shop"), createElement(C, { label: "items" }));
  const html = reactToString(page(OnServer));
  expect(html).toContain("<sluurp-twist");
  expect(html).toContain("items");

  const box = document.createElement("div");
  box.innerHTML = html;
  const p = box.querySelector("p")!;
  installBridge(React as any, createReactRoot as any);
  const InBrowser = counter(web, count);
  hydrateRoot(box, page(InBrowser));
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
  // The server's paragraph is the one on the page, now bound.
  expect(box.querySelector("p")).toBe(p);
  setCount(2);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
  expect(p.textContent).toBe("items: 2");
});
