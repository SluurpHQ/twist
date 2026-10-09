// Builds the benchmark twice, minified for production: bench/out/react (React 19) and bench/out/sluurp (@sluurp/dom).
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");
const ours: Record<string, string> = {
  react: "react.ts",
  "react/jsx-runtime": "jsx-runtime.ts",
  "react-dom": "react-dom.ts",
  "react-dom/client": "client.ts",
};
// sluurp-plain: ours unminified, for profiles with names; signals: the app written with signals, on ours.
for (const name of ["react", "sluurp", "sluurp-plain", "signals", "signals-plain"]) {
  const dir = join(import.meta.dir, "..", "test", "out", "bench", name);
  const out = await Bun.build({
    entrypoints: [join(import.meta.dir, name.startsWith("signals") ? "app-signals.tsx" : "app.tsx")],
    outdir: dir,
    target: "browser",
    minify: !name.endsWith("-plain"),
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    plugins:
      name !== "react"
        ? [{ name: "ours", setup: (b) => void b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => (ours[a.path] ? { path: join(src, ours[a.path]!) } : undefined)) }]
        : [],
  });
  if (!out.success) throw new Error(out.logs.join("\n"));
  await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench ${name}</title><body><div id="main"></div><script type="module" src="${name.startsWith("signals") ? "app-signals" : "app"}.js"></script>`);
  console.log(name, (out.outputs[0].size / 1024).toFixed(0) + " KB");
}
