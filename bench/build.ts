// Builds each benchmark app, minified for production, into test/out/bench/<name> (served by test/serve.ts). Two app
// sources: app.tsx (React's API) on React 19.3, Preact 11 and ours; app-solid.tsx (Solid 2's) on Solid and on Twist.
// The ssr-* ones are their server twins (ssr.tsx, ssr-solid.tsx), built for Bun. The -plain ones keep their names,
// for profiles.
import { transformAsync } from "@babel/core";
import { join } from "node:path";
import { compile } from "../src/twist/compile.ts";

const src = join(import.meta.dir, "..", "src");
type Plugin = { name: string; setup: (b: any) => void };
/** Imports answered by `files` (a name to a path; undefined leaves it to the bundler). */
const resolving = (name: string, filter: RegExp, files: Record<string, string>): Plugin => ({
  name,
  setup: (b) => b.onResolve({ filter }, (a: any) => (files[a.path] ? { path: files[a.path] } : undefined)),
});
/** `react-dom`'s flushSync, which the cases call, as `body` (a module of its own). */
const flushing = (body: string): Plugin => ({
  name: "flush",
  setup: (b) => {
    b.onResolve({ filter: /^react-dom$/ }, () => ({ path: "flush", namespace: "flush" }));
    b.onLoad({ filter: /.*/, namespace: "flush" }, () => ({ contents: body, loader: "js", resolveDir: import.meta.dir }));
  },
});
// Solid batches its updates: a case's work is flushed, as React's flushSync does.
const solidFlush = flushing(`import { flush } from "solid-js"; export const flushSync = (fn) => { fn && fn(); flush(); };`);
const none = flushing("export const flushSync = (fn) => fn && fn();");

const REACT = /^react(-dom)?(\/.*)?$/;
const at = (dir: string, files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, join(dir, v)]));
const ours = resolving("ours", REACT, at(src, { react: "react.ts", "react/jsx-runtime": "jsx-runtime.ts", "react-dom": "react-dom.ts", "react-dom/client": "client.ts", "react-dom/server": "server.ts" }));
// Preact through its React layer; in the browser it draws in a microtask by default: at once here, as flushSync is.
const PREACT: Record<string, string> = { react: "preact/compat", "react-dom": "preact/compat", "react-dom/client": "preact/compat/client", "react/jsx-runtime": "preact/jsx-runtime", "react-dom/server": "preact-render-to-string" };
const preact = resolving("preact", REACT, Object.fromEntries(Object.entries(PREACT).map(([k, v]) => [k, Bun.resolveSync(v, import.meta.dir)])));
const preactAtOnce: Plugin = {
  name: "preact-at-once",
  setup: (b) => b.onLoad({ filter: /app\.tsx$/ }, async (a: any) => ({ contents: `import { options } from "preact"; options.debounceRendering = (f) => f();\n` + (await Bun.file(a.path).text()), loader: "tsx" })),
};
const SOLID_FILE = /(app-solid|ssr-solid)\.tsx$/;
/** Solid's own compiler, for the DOM or the server (hydratable there, as Twist's server always is). */
const solid = (generate: "dom" | "ssr"): Plugin => ({
  name: "solid",
  setup: (b) =>
    b.onLoad({ filter: SOLID_FILE }, async (a: any) => {
      const r = await transformAsync(await Bun.file(a.path).text(), {
        filename: a.path,
        plugins: [["@solidjs/babel-plugin", { moduleName: "@solidjs/web", generate, hydratable: generate === "ssr" }]],
        presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
      });
      return { contents: r!.code!, loader: "js" };
    }),
});
/** Twist: its JSX pass, then the JSX transform onto its runtime (its browser one, or its server one). */
const twist = (server: boolean): Plugin => {
  const web = server ? "twist/server.ts" : "twist/web.ts";
  const jsx = server ? "twist/jsx/server/jsx-runtime.ts" : "twist/web.ts";
  const files = at(src, { "solid-js": server ? "twist/server-solid.ts" : "twist/index.ts", "@solidjs/web": web, "@solidjs/web/jsx-runtime": jsx, "@solidjs/web/jsx-dev-runtime": jsx });
  return {
    name: "twist",
    setup: (b) => {
      b.onResolve({ filter: /^(solid-js|@solidjs\/web)(\/.*)?$/ }, (a: any) => (files[a.path] ? { path: files[a.path] } : undefined));
      b.onLoad({ filter: SOLID_FILE }, async (a: any) => ({ contents: `/** @jsxImportSource @solidjs/web */\n` + compile(await Bun.file(a.path).text(), a.path), loader: "tsx" }));
    },
  };
};

type App = { entry: string; plugins: Plugin[]; minify?: boolean; server?: boolean };
const apps: Record<string, App> = {
  vanilla: { entry: "app-vanilla.ts", plugins: [none] },
  react: { entry: "app.tsx", plugins: [] },
  preact: { entry: "app.tsx", plugins: [preactAtOnce, preact] },
  solid: { entry: "app-solid.tsx", plugins: [solidFlush, solid("dom")] },
  sluurp: { entry: "app.tsx", plugins: [ours] },
  "sluurp-plain": { entry: "app.tsx", plugins: [ours], minify: false },
  twist: { entry: "app-solid.tsx", plugins: [solidFlush, twist(false)] },
  "twist-plain": { entry: "app-solid.tsx", plugins: [solidFlush, twist(false)], minify: false },
  signals: { entry: "app-signals.tsx", plugins: [ours] },
  "signals-plain": { entry: "app-signals.tsx", plugins: [ours], minify: false },
  "ssr-react": { entry: "ssr.tsx", plugins: [], server: true },
  "ssr-preact": { entry: "ssr.tsx", plugins: [preact], server: true },
  "ssr-sluurp": { entry: "ssr.tsx", plugins: [ours], server: true },
  "ssr-solid": { entry: "ssr-solid.tsx", plugins: [solid("ssr")], server: true },
  "ssr-twist": { entry: "ssr-solid.tsx", plugins: [twist(true)], server: true },
};
const only = process.argv.slice(2);
// (Server builds keep their names: their size does not matter, their profiles do.)
for (const [name, { entry, plugins, server, minify = !server }] of Object.entries(apps)) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(import.meta.dir, "..", "test", "out", "bench", name);
  const out = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    outdir: dir,
    naming: "app.js",
    target: server ? "bun" : "browser",
    minify,
    conditions: server ? ["node", "solid"] : ["browser", "solid"],
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    plugins,
  });
  if (!out.success) throw new Error(`${name}: ${out.logs.join("\n")}`);
  if (!server) await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench ${name}</title><body><div id="main"></div><script type="module" src="app.js"></script>`);
  console.log(name.padEnd(14), (out.outputs[0]!.size / 1024).toFixed(0).padStart(4) + " KB");
}
