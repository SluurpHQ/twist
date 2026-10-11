// The benchmark's table rendered to HTML with Solid 2's API: on Solid and on Twist.
import { For } from "solid-js";
import { renderToString } from "@solidjs/web";
import { build } from "./rows.ts";

const rows = build(1000);
const Table = () => (
  <table class="table table-hover table-striped test-data">
    <tbody>
      <For each={rows}>
        {(row) => (
          <tr>
            <td class="col-md-1">{row.id}</td>
            <td class="col-md-4"><a>{row.label}</a></td>
            <td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
            <td class="col-md-6" />
          </tr>
        )}
      </For>
    </tbody>
  </table>
);
export const render = (): string => renderToString(() => <Table />);
