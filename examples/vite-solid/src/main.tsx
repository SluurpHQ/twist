import { createSignal, For, Show } from "solid-js";
import { render } from "@solidjs/web";

function App() {
  const [count, setCount] = createSignal(0);
  const [items, setItems] = createSignal(["one", "two"]);
  return (
    <main>
      <h1>Count: {count()}</h1>
      <button onClick={() => setCount(count() + 1)}>Add one</button>
      <button onClick={() => setItems([...items(), `item ${items().length + 1}`])}>Add item</button>
      <Show when={count() > 2} fallback={<p>Small</p>}>
        <p>Big</p>
      </Show>
      <ul>
        <For each={items()}>{(item) => <li>{item}</li>}</For>
      </ul>
    </main>
  );
}

render(() => <App />, document.getElementById("app")!);
