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
  "solid-js": ["twist/index.ts", "twist/server-solid.ts"],
  "solid-js/store": ["twist/index.ts", "twist/server-solid.ts"],
  "@solidjs/web": ["twist/web.ts", "twist/server.ts"],
  "@solidjs/web/jsx-runtime": ["twist/jsx/client/jsx-runtime.ts", "twist/jsx/server/jsx-runtime.ts"],
  "@solidjs/web/jsx-dev-runtime": ["twist/jsx/client/jsx-dev-runtime.ts", "twist/jsx/server/jsx-dev-runtime.ts"],
  "@sluurp/twist": ["twist/index.ts", "twist/server-solid.ts"],
  "@sluurp/twist/web": ["twist/web.ts", "twist/server.ts"],
  "@sluurp/twist/jsx-runtime": ["twist/jsx/client/jsx-runtime.ts", "twist/jsx/server/jsx-runtime.ts"],
  "@sluurp/twist/jsx-dev-runtime": ["twist/jsx/client/jsx-dev-runtime.ts", "twist/jsx/server/jsx-dev-runtime.ts"],
  "@sluurp/twist/hot": ["twist/hot.ts", "twist/hot.ts"],
  "@sluurp/twist/bridge": ["twist/react-bridge.ts", "twist/react-bridge-server.ts"],
};

/** Signals, for code written on them directly. */
export const SIGNALS = { "@sluurp/signals": ["signals.js", "signals.js"] };

/** The folder Twist's sources are in (forward slashes: as bundlers name modules). */
export const SRC = fileURLToPath(new URL("./src/", import.meta.url)).replace(/\\/g, "/");

/** The file answering `name` from `table` (the browser's, or the server's), or undefined. */
export const fileFor = (table, name, server = false) => (table[name] ? SRC + table[name][server ? 1 : 0] : undefined);

/** Whether a file is written Solid-style: it imports Solid's API, or names it as its JSX. */
export const SOLID_STYLE = /\bfrom\s*["'](solid-js|@solidjs\/web|@sluurp\/twist)(\/[\w-]+)?["']|@jsxImportSource\s+(solid-js|@solidjs\/web|@sluurp\/twist)\b/;
