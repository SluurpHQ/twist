# <img src="logo.svg" width="28" height="28" alt="" align="top"> Twist

One runtime for React's API and Solid 2's. Components written either way render into the same tree, on fine-grained
signals: no virtual DOM, no re-running components to find what changed.

> **Alpha.** Twist is version 0.5, in alpha. The APIs follow React 19 and Solid 2 (release candidate 14), but some
> behaviours are not there yet (see [Compatibility](#compatibility)). Expect breaking changes.

## What it does

- **React's API** (`react`, `react-dom`, `react-dom/client`, `react-dom/server`): hooks, Suspense, transitions,
  server rendering, streaming and hydration, on signals instead of a virtual DOM.
- **Solid 2's API** (`solid-js`, `@solidjs/web`): signals, memos, stores, projections, `<For>`, `<Show>`,
  `<Loading>`, `<Errored>`, server rendering and hydration.
- **Both in one app:** a React component can render a Solid-style one and the other way round, with React's own runtime
  or with Twist answering React's API too.
- **A compiler in Rust:** Solid-style JSX is compiled to templates (fixed markup copied with `cloneNode`, only the parts
  that change bound to the DOM). It ships as a native Node addon, as Tailwind's engine does.

## Using it with Vite

```bash
npm install @sluurp/twist
```

One plugin, for every app: React apps, Solid apps, and apps with both kinds of component all run on Twist.

```js
// vite.config.js
import twist from "@sluurp/twist/vite";

export default { plugins: [twist()] };
```

Each file is read for what it is. A file that imports `solid-js` or `@solidjs/web` is Solid-style, and one that imports
`react` is React-style. A file that imports neither follows the app: React-style when its package.json lists `react`
and not `solid-js`, Solid-style otherwise. When a file of one kind imports a component of the other, Twist adds the
bridge that lets each render the other; an app of one kind never loads it.

The `examples/` folder has three apps, all on Twist: `vite-react` (a React app), `vite-solid` (a Solid app) and
`vite-mixed` (a Solid app that uses React-style components, with their own state and hooks).

## Development tools

- **Hot reload.** While Vite serves the app, an edited Solid-style component is swapped in place: every instance of it
  draws again with the new code, and the rest of the page keeps its state. A module that exports anything other than
  components reloads its importers instead. It runs on Solid's refresh runtime API (`solid-js/refresh`, also
  `@sluurp/twist/refresh`), so other bundler integrations that emit it work too.
- **Why did this run.** `solid-js/attribution` records every re-run with the write, interaction or landing that caused
  it, and reports wasted runs, wide scopes, waterfalls and long holds as development warnings.
- **Performance tracks.** `enablePerformanceTracks()` from `@solidjs/web/performance-tracks` (or
  `@sluurp/twist/performance-tracks`) paints those records in Chrome's Performance panel, in a "Solid" group: one track
  each for interactions, propagation, effects, memos, async work, holds, navigations and server calls.

All three are development-only: a production build leaves them out.

## Size and speed

Measured with the keyed table of [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), in
Chromium (milliseconds, lower is better; `bench/` in this repository):

| | create 1,000 rows | replace 1,000 rows | create 10,000 rows | bundle (minified) |
|---|---|---|---|---|
| Solid 2 | 19.9 | 20.7 | 208 | 64.5 KB |
| Twist, Solid's API | 21.0 | 22.3 | 238 | 62.7 KB |
| React 19.3 | 22.5 | 26.1 | 256 | 210 KB |
| Twist, React's API | 21.4 | 26.4 | 255 | 159 KB |

## Compatibility

Twist is checked against React's and Solid's own test suites (`conformance/`):

- React 19: 4,037 tests pass, 29 fail.
- Solid 2: 8,411 tests pass, 110 fail. Most of the failures are Solid 2's newest rules for optimistic updates running
  side by side, and for when a pending update holds what is on screen. Tests that only check Solid's private
  structures or its own build files are left out, each with its reason (`conformance/solid/skips.ts`).

## Working on Twist

```bash
bun install
node scripts/build-compiler.mjs        # the compiler's native addon, for this platform
cd test/bridge && bun test             # React and Solid in one tree
cd conformance && bun prepare.ts && bun run.ts          # React's tests
cd conformance/solid && bun prepare.ts && bun run.ts    # Solid's tests
```

## Licence

MIT.
