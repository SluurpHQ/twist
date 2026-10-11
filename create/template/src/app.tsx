import { createMemo, createSignal, For, Loading } from "solid-js";

async function quote(n: number) {
  await new Promise((r) => setTimeout(r, 300));
  return `Quote number ${n}`;
}

export function App() {
  const [count, setCount] = createSignal(0);
  const [todos, setTodos] = createSignal(["Read the docs", "Build something"]);
  const [text, setText] = createSignal("");
  const said = createMemo(() => quote(count()));

  const add = (e: SubmitEvent) => {
    e.preventDefault();
    if (!text().trim()) return;
    setTodos([...todos(), text().trim()]);
    setText("");
  };

  return (
    <main>
      <h1>Twist</h1>
      <p>
        <button class="counter" onClick={() => setCount(count() + 1)}>
          Clicked {count()} times
        </button>
      </p>
      <Loading fallback={<p class="quote">Loading…</p>}>
        <p class="quote">{said()}</p>
      </Loading>
      <form onSubmit={add}>
        <input value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder="Something to do" />
        <button type="submit">Add</button>
      </form>
      <ul>
        <For each={todos()}>{(todo) => <li>{todo}</li>}</For>
      </ul>
    </main>
  );
}
