// Ported from Solid's frames/src/server.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
// @solidjs/web/frames — server half.

import type { Element as SolidElement } from "../server-solid.ts";
// The container tier's server half, installed HERE as well as in the main
import { setAsyncIterableSharer, setContainerTraceResolver } from "./frame-container-plugin.ts";
import { getProjectionTrace, shareAsyncIterable } from "../server-internal.ts";

setContainerTraceResolver(getProjectionTrace);
setAsyncIterableSharer(shareAsyncIterable);

/** A client position in a server component: a prop the server renders (as JSX */
export type Slot<P = {}> = (props: P & { $key?: string | number }) => SolidElement;

declare const slotError: unique symbol;

/** A binding slot's rejected return shape: assigning to it fails, and the */
export type SlotError<M extends string> = { [slotError]: M };

/** What a binding slot's fill may return: `J` when it is a plain object with no */
export type SlotOutput<J> = J extends readonly unknown[]
  ? SlotError<"binding slot output must be an object, not an array">
  : J extends Node
    ? SlotError<"binding slot output must be an object, not a DOM node">
    : J extends (...args: any[]) => any
      ? SlotError<"binding slot output must be an object, not a function">
      : J extends PromiseLike<unknown> | AsyncIterable<unknown>
        ? SlotError<"binding slot output must be settled, not async">
        : Extract<keyof J, `$${string}`> extends never
          ? J
          : SlotError<`reserved key: ${Extract<keyof J, `$${string}`> & string}`>;

/** A binding slot (principles §9.2.3): the client renders an object instead of */
export type BindingSlot<P = {}, J extends object = Record<string, unknown>> = {} extends P
  ? (props?: P & { $key?: string | number }) => SlotOutput<J>
  : (props: P & { $key?: string | number }) => SlotOutput<J>;

/** Types an async value crossing the slot border (DR-2, value tier). */
export function asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T {
  return value as T;
}

export {
  renderToFrameStream,
  renderServerComponent,
  serverComponentResponse,
  frameTransformResult,
  // Single-flight: mutations whose invalidated payload includes markup
  frameTransformFlightResult,
  createFrameSink,
  // Document SSR (t=0): inline rendering + the hydration reference
  frameTransformDirectResult,
  ServerComponentPlugin,
  SERVER_COMPONENT_BOOTSTRAP
} from "./frame-sink.ts";
export {
  FRAME_STREAM_HEADER,
  FRAME_HAVE_HEADER,
  FRAME_HAVE_BUDGET,
  // The tier announcement's header name (frames savings pass §2).
  FRAME_TIERS_HEADER,
  isFrameStreamResponse
} from "./frame-transport.ts";
