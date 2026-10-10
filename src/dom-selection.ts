// A selection inside an element as character offsets, and back (React's ReactDOMSelection): kept across a commit that
// moves the nodes under a focused contentEditable.

const TEXT = 3;

/** The selection inside `outer` as offsets into its text, or null when there is none there. */
export function getOffsets(outer: Node): { start: number; end: number } | null {
  const win: any = outer.ownerDocument?.defaultView ?? (typeof window !== "undefined" ? window : null);
  const selection = win?.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  // (Firefox's anonymous divs throw on any property read.)
  try {
    void anchorNode.nodeType;
    void focusNode.nodeType;
  } catch {
    return null;
  }
  return getModernOffsetsFromPoints(outer, anchorNode, anchorOffset, focusNode, focusOffset);
}

/** The offsets into `outer`'s text of two selection points (anchor and focus), walking its nodes in order. */
export function getModernOffsetsFromPoints(outer: Node, anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): { start: number; end: number } | null {
  let length = 0;
  let start = -1;
  let end = -1;
  let inAnchor = 0;
  let inFocus = 0;
  let node: Node = outer;
  let parent: Node | null = null;
  outer: while (true) {
    let next: Node | null = null;
    while (true) {
      if (node === anchorNode && (anchorOffset === 0 || node.nodeType === TEXT)) start = length + anchorOffset;
      if (node === focusNode && (focusOffset === 0 || node.nodeType === TEXT)) end = length + focusOffset;
      if (node.nodeType === TEXT) length += (node.nodeValue ?? "").length;
      if ((next = node.firstChild) === null) break;
      parent = node;
      node = next;
    }
    while (true) {
      // (Back at the start: done. Without children, it was the only node, handled above.)
      if (node === outer) break outer;
      if (parent === anchorNode && ++inAnchor === anchorOffset) start = length;
      if (parent === focusNode && ++inFocus === focusOffset) end = length;
      if ((next = node.nextSibling) !== null) break;
      node = parent!;
      parent = node.parentNode;
    }
    node = next;
  }
  // (Points outside `outer`.)
  if (start === -1 || end === -1) return null;
  return { start, end };
}

/** The selection put back at offsets into `node`'s text (backwards when start is after end). */
export function setOffsets(node: Node, offsets: { start: number; end?: number }) {
  const doc: any = node.ownerDocument ?? document;
  const win = doc?.defaultView ?? window;
  if (!win.getSelection) return;
  const selection = win.getSelection();
  const length = (node.textContent ?? "").length;
  let start = Math.min(offsets.start, length);
  let end = offsets.end === undefined ? start : Math.min(offsets.end, length);
  // (Without extend, a backward selection is set forwards.)
  if (!selection.extend && start > end) [start, end] = [end, start];
  const startAt = nodeAtOffset(node, start);
  const endAt = nodeAtOffset(node, end);
  if (!startAt || !endAt) return;
  if (selection.rangeCount === 1 && selection.anchorNode === startAt.node && selection.anchorOffset === startAt.offset && selection.focusNode === endAt.node && selection.focusOffset === endAt.offset) return;
  const range = doc.createRange();
  range.setStart(startAt.node, startAt.offset);
  selection.removeAllRanges();
  if (start > end) {
    selection.addRange(range);
    selection.extend(endAt.node, endAt.offset);
  } else {
    range.setEnd(endAt.node, endAt.offset);
    selection.addRange(range);
  }
}

const leaf = (n: Node | null | undefined) => {
  while (n?.firstChild) n = n.firstChild;
  return n ?? null;
};
const nextSiblingUp = (n: Node | null) => {
  for (; n; n = n.parentNode) if (n.nextSibling) return n.nextSibling;
  return null;
};
/** The text node holding character `offset` of `root`'s text, and the offset in it. */
function nodeAtOffset(root: Node, offset: number): { node: Node; offset: number } | null {
  let node = leaf(root);
  let nodeStart = 0;
  while (node) {
    if (node.nodeType === TEXT) {
      const nodeEnd = nodeStart + (node.textContent ?? "").length;
      if (nodeStart <= offset && nodeEnd >= offset) return { node, offset: offset - nodeStart };
      nodeStart = nodeEnd;
    }
    node = leaf(nextSiblingUp(node));
  }
  return null;
}
