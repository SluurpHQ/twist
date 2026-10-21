// The compile pass's addon for this platform, built and put beside napi/index.js: node scripts/build-compiler.mjs [--release]
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { platformName } from "../napi/platform.js";

const root = resolve(import.meta.dirname, "..");
const release = process.argv.includes("--release");
const windows = process.platform === "win32";
const cargo = (args) => spawnSync("cargo", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
if (cargo(["build", "-p", "twist-compiler-napi", ...(release ? ["--release"] : [])]).status !== 0) process.exit(1);
// Where Cargo builds, as it says (a .cargo/config.toml above may name a shared folder).
const target = JSON.parse(cargo(["metadata", "--format-version", "1", "--no-deps"]).stdout).target_directory;
const lib = windows ? "twist_compiler_napi.dll" : process.platform === "darwin" ? "libtwist_compiler_napi.dylib" : "libtwist_compiler_napi.so";
// (Copied only when it changed: a process may have the current one loaded, which Windows will not let be replaced.)
const from = join(target, release ? "release" : "debug", lib);
const to = join(root, "napi", `twist-compiler.${platformName()}.node`);
if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to))) copyFileSync(from, to);
console.log("built", `napi/twist-compiler.${platformName()}.node`);
