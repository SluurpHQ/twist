// Before React's tests: a DOM (happy-dom), the globals they expect, and their imports pointed at @sluurp/dom and
// the shims (scheduler, internal-test-utils).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { join } from "node:path";

import "./gates.ts";

GlobalRegistrator.register({ url: "http://localhost/" });

const g = globalThis as any;
// Modules stay loaded between tests (Bun has no registry reset); each test still gets its own container and root.
const bunJest: any = (await import("bun:test")).jest;
// As React's setupTests has them, for development.
const spyOn = (obj: any, key: string) => bunJest.spyOn(obj, key);
g.spyOn = spyOn;
g.spyOnDev = spyOn;
g.spyOnDevAndProd = spyOn;
g.spyOnProd = () => {};
g.__EXTENSION__ = false;
g.__REACT_ROOT_PATH_TEST__ = import.meta.dir;
for (const j of [bunJest, g.jest].filter(Boolean)) {
  j.resetModules ??= () => {};
  j.isolateModules ??= (fn: () => void) => fn();
  j.unmock ??= () => {};
  j.dontMock ??= () => {};
}

const src = join(import.meta.dir, "..", "src");
const shim = join(import.meta.dir, "shim");
const ours: Record<string, string> = {
  react: join(src, "react.ts"),
  "react/jsx-runtime": join(src, "jsx-runtime.ts"),
  "react/jsx-dev-runtime": join(src, "jsx-runtime.ts"),
  "react-dom": join(src, "react-dom.ts"),
  "react-dom/client": join(src, "client.ts"),
  "react-dom/server": join(src, "server.ts"),
  "react-dom/server.browser": join(src, "server.ts"),
  "react-dom/server.node": join(src, "server.ts"),
  "react-dom/server.edge": join(src, "server.ts"),
  "react-dom/static": join(src, "server.ts"),
  "react-dom/test-utils": join(shim, "test-utils.ts"),
  scheduler: join(shim, "scheduler.ts"),
  "scheduler/unstable_mock": join(shim, "scheduler.ts"),
  "internal-test-utils": join(shim, "test-utils.ts"),
};

plugin({
  name: "sluurp-dom-conformance",
  setup(b) {
    b.onResolve({ filter: /^(react|react-dom|scheduler|internal-test-utils)(\/.*)?$/ }, (a) => {
      const to = ours[a.path];
      return to ? { path: to } : undefined;
    });
  },
});
