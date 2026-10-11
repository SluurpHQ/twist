// The page is React's: its list is React state; the counter inside it is Solid-style (counter.tsx).
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Counter } from "./counter.tsx";

function App() {
  const [items, setItems] = useState(["one", "two"]);
  return (
    <main>
      <Counter label="Count" />
      <button onClick={() => setItems([...items, `item ${items.length + 1}`])}>Add item</button>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
