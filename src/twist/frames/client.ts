// Ported from Solid's frames/src/client.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
// @solidjs/web/frames — client half.

import {
  createMemo,
  createOwner,
  createRenderEffect,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack
} from "../index.ts";
import type { Element as SolidElement } from "../index.ts";
// `insert` MUST resolve to the shared @solidjs/web instance the compiled app
import { insert } from "../web.ts";
import {
  createFrame,
  createFrameElement,
  createFrameHost,
  FRAME_ID_ATTR,
  isAsyncValue,
  prepareTier,
  slotShapeFinding,
  tierLoaders,
  tierLoads,
  type TierModule
} from "./frame-client.ts";
import {
  COMPONENT_BINDING,
  callFor,
  contentAddress,
  createServerComponentHandler,
  stagedContent,
  type ServerComponentHandlerOptions
} from "./frame-transport.ts";
import { createLoadingBoundary, sharedConfig } from "../internal.ts";

// The container tier (DR-2 case 3): server projections cross the border as
const TRACE_STATE = Symbol.for("solid.container-trace-state");
tierLoaders.trace = () => import("./trace-tier.ts");
// The regions tier (frames savings pass §3 row C4): nested server-content
tierLoaders.regions = () => import("./regions-tier.ts");
// The assets tier (frames savings pass §3 row C5): the head mirror a
tierLoaders.assets = () => import("./assets-tier.ts");
// The bind tier (frames savings pass §3 row C6): binding-slot positions
tierLoaders.bind = () => import("./bind-tier.ts");
// The live wire tier (frames savings pass §3 row C2): what a `live()`
tierLoaders.wire = () => import("./wire-tier.ts");

// Build-time literal (see diagnostics.ts): dev-only guidance folds out of prod.
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
// This import must resolve to the SHARED built instance, not a bundled
import { configureServerFunctionsClient } from "../server-functions/client.ts";
// The seroval codec is the frames client's heaviest dependency (~6 kB gz

export {
  createFrame,
  createFrameHost,
  createFrameElement,
  FRAME_APPLIED_EVENT
} from "./frame-client.ts";
// The shape a tier loader resolves (`InstallOptions.tiers`); type-only.
export type { TierModule } from "./frame-client.ts";
// The bind tier's import of this entry (bind-tier.ts): one copy of the
/** @internal */
export { isAsyncValue } from "./frame-client.ts";
// `FRAME_HAVE_HEADER` / `FRAME_HAVE_BUDGET` are the SERVER entry's
export {
  FRAME_STREAM_HEADER,
  applyFrameResponse,
  isFrameStreamResponse,
  createServerComponentHandler
} from "./frame-transport.ts";
// `createJSONDataTable` is NOT re-exported here: its single public home is
export type { Slot, BindingSlot, SlotOutput, SlotError } from "./server.ts";

/** Client-condition twin of the server face's `asyncArg` (DR-2 value tier): */
export function asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T {
  return value as T;
}

// One host per app is the norm: one chunk router, with codec data tables
let sharedHost: any;
let codec: any;
let codecLoading: Promise<unknown> | undefined;
function loadCodec() {
  // The decode-only entry: the data tables never encode, and the full
  return (codecLoading ??= import("../serialization.ts").then(m => {
    codec = m;
  }));
}
const tables = new Map<string, Map<number, any>>();
function tableFor(id: string, version: number, current: number | undefined) {
  let byVersion = tables.get(id);
  if (!byVersion) tables.set(id, (byVersion = new Map()));
  else for (const v of byVersion.keys()) if (v < current!) byVersion.delete(v);
  let t = byVersion.get(version);
  if (!t && codec) byVersion.set(version, (t = codec.createJSONDataTable()));
  return t;
}
/** The render effect that follows a mount's address accessor. */
function followAddress(host: any, frame: { rebind(address: string): void }, binding: () => string) {
  createRenderEffect(
    () => {
      const token = binding();
      stagedContent.preview(token);
      return token;
    },
    token => {
      stagedContent.commit(token);
      frame.rebind(contentAddress(token));
    }
  );
}

/** The frame as one async value outward (A0, corollary 4): to its */
function landing<T>(host: any, address: string, value: T, failed: () => unknown): () => T {
  // What the address's store holds at creation is applied: a fresh
  let thrown = host.get(address)?.error;
  return createMemo(() => {
    failed();
    const error = host.get(address)?.error;
    if (error !== undefined && error !== thrown) {
      thrown = error;
      throw error;
    }
    const wait = host.landing(address);
    if (!wait) return value;
    // An errored address with no flight open (a flight's `start` clears
    const asked = error !== undefined ? reask(address) : undefined;
    return (asked ? asked.then(() => wait) : wait).then(() => value);
  });
}

/** The re-ask (see `landing`): the call behind the address, as the transport */
function reask(address: string): Promise<unknown> | undefined {
  const call = callFor(address);
  if (IS_DEV && !call)
    console.error(
      `Server component boundary "${address}" errored, but no call is recorded for it; ` +
        `reset() cannot re-ask the server. (The address was written by hand, not by a call.)`
    );
  if (!call) return undefined;
  // (Once while it is out: a pass run again before its answer starts waits on the same re-ask.)
  let asked = reasking.get(address);
  if (!asked) {
    const clear = () => void reasking.delete(address);
    reasking.set(address, (asked = Promise.resolve(call.retry())));
    asked.then(clear, clear);
  }
  return asked;
}
/** Re-asks still out, by address. */
const reasking = new Map<string, Promise<unknown>>();

/** A mount's error tick for `landing`: the read, and the frame `onApply` */
function failing(): [() => number, (info: { reason: string }) => void] {
  const [failed, setFailed] = createSignal(0, { ownedWrite: true });
  return [failed, info => info.reason === "error" && setFailed(n => n + 1)];
}
/** The app-wide shared frame host (created lazily): one chunk router with */
export function getFrameHost() {
  if (!sharedHost) {
    sharedHost = createFrameHost({
      prepareData: loadCodec,
      applyData: (c: any, current?: number) => tableFor(c.id, c.version, current)?.apply(c),
      resolve: (ref: any, id: string, version: number, current?: number) =>
        tableFor(id, version, current)?.resolve(ref),
      // The response's table alone — never minted for a response that
      closeData: (id: string, version: number, error?: unknown) =>
        tables.get(id)?.get(version)?.close(error)
      // No `revive` here: document-face container traces ride slot records
    });
  }
  return sharedHost;
}

/** The stable component minted once per boundary. */
/** The registry/gather pair a boundary adopts under — read at adoption, so */
type ClaimScope = { registry?: Map<string, object>; gather?: (key: string) => void };

/** Hydration re-entry for one adopted slot range: the fill renders inside a */
function claimRender(
  prefix: string,
  existing: Node[],
  render: () => any,
  scope?: ClaimScope,
  bound?: boolean
) {
  const sc: any = sharedConfig;
  // No window, or no registry gathered yet (no `hydrate()` pass has run):
  if (!sc.hydrateWindow || !sc.registry) return render();
  const prevRoots = sc.claimRoots;
  sc.claimRoots = existing;
  try {
    // The claim owner too: the window claims this fill's subtree only.
    return runWithOwner(createOwner({ id: prefix }), () =>
      sc.hydrateWindow(bound ? undefined : prefix, render, scope)
    );
  } finally {
    sc.claimRoots = prevRoots;
  }
}

/** Live props for an invoked render prop: a signal-backed proxy the frame */
function liveSlotProps(initial: Record<string, any>, ctx: any) {
  // `ownedWrite`: the record's writes arrive from wherever the frame flushes
  const [args, setArgs] = createSignal(initial, { ownedWrite: true });
  ctx.onUpdate((next: Record<string, any>) => setArgs(() => next));
  return slotArgsProxy(args);
}

/** Whether two values of one slot arg are the same value — the per-prop */
function sameArg(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Boxed || b instanceof Boxed)
    return a instanceof Boxed && b instanceof Boxed && a.c === b.c;
  if (isAsyncValue(a) || isAsyncValue(b) || a instanceof Node || b instanceof Node) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** A live container as a prop memo's value. */
class Boxed {
  constructor(public c: unknown) {}
}

/** The props object handed to a render-prop occurrence. */
function slotArgsProxy(args: () => Record<string, any>) {
  const owner = getOwner();
  const reads = new Map<PropertyKey, () => any>();
  return new Proxy(
    {},
    {
      get: (_, key) => {
        let read = reads.get(key);
        if (!read) {
          // TRANSPARENT: an adopted fill invokes during the hydrate window
          const make = () =>
            createMemo(
              () => {
                const raw = (args() as any)[key];
                if ((globalThis as any)[TRACE_STATE]?.materializedValues.has(raw))
                  return new Boxed(raw);
                if (raw != null && typeof raw.then === "function") {
                  if (raw.s === 1) return raw.v;
                  if (raw.s === 2) throw raw.v;
                }
                return raw;
              },
              (IS_DEV
                ? { transparent: true, equals: sameArg, _supersedes: true }
                : { transparent: true, equals: sameArg }) as any
            );
          read = owner ? runWithOwner(owner, make)! : make();
          reads.set(key, read);
        }
        const v = read();
        return v instanceof Boxed ? v.c : v;
      },
      has: (_, key) => key in args(),
      ownKeys: () => Reflect.ownKeys(args()),
      getOwnPropertyDescriptor: (_, key) =>
        key in args() ? { enumerable: true, configurable: true } : undefined
    }
  );
}

/** The slot fills of a boundary. */
function slotsFor(props: Record<string, any>, scope?: ClaimScope) {
  // Each fill invocation's reactive scope, one per occurrence.
  const fillScopes = new Map<string, { dispose(): void }>();
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== "string" || !(prop in props)) return undefined;
        return (slotProps: any, ctx: any) => {
          const key = ctx && ctx.key;
          // A re-call replaces the invocation wholesale (the frame only
          const prevFill = key !== undefined && fillScopes.get(key);
          if (prevFill) {
            fillScopes.delete(key);
            prevFill.dispose();
          }
          // Binding slot (§9.2.3): the occurrence's node is the set of server
          if (ctx && ctx.positions) {
            const fill = props[prop];
            if (typeof fill !== "function") {
              if (IS_DEV) {
                slotShapeFinding(
                  { reason: "fill-shape", occurrence: key, shape: typeof fill },
                  `[BINDING_SLOT_POSITION] Server markup reads slot \`${prop}\` as data (\`${key}\`), ` +
                    `but the client prop is ${typeof fill === "object" ? "an object" : `a ${typeof fill}`}, ` +
                    `not a function. The fill is a function of the occurrence's args returning the object ` +
                    `the markup reads: \`${prop}={args => ({ … })}\`. Nothing binds until it is.`
                );
              }
              return undefined;
            }
            const owner = createOwner();
            fillScopes.set(key, owner);
            ctx.onCleanup(() => {
              if (fillScopes.get(key) === owner) fillScopes.delete(key);
              owner.dispose();
            });
            runWithOwner(owner, () => {
              const args = ctx.onUpdate
                ? liveSlotProps(slotProps, ctx)
                : slotArgsProxy(() => slotProps);
              tierLoads.bind.r.bind(
                fill,
                args,
                ctx,
                IS_DEV ? `the \`${prop}\` binding-slot fill` : undefined
              );
            });
            return undefined;
          }
          // A range occurrence without its end marker has no anchor to bind
          const range = ctx && ctx.range;
          if (!range) return undefined;
          // Stream-mounted fills (no ambient owner at invocation — the frame
          const fillOwner = streamInvoke ? createOwner() : null;
          if (fillOwner && key !== undefined && ctx) {
            fillScopes.set(key, fillOwner);
            ctx.onCleanup(() => {
              if (fillScopes.get(key) === fillOwner) fillScopes.delete(key);
              fillOwner.dispose();
            });
          }
          // The prop is read INSIDE the claim scope: compiled component props
          const evaluate = () => {
            const v = props[prop];
            if (typeof v === "function" && ctx && ctx.invoked) {
              // Render-prop calls get LIVE props (see liveSlotProps): the
              const fillProps = ctx.onUpdate
                ? liveSlotProps(slotProps, ctx)
                : slotArgsProxy(() => slotProps);
              return untrack(
                () => v(fillProps),
                IS_DEV ? `the \`${prop}\` template-slot fill` : undefined
              );
            }
            return v;
          };
          const adopted = !!(
            ctx &&
            ctx.frame &&
            ctx.adopted &&
            ctx.existing &&
            ctx.existing.length
          );
          const prefix = ctx && ctx.frame ? `sc-${ctx.frame}-${ctx.key}-` : "";
          // The claim: evaluate this occurrence under the SAME hydration-key
          const value = fillOwner
            ? runWithOwner(fillOwner, () =>
                adopted ? claimRender(prefix, ctx.existing, evaluate, scope) : evaluate()
              )
            : adopted
              ? claimRender(prefix, ctx.existing, evaluate, scope)
              : evaluate();
          // Every fill is one `insert` before the range's end marker — the
          const owner = fillOwner || createOwner({ transparent: true });
          if (!fillOwner) {
            fillScopes.set(key, owner);
            ctx.onCleanup(() => {
              if (fillScopes.get(key) === owner) fillScopes.delete(key);
              owner.dispose();
            });
          }
          const end = range.end;
          const bind = () => insert(end.parentNode as any, value, end, [...ctx.existing]);
          runWithOwner(owner, () =>
            adopted ? claimRender(prefix, ctx.existing, bind, scope, true) : bind()
          );
          return undefined;
        };
      }
    }
  );
}

// Boundary-driven segment reveal (the per-`<Loading>` model).
function revealSeam(owner: any) {
  return (seam: { before: Node; fallback: Node[]; content: () => Node }) =>
    runWithOwner(owner, () =>
      insert(
        (seam.before as any).parentNode,
        createLoadingBoundary(
          () => seam.content(),
          () => seam.fallback
        ) as any,
        seam.before as any
      )
    );
}

// The frame invokes slots and element-claim sweeps through `ownerScope`
let streamInvoke = false;
function boundaryScope(owner: any) {
  return (fn: () => any) => {
    if (getOwner()) return fn();
    streamInvoke = true;
    try {
      return runWithOwner(owner, fn);
    } finally {
      streamInvoke = false;
    }
  };
}

function boundaryComponent(host: any, fnId: string) {
  return (props: Record<string, any>, binding?: () => string) => {
    // Element-claim sweeps (router link-state contract) run under this
    const owner = getOwner();
    const id = binding ? contentAddress(binding()) : fnId;
    // The frame's error, announced to the mount's content node (`landing`).
    const [failed, onApply] = failing();
    // The boundary is a DOM element (`<solid-frame>`), not a branded value:
    const { element, frame, dispose } = createFrameElement({
      host,
      // The mount binds the ADDRESS's store (content is keyed by call, the
      id,
      slots: slotsFor(props),
      ownerScope: boundaryScope(owner),
      reveal: revealSeam(owner),
      onApply
    });
    onCleanup(dispose);
    // The shell: the covering <Loading> pends on the bound address's first
    if (!binding) return landing(host, id, element, failed) as unknown as SolidElement;
    // Follow the live address binding (the identity split's delivery
    followAddress(host, frame, binding);
    return createMemo(() =>
      landing(host, contentAddress(binding()), element, failed)
    ) as unknown as SolidElement;
  };
}

/** The document-adoption implementation behind `self._$SC.r(id)` */
// Boundaries the page carried that a component has already bound to —
const claimedBoundaries = new Set<string>();

// ---- the document live-hole channel (Stage 4) --------------------------
const liveOps = new Map<string, any>();
const liveAppliers = new Set<(op: any) => void>();
let livePumped: any = null;
function pumpLiveChannel() {
  const stream = (globalThis as any)._$HY?.r?.["sc:live"];
  if (!stream || stream === livePumped || typeof stream.getReader !== "function") return;
  livePumped = stream;
  const reader = stream.getReader();
  const pump = (): Promise<void> =>
    reader.read().then((r: { done: boolean; value: any }) => {
      if (r.done) return;
      const op = r.value;
      // A sweep's `ops` unit is applied whole (one write per boundary) but
      for (const m of op.type === "ops" ? op.ops : [op])
        liveOps.set(`${m.type}:${m.fid || ""}:${m.key || ""}`, m);
      for (const apply of liveAppliers) apply(op);
      return pump();
    });
  pump().catch(() => {
    /* a truncated document stream latches at the last op applied */
  });
}

// One document query indexes the SSR'd frame ELEMENTS by id; the intercept and
let boundaryIndex: Map<string, Element> | null = null;
// Region ids are `fn.occurrence.key`; only function ids are ever looked up as
const isBoundaryId = (id: string) => !id.includes(".");
function indexBoundaries(root: ParentNode) {
  root.querySelectorAll(FRAME_SELECTOR).forEach(el => {
    const key = el.getAttribute(FRAME_ID_ATTR);
    if (key && isBoundaryId(key) && !boundaryIndex!.has(key)) boundaryIndex!.set(key, el);
  });
}
function findBoundaryElement(id: string): Element | undefined {
  if (!boundaryIndex) {
    boundaryIndex = new Map();
    if (typeof document !== "undefined" && document.body) indexBoundaries(document.body);
  }
  return boundaryIndex.get(id);
}

// The one deferred answer for "the page may still deliver this boundary":
const arrivals = new Map<string, { promise: Promise<boolean>; resolve: (v: boolean) => void }>();

// Frame elements — adopted boundaries and the region elements inside them —
const FRAME_SELECTOR = `[${FRAME_ID_ATTR}]`;
const disposedFrames = new WeakSet<Element>();
function awaitBoundary(id: string) {
  let arrival = arrivals.get(id);
  if (!arrival) {
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>(r => (resolve = r));
    arrivals.set(id, (arrival = { promise, resolve }));
  }
  return arrival.promise;
}

/** Whether the document may still deliver boundary elements — the hydration */
function boundaryMayArrive() {
  const hy = (globalThis as any)._$HY;
  if (!hy) return false;
  return !hy.done || !!(hy.fr && hy.fr.pending());
}

/** Install the frames client's two hooks on the hydration runtime's fragment */
function installRevealHook() {
  const hy = (globalThis as any)._$HY;
  if (!hy || hy.$sc || !hy.fr) return;
  hy.$sc = true;
  hy.fa = (pl: Element) => {
    const el = pl.closest(FRAME_SELECTOR);
    return !!el && !disposedFrames.has(el);
  };
  hy.fr.subscribe((_id: string, parent?: ParentNode) => {
    // Nothing has looked a boundary up yet, so there is nothing to keep
    if (!boundaryIndex) return;
    const root = parent || (typeof document !== "undefined" ? document.body : null);
    if (root) indexBoundaries(root);
    if (!arrivals.size) return;
    // A waiter the page can no longer answer must not wait forever: once the
    const exhausted = hy.done && !hy.fr.pending();
    for (const [id, arrival] of arrivals) {
      const el = boundaryIndex && boundaryIndex.get(id);
      if (!el && !exhausted) continue;
      arrivals.delete(id);
      arrival.resolve(!!el);
    }
  });
}

function documentBoundary(
  host: any,
  id: string,
  props: Record<string, any>,
  binding?: () => string
) {
  // The ledger installs with enableHydration(), which may postdate the
  installRevealHook();
  const claimed = claimedBoundaries.has(id);
  const el = !claimed ? findBoundaryElement(id) : undefined;
  if (el) return adoptBoundary(host, id, el, props, binding);
  // Not in the page (yet).
  if (!claimed && boundaryMayArrive()) {
    const owner = getOwner();
    let live = true;
    onCleanup(() => (live = false));
    return createMemo(() =>
      awaitBoundary(id).then(
        () =>
          live &&
          runWithOwner(owner, () => {
            const node = claimedBoundaries.has(id) ? undefined : findBoundaryElement(id);
            // No element after all (the page ran out of reveals, or another
            return node
              ? adoptBoundary(host, id, node, props, binding)
              : boundaryComponent(host, id)(props, binding);
          })
      )
    ) as unknown as SolidElement;
  }
  // No SSR'd boundary on the page (client-only boot, or already claimed):
  return boundaryComponent(host, id)(props, binding);
}

function adoptBoundary(
  host: any,
  id: string,
  el: Element,
  props: Record<string, any>,
  binding?: () => string
) {
  claimedBoundaries.add(id);
  // Content is keyed by the CALL's address (the identity split): the frame
  const address = binding ? contentAddress(binding()) : id;
  // Occlusion records (case 3, document face): content a client wrapper
  const appliedRecords = new Set<string>();
  // Deferred fragments in the adopted markup (#2978): a <Loading> that
  const reportedFragments = new Set<string>();
  const reportRegionFragments = (root: ParentNode) => {
    const hy = (globalThis as any)._$HY;
    if (!hy || !hy.r) return;
    root.querySelectorAll('template[id^="pl-"]').forEach(tpl => {
      const fragId = tpl.id.slice(3);
      if (reportedFragments.has(fragId)) return;
      reportedFragments.add(fragId);
      const ref = hy.r[fragId + "_fr"];
      ref &&
        typeof ref.then === "function" &&
        ref.then(undefined, (error: unknown) =>
          console.error(
            `Server <Loading> fragment "${fragId}" inside server component "${id}" rejected on ` +
              `the server; the frame shows what the server rendered for that outcome.`,
            error
          )
        );
    });
  };
  const drainRecords = () => {
    const hy = (globalThis as any)._$HY;
    if (!hy || !hy.r) return;
    // The live channel serializes eagerly at arming, so the adopt-time
    pumpLiveChannel();
    const slotPrefix = `sc:slot:${id}:`;
    for (const key of Object.keys(hy.r)) {
      if (appliedRecords.has(key)) continue;
      if (key.startsWith(slotPrefix)) {
        appliedRecords.add(key);
        // Slot records land in the ADDRESS's store (where the frame binds);
        const apply = (args: unknown) =>
          host.apply({
            type: "slot",
            id: address,
            version: 0,
            key: key.slice(slotPrefix.length),
            args
          });
        const value = hy.r[key];
        // A declared record: settled reads its stamp synchronously (a
        if (value && typeof value.then === "function") {
          if (value.s === 1) apply(value.v);
          else if (value.s === 2) value.then(undefined, () => {});
          else value.then(apply, () => {});
        } else apply(value);
      } else if (key.startsWith("sc:region:")) {
        const childId = key.slice("sc:region:".length);
        if (childId.startsWith(id + ".")) {
          appliedRecords.add(key);
          // Async-occluded regions arrive as promises (the producer held
          const val = hy.r[key];
          const apply = (html: any) => host.apply({ type: "html", id: childId, version: 0, html });
          val && typeof val.then === "function" ? val.then(apply) : apply(val);
        }
      }
    }
  };
  IS_DEV && reportRegionFragments(el);
  const fr = (globalThis as any)._$HY?.fr;
  // The adopting frame, bound below; the reveal cascade syncs it.
  let frame: ReturnType<typeof createFrame> | undefined;
  const unsubscribe = fr
    ? fr.subscribe((_fragId: string, parent?: ParentNode) => {
        // The cascade: a reveal into this region can itself carry a pl-*
        const inside = !!parent && el.contains(parent as Node);
        IS_DEV && inside && reportRegionFragments(parent!);
        // A revealed fragment also brings its occurrences' ARGS RECORDS: a
        drainRecords();
        // A reveal is an apply (frames-rulings 2.3): content that becomes
        if (inside && frame) frame.apply({ version: frame.version ?? 0, r: {} });
      })
    : undefined;
  // Live-hole ops broadcast into this boundary's store at its bound
  const applyLiveOp = (op: any) => {
    if (op.fid && op.fid !== id) return;
    host.apply({ ...op, id: address, version: 0 });
  };
  liveAppliers.add(applyLiveOp);
  onCleanup(() => {
    liveAppliers.delete(applyLiveOp);
    unsubscribe && unsubscribe();
  });
  drainRecords();
  // Catch-up: ops that arrived before this boundary adopted (the pump may
  for (const op of liveOps.values()) applyLiveOp(op);
  // ownerScope: element-claim sweeps — both the adoption sweep over the
  const owner = getOwner();
  // The root this boundary adopts under (see ClaimScope): its occurrences
  const sc: any = sharedConfig;
  // The frame's error, announced to the address source below (`landing`).
  const [failed, onApply] = failing();
  frame = createFrame(el, {
    adopt: true,
    host,
    id: address,
    slots: slotsFor(props, { registry: sc.registry, gather: sc.gather }),
    ownerScope: boundaryScope(owner),
    reveal: revealSeam(owner),
    onApply,
    // Hydration-done follows non-SC Solid 2 (frames-rulings 3.1, ruled):
    hold: () =>
      sc.isHydrationInProgress?.()
        ? runWithOwner(owner, () => untrack(() => sc.holdBoundary("sc:" + id)))
        : () => {},
    // The identity split binds the frame to the call ADDRESS (id + args
    ...({ claimScope: id } as {})
  });
  // Follow the live address binding (see boundaryComponent and
  if (binding) {
    followAddress(host, frame, binding);
    const source = createMemo(() => landing(host, contentAddress(binding()), true, failed));
    createRenderEffect(
      () => source()(),
      () => {}
    );
  }
  onCleanup(() => {
    frame.dispose();
    // Disown the element's placeholders (ownership by rendering, see
    disposedFrames.add(el);
    el.querySelectorAll(FRAME_SELECTOR).forEach(e => disposedFrames.add(e));
  });
  // The boundary IS the element — hand hydration the single SSR'd node so it
  return el as unknown as SolidElement;
}

/** Options for `installServerComponents`. */
export interface InstallOptions {
  /** Frames-client tiers by name → loader. */
  tiers?: Record<string, () => Promise<TierModule>>;
}

/** Installs the server-component transport policy on the server-function */
export function installServerComponents(host: any = getFrameHost(), options?: InstallOptions) {
  const g = globalThis as any;
  // The tier seam (frames savings pass §2): the loaders, then the tiers
  Object.assign(tierLoaders, options?.tiers);
  g._$HY?.r?.["sc:tiers"]?.forEach(prepareTier);
  // Upgrade the document shell's placeholder bootstrap (if present): the
  if (!g._$SC) {
    // Mirror of the document bootstrap (frame-sink's
    g._$SC = {
      c: {},
      a: {},
      b: {},
      r(i: string, a?: string) {
        const c = g._$SC.c[i] || (g._$SC.c[i] = (p: any, b?: () => string) => g._$SC.impl(i, p, b));
        if (!a) return c;
        g._$SC.a[a] = i;
        g._$SC.reg && g._$SC.reg(a, i);
        return (
          g._$SC.b[a] ||
          (g._$SC.b[a] = Object.assign((p: any) => c(p, () => a), {
            [COMPONENT_BINDING]: { component: c, address: a }
          }))
        );
      }
    };
  }
  g._$SC.impl = (id: string, props: any, binding?: () => string) =>
    documentBoundary(host, id, props, binding);
  // Late boundaries arrive with the reveals, so subscribe as early as the
  installRevealHook();
  const handler = createServerComponentHandler({
    host,
    // ONE mount component per function, and it IS the document placeholder:
    component: (fnId: string) => g._$SC.r(fnId),
    // The page IS the t=0 record: a call whose function has an unclaimed
    intercept: ({ id }: { id: string }) => {
      if (claimedBoundaries.has(id)) return undefined;
      if (findBoundaryElement(id)) return true;
      if (!boundaryMayArrive()) return undefined;
      installRevealHook();
      return awaitBoundary(id);
    }
    // Single-flight delivery (the transport's `consumer`/`codec` defaults)
  } as ServerComponentHandlerOptions<any>);
  // Which calls the document is showing: hydration references carry their
  const showing = (address: string, id: string) => handler.showing(address, id);
  const records = g._$SC.a || (g._$SC.a = {});
  for (const address in records) showing(address, records[address]);
  g._$SC.reg = showing;
  configureServerFunctionsClient({ responseHandler: handler });
}
