// A React component, with React state, drawn inside the Solid-style counter.
import { useState } from "react";

export function Badge({ text }: { text: string }) {
  const [seen] = useState(() => "seen");
  return (
    <p>
      {text} ({seen})
    </p>
  );
}
