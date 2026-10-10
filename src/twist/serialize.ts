// What a server render hands the client to hydrate with: values (async ones as they land) written by key into
// `_$HY.r` as script. The client reads them back by the same keys.
import { Feature, Serializer, crossHeader } from "../../../../../client/sluurp-serial.js";

export const HYDRATION_GLOBAL = "_$HY.r";

/** Regular expressions are never sent (a payload is code the client runs); outside development, neither are stacks. */
const disabled = () => Feature.RegExp | (process.env.NODE_ENV === "production" ? Feature.ErrorPrototypeStack : 0);

/** A serializer writing a render's values into `_$HY.r` as script text, given to `onData` piece by piece. */
export function hydrationSerializer(options: { scopeId?: string; onData: (script: string) => void; onDone?: () => void; onError?: (e: unknown) => void }) {
  return new Serializer({
    globalIdentifier: HYDRATION_GLOBAL,
    scopeId: options.scopeId,
    disabledFeatures: disabled(),
    onData: options.onData,
    onDone: options.onDone ?? (() => {}),
    onError: options.onError ?? (() => {}),
  });
}

/** The script that sets up a render scope's references, ahead of its data. */
export const headerScript = (scopeId?: string) => crossHeader(scopeId) + ";";
