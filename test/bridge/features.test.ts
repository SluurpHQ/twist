// Features a build leaves out (modules.js FEATURES): each stand-in in src/off/ exports every name Twist's own modules
// import from the real one, and "nano" swaps exactly those.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FEATURES, SRC, featureFile } from "../../modules.js";

const exportsOf = (file: string) =>
  new Set([...readFileSync(file, "utf8").matchAll(/export\s+(?:declare\s+)?(?:const|let|function|class|type)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]!));

test("each stand-in exports what Twist imports from the module it stands in for", () => {
  for (const mod of Object.values(FEATURES)) {
    const given = exportsOf(join(SRC, "off", mod));
    for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
      for (const [, names] of readFileSync(join(SRC, f), "utf8").matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"\\./${mod.replace(".", "\\.")}"`, "g"))) {
        for (const name of names!.split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!).filter(Boolean))
          expect(given.has(name), `off/${mod} lacks ${name} (imported by ${f})`).toBe(true);
      }
    }
  }
});

test("nano swaps Float, Fragment refs and view transitions, and nothing else", () => {
  for (const mod of Object.values(FEATURES)) expect(featureFile(SRC + mod, "nano")).toBe(SRC + "off/" + mod);
  expect(featureFile(SRC + "core.ts", "nano")).toBe(SRC + "core.ts");
  expect(featureFile(SRC + "float-client.ts", { fragmentRefs: false })).toBe(SRC + "float-client.ts");
  expect(featureFile(SRC + "float-client.ts", undefined)).toBe(SRC + "float-client.ts");
});
