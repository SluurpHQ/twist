// Twist for Vite: Solid-style files compiled by Twist's pass (native, see napi/), and Solid's module names answered by
// Twist (its browser build, or its server build where Vite renders on the server).
//
//   import twist from "@sluurp/twist/vite";
//   export default { plugins: [twist()] };
//
// `react: true`: the app has React components too (React's own); only files that import solid-js / @solidjs/web (or
// say `@jsxImportSource solid-js`) are Twist's. `react: "twist"`: React's module names are answered by Twist as well,
// so React components and Solid-style ones share one runtime.
//
// Solid libraries ship their components as JSX under the "solid" export condition, for the app to compile: that
// condition is asked for first, and those libraries are compiled here like the app's own files (not pre-bundled).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REACT, SIGNALS, SOLID, SOLID_STYLE, SRC, fileFor } from "./modules.js";
import { compile } from "./napi/index.js";

// Vite's own default conditions (6 and later), which a plugin that adds one must repeat.
const defaultClientConditions = ["module", "browser", "development|production"];
const defaultServerConditions = ["module", "node", "development|production"];
const JSX_FILE = /\.[jt]sx(\?.*)?$/;
const PRAGMA = /\/\*\*?\s*@jsxImportSource\s+\S+\s*\*\//;
const OWN = ["@sluurp/twist", "solid-js", "@solidjs/web"];

/** The app's dependencies written for Solid: a "solid" export condition, or solid-js as a peer. */
function solidLibraries(root) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const require = createRequire(join(root, "package.json"));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => {
    if (OWN.includes(name)) return false;
    try {
      const dep = JSON.parse(readFileSync(require.resolve(name + "/package.json"), "utf8"));
      return JSON.stringify(dep.exports ?? {}).includes('"solid"') || !!dep.peerDependencies?.["solid-js"];
    } catch {
      return false;
    }
  });
}

/**
 * A compiled module made hot: its components kept by name across edits (see src/twist/hot.ts); an edit taken in place
 * when it exports components only, else passed on to its importers.
 */
function hotModule(out) {
  const markImport = "__twist_mark, __twist_memo } from";
  if (out.split(markImport).length !== 2) return out;
  return (
    out.replace(markImport, "__twist_mark as __twist_mark_base, __twist_memo } from") +
    `
import { hotComponent as __twist_hotComponent, hotAccepts as __twist_hotAccepts } from "@sluurp/twist/hot";
function __twist_mark(c, name) {
  return __twist_hotComponent(import.meta.hot, name, __twist_mark_base(c));
}
if (import.meta.hot) import.meta.hot.accept((next) => {
  if (!__twist_hotAccepts(import.meta.hot, next)) import.meta.hot.invalidate();
});
`
  );
}

/**
 * @param {{ react?: boolean | "twist" }} [options]
 * @returns {import("vite").Plugin}
 */
export default function twist(options = {}) {
  const mixed = !!options.react;
  // The names Twist answers: Solid's always; React's too when it is the app's React.
  const tables = options.react === "twist" ? [SOLID, SIGNALS, REACT] : [SOLID, SIGNALS];
  let serving = false;
  return {
    name: "sluurp-twist",
    enforce: "pre",
    config(config) {
      const libraries = solidLibraries(config.root ?? process.cwd());
      const answered = options.react === "twist" ? [...OWN, ...Object.keys(REACT)] : OWN;
      return {
        // Twist's JSX for the app's own files unless React is there too (then each Solid-style file says so).
        esbuild: mixed ? { jsx: "automatic" } : { jsx: "automatic", jsxImportSource: "@sluurp/twist" },
        // (React's own: one copy, the app's, for Twist's bridge too.)
        resolve: { conditions: ["solid", ...defaultClientConditions], ...(options.react === true ? { dedupe: ["react", "react-dom"] } : {}) },
        // Twist's sources and Solid libraries' JSX are compiled as the app's, on the server too.
        optimizeDeps: { exclude: [...answered, ...libraries] },
        ssr: { noExternal: [...answered, ...libraries], resolve: { conditions: ["solid", ...defaultServerConditions] } },
      };
    },
    resolveId(id, _importer, opts) {
      for (const table of tables) {
        const file = fileFor(table, id, !!opts?.ssr);
        if (file) return file;
      }
      return null;
    },
    configResolved(config) {
      serving = config.command === "serve";
    },
    transform(code, id, opts) {
      const file = id.split("?")[0];
      if (!JSX_FILE.test(file) || file.replace(/\\/g, "/").startsWith(SRC)) return null;
      // A library's JSX is Solid-style when it says so (it imports Solid); the app's, unless React is there too.
      const library = file.includes("/node_modules/");
      if ((library || mixed) && !SOLID_STYLE.test(code)) return null;
      // Hot reload: the app's own files, in the browser, while developing.
      const hot = serving && !opts?.ssr && !library;
      let out = compile(code.replace(PRAGMA, ""), file, { hot });
      if (hot && out.includes("__twist_mark(")) out = hotModule(out);
      // With React in the app: the bridge, so either kind of component can render the other.
      const bridge = mixed ? 'import "@sluurp/twist/bridge";\n' : "";
      return { code: "/** @jsxImportSource @sluurp/twist */\n" + bridge + out, map: null };
    },
  };
}
