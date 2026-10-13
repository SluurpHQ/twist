// autoFocus at commit: the field made takes focus from what had it (the focus put back after moving nodes comes first).
import { expect, test } from "bun:test";
import * as React from "../../src/react.ts";
import { createRoot } from "../../src/client.ts";
import { flushSync } from "../../src/react-dom.ts";

const { createElement: h, useState } = React;

test("an autoFocus field made while another element has focus keeps it", () => {
  let edit!: (on: boolean) => void;
  const Grid = () => {
    const [editing, setEditing] = useState(false);
    edit = setEditing;
    return h("div", { tabIndex: 0, id: "grid" }, editing ? h("input", { autoFocus: true }) : h("output", null, "Pears"));
  };
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  flushSync(() => root.render(h(Grid)));
  (box.querySelector("#grid") as HTMLElement).focus();
  expect(document.activeElement?.id).toBe("grid");
  flushSync(() => edit(true));
  expect(document.activeElement?.tagName).toBe("INPUT");
  root.unmount();
  box.remove();
});
