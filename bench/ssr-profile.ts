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
  Bun.spawnSync([process.execPath, "--cpu-prof", "--cpu-prof-interval=100", `--cpu-prof-dir=${dir}`, import.meta.path, name, n], { env: { ...process.env, SSR_PROFILE_CHILD: "1" }, stdio: ["inherit", "inherit", "inherit"] });
  const file = readdirSync(dir).find((f) => f.endsWith(".cpuprofile"))!;
  const profile = JSON.parse(readFileSync(join(dir, file), "utf8"));
  console.log(summary(profile, `ssr-${name}`));
  rmSync(dir, { recursive: true });
  // LINES=fn: that function's samples by line of the bundle.
  if (process.env.LINES) {
    const source = readFileSync(join(import.meta.dir, "..", "test", "out", "bench", `ssr-${name}`, "app.js"), "utf8").split("\n");
    const ticks = new Map<number, number>();
    let all = 0;
    for (const n of profile.nodes) {
      if (n.callFrame.functionName !== process.env.LINES) continue;
      for (const t of n.positionTicks ?? []) ticks.set(t.line, (ticks.get(t.line) ?? 0) + t.ticks), (all += t.ticks);
    }
    for (const [line, t] of [...ticks].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${((100 * t) / all).toFixed(1).padStart(5)}%  ${line}: ${source[line - 1]?.trim().slice(0, 130)}`);
  }
}
