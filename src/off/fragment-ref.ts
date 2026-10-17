// Fragment refs left out (features: { fragmentRefs: false }, or "nano"): a ref on a Fragment is an error that says so.
// Stands in for ../fragment-ref.ts, with its exports.
export type FNode = { kind: number; type: any; props: any; dom: any; children: FNode[]; parent: FNode | null; dead?: boolean };

export class FragmentInstance {
  constructor(_f: FNode) {
    throw new Error("A ref on a Fragment needs Fragment refs, left out of this build (Twist's features: { fragmentRefs: false }).");
  }
  _attachHandles() {}
  _childAdded(_node: Node) {}
  _childRemoved(_node: Node) {}
}

export const fragmentsAbove = (_f: FNode): FragmentInstance[] => [];
