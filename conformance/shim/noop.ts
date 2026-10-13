// React's react-noop-renderer, as its tests use it: roots that render into a container of their own, read back as
// JSX (each element's props as given, its children as elements and strings).
import { createElement, Fragment } from "../../src/element.ts";
import { createRoot as domRoot } from "../../src/core.ts";
import { flushSync as domFlushSync } from "../../src/core.ts";

// A noop instance is { type, props, children }: an element read as one answers `type` with its tag (unless it has a
// `type` of its own, as an input does).
if (!("type" in Element.prototype))
  Object.defineProperty(Element.prototype, "type", { configurable: true, get(this: Element) { return this.localName; } });

// The noop host config's own failure: an `errorInCompletePhase` instance throws as it is made (React Native's nesting
// checks, in its tests).
{
  // (On the class that has it: a test DOM's document may define its own.)
  let proto: any = Object.getPrototypeOf(document);
  while (proto && !Object.hasOwn(proto, "createElement")) proto = Object.getPrototypeOf(proto);
  const make = proto.createElement;
  proto.createElement = function (this: Document, tag: string, options?: any) {
    if (tag === "errorInCompletePhase") throw new Error("Error in host config.");
    return make.call(this, tag, options);
  } as any;
}

function toJSX(node: Node): any {
  if (node.nodeType === 3) return (node as Text).data;
  const el = node as any;
  const { children: _c, ...props } = el.__props ?? {};
  const kids = [...el.childNodes].map(toJSX);
  return kids.length === 0 ? createElement(el.localName, props) : createElement(el.localName, props, ...kids);
}

function childrenAsJSX(container: Element) {
  const kids = [...container.childNodes].map(toJSX);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  return createElement(Fragment, null, ...kids);
}

export function createRoot() {
  const container = document.createElement("div");
  const root = domRoot(container);
  return {
    render: (el: any) => root.render(el),
    unmount: () => root.unmount(),
    getChildrenAsJSX: () => childrenAsJSX(container),
    getChildren: () => [...container.childNodes],
    container,
  };
}
export const createLegacyRoot = createRoot;

// A fresh one for each test, as React's suite reloads the renderer before each (jest.resetModules).
let main: ReturnType<typeof createRoot> | null = null;
let mainTest = -1;
const mainRoot = () => {
  const serial = (globalThis as any).__testSerial ?? 0;
  if (!main || mainTest !== serial) (main = createRoot()), (mainTest = serial);
  return main;
};
export const render = (el: any) => mainRoot().render(el);
export const getChildrenAsJSX = () => mainRoot().getChildrenAsJSX();
export const getChildren = () => mainRoot().getChildren();
export const flushSync = (fn?: () => any) => domFlushSync(fn as any);
export const batchedUpdates = (fn: (a?: any) => any, a?: any) => fn(a);
export const unstable_batchedUpdates = batchedUpdates;
export const act = undefined;
export default { createRoot, createLegacyRoot, render, getChildrenAsJSX, getChildren, flushSync, batchedUpdates, unstable_batchedUpdates };
