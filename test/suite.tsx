// The runtime's checks, run in a browser: each draws into a fresh element and looks at the DOM.
import {
  Component, Suspense, createContext, forwardRef, lazy, memo, use, useContext, useEffect, useId, useImperativeHandle,
  useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, Fragment,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import * as ReactAll from "react";
(window as any).__dom = { createRoot, React: ReactAll };
import { renderToString } from "react-dom/server";
import { signal } from "../../signals/index.js";

type Test = { name: string; fn: (box: HTMLElement) => Promise<void> | void };
const tests: Test[] = [];
const test = (name: string, fn: Test["fn"]) => tests.push({ name, fn });
const eq = (a: any, b: any, what = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => setTimeout(r, 20));
const mount = (box: HTMLElement, el: any) => {
  const root = createRoot(box);
  // root.render schedules, as in React: drawn now for the checks that read the page right after.
  flushSync(() => root.render(el));
  return root;
};
const click = (el: Element) => (el as HTMLElement).click();

test("draws elements and text", (box) => {
  mount(box, <div className="a" id="x"><span>hi</span> {1}{2}</div>);
  eq(box.innerHTML, '<div class="a" id="x"><span>hi</span> 12</div>');
});

test("state updates only its component", async (box) => {
  let parents = 0, children = 0;
  function Child() {
    const [n, set] = useState(0);
    children++;
    return <button onClick={() => set(n + 1)}>{n}</button>;
  }
  function Parent() {
    parents++;
    return <div><Child /></div>;
  }
  mount(box, <Parent />);
  click(box.querySelector("button")!);
  eq(box.textContent, "1");
  eq([parents, children], [1, 2], "renders");
});

test("functional updates batch", async (box) => {
  function C() {
    const [n, set] = useState(0);
    return <button onClick={() => { set((x) => x + 1); set((x) => x + 1); set((x) => x + 1); }}>{n}</button>;
  }
  mount(box, <C />);
  click(box.querySelector("button")!);
  eq(box.textContent, "3");
});

test("keyed list keeps its nodes when reordered", async (box) => {
  let setList: any;
  function L() {
    const [list, set] = useState(["a", "b", "c"]);
    setList = set;
    return <ul>{list.map((x) => <li key={x}>{x}</li>)}</ul>;
  }
  mount(box, <L />);
  const before = [...box.querySelectorAll("li")];
  flushSync(() => setList(["c", "a", "b"]));
  const after = [...box.querySelectorAll("li")];
  eq(after.map((l) => l.textContent), ["c", "a", "b"]);
  eq(after[0] === before[2] && after[1] === before[0], true, "same nodes");
  flushSync(() => setList(["b"]));
  eq(box.textContent, "b");
});

test("context reaches only its readers", async (box) => {
  const Ctx = createContext("x");
  let middle = 0;
  const Reader = () => <i>{useContext(Ctx)}</i>;
  const Middle = memo(() => (middle++, <Reader />));
  let set: any;
  function App() {
    const [v, s] = useState("one");
    set = s;
    return <Ctx value={v}><Middle /></Ctx>;
  }
  mount(box, <App />);
  flushSync(() => set("two"));
  eq(box.textContent, "two");
  eq(middle, 1, "middle renders");
});

test("effects run after, clean up on unmount", async (box) => {
  const log: string[] = [];
  function C() {
    useLayoutEffect(() => (log.push("layout"), () => log.push("layout off")), []);
    useEffect(() => (log.push("effect"), () => log.push("effect off")), []);
    log.push("render");
    return null;
  }
  const root = mount(box, <C />);
  await frame();
  root.unmount();
  eq(log, ["render", "layout", "effect", "layout off", "effect off"]);
});

test("refs: object, callback, cleanup", async (box) => {
  const obj = { current: null as any };
  let got: any = null, cleaned = false;
  const root = mount(box, <div><p ref={obj} /><b ref={(el) => { got = el; return () => { cleaned = true; }; }} /></div>);
  eq(obj.current?.nodeName, "P");
  eq(got?.nodeName, "B");
  root.unmount();
  eq([obj.current, cleaned], [null, true]);
});

const typeIn = (el: HTMLInputElement, v: string) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);

test("controlled input", async (box) => {
  function C() {
    const [v, set] = useState("ab");
    return <input value={v} onChange={(e: any) => set(e.target.value.toUpperCase())} />;
  }
  mount(box, <C />);
  const input = box.querySelector("input")!;
  // As a person (or testing-library) types: past React's value tracker, which treats code-set values as no change.
  typeIn(input, "abc");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  eq(input.value, "ABC");
  function Locked() {
    return <input value="fixed" onChange={() => {}} />;
  }
  const b2 = document.createElement("div");
  mount(b2, <Locked />);
  const i2 = b2.querySelector("input")!;
  typeIn(i2, "changed");
  i2.dispatchEvent(new Event("input", { bubbles: true }));
  eq(i2.value, "fixed");
});

test("controlled checkbox: checked before type, toggled by a click", async (box) => {
  function C() {
    const [on, set] = useState(true);
    return <label><input checked={on} type="checkbox" onClick={() => {}} onChange={(e: any) => set(e.target.checked)} />{on ? "on" : "off"}</label>;
  }
  mount(box, <C />);
  const input = box.querySelector("input")!;
  eq(input.checked, true, "starts checked");
  input.click();
  eq([input.checked, box.textContent], [false, "off"]);
});

test("portal draws elsewhere and goes", async (box) => {
  const away = document.createElement("section");
  document.body.append(away);
  const root = mount(box, <div>{createPortal(<em>far</em>, away)}</div>);
  eq([box.innerHTML, away.innerHTML], ["<div></div>", "<em>far</em>"]);
  root.unmount();
  eq(away.innerHTML, "");
  away.remove();
});

test("a portal into SVG makes SVG", async (box) => {
  function C() {
    const [layer, set] = useState<SVGGElement | null>(null);
    return <svg><g ref={set} />{layer && createPortal(<rect width={3} />, layer)}</svg>;
  }
  mount(box, <C />);
  await tick();
  const rect = box.querySelector("rect")!;
  eq([rect.namespaceURI, rect.parentElement!.nodeName], ["http://www.w3.org/2000/svg", "g"]);
});

test("suspense waits on use(promise)", async (box) => {
  let done: any;
  const p = new Promise<string>((r) => (done = r));
  const Data = () => <b>{use(p)}</b>;
  mount(box, <Suspense fallback={<i>wait</i>}><Data /></Suspense>);
  await tick();
  eq(box.innerHTML, "<i>wait</i>");
  done("ready");
  await frame();
  eq(box.innerHTML, "<b>ready</b>");
});

test("error boundary", async (box) => {
  class Boundary extends Component<any, { error: any }> {
    state = { error: null as any };
    static getDerivedStateFromError(error: any) {
      return { error };
    }
    render() {
      return this.state.error ? <p>caught {this.state.error.message}</p> : this.props.children;
    }
  }
  const Bad = () => {
    throw new Error("boom");
  };
  mount(box, <Boundary><Bad /></Boundary>);
  await tick();
  eq(box.textContent, "caught boom");
});

test("class component: state and lifecycle", async (box) => {
  const log: string[] = [];
  class C extends Component<{}, { n: number }> {
    state = { n: 0 };
    componentDidMount() {
      log.push("mount");
    }
    componentDidUpdate(_p: any, s: any) {
      log.push(`update ${s.n}->${this.state.n}`);
    }
    componentWillUnmount() {
      log.push("unmount");
    }
    render() {
      return <button onClick={() => this.setState((s) => ({ n: s.n + 1 }))}>{this.state.n}</button>;
    }
  }
  const root = mount(box, <C />);
  click(box.querySelector("button")!);
  eq(box.textContent, "1");
  root.unmount();
  eq(log, ["mount", "update 0->1", "unmount"]);
});

test("memo with a compare", async (box) => {
  let renders = 0;
  const M = memo((p: { a: number; b: number }) => (renders++, <span>{p.a}</span>), (x, y) => x.a === y.a);
  let set: any;
  function App() {
    const [b, s] = useState(0);
    set = s;
    return <M a={1} b={b} />;
  }
  mount(box, <App />);
  flushSync(() => set(5));
  eq(renders, 1);
});

test("useSyncExternalStore", async (box) => {
  let value = 1;
  const subs = new Set<() => void>();
  const store = { sub: (f: () => void) => (subs.add(f), () => subs.delete(f)), get: () => value };
  const C = () => <b>{useSyncExternalStore(store.sub, store.get)}</b>;
  mount(box, <C />);
  value = 2;
  subs.forEach((f) => f());
  flushSync();
  eq(box.textContent, "2");
});

test("a signal read in render re-renders", async (box) => {
  const count = signal(1);
  const C = () => <b>{count()}</b>;
  mount(box, <C />);
  count.set(7);
  flushSync();
  eq(box.textContent, "7");
});

test("forwardRef and useImperativeHandle", async (box) => {
  const Input = forwardRef((_p: any, ref: any) => {
    const inner = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({ name: () => inner.current!.nodeName }));
    return <input ref={inner} />;
  });
  const ref: any = { current: null };
  mount(box, <Input ref={ref} />);
  eq(ref.current.name(), "INPUT");
});

test("useReducer", async (box) => {
  function C() {
    const [s, d] = useReducer((s: number, a: number) => s + a, 10);
    return <button onClick={() => d(5)}>{s}</button>;
  }
  mount(box, <C />);
  click(box.querySelector("button")!);
  eq(box.textContent, "15");
});

test("lazy", async (box) => {
  const L = lazy(async () => ({ default: () => <u>lazy</u> }));
  mount(box, <Suspense fallback="…"><L /></Suspense>);
  await frame();
  eq(box.innerHTML, "<u>lazy</u>");
});

test("fragments and nested arrays move", async (box) => {
  let set: any;
  function C() {
    const [flip, s] = useState(false);
    set = s;
    const a = <Fragment key="a"><i>1</i><i>2</i></Fragment>;
    const b = <Fragment key="b"><b>3</b></Fragment>;
    return <div>{flip ? [b, a] : [a, b]}</div>;
  }
  mount(box, <C />);
  flushSync(() => set(true));
  eq(box.textContent, "312");
});

test("style, svg and booleans", (box) => {
  mount(box, (
    <div style={{ marginTop: 4, opacity: 0.5, "--x": "1" } as any} hidden={false} aria-hidden={false}>
      <svg viewBox="0 0 2 2"><path strokeWidth={2} d="M0 0" /></svg>
      <input disabled readOnly={false} />
    </div>
  ));
  const div = box.firstElementChild as HTMLElement;
  eq([div.style.marginTop, div.style.opacity, div.style.getPropertyValue("--x"), div.hidden, div.getAttribute("aria-hidden")], ["4px", "0.5", "1", false, "false"]);
  eq(box.querySelector("svg")!.getAttribute("viewBox"), "0 0 2 2");
  eq(box.querySelector("path")!.getAttribute("stroke-width"), "2");
  eq(box.querySelector("path")!.namespaceURI, "http://www.w3.org/2000/svg");
  eq((box.querySelector("input") as HTMLInputElement).disabled, true);
});

test("useId is unique and stable", async (box) => {
  const ids: string[] = [];
  const C = () => {
    const id = useId();
    ids.push(id);
    return <label htmlFor={id}>x</label>;
  };
  mount(box, <><C /><C /></>);
  eq(ids[0] !== ids[1] && /^_r_/.test(ids[0]!), true);
});

test("form action gets the form's data", async (box) => {
  let got = "";
  mount(box, <form action={(d: FormData) => { got = String(d.get("q")); }}><input name="q" defaultValue="hello" /><button>go</button></form>);
  click(box.querySelector("button")!);
  eq(got, "hello");
});

test("Base UI slider shows its thumb", async (box) => {
  const { Slider } = await import("@base-ui/react/slider");
  mount(box, (
    <Slider.Root defaultValue={[15]} thumbAlignment="edge" style={{ width: 200 }}>
      <Slider.Control style={{ width: 200, height: 10, position: "relative" }}>
        <Slider.Track><Slider.Indicator /></Slider.Track>
        {[0].map((i) => <Slider.Thumb key={i} style={{ width: 10, height: 10 }} />)}
      </Slider.Control>
    </Slider.Root>
  ));
  await frame();
  await frame();
  const thumb = box.querySelector("[data-index]") as HTMLElement;
  eq(thumb.style.visibility, "", "thumb visible");
});

test("Base UI select opens and picks", async (box) => {
  const { Select } = await import("@base-ui/react/select");
  const items = [{ value: "a", label: "Apple" }, { value: "b", label: "Banana" }];
  mount(box, (
    <Select.Root items={items} defaultValue="a">
      <Select.Trigger data-testid="trigger"><Select.Value /></Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            {items.map((i) => <Select.Item key={i.value} value={i.value}><Select.ItemText>{i.label}</Select.ItemText></Select.Item>)}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  ));
  await frame();
  const trigger = box.querySelector("[data-testid=trigger]") as HTMLElement;
  eq(trigger.textContent, "Apple", "shows the value");
  trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
  trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  trigger.click();
  await frame();
  await frame();
  const options = [...document.querySelectorAll("[role=option]")] as HTMLElement[];
  eq(options.map((o) => o.textContent), ["Apple", "Banana"], "options shown");
  options[1]!.click();
  await frame();
  eq(trigger.textContent, "Banana", "picked");
});

test("form action: status while pending, state after, form reset", async (box) => {
  const { useActionState } = await import("react");
  const { useFormStatus } = await import("react-dom");
  let finish: () => void = () => {};
  function Status() {
    const { pending } = useFormStatus();
    return <i>{pending ? "sending" : "idle"}</i>;
  }
  function F() {
    const [count, add] = useActionState(async (n: number, data: FormData) => {
      await new Promise<void>((r) => (finish = r));
      return n + Number(data.get("by"));
    }, 0);
    return (
      <form action={add}>
        <input name="by" defaultValue="2" />
        <b>{count}</b>
        <Status />
        <button>go</button>
      </form>
    );
  }
  mount(box, <F />);
  (box.querySelector("input") as HTMLInputElement).value = "5";
  click(box.querySelector("button")!);
  await tick();
  eq(box.querySelector("i")!.textContent, "sending", "pending");
  finish();
  await frame();
  eq([box.querySelector("b")!.textContent, box.querySelector("i")!.textContent, (box.querySelector("input") as HTMLInputElement).value], ["5", "idle", "2"]);
});

test("react-redux: a dispatch re-renders only what selects the changed part", async (box) => {
  const { Provider, useSelector, useDispatch, connect } = await import("react-redux");
  // A minimal Redux store: the binding needs only getState, dispatch and subscribe.
  const reducer = (s = { a: 0, b: 0 }, action: any) => (action.type === "a" ? { ...s, a: s.a + 1 } : action.type === "b" ? { ...s, b: s.b + 1 } : s);
  let state = reducer(undefined, { type: "init" });
  const subs = new Set<() => void>();
  const store = { getState: () => state, dispatch: (a: any) => ((state = reducer(state, a)), subs.forEach((f) => f()), a), subscribe: (f: () => void) => (subs.add(f), () => subs.delete(f)) };
  const renders = { A: 0, B: 0 };
  const A = () => (renders.A++, <i>{useSelector((s: any) => s.a)}</i>);
  const B = () => (renders.B++, <b>{useSelector((s: any) => s.b)}</b>);
  const C = connect((s: any) => ({ total: s.a + s.b }))(({ total }: any) => <u>{total}</u>);
  function Go() {
    const dispatch = useDispatch();
    return <button onClick={() => dispatch({ type: "a" })}>a</button>;
  }
  mount(box, <Provider store={store}><A /><B /><C /><Go /></Provider>);
  click(box.querySelector("button")!);
  await tick();
  eq([box.querySelector("i")!.textContent, box.querySelector("b")!.textContent, box.querySelector("u")!.textContent], ["1", "0", "1"]);
  eq(renders, { A: 2, B: 1 }, "renders");
});

test("server render", () => {
  const Ctx = createContext(1);
  const C = () => {
    const [n] = useState(3);
    return <p className="x" style={{ marginTop: 2 }} data-on={true}>{n} &lt; {useContext(Ctx)}</p>;
  };
  eq(renderToString(<Ctx value={9}><C /><input defaultValue="v" disabled /></Ctx>), '<p class="x" style="margin-top:2px" data-on="true">3<!-- --> &lt; <!-- -->9</p><input value="v" disabled=""/>');
});

(async () => {
  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const t of tests) {
    const box = document.createElement("div");
    document.body.append(box);
    try {
      await t.fn(box);
      results.push({ name: t.name, ok: true });
    } catch (e: any) {
      results.push({ name: t.name, ok: false, error: String(e?.stack ?? e) });
    }
    box.remove();
  }
  (window as any).__results = results;
  document.body.innerHTML = `<pre>${results.map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.name}${r.error ? "\n     " + r.error.split("\n")[0] : ""}`).join("\n")}</pre>`;
})();
