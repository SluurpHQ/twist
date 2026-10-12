// Frame streams over HTTP, the client half: a frame-tagged server-function response pumped chunk by chunk into a
// frame host, and the handler that turns such responses into bindings (one mount per function, one store per
// call address). Same framing as server functions. (Solid's frames/frame-transport.)
// @ts-nocheck
import {
  ChunkReader,
  ERROR_HEADER,
  LIVE_WIRE,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  deliverFlightData,
  deserializeStream,
  frameAddress,
  getServerFunctionsCodec,
  hasFlightMetadata,
} from "../server-functions/shared.ts";
import { observeFrameApply } from "../observe.ts";
import { prepareTier, tierLoads } from "./frame-client.ts";

/** Tags a Response as a frame stream; its value is the producing frame's id. */
export const FRAME_STREAM_HEADER = "X-Frame-Stream";
/** The client tiers a frame stream needs (`bind,regions,assets,trace,wire`), so their loads start before the body. */
export const FRAME_TIERS_HEADER = "X-Frame-Tiers";
/** A live resume's have-list: the digests the client holds (`""`, `lh:N`, `lha:N`, `pl-N`). */
export const FRAME_HAVE_HEADER = "X-Frame-Have";
export const FRAME_HAVE_BUDGET = 4096;

/** A have-list header read back (malformed entries skipped); undefined when empty. */
export function decodeHaveList(text: string | null | undefined): Record<string, string> | undefined {
  if (!text) return undefined;
  const have = {};
  let any = false;
  for (const entry of text.split(",")) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const digest = entry.slice(eq + 1).trim();
    if (!/^[0-9a-f]{16}$/.test(digest)) continue;
    have[entry.slice(0, eq).trim()] = digest;
    any = true;
  }
  return any ? have : undefined;
}

export function isFrameStreamResponse(response: Response): boolean {
  return response.headers.has(FRAME_STREAM_HEADER);
}

/** A frame-stream response read to its end into `host`; resolves with the id it was applied under. */
export const applyFrameResponse = async function (response, host, options: any = {}) {
  const observation = observeFrameApply(response);
  if (!observation) return applyFrames(response, host, options);
  let applied;
  try {
    applied = await applyFrames(response, host, options, observation);
  } catch (error) {
    observation.end(error);
    throw error;
  }
  observation.end();
  return applied;
};

/**
 * `as` remaps the producer's root id onto the client's own; `version` restamps the chunks (a number, or one per
 * frame); `onOutcome` gets each `outcome` chunk's payload (a single-flight envelope).
 */
function applyFrames(response, host, options: any = {}, observation?) {
  const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
  response.headers.get(FRAME_TIERS_HEADER)?.split(",").forEach(prepareTier);
  const as = options.as;
  const version = options.version;
  const perFrame = typeof version === "function" ? new Map() : null;
  const reader = options[LIVE_WIRE] || new ChunkReader(response.body);
  // Frames begun and not ended: one still open when the body ends was cut off.
  const open = new Map();
  const errorRecord = (id, error) => ({ type: "error", id, version: open.get(id), error: { message: String(error && error.message) } });
  const drain = async () => {
    let result = await reader.next();
    while (!result.done) {
      const chunk = JSON.parse(result.value);
      if (chunk.type === "outcome") {
        if (options.onOutcome) options.onOutcome(chunk.payload);
      } else {
        const wireId = chunk.id;
        if (as !== undefined && chunk.id === rootId) chunk.id = as;
        if (perFrame) {
          let v = perFrame.get(chunk.id);
          if (v === undefined) perFrame.set(chunk.id, (v = version(chunk.id)));
          chunk.version = v;
        } else if (version !== undefined) chunk.version = version;
        if (chunk.type === "start") open.set(chunk.id, chunk.version);
        else if (chunk.type === "complete" || (chunk.type === "error" && !chunk.key)) open.delete(chunk.id);
        if (observation) observation.chunk(chunk, wireId);
        const needs = chunk.tiers?.map(prepareTier) || [];
        // A chunk that reads data waits for the decoder (and any tier it names); later chunks queue behind it.
        if (chunk.type === "data" || (chunk.type === "slot" && Object.values(chunk.args).some((v: any) => v && v.$ref))) await Promise.all([host.prepareData?.(), ...needs]);
        host.apply(chunk);
      }
      result = await reader.next();
    }
  };
  const end = (error) => {
    if (error === undefined) for (const id of open.keys()) host.apply(errorRecord(id, new Error("Frame stream ended before the frame completed.")));
  };
  return drain().then(
    () => {
      end(undefined);
      return as !== undefined ? as : rootId;
    },
    (error) => {
      end(error);
      throw error;
    },
  );
}

/** Brands an inline-rendered server component with its function id. */
export const SERVER_COMPONENT = /*#__PURE__*/ Symbol.for("solid.server-component");
/** The server component behind an inline-render wrap. */
export const SERVER_COMPONENT_SOURCE = /*#__PURE__*/ Symbol.for("solid.server-component-source");
/** The call's wire address (`frameAddress`). */
export const SERVER_COMPONENT_ADDRESS = /*#__PURE__*/ Symbol.for("solid.server-component-address");
/** On a resolved binding: `{ component, address }` (the mount identity, and the call's store). */
export const COMPONENT_BINDING = /*#__PURE__*/ Symbol.for("solid.component-binding");

/** `address` NUL `version`: one staged response for an address. */
const CONTENT_TOKEN = "\u0000";
export function contentAddress(token: string): string {
  return token.split(CONTENT_TOKEN)[0];
}

/** The live handler's staged content by token: `preview` (in the transition's compute), `commit` (in its effect). */
export const stagedContent = { preview(token: string) {}, commit(token: string) {} };

// The active handler's resolver (one at a time): how a flight reference finds the binding a call site holds.
let resolveServerComponent;
// The call behind each address (`{ id, meta, args, retry }`): how an errored address is asked again.
const calls = new Map();
export function callFor(address: string) {
  return calls.get(address);
}

// The document serializer's registry prefix (installed by the sink; client bundles never carry the bootstrap).
let serverComponentRegistryExpr;
export function setServerComponentBootstrap(resolve: (ctx: unknown) => string) {
  serverComponentRegistryExpr = resolve;
}

function parseServerComponent(value, ctx) {
  return { id: ctx.parse(value[SERVER_COMPONENT]), address: ctx.parse(value[SERVER_COMPONENT_ADDRESS]) };
}
/** A server component crossing a serialization boundary: a reference (`_$SC.r(id, address)`), never its markup. */
export const ServerComponentPlugin = {
  tag: "solid/server-component",
  test(value) {
    return typeof value === "function" && SERVER_COMPONENT in value;
  },
  parse: {
    sync: parseServerComponent,
    async async(value, ctx) {
      return { id: await ctx.parse(value[SERVER_COMPONENT]), address: await ctx.parse(value[SERVER_COMPONENT_ADDRESS]) };
    },
    stream: parseServerComponent,
  },
  serialize(node, ctx) {
    const registry = serverComponentRegistryExpr ? serverComponentRegistryExpr(ctx) : "self._$SC";
    return registry + ".r(" + ctx.serialize(node.id) + "," + ctx.serialize(node.address) + ")";
  },
  deserialize(node, ctx) {
    const id = ctx.deserialize(node.id);
    const address = ctx.deserialize(node.address);
    if (address !== undefined && resolveServerComponent) return resolveServerComponent(id, address);
    return globalThis._$SC.r(id);
  },
};

/** A single-flight envelope's codec options: `codec` plus the server component plugin (by tag). */
export function flightCodec(codec?: any) {
  const plugins = (codec && codec.plugins) || [];
  if (plugins.some((plugin) => plugin && plugin.tag === ServerComponentPlugin.tag)) return codec;
  return { ...codec, plugins: [...plugins, ServerComponentPlugin] };
}

/**
 * The client mirror of `frameTransformResult`, for the server-function client's `responseHandler`: a frame-stream
 * response resolves the call with a binding (`COMPONENT_BINDING`: the per-function mount component, and the call's
 * address), so an equals-gated reader keeps its instance across refetches and argument changes; the response
 * streams into the address's store.
 */
/** What createServerComponentHandler takes: the frame host, the mount component per function, and the calls it answers itself. */
export type ServerComponentHandlerOptions<C = unknown> = {
  host: any;
  component: (fnId: string) => C;
  intercept?: (call: { id: string }) => unknown;
};

export function createServerComponentHandler({ host, component, intercept }: ServerComponentHandlerOptions) {
  const byFn = new Map();
  const componentFor = (fnId) => {
    let comp = byFn.get(fnId);
    if (comp === undefined) byFn.set(fnId, (comp = component(fnId)));
    return comp;
  };
  const byAddress = new Map();
  const bindingFor = (address, fnId) => {
    let binding = byAddress.get(address);
    if (!binding) {
      const comp = componentFor(fnId);
      binding = (props) => comp(props, () => address);
      binding[COMPONENT_BINDING] = { component: comp, address };
      byAddress.set(address, binding);
    }
    return binding;
  };
  // A refetch of an address a mount shows is staged: buffered (data writes through) until the transition that read
  // it commits the token, so new content lands with everything else it holds.
  const staged = new Map();
  const latest = new Map();
  const stage = (address, base, version) => {
    if (!base) return undefined;
    let committed = false;
    const chunks = [];
    const token = address + CONTENT_TOKEN + version;
    const entry = {
      token,
      prepareData: host.prepareData,
      apply(chunk) {
        if (committed || chunk.type === "data") host.apply(chunk);
        else chunks.push(chunk);
      },
      preview() {
        if (host.preview) for (const chunk of chunks) host.preview(chunk);
      },
      commit() {
        committed = true;
        staged.delete(address);
        for (const chunk of chunks) host.apply(chunk);
      },
    };
    staged.set(address, entry);
    const comp = base[COMPONENT_BINDING].component;
    const binding = (props) => comp(props, () => token);
    binding[COMPONENT_BINDING] = { component: comp, address: token };
    latest.set(address, binding);
    return entry;
  };
  const settled = (address, binding) => latest.get(address) || binding;
  /** A mount shows the address (and not its error). */
  const showing = (address) => {
    const frame = host.get(address);
    return frame !== undefined && frame.error === undefined;
  };
  const named = (token, half) => {
    const entry = staged.get(contentAddress(token));
    if (entry && entry.token === token) entry[half]();
  };
  stagedContent.preview = (token) => named(token, "preview");
  stagedContent.commit = (token) => named(token, "commit");
  resolveServerComponent = (id, address) => settled(address, bindingFor(address, id));
  // Versions per address, stamped here (only the client sees ordering across transports).
  const versions = new Map();
  const bump = (address) => {
    const version = (versions.get(address) || 0) + 1;
    versions.set(address, version);
    staged.delete(address);
    // A newer version from elsewhere ends an open live connection for the address (it reconnects).
    tierLoads.wire?.r?.cancel(host, address);
    return version;
  };
  /** An unstaged response begun: the address reads in flight from its header on. */
  const begin = (address, version) => host.apply({ type: "start", id: address, version });
  return {
    intercept:
      intercept &&
      ((info) => {
        const hit = intercept(info);
        if (hit === undefined) return undefined;
        const address = frameAddress(info.id, info.args);
        if (!info.meta?.live) calls.set(address, info);
        const binding = () => bindingFor(address, info.id);
        if (typeof hit.then === "function") return hit.then((landed) => (landed ? binding() : undefined));
        return binding();
      }),
    onLive() {
      prepareTier("wire");
    },
    resume(info) {
      return tierLoads.wire?.r?.resume(host, info, versions);
    },
    handle(response, ctx) {
      if (!isFrameStreamResponse(response)) return undefined;
      const address = frameAddress(ctx.id, ctx.args);
      const binding = bindingFor(address, ctx.id);
      if (response.headers.has(SINGLE_FLIGHT_HEADER)) return applyFlightResponse(response, address, binding);
      const wire = ctx[LIVE_WIRE];
      if (wire) return prepareTier("wire").then(() => tierLoads.wire.r.connect(response, wire, address, binding, host, bump, begin));
      calls.set(address, ctx);
      const version = bump(address);
      const entry = showing(address) ? stage(address, binding, version) : undefined;
      if (!entry) begin(address, version);
      const target = entry || host;
      const applied = applyFrameResponse(response, target, { as: address, version }).catch((err) =>
        target.apply({ type: "error", id: address, version, error: { message: String(err && err.message) } }),
      );
      return entry ? applied.then(() => settled(address, binding)) : binding;
    },
    /** The document shows a call (a hydration reference's address): its binding minted. */
    showing(address, functionId) {
      bindingFor(address, functionId);
    },
  };

  /** A mutation carrying markup: regions stream to the boundaries showing their calls; outcome chunks are its envelope. */
  async function applyFlightResponse(response, address, binding) {
    const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
    const as = rootId ? address : undefined;
    let feed;
    const source = new ReadableStream({
      start(controller) {
        feed = controller;
      },
    });
    const payload = deserializeStream(new Response(source), flightCodec(getServerFunctionsCodec()));
    let carried = false;
    const regions = new Map();
    const regionOf = (id) => {
      for (const [root, entry] of regions) if (id === root || id.startsWith(root + ".")) return entry;
    };
    const target = {
      apply: (chunk) => {
        const entry = regionOf(chunk.id);
        if (entry) entry.apply(chunk);
        else host.apply(chunk);
      },
      prepareData: host.prepareData,
    };
    await applyFrameResponse(response, target, {
      as,
      version: (frameId) => {
        const version = bump(frameId);
        let entry = regionOf(frameId);
        if (!entry && showing(frameId)) {
          entry = stage(frameId, frameId === as ? binding : byAddress.get(frameId), version);
          if (entry) regions.set(frameId, entry);
        }
        return version;
      },
      onOutcome: (text) => {
        carried = true;
        feed.enqueue(createChunk(text));
      },
    });
    feed.close();
    if (!carried) throw new Error("Single-flight frame response carried no outcome");
    const envelope: any = await payload;
    await deliverFlightData(response, envelope.data);
    if (response.headers.has(ERROR_HEADER) && !hasFlightMetadata(response)) throw envelope.value;
    return rootId ? settled(address, binding) : envelope.value;
  }
}
