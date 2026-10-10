// Sluurp's signals (@sluurp/signals: the React runtime, live() and sync, the SDK) and Twist's, as one: a signal of
// either read where the other is tracking is followed there. Each read across gets a mirror on the tracking side, a
// counter the other side bumps when the value changes; the value itself is always read from where it lives.
import * as sluurp from "../../../signals/index.js";
import { createRenderEffect, createRoot, createSignal, isTracking, setForeignRead, untrack } from "./signals.ts";

let installed = false;

/** Both systems follow each other's signals from now on. */
export function installSignalsBridge() {
  if (installed) return;
  installed = true;

  // Sluurp's signal read in a Twist computation: a Twist counter it reads, bumped by a Sluurp effect on each change.
  const twistMirrors = new WeakMap<object, () => number>();
  sluurp.setForeignRead((node: object) => {
    if (!isTracking()) return;
    let read = twistMirrors.get(node);
    if (!read) {
      const [count, setCount] = createSignal(0, { ownedWrite: true });
      twistMirrors.set(node, (read = count));
      let n = 0;
      let first = true;
      sluurp.effect(() => {
        sluurp.followNode(node);
        if (first) return void (first = false);
        sluurp.untrack(() => setCount(++n));
      });
    }
    read();
  });

  // Twist's node read in a Sluurp computation (a React component rendering, say): a Sluurp counter it reads, bumped
  // by a Twist effect on each change.
  const sluurpMirrors = new WeakMap<object, () => number>();
  setForeignRead((node) => {
    if (!sluurp.listening()) return;
    let read = sluurpMirrors.get(node);
    if (!read) {
      const count = sluurp.signal(0);
      sluurpMirrors.set(node, (read = count));
      let n = 0;
      let first = true;
      createRoot(() =>
        createRenderEffect(
          () => {
            try {
              return node.read();
            } catch {
              return undefined;
            }
          },
          () => {
            if (first) return void (first = false);
            untrack(() => count.set(++n));
          },
        ),
      );
    }
    read();
  });
}
