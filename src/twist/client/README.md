# Twist's Solid API in the browser

Ported from solid-js (2.0.0-rc.14, https://github.com/solidjs/solid, packages/solid/src: `index.ts`, `internal.ts`,
`types.ts`, `console-footer.ts`, `recovery.ts`, `client/*`, `refresh/index.ts`), MIT, Copyright (c) 2016-2025 Ryan
Carniato — see LICENSE. It runs on `../core`, Twist's port of `@solidjs/signals`.

Changes: the build constants (`IS_DEV`, `IS_OBSERVE`) read `NODE_ENV` where used; Twist's additions are marked
"(Twist …)": components marked for the React bridge, the hydration hooks Twist's web runtime claims with, and
`control.ts` (the marks Twist's JSX pass leaves, the bridge's component calls).
