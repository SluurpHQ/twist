// Twist for Vite: React apps, Solid apps, and apps with both kinds of component, all on Twist. React's module names
// and Solid's are answered by Twist (its browser build, or its server build where Vite renders on the server);
// Solid-style files are compiled by Twist's pass (native, see napi/).
//
//   import twist from "@sluurp/twist/vite";
//   export default { plugins: [twist()] };
//
// Solid libraries ship their components as JSX under the "solid" export condition, for the app to compile: that
// condition is asked for first, and those libraries are compiled here like the app's own files (not pre-bundled).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { REACT, SIGNALS, SOLID, SOLID1, SOLID_STYLE, SRC, featureFile, fileFor } from "./modules.js";
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
 * A compiled module made hot: its components registered with the refresh runtime (src/twist/client/refresh.ts), kept by name
 * across edits; an edit taken in place when it exports components only, else passed on to its importers.
 */
function hotModule(out) {
  const markImport = "__twist_mark, __twist_memo } from";
  if (out.split(markImport).length !== 2) return out;
  return (
    out.replace(markImport, "__twist_mark as __twist_mark_base, __twist_memo } from") +
    `
import { $$registry as __twist_registry, $$component as __twist_component, $$refresh as __twist_refresh } from "@sluurp/twist/refresh";
const __twist_hot = __twist_registry();
function __twist_mark(c, name) {
  const marked = __twist_mark_base(c, name);
  return import.meta.hot ? __twist_component(__twist_hot, name ?? marked.name, marked) : marked;
}
if (import.meta.hot) __twist_refresh("vite", import.meta.hot, __twist_hot);
`
  );
}


/** Whether a file is written React-style: it imports React. */
const REACT_STYLE = /\bfrom\s*["'](react|react-dom)(\/[\w./-]+)?["']/;
/** The modules a file imports (static, re-exported, dynamic). */
const IMPORTS = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** The app's dependencies (what its package.json lists). */
function dependencies(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  } catch {
    return {};
  }
}

/** Whether the app is on Solid 1: the solid-js it installed (or lists) is a 1.x. */
function onSolid1(root, deps) {
  let version = deps["solid-js"];
  try {
    version = JSON.parse(readFileSync(createRequire(join(root, "package.json")).resolve("solid-js/package.json"), "utf8")).version;
  } catch {}
  return typeof version === "string" && /^[\^~>=v\s]*1\./.test(version);
}

/** Whether a module in node_modules is written for React: its package needs React and is not one of React's own. */
function reactPackage(file) {
  const at = file.lastIndexOf("/node_modules/") + 14;
  const parts = file.slice(at).split("/");
  const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (REACT[name]) return false;
  try {
    const pkg = JSON.parse(readFileSync(file.slice(0, at) + name + "/package.json", "utf8"));
    return !!{ ...pkg.dependencies, ...pkg.peerDependencies }.react;
  } catch {
    return false;
  }
}

/**
 * Twist for every app: React's module names, Solid's and its own answered by Twist. A file is Solid-style when it
 * imports Solid, React-style when it imports React; one that imports neither is React's when the app lists React and
 * not Solid, else Solid's.
 *
 * `features` leaves parts of React's API out of the build: "nano" (no Float, Fragment refs or view transitions), or
 * an object such as `{ float: false }`. Everything is in unless said.
 *
 * @param {{ features?: "nano" | { float?: boolean; fragmentRefs?: boolean; viewTransitions?: boolean } }} [options]
 * @returns {import("vite").Plugin}
 */
export default function twist({ features } = {}) {
  let serving = false;
  let reactByDefault = false;
  /** The module tables, in order: Solid 1's first for an app on Solid 1. */
  let tables = [SOLID, SIGNALS, REACT];
  const styleOf = (code) => (SOLID_STYLE.test(code) ? "solid" : REACT_STYLE.test(code) ? "react" : reactByDefault ? "react" : "solid");
  /** Whether a file imports a component of the other kind (then the bridge is loaded with it). */
  async function importsOther(ctx, code, id, style) {
    for (const [, spec] of code.matchAll(IMPORTS)) {
      if (SOLID[spec] || SOLID1[spec] || REACT[spec] || SIGNALS[spec]) continue;
      const resolved = await ctx.resolve(spec, id, { skipSelf: true });
      const file = resolved?.id.split("?")[0].replace(/\\/g, "/");
      if (!file || !JSX_FILE.test(file) && !file.includes("/node_modules/")) continue;
      let other;
      if (file.includes("/node_modules/")) other = style === "solid" ? reactPackage(file) : false;
      else {
        try {
          other = styleOf(readFileSync(file, "utf8")) !== style;
        } catch {
          other = false;
        }
      }
      if (other) return true;
    }
    return false;
  }
  return {
    name: "sluurp-twist",
    enforce: "pre",
    config(config) {
      const root = config.root ?? process.cwd();
      const deps = dependencies(root);
      reactByDefault = !!deps.react && !deps["solid-js"];
      if (onSolid1(root, deps)) tables = [SOLID1, SOLID, SIGNALS, REACT];
      const libraries = solidLibraries(root);
      const answered = [...OWN, ...Object.keys(REACT)];
      return {
        // React-style files' JSX is React's (answered by Twist); a Solid-style file says its own.
        esbuild: { jsx: "automatic" },
        resolve: { conditions: ["solid", ...defaultClientConditions] },
        // Twist's sources and Solid libraries' JSX are compiled as the app's, on the server too.
        optimizeDeps: { exclude: [...answered, ...libraries] },
        ssr: { noExternal: [...answered, ...libraries], resolve: { conditions: ["solid", ...defaultServerConditions] } },
      };
    },
    resolveId(id, importer, opts) {
      // Twist's own module of a feature left out: its stand-in.
      const from = importer?.split("?")[0].replace(/\\/g, "/");
      if (features && from?.startsWith(SRC) && id.startsWith(".")) {
        const file = join(dirname(from), id).replace(/\\/g, "/");
        const swapped = featureFile(file, features);
        if (swapped !== file) return swapped;
      }
      for (const table of tables) {
        const file = fileFor(table, id, !!opts?.ssr);
        if (file) return file;
      }
      return null;
    },
    configResolved(config) {
      serving = config.command === "serve";
    },
    async transform(code, id, opts) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (!JSX_FILE.test(file) || file.startsWith(SRC)) return null;
      // A library's JSX is Solid-style when it says so (it imports Solid); otherwise it is left as it is.
      const library = file.includes("/node_modules/");
      if (library && !SOLID_STYLE.test(code)) return null;
      const style = library ? "solid" : styleOf(code);
      // One kind importing the other: the bridge, so either can render the other (none in an app of one kind).
      const head = !library && (await importsOther(this, code, id, style)) ? 'import "@sluurp/twist/bridge";\n' : "";
      if (style === "react") return head ? { code: head + code, map: null } : null;
      // Hot reload: the app's own files, in the browser, while developing.
      const hot = serving && !opts?.ssr && !library;
      let out = compile(code.replace(PRAGMA, ""), file, { hot });
      if (hot && out.includes("__twist_mark(")) out = hotModule(out);
      return { code: "/** @jsxImportSource @sluurp/twist */\n" + head + out, map: null };
    },
  };
}
