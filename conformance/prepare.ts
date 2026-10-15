// React's own tests, fetched (a sparse clone of facebook/react at REF) and copied into react-tests/ with their
// `// @gate` pragmas applied for stable React 19. `bun prepare.ts`, then `bun test ./react-tests`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gateSource } from "./gates.ts";

const REF = process.env.REACT_REF ?? "main";
const here = import.meta.dir;
const clone = join(tmpdir(), "sluurp-react-src");
const PARTS = ["packages/react/src/__tests__", "packages/react-dom/src/__tests__", "packages/react-dom/src/test-utils", "packages/internal-test-utils", "packages/shared", "scripts/jest", "packages/use-sync-external-store/src/__tests__", "packages/dom-event-testing-library"];

const git = (args: string[], cwd?: string) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!r.success) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
};
if (!existsSync(join(clone, ".git"))) git(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/facebook/react.git", clone]);
git(["sparse-checkout", "set", ...PARTS], clone);
if (REF !== "main") git(["fetch", "-q", "--depth", "1", "origin", REF], clone), git(["checkout", "-q", "FETCH_HEAD"], clone);
const at = git(["rev-parse", "--short", "HEAD"], clone);

const out = join(here, "react-tests");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Setup checks the harness cannot meet, taken out (the tests after them still run): Bun loads one copy of a module,
// so jest.isolateModules cannot give a second React DOM.
const SETUP_ONLY: [RegExp, string][] = [
  [/\n\s*expect\(OuterReactDOMClient\)\.not\.toBe\(InnerReactDOMClient\);/g, "\n"],
  // React's own jest helpers, by the path they have in React's repository: the copy here instead.
  [/(['"])(?:\.\.\/)+scripts\/jest\//g, "$1../scripts/jest/"],
  // The engine's own wording of a TypeError (V8's in React's tests, JavaScriptCore's under Bun): either accepted.
  [/\.toThrow\(\s*"Cannot read properties of undefined \(reading '(\w+)'\)"\s*\)/g, ".toThrow(/Cannot read properties of undefined \\(reading '$1'\\)|undefined is not an object \\(evaluating '[^']*\\.$1\\b[^']*'\\)/)"],
  [/\/Cannot assign to read only property\.\*\//g, "/Cannot assign to read only property.*|Attempted to assign to readonly property/"],
];

/**
 * Jest calls a function given to expect(…).rejects/.resolves; Bun's expect wants the promise (and test files get
 * Bun's own expect, so no global can stand in). Such calls rewritten to call the function: expect((fn)()).rejects.
 */
function promiseExpectations(code: string): string {
  let out = "";
  let at = 0;
  for (let i = code.indexOf("expect(", 0); i >= 0; i = code.indexOf("expect(", i + 1)) {
    if (/[\w$.]/.test(code[i - 1] ?? "")) continue;
    const open = i + "expect".length;
    // The matching parenthesis, past strings, templates and comments.
    let depth = 0, j = open, quote = "";
    for (; j < code.length; j++) {
      const c = code[j]!;
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "/" && code[j + 1] === "/") j = code.indexOf("\n", j);
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    if (j >= code.length) break;
    // (A trailing comma dropped: the argument is wrapped in parentheses below.)
    const arg = code.slice(open + 1, j).replace(/,\s*$/, "");
    // .resolves.not.toThrow(): Jest passes once the promise resolves. Bun's .resolves does not always wait for it, so
    // the promise is awaited as the value.
    const settles = /^\s*\.\s*resolves\s*\.\s*not\s*\.\s*toThrow\(\)/.exec(code.slice(j + 1));
    if (settles) {
      const promise = /^\s*(async\b|function\b|\([^()]*\)\s*=>|\w+\s*=>)/.test(arg)
        ? "(" + arg + ")()"
        : /^\s*[\w$]+\s*$/.test(arg)
          ? "(typeof " + arg + " === \"function\" ? " + arg + "() : " + arg + ")"
          : "(" + arg + ")";
      out += code.slice(at, i) + "expect(await " + promise + ").toSatisfy(() => true)";
      at = j + 1 + settles[0].length;
      continue;
    }
    if (/^\s*\.\s*(rejects|resolves)\b/.test(code.slice(j + 1)) && /^\s*(async\b|function\b|\([^()]*\)\s*=>|\w+\s*=>)/.test(arg)) {
      out += code.slice(at, open + 1) + "(" + arg + ")()";
      at = j;
      continue;
    }
    // A function held in a variable: called, as Jest does with one.
    if (/^\s*\.\s*(rejects|resolves)\b/.test(code.slice(j + 1)) && /^\s*[\w$]+\s*$/.test(arg)) {
      out += code.slice(at, open + 1) + "(typeof " + arg + " === \"function\" ? " + arg + "() : " + arg + ")";
      at = j;
      continue;
    }
    // An inline snapshot: through setup.ts, which prints DOM nodes as Jest's DOM printer does.
    const snap = /^\s*\.\s*toMatchInlineSnapshot\(/.exec(code.slice(j + 1));
    if (snap) {
      out += code.slice(at, i) + "globalThis.__inlineSnapshot(" + arg + ")(";
      at = j + 1 + snap[0].length;
    }
  }
  return out + code.slice(at);
}

// React's sources are Flow-typed: the types taken out, as React's own build does.
const flowRemoveTypes = (await import("flow-remove-types")).default;
const unflow = (code: string) => flowRemoveTypes(code, { all: true }).toString();

function copy(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    const a = join(from, f), b = join(to, f);
    if (statSync(a).isDirectory()) copy(a, b);
    else if (/-test(\.internal)?\.js$/.test(f)) {
      let code = promiseExpectations(unflow(gateSource(readFileSync(a, "utf8"))));
      for (const [re, to] of SETUP_ONLY) code = code.replace(re, to);
      // `this` at module level makes Bun take the file for CommonJS, where its injected JSX import does not parse.
      if (/\bthis\b/.test(code) && !/^\s*(import|export)\s/m.test(code)) code += "\nexport {};\n";
      writeFileSync(b, code);
    } else if (f.endsWith(".js")) writeFileSync(b, unflow(readFileSync(a, "utf8")));
    else writeFileSync(b, readFileSync(a));
  }
}
copy(join(clone, "packages/react/src/__tests__"), join(out, "react"));
copy(join(clone, "packages/react-dom/src/__tests__"), join(out, "react-dom"));
// Helpers the tests import by path: React DOM's test-utils (FizzTestUtils…) and internal-test-utils' own files.
copy(join(clone, "packages/react-dom/src/test-utils"), join(out, "test-utils"));
copy(join(clone, "packages/internal-test-utils"), join(out, "internal-test-utils"));
copy(join(clone, "scripts/jest"), join(out, "scripts", "jest"));
copy(join(clone, "packages/shared"), join(out, "shared"));
copy(join(clone, "packages/use-sync-external-store/src/__tests__"), join(out, "use-sync-external-store"));
// React's event-simulation helpers (dom-event-testing-library), which some tests import by package name.
copy(join(clone, "packages/dom-event-testing-library"), join(out, "dom-event-testing-library"));
// Tests set flags on this module (Jest's CommonJS allows it; an ES module's exports are read-only): CommonJS here.
const flagsFile = join(out, "shared", "ReactFeatureFlags.js");
writeFileSync(
  flagsFile,
  readFileSync(flagsFile, "utf8")
    .replace(/^import[^\n]*\n/gm, "")
    .replace(/^export const (\w+)\s*=/gm, "const $1 = exports.$1 =")
    .replace(/^export (type|opaque)[^\n]*\n/gm, ""),
);
writeFileSync(join(out, "REF"), at + "\n");
console.log(`React's tests at ${at} in react-tests/`);

// react-redux's own suite (its public behaviour: hooks, components, integration), into redux-tests/. Its type
// tests, its React Server Components test and the files testing its internal connect modules (@internal/connect/…,
// which our react-redux does not have: it implements the public API) are left out.
const REDUX_REF = process.env.REACT_REDUX_REF ?? "master";
const rclone = join(tmpdir(), "sluurp-react-redux-src");
if (!existsSync(join(rclone, ".git"))) git(["clone", "-q", "--depth", "1", "https://github.com/reduxjs/react-redux.git", rclone]);
if (REDUX_REF !== "master") git(["fetch", "-q", "--depth", "1", "origin", REDUX_REF], rclone), git(["checkout", "-q", "FETCH_HEAD"], rclone);
const rout = join(here, "redux-tests");
rmSync(rout, { recursive: true, force: true });
for (const part of ["components", "hooks", "integration", "connect"]) {
  const from = join(rclone, "test", part);
  mkdirSync(join(rout, part), { recursive: true });
  for (const f of readdirSync(from)) {
    if (f.includes("-rsc")) continue;
    const code = readFileSync(join(from, f), "utf8");
    if (/import \{[^}]*\} from ['"]@internal\/connect\//.test(code)) continue;
    writeFileSync(join(rout, part, f), code);
  }
}
writeFileSync(join(rout, "REF"), git(["rev-parse", "--short", "HEAD"], rclone) + "\n");
console.log("react-redux's tests in redux-tests/");

// The tests set aside as not ours (not-ours.ts) marked skipped.
await import("./apply-not-ours.ts");
