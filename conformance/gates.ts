// React's `// @gate <expression>` pragmas: a test applies only where its expression holds for the flags React
// ships with. We are measured as stable React 19 (React's own feature flags, the stable channel, development).
import { join } from "node:path";

const g = globalThis as any;
g.__DEV__ = true;
g.__EXPERIMENTAL__ = false;
g.__VARIANT__ = false;
g.__PROFILE__ = false;
g.__TEST__ = true;

// React's flags file is Flow; each flag is a plain `export const name: type = value;`, read and evaluated here.
const feature: Record<string, any> = {};
const text = await Bun.file(join(import.meta.dir, "react-tests", "shared", "ReactFeatureFlags.js")).text().catch(() => "");
for (const m of text.matchAll(/export const (\w+)(?:\s*:\s*[^=]+)?\s*=\s*([^;]+);/g)) {
  try {
    feature[m[1]!] = new Function("__EXPERIMENTAL__", "__DEV__", "__PROFILE__", "__VARIANT__", `return (${m[2]});`)(false, true, false, false);
  } catch {
    feature[m[1]!] = false;
  }
}

const base: Record<string, any> = {
  channel: "stable",
  modern: false,
  classic: false,
  source: true,
  www: false,
  fb: false,
  xplat: false,
  persistent: false,
  enableSuspenseList: false,
  enableLegacyHidden: false,
  enableSuspendingDuringWorkLoop: false,
  shouldUseFizzExternalRuntime: false,
  enableUseSyncExternalStoreShim: true,
  ...feature,
  __DEV__: true,
  build: "development",
  experimental: false,
  stable: true,
  variant: false,
  FIXME: false,
  TODO: false,
};
// A flag React no longer has reads as off, as a missing one would make the test not apply.
export const flags = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : false), has: () => true });

/** Whether `expr` (a @gate expression) holds. */
export function holds(expr: string): boolean {
  try {
    return !!new Function("flags", `with (flags) { return (${expr}); }`)(flags);
  } catch {
    return false;
  }
}

/** A test source with each gated `it(`/`test(` made to skip when its gate does not hold. */
export function gateSource(code: string): string {
  return code.replace(/\/\/ @gate ([^\n]+)\n(\s*)(it|test)(\.only)?\(/g, (_m, expr, ws, fn) =>
    `\n${ws}(globalThis.__holds(${JSON.stringify(expr.trim())}) ? ${fn} : ${fn}.skip)(`,
  );
}

g.__holds = holds;
g.gate = (fn: any) => (typeof fn === "function" ? !!fn(flags) : holds(String(fn)));
