// React's development checks on class components, in React's words: mistakes in how a class is written (found when
// it mounts), lifecycle return values, and the deprecated will-lifecycles (told once per commit, names gathered).
declare const process: { env: Record<string, string | undefined> };
import { dev, warn } from "./warnings.ts";

const nameOf = (C: any) => C?.displayName || C?.name || "Component";
const seenTypes = (key: string) => {
  const s = new WeakSet<object>();
  return (C: object) => (s.has(C) ? false : (s.add(C), true));
};
const firstUninitialized = seenTypes("uninit");
const firstLegacyWithNew = seenTypes("legacyNew");
const firstSnapshotOnly = seenTypes("snapshotOnly");
const firstPropsAsState = seenTypes("propsState");
const firstUndefinedDerived = seenTypes("undefinedDerived");
const firstUnsafe = seenTypes("unsafe");

/** Right after the instance is made (React's constructClassInstance and checkClassInstance). */
export function checkClassInstance(C: any, inst: any, props: any, side = "") {
  if (!(process.env.NODE_ENV !== "production" && dev())) return;
  const name = nameOf(C);
  if (typeof C.getDerivedStateFromProps === "function" && (inst.state === null || inst.state === undefined) && firstUninitialized(C))
    warn(
      `\`${name}\` uses \`getDerivedStateFromProps\` but its initial state is ${inst.state === null ? "null" : "undefined"}. This is not recommended. Instead, define the initial state by assigning an object to \`this.state\` in the constructor of \`${name}\`. This ensures that \`getDerivedStateFromProps\` arguments have a consistent shape.`,
    );
  if (typeof C.getDerivedStateFromProps === "function" || typeof inst.getSnapshotBeforeUpdate === "function") {
    const willMount = typeof inst.componentWillMount === "function" && inst.componentWillMount.__suppressDeprecationWarning !== true ? "componentWillMount" : typeof inst.UNSAFE_componentWillMount === "function" ? "UNSAFE_componentWillMount" : null;
    const willReceive =
      typeof inst.componentWillReceiveProps === "function" && inst.componentWillReceiveProps.__suppressDeprecationWarning !== true
        ? "componentWillReceiveProps"
        : typeof inst.UNSAFE_componentWillReceiveProps === "function"
          ? "UNSAFE_componentWillReceiveProps"
          : null;
    const willUpdate = typeof inst.componentWillUpdate === "function" && inst.componentWillUpdate.__suppressDeprecationWarning !== true ? "componentWillUpdate" : typeof inst.UNSAFE_componentWillUpdate === "function" ? "UNSAFE_componentWillUpdate" : null;
    if ((willMount || willReceive || willUpdate) && firstLegacyWithNew(C))
      warn(
        `Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n${name} uses ${typeof C.getDerivedStateFromProps === "function" ? "getDerivedStateFromProps()" : "getSnapshotBeforeUpdate()"} but also contains the following legacy lifecycles:${willMount ? "\n  " + willMount : ""}${willReceive ? "\n  " + willReceive : ""}${willUpdate ? "\n  " + willUpdate : ""}\n\nThe above lifecycles should be removed. Learn more about this warning here:\nhttps://react.dev/link/unsafe-component-lifecycles`,
      );
  }
  if (!inst.render)
    warn(
      C.prototype && typeof C.prototype.render === "function"
        ? `No \`render\` method found on the ${name} instance: did you accidentally return an object from the constructor?`
        : `No \`render\` method found on the ${name} instance: you may have forgotten to define \`render\`.`,
    );
  if (inst.getInitialState && !inst.getInitialState.isReactClassApproved && !inst.state)
    warn(`getInitialState was defined on ${name}, a plain JavaScript class. This is only supported for classes created using React.createClass. Did you mean to define a state property instead?`);
  if (inst.getDefaultProps && !inst.getDefaultProps.isReactClassApproved)
    warn(`getDefaultProps was defined on ${name}, a plain JavaScript class. This is only supported for classes created using React.createClass. Use a static property to define defaultProps instead.`);
  if (inst.contextType) warn(`contextType was defined as an instance property on ${name}. Use a static property to define contextType instead.`);
  // Legacy context is gone (React 19): said once per class.
  if (C.childContextTypes)
    warn(`${name} uses the legacy childContextTypes API which was removed in React 19. Use React.createContext() instead. (https://react.dev/link/legacy-context)`, side + "legacy-child-context:" + name);
  if (C.contextTypes)
    warn(`${name} uses the legacy contextTypes API which was removed in React 19. Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)`, side + "legacy-context:" + name);
  if (typeof inst.componentShouldUpdate === "function")
    warn(`${name} has a method called componentShouldUpdate(). Did you mean shouldComponentUpdate()? The name is phrased as a question because the function is expected to return a value.`);
  if (C.prototype?.isPureReactComponent && typeof inst.shouldComponentUpdate !== "undefined")
    warn(`${nameOf(C) || "A pure component"} has a method called shouldComponentUpdate(). shouldComponentUpdate should not be used when extending React.PureComponent. Please extend React.Component if shouldComponentUpdate is used.`);
  if (typeof inst.componentDidUnmount === "function") warn(`${name} has a method called componentDidUnmount(). But there is no such lifecycle method. Did you mean componentWillUnmount()?`);
  if (typeof inst.componentDidReceiveProps === "function")
    warn(
      `${name} has a method called componentDidReceiveProps(). But there is no such lifecycle method. If you meant to update the state in response to changing props, use componentWillReceiveProps(). If you meant to fetch data or run side-effects or mutations after React has updated the UI, use componentDidUpdate().`,
    );
  if (typeof inst.componentWillRecieveProps === "function") warn(`${name} has a method called componentWillRecieveProps(). Did you mean componentWillReceiveProps()?`);
  if (typeof inst.UNSAFE_componentWillRecieveProps === "function") warn(`${name} has a method called UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?`);
  if (inst.props !== undefined && inst.props !== props) warn(`When calling super() in \`${name}\`, make sure to pass up the same props that your component's constructor was passed.`);
  if (inst.defaultProps) warn(`Setting defaultProps as an instance property on ${name} is not supported and will be ignored. Instead, define defaultProps as a static property on ${name}.`);
  if (typeof inst.getSnapshotBeforeUpdate === "function" && typeof inst.componentDidUpdate !== "function" && firstSnapshotOnly(C))
    warn(`${name}: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). This component defines getSnapshotBeforeUpdate() only.`);
  if (typeof inst.getDerivedStateFromProps === "function") warn(`${name}: getDerivedStateFromProps() is defined as an instance method and will be ignored. Instead, declare it as a static method.`);
  if (typeof inst.getDerivedStateFromError === "function") warn(`${name}: getDerivedStateFromError() is defined as an instance method and will be ignored. Instead, declare it as a static method.`);
  if (typeof C.getSnapshotBeforeUpdate === "function") warn(`${name}: getSnapshotBeforeUpdate() is defined as a static method and will be ignored. Instead, declare it as an instance method.`);
  const s = inst.state;
  if (s && (typeof s !== "object" || Array.isArray(s))) warn(`${name}.state: must be set to an object or null`);
  if (inst.state === props && props !== undefined && firstPropsAsState(C))
    warn(`${name}: It is not recommended to assign props directly to state because updates to props won't be reflected in state. In most cases, it is better to use props directly.`);
}

export function checkDerivedState(C: any, partial: any) {
  if ((process.env.NODE_ENV !== "production" && dev()) && partial === undefined && firstUndefinedDerived(C)) warn(`${nameOf(C)}.getDerivedStateFromProps(): A valid state object (or null) must be returned. You have returned undefined.`);
}
export function checkShouldUpdate(C: any, result: any) {
  if ((process.env.NODE_ENV !== "production" && dev()) && result === undefined) warn(`${nameOf(C)}.shouldComponentUpdate(): Returned undefined instead of a boolean value. Make sure to return true or false.`);
}
export function checkSnapshot(C: any, snapshot: any) {
  if ((process.env.NODE_ENV !== "production" && dev()) && snapshot === undefined) warn(`${nameOf(C)}.getSnapshotBeforeUpdate(): A snapshot value (or null) must be returned. You have returned undefined.`);
}

// ---------------------------------------------------------------- deprecated will-lifecycles, told per commit

type Kind = "componentWillMount" | "componentWillReceiveProps" | "componentWillUpdate";
const pending: Record<string, Set<string>> = {};
const add = (k: string, name: string) => (pending[k] ??= new Set()).add(name);

/** A class instance mounting: which of its will-lifecycles to warn about (unprefixed always, UNSAFE_ in StrictMode). */
export function recordUnsafeLifecycles(C: any, inst: any, strict: boolean) {
  if (!(process.env.NODE_ENV !== "production" && dev()) || !firstUnsafe(C)) return;
  const name = nameOf(C);
  for (const k of ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"] as Kind[]) {
    if (typeof inst[k] === "function" && inst[k].__suppressDeprecationWarning !== true) add(k, name);
    if (strict && typeof inst["UNSAFE_" + k] === "function") add("UNSAFE_" + k, name);
  }
}

const WHY: Record<string, string> = {
  componentWillMount: "* Move code with side effects to componentDidMount, and set initial state in the constructor.",
  componentWillReceiveProps:
    "* Move data fetching code or side effects to componentDidUpdate.\n* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state",
  componentWillUpdate: "* Move data fetching code or side effects to componentDidUpdate.",
};
const RENAME = (k: string) =>
  `* Rename ${k} to UNSAFE_${k} to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.`;

/** At commit: the gathered will-lifecycle warnings, strict ones (errors) first, then the renamed ones (warnings). */
export function flushUnsafeLifecycleWarnings() {
  const names = (k: string) => {
    const s = pending[k];
    if (!s?.size) return null;
    const out = [...s].sort().join(", ");
    s.clear();
    return out;
  };
  for (const k of ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"]) {
    const list = names("UNSAFE_" + k);
    if (list)
      console.error(
        `Using UNSAFE_${k} in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.\n\n${WHY[k]}\n\nPlease update the following components: ${list}`,
      );
  }
  for (const k of ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"]) {
    const list = names(k);
    if (list) console.warn(`${k} has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.\n\n${WHY[k]}\n${RENAME(k)}\n\nPlease update the following components: ${list}`);
  }
}
