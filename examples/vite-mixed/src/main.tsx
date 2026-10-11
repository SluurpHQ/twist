// A Solid app: its list is a signal. The counter and the badge in it are React-style components (counter.tsx, badge.tsx).
import { createSignal, For } from "solid-js";
import { render } from "@solidjs/web";
import { Counter } from "./counter.tsx";
import { Badge } from "./badge.tsx";

function App() {
  const [items, setItems] = createSignal(["one", "two"]);
  return (
    <main>
      <Counter label="Count" />
      <button onClick={() => setItems([...items(), `item ${items().length + 1}`])}>Add item</button>
      <ul>
        <For each={items()}>{(item) => <li>{item}</li>}</For>
      </ul>
      <Badge text={`${items().length} items`} />
    </main>
  );
}

render(() => <App />, document.getElementById("app")!);
