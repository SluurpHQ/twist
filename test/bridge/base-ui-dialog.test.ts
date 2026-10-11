// Base UI's Dialog (the kit's) on Sluurp's React: closed, it leaves the page once its exit animation is done (none).
import { expect, mock, test } from "bun:test";
import { dirname, join } from "node:path";
import * as Ours from "../../src/react.ts";
import * as ReactDOM from "../../src/react-dom.ts";
import * as jsx from "../../src/jsx-runtime.ts";
import * as OurCore from "../../src/core.ts";

const pkg = join(import.meta.dir, "../../../../../admin/node_modules/@base-ui/react");
const dialog = join(pkg, "dialog/index.mjs");
// Base UI and what it uses, given Sluurp's React wherever they resolve React from. (REAL=1: React's own.)
const dirs = [pkg, ...["@base-ui/utils", "@floating-ui/react", "@floating-ui/react-dom", "use-sync-external-store"].map((p) => {
  try {
    return dirname(Bun.resolveSync(p + "/package.json", pkg));
  } catch {
    return null;
  }
})].filter(Boolean) as string[];
if (!process.env.REAL)
  for (const dir of dirs)
    for (const [spec, mod] of [["react", Ours], ["react-dom", ReactDOM], ["react/jsx-runtime", jsx]] as const) {
      try {
        mock.module(Bun.resolveSync(spec, dir), () => ({ ...mod, default: mod }));
      } catch {}
    }
const real = (spec: string) => import(Bun.resolveSync(spec, pkg));
const React: any = process.env.REAL ? await real("react") : Ours;
const { createRoot } = process.env.REAL ? await real("react-dom/client") : OurCore;
const { flushSync } = process.env.REAL ? await real("react-dom") : OurCore;

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 20));
};

test("a closed dialog leaves the page", async () => {
  const { Dialog } = await import(dialog);
  const h = React.createElement;
  const container = document.createElement("div");
  document.body.append(container);
  let setOpen!: (v: boolean) => void;
  function App() {
    const [open, set] = React.useState(false);
    setOpen = set;
    return h(Dialog.Root, { open, onOpenChange: set }, h(Dialog.Portal, null, h(Dialog.Popup, { "data-testid": "popup" }, "Hello")));
  }
  createRoot(container).render(h(App));
  await settle();
  flushSync(() => setOpen(true));
  await settle();
  expect(document.querySelector('[data-testid="popup"]')).not.toBe(null);
  flushSync(() => setOpen(false));
  await settle();
  expect(document.querySelector('[data-testid="popup"]')).toBe(null);
});
