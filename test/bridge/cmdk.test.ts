// cmdk (a command palette, as Sluurp's admin uses it) on Sluurp's React: the first item that matches is selected as soon as it is drawn.
import { expect, mock, test } from "bun:test";
import { dirname, join } from "node:path";
import * as Ours from "../../src/react.ts";
import * as ReactDOM from "../../src/react-dom.ts";
import * as jsx from "../../src/jsx-runtime.ts";
import * as OurCore from "../../src/core.ts";

// cmdk and the packages it uses, given Sluurp's React wherever they resolve React from.
const cmdk = join(dirname(Bun.resolveSync("cmdk/package.json", join(import.meta.dir, "libs"))), "dist", "index.mjs");
const from = [dirname(cmdk), ...["@radix-ui/react-dialog", "@radix-ui/react-primitive", "@radix-ui/react-id", "@radix-ui/react-compose-refs"].map((p) => {
  try {
    return dirname(Bun.resolveSync(p, dirname(cmdk)));
  } catch {
    return null;
  }
})].filter(Boolean) as string[];
// (REAL=1: React's own, to see what the test should get.)
if (!process.env.REAL) for (const dir of from) {
  for (const [spec, mod] of [["react", Ours], ["react-dom", ReactDOM], ["react/jsx-runtime", jsx]] as const) {
    try {
      mock.module(Bun.resolveSync(spec, dir), () => ({ ...mod, default: mod }));
    } catch {}
  }
}

// What the test draws with: Sluurp's React, or (REAL=1) React's own, as cmdk resolves it.
const real = (spec: string) => import(Bun.resolveSync(spec, dirname(cmdk)));
const React: any = process.env.REAL ? await real("react") : Ours;
const { createRoot } = process.env.REAL ? await real("react-dom/client") : OurCore;
const { flushSync } = process.env.REAL ? await real("react-dom") : OurCore;

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

test("cmdk selects the first matching item", async () => {
  const { Command } = await import(cmdk);
  const h = React.createElement;
  const container = document.createElement("div");
  document.body.append(container);
  let setQuery!: (q: string) => void;
  function Palette() {
    const [query, set] = React.useState("");
    setQuery = set;
    return h(
      Command,
      null,
      h(Command.Input, { value: query, onValueChange: set }),
      h(Command.List, null, ...["logs", "users", "users settings", "files"].map((v) => h(Command.Item, { key: v, value: v }, v))),
    );
  }
  const root = createRoot(container, { onUncaughtError: (e: any) => console.log("ERR", e?.stack ?? e) });
  root.render(h(Palette));
  await settle();
  const selected = () => container.querySelector('[cmdk-item][aria-selected="true"]')?.textContent;
  expect(selected()).toBe("logs");
  flushSync(() => setQuery("users"));
  await settle();
  expect(selected()).toBe("users");
  root.unmount();
});

test("the admin's palette, as it is: Ctrl+K, a word, Enter; Ctrl+K again, another word", async () => {
  const { Command } = await import(cmdk);
  const h = React.createElement;
  const container = document.createElement("div");
  document.body.append(container);
  function Palette() {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [found, setFound] = React.useState<string[]>([]);
    React.useEffect(() => {
      const key = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() !== "k" || !e.ctrlKey) return;
        e.preventDefault();
        setOpen((o: boolean) => !o);
      };
      document.addEventListener("keydown", key);
      return () => document.removeEventListener("keydown", key);
    }, []);
    React.useEffect(() => {
      const term = query.trim();
      if (term.length < 2) return setFound([]);
      let current = true;
      const soon = setTimeout(() => current && setFound(term === "users" ? [] : []), 30);
      return () => {
        current = false;
        clearTimeout(soon);
      };
    }, [query]);
    const pick = () => () => {
      setOpen(false);
      setQuery("");
    };
    const filter = (value: string, search: string) => (search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => value.toLowerCase().includes(w)) ? 1 : 0);
    return h(
      Command.Dialog,
      { open, onOpenChange: setOpen, label: "Admin" },
      h(
        Command,
        { filter },
        h(Command.Input, { value: query, onValueChange: setQuery }),
        h(
          Command.List,
          null,
          h(Command.Group, { heading: "Screens" }, ...["System", "Logs", "Backups"].map((s) => h(Command.Item, { key: s, value: `screen ${s}`, onSelect: pick() }, s))),
          h(Command.Group, { heading: "Collections" }, ...["classes", "users"].flatMap((c) => [h(Command.Item, { key: c, value: `collection ${c}`, onSelect: pick() }, c), h(Command.Item, { key: c + "-s", value: `settings ${c} fields schema`, onSelect: pick() }, `${c} › Settings`)])),
          found.length ? h(Command.Group, { heading: "Records" }, ...found.map((f) => h(Command.Item, { key: f, value: f }, f))) : null,
        ),
      ),
    );
  }
  const root = createRoot(container);
  root.render(h(Palette));
  await settle();
  const selected = () => document.querySelector('[cmdk-dialog][aria-label="Admin"] [cmdk-item][aria-selected="true"]')?.textContent;
  const typeIn = async (text: string) => {
    const input = document.querySelector('[cmdk-dialog][aria-label="Admin"] [cmdk-input]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  };
  const key = (k: string, ctrl = false) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: ctrl, bubbles: true }));
  key("k", true);
  await settle();
  await typeIn("logs");
  expect(selected()).toBe("Logs");
  key("Enter");
  await settle();
  key("k", true);
  await settle();
  await typeIn("users");
  expect(selected()).toBe("users");
  // Closed with Escape (the query kept), opened again, another word put in at once.
  key("Escape");
  await settle();
  key("k", true);
  await settle();
  await typeIn("classes settings");
  expect(selected()).toBe("classes › Settings");
  root.unmount();
});

test("cmdk opened a second time: the first match is selected again", async () => {
  const { Command } = await import(cmdk);
  const h = React.createElement;
  const container = document.createElement("div");
  document.body.append(container);
  let open!: (v: boolean) => void;
  let type!: (q: string) => void;
  function Palette() {
    const [isOpen, setOpen] = React.useState(false);
    const [query, set] = React.useState("");
    open = (v) => (setOpen(v), v || set(""));
    type = set;
    const filter = (value: string, search: string) => (search.toLowerCase().split(/\s+/).filter(Boolean).every((w) => value.toLowerCase().includes(w)) ? 1 : 0);
    return h(
      Command.Dialog,
      { open: isOpen, onOpenChange: setOpen, label: "Palette", filter },
      h(Command.Input, { value: query, onValueChange: set }),
      h(Command.List, null, h(Command.Group, { heading: "Screens" }, ...["screen logs", "collection users", "settings users fields", "screen files"].map((v) => h(Command.Item, { key: v, value: v }, v)))),
    );
  }
  const root = createRoot(container);
  root.render(h(Palette));
  await settle();
  const selected = () => document.querySelector('[cmdk-dialog][aria-label="Palette"] [cmdk-item][aria-selected="true"]')?.textContent;
  flushSync(() => open(true));
  await settle();
  flushSync(() => type("logs"));
  await settle();
  expect(selected()).toBe("screen logs");
  flushSync(() => open(false));
  await settle();
  flushSync(() => open(true));
  await settle();
  flushSync(() => type("users"));
  await settle();
  expect(selected()).toBe("collection users");
  root.unmount();
});

