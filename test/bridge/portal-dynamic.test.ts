// <Dynamic> and <Portal> drawn on the server and hydrated: the same ids both sides, so what follows them is claimed.
import { expect, test } from "bun:test";
import * as server from "../../src/twist/server.ts";
import * as web from "../../src/twist/web.ts";
import { createSignal, flush } from "../../src/twist/client/index.ts";

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flush();
};

test("Dynamic and Portal hydrate, and what follows them is claimed", async () => {
  const view = (rt: typeof web | typeof server, which: () => string) => () => {
    const A = rt.__twist_mark((p: { n: number }) => rt.jsx("b", { children: ["A", rt.__twist_d(() => p.n)] }));
    const B = rt.__twist_mark((p: { n: number }) => rt.jsx("i", { children: ["B", rt.__twist_d(() => p.n)] }));
    return rt.jsx("main", {
      children: [
        rt.jsx(rt.Dynamic as any, { component: rt.__twist_d(() => (which() === "a" ? A : B)), n: 1 }),
        rt.jsx(rt.Portal as any, { children: rt.__twist_c(() => rt.jsx("aside", { id: "away", children: "over" })) }),
        rt.jsx("p", { id: "after", children: "after" }),
      ],
    });
  };
  const html = server.renderToString(view(server, () => "a"));
  expect(html).toContain("<b _hk");
  expect(html).not.toContain("over");
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.append(box);
  const after = box.querySelector("#after");

  const [which, setWhich] = createSignal("a");
  const dispose = web.hydrate(view(web, which), box);
  await settle();
  expect(box.querySelector("#after")).toBe(after);
  expect(document.getElementById("away")?.textContent).toBe("over");
  setWhich("b");
  await settle();
  expect(box.querySelector("main")!.textContent).toBe("B1after");
  dispose();
  box.remove();
});
