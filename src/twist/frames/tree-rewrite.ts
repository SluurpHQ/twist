// Ported from Solid's frames/src/tree-rewrite.ts (MIT, Ryan Carniato and contributors): same behaviour, Twist's modules.
/** Copy-on-write rewrite of a value tree, for the serialization-border walks */
export const DESCEND: unique symbol = Symbol("descend");

const CYCLE = {};

/** The depth from which the first pass tracks its ancestors. */
const TRACK = 16;

type Visit = (value: object, path: string | undefined) => any;

type State = { memo: Map<any, any> | undefined; ancestors: Set<any> | undefined };

export function rewriteTree(value: any, visit: Visit, withPath: boolean): any {
  if (value === null || typeof value !== "object") return value;
  const path = withPath ? "" : undefined;
  const state: State = { memo: undefined, ancestors: undefined };
  try {
    return cow(value, visit, path, 0, state);
  } catch (err) {
    if (err !== CYCLE) throw err;
  }
  return clone(value, visit, path, state.memo || (state.memo = new Map()));
}

function shape(value: any): 1 | 2 | 0 {
  return Array.isArray(value) ? 1 : Object.getPrototypeOf(value) === Object.prototype ? 2 : 0;
}

// `value` is an object (the callers test).
function cow(value: any, visit: Visit, path: string | undefined, depth: number, state: State) {
  const memo = state.memo;
  if (memo !== undefined && memo.has(value)) return memo.get(value);
  const r = visit(value, path);
  if (r !== DESCEND) {
    if (r !== value) (memo || (state.memo = new Map())).set(value, r);
    return r;
  }
  const s = shape(value);
  if (s === 0) return value;
  // Deep enough to suspect a cycle: this container joins the ancestors for
  let ancestors;
  if (depth >= TRACK) {
    ancestors = state.ancestors || (state.ancestors = new Set());
    if (ancestors.has(value)) throw CYCLE;
    ancestors.add(value);
  }
  let out = value;
  if (s === 1) {
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === null || typeof c !== "object") continue;
      const next = cow(
        c,
        visit,
        path === undefined ? undefined : `${path}[${i}]`,
        depth + 1,
        state
      );
      if (next !== c) {
        if (out === value) out = value.slice();
        out[i] = next;
      }
    }
  } else {
    for (const k of Object.keys(value)) {
      const c = value[k];
      if (c === null || typeof c !== "object") continue;
      const next = cow(c, visit, path === undefined ? undefined : `${path}.${k}`, depth + 1, state);
      if (next !== c) {
        if (out === value) out = { ...value };
        out[k] = next;
      }
    }
  }
  if (ancestors !== undefined) ancestors.delete(value);
  return out;
}

// `value` is an object (the callers test).
function clone(value: any, visit: Visit, path: string | undefined, memo: Map<any, any>) {
  if (memo.has(value)) return memo.get(value);
  const r = visit(value, path);
  if (r !== DESCEND) {
    memo.set(value, r);
    return r;
  }
  const s = shape(value);
  if (s === 0) return value;
  const out = s === 1 ? value.slice() : { ...value };
  memo.set(value, out);
  if (s === 1) {
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c !== null && typeof c === "object")
        out[i] = clone(c, visit, path === undefined ? undefined : `${path}[${i}]`, memo);
    }
  } else {
    for (const k of Object.keys(value)) {
      const c = value[k];
      if (c !== null && typeof c === "object")
        out[k] = clone(c, visit, path === undefined ? undefined : `${path}.${k}`, memo);
    }
  }
  return out;
}
