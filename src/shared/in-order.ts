// Shared by the React runtime (core.ts) and Twist's web runtime: which items of a reordered list can stay where they
// are (the longest run still in its old order), so only the others move.

/**
 * Indices into `next` of the items that need not move: the longest increasing run of their old positions
 * (`oldAt(item)`, undefined for a new item), found in n log n.
 */
export function inOrder<T>(next: readonly T[], oldAt: (item: T) => number | undefined): Set<number> {
  const tails: number[] = [];
  const prev = new Int32Array(next.length);
  const pos = new Int32Array(next.length);
  for (let j = 0; j < next.length; j++) {
    const oi = oldAt(next[j]!);
    pos[j] = oi ?? -1;
    if (oi === undefined) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pos[tails[mid]!]! < oi) lo = mid + 1;
      else hi = mid;
    }
    prev[j] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = j;
  }
  const stay = new Set<number>();
  for (let j = tails.length ? tails[tails.length - 1]! : -1; j >= 0; j = prev[j]!) stay.add(j);
  return stay;
}
