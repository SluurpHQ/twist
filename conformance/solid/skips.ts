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
