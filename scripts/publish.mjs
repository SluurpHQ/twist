// Twist on npm: @sluurp/create-twist (the starter), one package per platform for the compiler's addon (only the one for the machine is installed, as
// Tailwind's Oxide), then @sluurp/twist naming them as optional dependencies. Run by the release workflow with the
// addons gathered in napi/: node scripts/publish.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dry = process.argv.includes("--dry-run");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// A prerelease goes out under its own tag (alpha, beta…), never as `latest`.
const tag = /-([a-z]+)/.exec(pkg.version)?.[1] ?? "latest";
const npm = (args, cwd) => execFileSync("npm", ["publish", "--access", "public", "--tag", tag, ...(dry ? ["--dry-run"] : []), ...args], { cwd, stdio: "inherit", shell: process.platform === "win32" });

/** What npm needs to install a platform's package on that platform only. */
function platformOf(name) {
  const [os, cpu, abi] = name.split("-");
  return { os: [os], cpu: [cpu], ...(os === "linux" ? { libc: [abi === "musl" ? "musl" : "glibc"] } : {}) };
}

const addons = readdirSync(join(root, "napi")).filter((f) => /^twist-compiler\..+\.node$/.test(f));
if (!addons.length) throw new Error("no addons in napi/: build them first");
const optional = {};
for (const file of addons) {
  const name = file.slice("twist-compiler.".length, -".node".length);
  const dir = join(root, "npm", name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(root, "napi", file), join(dir, file));
  const own = {
    name: `@sluurp/twist-compiler-${name}`,
    version: pkg.version,
    description: `Twist's compiler for ${name}.`,
    license: pkg.license,
    repository: pkg.repository,
    main: file,
    files: [file],
    ...platformOf(name),
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(own, null, 2) + "\n");
  npm([], dir);
  optional[own.name] = pkg.version;
}
// The package itself, naming every platform's addon (written for this publish, not kept in the repository).
const original = readFileSync(join(root, "package.json"), "utf8");
writeFileSync(join(root, "package.json"), JSON.stringify({ ...pkg, optionalDependencies: optional }, null, 2) + "\n");
try {
  npm([], root);
} finally {
  writeFileSync(join(root, "package.json"), original);
}
// The starter, at the same version.
const create = join(root, "create");
const starter = readFileSync(join(create, "package.json"), "utf8");
writeFileSync(join(create, "package.json"), starter.replace(/"version": "[^"]+"/, `"version": "${pkg.version}"`));
try {
  npm([], create);
} finally {
  writeFileSync(join(create, "package.json"), starter);
}
