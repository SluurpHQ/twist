// View transitions left out (features: { viewTransitions: false }, or "nano"): <ViewTransition> draws its children
// and nothing animates, as in a browser without them. Stands in for ../view-transition.ts, with its exports.
export type VTFiber = { props: any; dead?: boolean; parent: VTFiber | null; type: any };

export const configureViewTransitions = (_test: (f: VTFiber) => boolean, _elements: (f: VTFiber) => Element[]) => {};
export const viewTransitionsBegin = () => {};
export const viewTransitionUnmounted = (_f: VTFiber) => {};
export const viewTransitionsCommit = (_made: VTFiber[], _transition: boolean) => {};
export const renderInViewTransition = (_render: () => void): boolean => false;
export const resetViewTransitions = () => {};
