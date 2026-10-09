// The same benchmark in plain DOM code, no framework: the floor the others are measured against.
import { build, register } from "./shared.ts";

type Row = { id: number; label: string; tr: HTMLTableRowElement; text: Text };
const host = document.getElementById("main")!;
host.innerHTML = '<table class="table table-hover table-striped test-data"><tbody></tbody></table>';
const tbody = host.querySelector("tbody")!;
const template = document.createElement("template");
template.innerHTML =
  '<tr><td class="col-md-1"> </td><td class="col-md-4"><a> </a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>';
const rowTemplate = template.content.firstChild as HTMLTableRowElement;
let rows: Row[] = [];
let selected: Row | null = null;

function make(n: number) {
  const out: Row[] = [];
  for (const d of build(n)) {
    const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement;
    (tr.firstChild!.firstChild as Text).data = String(d.id);
    const text = tr.childNodes[1]!.firstChild!.firstChild as Text;
    text.data = d.label;
    out.push({ ...d, tr, text });
  }
  return out;
}
function append(list: Row[]) {
  const frag = document.createDocumentFragment();
  for (const r of list) frag.appendChild(r.tr);
  tbody.appendChild(frag);
}
const clear = () => ((tbody.textContent = ""), (rows = []), (selected = null));

// One listener for the table: which row, and whether its select or remove link.
tbody.addEventListener("click", (e) => {
  const a = (e.target as Element).closest("a");
  if (!a) return;
  const tr = a.closest("tr")!;
  const i = rows.findIndex((r) => r.tr === tr);
  if (a.parentElement!.cellIndex === 1) {
    if (selected) selected.tr.className = "";
    selected = rows[i]!;
    tr.className = "danger";
  } else {
    tr.remove();
    rows.splice(i, 1);
  }
});

register(host, {
  RUN: () => (clear(), append((rows = make(1000)))),
  RUN_LOTS: () => (clear(), append((rows = make(10000)))),
  ADD: () => {
    const more = make(1000);
    rows = rows.concat(more);
    append(more);
  },
  UPDATE: () => {
    for (let i = 0; i < rows.length; i += 10) rows[i]!.text.data = rows[i]!.label += " !!!";
  },
  CLEAR: clear,
  SWAP: () => {
    if (rows.length <= 998) return;
    const a = rows[1]!;
    const b = rows[998]!;
    const afterB = b.tr.nextSibling;
    tbody.insertBefore(b.tr, a.tr);
    tbody.insertBefore(a.tr, afterB);
    rows[1] = b;
    rows[998] = a;
  },
});
