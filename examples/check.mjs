// An example app checked in a real browser: served by Vite (dev, or the build's preview), clicked through.
// node examples/check.mjs <example> [dev|preview] [playwright-core]
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const [name, mode = "preview", pw = "playwright-core"] = process.argv.slice(2);
const dir = join(import.meta.dirname, name);
const { chromium } = createRequire(import.meta.url)(pw);
const port = 4410 + (mode === "dev" ? 0 : 1);
if (mode === "preview") spawnSync("npx", ["vite", "build"], { cwd: dir, stdio: "inherit", shell: true });
const server = spawn("npx", ["vite", mode === "dev" ? "" : "preview", "--port", String(port), "--strictPort"].filter(Boolean), { cwd: dir, shell: true });
const stop = () => (process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]) : server.kill());
try {
  const url = `http://localhost:${port}/`;
  for (let t = Date.now(); ; ) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (Date.now() - t > 60_000) throw new Error("no server");
    await new Promise((r) => setTimeout(r, 300));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  try {
    await page.waitForSelector("h1", { timeout: 15_000 });
  } catch (e) {
    console.log("never drawn:", errors.join("\n"), (await page.content()).slice(0, 800));
    throw e;
  }
  const text = () => page.evaluate(() => document.querySelector("main")?.innerText.replace(/\s+/g, " ").trim());
  console.log("first:", await text());
  for (let i = 0; i < 3; i++) await page.click("button >> nth=0");
  await page.click("button >> nth=1");
  console.log("after clicks:", await text());
  if (errors.length) console.log("errors:", errors.join("\n"));
  await browser.close();
} finally {
  stop();
}
