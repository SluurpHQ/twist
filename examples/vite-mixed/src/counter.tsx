// A React-style component: React state and hooks, drawn by the Solid app (main.tsx).
import { useState } from "react";

export function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <>
      <h1>
        {label}: {count}
      </h1>
      <button onClick={() => setCount(count + 1)}>Add one</button>
      {count > 2 ? <p>Big</p> : <p>Small</p>}
    </>
  );
}
