// Builds the Solid app (babel-preset-solid compiles its JSX) into test/out/bench/solid.
import { transformAsync } from "@babel/core";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "..", "test", "out", "bench", "solid");
const out = await Bun.build({
  entrypoints: [join(import.meta.dir, "app.tsx")],
  outdir: dir,
  naming: "app.js",
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  conditions: ["browser", "solid"],
  plugins: [
    {
      name: "solid",
      setup(b) {
        // Solid updates at once: flushSync only runs what it is given.
        b.onResolve({ filter: /^react-dom$/ }, () => ({ path: "flush", namespace: "solid-flush" }));
        b.onLoad({ filter: /.*/, namespace: "solid-flush" }, () => ({ contents: "export const flushSync = (fn) => fn && fn();", loader: "js" }));
        b.onLoad({ filter: /app\.tsx$/ }, async (a) => {
          const code = await Bun.file(a.path).text();
          const r = await transformAsync(code, { filename: a.path, presets: [["babel-preset-solid", { generate: "dom" }], ["@babel/preset-typescript", { isTSX: true, allExtensions: true }]] });
          return { contents: r!.code!, loader: "js" };
        });
      },
    },
  ],
});
if (!out.success) throw new Error(out.logs.join("\n"));
await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench solid</title><body><div id="main"></div><script type="module" src="app.js"></script>`);
console.log("solid", (out.outputs[0]!.size / 1024).toFixed(0) + " KB");
