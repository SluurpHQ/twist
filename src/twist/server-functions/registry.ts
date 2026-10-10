// Server function identity, declaration metadata and the per-call invocation channel. No codec, no transport: safe
// for any bundle to import. Symbols are registered (Symbol.for) so duplicated module copies agree.

export interface InvokeOptions {
  signal?: AbortSignal;
  keepalive?: boolean;
  priority?: "high" | "low" | "auto";
}
export interface ServerFunctionMetadata {
  readonly method?: "GET" | "POST";
  readonly name?: string;
  readonly [key: string]: unknown;
}
export interface ServerFunction<A extends readonly any[] = any[], T = any> {
  (...args: A): Promise<T>;
  readonly id: string;
  readonly url: string;
}
export type ServerFunctionInvoker<A extends readonly any[] = any[], R = any> = (args: A, options?: InvokeOptions) => R;
export interface ServerFunctionRPC {
  GET<A extends readonly any[], R>(fn: (...args: A) => R): ServerFunction<A, Awaited<R>>;
  decodeResponse<T = unknown>(response: Response): Promise<T | undefined>;
}

export const SERVER_FUNCTION_METADATA = Symbol.for("solid.ServerFunctionMetadata");
export const SERVER_FUNCTION_INVOKE = Symbol.for("solid.ServerFunctionInvoke");
/** Marks the async iterable a `live(fn)` call produces (on the value, so it is known wherever it travels). */
export const LIVE_SOURCE = Symbol.for("solid.LiveSource");
/** The value a live iteration resumes from (the one the page was served with). */
export const LIVE_RESUME_FROM = Symbol.for("solid.LiveResumeFrom");
/** The answer the document already shows for a live call. */
export const LIVE_LOCAL = Symbol.for("solid.LiveLocal");
const SERVER_FUNCTION_RPC = Symbol.for("solid.ServerFunctionRPC");

/** A server function reference's declaration metadata (`{}` for a plain one), or undefined for anything else. */
export function getServerFunctionMetadata(fn: unknown): ServerFunctionMetadata | undefined {
  if (typeof fn !== "function") return undefined;
  return (fn as any)[SERVER_FUNCTION_METADATA] || undefined;
}

export function isServerFunction(fn: unknown): boolean {
  return typeof fn === "function" && !!(fn as any)[SERVER_FUNCTION_METADATA];
}

/** Metadata merged into a reference's own (what `prepareRequest` sees as `context.meta`); returns the reference. */
export function withMeta<F>(fn: F, meta: Record<string, unknown>): F {
  const metadata = getServerFunctionMetadata(fn);
  if (!metadata) throw new Error("withMeta expects a server function reference");
  Object.assign(metadata, meta);
  return fn;
}

const INVOKE_OPTION_REDIRECTS: Record<string, string> = {
  headers:
    "Session-dynamic headers belong to the prepareRequest hook, declaration metadata to " +
    "withMeta(fn, meta), and data belongs in the arguments, where it is serialized, typed, " +
    "and part of the cache key.",
  method: "The method is declaration-scoped: declare the function with GET(fn).",
  body: "The arguments are the body: pass them in the args array.",
  timeout: "Compose timeouts through `signal` with AbortSignal.timeout(ms) (and AbortSignal.any to " + "combine it with a caller signal).",
};

/** One call of a server function with per-call options: `signal`, `keepalive`, `priority`. */
export function invoke<A extends readonly any[], R>(fn: (...args: A) => R, options: InvokeOptions, ...args: A): R {
  const channel = typeof fn === "function" && (fn as any)[SERVER_FUNCTION_INVOKE];
  if (!channel)
    throw new Error(
      isServerFunction(fn)
        ? "invoke: this wrapper does not forward the invocation channel " +
            "(SERVER_FUNCTION_INVOKE). Wrappers that share calls (caches, channels) opt in " +
            "deliberately — a caller's signal cannot own a wire other callers share. Invoke " +
            "the underlying reference directly, or use the wrapper's own per-call idioms."
        : "invoke expects a server function reference (or a wrapper that forwards its " +
            "invocation channel). Per-call options apply at the transport; for a data " +
            "layer's calls, use its per-call options instead.",
    );
  if (options === null || typeof options !== "object") throw new Error("invoke's second argument is the invocation options bag: invoke(fn, { signal }, ...args)");
  for (const key in options)
    if (key !== "signal" && key !== "keepalive" && key !== "priority")
      throw new Error(
        `\`${key}\` is not an invocation option. ` +
          (INVOKE_OPTION_REDIRECTS[key] || "Options here are strictly invocation-scoped (they vary between calls of the " + "same function): signal, keepalive, priority."),
      );
  const picked: InvokeOptions = {};
  if (options.signal !== undefined) picked.signal = options.signal;
  if (options.keepalive !== undefined) picked.keepalive = options.keepalive;
  if (options.priority !== undefined) picked.priority = options.priority;
  return channel(args, picked);
}

/** The transport surface (GET, decodeResponse), filled by whichever half made the first reference. First wins. */
export function provideServerFunctionRPC(rpc: ServerFunctionRPC) {
  (globalThis as any)[SERVER_FUNCTION_RPC] ||= rpc;
}
export function getServerFunctionRPC(): ServerFunctionRPC | undefined {
  return (globalThis as any)[SERVER_FUNCTION_RPC];
}
