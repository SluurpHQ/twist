// Solid-style: a signal, Show, and a React component (badge.tsx) inside it.
import { createSignal, Show } from "solid-js";
import { Badge } from "./badge.tsx";

export function Counter(props: { label: string }) {
  const [count, setCount] = createSignal(0);
  return (
    <>
      <h1>
        {props.label}: {count()}
      </h1>
      <button onClick={() => setCount(count() + 1)}>Add one</button>
      <Show when={count() > 2} fallback={<p>Small</p>}>
        <Badge text="Big" />
      </Show>
    </>
  );
}
