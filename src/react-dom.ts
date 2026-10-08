// `react-dom`.
import { createPortal } from "./element.ts";
import { flushSync, version } from "./core.ts";
export { createPortal, flushSync, version };
export const unstable_batchedUpdates = (fn: () => any) => fn();
export const useFormStatus = () => ({ pending: false, data: null, method: null, action: null });
export const useFormState = (action: any, initial: any) => [initial, action, false];
export const preload = () => {}, preinit = () => {}, preconnect = () => {}, prefetchDNS = () => {}, preloadModule = () => {}, preinitModule = () => {};
export const requestFormReset = (form: HTMLFormElement) => form.reset();
export default { createPortal, flushSync, version, unstable_batchedUpdates, useFormStatus, preload, preinit, preconnect, prefetchDNS, preloadModule, preinitModule, requestFormReset };
