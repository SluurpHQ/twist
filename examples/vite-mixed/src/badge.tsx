// React-style too: its text comes from the Solid app's signal, and it is drawn again when that changes.
import { useMemo } from "react";

export function Badge({ text }: { text: string }) {
  const shown = useMemo(() => text.toUpperCase(), [text]);
  return <p>{shown}</p>;
}
