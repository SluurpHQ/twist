// The same benchmark written with signals: a label and the selection bound to their nodes, rows never render again.
import { memo } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { computed, selector, signal } from "../../signals/index.js";
import { build as rows, register } from "./shared.ts";

type Row = { id: number; label: ReturnType<typeof signal<string>>; cls: () => string };
const data = signal<Row[]>([]);
const selected = signal(0);
const isSelected = selector(selected);
const make = (n: number): Row[] =>
  rows(n).map((r) => ({ id: r.id, label: signal(r.label), cls: computed(() => (isSelected(r.id) ? "danger" : "")) }));

const remove = (id: number) => data.set(data.peek().filter((r) => r.id !== id));

const RowView = memo(({ item }: { item: Row }) => (
  <tr className={item.cls}>
    <td className="col-md-1">{item.id}</td>
    <td className="col-md-4"><a onClick={() => selected.set(item.id)}>{item.label}</a></td>
    <td className="col-md-1"><a onClick={() => remove(item.id)}><span className="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
    <td className="col-md-6" />
  </tr>
));

function Main() {
  return (
    <table className="table table-hover table-striped test-data">
      <tbody>{data().map((item) => <RowView key={item.id} item={item} />)}</tbody>
    </table>
  );
}

const host = document.getElementById("main")!;
flushSync(() => createRoot(host).render(<Main />));

register(host, {
  RUN: () => data.set(make(1000)),
  RUN_LOTS: () => data.set(make(10000)),
  ADD: () => data.set(data.peek().concat(make(1000))),
  UPDATE: () => {
    const d = data.peek();
    for (let i = 0; i < d.length; i += 10) d[i]!.label.update((l) => l + " !!!");
  },
  CLEAR: () => data.set([]),
  SWAP: () => {
    const d = data.peek().slice();
    if (d.length <= 998) return;
    const t = d[1]!;
    d[1] = d[998]!;
    d[998] = t;
    data.set(d);
  },
});
