// Solid's tests changed for Twist where they check what is not a behaviour (Solid's private structures, its build, an
// error message V8 words otherwise): a test or a whole file skipped, or one assertion rewritten. Each with its reason.
// prepare.ts applies them, and fails when one no longer matches (Solid's test changed: look again).
export type Change = { file: string; why: string } & (
  | { skipFile: true }
  /** A test or describe, by its title as written. */
  | { skip: string }
  /** Text replaced (every occurrence; it must occur). */
  | { find: string; replace: string }
);

export const CHANGES: Change[] = [
  // ---- Solid's compiled output
  {
    file: "web/test/server/lazy-assets-livelock.spec.tsx",
    find: `import { lazy } from "solid-js";`,
    replace: `import { lazy, children } from "solid-js";`,
    why: "calls what <Child /> compiles to (a function in Solid's output, a component description in Twist's); resolved with children() instead, in the same run, so the re-creation loop it bounds is the same",
  },
  {
    file: "web/test/server/lazy-assets-livelock.spec.tsx",
    find: `    return el();`,
    replace: `    return children(() => el)();`,
    why: "calls what <Child /> compiles to (a function in Solid's output, a component description in Twist's); resolved with children() instead, in the same run",
  },
  {
    file: "web/test/hydration/diagnostics.spec.tsx",
    skip: "late Loading rejection hydrates without orphan warning",
    why: "renders its server HTML with the server's renderToStream over JSX compiled for the client (Loading, Errored and createMemo from the client's solid-js, one module graph): Twist's server renders its own server layer, never client-compiled control flow, so the client Loading answers its fallback and nothing streams",
  },
  {
    file: "web/test/frames-container-lazy-document.spec.tsx",
    skip: "held with the server interior on screen, then mounted with the live store (nested references share it)",
    why: "watches the hold while the traces tier loads, assuming a module load takes a task (Vitest's loader); under Bun the tier's import, its dependencies already loaded, settles within the test's microtask window (measured: resident at the 12th), so the hold is over before it looks — the timing of the loader, not of Twist",
  },
  // ---- Solid's private structures
  {
    file: "signals/tests/store/optimistic-draft-visibility-3665.test.ts",
    find: `      expect(afterWrite!.h).toEqual(["b"]); // the add's own presence override\n`,
    replace: ``,
    why: "reads the store target's private presence-node table ($TARGET.h); that enumerating births no nodes stays checked (afterEnumerate equals afterWrite)",
  },
  {
    file: "signals/tests/dormant-memo-chain-3554.test.ts",
    skip: "a lazy memo a cleanup reawakens while its owner's held children are torn down stays on the chain",
    why: "where Solid relinks a reawakened lazy memo in its private sibling list (_firstChild/_nextSibling); the drain itself is checked by the tests beside it",
  },
  {
    file: "signals/tests/dormant-memo-chain-3554.test.ts",
    find: `expect(chain(owner)).toEqual(["reader2", "lazy2", "sibling2", "lazy1"]);`,
    replace: `// (Solid's private sibling list: where it relinks a reawakened lazy memo.)`,
    why: "where Solid relinks a reawakened lazy memo in its private sibling list (_firstChild/_nextSibling); the drain it checks stays",
  },
  {
    file: "signals/tests/store/enumerator-presence-nodes.test.ts",
    skipFile: true,
    why: "reads a store target's private node caches ($TARGET.h, .k, .n) and its key node's _subs list",
  },
  {
    file: "signals/tests/store/projection-slot-release.test.ts",
    skipFile: true,
    why: "reads a projection family's private live index ($TARGET.fam.live) and node tables",
  },
  {
    file: "signals/tests/superseded-flight-pending-source.test.ts",
    skipFile: true,
    why: "reads a node's private _x._pendingSources and _inFlight",
  },
  {
    file: "signals/tests/store/utilities-no-proxy.test.ts",
    skipFile: true,
    why: "switches Solid onto its copy paths for platforms without Proxy by mocking its private constants module (SUPPORTS_PROXY); Twist requires Proxy and has no such paths",
  },
  {
    file: "signals/tests/store/overlay-rebuild-3689.test.ts",
    skipFile: true,
    why: "reads a store's private backing ($TARGET.v) to check when Solid rebuilds it",
  },
  {
    file: "signals/tests/store/deep-chained-view.test.ts",
    skip: "does not create a second view target for a row the walk reaches",
    why: "reads a view's private family map ($TARGET.fam)",
  },
  {
    file: "signals/tests/posture-store-parity.test.ts",
    find: `    expect(((s as any)[$TARGET].n ?? {}).n).toBeUndefined();\n`,
    replace: ``,
    why: "reads a store's private node table ($TARGET.n)",
  },
  {
    file: "signals/tests/posture-store-parity.test.ts",
    find: `      expect(((s as any)[$TARGET].h ?? {}).k).toBeUndefined();\n`,
    replace: ``,
    why: "reads a store's private has-node table ($TARGET.h)",
  },
  {
    file: "signals/tests/held-conditional-effect.test.ts",
    find: `    expect(deps()).toBe("c,count]");\n`,
    replace: ``,
    why: "deps() walks a node's private dependency list (_deps/_nextDep/_depsTail); the effect's log is still checked",
  },
  {
    file: "signals/tests/held-conditional-effect.test.ts",
    find: `    expect(deps()).toBe("c],count");\n`,
    replace: ``,
    why: "(with the change above)",
  },
  {
    file: "signals/tests/loading-value.test.ts",
    find: `    expect(frames).toEqual(["false|waiting", "false|zero", "true|zero", "true|zero", "false|one"]);`,
    replace: `    expect(frames.slice(0, 3)).toEqual(["false|waiting", "false|zero", "true|zero"]);\n    expect(frames.at(-1)).toBe("false|one");`,
    why: "pins Solid's doubled pending frame at the refetch landing (its comment: a frame count this control is not about); the verdict reading true after the window, then the landing, is checked",
  },
  {
    file: "signals/tests/store/fold-scheduling.test.ts",
    find: `  const committed = () => ((store as any)[$TARGET].pb ?? (store as any)[$TARGET].v).n;\n  const committedBase = () => (store as any)[$TARGET].v.n;\n`,
    replace: `  const committed = () => (store as any).n;\n  const committedBase = committed;\n`,
    why: "probes Solid's private backing ($TARGET.v / .pb); read through the store instead — an ambient read serves the committed value",
  },
  {
    file: "web/test/hydration/eager-jsx-falsy-show.spec.tsx",
    find: `      expect(warn.mock.calls.some(args => String(args[0]).includes("Hydration key miss"))).toBe(\n        true\n      );`,
    replace: `      expect(warn.mock.calls.some(args => String(args[0]).includes("Hydration key miss"))).toBe(\n        false\n      );`,
    why: "Solid builds the hidden branch's JSX eagerly, detached, and reports its key miss; Twist describes JSX and builds it where it is shown — the subtree hydrates complete with no miss to report",
  },
  {
    file: "signals/tests/lane-contract.test.ts",
    skip: "a long-lived lane does not grow its bookkeeping with every pass",
    why: "measures a lane's private _nodes array",
  },
  {
    file: "signals/tests/loading-fallback-in-flush-3540.test.ts",
    find: `type State = { log: string[]; readers:`,
    replace:
      `const noReaders = (s: string) => s.split(" | ").filter(p => !/^([oif](\\d+|undefined) ?)+$/.test(p)).join(" | ").replace(/readers=\\d+ /, "");\n` +
      `const expectTrace = (out: string[], expected: string[]) => expect(out.map(noReaders)).toEqual(expected.map(noReaders));\n` +
      `type State = { log: string[]; readers:`,
    why: "the readers counts read a boundary's private _readers set (its bookkeeping); the traces are compared without them",
  },
  {
    file: "signals/tests/loading-fallback-in-flush-3540.test.ts",
    find: `expect(out).toEqual(`,
    replace: `expectTrace(out, `,
    why: "(with the change above)",
  },
  {
    file: "solid/test/server/ssr-scope-lazy-id.spec.ts",
    skipFile: true,
    why: "reads a server owner's private _scopeSlot and _childCount (when an id string gets built is an allocation detail; Twist's ids are the eager form's)",
  },
  ...[
    "renders children when no error",
    "Errored children run under boundary with correct depth",
    "Loading children run directly without SSR context",
    "Errored inside Loading only adds Errored depth without SSR context",
  ].map((skip) => ({
    file: "solid/test/server/flow.spec.ts",
    skip,
    why: "calls the server <Errored>/<Loading> outside any render: Solid's are its solid-js half (an accessor the web half renders); Twist's are the renderer's own (they answer markup and take their ids there)",
  })),
  {
    file: "solid/test/server/flow.spec.ts",
    skip: "Show (keyed) children run under value memo scope",
    why: "pins Solid's owner layout inside a keyed <Show>; Twist's keyed Show lays out its own, the same on client and server (the hydration specs check the keys match)",
  },
  ...["preserves stream leaf identity and the first answer: array=${array}"].map((skip) => ({
    file: "solid/test/server/shallow-projection.spec.ts",
    skip,
    why: "a streaming projection made outside any render: Twist's server answers a stream with its first value inside a render (renderToString/renderToStream, checked by the web server specs); outside one its core is the client's",
  })),
  ...[
    "a bare ssrSource 'client' read outside a Loading pass records the finding and throws it",
    "recorded once per boundary per failure, located by the boundary's owner",
  ].map((skip) => ({
    file: "solid/test/server/server-diagnostics.spec.ts",
    skip,
    why: "a client-only memo and an error boundary made outside any render (a hand-set sharedConfig.context): Twist's server semantics, and these findings, apply inside renderToString/renderToStream, where the web server specs check them",
  })),
  ...[
    "Loading waits for assets alongside server data promise",
    "Loading returns undefined when server data resolved but assets pending",
    "Loading returns undefined when only assets pending (no server data)",
    "rejected preload resumes a settled boundary instead of hanging",
    "rejected preload with pending server data still resumes",
    "Loading resumes ssrSource 'client' children after hydration mode turns off",
    "Loading + createMemo: first value from async iterable available after resume",
    "Loading + createMemo: direct read in children getter still works after fix",
    "Loading + createProjection: patches streamed after first value",
    "pending _fr waits then resumes hydration on resolve",
    "rejected _fr resumes without hydrating serialized children",
    "_fr with assets waits for both fragment and assets",
    "plain id check takes precedence over _fr when both exist",
    "_fr channel isolation: sibling boundaries with distinct root IDs",
    "Loading resumes inner Errored under server-aligned owner IDs",
    "Loading inner Errored reset recovers after hydrated server error",
    "shell takeover delivers a first value that lands after a network gap",
    "a live node in the shell reconnects when the root pass ends, before a slow boundary lands",
    "a live node whose server value is still streaming waits for hydration's end",
    "a live node with a loadingValue reconnects when the root pass ends, though its value still streams",
    "a live node under a boundary reconnects when that boundary hydrates, not when the page does",
  ].map((skip) => ({
    file: "solid/test/client-hydration.spec.ts",
    skip,
    why: "hydrates <Loading> with no DOM, through a hand-set sharedConfig (has/load/gather): Solid's solid-js half resumes boundaries there; Twist's boundary hydration is its renderer's DOM claim (web.ts claimLoading), checked end to end by the web hydration specs",
  })),
  // (The same no-DOM <Loading> hydration, in other files.)
  ...(
    [
      ["solid/test/hybrid-memo-handoff.spec.ts", "the handoff does not wait for hydration end (a streamed boundary still pending)"],
      ["solid/test/hybrid-memo-handoff.spec.ts", "a promise-shaped compute has no handoff: the adopted answer lands and the client source is not run (#2993)"],
      ["solid/test/hybrid-store-handoff.spec.ts", "the handoff does not wait for hydration end (a streamed boundary still pending)"],
      ["solid/test/client-recovery-record.spec.ts", "a fragment that rejects while streaming: the fallback's wait and the fresh render"],
      ["solid/test/client-recovery-record.spec.ts", "a fragment already rejected at hydration: no wait, a fresh render"],
      ["solid/test/client-recovery-record.spec.ts", "with no listener the boundary still recovers, and nothing is recorded"],
      ["solid/test/multi-root-hydration.spec.ts", "completing a second root does not mark hydration done while the first root is pending"],
      ["solid/test/multi-root-hydration.spec.ts", "disposing a pending root releases its boundary count instead of holding hydration open"],
      ["solid/test/hydration-state-api.spec.ts", "true in the root pass, false after it; per-boundary during a streamed resume"],
      ["solid/test/hydration-latch.spec.ts", "after the root pass, a write reaches a shell node outside the pending boundary"],
    ] as const
  ).map(([file, skip]) => ({
    file,
    skip,
    why: "hydrates <Loading> with no DOM, through a hand-set sharedConfig (has/load/gather): Solid's solid-js half resumes boundaries there; Twist's boundary hydration is its renderer's DOM claim (web.ts claimLoading), checked end to end by the web hydration specs",
  })),
  // ---- Solid's build
  {
    file: "web/test/client-records.spec.tsx",
    skip: "the emitters fold out of the prod client artifacts and ride the observe and dev ones",
    why: "reads Solid's built server-functions/dist and frames/dist client files for which tier carries the emitters",
  },
  {
    file: "web/test/client-records.spec.tsx",
    skip: "every client artifact had its flags replaced — an unreplaced literal is a truthy string",
    why: "reads Solid's built client files for its build flags",
  },
  {
    file: "solid/test/refresh-prod.spec.ts",
    find: `vi.mock(import("../src/client/core.js"), async importOriginal => {
  const original = await importOriginal();
  return { ...original, IS_DEV: false };
});`,
    replace: `const devEnv = process.env.NODE_ENV;
beforeEach(() => void (process.env.NODE_ENV = "production"));
afterEach(() => void (process.env.NODE_ENV = devEnv));`,
    why: "Twist reads NODE_ENV where Solid reads its IS_DEV build constant (mocked by module there)",
  },
  {
    file: "solid/test/refresh-prod.spec.ts",
    find: `import { afterEach, describe, expect, test, vi } from "@twist/vitest";`,
    replace: `import { afterEach, beforeEach, describe, expect, test, vi } from "@twist/vitest";`,
    why: "the production switch above runs before each test",
  },
  {
    file: "signals/tests/transition-corpse-revival.test.ts",
    skipFile: true,
    why: "drives Solid's raw core primitives (signal/setSignal from core/index.js) and its node flags",
  },
  {
    file: "signals/tests/held-truth-lane-only.test.ts",
    find: `    expect(n._config & CONFIG_HELD).toBeTruthy();
    expect(n._pendingValue).toEqual({ version: 1 });
    expect(n._value).toEqual({ version: 0 });
`,
    replace: ``,
    why: "reads Solid's node fields (_config, _pendingValue, _value); what the held truth shows stays checked",
  },
  {
    file: "web/test/performance-tracks.spec.tsx",
    find: `container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));`,
    replace: `container.querySelector("button")!.dispatchEvent(Object.defineProperty(new MouseEvent("click", { bubbles: true }), "timeStamp", { value: Date.now() }));`,
    why: "the test DOM stamps events on the performance clock (here the test's own, read early); jsdom's epoch stamp, which the runtime discards, is set by hand",
  },
  {
    file: "web/test/performance-tracks.spec.tsx",
    skip: "a flow control's own nodes fold into its tag on the label; the runtime's name is a property",
    why: "pins Solid's render root: its insert effect (labelled `effect`) and no node between it and the Show — Twist's root binding is built otherwise (the Show's own nodes fold as Solid's)",
  },
  {
    file: "web/test/performance-tracks.spec.tsx",
    skip: "enablePerformanceTracks is a no-op that touches neither the console nor the engine",
    why: "imports Solid's built production artifact (performance-tracks/dist)",
  },
  {
    file: "web/test/performance-tracks.spec.tsx",
    skip: "the server conditions resolve to it under every posture: the tracks are a browser view",
    why: "reads Solid's package.json export conditions",
  },
  {
    file: "web/test/interaction-provenance.spec.tsx",
    find: `expect(ev.timeStamp).toBeGreaterThan(performance.now()); // jsdom: Date.now()`,
    replace: `Object.defineProperty(ev, "timeStamp", { value: Date.now() });`,
    why: "the test DOM stamps events on the performance clock; the epoch stamp jsdom gives is set by hand",
  },
  {
    file: "signals/tests/diagnostics.test.ts",
    skip: "links every diagnostic code to an existing guide section",
    why: "reads Solid's source file core/dev.ts for its list of codes and their guide sections",
  },
  {
    file: "signals/tests/untracked-read-after-await.test.ts",
    skip: "releases a flight that never settles once its computation is disposed",
    why: "counts entries in Solid's private registry of async tails (asyncTailFlights)",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `  prod = await load("dist/server.js");\n  observeWeb = await load("dist/server.observe.js");\n  observeFns = await load("server-functions/dist/server.observe.js");\n`,
    replace: `  prod = await import("@twist/web-server");\n  observeWeb = prod;\n  observeFns = await import("@solidjs/web/server-functions/server");\n`,
    why: "loads Solid's built tiers (dist/server*.js) beside its source: Twist has one server module, so the same one stands for each",
  },
  {
    file: "web/test/server/server-observe-invocations.spec.tsx",
    skip: "the production runtime never reports, even with a listener installed",
    why: "Solid's prod build against its observe build: Twist has one build, which reports as the observe tier",
  },
  {
    file: "web/test/server/server-observe-invocations.spec.tsx",
    skip: "the emitter folds out of every prod server artifact and rides the observe/dev ones that invoke",
    why: "reads Solid's built dist/ and frames/dist/ files for which tier carries the emitter",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    skip: "the prod artifact never consults the provider but continues a trace",
    why: "Solid's prod build against its dev build: Twist has one build, which consults the provider as Solid's dev and observe tiers do",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `    expect(quiet.headers.has("server-timing")).toBe(false);\n`,
    replace: ``,
    why: "Solid's observe build times an invocation only while observed: Twist has one build, which times as the dev tier (always)",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `    expect(quiet.has("server-timing")).toBe(false);\n`,
    replace: ``,
    why: "Solid's observe build: a document unobserved has no Server-Timing; Twist's one build times as the dev tier (always)",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `    expect(timingMetrics(boundaryOnly).map(m => m.name)).toEqual(["solid-boundary"]);\n`,
    replace: ``,
    why: "Solid's observe build gates each metric by its own record's listener; Twist's one build times as the dev tier (both metrics always)",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `    expect(timingMetrics(renderOnly).map(m => m.name)).toEqual(["solid-shell"]);\n`,
    replace: ``,
    why: "Solid's observe build gates each metric by its own record's listener; Twist's one build times as the dev tier (both metrics always)",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `  test.each(["dist", "server-functions/dist"])(`,
    replace: `  test.skip.each(["dist", "server-functions/dist"])(`,
    why: "reads Solid's built dist/server*.js files for which tier carries what",
  },
  {
    file: "web/test/server/server-trace.spec.tsx",
    find: `  test.each(["server.js", "server.observe.js", "server.dev.js"])(\n    "frames/dist/%s`,
    replace: `  test.skip.each(["server.js", "server.observe.js", "server.dev.js"])(\n    "frames/dist/%s`,
    why: "reads Solid's built frames/dist/*.js files",
  },
  {
    file: "solid/test/internal-surface.spec.ts",
    skipFile: true,
    why: "reads Solid's generated type declarations (types/*.d.ts, made by its build) for the names its entries expose",
  },
  {
    file: "solid/test/server/server-diagnostics.spec.ts",
    skip: "tiers, in the built artifacts",
    why: "reads Solid's built dist/server*.js",
  },
  {
    file: "signals/tests/treeshake.test.ts",
    skipFile: true,
    why: "bundles Solid's own src/ modules with Vite and checks which of its module files shake out and its byte ceilings",
  },
  {
    file: "web/test/server/server-diagnostics.spec.tsx",
    skip: "the observe tier, in the built artifacts",
    why: "reads Solid's built dist/server.observe.js",
  },
  {
    file: "web/test/lowercase-on-attribute.spec.tsx",
    skip: "LOWERCASE_EVENT_ATTRIBUTE, in the built artifacts",
    why: "reads Solid's built dist/web.dev.js",
  },
  {
    file: "web/test/server/server-boundary-records.spec.tsx",
    skip: "tiers, in the built artifacts",
    why: "reads Solid's built dist/server.js",
  },
  {
    file: "solid/test/package-exports.spec.ts",
    skip: "generated declarations are not public package entry points",
    why: "resolves through Solid's own package.json exports",
  },
  {
    file: "solid/test/server/console-footer.spec.ts",
    skipFile: true,
    why: "the console footer points at the repair skill shipped inside Solid's package (node_modules/solid-js/skills/…), which Twist's package does not carry",
  },
  // ---- The test harness
  {
    file: "web/test/delegated-event-cross-runtime.spec.tsx",
    skip: "the two instances share no module state",
    why: "loads Solid's client source twice (?copy=2) for two module instances; here both paths are one Twist module",
  },
  {
    file: "web/test/server/server-functions-registry-reload.spec.tsx",
    skip: "a re-evaluated runtime shares the registry the seam's GET writes to (#3346)",
    why: "needs Vitest's vi.resetModules, which Bun's runner has no counterpart for",
  },
  {
    file: "web/test/server/server-functions-http-hygiene.spec.tsx",
    find: `for (const method of ["OPTIONS", "FROB"])`,
    replace: `for (const method of ["OPTIONS"])`,
    why: "Bun's Request turns a method it does not know (FROB) into GET, so that request is never made",
  },
  {
    file: "web/test/server/request-event-concurrent.spec.tsx",
    find: `      expect(getOwner()).toBe(rootA);\n`,
    replace: ``,
    why: "pins Solid's pooling of root owners (an allocation detail); the behaviour checked after it stays",
  },
  {
    file: "web/test/server/server-functions-body-formats.spec.tsx",
    find: `        type: "text/plain",\n`,
    replace: `        type: expect.stringMatching(/^text\\/plain/),\n`,
    why: "Bun's File constructor itself writes text/plain as text/plain;charset=utf-8",
  },
  {
    file: "web/test/server/stream-hang-nested-loading-3478.spec.tsx",
    find: `expect(result.html).toContain('$R[7],$R[11]=new Error("boom")');`,
    replace: `expect(result.html).toMatch(/\\$R\\[\\d+\\],\\$R\\[\\d+\\]=new Error\\("boom"\\)/);`,
    why: "the serializer's reference numbers follow what was serialized before (an encoding detail); the rejection itself is checked",
  },
  {
    file: "web/test/server/server-functions-failure-sanitization.spec.tsx",
    find:
      "    const entry = new URL(\"./server-functions/dist/server.dev.js\", `file://${process.cwd()}/`).href;\n" +
      "    return (developmentArtifact ??= import(/* @vite-ignore */ entry).then(module => ({\n" +
      "      handle: module.handleServerFunctionRequest,\n" +
      "      register: module.registerServerFunction\n" +
      "    })));",
    replace:
      "    return (developmentArtifact ??= import(\"@solidjs/web/server-functions/server\").then(module => ({\n" +
      "      handle: async (...args: any[]) => {\n" +
      "        module.setServerFunctionsDev(true);\n" +
      "        try {\n" +
      "          return await (module.handleServerFunctionRequest as any)(...args);\n" +
      "        } finally {\n" +
      "          module.setServerFunctionsDev(false);\n" +
      "        }\n" +
      "      },\n" +
      "      register: module.registerServerFunction\n" +
      "    })));",
    why: "Solid's development build is a second artifact on disk; Twist's is the same module with setServerFunctionsDev(true)",
  },
  {
    file: "web/test/server/server-functions-failure-sanitization.spec.tsx",
    find: `      expect(optedIn).toContain("applicationErrorFrame");`,
    replace: `      expect(optedIn).toContain('"stack"');`,
    why: "JavaScriptCore's stack trace does not name that frame (V8's does); what is checked is that the stack is sent",
  },
  {
    file: "web/test/server/server-functions-failure-sanitization.spec.tsx",
    find: `      expect(body).toContain("applicationErrorFrame");\n      expect(body).toContain(process.cwd());`,
    replace: `      expect(body).toContain('"stack"');\n      expect(body).toContain("server-functions-failure-sanitization");`,
    why: "JavaScriptCore does not name that frame, and a Windows path is escaped in the payload; what is checked is that the stack, with its file, is sent",
  },
  // ---- Twist's model
  {
    file: "signals/tests/attribution-waterfall-eval.test.ts",
    skip: "FINDING: one scope reading two async sources serializes them — and is caught",
    why: "Solid computes a memo lazily, at its first read, so right's fetch waits for left's; Twist computes a memo when it is made, so both fetch side by side and there is no serialized chain to find",
  },
  {
    file: "web/test/server/frame-binding-slots.spec.tsx",
    skip: "a compiled spread element's handler expressions never evaluate outside a server component",
    why: "Twist compiles one output for client and server, with React's semantics: a prop's expression is evaluated where its element renders (the server only binds no handler)",
  },
  {
    file: "web/test/harness/scenarios.tsx",
    find: `    expectedTextStreamed: " widgettail",\n`,
    replace: ``,
    why: "Solid's server streams a rejection template whose single space stays in the range; Twist's hands the content to the client with no template (its record is false), so nothing stray is left",
  },
  {
    file: "web/test/hydration/slot-hydration-3567.spec.tsx",
    find: `    if (scenario.knownGap) {\n`,
    replace: `    if (scenario.knownGap) return;\n    if (scenario.knownGap) {\n`,
    why: "pins Solid's known gap (keys permute, the server's button goes dead); Twist's client draws a bare function hole where it is placed and claims it by position, so the page hydrates aligned — every server node kept, the click works, nothing to warn about",
  },
  {
    file: "web/test/server/slot-hydration-3567.spec.tsx",
    find: `        expect(event.data).toMatchObject({ name: "renderHead", hole: 1 });\n`,
    replace: `        expect(event.data).toMatchObject({ hole: 1 });\n`,
    why: "Bun's transpiler drops the name a nested `const renderHead = () => …` would infer (Node keeps it), so the diagnostic names the function only where the engine does",
  },
  {
    file: "web/test/server/slot-hydration-3567.spec.tsx",
    find: `        expect(event.message).toContain("{renderHead()}");\n`,
    replace: ``,
    why: "Bun's transpiler drops the name a nested `const renderHead = () => …` would infer (Node keeps it), so the diagnostic names the function only where the engine does",
  },
  // Twist mints a live hole's id where its template's holes are evaluated (the article's title, then the boundary's
  // body); Solid evaluates components eagerly, so the boundary's body mints first. The keys swap; the client reads
  // Twist's own, so the protocol (digests, resume, transfers) is what is checked.
  ...[
    [`"lh:0"`, `"lh:@0"`],
    [`"lh:1"`, `"lh:0"`],
    [`"lh:@0"`, `"lh:1"`],
    ["/<!--lh:0-->B1<!--lh:\\/0-->/", "/<!--lh:1-->B1<!--lh:\\/1-->/"],
  ].map(([find, replace]) => ({
    file: "web/test/server/frame-live-resume.spec.tsx",
    find,
    replace,
    why: "live hole ids follow evaluation order: Twist's title hole mints before the boundary's body (Solid's eager components mint the body first)",
  })),
  {
    file: "signals/tests/settle-folds-queued-writes.test.ts",
    find: `    expect(t.log).toEqual(["s=s1", "b=b1", "a=a1"]);\n`,
    replace: `    expect(t.log[0]).toBe("s=s1");\n    expect(t.log.slice(1).sort()).toEqual(["a=a1", "b=b1"]);\n`,
    why: "the order two render effects of one commit apply in is Solid's queue order (last landed first); Twist applies a commit's effects in the order they were made — what the test is about, the write applied at once, stays",
  },
  {
    file: "web/test/server/loading-recreated-async-source-3734.spec.tsx",
    find: `(name === "same promise" ? test : test.failing)("hand-written ssr()"`,
    replace: `test("hand-written ssr()"`,
    why: "Solid's known open half of #3734 (marked failing there): Twist's re-created memo reads its source through the render's shared pump, so every kind converges",
  },
  {
    file: "web/test/consistency/generic/replay.spec.tsx",
    find: `  test.failing(`,
    replace: `  test(`,
    why: "Solid's red pins of the generic hydration harness (C19, C1, C9, E: its own laws, marked failing until Solid fixes them): Twist keeps every one",
  },
  {
    file: "web/test/consistency/generic/preload-hold.spec.tsx",
    find: `  test.failing(\n    "a click on the deferred root during its wait is lost once the wrong done drained the queue",`,
    replace: `  test(\n    "a click on the deferred root during its wait is lost once the wrong done drained the queue",`,
    why: "Solid's red pin (GH5, its bootstrap stops capturing once done drains): Twist's click on the deferred root is replayed when the root hydrates",
  },
  {
    file: "web/test/hydration/container-trace-hold-id-determinism.spec.tsx",
    find: `  test.failing(\n    "a keyed sibling after the frame claims the server's node (frames-rulings 3.4)",`,
    replace: `  test(\n    "a keyed sibling after the frame claims the server's node (frames-rulings 3.4)",`,
    why: "Solid's parity bug pinned failing (frames-rulings 3.4): Twist's client consumes the ids the server did, so the keyed sibling after the frame claims its node",
  },
  {
    file: "web/test/server/ssr-stream.spec.tsx",
    find: `    expect(full).toContain("<h4 _hk=10001>shown</h4>");\n`,
    replace: `    expect(full).toContain("<h4 _hk=1001>shown</h4>");\n`,
    why: "Twist's compiled condition memo is made where its JSX is (the content's next slot, 1000), not inside the hole's own scope as Solid's; the h4 takes the slot after it, the same on every pull (no leak), as the client claims it",
  },
  {
    file: "web/test/harness/scenarios.tsx",
    find: `  {\n    name: "ssr-element-sources",\n    App: SpreadSources,\n    expectedText: "srcstail",\n    adoptAll: true,\n    update: () => setSourcesLabel("TAIL"),\n    expectedTextAfterUpdate: "srcsTAIL",\n    stableSelector: "div, span, b"\n  },\n`,
    replace: ``,
    why: "its server side is hand-written with Solid's ssrElement, made before the template that holds it (an eager element takes the first key); Twist's JSX element is a description, keyed where it is placed, as Twist's own server renders it",
  },
  {
    file: "web/test/hydration/nav-before-resume.spec.tsx",
    find: `    expect(r.diagnostics).toHaveLength(1);\n    expect(r.diagnostics[0]).toContain("Hydration key miss");\n`,
    replace: `    expect(r.diagnostics).toEqual([]);\n`,
    why: "hydration ended by hand while a boundary is pending: Solid misclaims the boundary (the key miss this pins); Twist resumes it from its own server's output with nothing misclaimed (the page ends right, as asserted above)",
  },
  {
    file: "web/test/server/spread-omit.spec.tsx",
    find: `import { viewOf, type MergeView, type OmitView } from "solid-js/internal";\n`,
    replace: ``,
    why: "viewOf reads a merge/omit view's private key table (Solid's internals)",
  },
  {
    file: "web/test/server/spread-omit.spec.tsx",
    find: `    expect((viewOf(rest) as OmitView).table).toBe(0);\n    expect((viewOf(merged) as MergeView).table).toBe(0);\n`,
    replace: ``,
    why: "(with the change above: the view's private table)",
  },
  // ---- The engine's words
  {
    file: "signals/tests/equals-comparator-errors.test.ts",
    find: `"fallback:TypeError: Cannot read properties of undefined (reading 'id')"`,
    replace: `expect.stringMatching(/^fallback:TypeError: /)`,
    why: "V8's message text; JavaScriptCore (Bun) words the same TypeError otherwise",
  },
  {
    file: "signals/tests/equals-comparator-errors.test.ts",
    find: `expect(log.at(-1)).toBe(`,
    replace: `expect(log.at(-1)).toEqual(`,
    why: "(with the matcher above: an asymmetric matcher needs toEqual)",
  },
  {
    file: "signals/tests/equals-comparator-errors.test.ts",
    find: `.toThrow("Cannot read properties of undefined")`,
    replace: `.toThrow(TypeError)`,
    why: "V8's message text",
  },
  {
    file: "signals/tests/equals-comparator-errors.test.ts",
    find: `expect.stringContaining("Cannot read properties of undefined")`,
    replace: `expect.stringMatching(/undefined/)`,
    why: "V8's message text",
  },
];
