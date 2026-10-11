// A server app's render, profiled: bun bench/ssr-profile.ts [name] [renders] (Bun's sampling profiler, summarised).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summary } from "./summary.mjs";

const [name = "twist", n = "300"] = process.argv.slice(2);
if (process.env.SSR_PROFILE_CHILD) {
  const { render } = await import(join(import.meta.dir, "..", "test", "out", "bench", `ssr-${name}`, "app.js"));
  for (let i = 0; i < +n; i++) render();
} else {
  const dir = mkdtempSync(join(tmpdir(), "ssr-prof-"));
  Bun.spawnSync([process.execPath, "--cpu-prof", `--cpu-prof-dir=${dir}`, import.meta.path, name, n], { env: { ...process.env, SSR_PROFILE_CHILD: "1" }, stdio: ["inherit", "inherit", "inherit"] });
  const file = readdirSync(dir).find((f) => f.endsWith(".cpuprofile"))!;
  console.log(summary(JSON.parse(readFileSync(join(dir, file), "utf8")), `ssr-${name}`));
  rmSync(dir, { recursive: true });
}
