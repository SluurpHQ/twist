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
  // ---- Solid's private structures
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
    file: "signals/tests/lane-contract.test.ts",
    skip: "a long-lived lane does not grow its bookkeeping with every pass",
    why: "measures a lane's private _nodes array",
  },
  // ---- Solid's build
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
    file: "web/test/server/server-functions-failure-sanitization.spec.tsx",
    skip: "the development artifact retains its stack default under NODE_ENV=production",
    why: "loads Solid's built server-functions/dist/server.dev.js",
  },
  {
    file: "solid/test/package-exports.spec.ts",
    skip: "generated declarations are not public package entry points",
    why: "resolves through Solid's own package.json exports",
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
