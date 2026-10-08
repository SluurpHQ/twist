// Builds the checks into test/out/ (index.html + suite.js), `react` and `react-dom` pointing at this runtime.
import { join } from "node:path";

const src = join(import.meta.dir, "..", "src");
const map: Record<string, string> = {
  react: "react.ts",
  "react/jsx-runtime": "jsx-runtime.ts",
  "react/jsx-dev-runtime": "jsx-runtime.ts",
  "react-dom": "react-dom.ts",
  "react-dom/client": "client.ts",
  "react-dom/server": "server.ts",
};
const out = await Bun.build({
  entrypoints: [join(import.meta.dir, "suite.tsx")],
  outdir: join(import.meta.dir, "out"),
  target: "browser",
  sourcemap: "inline",
  plugins: [
    {
      name: "sluurp-dom",
      setup(b) {
        b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => (map[a.path] ? { path: join(src, map[a.path]!) } : undefined));
      },
    },
  ],
});
if (!out.success) {
  console.error(out.logs.join("\n"));
  process.exit(1);
}
await Bun.write(join(import.meta.dir, "out", "index.html"), `<!doctype html><meta charset="utf-8"><title>@sluurp/dom</title><body><script type="module" src="suite.js"></script>`);
console.log("built test/out");
