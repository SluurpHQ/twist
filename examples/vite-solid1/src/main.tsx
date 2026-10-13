import { createContext, createResource, createSignal, For, Index, onMount, Show, splitProps, Suspense, useContext } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Portal, render } from "solid-js/web";

const Theme = createContext("light");

function autofocus(el: HTMLElement) {
  onMount(() => el.focus());
}

function Badge(props: { label: string; tone?: string; children?: any }) {
  const [own, rest] = splitProps(props, ["label"]);
  const theme = useContext(Theme);
  return (
    <span class="badge" classList={{ warm: rest.tone === "warm" }} data-theme={theme}>
      {own.label}
    </span>
  );
}

function Greeting(props: { name: string }) {
  const [text] = createResource(() => props.name, (name) => new Promise<string>((r) => setTimeout(() => r(`Hello ${name}`), 50)));
  return <p class="greeting">{text()}</p>;
}

function App() {
  const [count, setCount] = createSignal(0);
  const [state, setState] = createStore({ todos: [{ title: "one", done: false }, { title: "two", done: true }] });
  return (
    <Theme.Provider value="dark">
      <main>
        <h1>Count: {count()}</h1>
        <button onClick={() => setCount(count() + 1)}>Add one</button>
        <button onClick={() => setState("todos", (t) => [...t, { title: `item ${t.length + 1}`, done: false }])}>Add item</button>
        <button onClick={() => setState("todos", 0, "done", (d) => !d)}>Toggle first</button>
        <button onClick={() => setState(produce((s) => s.todos.pop()))}>Remove last</button>
        <input use:autofocus />
        <Show when={count() > 2} fallback={<p>Small</p>}>
          <p>Big</p>
        </Show>
        <ul>
          <For each={state.todos}>
            {(todo, i) => (
              <li classList={{ done: todo.done }}>
                {i() + 1}. {todo.title}
              </li>
            )}
          </For>
        </ul>
        <ol>
          <Index each={state.todos}>{(todo) => <li>{todo().title}</li>}</Index>
        </ol>
        <Badge label="new" tone="warm" />
        <Suspense fallback={<p class="greeting">Loading…</p>}>
          <Greeting name="Solid 1" />
        </Suspense>
        <Portal>
          <p class="portal">In a portal</p>
        </Portal>
      </main>
    </Theme.Provider>
  );
}

render(() => <App />, document.getElementById("app")!);
