// The keyed js-framework-benchmark app in Solid 2 (compiled templates, signals, a projection for the selected row):
// built on Solid itself and on Twist, from this one file.
import { createProjection, createSignal, For } from "solid-js";
import { render } from "@solidjs/web";
import { build, register } from "./shared.ts";

type Row = { id: number; label: () => string; setLabel: (v: string) => void };
const make = (n: number): Row[] =>
  build(n).map((r) => {
    const [label, setLabel] = createSignal(r.label);
    return { id: r.id, label, setLabel };
  });

const [data, setData] = createSignal<Row[]>([]);
const [selected, setSelected] = createSignal(0);
// Only the row that was selected and the one that is now change: a projection, as Solid 2's createSelector.
let was = 0;
const isSelected = createProjection<Record<number, boolean>>((draft) => {
  const now = selected();
  if (was) delete draft[was];
  if (now) draft[now] = true;
  was = now;
}, {});
const remove = (id: number) => setData((d) => d.filter((r) => r.id !== id));

const host = document.getElementById("main")!;
render(
  () => (
    <table class="table table-hover table-striped test-data">
      <tbody>
        <For each={data()}>
          {(row) => (
            <tr class={isSelected[row.id] ? "danger" : ""}>
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
  UPDATE: () => {
    const d = data();
    for (let i = 0; i < d.length; i += 10) d[i]!.setLabel(d[i]!.label() + " !!!");
  },
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
