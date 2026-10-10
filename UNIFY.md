# One stack: React, Solid 2 and Sluurp's own apps, together

Goal (owner, 2026-10-10): one runtime runs native React apps, native Solid 2 apps and our own apps at the same time.
A Solid-style file can use shadcn and our kit; a React file can use a Solid-style component; both read the same data.
Batteries included, 80/20: what real apps use, no chasing Solid's edge rulings.

## What exists

| Piece | Where |
|---|---|
| Signals, React side and SDK | `@sluurp/signals` (`host/packages/signals`, same code as `client/sluurp-reactive.js`) |
| Signals, Solid side | Twist core, `host/packages/dom/src/twist/signals.ts` (+ store, flow) |
| React API on signals | `@sluurp/dom` (`src/core.ts` …), chosen per app with `SLUURP_REACT=sluurp` |
| Solid 2 API | Twist (`src/twist/web.ts`, `server.ts`, `compile.ts`) |
| Classic Sluurp UI | `sluurp/ui` + `src/reactive_jsx.rs`, `<sluurp-island>` |
| Pages, Next-style | `host/runtime/pages.ts` + `rsc.ts`: `routes/*.tsx` server components, `"use client"` → `<sluurp-react>` |
| SPA | `host/runtime/spa.ts`: an app with `index.html` |
| MPA + htmx-style partials | `client/sluurp-nav.js`: `sluurp-nav`, `sluurp-partial` regions swapped on navigation |
| Routers | admin `admin/route.ts` (hash), MikroSchool `href()`, Twist tests' router shapes |
| RPC, data | `"use server"` (`sluurp-rpc.js`), `live`/`useLive`/`useRow`, server twin of the SDK |

## Target

1. **Styles meet in one tree, per file.** A file is React-style (re-renders on change) or Solid-style (runs once);
   our compile pass knows which from the file's JSX source. Components it declares are marked Solid-style.
   - React renders a marked component as a Twist subtree, props live.
   - Twist renders an unmarked one (React, shadcn, the kit) as a React subtree, props live.
2. **State crosses with no glue.** A signal of either core read inside the other's computation is tracked there (a
   small bridge, both ways). Later the cores merge: the React runtime moves onto Twist's core and the bridge goes.
3. **One page pipeline.** `routes/*.tsx` renders either style; one hydration format (`_hk`, `_$HY.r`, streamed
   Loading); `"use client"` islands for both styles; `sluurp-partial` swaps hydrate what they bring; SPA apps can be
   either style.
4. **One data API.** `live("notes")` is a store a Solid-style file reads directly, `useLive` the React face of it;
   `"use server"` functions work as actions in both.
5. **Retire** the classic `sluurp/ui` runtime, `reactive_jsx.rs` and `<sluurp-island>` (owner, 2026-10-10: every
   file is Solid-style or React-style, nothing else).
6. **Our components:** the kit is shadcn's original component code, always (owner, 2026-10-10); it works in both
   styles through the bridge. Hot paths in our apps move to Solid-style where a benchmark shows it pays.

## Built

- Step 1 (2026-10-10): `src/twist/bridge.ts` (`installBridge(React, createRoot)`), marks from the compile pass and
  Twist's own components, `TwistHost` in the React runtime's renderer; `test/bridge` covers both directions.

## Order

1. Cross-style components (marks + both mounts), with tests in both directions.
2. Signals bridge, tests: a React component and a Twist component on one signal, one store, one `live()`.
3. Pages pipeline: a Solid-style route, a Solid-style `"use client"` island, a partial swap hydrating Twist.
4. Benchmarks: Twist's own compiler vs Solid vs vanilla; mixed trees.
5. Core merge, then retirements.
