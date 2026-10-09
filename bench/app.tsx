// The keyed js-framework-benchmark app (React hooks version), timed in the page.
import { memo, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const A = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const C = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const N = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];
let seed = 1;
const rnd = (max: number) => ((seed = (seed * 16807) % 2147483647), seed % max);
let nextId = 1;
const build = (count: number) =>
  Array.from({ length: count }, () => ({ id: nextId++, label: `${A[rnd(A.length)]} ${C[rnd(C.length)]} ${N[rnd(N.length)]}` }));

type Row = { id: number; label: string };
type State = { data: Row[]; selected: number };
function reducer(s: State, a: any): State {
  switch (a.type) {
    case "RUN": return { data: build(1000), selected: 0 };
    case "RUN_LOTS": return { data: build(10000), selected: 0 };
    case "ADD": return { data: s.data.concat(build(1000)), selected: s.selected };
    case "UPDATE": {
      const d = s.data.slice();
      for (let i = 0; i < d.length; i += 10) d[i] = { ...d[i], label: d[i].label + " !!!" };
      return { data: d, selected: s.selected };
    }
    case "CLEAR": return { data: [], selected: 0 };
    case "SWAP": {
      if (s.data.length <= 998) return s;
      const d = s.data.slice();
      const t = d[1]; d[1] = d[998]; d[998] = t;
      return { data: d, selected: s.selected };
    }
    case "REMOVE": {
      const i = s.data.findIndex((r) => r.id === a.id);
      return { data: [...s.data.slice(0, i), ...s.data.slice(i + 1)], selected: s.selected };
    }
    case "SELECT": return { data: s.data, selected: a.id };
  }
  return s;
}

const RowView = memo(({ item, selected, dispatch }: { item: Row; selected: boolean; dispatch: any }) => (
  <tr className={selected ? "danger" : ""}>
    <td className="col-md-1">{item.id}</td>
    <td className="col-md-4"><a onClick={() => dispatch({ type: "SELECT", id: item.id })}>{item.label}</a></td>
    <td className="col-md-1"><a onClick={() => dispatch({ type: "REMOVE", id: item.id })}><span className="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
    <td className="col-md-6" />
  </tr>
));

let dispatchOut: any;
function Main() {
  const [{ data, selected }, dispatch] = useReducer(reducer, { data: [], selected: 0 });
  dispatchOut = dispatch;
  return (
    <table className="table table-hover table-striped test-data">
      <tbody>{data.map((item) => <RowView key={item.id} item={item} selected={selected === item.id} dispatch={dispatch} />)}</tbody>
    </table>
  );
}

const host = document.getElementById("main")!;
flushSync(() => createRoot(host).render(<Main />));

const act = (a: any) => flushSync(() => dispatchOut(a));
const timed = (fn: () => void) => {
  const t = performance.now();
  fn();
  void host.offsetHeight;
  return performance.now() - t;
};
const tbody = () => host.querySelector("tbody")!;
const click = (row: number, col: number) => (tbody().children[row].children[col].firstChild as HTMLElement).click();

const cases: Record<string, { warm?: () => void; run: () => void }> = {
  "create 1k": { warm: () => act({ type: "CLEAR" }), run: () => act({ type: "RUN" }) },
  "replace 1k": { warm: () => act({ type: "RUN" }), run: () => act({ type: "RUN" }) },
  "update every 10th": { warm: () => act({ type: "RUN" }), run: () => act({ type: "UPDATE" }) },
  "select row": { warm: () => act({ type: "RUN" }), run: () => flushSync(() => click(1, 1)) },
  "swap rows": { warm: () => act({ type: "RUN" }), run: () => act({ type: "SWAP" }) },
  "remove row": { warm: () => act({ type: "RUN" }), run: () => flushSync(() => click(4, 2)) },
  "create 10k": { warm: () => act({ type: "CLEAR" }), run: () => act({ type: "RUN_LOTS" }) },
  "append 1k to 1k": { warm: () => act({ type: "RUN" }), run: () => act({ type: "ADD" }) },
  "clear 1k": { warm: () => act({ type: "RUN" }), run: () => act({ type: "CLEAR" }) },
};

(window as any).benchOne = (name: string) => (cases[name].warm?.(), cases[name].run());
(window as any).bench = async (runs = 15) => {
  const out: Record<string, number> = {};
  for (const [name, c] of Object.entries(cases)) {
    const ts: number[] = [];
    for (let i = 0; i < runs; i++) {
      c.warm?.();
      await new Promise((r) => setTimeout(r, 0));
      ts.push(timed(c.run));
    }
    ts.sort((a, b) => a - b);
    out[name] = +ts[ts.length >> 1].toFixed(2);
  }
  act({ type: "CLEAR" });
  return out;
};
