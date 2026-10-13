// A list drawn on the server, hydrated, then changed: rows added where they belong, the server's rows kept.
import { expect, test } from "bun:test";
import * as server from "../../src/twist/server.ts";
import * as web from "../../src/twist/web.ts";
import { createSignal, flush, For } from "../../src/twist/client/index.ts";

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flush();
};

test("a hydrated For takes new rows after the server's", async () => {
  const view = (rt: typeof web | typeof server, items: () => string[]) => () =>
    rt.jsx("ul", { children: rt.jsx(For, { each: rt.__twist_d(() => items()), children: (t: string) => rt.jsx("li", { children: t }) }) });

  const [onServer] = createSignal(["a", "b"]);
  const html = server.renderToString(view(server, onServer));
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  const first = box.querySelector("li")!;

  const [items, setItems] = createSignal(["a", "b"]);
  web.hydrate(view(web, items), box);
  await settle();
  expect(box.querySelector("li")).toBe(first);
  setItems(["a", "b", "c"]);
  await settle();
  expect([...box.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["a", "b", "c"]);
  expect(box.querySelector("li")).toBe(first);
  box.remove();
});
