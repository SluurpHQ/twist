// What React's tests use of its mock scheduler: a log they write to and check. Our runtime has no scheduler of its
// own (updates run on microtasks), so the flushing calls only drain what is pending.
let log: unknown[] = [];
/** A fresh log for each test, as React's tests get from loading the scheduler again (called by setup.ts). */
export function resetLog() {
  log = [];
}

export const unstable_now = () => performance.now();
export function logValue(v: unknown) {
  log.push(v);
}
export { logValue as log };
export function unstable_clearLog() {
  const out = log;
  log = [];
  return out;
}
export const unstable_flushAll = () => {};
export const unstable_flushAllWithoutAsserting = () => false;
export const unstable_flushNumberOfYields = () => {};
export const unstable_flushUntilNextPaint = () => false;
export const unstable_advanceTime = () => {};
export const unstable_hasPendingWork = () => false;
export const unstable_scheduleCallback = (_p: number, cb: () => void) => queueMicrotask(cb);
export const unstable_cancelCallback = () => {};
export const unstable_shouldYield = () => false;
export const unstable_requestPaint = () => {};
export const unstable_getCurrentPriorityLevel = () => 3;
export const unstable_runWithPriority = (_p: number, fn: () => any) => fn();
export const unstable_ImmediatePriority = 1, unstable_UserBlockingPriority = 2, unstable_NormalPriority = 3, unstable_LowPriority = 4, unstable_IdlePriority = 5;
export const unstable_setDisableYieldValue = () => {};
