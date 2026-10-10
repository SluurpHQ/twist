// Ported from Solid's frames/src/trace-tier.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
/** `@solidjs/web/frames/trace` — the frames client's TRACES tier (frames */
import { materializeContainerTrace } from "../internal.ts";
// The eager frames client — the SHARED instance the app runs (external in the
import { getFrameHost } from "./client.ts";
import { reviveContainerTraces, setContainerTraceMaterializer } from "./frame-container-plugin.ts";

/** Install the traces tier into the frames client (called by `prepareTier`). */
export function install(): void {
  setContainerTraceMaterializer(materializeContainerTrace);
  getFrameHost().revive = reviveContainerTraces;
}
