// Builds the Solid app twice into test/out/bench: "solid" on Solid itself (its 1.9 compiler and runtime), and
// "sluurp-solid" compiled by Solid 2's compiler onto ours (@sluurp/dom/solid, solid-js on Sluurp's signals).
import { transformAsync } from "@babel/core";
import { join } from "node:path";

const src = join(import.meta.dir, "..", "..", "src");
// flushSync: Solid updates at once; ours batches, so its flush() runs after.
const flushStub = (b: any) => {
  b.onResolve({ filter: /^react-dom$/ }, () => ({ path: "flush", namespace: "flush" }));
  b.onLoad({ filter: /.*/, namespace: "flush" }, () => ({ contents: "export const flushSync = (fn) => fn && fn();", loader: "js" }));
};
const flushOurs = (b: any) => {
  b.onResolve({ filter: /^react-dom$/ }, () => ({ path: "flush", namespace: "flush" }));
  b.onLoad({ filter: /.*/, namespace: "flush" }, () => ({ contents: `import { flush } from "solid-js"; export const flushSync = (fn) => { const r = fn && fn(); flush(); return r; };`, loader: "js", resolveDir: import.meta.dir }));
};
const compile = (preset: string, moduleName?: string) => (b: any) =>
  b.onLoad({ filter: /app\.tsx$/ }, async (a: any) => {
    const r = await transformAsync(await Bun.file(a.path).text(), {
      filename: a.path,
      presets: [[preset, { generate: "dom", ...(moduleName ? { moduleName } : {}) }], ["@babel/preset-typescript", { isTSX: true, allExtensions: true }]],
    });
    return { contents: r!.code!, loader: "js" };
  });
const ours = (b: any) => {
  const to: Record<string, string> = { "solid-js": "solid.ts", "solid-js/web": "solid-web.ts", "@sluurp/dom/solid": "solid-web.ts" };
  b.onResolve({ filter: /^(solid-js(\/web)?|@sluurp\/dom\/solid)$/ }, (a: any) => ({ path: join(src, to[a.path]!) }));
};

const targets: Record<string, ((b: any) => void)[]> = {
  solid: [flushStub, compile("babel-preset-solid")],
  "sluurp-solid": [flushOurs, ours, compile("babel-preset-solid-2", "@sluurp/dom/solid")],
};
for (const [name, setups] of Object.entries(targets)) {
  const dir = join(import.meta.dir, "..", "..", "test", "out", "bench", name);
  const out = await Bun.build({
    entrypoints: [join(import.meta.dir, "app.tsx")],
    outdir: dir,
    naming: "app.js",
    target: "browser",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    conditions: ["browser", "solid"],
    plugins: setups.map((setup, i) => ({ name: name + i, setup })),
  });
  if (!out.success) throw new Error(out.logs.join("\n"));
  await Bun.write(join(dir, "index.html"), `<!doctype html><meta charset="utf-8"><title>bench ${name}</title><body><div id="main"></div><script type="module" src="app.js"></script>`);
  console.log(name, (out.outputs[0]!.size / 1024).toFixed(0) + " KB");
}
