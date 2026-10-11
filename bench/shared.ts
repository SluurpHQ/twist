// What every benchmark app shares: the rows, the cases, and timing them (window.bench, window.benchOne).
import { flushSync } from "react-dom";

export { build } from "./rows.ts";

type Action = "RUN" | "RUN_LOTS" | "ADD" | "UPDATE" | "CLEAR" | "SWAP";

/** The cases, each timed from the action to the layout it causes. */
export function register(host: HTMLElement, act: Record<Action, () => void>) {
  const run = (a: Action) => () => flushSync(act[a]);
  const cell = (row: number, col: number) => (host.querySelector("tbody")!.children[row]!.children[col]!.firstChild as HTMLElement);
  const cases: Record<string, { warm: () => void; run: () => void }> = {
    "create 1k": { warm: run("CLEAR"), run: run("RUN") },
    "replace 1k": { warm: run("RUN"), run: run("RUN") },
    "update every 10th": { warm: run("RUN"), run: run("UPDATE") },
    "select row": { warm: run("RUN"), run: () => flushSync(() => cell(1, 1).click()) },
    "swap rows": { warm: run("RUN"), run: run("SWAP") },
    "remove row": { warm: run("RUN"), run: () => flushSync(() => cell(4, 2).click()) },
    "create 10k": { warm: run("CLEAR"), run: run("RUN_LOTS") },
    "append 1k to 1k": { warm: run("RUN"), run: run("ADD") },
    "clear 1k": { warm: run("RUN"), run: run("CLEAR") },
  };
  const timed = (fn: () => void) => {
    const t = performance.now();
    fn();
    void host.offsetHeight;
    return performance.now() - t;
  };
  (window as any).benchOne = (name: string) => (cases[name]!.warm(), cases[name]!.run());
  (window as any).bench = async (runs = 15) => {
    const out: Record<string, number> = {};
    for (const [name, c] of Object.entries(cases)) {
      const ts: number[] = [];
      for (let i = 0; i < runs; i++) {
        c.warm();
        await new Promise((r) => setTimeout(r, 0));
        ts.push(timed(c.run));
      }
      ts.sort((a, b) => a - b);
      out[name] = +ts[ts.length >> 1]!.toFixed(2);
    }
    run("CLEAR")();
    return out;
  };
}
