// Hot reload in dev mode: from a saved edit to the page showing it, on React and on our runtime (Twist).
// node bench/hmr.mjs <playwright-core> [edits]; builds and runs the dev server (scripts/dev-server.mjs) on a copy of
// the todos example, once per runtime.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { summary } from "./summary.mjs";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const profile = args.includes("--profile");
const [pw, edits = "15"] = args.filter((a) => a !== "--profile");
const { chromium } = require(pw ?? "playwright-core");
const sluurp = resolve(import.meta.dirname, "..", "..", "..", "..");
const example = resolve(sluurp, "..", "sluurp-examples", "todos", "app");
const runtimes = {
  react: {},
  twist: { SLUURP_REACT: "twist", SLUURP_DOM_SRC: resolve(sluurp, "host", "packages", "dom", "src"), SLUURP_SOLID: "twist" },
  "twist-react-only": { SLUURP_REACT: "twist", SLUURP_DOM_SRC: resolve(sluurp, "host", "packages", "dom", "src") },
};

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
/** A dev server stopped with what it started (the server's executable outlives a plain kill on Windows). */
const stop = (p) => (process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"]) : p.kill());
const rows = {};
let port = 8301;
for (const [name, env] of Object.entries(runtimes)) {
  const dir = mkdtempSync(join(tmpdir(), `hmr-${name}-`));
  const app = join(dir, "app");
  cpSync(example, app, { recursive: true, filter: (p) => !p.includes("node_modules") });
  // (Its packages linked, not copied.)
  symlinkSync(join(example, "node_modules"), join(app, "node_modules"), "junction");
  const server = spawn("node", [join(sluurp, "scripts", "dev-server.mjs"), String(port), "--dir", join(dir, "data"), "--public", app], {
    cwd: sluurp,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}/`;
  // Up when the page answers (the first run builds the host).
  for (let t = Date.now(); ; ) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (Date.now() - t > 600_000) throw new Error(`${name}: no server\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  try {
    await page.waitForSelector("h1", { timeout: 60_000 });
  } catch (e) {
    console.error(name, "never showed the app:", errors.join("\n"), (await page.content()).slice(0, 1500));
    stop(server);
    throw e;
  }
  const file = join(app, "todos.tsx");
  const source = readFileSync(file, "utf8");
  // --profile: the page's CPU profile across the edits, summarised.
  const cdp = profile ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send("Profiler.enable"), await cdp.send("Profiler.setSamplingInterval", { interval: 100 }), await cdp.send("Profiler.start");
  const times = [];
  for (let i = 0; i < +edits; i++) {
    const title = `Todos ${name} ${i}`;
    const t = performance.now();
    writeFileSync(file, source.replace("Todos Collab", title));
    await page.waitForFunction((want) => document.querySelector("h1")?.textContent === want, title, { timeout: 30_000, polling: "raf" });
    times.push(performance.now() - t);
    // (Edits apart, as a person makes them.)
    await new Promise((r) => setTimeout(r, 300));
  }
  if (cdp) console.log(summary((await cdp.send("Profiler.stop")).profile, `hmr ${name}`));
  rows[name] = { "edit to screen, median (ms)": Math.round(median(times)), "fastest (ms)": Math.round(Math.min(...times)), "slowest (ms)": Math.round(Math.max(...times)) };
  await browser.close();
  stop(server);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  port++;
}
console.table(rows);
