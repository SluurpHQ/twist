// Builds each benchmark app (Solid's: bench/solid/build.ts), minified for production, into test/out/bench/<name> (served by test/serve.ts).
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");
const ours: Record<string, string> = {
  react: "react.ts",
  "react/jsx-runtime": "jsx-runtime.ts",
  "react-dom": "react-dom.ts",
  "react-dom/client": "client.ts",
};
// No framework: flushSync only runs what it is given.
const noFramework = { name: "none", setup: (b: any) => { b.onResolve({ filter: /^react-dom$/ }, () => ({ path: "flush", namespace: "none" })); b.onLoad({ filter: /.*/, namespace: "none" }, () => ({ contents: "export const flushSync = (fn) => fn && fn();", loader: "js" })); } };
const toOurs = { name: "ours", setup: (b: any) => void b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a: any) => (ours[a.path] ? { path: join(src, ours[a.path]!) } : undefined)) };

// name: [entry, its React (ours, React, or none), minified]. The -plain ones keep their names, for profiles.
const apps: Record<string, [string, "ours" | "react" | "none", boolean]> = {
  react: ["app.tsx", "react", true],
  sluurp: ["app.tsx", "ours", true],
  "sluurp-plain": ["app.tsx", "ours", false],
  signals: ["app-signals.tsx", "ours", true],
  "signals-plain": ["app-signals.tsx", "ours", false],
  vanilla: ["app-vanilla.ts", "none", true],
};
for (const [name, [entry, react, minify]] of Object.entries(apps)) {
  const dir = join(import.meta.dir, "..", "test", "out", "bench", name);
  const out = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    outdir: dir,
    naming: "app.js",
    target: "browser",
    minify,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    plugins: react === "ours" ? [toOurs] : react === "none" ? [noFramework] : [],
  });
  if (!out.success) throw new Error(out.logs.join("\n"));
  await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench ${name}</title><body><div id="main"></div><script type="module" src="app.js"></script>`);
  console.log(name, (out.outputs[0]!.size / 1024).toFixed(0) + " KB");
}
