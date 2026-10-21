// Which of Twist's files answers each module name, in the browser and on the server: React's names (when Twist is the
// app's React) and Solid's (Twist is Solid 2's API). Every integration maps from here: the Vite plugin, Sluurp's host.
import { fileURLToPath } from "node:url";

/** React's module names → [browser file, server file], under src/. */
export const REACT = {
  react: ["react.ts", "react.ts"],
  "react/jsx-runtime": ["jsx-runtime.ts", "jsx-runtime.ts"],
  "react/jsx-dev-runtime": ["jsx-runtime.ts", "jsx-runtime.ts"],
  "react-dom": ["react-dom.ts", "react-dom.ts"],
  "react-dom/client": ["client.ts", "client.ts"],
  "react-dom/server": ["server.browser.ts", "server.ts"],
  "react-dom/server.browser": ["server.browser.ts", "server.browser.ts"],
  "react-dom/server.node": ["server.ts", "server.ts"],
  "react-dom/static": ["server.browser.ts", "server.ts"],
  "react-redux": ["react-redux.ts", "react-redux.ts"],
  "use-sync-external-store": ["external-store.ts", "external-store.ts"],
  "use-sync-external-store/shim": ["external-store.ts", "external-store.ts"],
  "use-sync-external-store/shim/index.js": ["external-store.ts", "external-store.ts"],
  "use-sync-external-store/with-selector": ["external-store.ts", "external-store.ts"],
  "use-sync-external-store/with-selector.js": ["external-store.ts", "external-store.ts"],
  "use-sync-external-store/shim/with-selector": ["external-store.ts", "external-store.ts"],
  "use-sync-external-store/shim/with-selector.js": ["external-store.ts", "external-store.ts"],
};

/** Solid's module names (and Twist's own) → [browser file, server file], under src/. */
export const SOLID = {
  "solid-js": ["twist/client/index.ts", "twist/server-solid.ts"],
  "solid-js/internal": ["twist/internal.ts", "twist/internal.server.ts"],
  "solid-js/store": ["twist/client/index.ts", "twist/server-solid.ts"],
  "@solidjs/web": ["twist/web.ts", "twist/server.ts"],
  "@solidjs/web/jsx-runtime": ["twist/jsx/client/jsx-runtime.ts", "twist/jsx/server/jsx-runtime.ts"],
  "@solidjs/web/jsx-dev-runtime": ["twist/jsx/client/jsx-dev-runtime.ts", "twist/jsx/server/jsx-dev-runtime.ts"],
  "@sluurp/twist": ["twist/client/index.ts", "twist/server-solid.ts"],
  "@sluurp/twist/web": ["twist/web.ts", "twist/server.ts"],
  "@sluurp/twist/jsx-runtime": ["twist/jsx/client/jsx-runtime.ts", "twist/jsx/server/jsx-runtime.ts"],
  "@sluurp/twist/jsx-dev-runtime": ["twist/jsx/client/jsx-dev-runtime.ts", "twist/jsx/server/jsx-dev-runtime.ts"],
  "solid-js/refresh": ["twist/client/refresh.ts", "twist/client/refresh.ts"],
  "@sluurp/twist/refresh": ["twist/client/refresh.ts", "twist/client/refresh.ts"],
  "@solidjs/web/performance-tracks": ["twist/performance-tracks.ts", "twist/performance-tracks.ts"],
  "@sluurp/twist/performance-tracks": ["twist/performance-tracks.ts", "twist/performance-tracks.ts"],
  "@sluurp/twist/bridge": ["twist/react-bridge.ts", "twist/react-bridge-server.ts"],
};

/** Solid 1's module names, for an app on solid-js 1.x: Solid 1's API on Twist (ahead of SOLID). */
export const SOLID1 = {
  "solid-js": ["twist/solid1/index.ts", "twist/solid1/index.server.ts"],
  "solid-js/web": ["twist/solid1/web.ts", "twist/solid1/server.ts"],
  // (What Twist's compile pass imports its helpers from: Solid 1's runtime, for an app on Solid 1.)
  "@solidjs/web": ["twist/solid1/web.ts", "twist/solid1/server.ts"],
  "solid-js/store": ["twist/solid1/store.ts", "twist/solid1/store.ts"],
  "solid-js/jsx-runtime": ["twist/solid1/jsx-runtime.ts", "twist/jsx/server/jsx-runtime.ts"],
  "solid-js/jsx-dev-runtime": ["twist/solid1/jsx-runtime.ts", "twist/jsx/server/jsx-dev-runtime.ts"],
};

/** Signals, for code written on them directly. */
export const SIGNALS = { "@sluurp/twist/signals": ["signals.js", "signals.js"] };

/** The folder Twist's sources are in (forward slashes: as bundlers name modules). */
export const SRC = fileURLToPath(new URL("./src/", import.meta.url)).replace(/\\/g, "/");

/** The file answering `name` from `table` (the browser's, or the server's), or undefined. */
export const fileFor = (table, name, server = false) => (table[name] ? SRC + table[name][server ? 1 : 0] : undefined);

/**
 * What a build may leave out of React's API, each by the module it lives in: all of it is in unless said. A feature
 * left out loads its stand-in from src/off/ instead (same exports, doing nothing, or saying it is left out).
 */
export const FEATURES = { float: "float-client.ts", fragmentRefs: "fragment-ref.ts", viewTransitions: "view-transition.ts" };

/** The smallest React: no Float (<title>, <meta> and stylesheets hoisted), no Fragment refs, no view transitions. */
export const NANO = { float: false, fragmentRefs: false, viewTransitions: false };

/** `features` as given: "nano", or an object naming what is left out (`{ float: false }`). */
export const featuresOf = (features) => (features === "nano" ? NANO : features ?? {});

/** The file Twist's own `file` loads as, with `features`: its stand-in when its feature is left out. */
export function featureFile(file, features) {
  const p = file.replace(/\\/g, "/");
  const left = featuresOf(features);
  for (const [name, mod] of Object.entries(FEATURES)) if (left[name] === false && p === SRC + mod) return SRC + "off/" + mod;
  return file;
}

/** Whether a file is written Solid-style: it imports Solid's API (not the signals both kinds share), or names it as its JSX. */
export const SOLID_STYLE =
  /\bfrom\s*["'](solid-js(\/[\w-]+)?|@solidjs\/web(\/[\w-]+)?|@sluurp\/twist(\/(store|web|jsx-runtime|jsx-dev-runtime))?)["']|@jsxImportSource\s+(solid-js|@solidjs\/web|@sluurp\/twist)\b/;
