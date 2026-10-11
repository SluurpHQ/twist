// Our serializer against seroval: the same values, the same script text (Solid's tests compare it); and the JSON form
// read back as the same values.
import { expect, test } from "bun:test";
import * as seroval from "seroval";
import { Feature, Serializer, crossHeader, parse, stringify } from "../../src/serial.js";

type Opts = { scopeId?: string; disabledFeatures?: number };
async function run(S: any, values: [string, any][], opts: Opts = {}) {
  const out: string[] = [];
  let finished = false;
  const s = new S({ globalIdentifier: "_$HY.r", disabledFeatures: Feature.RegExp | Feature.ErrorPrototypeStack, ...opts, onData: (d: string) => out.push(d), onDone: () => (finished = true), onError: () => out.push("ERROR") });
  for (const [k, v] of values) s.write(k, v);
  s.flush();
  for (let i = 0; i < 20 && !finished; i++) await new Promise((r) => setTimeout(r, 5));
  return { out, finished };
}
const later = <T>(v: T, ms = 3) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const failLater = (e: any, ms = 3) => new Promise((_, j) => setTimeout(() => j(e), ms));
async function* gen() {
  yield 1;
  await later(0, 2);
  yield { a: 2 };
  return "end";
}

const cases: Record<string, () => [string, any][]> = {
  primitives: () => [["a", 1], ["b", "x</script>\u2028\"'\\\n\t"], ["c", true], ["d", false], ["e", null], ["f", undefined], ["g", NaN], ["h", Infinity], ["i", -Infinity], ["j", -0], ["k", 12n], ["l", "a".repeat(70)], ["m", 1.5e-7]],
  objects: () => [["o", { x: 1, "a-b": 2, 3: "n", "01": 4, $y: [1, , 3], nested: { deep: { z: [] } }, constructor: 1, __proto__x: 2 }], ["arr", [1, "a", [2, [3]], , ]], ["empty", {}], ["ea", []]],
  references: () => {
    const shared = { a: 1 };
    const cyc: any = { name: "c" };
    cyc.self = cyc;
    cyc.list = [cyc, shared];
    const arr: any[] = [];
    arr.push(arr, shared);
    return [["a", shared], ["b", shared], ["c", [shared, shared]], ["cyc", cyc], ["arr", arr]];
  },
  types: () => {
    const m = new Map<any, any>();
    m.set(m, 1);
    m.set("k", m);
    const s = new Set<any>();
    s.add(s);
    s.add(1);
    const nul = Object.assign(Object.create(null), { q: 1, r: { t: 2 } });
    const err = new TypeError("t");
    (err as any).code = 7;
    const named = new Error("x");
    named.name = "Custom";
    return [["d", new Date(0)], ["bad", new Date(NaN)], ["m", new Map<any, any>([[1, "a"], ["k", { z: 1 }]])], ["mc", m], ["s", new Set([1, 2])], ["sc", s], ["e", new Error("boom")], ["te", err], ["named", named], ["nul", nul], ["frozen", Object.freeze({ f: 1 })], ["sealed", Object.seal([1])], ["boxed", [Object(1), Object("s"), Object(true), Object(2n)]], ["sym", [Symbol.iterator, Symbol.asyncIterator]], ["ta", new Uint8Array([1, 2, 3])], ["f64", new Float64Array([1.5])], ["dv", new DataView(new ArrayBuffer(4))], ["ab", new ArrayBuffer(2)], ["big", new BigInt64Array([1n])]];
  },
  promises: () => {
    const shared = { s: 1 };
    const self: any = {};
    self.p = later(self);
    return [["now", Promise.resolve(5)], ["later", later({ late: true, shared })], ["shared", shared], ["rejected", Promise.reject(new Error("no"))], ["laterFail", failLater(new RangeError("r"))], ["nested", later(later(3, 2), 2)], ["self", self], ["two", [later(1), later(2, 6)]]];
  },
  iterables: () => [["it", { *[Symbol.iterator]() { yield 1; yield 2; return 3; } }], ["ai", gen()], ["obj", { a: 1, [Symbol.toStringTag]: "Tag" }]],
  errors: () => [["fn", () => 1], ["ok", 1], ["sym", Symbol("mine")]],
};

for (const [name, make] of Object.entries(cases)) {
  test(`script output matches seroval: ${name}`, async () => {
    const theirs = await run(seroval.Serializer, make());
    const ours = await run(Serializer, make());
    expect(ours.out.join("\n")).toBe(theirs.out.join("\n"));
    expect(ours.finished).toBe(theirs.finished);
  });
  test(`script output matches seroval, scoped: ${name}`, async () => {
    const theirs = await run(seroval.Serializer, make(), { scopeId: "s-1" });
    const ours = await run(Serializer, make(), { scopeId: "s-1" });
    expect(ours.out.join("\n")).toBe(theirs.out.join("\n"));
  });
}

test("stacks left out when asked, as seroval does", async () => {
  const opts = { disabledFeatures: Feature.RegExp | Feature.ErrorPrototypeStack };
  const v = (): [string, any][] => [["e", new Error("x")]];
  expect((await run(Serializer, v(), opts)).out).toEqual((await run(seroval.Serializer, v(), opts)).out);
});

test("header matches", () => {
  expect(crossHeader()).toBe(seroval.getCrossReferenceHeader());
  expect(crossHeader('a"b')).toBe(seroval.getCrossReferenceHeader('a"b'));
});

test("the script rebuilds the values", async () => {
  const shared = { a: 1 };
  const cyc: any = { list: [shared] };
  cyc.self = cyc;
  const { out } = await run(Serializer, [["v", { shared, cyc, m: new Map([[shared, new Set([1])]]), d: new Date(5), n: [NaN, -0, 3n, undefined] }], ["p", later({ x: shared })]]);
  const scope: any = { _$HY: { r: {} } };
  const $R = ((globalThis as any).$R = []);
  for (const line of out) new Function("_$HY", "$R", line)(scope._$HY, $R);
  const v = scope._$HY.r.v;
  expect(v.cyc.self).toBe(v.cyc);
  expect(v.cyc.list[0]).toBe(v.shared);
  expect([...v.m.keys()][0]).toBe(v.shared);
  expect(v.d.getTime()).toBe(5);
  expect(Object.is(v.n[1], -0)).toBe(true);
  expect(v.n[2]).toBe(3n);
  expect((await scope._$HY.r.p).x).toBe(v.shared);
});

test("JSON form round-trips without eval", () => {
  const shared = { a: 1 };
  const cyc: any = { name: "c", list: [shared, shared] };
  cyc.self = cyc;
  const value = { cyc, d: new Date(7), m: new Map<any, any>([["k", shared]]), s: new Set([1, "x"]), n: [NaN, -0, Infinity, undefined, 5n], e: new TypeError("bad"), u: new Uint8Array([9, 8]), nul: Object.assign(Object.create(null), { z: 1 }), text: "</script>\u2028\"" };
  const back = parse(stringify(value));
  expect(back.cyc.self).toBe(back.cyc);
  expect(back.cyc.list[0]).toBe(back.cyc.list[1]);
  expect(back.m.get("k")).toEqual({ a: 1 });
  expect(back.d.getTime()).toBe(7);
  expect([...back.s]).toEqual([1, "x"]);
  expect(Number.isNaN(back.n[0]) && Object.is(back.n[1], -0) && back.n[2] === Infinity && back.n[3] === undefined && back.n[4] === 5n).toBe(true);
  expect(back.e).toBeInstanceOf(TypeError);
  expect(back.e.message).toBe("bad");
  expect([...back.u]).toEqual([9, 8]);
  expect(Object.getPrototypeOf(back.nul)).toBe(null);
  expect(back.text).toBe(value.text);
});

test("JSON form refuses what it should", () => {
  expect(() => stringify(Promise.resolve(1))).toThrow();
  expect(() => stringify(() => 1)).toThrow();
  expect(() => parse('{"t":99}')).toThrow();
  expect(() => parse('{"t":4,"i":3}')).toThrow();
  expect(() => parse('{"t":13,"i":0,"s":"constructor","m":"x"}')).toThrow();
  // A key that would reach the prototype is set as an own property instead.
  const polluted = parse('{"t":10,"i":0,"p":{"k":["__proto__"],"v":[{"t":10,"i":1,"p":{"k":["x"],"v":[{"t":0,"s":1}]},"o":0}]},"o":0}');
  expect(({} as any).x).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(polluted, "__proto__")?.value).toEqual({ x: 1 });
});
