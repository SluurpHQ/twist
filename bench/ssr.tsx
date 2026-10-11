// The benchmark's table rendered to HTML with React's API: on React, Preact and ours.
import { renderToString } from "react-dom/server";
import { build } from "./rows.ts";

const rows = build(1000);
const Table = () => (
  <table className="table table-hover table-striped test-data">
    <tbody>
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="col-md-1">{row.id}</td>
          <td className="col-md-4"><a>{row.label}</a></td>
          <td className="col-md-1"><a><span className="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
          <td className="col-md-6" />
        </tr>
      ))}
    </tbody>
  </table>
);
export const render = (): string => renderToString(<Table />);
