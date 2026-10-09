// React's tree ids: a node's position as a bit-packed path (each array of children a fork), which the server and
// the hydrating client both work out, so useId gives them the same id.

export type TreeContext = { id: number; overflow: string };
export const ROOT_TREE: TreeContext = { id: 1, overflow: "" };

/** The context of child `index` of `total` (React's pushTreeContext). */
export function pushTree(base: TreeContext, total: number, index: number): TreeContext {
  let baseId = base.id;
  const baseOverflow = base.overflow;
  let baseLength = 32 - Math.clz32(baseId) - 1;
  baseId &= ~(1 << baseLength);
  const slot = index + 1;
  const length = 32 - Math.clz32(total) + baseLength;
  if (length > 30) {
    const overflowBits = baseLength - (baseLength % 5);
    const overflow = (baseId & ((1 << overflowBits) - 1)).toString(32);
    baseId >>= overflowBits;
    baseLength -= overflowBits;
    return { id: (1 << (32 - Math.clz32(total) + baseLength)) | (slot << baseLength) | baseId, overflow: overflow + baseOverflow };
  }
  return { id: (1 << length) | (slot << baseLength) | baseId, overflow: baseOverflow };
}

/** The tree id as text (React's getTreeId). */
export const treeId = (t: TreeContext) => (t.id & ~(1 << (32 - Math.clz32(t.id) - 1))).toString(32) + t.overflow;

/** An id as React writes it: `_<prefix>R_<tree>[H<n>]_` (server and hydration) or `_<prefix>r_<n>_` (client). */
export function makeId(prefix: string, kind: "R" | "r", tree: TreeContext | number, local: number) {
  if (kind === "r") return `_${prefix}r_${(tree as number).toString(32)}_`;
  return `_${prefix}R_${treeId(tree as TreeContext)}${local > 0 ? "H" + local.toString(32) : ""}_`;
}
