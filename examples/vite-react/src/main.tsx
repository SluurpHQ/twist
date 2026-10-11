import { useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState(["one", "two"]);
  return (
    <main>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>Add one</button>
      <button onClick={() => setItems([...items, `item ${items.length + 1}`])}>Add item</button>
      {count > 2 ? <p>Big</p> : <p>Small</p>}
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
