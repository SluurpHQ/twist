// `react-dom`.
import { createPortal } from "./element.ts";
import { findDOMNode, flushSync, useFormStatus, version } from "./core.ts";
import { clientDispatcher } from "./float-client.ts";
import { warn } from "./warnings.ts";
export { useFormStatus };
export { createPortal, flushSync, version };
// What React 19 keeps for its own tests and a few libraries: findDOMNode, and the dispatcher slots (the server's
// render swaps in its own D, C, L, m, X, S, M while it renders).
export const __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = { findDOMNode, d: { ...clientDispatcher } as typeof clientDispatcher, p: 0 };
const d = () => __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.d;
export const unstable_batchedUpdates = (fn: () => any) => fn();
export const useFormState = (action: any, initial: any) => [initial, action, false];
export const requestFormReset = (form: HTMLFormElement) => form.reset();
/** A value whose use() renders the rest of its Suspense boundary in the browser only (the server gives it up). */
export const browser = (reason?: unknown) => ({ $$typeof: Symbol.for("react.recoverable"), _reason: reason });

const describeObject = (x: any) => (x === null ? "`null`" : x === undefined ? "`undefined`" : x === "" ? "an empty string" : `something with type "${typeof x}"`);
const describeEnum = (x: any) =>
  x === null ? "`null`" : x === undefined ? "`undefined`" : x === "" ? "an empty string" : typeof x === "string" ? JSON.stringify(x) : typeof x === "number" ? "`" + x + "`" : `something with type "${typeof x}"`;
const crossOriginFor = (as: any, input: any) => (as === "font" ? "" : typeof input === "string" ? (input === "use-credentials" ? input : "") : undefined);
const str = (v: any) => (typeof v === "string" ? v : undefined);

export function prefetchDNS(href: string, ...rest: any[]) {
  if (typeof href !== "string" || !href) warn(`ReactDOM.prefetchDNS(): Expected the \`href\` argument (first) to be a non-empty string but encountered ${describeObject(href)} instead.`);
  else if (rest.length) {
    const o = rest[0];
    warn(
      typeof o === "object" && o?.hasOwnProperty("crossOrigin")
        ? `ReactDOM.prefetchDNS(): Expected only one argument, \`href\`, but encountered ${describeEnum(o)} as a second argument instead. This argument is reserved for future options and is currently disallowed. It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. Browsers do not perform DNS queries using CORS and setting this attribute on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just a single string argument, \`href\`.`
        : `ReactDOM.prefetchDNS(): Expected only one argument, \`href\`, but encountered ${describeEnum(o)} as a second argument instead. This argument is reserved for future options and is currently disallowed. Try calling ReactDOM.prefetchDNS() with just a single string argument, \`href\`.`,
    );
  }
  if (typeof href === "string") d().D(href);
}

export function preconnect(href: string, options?: any) {
  if (typeof href !== "string" || !href) warn(`ReactDOM.preconnect(): Expected the \`href\` argument (first) to be a non-empty string but encountered ${describeObject(href)} instead.`);
  else if (options != null && typeof options !== "object")
    warn(
      `ReactDOM.preconnect(): Expected the \`options\` argument (second) to be an object but encountered ${describeEnum(options)} instead. The only supported option at this time is \`crossOrigin\` which accepts a string.`,
    );
  else if (options != null && typeof options.crossOrigin !== "string")
    warn(
      `ReactDOM.preconnect(): Expected the \`crossOrigin\` option (second argument) to be a string but encountered ${describeObject(options.crossOrigin)} instead. Try removing this option or passing a string value instead.`,
    );
  if (typeof href !== "string") return;
  const co = options ? (typeof options.crossOrigin === "string" ? (options.crossOrigin === "use-credentials" ? options.crossOrigin : "") : undefined) : null;
  d().C(href, co);
}

export function preload(href: string, options: any) {
  let found = "";
  if (typeof href !== "string" || !href) found += ` The \`href\` argument encountered was ${describeObject(href)}.`;
  if (options == null || typeof options !== "object") found += ` The \`options\` argument encountered was ${describeObject(options)}.`;
  else if (typeof options.as !== "string" || !options.as) found += ` The \`as\` option encountered was ${describeObject(options.as)}.`;
  if (found) warn(`ReactDOM.preload(): Expected two arguments, a non-empty \`href\` string and an \`options\` object with an \`as\` property valid for a \`<link rel="preload" as="..." />\` tag.${found}`);
  if (typeof href === "string" && typeof options === "object" && options !== null && typeof options.as === "string") {
    const as = options.as;
    d().L(href, as, {
      crossOrigin: crossOriginFor(as, options.crossOrigin),
      integrity: str(options.integrity),
      nonce: str(options.nonce),
      type: str(options.type),
      fetchPriority: str(options.fetchPriority),
      referrerPolicy: str(options.referrerPolicy),
      imageSrcSet: str(options.imageSrcSet),
      imageSizes: str(options.imageSizes),
      media: str(options.media),
    });
  }
}

export function preloadModule(href: string, options?: any) {
  let found = "";
  if (typeof href !== "string" || !href) found += ` The \`href\` argument encountered was ${describeObject(href)}.`;
  if (options !== undefined && typeof options !== "object") found += ` The \`options\` argument encountered was ${describeObject(options)}.`;
  else if (options && "as" in options && typeof options.as !== "string") found += ` The \`as\` option encountered was ${describeObject(options.as)}.`;
  if (found)
    warn(`ReactDOM.preloadModule(): Expected two arguments, a non-empty \`href\` string and, optionally, an \`options\` object with an \`as\` property valid for a \`<link rel="modulepreload" as="..." />\` tag.${found}`);
  if (typeof href !== "string") return;
  if (options)
    d().m(href, {
      as: typeof options.as === "string" && options.as !== "script" ? options.as : undefined,
      crossOrigin: crossOriginFor(options.as, options.crossOrigin),
      integrity: str(options.integrity),
      nonce: str(options.nonce),
      fetchPriority: str(options.fetchPriority),
    });
  else d().m(href);
}

export function preinit(href: string, options: any) {
  if (typeof href !== "string" || !href) warn(`ReactDOM.preinit(): Expected the \`href\` argument (first) to be a non-empty string but encountered ${describeObject(href)} instead.`);
  else if (options == null || typeof options !== "object")
    warn(`ReactDOM.preinit(): Expected the \`options\` argument (second) to be an object with an \`as\` property describing the type of resource to be preinitialized but encountered ${describeEnum(options)} instead.`);
  else if (options.as !== "style" && options.as !== "script")
    warn(
      `ReactDOM.preinit(): Expected the \`as\` property in the \`options\` argument (second) to contain a valid value describing the type of resource to be preinitialized but encountered ${describeEnum(options.as)} instead. Valid values for \`as\` are "style" and "script".`,
    );
  if (typeof href !== "string" || !options || typeof options.as !== "string") return;
  const as = options.as;
  const crossOrigin = crossOriginFor(as, options.crossOrigin);
  const integrity = str(options.integrity);
  const fetchPriority = str(options.fetchPriority);
  if (as === "style") d().S(href, str(options.precedence), { crossOrigin, integrity, fetchPriority });
  else if (as === "script") d().X(href, { crossOrigin, integrity, fetchPriority, nonce: str(options.nonce) });
}

export function preinitModule(href: string, options?: any) {
  let found = "";
  if (typeof href !== "string" || !href) found += ` The \`href\` argument encountered was ${describeObject(href)}.`;
  if (options !== undefined && typeof options !== "object") found += ` The \`options\` argument encountered was ${describeObject(options)}.`;
  else if (options && "as" in options && options.as !== "script") found += ` The \`as\` option encountered was ${describeEnum(options.as)}.`;
  if (found) warn(`ReactDOM.preinitModule(): Expected up to two arguments, a non-empty \`href\` string and, optionally, an \`options\` object with a valid \`as\` property.${found}`);
  else {
    const as = options && typeof options.as === "string" ? options.as : "script";
    if (as !== "script")
      warn(
        `ReactDOM.preinitModule(): Currently the only supported "as" type for this function is "script" but received "${describeEnum(as)}" instead. This warning was generated for \`href\` "${href}". In the future other module types will be supported, aligning with the import-attributes proposal. Learn more here: (https://github.com/tc39/proposal-import-attributes)`,
      );
  }
  if (typeof href !== "string") return;
  if (typeof options === "object" && options !== null) {
    if (options.as == null || options.as === "script")
      d().M(href, { crossOrigin: crossOriginFor(options.as, options.crossOrigin), integrity: str(options.integrity), nonce: str(options.nonce), fetchPriority: str(options.fetchPriority) });
  } else if (options == null) d().M(href);
}

export default { browser, createPortal, flushSync, version, __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, unstable_batchedUpdates, useFormStatus, preload, preinit, preconnect, prefetchDNS, preloadModule, preinitModule, requestFormReset };
