// `react-dom`.
import { createPortal } from "./element.ts";
import { findDOMNode, flushSync, version } from "./core.ts";
export { createPortal, flushSync, version };
// What React 19 keeps for its own tests and a few libraries: findDOMNode, and the dispatcher slots.
export const __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = { findDOMNode, d: {}, p: 0 };
export const unstable_batchedUpdates = (fn: () => any) => fn();
export const useFormStatus = () => ({ pending: false, data: null, method: null, action: null });
export const useFormState = (action: any, initial: any) => [initial, action, false];
export const preload = () => {}, preinit = () => {}, preconnect = () => {}, prefetchDNS = () => {}, preloadModule = () => {}, preinitModule = () => {};
export const requestFormReset = (form: HTMLFormElement) => form.reset();
export default { createPortal, flushSync, version, __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, unstable_batchedUpdates, useFormStatus, preload, preinit, preconnect, prefetchDNS, preloadModule, preinitModule, requestFormReset };
