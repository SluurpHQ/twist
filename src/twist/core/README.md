# Twist's reactive core

Ported from Solid's `@solidjs/signals` (2.0.0-rc.14, https://github.com/solidjs/solid, packages/signals/src), MIT,
Copyright (c) 2016-2025 Ryan Carniato — see LICENSE. Changes: Solid's build constants read `NODE_ENV` where used
(`__DEV__` and `__OBSERVE__`: not `"production"`; `__TEST__`: `"test"`), so a production build drops them as Solid's
does; `package.json` declares the folder free of side effects, as Solid's package is. Twist's additions are marked
"(Twist …)" where they are.
