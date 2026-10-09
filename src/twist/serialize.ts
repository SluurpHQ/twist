// What a server render hands the client to hydrate with: values (async ones as they land) written by key into
// `_$HY.r`, as script seroval generates. The client reads them back by the same keys.
import { Feature, Serializer, getCrossReferenceHeader } from "seroval";
import {
  AbortSignalPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLPlugin,
  URLSearchParamsPlugin,
} from "seroval-plugins/web";

export const HYDRATION_GLOBAL = "_$HY.r";

const PLUGINS = [
  AbortSignalPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLSearchParamsPlugin,
  URLPlugin,
];

/** Regular expressions are never sent (a payload is code the client runs); outside development, neither are stacks. */
const disabled = () => Feature.RegExp | (process.env.NODE_ENV === "production" ? Feature.ErrorPrototypeStack : 0);

/** A serializer writing a render's values into `_$HY.r` as script text, given to `onData` piece by piece. */
export function hydrationSerializer(options: { scopeId?: string; onData: (script: string) => void; onDone?: () => void; onError?: (e: unknown) => void }) {
  return new Serializer({
    globalIdentifier: HYDRATION_GLOBAL,
    scopeId: options.scopeId,
    plugins: PLUGINS as any,
    disabledFeatures: disabled(),
    onData: options.onData,
    onDone: options.onDone ?? (() => {}),
    onError: options.onError ?? (() => {}),
  });
}

/** The script that sets up seroval's references for a render scope, ahead of its data. */
export const headerScript = (scopeId?: string) => getCrossReferenceHeader(scopeId) + ";";
