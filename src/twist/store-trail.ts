// Server only: a streaming store's state as the client is sent it — its snapshot once, then the patches since the last
// one sent. Installed by the server entry, so a client bundle never carries the serializer.
import { createStream } from "../serial.js";
import { diffPatches } from "./container-trace.ts";
import { untrack } from "./signals.ts";
import { setStateTrail } from "./store.ts";

setStateTrail((read: () => any) => {
  const stream = createStream();
  let ended = false;
  let last: any = undefined;
  let sent = false;
  return {
    send() {
      if (ended) return;
      const now = JSON.parse(JSON.stringify(untrack(read)));
      if (!sent) (sent = true), stream.next(now);
      else {
        const ops = diffPatches(last, now);
        if (ops.length) stream.next(ops);
      }
      last = now;
    },
    end() {
      if (ended) return;
      ended = true;
      stream.return(undefined);
    },
    stream,
  };
});
