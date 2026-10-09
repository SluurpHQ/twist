// The keyed js-framework-benchmark app (React hooks version).
import { memo, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { build, register } from "./shared.ts";

type Row = { id: number; label: string };
type State = { data: Row[]; selected: number };
function reducer(s: State, a: any): State {
  switch (a.type) {
    case "RUN": return { data: build(1000), selected: 0 };
    case "RUN_LOTS": return { data: build(10000), selected: 0 };
    case "ADD": return { data: s.data.concat(build(1000)), selected: s.selected };
    case "UPDATE": {
      const d = s.data.slice();
      for (let i = 0; i < d.length; i += 10) d[i] = { ...d[i]!, label: d[i]!.label + " !!!" };
      return { data: d, selected: s.selected };
    }
    case "CLEAR": return { data: [], selected: 0 };
    case "SWAP": {
      if (s.data.length <= 998) return s;
      const d = s.data.slice();
      const t = d[1]!; d[1] = d[998]!; d[998] = t;
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

let dispatch: any;
function Main() {
  const [{ data, selected }, d] = useReducer(reducer, { data: [], selected: 0 });
  dispatch = d;
  return (
    <table className="table table-hover table-striped test-data">
      <tbody>{data.map((item) => <RowView key={item.id} item={item} selected={selected === item.id} dispatch={d} />)}</tbody>
    </table>
  );
}

const host = document.getElementById("main")!;
flushSync(() => createRoot(host).render(<Main />));
const to = (type: string) => () => dispatch({ type });
register(host, { RUN: to("RUN"), RUN_LOTS: to("RUN_LOTS"), ADD: to("ADD"), UPDATE: to("UPDATE"), CLEAR: to("CLEAR"), SWAP: to("SWAP") });
