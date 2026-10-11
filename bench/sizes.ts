// What each module adds to a built app, minified: bun bench/sizes.ts <app> (an app bench/build.ts knows), largest first.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2] ?? "twist";
const meta = JSON.parse(readFileSync(join(import.meta.dir, "..", "test", "out", "bench", name, "meta.json"), "utf8"));
const inputs = Object.values(meta.outputs as Record<string, any>)[0].inputs as Record<string, { bytesInOutput: number }>;
const rows = Object.entries(inputs)
  .map(([file, i]) => [file.replace(/.*node_modules[\\/]/, "").replace(/.*[\\/]src[\\/]/, "src/"), i.bytesInOutput] as const)
  .sort((a, b) => b[1] - a[1]);
const total = rows.reduce((n, [, b]) => n + b, 0);
for (const [file, b] of rows.slice(0, 25)) console.log((b / 1024).toFixed(1).padStart(6), "KB", file);
console.log((total / 1024).toFixed(1).padStart(6), "KB total");
