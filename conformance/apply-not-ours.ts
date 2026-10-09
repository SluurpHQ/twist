// Marks the tests listed in not-ours.ts as skipped in the prepared test files (run by prepare.ts; `bun apply-not-ours.ts`
// on its own after editing the list). Each becomes `it.skip(` with a comment saying why.
import { join } from "node:path";
import { NOT_OURS } from "./not-ours.ts";

const here = import.meta.dir;
let marked = 0;
for (const [file, tests] of Object.entries(NOT_OURS)) {
  const path = join(here, "react-tests", file);
  let src = await Bun.file(path).text();
  for (const [title, why] of Object.entries(tests)) {
    const quoted = [`'${title.replace(/'/g, "\\'")}'`, `"${title.replace(/"/g, '\\"')}"`, `'${title}'`];
    let at = -1;
    for (const q of quoted) if ((at = src.indexOf(q)) >= 0) break;
    if (at < 0) {
      // (A name the server integration helpers make: they skip it themselves.)
      if (!src.includes("itRenders(")) console.warn(`not found in ${file}: ${title}`);
      continue;
    }
    // The call it is the first argument of: from the start of its line (or the line before) to the opening "(".
    const open = src.lastIndexOf("(", at);
    let lineStart = src.lastIndexOf("\n", open) + 1;
    if (src.slice(lineStart, open).trim() === "") lineStart = src.lastIndexOf("\n", lineStart - 2) + 1;
    const callee = src.slice(lineStart, open);
    if (callee.includes("it.skip") && !callee.includes("?")) continue;
    const indent = /^\s*/.exec(callee)![0];
    src = src.slice(0, lineStart) + `${indent}// Not ours: ${why}\n${indent}it.skip` + src.slice(open);
    marked++;
  }
  await Bun.write(path, src);
}
// The server integration helpers make each test's name at run time: they skip the listed names themselves.
const utils = join(here, "react-tests", "react-dom", "utils", "ReactDOMServerIntegrationTestUtils.js");
let u = await Bun.file(utils).text();
if (!u.includes("globalThis.__notOurs")) {
  u = u.replace(/\bit\(`/g, "itUnlessNotOurs(`");
  u = "// Not ours (see not-ours.ts): the listed names skipped.\nconst itUnlessNotOurs = (name, fn) => (globalThis.__notOurs?.has(name) ? it.skip : it)(name, fn);\n" + u;
  await Bun.write(utils, u);
}
console.log(`${marked} tests set aside`);
