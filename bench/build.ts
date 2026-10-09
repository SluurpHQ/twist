// Builds each benchmark app, minified for production, into test/out/bench/<name> (served by test/serve.ts).
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");
const ours: Record<string, string> = {
  react: "react.ts",
  "react/jsx-runtime": "jsx-runtime.ts",
  "react-dom": "react-dom.ts",
  "react-dom/client": "client.ts",
};
const toOurs = { name: "ours", setup: (b: any) => void b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a: any) => (ours[a.path] ? { path: join(src, ours[a.path]!) } : undefined)) };

// name: [entry, on @sluurp/dom, minified]. The -plain ones keep their names, for profiles.
const apps: Record<string, [string, boolean, boolean]> = {
  react: ["app.tsx", false, true],
  sluurp: ["app.tsx", true, true],
  "sluurp-plain": ["app.tsx", true, false],
  signals: ["app-signals.tsx", true, true],
  "signals-plain": ["app-signals.tsx", true, false],
  vanilla: ["app-vanilla.ts", true, true],
};
for (const [name, [entry, sluurp, minify]] of Object.entries(apps)) {
  const dir = join(import.meta.dir, "..", "test", "out", "bench", name);
  const out = await Bun.build({
    entrypoints: [join(import.meta.dir, entry)],
    outdir: dir,
    naming: "app.js",
    target: "browser",
    minify,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    plugins: sluurp ? [toOurs] : [],
  });
  if (!out.success) throw new Error(out.logs.join("\n"));
  await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench ${name}</title><body><div id="main"></div><script type="module" src="app.js"></script>`);
  console.log(name, (out.outputs[0]!.size / 1024).toFixed(0) + " KB");
}
