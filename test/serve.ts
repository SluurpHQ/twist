// Serves test/out/ on http://127.0.0.1:8820, built again on each load of the page.
import { join } from "node:path";

const out = join(import.meta.dir, "out");
Bun.serve({
  port: 8820,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") Bun.spawnSync([process.execPath, join(import.meta.dir, "build.ts")], { stdout: "inherit", stderr: "inherit" });
    const file = Bun.file(join(out, path === "/" ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log("checks on http://127.0.0.1:8820/");
