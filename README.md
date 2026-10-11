# Twist

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

A Solid-style app:

```js
// vite.config.js
import twist from "@sluurp/twist/vite";

export default { plugins: [twist()] };
```

A React app, with Twist as its React:

```js
export default { plugins: [twist({ react: "twist" })] };
```

React's own runtime, with Solid-style components inside it (only files that import `solid-js` or `@solidjs/web` are
compiled by Twist):

```js
export default { plugins: [twist({ react: true })] };
```

The `examples/` folder has one app of each kind: `vite-solid`, `vite-react` and `vite-mixed` (a React page with a
Solid-style counter that shows a React component).

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
- Solid 2: 6,001 tests pass, 1,001 fail (mostly Solid 2's newest async and transaction rules, and server streaming of
  async iterators).

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
