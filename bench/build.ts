// Builds each benchmark app, minified for production, into test/out/bench/<name> (served by test/serve.ts). Two app
// sources: app.tsx (React's API) on React 19.3, Preact 11 and ours; app-solid.tsx (Solid 2's) on Solid and on Twist.
// The -plain ones keep their names, for profiles.
import { transformAsync } from "@babel/core";
import { join } from "node:path";
import { compile } from "../src/twist/compile.ts";

const src = join(import.meta.dir, "..", "src");
const map = (filter: RegExp, to: (path: string) => string | undefined) => ({ filter, to });
type Plugin = { name: string; setup: (b: any) => void };
/** Names answered by files: whatever `to` gives for a name, that file. */
const resolving = (name: string, ...maps: ReturnType<typeof map>[]): Plugin => ({
  name,
  setup: (b) => {
    for (const m of maps) b.onResolve({ filter: m.filter }, (a: any) => (m.to(a.path) ? { path: m.to(a.path) } : undefined));
  },
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

const OURS: Record<string, string> = { react: "react.ts", "react/jsx-runtime": "jsx-runtime.ts", "react-dom": "react-dom.ts", "react-dom/client": "client.ts" };
const ours = resolving("ours", map(/^react(-dom)?(\/.*)?$/, (p) => (OURS[p] ? join(src, OURS[p]!) : undefined)));
// Preact through its React layer; it draws in a microtask by default: at once here, as flushSync is measured.
const PREACT: Record<string, string> = { react: "preact/compat", "react-dom": "preact/compat", "react-dom/client": "preact/compat/client", "react/jsx-runtime": "preact/jsx-runtime" };
const preact: Plugin = {
  name: "preact",
  setup: (b) => {
    b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a: any) => (PREACT[a.path] ? { path: Bun.resolveSync(PREACT[a.path]!, import.meta.dir) } : undefined));
    b.onLoad({ filter: /app\.tsx$/ }, async (a: any) => ({ contents: `import { options } from "preact"; options.debounceRendering = (f) => f();\n` + (await Bun.file(a.path).text()), loader: "tsx" }));
  },
};
const solid: Plugin = {
  name: "solid",
  setup: (b) => {
    b.onLoad({ filter: /app-solid\.tsx$/ }, async (a: any) => {
      const r = await transformAsync(await Bun.file(a.path).text(), {
        filename: a.path,
        plugins: [["@solidjs/babel-plugin", { moduleName: "@solidjs/web", generate: "dom" }]],
        presets: [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
      });
      return { contents: r!.code!, loader: "js" };
    });
  },
};
// Twist: its JSX pass, then the JSX transform onto its runtime; Solid's names are Twist's.
const TWIST: Record<string, string> = { "solid-js": "twist/index.ts", "@solidjs/web": "twist/web.ts", "@solidjs/web/jsx-runtime": "twist/web.ts", "@solidjs/web/jsx-dev-runtime": "twist/web.ts" };
const twist: Plugin = {
  name: "twist",
  setup: (b) => {
    b.onResolve({ filter: /^(solid-js|@solidjs\/web)(\/.*)?$/ }, (a: any) => (TWIST[a.path] ? { path: join(src, TWIST[a.path]!) } : undefined));
    b.onLoad({ filter: /app-solid\.tsx$/ }, async (a: any) => ({ contents: `/** @jsxImportSource @solidjs/web */\n` + compile(await Bun.file(a.path).text(), a.path), loader: "tsx" }));
  },
};
const none = flushing("export const flushSync = (fn) => fn && fn();");

// name: [entry, plugins, minified].
const apps: Record<string, [string, Plugin[], boolean]> = {
  vanilla: ["app-vanilla.ts", [none], true],
  react: ["app.tsx", [], true],
  preact: ["app.tsx", [preact], true],
  solid: ["app-solid.tsx", [solidFlush, solid], true],
  sluurp: ["app.tsx", [ours], true],
  "sluurp-plain": ["app.tsx", [ours], false],
  twist: ["app-solid.tsx", [solidFlush, twist], true],
  "twist-plain": ["app-solid.tsx", [solidFlush, twist], false],
  signals: ["app-signals.tsx", [ours], true],
  "signals-plain": ["app-signals.tsx", [ours], false],
};
const only = process.argv.slice(2);
for (const [name, [entry, plugins, minify]] of Object.entries(apps)) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(import.meta.dir, "..", "test", "out", "bench", name);
  const out = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    outdir: dir,
    naming: "app.js",
    target: "browser",
    minify,
    conditions: ["browser", "solid"],
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    plugins,
  });
  if (!out.success) throw new Error(`${name}: ${out.logs.join("\n")}`);
  await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench ${name}</title><body><div id="main"></div><script type="module" src="app.js"></script>`);
  console.log(name.padEnd(14), (out.outputs[0]!.size / 1024).toFixed(0).padStart(4) + " KB");
}
