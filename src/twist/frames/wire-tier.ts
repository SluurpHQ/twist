// Ported from Solid's frames/src/wire-tier.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
/** `@solidjs/web/frames/wire` — the frames client's LIVE WIRE tier (frames */
// The eager frames client — the SHARED instance the app runs (external in the
import { applyFrameResponse } from "./client.ts";
// The transport's have-list header name and budget — two literals, bundled
import { FRAME_HAVE_BUDGET, FRAME_HAVE_HEADER } from "./frame-transport.ts";
// The server-function wire layer — the SHARED built instance (external:
import {
  ChunkReader,
  LIVE_WIRE,
  frameAddress,
  isEventStream
} from "../server-functions/shared.ts";

import type { FrameHost, FrameHostOptions } from "./frame-client.ts";

/** The host the handler hands over: the frame host, carrying the lazily */
type Host = FrameHost & Pick<FrameHostOptions, "prepareData">;

/** A live loop's wire slot (see `LIVE_WIRE` in server-functions/shared.ts). */
interface WireSlot {
  connection: Connection;
  open(body: ReadableStream<Uint8Array> | null): {
    next(): Promise<IteratorResult<string>>;
    cancel?(reason?: unknown): unknown;
  };
}

/** The connection slot the loop renews per connect (`wire.connection`). */
interface Connection {
  ended?: Promise<ConnectionEnd>;
  cancel?(reason: Error): void;
  done?: boolean;
}

/** How a connection ended, as the loop reads it off `connection.ended`. */
interface ConnectionEnd {
  open: number;
  error: Error;
  sweep(): void;
  close(): void;
}

// One live connection per address per host (the handler's `connections`):
const connections = new WeakMap<object, Map<string, Connection>>();
const connectionsOf = (host: object) => {
  let map = connections.get(host);
  if (!map) connections.set(host, (map = new Map()));
  return map;
};

// The have-list ledger, per MOUNT (RFC 11 §9.5): what the mount shows, by
const ledgers = new WeakMap<object, Record<string, string> | undefined>();

/** Ledger upkeep for an applied content record (the frame's `#recordHave` @internal */
export function have(
  frame: object,
  key: string,
  record: { digest?: string; holes?: Record<string, string> }
): void {
  if (key === "") {
    ledgers.set(
      frame,
      record.digest === undefined ? undefined : { "": record.digest, ...record.holes }
    );
    return;
  }
  const ledger = ledgers.get(frame);
  if (!ledger || !record || record.digest === undefined) return;
  ledger[key] = record.digest;
  if (record.holes) Object.assign(ledger, record.holes);
}

/** The have-list of what a mount shows — the server-minted digests of the @internal */
export function haveOf(frame: object): Record<string, string> | undefined {
  return ledgers.get(frame);
}

/** Encodes a have-list for the header: `key=digest` pairs, comma-joined @internal */
export function encodeHaveList(have: Record<string, string>): string | undefined {
  let out = "";
  for (const key in have) {
    const digest = have[key];
    if (typeof digest !== "string") continue;
    out += (out ? "," : "") + key + "=" + digest;
    if (out.length > FRAME_HAVE_BUDGET) return undefined;
  }
  return out || undefined;
}

/** What a `live` (re)connect of a call resumes from (the handler's @internal */
export function resume(
  host: FrameHost,
  info: { id: string; args: unknown[] },
  versions: Map<string, number>
): { position: string; headers?: Record<string, string> } | undefined {
  const address = frameAddress(info.id, info.args);
  const version = versions.get(address);
  const frame = host.get(address);
  const list = frame && ledgers.get(frame);
  if (version === undefined && !list) return undefined;
  const encoded = list && encodeHaveList(list);
  return {
    position: String(version || 0),
    headers: encoded ? { [FRAME_HAVE_HEADER]: encoded } : undefined
  };
}

/** Supersession (§9.5, Client face 4): a newer version for the address from @internal */
export function cancel(host: object, address: string): void {
  const map = connections.get(host);
  const connection = map && map.get(address);
  if (connection) {
    map.delete(address);
    connection.cancel!(new Error("Superseded by a newer response for the address."));
  }
}

/** The live arm of the handler's `handle` (§9.5, Client face 2): the binding @internal */
export function connect(
  response: Response,
  wire: WireSlot,
  address: string,
  binding: unknown,
  host: Host,
  bump: (address: string) => number,
  begin: (address: string, version: number) => void
): unknown {
  const connection = wire.connection;
  const map = connectionsOf(host);
  const current = map.get(address);
  if (current && !current.done) {
    connection.ended = current.ended;
    const body = response.body;
    if (body) body.cancel().catch(() => {});
    return binding;
  }
  const version = bump(address);
  begin(address, version);
  const inner = isEventStream(response) ? wire.open(response.body) : new ChunkReader(response.body);
  // The body has drained: the transport's sweep follows at once and is not
  let drained = false;
  let cancelled: Error | undefined;
  const reader = {
    next: () =>
      inner.next().then(result => {
        if (result.done) drained = true;
        return result;
      })
  };
  // The frames this connection has begun (`start`) and not yet ended, as
  const open = new Map<string, number>();
  const target = {
    prepareData: host.prepareData,
    apply(chunk: any) {
      if (drained) return;
      if (chunk.type === "start") open.set(chunk.id, chunk.version);
      else if (chunk.type === "complete" || (chunk.type === "error" && !chunk.key))
        open.delete(chunk.id);
      host.apply(chunk);
    }
  };
  let resolveEnd!: (end: ConnectionEnd) => void;
  connection.ended = new Promise(resolve => (resolveEnd = resolve));
  connection.cancel = reason => {
    if (cancelled !== undefined) return;
    cancelled = reason;
    // The reader owns the body's lock; cancelling through it ends the drain
    try {
      const r = inner.cancel && inner.cancel(reason);
      if (r && typeof (r as any).then === "function")
        (r as Promise<unknown>).then(undefined, () => {});
    } catch {}
  };
  const end = (error?: Error) => {
    const dead = error || cancelled || new Error("Frame stream ended before the frame completed.");
    connection.done = true;
    resolveEnd({
      open: open.size,
      error: dead,
      sweep: () => {
        for (const [id, version] of open)
          host.apply({
            type: "error",
            id,
            version,
            error: { message: String(dead && dead.message) }
          });
      },
      close: () => {}
    });
  };
  applyFrameResponse(
    response,
    target as any,
    { as: address, version, [LIVE_WIRE]: reader } as any
  ).then(() => end(), end);
  map.set(address, connection);
  connection.ended.then(() => {
    if (map.get(address) === connection) map.delete(address);
  });
  return binding;
}
