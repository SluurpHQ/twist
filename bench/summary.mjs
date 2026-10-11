// A CPU profile (DevTools' format: Chromium's, or Bun's --cpu-prof) as text: self and total time per function, and
// who calls the hottest one.
export function summary(profile, title) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const label = (n) => `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber + 1}`;
  const self = new Map();
  const total = new Map();
  let count = 0;
  for (const id of profile.samples) {
    const l = label(byId.get(id));
    count++;
    self.set(l, (self.get(l) ?? 0) + 1);
    if (l.startsWith("(idle)") || l.startsWith("(program)") || l.startsWith("(garbage")) continue;
    const seen = new Set();
    for (let at = id; at != null; at = parent.get(at)) {
      const k = label(byId.get(at));
      if (seen.has(k)) continue;
      seen.add(k);
      total.set(k, (total.get(k) ?? 0) + 1);
    }
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, v]) => `${((100 * v) / count).toFixed(1).padStart(5)}%  ${l}`).join("\n");
  const hot = process.env.HOT ? [...self.keys()].find((l) => l.startsWith(process.env.HOT + ":")) : [...self].filter(([l]) => !l.startsWith("(")).sort((a, b) => b[1] - a[1])[0]?.[0];
  const callers = new Map();
  for (const id of profile.samples) {
    if (label(byId.get(id)) !== hot) continue;
    const path = [];
    for (let at = parent.get(id); at != null && path.length < 3; at = parent.get(at)) path.push(label(byId.get(at)));
    const k = path.join(" < ");
    callers.set(k, (callers.get(k) ?? 0) + 1);
  }
  // Its lines, by the samples taken in each (Chromium's positionTicks).
  const lines = new Map();
  for (const n of profile.nodes) if (label(n) === hot) for (const t of n.positionTicks ?? []) lines.set(`line ${t.line}`, (lines.get(`line ${t.line}`) ?? 0) + t.ticks);
  return `${title}: ${count} samples\n-- self\n${top(self, 30)}\n-- total\n${top(total, 25)}\n-- ${hot} called from\n${top(callers, 5)}\n-- ${hot} by line\n${top(lines, 8)}`;
}
