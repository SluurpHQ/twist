// Solid 1 on a server: a context its components read, a memo, a resource that waits under Suspense (fallback in a string render, loaded in an awaited stream).
import { expect, test } from "bun:test";
import * as S from "../../src/twist/solid1/index.server.ts";
import * as W from "../../src/twist/solid1/server.ts";
test("Solid 1 on a server: context, a memo, a resource under Suspense", async () => {
  const Ctx = S.createContext("none");
  const Child = W.__twist_mark(() => {
    const v = S.useContext(Ctx);
    const [n] = S.createSignal(2);
    const double = S.createMemo(() => n() * 2);
    return W.jsx("p", { children: [v, " ", W.__twist_d(() => double())] });
  });
  const Data = W.__twist_mark(() => {
    const [r] = S.createResource(() => new Promise<string>((ok) => setTimeout(() => ok("loaded"), 5)));
    return W.jsx("b", { children: W.__twist_d(() => r()) });
  });
  const App = () =>
    W.jsx("main", {
      children: [
        W.jsx(Ctx.Provider as any, { value: "ctx", get children() { return W.jsx(Child, {}); } }),
        W.jsx(W.Suspense as any, { fallback: "wait", get children() { return W.jsx(Data, {}); } }),
      ],
    });
  const sync = W.renderToString(App);
  expect(sync).toContain(">ctx<");
  expect(sync).toContain("wait");
  const html = await W.renderToStringAsync(App);
  expect(html).toContain("loaded");
});
