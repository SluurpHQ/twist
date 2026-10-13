# Twist's Solid API on a server

Ported from solid-js (2.0.0-rc.14, https://github.com/solidjs/solid, packages/solid/src/server: `index.ts`,
`signals.ts`, `flow.ts`, `hydration.ts`, `component.ts`, `core.ts`, `shared.ts`, `observe.ts`, `diagnostics.ts`), MIT,
Copyright (c) 2016-2025 Ryan Carniato — see LICENSE. Like Solid's, it is its own pull-based layer (a lean owner tree, memos
computed once, async through the render context) over `../core`'s errors and utilities.

Changes: the build constants (`IS_DEV`, `IS_OBSERVE`) read `NODE_ENV`; Twist's additions are marked "(Twist …)". Twist's
JSX describes, and its renderer (`../server.ts`) renders a description after the code that made it returned, so: a row of
`mapArray`/`repeat` runs under an owner of its own when ids are given, a memo's retry runs in the render it was made in,
a `<Switch>` runs the `<Match>` descriptions it is given, a Provider also sets its value on the component owner its output
renders under, an `<Errored>`'s outcome for a failed boundary renders with no live holes, and an async node's serialized
answer is marked so the renderer keeps the response open until it ends. `twist.ts` holds the renderer's owner helpers, `control.ts` the marks Twist's JSX
pass leaves and the bridge's component calls.
