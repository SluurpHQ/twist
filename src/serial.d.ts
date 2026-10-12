/**
 * Types for `@sluurp/twist/serial`: values sent between server and browser, with what JSON loses kept.
 */

/** What may be turned off (`disabledFeatures`), as seroval numbers them. */
export const Feature: {
  AggregateError: 1;
  ArrowFunction: 2;
  ErrorPrototypeStack: 4;
  ObjectAssign: 8;
  BigIntTypedArray: 16;
  RegExp: 32;
  Temporal: 64;
};

/** A string's text inside double quotes, safe in a <script> (no `</script>`, no line separators). */
export function escapeString(str: string): string;

export class SerovalError extends Error {
  constructor(type: string, cause: unknown);
}
export class SerovalParserError extends SerovalError {}
export class SerovalDeserializationError extends SerovalError {}
export class SerovalUnsupportedNodeError extends Error {}
export class SerovalMissingPluginError extends Error {}
export class SerovalMissingInstanceError extends Error {}
export class SerovalMissingReferenceForIdError extends Error {}
export class SerovalUnknownTypedArrayError extends Error {}
export class SerovalMalformedNodeError extends Error {}
export class SerovalDepthLimitError extends Error {}

/** A plugin as seroval takes it (`tag`, `test`, `parse.sync|async|stream`, `serialize`, `deserialize`, `extends`). */
export type Plugin = { tag: string; extends?: Plugin[]; [key: string]: any };
export function createPlugin<P extends Plugin>(plugin: P): P;
/** Plugins with the ones they extend, each once, in order. */
export function resolvePlugins(plugins: Plugin[] | undefined): Plugin[] | undefined;

/** A value the serializer does not see: `replacement` is written in its place. */
export class OpaqueReference<V = unknown, R = unknown> {
  constructor(value: V, replacement?: R);
  value: V;
  replacement: R;
}
/** Values both peers hold already, sent by id. */
export function createReference<T>(id: string, value: T): T;

/** What listens to a stream. */
export type StreamListener<T = unknown> = { next(value: T): void; throw(error: unknown): void; return(value: T): void };
/** A stream as the serializer writes and reads them. */
export type Stream<T = unknown> = {
  __SEROVAL_STREAM__: true;
  /** Listens (what came already first); returns what stops listening. */
  on(listener: StreamListener<T>): () => void;
  next(value: T): void;
  throw(error: unknown): void;
  return(value: T): void;
};
export function createStream<T = unknown>(): Stream<T>;
export function isStream(value: object): value is Stream;

/** The script that makes the global a page's values are written into. */
export function crossHeader(scopeId?: string | null): string;

export type SerializerOptions = {
  globalIdentifier: string;
  scopeId?: string;
  plugins?: Plugin[];
  disabledFeatures?: number;
  onData: (script: string) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
};
/** Values written by key into `globalIdentifier` as script, given to `onData` piece by piece. */
export class Serializer {
  constructor(options: SerializerOptions);
  write(key: string, value: unknown): void;
  getNextID(): string;
  /** Writes `value` under the next free id, and returns it. */
  push(value: unknown): string;
  flush(): void;
  close(): void;
}

/** `source` as node trees given to `onParse(node, initial)`; returns what stops it. */
export function toCrossJSONStream(
  source: unknown,
  options: {
    refs?: Map<unknown, unknown>;
    plugins?: Plugin[];
    disabledFeatures?: number;
    depthLimit?: number;
    onParse: (node: unknown, initial: boolean) => void;
    onError?: (error: unknown) => void;
    onDone?: () => void;
  },
): () => void;
/** A node tree from `toCrossJSONStream` as a value; `refs` shared by every tree of one stream. */
export function fromCrossJSON<T = unknown>(
  source: unknown,
  options: { refs?: Map<unknown, unknown>; plugins?: Plugin[]; features?: number; disabledFeatures?: number; depthLimit?: number; maxBase64Length?: number },
): T;

/** A value as JSON text (its node tree). Promises cannot be sent this way. */
export function stringify(value: unknown): string;
/** The value `stringify` wrote: read without eval, each node checked. */
export function parse<T = unknown>(text: string): T;
