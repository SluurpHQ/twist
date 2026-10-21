// The server runtime as the server tests import it (@twist/web-server), and, with TWIST_SSR_RECORD=<folder>, every
// render's HTML kept there, per test file, in order: for ssr-compare.ts to set one way of rendering against another.
export * from "../../src/twist/server.ts";
import * as server from "../../src/twist/server.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const folder = process.env.TWIST_SSR_RECORD;
const testFile = process.argv.find((a) => /\.(test|spec)\.[jt]sx?$/.test(a)) ?? "unknown";
const renders: { kind: string; html: string }[] = [];
const name = testFile.replace(/\\/g, "/").replace(/^.*solid-tests[^/]*\//, "").replace(/[^\w.-]+/g, "_");
// (Written at each render: bun test ends a file's process without "exit".)
const save = () => {
  mkdirSync(folder!, { recursive: true });
  writeFileSync(join(folder!, name + ".json"), JSON.stringify(renders, null, 1));
};
const keep = (kind: string, html: unknown) => {
  renders.push({ kind, html: String(html) });
  save();
};

/** A stream's output as it goes out: through pipe (a Node writable), pipeTo (a web one) or then (the whole string). Kept
 * at the place it started in, not where it finished: streams running together finish in either order. */
function recorded(stream: any) {
  if (!stream || typeof stream !== "object") return stream;
  let text = "";
  const at = renders.push({ kind: "stream", html: "" }) - 1;
  const done = () => ((renders[at]!.html = text), save());
  const pipe = stream.pipe?.bind(stream);
  if (pipe)
    stream.pipe = (w: any) =>
      pipe({
        ...w,
        write: (chunk: any, ...rest: any[]) => ((text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)), w.write(chunk, ...rest)),
        end: (...rest: any[]) => (done(), w.end?.(...rest)),
      });
  const pipeTo = stream.pipeTo?.bind(stream);
  if (pipeTo)
    stream.pipeTo = (ws: WritableStream) => {
      const decode = new TextDecoder();
      const tee = new TransformStream({ transform: (c, ctl) => ((text += typeof c === "string" ? c : decode.decode(c, { stream: true })), ctl.enqueue(c)), flush: done });
      void tee.readable.pipeTo(ws);
      return pipeTo(tee.writable);
    };
  const then = stream.then?.bind(stream);
  if (then) stream.then = (ok: any, no: any) => then((html: string) => ((text = html), done(), ok ? ok(html) : html), no);
  return stream;
}

export const renderToString: typeof server.renderToString = folder
  ? (code, options) => {
      const html = server.renderToString(code, options);
      keep("string", html);
      return html;
    }
  : server.renderToString;
export const renderToStream: typeof server.renderToStream = folder ? (code, options) => recorded(server.renderToStream(code, options)) : server.renderToStream;
