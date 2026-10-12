/**
 * Values sent between server and browser, with what JSON loses kept: undefined, NaN, ±Infinity, -0, BigInt, Date,
 * Map, Set, errors, boxed values, typed arrays, shared references and cycles, and (streamed) promises, iterables and
 * async iterables.
 *
 * Two forms of one tree of nodes:
 *  - script (`Serializer`, `crossHeader`): what a server render hands the page to hydrate with. Values are written by
 *    key into a global as script text, a promise's value in a later script when it lands. The text is seroval's
 *    cross-reference output, 1:1 (Solid's tests compare it), so the format and the runtime helpers below follow
 *    seroval (MIT, © Alexis Munsayac).
 *  - JSON (`stringify`, `parse`): what a server function call carries both ways, and island props. Read back
 *    without eval, every node checked.
 */

// ---------------------------------------------------------------- constants

/** What may be turned off (`disabledFeatures`), as seroval numbers them. */
export const Feature = { AggregateError: 1, ArrowFunction: 2, ErrorPrototypeStack: 4, ObjectAssign: 8, BigIntTypedArray: 16, RegExp: 32, Temporal: 64 };
const ALL = 127;

const T = {
  NUMBER: 0, STRING: 1, CONSTANT: 2, BIGINT: 3, INDEXED: 4, DATE: 5, REGEXP: 6, SET: 7, MAP: 8, ARRAY: 9, OBJECT: 10,
  NULL_OBJECT: 11, PROMISE: 12, ERROR: 13, AGGREGATE_ERROR: 14, TYPED_ARRAY: 15, BIGINT_TYPED_ARRAY: 16, WK_SYMBOL: 17,
  REFERENCE: 18, ARRAY_BUFFER: 19, DATA_VIEW: 20, BOXED: 21, PROMISE_CONSTRUCTOR: 22, PROMISE_SUCCESS: 23,
  PROMISE_FAILURE: 24, PLUGIN: 25, SPECIAL_REFERENCE: 26, ITERATOR_FACTORY: 27, ITERATOR_FACTORY_INSTANCE: 28,
  ASYNC_ITERATOR_FACTORY: 29, ASYNC_ITERATOR_FACTORY_INSTANCE: 30, STREAM_CONSTRUCTOR: 31, STREAM_NEXT: 32,
  STREAM_THROW: 33, STREAM_RETURN: 34, SEQUENCE: 35,
};

const WELL_KNOWN = [
  Symbol.asyncIterator, Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.iterator, Symbol.match, Symbol.matchAll,
  Symbol.replace, Symbol.search, Symbol.species, Symbol.split, Symbol.toPrimitive, Symbol.toStringTag, Symbol.unscopables,
];
const WELL_KNOWN_TEXT = WELL_KNOWN.map((s) => "Symbol." + s.description.slice("Symbol.".length));
const wellKnownIndex = (s) => WELL_KNOWN.indexOf(s);

// null, undefined, true, false, -0, Infinity, -Infinity, NaN
const CONSTANT_TEXT = ["null", "void 0", "!0", "!1", "-0", "1/0", "-1/0", "0/0"];
const CONSTANT_VALUE = [null, undefined, true, false, -0, Infinity, -Infinity, NaN];

const ERRORS = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError];
const ERROR_NAMES = ERRORS.map((e) => e.name);

const TYPED_ARRAYS = {
  Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray, Float32Array, Float64Array,
  ...(typeof BigInt64Array !== "undefined" ? { BigInt64Array, BigUint64Array } : {}),
};

const FLAG_TEXT = [undefined, "Object.preventExtensions", "Object.seal", "Object.freeze"];

const DEPTH_LIMIT = 1000;
const MAX_TYPED_ARRAY_LENGTH = 1e6;
const MAX_BASE64_LENGTH = 1e6;
const MAX_BIGINT_LENGTH = 1e4;

// ---------------------------------------------------------------- the page's runtime helpers
// Sent as their source text, once per render scope; the text must stay exactly as written (it is part of the output).

const PROMISE_CONSTRUCTOR = () => {
	const resolver = {
		p: 0,
		s: 0,
		f: 0
	};
	resolver.p = new Promise((resolve, reject) => {
		resolver.s = resolve;
		resolver.f = reject;
	});
	return resolver;
};
const PROMISE_SUCCESS = (resolver, data) => {
	resolver.s(data);
	resolver.p.s = 1;
	resolver.p.v = data;
};
const PROMISE_FAILURE = (resolver, data) => {
	resolver.f(data);
	resolver.p.catch(() => {});
	resolver.p.s = 2;
	resolver.p.v = data;
};
const STREAM_CONSTRUCTOR = () => {
	const buffer = [];
	const listeners = [];
	let alive = true;
	let success = false;
	let count = 0;
	const internal = {
		flush(value, mode, x) {
			for (x = 0; x < count; x++) {
				const listener = listeners[x];
				if (listener) listener[mode](value);
			}
		},
		up(listener, x, z, current) {
			for (x = 0, z = buffer.length; x < z; x++) {
				current = buffer[x];
				if (!alive && x === z - 1) listener[success ? "return" : "throw"](current);
				else listener.next(current);
			}
		},
		on(listener, temp = 0) {
			let subscribed = alive;
			if (alive) {
				for (temp = 0; temp < count; temp++) if (!listeners[temp]) break;
				if (temp === count) count++;
				listeners[temp] = listener;
			}
			internal.up(listener);
			return () => {
				if (alive && subscribed) {
					subscribed = false;
					listeners[temp] = void 0;
					while (count > 0 && !listeners[count - 1]) count--;
					listeners.length = count;
				}
			};
		}
	};
	return {
		__SEROVAL_STREAM__: true,
		on(listener) {
			return internal.on(listener);
		},
		next(value) {
			if (alive) {
				buffer.push(value);
				internal.flush(value, "next");
			}
		},
		throw(value) {
			if (alive) {
				buffer.push(value);
				internal.flush(value, "throw");
				alive = false;
				success = false;
				listeners.length = 0;
			}
		},
		return(value) {
			if (alive) {
				buffer.push(value);
				internal.flush(value, "return");
				alive = false;
				success = true;
				listeners.length = 0;
			}
		}
	};
};
const ITERATOR_CONSTRUCTOR = (symbol) => (sequence) => () => {
	let index = 0;
	const instance = {
		[symbol]() {
			return instance;
		},
		next() {
			if (index > sequence.d) return {
				done: true,
				value: void 0
			};
			const currentIndex = index++;
			const data = sequence.v[currentIndex];
			if (currentIndex === sequence.t) throw data;
			return {
				done: currentIndex === sequence.d,
				value: data
			};
		}
	};
	return instance;
};
const ASYNC_ITERATOR_CONSTRUCTOR = (symbol, createPromise) => (stream) => () => {
	let count = 0;
	let doneAt = -1;
	let isThrow = false;
	const buffer = [];
	const pending = [];
	const internal = { finalize(i = 0, len = pending.length) {
		for (; i < len; i++) pending[i].s({
			done: true,
			value: void 0
		});
	} };
	stream.on({
		next(value) {
			const temp = pending.shift();
			if (temp) temp.s({
				done: false,
				value
			});
			buffer.push(value);
		},
		throw(value) {
			const temp = pending.shift();
			if (temp) temp.f(value);
			internal.finalize();
			doneAt = buffer.length;
			isThrow = true;
			buffer.push(value);
		},
		return(value) {
			const temp = pending.shift();
			if (temp) temp.s({
				done: true,
				value
			});
			internal.finalize();
			doneAt = buffer.length;
			buffer.push(value);
		}
	});
	const instance = {
		[symbol]() {
			return instance;
		},
		next() {
			if (doneAt === -1) {
				const index = count++;
				if (index >= buffer.length) {
					const temp = createPromise();
					pending.push(temp);
					return temp.p;
				}
				return {
					done: false,
					value: buffer[index]
				};
			}
			if (count > doneAt) return {
				done: true,
				value: void 0
			};
			const index = count++;
			const value = buffer[index];
			if (index !== doneAt) return {
				done: false,
				value
			};
			if (isThrow) throw value;
			return {
				done: true,
				value
			};
		}
	};
	return instance;
};
const ARRAY_BUFFER_CONSTRUCTOR = (b64) => {
	const decoded = atob(b64);
	const length = decoded.length;
	const arr = new Uint8Array(length);
	for (let i = 0; i < length; i++) arr[i] = decoded.charCodeAt(i);
	return arr.buffer;
};

// Placeholders that are values of their own on the page: Map's sentinel and the helpers above, each set up once.
const SPECIAL = [{}, {}, {}, {}, {}, {}];
const SPECIAL_TEXT = ["[]", "" + PROMISE_CONSTRUCTOR, "" + PROMISE_SUCCESS, "" + PROMISE_FAILURE, "" + STREAM_CONSTRUCTOR, "" + ARRAY_BUFFER_CONSTRUCTOR];
const ITERATOR_TEXT = "" + ITERATOR_CONSTRUCTOR;
const ASYNC_ITERATOR_TEXT = "" + ASYNC_ITERATOR_CONSTRUCTOR;
const ITERATOR_KEY = {};
const ASYNC_ITERATOR_KEY = {};

// ---------------------------------------------------------------- strings

const JSON_SAFE = /[\x00-\x07\x0b\x0e-\x1f<\u2028\u2029\ud800-\udfff]/;
const ESCAPES = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\b": "\\b", "\t": "\\t", "\f": "\\f", "<": "\\x3C", "\u2028": "\\u2028", "\u2029": "\\u2029" };

/** A string's text inside double quotes, safe in a <script> (no `</script>`, no line separators). */
export function escapeString(str) {
  if (str.length >= 64 && !JSON_SAFE.test(str)) return JSON.stringify(str).slice(1, -1);
  let out = "";
  let last = 0;
  for (let i = 0; i < str.length; i++) {
    const e = ESCAPES[str[i]];
    if (e) {
      out += str.slice(last, i) + e;
      last = i + 1;
    }
  }
  return last === 0 ? str : out + str.slice(last);
}
const UNESCAPES = { "\\\\": "\\", '\\"': '"', "\\n": "\n", "\\r": "\r", "\\b": "\b", "\\t": "\t", "\\f": "\f", "\\x3C": "<", "\\u2028": "\u2028", "\\u2029": "\u2029" };
const unescapeString = (str) => (str.includes("\\") ? str.replace(/(\\\\|\\"|\\n|\\r|\\b|\\t|\\f|\\u2028|\\u2029|\\x3C)/g, (m) => UNESCAPES[m]) : str);

// ---------------------------------------------------------------- nodes

const node = (t, i, s, c, m, p, e, a, f, b, o, l) => ({ t, i, s, c, m, p, e, a, f, b, o, l });
const constant = (n) => node(T.CONSTANT, undefined, n);
const [NULL, UNDEFINED, TRUE, FALSE, NEG_ZERO, INF, NEG_INF, NAN] = [0, 1, 2, 3, 4, 5, 6, 7].map(constant);

const flagOf = (o) => (Object.isFrozen(o) ? 3 : Object.isSealed(o) ? 2 : Object.isExtensible(o) ? 0 : 1);

function numberNode(v) {
  if (v === Infinity) return INF;
  if (v === -Infinity) return NEG_INF;
  if (v !== v) return NAN;
  if (Object.is(v, -0)) return NEG_ZERO;
  return node(T.NUMBER, undefined, v);
}

class UnsupportedError extends Error {
  constructor(value) {
    super(`A value of type "${typeof value}" (${Object.prototype.toString.call(value)}) cannot be sent.`);
    this.value = value;
  }
}

// Seroval's errors, worded as it words them (a peer may match on them).
const objectToString = Object.prototype.toString;
const errorMessage = (type, cause) =>
  cause instanceof Error
    ? `Seroval caught an error during the ${type} process.

${cause.name}
${cause.message}

- For more information, please check the "cause" property of this error.
- If you believe this is an error in Seroval, please submit an issue at https://github.com/lxsmnsyc/seroval/issues/new`
    : `Seroval caught an error during the ${type} process.

"${objectToString.call(cause)}"

For more information, please check the "cause" property of this error.`;
export class SerovalError extends Error {
  constructor(type, cause) {
    super(errorMessage(type, cause));
    this.cause = cause;
  }
}
export class SerovalParserError extends SerovalError {
  constructor(cause) {
    super("parsing", cause);
  }
}
export class SerovalDeserializationError extends SerovalError {
  constructor(cause) {
    super("deserialization", cause);
  }
}
export class SerovalUnsupportedNodeError extends Error {
  constructor(n) {
    super('Unsupported node type "' + n.t + '".');
  }
}
export class SerovalMissingPluginError extends Error {
  constructor(tag) {
    super('Missing plugin for tag "' + tag + '".');
  }
}
export class SerovalMissingInstanceError extends Error {
  constructor(tag) {
    super('Missing "' + tag + '" instance.');
  }
}
export class SerovalMissingReferenceForIdError extends Error {
  constructor(id) {
    super('Missing reference for id "' + escapeString(id) + '"');
  }
}
export class SerovalUnknownTypedArrayError extends Error {
  constructor(name) {
    super('Unknown TypedArray "' + name + '"');
  }
}
export class SerovalMalformedNodeError extends Error {
  constructor(n) {
    super('Malformed node type "' + n.t + '".');
  }
}
export class SerovalDepthLimitError extends Error {
  constructor(limit) {
    super("Depth limit of " + limit + " reached");
  }
}

// ---------------------------------------------------------------- plugins

/** A plugin as seroval takes it (`tag`, `test`, `parse.sync|async|stream`, `serialize`, `deserialize`, `extends`). */
export const createPlugin = (plugin) => plugin;
/** Plugins with the ones they extend, each once, in order. */
export function resolvePlugins(plugins) {
  if (!plugins) return undefined;
  const out = new Set();
  const add = (list) => {
    for (const p of list) {
      if (out.has(p)) continue;
      out.add(p);
      if (p.extends) add(p.extends);
    }
  };
  add(plugins);
  return [...out];
}
/** A value the serializer does not see: `replacement` is written in its place. */
export class OpaqueReference {
  constructor(value, replacement) {
    this.value = value;
    this.replacement = replacement;
  }
}
/** Values both peers hold already, sent by id. */
const REFERENCE = new Map();
const INV_REFERENCE = new Map();
export function createReference(id, value) {
  REFERENCE.set(value, id);
  INV_REFERENCE.set(id, value);
  return value;
}
/** A stream as the serializer writes and reads them (`next`/`throw`/`return`, `on`). */
export const createStream = () => STREAM_CONSTRUCTOR();
export const isStream = (value) => STREAM in value;

function pluginNode(ctx, depth, id, v) {
  const plugins = ctx.plugins;
  if (!plugins) return undefined;
  for (const plugin of plugins) {
    const parse = ctx.stream ? plugin.parse.stream : plugin.parse.sync;
    if (parse && plugin.test(v)) return node(T.PLUGIN, id, parse(v, ctx.stream ? streamContext(ctx, depth) : { parse: (x) => toNode(ctx, depth, x) }, { id }), escapeString(plugin.tag));
  }
}
function streamContext(ctx, depth) {
  return {
    parse: (x) => toNode(ctx, depth, x),
    parseWithError: (x) => parseGuarded(ctx, depth, x),
    isAlive: () => ctx.alive,
    pushPendingState: () => void ctx.pending++,
    popPendingState: () => done(ctx),
    onParse: (n) => emit(ctx, n),
    onError: (e) => fail(ctx, e),
    addCleanup: (c) => void ctx.cleanups.push(c),
  };
}

// ---------------------------------------------------------------- values into nodes

/**
 * What turns values into nodes. `refs` (value → id) is shared by every value one Serializer writes, so a value met
 * again is a reference. `stream`: promises and async iterables are followed and their results parsed as they come.
 */
function parser(refs, features, stream, events) {
  return { refs, marked: new Set(), features, stream, alive: true, pending: 0, initial: true, buffer: [], cleanups: [], depthLimit: DEPTH_LIMIT, ...events };
}

/** An id for a value: a reference to its node if it has one (and it is then marked), else a new one. */
function indexed(ctx, v) {
  const id = ctx.refs.get(v);
  if (id != null) {
    ctx.marked.add(id);
    return { known: true, node: node(T.INDEXED, id) };
  }
  const next = ctx.refs.size;
  ctx.refs.set(v, next);
  return { known: false, id: next };
}

function symbolNode(ctx, s) {
  const r = indexed(ctx, s);
  if (r.known) return r.node;
  const at = wellKnownIndex(s);
  if (at < 0) throw new UnsupportedError(s);
  return node(T.WK_SYMBOL, r.id, at);
}
function specialNode(ctx, which) {
  const r = indexed(ctx, SPECIAL[which]);
  return r.known ? r.node : node(T.SPECIAL_REFERENCE, r.id, which);
}
function iteratorFactory(ctx) {
  const r = indexed(ctx, ITERATOR_KEY);
  return r.known ? r.node : node(T.ITERATOR_FACTORY, r.id, undefined, undefined, undefined, undefined, undefined, undefined, symbolNode(ctx, Symbol.iterator));
}
function asyncIteratorFactory(ctx) {
  const r = indexed(ctx, ASYNC_ITERATOR_KEY);
  return r.known ? r.node : node(T.ASYNC_ITERATOR_FACTORY, r.id, undefined, undefined, undefined, undefined, undefined, [specialNode(ctx, 1), symbolNode(ctx, Symbol.asyncIterator)]);
}

const SEQUENCE = "__SEROVAL_SEQUENCE__";
const STREAM = "__SEROVAL_STREAM__";
function sequenceOf(iterable) {
  const v = [];
  let t = -1;
  let d = -1;
  const it = iterable[Symbol.iterator]();
  for (;;) {
    try {
      const r = it.next();
      v.push(r.value);
      if (r.done) {
        d = v.length - 1;
        break;
      }
    } catch (e) {
      t = v.length;
      v.push(e);
    }
  }
  return { [SEQUENCE]: true, v, t, d };
}
const newStream = () => STREAM_CONSTRUCTOR();
function streamOf(iterable, cleanups) {
  const stream = newStream();
  const it = iterable[Symbol.asyncIterator]();
  let cancelled = false;
  let done = false;
  cleanups?.push(() => {
    if (done || cancelled) return;
    cancelled = true;
    Promise.resolve().then(() => it.return?.()).catch(() => {});
  });
  (async () => {
    try {
      while (!cancelled) {
        const r = await it.next();
        if (cancelled) return;
        if (r.done) {
          done = true;
          stream.return(r.value);
          break;
        }
        stream.next(r.value);
      }
    } catch (e) {
      done = true;
      if (!cancelled) stream.throw(e);
    }
  })().catch(() => {});
  return stream;
}

function properties(ctx, depth, o) {
  const k = [];
  const v = [];
  for (const [key, value] of Object.entries(o)) {
    k.push(escapeString(key));
    v.push(toNode(ctx, depth, value));
  }
  if (Symbol.iterator in o) {
    k.push(symbolNode(ctx, Symbol.iterator));
    v.push(node(T.ITERATOR_FACTORY_INSTANCE, undefined, undefined, undefined, undefined, undefined, undefined, [iteratorFactory(ctx), toNode(ctx, depth, sequenceOf(o))]));
  }
  if (Symbol.asyncIterator in o) {
    k.push(symbolNode(ctx, Symbol.asyncIterator));
    v.push(node(T.ASYNC_ITERATOR_FACTORY_INSTANCE, undefined, undefined, undefined, undefined, undefined, undefined, [asyncIteratorFactory(ctx), toNode(ctx, depth, ctx.stream ? streamOf(o, ctx.cleanups) : newStream())]));
  }
  if (Symbol.toStringTag in o) {
    k.push(symbolNode(ctx, Symbol.toStringTag));
    v.push(node(T.STRING, undefined, escapeString(o[Symbol.toStringTag])));
  }
  if (Symbol.isConcatSpreadable in o) {
    k.push(symbolNode(ctx, Symbol.isConcatSpreadable));
    v.push(o[Symbol.isConcatSpreadable] ? TRUE : FALSE);
  }
  return { k, v };
}

/** An error's own place properties in JavaScriptCore (Bun, Safari). */
const ENGINE_PLACES = new Set(["line", "column", "sourceURL", "originalLine", "originalColumn"]);
function errorOptions(e, features) {
  const named = ERROR_NAMES[errorIndex(e)];
  let options = e.name !== named ? { name: e.name } : e.constructor.name !== named ? { name: e.constructor.name } : {};
  for (const name of Object.getOwnPropertyNames(e)) {
    if (name === "name" || name === "message") continue;
    // (Where the stack is not sent, neither are the places some engines keep on the error: line, column, file.)
    if ((name === "stack" || ENGINE_PLACES.has(name)) && !(features & Feature.ErrorPrototypeStack)) continue;
    options[name] = e[name];
  }
  return options;
}
function errorIndex(e) {
  for (let i = ERRORS.length - 1; i > 0; i--) if (e instanceof ERRORS[i]) return i;
  return 0;
}
function errorNode(ctx, depth, id, e, aggregate) {
  const options = errorOptions(e, ctx.features);
  return node(aggregate ? T.AGGREGATE_ERROR : T.ERROR, id, errorIndex(e), undefined, escapeString(e.message), options ? properties(ctx, depth, options) : undefined);
}

function base64(buffer) {
  if (typeof Buffer !== "undefined") return Buffer.from(buffer).toString("base64");
  const bytes = new Uint8Array(buffer);
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function promiseNode(ctx, depth, id, p) {
  const resolver = indexed(ctx, {}).id;
  if (ctx.stream) {
    ctx.pending++;
    p.then(
      (data) => {
        if (!ctx.alive) return;
        const parsed = parseGuarded(ctx, depth, data);
        if (parsed) emit(ctx, node(T.PROMISE_SUCCESS, resolver, undefined, undefined, undefined, undefined, undefined, [specialNode(ctx, 2), parsed]));
        done(ctx);
      },
      (data) => {
        if (ctx.alive) {
          const parsed = parseGuarded(ctx, depth, data);
          if (parsed) emit(ctx, node(T.PROMISE_FAILURE, resolver, undefined, undefined, undefined, undefined, undefined, [specialNode(ctx, 3), parsed]));
        }
        done(ctx);
      },
    );
  } else if (ctx.noPromises) throw new UnsupportedError(p);
  return node(T.PROMISE_CONSTRUCTOR, id, resolver, undefined, undefined, undefined, undefined, undefined, specialNode(ctx, 1));
}

function streamNode(ctx, depth, id, stream) {
  const result = node(T.STREAM_CONSTRUCTOR, id, undefined, undefined, undefined, undefined, undefined, [], specialNode(ctx, 4));
  if (!ctx.stream) return result;
  ctx.pending++;
  const step = (type, last) => (value) => {
    if (ctx.alive) {
      const parsed = parseGuarded(ctx, depth, value);
      if (parsed) emit(ctx, node(type, id, undefined, undefined, undefined, undefined, undefined, undefined, parsed));
    }
    if (last) done(ctx);
  };
  stream.on({ next: step(T.STREAM_NEXT, false), throw: step(T.STREAM_THROW, true), return: step(T.STREAM_RETURN, true) });
  return result;
}

function objectNode(ctx, depth, id, o) {
  if (Array.isArray(o)) {
    const items = [];
    for (let i = 0; i < o.length; i++) items[i] = i in o ? toNode(ctx, depth, o[i]) : 0;
    return node(T.ARRAY, id, undefined, undefined, undefined, undefined, undefined, items, undefined, undefined, flagOf(o));
  }
  if (STREAM in o) return streamNode(ctx, depth, id, o);
  if (SEQUENCE in o) {
    const items = o.v.map((x) => toNode(ctx, depth, x));
    return node(T.SEQUENCE, id, o.t, undefined, undefined, undefined, undefined, items, undefined, undefined, undefined, o.d);
  }
  let kind = o.constructor;
  if (kind !== undefined && typeof kind !== "function") {
    const proto = Object.getPrototypeOf(o);
    kind = proto === null ? undefined : proto.constructor;
  }
  if (kind === OpaqueReference) return toNode(ctx, depth, o.replacement);
  const plugged = pluginNode(ctx, depth, id, o);
  if (plugged) return plugged;
  switch (kind) {
    case Object:
    case undefined:
      return node(kind ? T.OBJECT : T.NULL_OBJECT, id, undefined, undefined, undefined, properties(ctx, depth, o), undefined, undefined, undefined, undefined, flagOf(o));
    case Date: {
      const time = o.valueOf();
      return node(T.DATE, id, time !== time ? "" : o.toISOString());
    }
    case Error:
    case EvalError:
    case RangeError:
    case ReferenceError:
    case SyntaxError:
    case TypeError:
    case URIError:
      return errorNode(ctx, depth, id, o, false);
    case Number:
    case Boolean:
    case String:
    case BigInt:
      return node(T.BOXED, id, undefined, undefined, undefined, undefined, undefined, undefined, toNode(ctx, depth, o.valueOf()));
    case ArrayBuffer:
      return node(T.ARRAY_BUFFER, id, base64(o), undefined, undefined, undefined, undefined, undefined, specialNode(ctx, 5));
    case DataView:
      if (o.byteLength > MAX_TYPED_ARRAY_LENGTH) throw new UnsupportedError(o);
      return node(T.DATA_VIEW, id, undefined, undefined, undefined, undefined, undefined, undefined, toNode(ctx, depth, o.buffer), o.byteOffset, undefined, o.byteLength);
    case Map: {
      const k = [];
      const v = [];
      for (const [key, value] of o.entries()) {
        k.push(toNode(ctx, depth, key));
        v.push(toNode(ctx, depth, value));
      }
      return node(T.MAP, id, undefined, undefined, undefined, undefined, { k, v }, undefined, specialNode(ctx, 0));
    }
    case Set: {
      const items = [];
      for (const item of o.keys()) items.push(toNode(ctx, depth, item));
      return node(T.SET, id, undefined, undefined, undefined, undefined, undefined, items);
    }
  }
  if (kind && TYPED_ARRAYS[kind.name] === kind) {
    const big = kind.name.startsWith("Big");
    if (big && !(ctx.features & Feature.BigIntTypedArray)) throw new UnsupportedError(o);
    if (o.length > MAX_TYPED_ARRAY_LENGTH) throw new UnsupportedError(o);
    return node(big ? T.BIGINT_TYPED_ARRAY : T.TYPED_ARRAY, id, undefined, kind.name, undefined, undefined, undefined, undefined, toNode(ctx, depth, o.buffer), o.byteOffset, undefined, o.length);
  }
  if (kind === Promise || o instanceof Promise) return promiseNode(ctx, depth, id, o);
  if (ctx.features & Feature.RegExp && kind === RegExp) return node(T.REGEXP, id, undefined, escapeString(o.source), o.flags);
  if (ctx.features & Feature.AggregateError && typeof AggregateError !== "undefined" && (kind === AggregateError || o instanceof AggregateError)) return errorNode(ctx, depth, id, o, true);
  if (o instanceof Error) return errorNode(ctx, depth, id, o, false);
  if (Symbol.iterator in o || Symbol.asyncIterator in o) return node(kind ? T.NULL_OBJECT : T.OBJECT, id, undefined, undefined, undefined, properties(ctx, depth, o), undefined, undefined, undefined, undefined, flagOf(o));
  throw new UnsupportedError(o);
}

function toNode(ctx, depth, v) {
  if (depth >= ctx.depthLimit) throw new SerovalDepthLimitError(ctx.depthLimit);
  switch (typeof v) {
    case "boolean":
      return v ? TRUE : FALSE;
    case "undefined":
      return UNDEFINED;
    case "string":
      return node(T.STRING, undefined, escapeString(v));
    case "number":
      return numberNode(v);
    case "bigint":
      return node(T.BIGINT, undefined, "" + v);
    case "object": {
      if (!v) return NULL;
      const r = indexed(ctx, v);
      return r.known ? r.node : objectNode(ctx, depth + 1, r.id, v);
    }
    case "symbol":
      return symbolNode(ctx, v);
    case "function": {
      const r = indexed(ctx, v);
      if (r.known) return r.node;
      const plugged = pluginNode(ctx, depth, r.id, v);
      if (plugged) return plugged;
      throw new UnsupportedError(v);
    }
    default:
      throw new UnsupportedError(v);
  }
}

// A stream's later parts: held while the first is still being handed over, then given as they come.
function parseGuarded(ctx, depth, v) {
  try {
    return toNode(ctx, depth, v);
  } catch (e) {
    fail(ctx, e);
  }
}
function emit(ctx, n) {
  if (ctx.initial) ctx.buffer.push(n);
  else deliver(ctx, n, false);
}
function deliver(ctx, n, initial) {
  try {
    ctx.onParse(n, initial);
  } catch (e) {
    fail(ctx, e);
  }
}
function fail(ctx, e) {
  if (ctx.onError) ctx.onError(e);
  else throw e;
}
function finish(ctx) {
  ctx.onDone?.();
  for (const c of ctx.cleanups) c();
}
function done(ctx) {
  if (--ctx.pending <= 0) finish(ctx);
}
function startStream(ctx, value) {
  const parsed = parseGuarded(ctx, 0, value);
  if (!parsed) return;
  deliver(ctx, parsed, true);
  ctx.initial = false;
  for (const n of ctx.buffer) deliver(ctx, n, false);
  if (ctx.pending <= 0) stopStream(ctx);
}
function stopStream(ctx) {
  if (!ctx.alive) return;
  finish(ctx);
  ctx.alive = false;
}

// ---------------------------------------------------------------- nodes into script

const IDENTIFIER = /^[$A-Z_][0-9A-Z_$]*$/i;
const isIdentifier = (name) => IDENTIFIER.test(name);
const isSafeKey = (key) =>
  !["constructor", "__proto__", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"].includes(key);

const arrow = (params, body) => (params.length === 1 ? params[0] : "(" + params.join(",") + ")") + "=>" + (body.startsWith("{") ? "(" + body + ")" : body);
const arrowBlock = (params, body) => (params.length === 1 ? params[0] : "(" + params.join(",") + ")") + "=>{" + body + "}";

const ref = (id) => "$R[" + id + "]";

function writer(features, marked, scopeId, plugins) {
  return { features, marked: new Set(marked), scopeId, plugins, stack: [], flags: [], assignments: [] };
}
function pluginText(w, n) {
  if (w.plugins)
    for (const plugin of w.plugins) if (plugin.tag === n.c) return plugin.serialize(n.s, (w.child ??= { serialize: (x) => write(w, x) }), { id: n.i });
  throw new SerovalMissingPluginError(n.c);
}

const inStack = (w, n) => n.t === T.INDEXED && w.stack.includes(n.i);
const assign = (id, value) => ref(id) + "=" + value;

function assignmentText(a) {
  switch (a.t) {
    case 0:
      return a.s + "=" + a.v;
    case 1:
      return a.s + ".add(" + a.v + ")";
    case 2:
      return a.s + ".set(" + a.k + "," + a.v + ")";
    case 3:
      return a.s + ".delete(" + a.k + ")";
    case 4:
      return "Object.defineProperty(" + a.s + ',"__proto__",{value:' + a.k + ",configurable:!0,enumerable:!0,writable:!0})";
  }
}
// Chained: `a=b=v`, `x.set(..).set(..)`.
function merged(list) {
  const out = [];
  let current = list[0];
  let prev = current;
  for (let i = 1; i < list.length; i++) {
    const item = list[i];
    if (item.t === 0 && item.v === prev.v) current = { t: 0, s: item.s, v: assignmentText(current) };
    else if ((item.t === 1 || item.t === 2 || item.t === 3) && item.s === prev.s) current = { t: item.t, s: assignmentText(current), k: item.k, v: item.v };
    else {
      out.push(current);
      current = item;
    }
    prev = item;
  }
  out.push(current);
  return out;
}
function assignmentsText(list) {
  if (!list.length) return undefined;
  let out = "";
  for (const a of merged(list)) out += assignmentText(a) + ",";
  return out;
}
function patches(w) {
  const a = assignmentsText(w.assignments);
  let f = "";
  for (const flag of w.flags) f += FLAG_TEXT[flag.type] + "(" + flag.value + "),";
  return a ? (f ? a + f : a) : f;
}
function pushFlag(w, flag, id) {
  if (flag === 0) return;
  w.marked.add(id);
  w.flags.push({ type: flag, value: ref(id) });
}
const keyAssign = (w, id, key, value) => {
  if (!isSafeKey(key)) w.assignments.push({ t: 4, s: ref(id), k: value });
  else w.assignments.push({ t: 0, s: ref(id) + "." + key, v: value });
};
const indexAssign = (w, id, index, value) => w.assignments.push({ t: 0, s: ref(id) + "[" + index + "]", v: value });

function arrayText(w, n) {
  const list = n.a;
  if (!list.length) return "[]";
  w.stack.push(n.i);
  let values = "";
  let holey = false;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    let text = "";
    if (item) {
      if (inStack(w, item)) {
        w.marked.add(n.i);
        indexAssign(w, n.i, i, ref(item.i));
      } else text = write(w, item);
    }
    values += (i ? "," : "") + text;
    holey = text === "";
  }
  w.stack.pop();
  pushFlag(w, n.o, n.i);
  return "[" + values + (holey ? ",]" : "]");
}

function propertyText(w, source, key, val) {
  if (typeof key !== "string") return "[" + write(w, key) + "]:" + write(w, val);
  const num = Number(key);
  const plain = (num >= 0 && num.toString() === key) || isIdentifier(key);
  if (inStack(w, val)) {
    const r = ref(val.i);
    w.marked.add(source.i);
    if (plain && num !== num) keyAssign(w, source.i, key, r);
    else indexAssign(w, source.i, plain ? key : '"' + key + '"', r);
    return "";
  }
  if (isSafeKey(key)) return (plain ? key : '"' + key + '"') + ":" + write(w, val);
  return '["' + key + '"]:' + write(w, val);
}
function propertiesText(w, source, record) {
  const keys = record.k;
  if (!keys.length) return "{}";
  w.stack.push(source.i);
  let out = propertyText(w, source, keys[0], record.v[0]);
  for (let i = 1; i < keys.length; i++) {
    const item = propertyText(w, source, keys[i], record.v[i]);
    out += (item && out && ",") + item;
  }
  w.stack.pop();
  return "{" + out + "}";
}

function keyedAssignment(w, source, main, key, value) {
  if (typeof key !== "string") {
    const outer = w.stack;
    w.stack = [];
    const text = write(w, value);
    w.stack = outer;
    const parent = w.assignments;
    w.assignments = main;
    indexAssign(w, source.i, write(w, key), text);
    w.assignments = parent;
    return;
  }
  const text = write(w, value);
  const num = Number(key);
  const plain = (num >= 0 && num.toString() === key) || isIdentifier(key);
  const put = () => {
    if (plain && num !== num) keyAssign(w, source.i, key, text);
    else indexAssign(w, source.i, plain ? key : '"' + key + '"', text);
  };
  if (inStack(w, value)) put();
  else {
    const parent = w.assignments;
    w.assignments = main;
    put();
    w.assignments = parent;
  }
}
function dictionaryText(w, n, init) {
  if (!n.p) return init;
  if (w.features & Feature.ObjectAssign) {
    const fields = propertiesText(w, n, n.p);
    return fields !== "{}" ? "Object.assign(" + init + "," + fields + ")" : init;
  }
  w.marked.add(n.i);
  const keys = n.p.k;
  if (!keys.length) return init;
  const main = [];
  w.stack.push(n.i);
  for (let i = 0; i < keys.length; i++) keyedAssignment(w, n, main, keys[i], n.p.v[i]);
  w.stack.pop();
  const assignments = assignmentsText(main);
  return assignments ? "(" + assign(n.i, init) + "," + assignments + ref(n.i) + ")" : init;
}

function setText(w, n) {
  let out = "new Set";
  if (n.a.length) {
    w.stack.push(n.i);
    let items = "";
    for (const item of n.a) {
      let text;
      if (inStack(w, item)) {
        w.marked.add(n.i);
        w.assignments.push({ t: 1, s: ref(n.i), v: ref(item.i) });
        text = "";
      } else text = write(w, item);
      items += (text && items && ",") + text;
    }
    w.stack.pop();
    if (items) out += "([" + items + "])";
  }
  return out;
}

function mapEntryText(w, id, key, val, sentinel) {
  const setAssign = (k, v) => w.assignments.push({ t: 2, s: ref(id), k, v });
  if (inStack(w, key)) {
    const keyRef = ref(key.i);
    w.marked.add(id);
    if (inStack(w, val)) {
      setAssign(keyRef, ref(val.i));
      return "";
    }
    if (val.t !== T.INDEXED && val.i != null && w.marked.has(val.i)) {
      const text = "(" + write(w, val) + ",[" + sentinel + "," + sentinel + "])";
      setAssign(keyRef, ref(val.i));
      w.assignments.push({ t: 3, s: ref(id), k: sentinel });
      return text;
    }
    const outer = w.stack;
    w.stack = [];
    setAssign(keyRef, write(w, val));
    w.stack = outer;
    return "";
  }
  if (inStack(w, val)) {
    const valRef = ref(val.i);
    w.marked.add(id);
    if (key.t !== T.INDEXED && key.i != null && w.marked.has(key.i)) {
      const text = "(" + write(w, key) + ",[" + sentinel + "," + sentinel + "])";
      setAssign(ref(key.i), valRef);
      w.assignments.push({ t: 3, s: ref(id), k: sentinel });
      return text;
    }
    const outer = w.stack;
    w.stack = [];
    setAssign(write(w, key), valRef);
    w.stack = outer;
    return "";
  }
  return "[" + write(w, key) + "," + write(w, val) + "]";
}
function mapText(w, n) {
  let out = "new Map";
  const sentinel = n.f;
  const sentinelRef = ref(sentinel.i);
  const keys = n.e.k;
  if (keys.length) {
    w.stack.push(n.i);
    let items = "";
    for (let i = 0; i < keys.length; i++) {
      const text = mapEntryText(w, n.i, keys[i], n.e.v[i], sentinelRef);
      items += (text && items && ",") + text;
    }
    w.stack.pop();
    if (items) out += "([" + items + "])";
  }
  if (sentinel.t === T.SPECIAL_REFERENCE) {
    w.marked.add(sentinel.i);
    out = "(" + write(w, sentinel) + "," + out + ")";
  }
  return out;
}

const constructorText = (w, n) => (n.t === T.INDEXED ? write(w, n) : "(" + write(w, n) + ")");

function promiseText(w, n) {
  const make = n.s ? "Promise.resolve" : "Promise.reject";
  if (inStack(w, n.f)) {
    const r = ref(n.f.i);
    return make + (n.s ? "().then(" + arrow([], r) + ")" : "().catch(" + arrowBlock([], "throw " + r) + ")");
  }
  w.stack.push(n.i);
  const result = write(w, n.f);
  w.stack.pop();
  return make + "(" + result + ")";
}

function sequenceText(w, n) {
  if (n.a.length) {
    w.stack.push(n.i);
    let items = "";
    n.a.forEach((item, i) => {
      let text;
      if (inStack(w, item)) {
        w.marked.add(n.i);
        w.assignments.push({ t: 0, s: ref(n.i) + ".v[" + i + "]", v: ref(item.i) });
        text = "";
      } else text = write(w, item);
      items += (text && items && ",") + text;
    });
    w.stack.pop();
    if (items) return "{__SEROVAL_SEQUENCE__:!0,v:[" + items + "],t:" + n.s + ",d:" + n.l + "}";
  }
  return "{__SEROVAL_SEQUENCE__:!0,v:[],t:-1,d:0}";
}

function assignableText(w, n) {
  switch (n.t) {
    case T.WK_SYMBOL:
      return WELL_KNOWN_TEXT[n.s];
    case T.ARRAY:
      return arrayText(w, n);
    case T.OBJECT:
      pushFlag(w, n.o, n.i);
      return propertiesText(w, n, n.p);
    case T.NULL_OBJECT:
      pushFlag(w, n.o, n.i);
      return dictionaryText(w, n, "Object.create(null)");
    case T.DATE:
      return 'new Date("' + n.s + '")';
    case T.SET:
      return setText(w, n);
    case T.MAP:
      return mapText(w, n);
    case T.ARRAY_BUFFER:
      return constructorText(w, n.f) + '("' + n.s + '")';
    case T.TYPED_ARRAY:
    case T.BIGINT_TYPED_ARRAY:
      return "new " + n.c + "(" + write(w, n.f) + "," + n.b + "," + n.l + ")";
    case T.DATA_VIEW:
      return "new DataView(" + write(w, n.f) + "," + n.b + "," + n.l + ")";
    case T.AGGREGATE_ERROR: {
      w.stack.push(n.i);
      const text = dictionaryText(w, n, 'new AggregateError([],"' + n.m + '")');
      w.stack.pop();
      return text;
    }
    case T.ERROR:
      return dictionaryText(w, n, "new " + ERROR_NAMES[n.s] + '("' + n.m + '")');
    case T.PROMISE:
      return promiseText(w, n);
    case T.BOXED:
      return "Object(" + write(w, n.f) + ")";
    case T.PROMISE_CONSTRUCTOR:
      return "(" + assign(n.s, constructorText(w, n.f) + "()") + ").p";
    case T.SPECIAL_REFERENCE:
      return SPECIAL_TEXT[n.s];
    case T.SEQUENCE:
      return sequenceText(w, n);
    case T.PLUGIN:
      return pluginText(w, n);
    case T.REGEXP:
      if (w.features & Feature.RegExp) return "/" + unescapeString(n.c) + "/" + n.m;
      throw new SerovalUnsupportedNodeError(n);
  }
  throw new Error('Unsupported node type "' + n.t + '".');
}

function write(w, n) {
  switch (n.t) {
    case T.CONSTANT:
      return CONSTANT_TEXT[n.s];
    case T.NUMBER:
      return "" + n.s;
    case T.STRING:
      return '"' + n.s + '"';
    case T.BIGINT:
      return n.s + "n";
    case T.INDEXED:
      return ref(n.i);
    case T.PROMISE_SUCCESS:
    case T.PROMISE_FAILURE:
      return constructorText(w, n.a[0]) + "(" + ref(n.i) + "," + write(w, n.a[1]) + ")";
    case T.ITERATOR_FACTORY: {
      let out = "";
      const open = n.f.t !== T.INDEXED;
      if (open) {
        w.marked.add(n.f.i);
        out = "(" + write(w, n.f) + ",";
      }
      out += assign(n.i, "(" + ITERATOR_TEXT + ")(" + ref(n.f.i) + ")");
      return open ? out + ")" : out;
    }
    case T.ITERATOR_FACTORY_INSTANCE:
    case T.ASYNC_ITERATOR_FACTORY_INSTANCE:
      return constructorText(w, n.a[0]) + "(" + write(w, n.a[1]) + ")";
    case T.ASYNC_ITERATOR_FACTORY: {
      const [promise, symbol] = n.a;
      let out = "";
      if (promise.t !== T.INDEXED) {
        w.marked.add(promise.i);
        out += "(" + write(w, promise);
      }
      if (symbol.t !== T.INDEXED) {
        w.marked.add(symbol.i);
        out += (out ? "," : "(") + write(w, symbol);
      }
      if (out) out += ",";
      const it = assign(n.i, "(" + ASYNC_ITERATOR_TEXT + ")(" + ref(symbol.i) + "," + ref(promise.i) + ")");
      return out ? out + it + ")" : it;
    }
    case T.STREAM_CONSTRUCTOR: {
      const made = assign(n.i, constructorText(w, n.f) + "()");
      if (!n.a.length) return made;
      return "(" + made + "," + n.a.map((x) => write(w, x)).join(",") + "," + ref(n.i) + ")";
    }
    case T.STREAM_NEXT:
      return ref(n.i) + ".next(" + write(w, n.f) + ")";
    case T.STREAM_THROW:
      return ref(n.i) + ".throw(" + write(w, n.f) + ")";
    case T.STREAM_RETURN:
      return ref(n.i) + ".return(" + write(w, n.f) + ")";
  }
  return assign(n.i, assignableText(w, n));
}

function topText(w, tree) {
  const result = write(w, tree);
  if (tree.i == null) return result;
  const p = patches(w);
  const body = p ? "(" + result + "," + p + ref(tree.i) + ")" : result;
  if (w.scopeId == null) return tree.t === T.OBJECT && !p ? "(" + body + ")" : body;
  return "(" + arrow(["$R"], body) + ')($R["' + escapeString(w.scopeId) + '"])';
}

// ---------------------------------------------------------------- the page's form: Serializer

/** The script that sets up a render scope's references (`self.$R`), ahead of its values. */
export function crossHeader(scopeId) {
  return scopeId == null ? "self.$R=self.$R||[]" : '(self.$R=self.$R||{})["' + escapeString(scopeId) + '"]=[]';
}

/**
 * Values written by key into `globalIdentifier` as script, given to `onData` piece by piece: each value at once, what
 * it waits for (promises, async iterables) as it lands. `onDone` once everything written has landed and `flush()`
 * was called.
 */
export class Serializer {
  constructor(options) {
    this.options = options;
    this.alive = true;
    this.flushed = false;
    this.done = false;
    this.pending = 0;
    this.cleanups = [];
    this.refs = new Map();
    this.keys = new Set();
    this.ids = 0;
  }
  write(key, value) {
    if (!this.alive || this.flushed) return;
    this.pending++;
    this.keys.add(key);
    const o = this.options;
    const features = ALL ^ (o.disabledFeatures || 0);
    const plugins = (this.plugins ??= resolvePlugins(o.plugins));
    const ctx = parser(this.refs, features, true, {
      plugins,
      onParse: (n, initial) => {
        let text;
        try {
          text = topText(writer(features, ctx.marked, o.scopeId, plugins), n);
        } catch (e) {
          o.onError?.(e);
          return;
        }
        if (this.alive) o.onData(initial ? o.globalIdentifier + '["' + escapeString(key) + '"]=' + text : text);
      },
      onError: o.onError,
      onDone: () => {
        if (!this.alive) return;
        this.pending--;
        if (this.pending <= 0 && this.flushed && !this.done && o.onDone) {
          o.onDone();
          this.done = true;
        }
      },
    });
    startStream(ctx, value);
    this.cleanups.push(() => stopStream(ctx));
  }
  getNextID() {
    while (this.keys.has("" + this.ids)) this.ids++;
    return "" + this.ids;
  }
  push(value) {
    const id = this.getNextID();
    this.write(id, value);
    return id;
  }
  flush() {
    if (!this.alive) return;
    this.flushed = true;
    if (this.pending <= 0 && !this.done && this.options.onDone) {
      this.options.onDone();
      this.done = true;
    }
  }
  close() {
    if (!this.alive) return;
    for (const c of this.cleanups) c();
    if (!this.done && this.options.onDone) {
      this.options.onDone();
      this.done = true;
    }
    this.alive = false;
  }
}

// ---------------------------------------------------------------- the cross JSON stream

/**
 * `source` as node trees given to `onParse(node, initial)`: the value first, then what it waits for as it lands
 * (seroval's toCrossJSONStream). `refs` shares a reference space across calls. Returns what stops it.
 */
export function toCrossJSONStream(source, options) {
  const ctx = parser(options.refs || new Map(), ALL ^ (options.disabledFeatures || 0), true, {
    plugins: resolvePlugins(options.plugins),
    depthLimit: options.depthLimit || DEPTH_LIMIT,
    onParse: options.onParse,
    onError: options.onError,
    onDone: options.onDone,
  });
  startStream(ctx, source);
  return () => stopStream(ctx);
}

/** A node tree from `toCrossJSONStream` as a value; `refs` shared by every tree of one stream (seroval's fromCrossJSON). */
export function fromCrossJSON(source, options) {
  const refs = options.refs || new Map();
  if (!("types" in refs)) Object.assign(refs, { types: new Map() });
  const maxBase64Length = options.maxBase64Length ?? MAX_BASE64_LENGTH;
  if (!Number.isSafeInteger(maxBase64Length) || maxBase64Length < 0) throw new RangeError("maxBase64Length must be a non-negative safe integer");
  const ctx = {
    refs,
    plugins: resolvePlugins(options.plugins),
    features: options.features ?? ALL ^ (options.disabledFeatures || 0),
    depthLimit: options.depthLimit || DEPTH_LIMIT,
    maxBase64Length,
  };
  try {
    return reviveCross(ctx, 0, source);
  } catch (error) {
    throw new SerovalDeserializationError(error);
  }
}

const CONSTANTS = { 0: null, 1: undefined, 2: true, 3: false, 4: -0, 5: Infinity, 6: -Infinity, 7: NaN };
const knownValue = (n, record, key) => {
  if (Object.hasOwn(record, key)) return record[key];
  throw new SerovalMalformedNodeError(n);
};
const isThenable = (v) => !!v && typeof v === "object" && "then" in v && typeof v.then === "function";
const VALID_SYMBOLS = [Symbol.asyncIterator, Symbol.isConcatSpreadable, Symbol.toStringTag, Symbol.iterator];
const createIterator = ITERATOR_CONSTRUCTOR(Symbol.iterator);
const createAsyncIterable = ASYNC_ITERATOR_CONSTRUCTOR(Symbol.asyncIterator, PROMISE_CONSTRUCTOR);
function crossPut(ctx, id, value) {
  if (id < 0 || !Number.isFinite(id) || !Number.isInteger(id)) throw new SerovalMalformedNodeError({ t: T.INDEXED, i: id });
  if (ctx.refs.has(id)) throw new Error("Conflicted ref id: " + id);
  ctx.refs.set(id, value);
  return value;
}
function checkType(ctx, n, id, type) {
  if (ctx.refs.types.get(id) !== type) throw new SerovalMalformedNodeError(n);
}
function crossProperty(ctx, depth, o, key, value) {
  const set = (name, v) => (isSafeKey(name) ? (o[name] = v) : Object.defineProperty(o, name, { value: v, configurable: true, enumerable: true, writable: true }));
  if (typeof key === "string") return void set(unescapeString(key), reviveCross(ctx, depth, value));
  const actual = reviveCross(ctx, depth, key);
  if (typeof actual === "string") set(actual, reviveCross(ctx, depth, value));
  else if (typeof actual === "symbol") {
    if (VALID_SYMBOLS.includes(actual)) o[actual] = reviveCross(ctx, depth, value);
  } else throw new SerovalMalformedNodeError(key);
}
function crossProperties(ctx, depth, p, o) {
  for (let i = 0; i < p.k.length; i++) crossProperty(ctx, depth, o, p.k[i], p.v[i]);
  return o;
}
function crossDictionary(ctx, depth, n, o) {
  if (n.p) Object.defineProperties(o, Object.getOwnPropertyDescriptors(crossProperties(ctx, depth, n.p, {})));
  return o;
}
function crossSettle(ctx, depth, n, success) {
  const deferred = ctx.refs.get(n.i);
  if (!deferred) throw new SerovalMissingInstanceError("Promise");
  checkType(ctx, n, n.i, T.PROMISE_CONSTRUCTOR);
  const value = reviveCross(ctx, depth, n.a[1]);
  if (isThenable(value)) throw new SerovalMalformedNodeError(n.a[1]);
  success ? deferred.s(value) : deferred.f(value);
}
function crossStep(ctx, depth, n, step) {
  const stream = ctx.refs.get(n.i);
  if (!stream) throw new SerovalMissingInstanceError("Stream");
  checkType(ctx, n, n.i, T.STREAM_CONSTRUCTOR);
  stream[step](reviveCross(ctx, depth, n.f));
}
function crossArrayBuffer(ctx, n) {
  if (typeof n.s !== "string") throw new SerovalMalformedNodeError(n);
  if (n.s.length > ctx.maxBase64Length) throw new RangeError("ArrayBuffer exceeds maxBase64Length (" + ctx.maxBase64Length + ")");
  return crossPut(ctx, n.i, ARRAY_BUFFER_CONSTRUCTOR(unescapeString(n.s)));
}
function crossView(ctx, depth, n, Kind) {
  const buffer = reviveCross(ctx, depth, n.f);
  if (!(buffer instanceof ArrayBuffer)) throw new SerovalMalformedNodeError(n);
  const offset = n.b ?? 0;
  if (offset < 0 || offset > buffer.byteLength) throw new SerovalMalformedNodeError(n);
  return crossPut(ctx, n.i, new Kind(buffer, offset, n.l));
}
function reviveCross(ctx, depth, n) {
  if (depth > ctx.depthLimit) throw new SerovalDepthLimitError(ctx.depthLimit);
  depth += 1;
  switch (n.t) {
    case T.CONSTANT:
      return knownValue(n, CONSTANTS, n.s);
    case T.NUMBER:
      return Number(n.s);
    case T.STRING:
      return unescapeString(String(n.s));
    case T.BIGINT:
      if (String(n.s).length > MAX_BIGINT_LENGTH) throw new SerovalMalformedNodeError(n);
      return BigInt(n.s);
    case T.INDEXED:
      return ctx.refs.get(n.i);
    case T.REFERENCE: {
      const id = unescapeString(n.s);
      if (!INV_REFERENCE.has(id)) throw new SerovalMissingReferenceForIdError(id);
      return crossPut(ctx, n.i, INV_REFERENCE.get(id));
    }
    case T.ARRAY: {
      const out = crossPut(ctx, n.i, new Array(n.a.length));
      for (let i = 0; i < n.a.length; i++) if (n.a[i]) out[i] = reviveCross(ctx, depth, n.a[i]);
      return flag(out, n.o);
    }
    case T.OBJECT:
    case T.NULL_OBJECT:
      return flag(crossProperties(ctx, depth, n.p, crossPut(ctx, n.i, n.t === T.OBJECT ? {} : Object.create(null))), n.o);
    case T.DATE:
      return crossPut(ctx, n.i, new Date(n.s));
    case T.REGEXP: {
      if (!(ctx.features & Feature.RegExp)) throw new SerovalUnsupportedNodeError(n);
      const source = unescapeString(n.c);
      if (source.length > 2e4) throw new SerovalMalformedNodeError(n);
      return crossPut(ctx, n.i, new RegExp(source, n.m));
    }
    case T.SET: {
      const out = crossPut(ctx, n.i, new Set());
      for (const item of n.a) out.add(reviveCross(ctx, depth, item));
      return out;
    }
    case T.MAP: {
      const out = crossPut(ctx, n.i, new Map());
      for (let i = 0; i < n.e.k.length; i++) out.set(reviveCross(ctx, depth, n.e.k[i]), reviveCross(ctx, depth, n.e.v[i]));
      return out;
    }
    case T.ARRAY_BUFFER:
      return crossArrayBuffer(ctx, n);
    case T.TYPED_ARRAY:
    case T.BIGINT_TYPED_ARRAY: {
      if (!Object.hasOwn(TYPED_ARRAYS, n.c)) throw new SerovalUnknownTypedArrayError(n.c);
      return crossView(ctx, depth, n, TYPED_ARRAYS[n.c]);
    }
    case T.DATA_VIEW:
      return crossView(ctx, depth, n, DataView);
    case T.AGGREGATE_ERROR:
      return crossDictionary(ctx, depth, n, crossPut(ctx, n.i, new AggregateError([], unescapeString(n.m))));
    case T.ERROR: {
      const Kind = knownValue(n, ERRORS, n.s);
      return crossDictionary(ctx, depth, n, crossPut(ctx, n.i, new Kind(unescapeString(n.m))));
    }
    case T.PROMISE: {
      const deferred = PROMISE_CONSTRUCTOR();
      const out = crossPut(ctx, n.i, deferred.p);
      const value = reviveCross(ctx, depth, n.f);
      if (isThenable(value)) throw new SerovalMalformedNodeError(n.f);
      n.s ? deferred.s(value) : deferred.f(value);
      return out;
    }
    case T.WK_SYMBOL:
      return knownValue(n, WELL_KNOWN, n.s);
    case T.BOXED:
      return crossPut(ctx, n.i, Object(reviveCross(ctx, depth, n.f)));
    case T.PLUGIN: {
      const tag = unescapeString(n.c);
      if (ctx.plugins)
        for (const plugin of ctx.plugins) if (plugin.tag === tag) return crossPut(ctx, n.i, plugin.deserialize(n.s, { deserialize: (x) => reviveCross(ctx, depth, x) }, { id: n.i }));
      throw new SerovalMissingPluginError(n.c);
    }
    case T.PROMISE_CONSTRUCTOR: {
      const out = crossPut(ctx, n.i, crossPut(ctx, n.s, PROMISE_CONSTRUCTOR()).p);
      ctx.refs.types.set(n.s, T.PROMISE_CONSTRUCTOR);
      return out;
    }
    case T.PROMISE_SUCCESS:
    case T.PROMISE_FAILURE:
      return crossSettle(ctx, depth, n, n.t === T.PROMISE_SUCCESS);
    case T.ITERATOR_FACTORY_INSTANCE: {
      reviveCross(ctx, depth, n.a[0]);
      const source = reviveCross(ctx, depth, n.a[1]);
      checkType(ctx, n, n.a[1].i, T.SEQUENCE);
      if (!source) throw new SerovalMalformedNodeError(n.a[1]);
      return createIterator(source);
    }
    case T.ASYNC_ITERATOR_FACTORY_INSTANCE: {
      reviveCross(ctx, depth, n.a[0]);
      const source = reviveCross(ctx, depth, n.a[1]);
      checkType(ctx, n, n.a[1].i, T.STREAM_CONSTRUCTOR);
      if (!source) throw new SerovalMalformedNodeError(n.a[1]);
      return createAsyncIterable(source);
    }
    case T.STREAM_CONSTRUCTOR: {
      const out = crossPut(ctx, n.i, createStream());
      ctx.refs.types.set(n.i, T.STREAM_CONSTRUCTOR);
      for (const item of n.a) reviveCross(ctx, depth, item);
      return out;
    }
    case T.STREAM_NEXT:
      return crossStep(ctx, depth, n, "next");
    case T.STREAM_THROW:
      return crossStep(ctx, depth, n, "throw");
    case T.STREAM_RETURN:
      return crossStep(ctx, depth, n, "return");
    case T.ITERATOR_FACTORY:
      return void reviveCross(ctx, depth, n.f);
    case T.ASYNC_ITERATOR_FACTORY:
      return void reviveCross(ctx, depth, n.a[1]);
    case T.SEQUENCE: {
      const out = crossPut(ctx, n.i, { [SEQUENCE]: true, v: [], t: n.s, d: n.l });
      ctx.refs.types.set(n.i, T.SEQUENCE);
      for (let i = 0; i < n.a.length; i++) out.v[i] = reviveCross(ctx, depth, n.a[i]);
      return out;
    }
  }
  throw new SerovalUnsupportedNodeError(n);
}

// ---------------------------------------------------------------- the wire's form: stringify / parse

/** A value as JSON text (its node tree). Promises cannot be sent this way. */
export function stringify(value) {
  const ctx = parser(new Map(), ALL ^ Feature.RegExp, false, {});
  ctx.noPromises = true;
  return JSON.stringify(toNode(ctx, 0, value));
}

class MalformedError extends Error {
  constructor(n) {
    super("Malformed value" + (n && typeof n === "object" && "t" in n ? ' (node "' + n.t + '")' : "") + ".");
  }
}

/** The value `stringify` wrote: read without eval, each node checked (it may come from anyone). */
export function parse(text) {
  const tree = JSON.parse(text);
  return revive({ refs: new Map() }, 0, tree);
}

function revive(ctx, depth, n) {
  if (depth > DEPTH_LIMIT) throw new Error("Depth limit of " + DEPTH_LIMIT + " reached");
  if (!n || typeof n !== "object") throw new MalformedError(n);
  depth++;
  const put = (v) => {
    const id = n.i;
    if (!Number.isInteger(id) || id < 0 || ctx.refs.has(id)) throw new MalformedError(n);
    ctx.refs.set(id, v);
    return v;
  };
  switch (n.t) {
    case T.CONSTANT:
      return CONSTANT_VALUE[at(n, n.s, CONSTANT_VALUE.length)];
    case T.NUMBER:
      return Number(n.s);
    case T.STRING:
      return unescapeString(String(n.s));
    case T.BIGINT:
      if (String(n.s).length > MAX_BIGINT_LENGTH) throw new MalformedError(n);
      return BigInt(n.s);
    case T.INDEXED:
      if (!ctx.refs.has(n.i)) throw new MalformedError(n);
      return ctx.refs.get(n.i);
    case T.ARRAY: {
      if (!Array.isArray(n.a)) throw new MalformedError(n);
      const out = put(new Array(n.a.length));
      n.a.forEach((item, i) => {
        if (item) out[i] = revive(ctx, depth, item);
      });
      return flag(out, n.o);
    }
    case T.OBJECT:
    case T.NULL_OBJECT: {
      const out = put(n.t === T.OBJECT ? {} : Object.create(null));
      fields(ctx, depth, n.p, out);
      return flag(out, n.o);
    }
    case T.DATE:
      return put(new Date(n.s));
    case T.SET: {
      const out = put(new Set());
      for (const item of n.a) out.add(revive(ctx, depth, item));
      return out;
    }
    case T.MAP: {
      const out = put(new Map());
      for (let i = 0; i < n.e.k.length; i++) out.set(revive(ctx, depth, n.e.k[i]), revive(ctx, depth, n.e.v[i]));
      return out;
    }
    case T.ARRAY_BUFFER: {
      if (typeof n.s !== "string" || n.s.length > MAX_BASE64_LENGTH) throw new MalformedError(n);
      return put(ARRAY_BUFFER_CONSTRUCTOR(unescapeString(n.s)));
    }
    case T.TYPED_ARRAY:
    case T.BIGINT_TYPED_ARRAY:
    case T.DATA_VIEW: {
      const Kind = n.t === T.DATA_VIEW ? DataView : Object.hasOwn(TYPED_ARRAYS, n.c) ? TYPED_ARRAYS[n.c] : null;
      const buffer = Kind && revive(ctx, depth, n.f);
      const offset = n.b ?? 0;
      if (!(buffer instanceof ArrayBuffer) || offset < 0 || offset > buffer.byteLength) throw new MalformedError(n);
      return put(new Kind(buffer, offset, n.l));
    }
    case T.ERROR:
    case T.AGGREGATE_ERROR: {
      const Kind = n.t === T.ERROR ? ERRORS[at(n, n.s, ERRORS.length)] : AggregateError;
      const message = unescapeString(String(n.m));
      const out = put(n.t === T.ERROR ? new Kind(message) : new Kind([], message));
      if (n.p) Object.defineProperties(out, Object.getOwnPropertyDescriptors(fields(ctx, depth, n.p, {})));
      return out;
    }
    case T.WK_SYMBOL:
      return put(WELL_KNOWN[at(n, n.s, WELL_KNOWN.length)]);
    case T.BOXED:
      return put(Object(revive(ctx, depth, n.f)));
  }
  throw new MalformedError(n);
}
/** An index into one of the tables above, checked (a name such as "constructor" would reach the table's prototype). */
function at(n, i, length) {
  if (!Number.isInteger(i) || i < 0 || i >= length) throw new MalformedError(n);
  return i;
}
function fields(ctx, depth, p, out) {
  if (!p || !Array.isArray(p.k) || !Array.isArray(p.v)) throw new MalformedError(p);
  for (let i = 0; i < p.k.length; i++) {
    const key = p.k[i];
    if (typeof key !== "string") {
      revive(ctx, depth, key);
      continue;
    }
    const name = unescapeString(key);
    const value = revive(ctx, depth, p.v[i]);
    if (isSafeKey(name)) out[name] = value;
    else Object.defineProperty(out, name, { value, configurable: true, enumerable: true, writable: true });
  }
  return out;
}
function flag(o, f) {
  return f === 3 ? Object.freeze(o) : f === 2 ? Object.seal(o) : f === 1 ? Object.preventExtensions(o) : o;
}
