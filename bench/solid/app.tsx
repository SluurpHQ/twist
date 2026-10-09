// The same benchmark in Solid (compiled templates and signals), as js-framework-benchmark's keyed Solid entry.
import { createSelector, createSignal, For, batch } from "solid-js";
import { render } from "solid-js/web";
import { build, register } from "../shared.ts";

type Row = { id: number; label: () => string; setLabel: (v: string) => void; text: string };
const [data, setData] = createSignal<Row[]>([]);
const [selected, setSelected] = createSignal(0);
const isSelected = createSelector(selected);
const make = (n: number): Row[] =>
  build(n).map((r) => {
    const [label, setLabel] = createSignal(r.label);
    return { id: r.id, label, setLabel, text: r.label };
  });
const remove = (id: number) => setData((d) => d.filter((r) => r.id !== id));

const host = document.getElementById("main")!;
render(
  () => (
    <table class="table table-hover table-striped test-data">
      <tbody>
        <For each={data()}>
          {(row) => (
            <tr class={isSelected(row.id) ? "danger" : ""}>
              <td class="col-md-1">{row.id}</td>
              <td class="col-md-4"><a onClick={() => setSelected(row.id)}>{row.label()}</a></td>
              <td class="col-md-1"><a onClick={() => remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
              <td class="col-md-6" />
            </tr>
          )}
        </For>
      </tbody>
    </table>
  ),
  host,
);

register(host, {
  RUN: () => setData(make(1000)),
  RUN_LOTS: () => setData(make(10000)),
  ADD: () => setData((d) => d.concat(make(1000))),
  UPDATE: () =>
    batch(() => {
      const d = data();
      for (let i = 0; i < d.length; i += 10) d[i]!.setLabel(d[i]!.label() + " !!!");
    }),
  CLEAR: () => setData([]),
  SWAP: () => {
    const d = data().slice();
    if (d.length <= 998) return;
    const t = d[1]!;
    d[1] = d[998]!;
    d[998] = t;
    setData(d);
  },
});
