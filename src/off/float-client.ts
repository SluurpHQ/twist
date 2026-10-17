// Float left out (features: { float: false }, or "nano"): <title>, <meta>, <link>, <style> and <script> render where
// they are written, nothing is a shared resource, no commit waits for a stylesheet, and ReactDOM.preload and its kin
// do nothing. Stands in for ../float-client.ts, with its exports.
export type Resource = { type: "stylesheet" | "style" | "script" | "void"; instance: Element | null; count: number; state: { loading: number; preload: Element | null } | null };

export const HOISTABLE = Symbol("hoistable");
export const STYLESHEET_WAIT = Symbol("stylesheetWait");
export const markHoistable = (el: Element) => ((el as any)[HOISTABLE] = true);

const nothing = () => {};
export const clientDispatcher = { D: nothing, C: nothing, L: nothing, m: nothing, X: nothing, M: nothing, S: nothing };

export function hoistableRoot(container: Node): Document | ShadowRoot {
  const r = typeof (container as any).getRootNode === "function" ? (container as any).getRootNode() : null;
  if (r && (r.nodeType === 9 || (r.nodeType === 11 && (r as ShadowRoot).host))) return r;
  return container.nodeType === 9 ? (container as Document) : container.ownerDocument!;
}

export type CommitWait = { count: number; stylesheets: Map<Resource, Document | ShadowRoot> | null; unsuspend: (() => void) | null };
export const newCommitWait = (): CommitWait => ({ count: 0, stylesheets: null, unsuspend: null });
export const suspendResource = (_state: CommitWait, _root: Document | ShadowRoot, _r: Resource, _props: any) => {};
export const sheetsLoading = (_root: Document | ShadowRoot, _sheets: [Resource | null | undefined, string][]): Promise<unknown> | null => null;
export const commitWhenReady = (_state: CommitWait, _noTimeout = false): ((commit: () => void) => () => void) | null => null;

export const stylesheetsInUse = false;
export type StylesheetWait = { then(on: () => void): void; cancel(): void };
export const stylesheetPending = (_root: Document | ShadowRoot, _props: any): StylesheetWait | null => null;

export const getResource = (_root: Document | ShadowRoot, _type: string, _props: any): Resource | null => null;
export const acquireResource = (_root: Document | ShadowRoot, _r: Resource, _props: any): Element | null => null;
export const releaseResource = (_r: Resource) => {};
export const claimHoistable = (_d: Document, _type: string, _props: any): Element | null => null;
export const mountHoistable = (_root: Document | ShadowRoot, _type: string, _el: Element) => {};

let said = false;
/** Nothing is hoisted: said once while developing, for a <title> or a <meta> that would have gone to the <head>. */
export function isHoistable(type: string, _props: any, svg: boolean, _inContainer: boolean, warn: (m: string) => void): boolean {
  if (process.env.NODE_ENV !== "production" && !said && !svg && (type === "title" || type === "meta")) {
    said = true;
    warn(`<${type}> stays where it is written: Float is left out of this build (Twist's features: { float: false }).`);
  }
  return false;
}
