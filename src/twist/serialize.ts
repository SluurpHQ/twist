// What a server render hands the client to hydrate with: values (async ones as they land) written by key into
// `_$HY.r` as script. The client reads them back by the same keys.
import { createHydrationSerializer, getLocalHeaderScript } from "./serialization.ts";

export const HYDRATION_GLOBAL = "_$HY.r";

/** A serializer writing a render's values into `_$HY.r` as script text, given to `onData` piece by piece. */
export function hydrationSerializer(options: { scopeId?: string; onData: (script: string) => void; onDone?: () => void; onError?: (e: unknown) => void }) {
  return createHydrationSerializer({
    scopeId: options.scopeId,
    onData: options.onData,
    onDone: options.onDone ?? (() => {}),
    onError: options.onError ?? (() => {}),
  });
}

/** The script that sets up a render scope's references, ahead of its data. */
export const headerScript = getLocalHeaderScript;
