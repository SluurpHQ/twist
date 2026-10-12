// Twist's reactive kernel: the graph both of its APIs build on — what each node is read by, and what each computation
// read at which version. Plain JavaScript (signals.js is served as it is); no state of its own.

/** Read by nothing yet: shared by every node until its first reader (most nodes never get one). */
export const NO_READERS = Object.freeze([]);
/** Has read nothing yet: shared by every computation until its first read. */
export const NOTHING_YET = Object.freeze([]);

/** `o` reads `n` from now on. A short list while few read it, a set once many do. */
export function addReader(n, o) {
  const r = n.observers;
  if (r === NO_READERS) return void (n.observers = [o]);
  if (!Array.isArray(r)) return void r.add(o);
  if (r.includes(o)) return;
  if (r.length < 8) r.push(o);
  else (n.observers = new Set(r)).add(o);
}

/** `o` reads `n` no more. */
export function dropReader(n, o) {
  const r = n.observers;
  if (!Array.isArray(r)) return void r.delete(o);
  const i = r.indexOf(o);
  if (i < 0) return;
  if (r.length === 1) n.observers = NO_READERS;
  else r.splice(i, 1);
}

/** How many read `n`. */
export const readersOf = (n) => (Array.isArray(n.observers) ? n.observers.length : n.observers.size);

/**
 * `source` read by computation `c`: noted with the version it has, once (answers whether it is new to this run).
 * Its lists made by the first read, a source long: most have one, and a list pushed to grows to 17 places.
 */
export function noteRead(c, source) {
  const sources = c.sources;
  if (sources === NOTHING_YET) {
    c.sources = [source];
    c.seen = [source.version];
    return true;
  }
  if (sources.includes(source)) return false;
  // (A second one: a list of two, not one grown to 17.)
  if (sources.length === 1) (c.sources = [sources[0], source]), (c.seen = [c.seen[0], source.version]);
  else sources.push(source), c.seen.push(source.version);
  return true;
}
