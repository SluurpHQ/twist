#!/usr/bin/env node
// A new Twist app in the folder named (my-app by default), from template/.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "my-app");
if (existsSync(dir) && readdirSync(dir).length) {
  console.error(`${dir} is not empty.`);
  process.exit(1);
}
cpSync(join(import.meta.dirname, "template"), dir, { recursive: true });
const pkg = join(dir, "package.json");
writeFileSync(pkg, readFileSync(pkg, "utf8").replace('"twist-app"', JSON.stringify(basename(dir))));
console.log(`Made ${dir}. Next:\n\n  cd ${basename(dir)}\n  npm install\n  npm run dev\n`);
