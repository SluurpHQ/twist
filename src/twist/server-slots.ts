// @ts-nocheck
// Ported from Solid's web/src/server.ts (MIT, Ryan Carniato and contributors): binding-slot values and claims, the
import { sharedConfig } from "./signals.ts";
import { inServerComponentScope } from "./server-internal.ts";
import { devCheck, recordFinding } from "./request.ts";
import { escape, ssrClassName, ssrStyle } from "./server.ts";

const $PROXY = Symbol.for("solid-proxy");
const NOT_NAME = /[\0-\x20\x7F-\x9F"'<>/=]/;
const safeAttrNames = new Set<string>();
function isAttrName(prop: string): boolean {
  if (safeAttrNames.has(prop)) return true;
  if (prop === "" || NOT_NAME.test(prop)) return false;
  if (safeAttrNames.size < 512) safeAttrNames.add(prop);
  return true;
}

function classListToObject(classList) {
  if (Array.isArray(classList)) {
    const result = {};
    flattenClassList(classList, result);
    return result;
  }
  return classList;
}

function flattenClassList(list, result) {
  for (let i = 0, len = list.length; i < len; i++) {
    const item = list[i];
    if (Array.isArray(item)) flattenClassList(item, result);
    else if (typeof item === "object" && item != null) Object.assign(result, item);
    // clsx-style composition: standalone booleans are ignored so guard
    else if (typeof item !== "boolean" && (item || item === 0)) result[item] = true;
  }
}

/** Each own key of a props source, and the object that owns it. */
function sourceOwners(s, keys, owners) {
  for (const k of Reflect.ownKeys(s)) {
    const at = keys.indexOf(k);
    if (at !== -1) keys.splice(at, 1), owners.splice(at, 1);
    keys.push(k);
    owners.push(s);
  }
}

// The compiled guard's arming values (`sharedConfig.context.claims`): the
export const CLAIMS_STREAM = 1;
export const CLAIMS_DOCUMENT = 2;

/** The brand on a binding slot's stand-in for one property read. */
export const SLOT_VALUE = /*#__PURE__*/ Symbol.for("solid.slot-value");
/** Marker attribute prefix on a consuming element (`_s:class`, `_s:on:click`, `_s:ref`). */
export const SLOT_MARKER = "_s:";
/** Faces a stand-in can come from (`slotValue`'s `face`). */
export const SLOT_FACE_STREAM = 0;
export const SLOT_FACE_DATA = 1;
export const SLOT_FACE_MARKUP = 2;

const BINDING_SLOT_POSITION = "BINDING_SLOT_POSITION";

/** Report a position finding once per (occurrence, key, reason, position) for */
function slotFinding(sv, reason, position, message, severity = "warn") {
  if (true) {
    const ctx = sharedConfig.context;
    if (ctx) {
      const id = `${sv[SLOT_VALUE]}\u0000${sv.k}\u0000${reason}\u0000${position || ""}`;
      const seen = ctx.slotFindings || (ctx.slotFindings = new Set());
      if (seen.has(id)) return;
      seen.add(id);
    }
    devCheck({
      code: BINDING_SLOT_POSITION,
      kind: "ssr",
      severity,
      message,
      data: { reason, occurrence: sv[SLOT_VALUE], key: sv.k, position }
    });
  }
}

export function isSlotValue(value: unknown): boolean;

export function isSlotValue(value) {
  return value !== null && typeof value === "object" && value[SLOT_VALUE] !== undefined;
}

/** A binding slot's stand-in for one property read. @internal */
export function slotValue(occurrence: string, key: string, value: unknown, face: number): object;

export function slotValue(occurrence, key, value, face) {
  const sv = { [SLOT_VALUE]: occurrence, k: key, v: value, f: face };
  // Every implicit coercion goes through `Symbol.toPrimitive` first:
  Object.defineProperty(sv, Symbol.toPrimitive, {
    value: hint => slotValueString(sv, hint === "string" ? "stringified" : "coerced")
  });
  Object.defineProperty(sv, "toString", { value: () => slotValueString(sv, "stringified") });
  // The text-position writer rides on the stand-in (`w`) rather than being
  Object.defineProperty(sv, "w", { value: () => slotText(sv) });
  return sv;
}

function slotValueString(sv, reason) {
  if (true) {
    const prop = propOfOccurrence(sv[SLOT_VALUE]);
    slotFinding(
      sv,
      reason,
      undefined,
      reason === "coerced"
        ? `[${BINDING_SLOT_POSITION}] \`${prop}\`'s \`${sv.k}\` is a binding-slot value used in an expression ` +
            `(a comparison, arithmetic, or a branch on its result). The server does not have the value — ` +
            `the client owns it — so nothing can be computed from it here. It must be the WHOLE value of ` +
            `an attribute, class name, style property, handler, ref or text child; a decision that depends on it ` +
            `belongs in the client fill (return the decided value) or in a markup slot.`
        : `[${BINDING_SLOT_POSITION}] \`${prop}\`'s \`${sv.k}\` is a binding-slot value ` +
            `and was stringified outside a bindable position — it must be the WHOLE value of an attribute, ` +
            `class name, style property, handler, ref or text child (\`class={row.${sv.k}}\`, not \`class={\`x \${row.${sv.k}}\`}\`). ` +
            `If it is, the element was compiled without the \`serverComponents\` compiler option. ` +
            `Nothing renders here on either face.`
    );
  }
  return "";
}

/** A binding-slot value at a TEXT position (`<b>{row.count}</b>`): a marker */
function slotText(sv) {
  slotMarkupRead(sv, "text");
  const v = sv.f === SLOT_FACE_DATA ? sv.v : undefined;
  const text = typeof v === "string" || typeof v === "number" ? escape("" + v) : "";
  return `<!--${SLOT_MARKER}t=${slotEntry(sv)}-->${text}<!--/${SLOT_MARKER}t-->`;
}

function slotMarkupRead(sv, position) {
  if ( sv.f === SLOT_FACE_MARKUP) {
    slotFinding(
      sv,
      "markup",
      position,
      `[${BINDING_SLOT_POSITION}] \`${position}\` reads \`${sv.k}\` off slot \`${propOfOccurrence(sv[SLOT_VALUE])}\`, ` +
        `but the client fill returned markup, not an object. A slot renders one or the other: ` +
        `return an object (\`{ ${sv.k}: … }\`) for positions, or place the slot as content.`
    );
  }
}

/** A stand-in rendered where its marker cannot go (inside template quotes): */
function slotValueInline(kind, sv) {
  if (true) {
    slotFinding(
      sv,
      "inline",
      kind,
      `[${BINDING_SLOT_POSITION}] A binding-slot value (\`${sv.k}\` of \`${propOfOccurrence(sv[SLOT_VALUE])}\`) ` +
        `reached \`${kind}\` inside template quotes, where its position marker cannot be emitted — the ` +
        `element was compiled without the \`serverComponents\` compiler option. Nothing renders here ` +
        `on either face.`
    );
  }
  return undefined;
}

// `<occurrence>:<key>[=<name>]` — the marker value's one entry.
const SLOT_KEY_UNSAFE = /[^A-Za-z0-9_.!~*'()-]/g;
function encodeSlotKey(key) {
  return String(key).replace(SLOT_KEY_UNSAFE, c => encodeURIComponent(c));
}
function slotEntry(sv, name) {
  return `${sv[SLOT_VALUE]}:${encodeSlotKey(sv.k)}${name !== undefined ? "=" + encodeSlotKey(name) : ""}`;
}
function slotMarker(position, entries) {
  return ` ${SLOT_MARKER}${position}="${entries}"`;
}
/** The replay-window stamp of an EVENT-SLOT consumer (frames savings pass */
function eventSlotStamp(mode) {
  return mode === CLAIMS_DOCUMENT ? " _hk" : "";
}
function propOfOccurrence(occurrence) {
  const i = occurrence.indexOf("#");
  return i === -1 ? occurrence : occurrence.slice(0, i);
}

/** One whole attribute bound to a stand-in: the t=0 value, then the marker. */
function slotAttribute(key, sv) {
  slotMarkupRead(sv, key);
  let out = "";
  if (sv.f === SLOT_FACE_DATA) {
    const v = sv.v;
    if (v != null && v !== false) {
      out = v === true || v === "" ? ` ${key}` : ` ${key}="${escape(String(v), true)}"`;
    }
  }
  return out + slotMarker(key, slotEntry(sv));
}

/** `class`/`style` as `ssrElementAttribute` writes them: the whole value may */
function slotClassOrStyle(key, value) {
  const isClass = key === "class";
  if (isSlotValue(value)) {
    slotMarkupRead(value, key);
    let out = "";
    if (value.f === SLOT_FACE_DATA && value.v != null) {
      out = ` ${key}="${isClass ? ssrClassName(value.v) : ssrStyle(value.v)}"`;
    }
    return out + slotMarker(key, slotEntry(value));
  }
  if (typeof value === "object" && value !== null) {
    const obj = isClass ? classListToObject(value) : value;
    let entries = "";
    let inner = "";
    for (const name of Object.keys(obj)) {
      let v = obj[name];
      if (isSlotValue(v)) {
        slotMarkupRead(v, `${key}:${name}`);
        entries += (entries ? "," : "") + slotEntry(v, name);
        v = v.f === SLOT_FACE_DATA ? v.v : undefined;
      }
      if (isClass) {
        if (!name || name === "undefined" || !v) continue;
        inner += (inner ? " " : "") + escape(name, true);
      } else if (v != undefined) {
        const r = escape(v, true);
        if (r != undefined && r !== "undefined") {
          inner += (inner ? ";" : "") + `${escape(name, true)}:${r}`;
        }
      }
    }
    // No stand-in: `inner` IS the plain helper's string (same walk, same
    if (entries === "") return ` ${key}="${inner}"`;
    return (inner ? ` ${key}="${inner}"` : "") + slotMarker(key, entries);
  }
  return ` ${key}="${isClass ? ssrClassName(value) : ssrStyle(value)}"`;
}

/** `onClick` → `click` (the client runtime's derivation). */
function eventPosition(prop) {
  return prop.slice(2).toLowerCase();
}

/** A `ref`/`onXxx` key met by `ssrElement`'s walk under `slots` — in a */
function spreadBehaviorPosition(behaviors, prop, value, mode, index, settle) {
  if (!isAttrName(prop)) return behaviors;
  const pos = prop === "ref" ? "ref" : eventPosition(prop);
  const entries = value == null ? "" : claimEntries(pos, value, mode);
  if (!settle) {
    if (entries) (behaviors ||= new Map()).set(pos, entries);
    return behaviors;
  }
  behaviors ||= new Map();
  const b = behaviors.get(pos);
  if (b === undefined) behaviors.set(pos, { e: entries, at: index });
  else {
    b.e = entries;
    b.at = index;
  }
  return behaviors;
}

/** The behavior markers of a spread element: the sources' (`behaviors`) */
function spreadBehaviorMarkers(behaviors, claims, mode) {
  if (claims !== undefined) {
    const segments = claims();
    // Integer keys enumerate in ascending order: source order.
    for (const k in segments) {
      const map = segments[k];
      for (const pos in map) {
        const value = map[pos];
        behaviors ||= new Map();
        const b = behaviors.get(pos);
        if (pos === "ref") {
          if (value == null) continue;
          const entries = claimEntries("ref", value, mode);
          if (!entries) continue;
          if (b === undefined) behaviors.set("ref", { e: entries, at: -1 });
          else b.e = b.e ? b.e + "," + entries : entries;
          continue;
        }
        if (b !== undefined && b.at >= +k) continue;
        const entries = value == null ? "" : claimEntries(pos, value, mode);
        if (b === undefined) behaviors.set(pos, { e: entries, at: -1 });
        else b.e = entries;
      }
    }
  }
  let out = "";
  let events = false;
  if (behaviors !== null) {
    for (const [pos, b] of behaviors) {
      const e = claims === undefined ? b : b.e;
      if (!e) continue;
      if (pos === "ref") out += slotMarker("ref", e);
      else {
        out += slotMarker("on:" + pos, e);
        events = true;
      }
    }
  }
  return events ? out + eventSlotStamp(mode) : out;
}

/** `ssrElement`'s collecting pass for sources that are not all plain */
function collectSpreadSources(tag, props, viewKeys, owners, slots, ownerIndex) {
  for (let i = 0; i < props.length; i++) {
    let s = props[i];
    if (typeof s === "function") s = s();
    if (s != null) {
      if (slots && !($PROXY in s) && s.$slot === true) s = slotSpreadSource(tag, s);
      if (ownerIndex === null) sourceOwners(s, viewKeys, owners);
      else {
        const ks = [];
        const os = [];
        sourceOwners(s, ks, os);
        for (let j = 0; j < ks.length; j++) {
          const at = viewKeys.indexOf(ks[j]);
          if (at !== -1) {
            viewKeys.splice(at, 1);
            owners.splice(at, 1);
            ownerIndex.splice(at, 1);
          }
          viewKeys.push(ks[j]);
          owners.push(os[j]);
          ownerIndex.push(i);
        }
      }
    }
  }
}

/** A `prop:*` key of a runtime spread whose value is a stand-in: the */
function spreadPropPosition(prop, value) {
  if ( isSlotValue(value)) {
    slotFinding(
      value,
      "prop",
      prop,
      `[${BINDING_SLOT_POSITION}] \`${value.k}\` of slot \`${propOfOccurrence(value[SLOT_VALUE])}\` is bound ` +
        `at \`${prop}\`. Property positions are not bindable (the server renders no properties): nothing ` +
        `renders here. Bind the attribute form (\`${prop.slice(5)}\`), or set the property in the client fill's ref.`
    );
  }
}

/** An object value at an attribute key of a runtime spread: a `class`/`style` */
function spreadObjectAttribute(prop, value) {
  if (prop === "style" || prop === "class") return slotClassOrStyle(prop, value);
  if (!isAttrName(prop)) return "";
  if (value[SLOT_VALUE] !== undefined) return slotAttribute(prop, value);
  return ` ${prop}="${escape(value, true)}"`;
}

/** A slot's return spread whole onto an element (`<li {...row}>`): the */
function slotSpreadSource(tag, source) {
  if (true) {
    const occurrence = source.$occurrence;
    const text =
      `[${BINDING_SLOT_POSITION}] A slot${occurrence ? ` (\`${propOfOccurrence(occurrence)}\`)` : ""} is spread ` +
      `onto a server-rendered <${tag}>. A binding slot binds by position — name each one ` +
      `(\`class={row.rowClass} onClick={row.remove}\`) so the template shows what the client owns.`;
    recordFinding({
      code: BINDING_SLOT_POSITION,
      kind: "ssr",
      severity: "error",
      message: text,
      data: { reason: "spread", tag, occurrence }
    });
    throw new Error(text);
  }
  return {};
}

/** The compiled per-element hole for ref/onXxx positions on a server */
export function ssrClaim(map: Record<string, unknown>): string;

export function ssrClaim(map) {
  const mode = sharedConfig.context && sharedConfig.context.claims;
  if (!mode) return "";
  let out = "";
  let events = false;
  for (const pos in map) {
    const entries = claimEntries(pos, map[pos], mode);
    if (!entries) continue;
    if (pos === "ref") out += slotMarker("ref", entries);
    else {
      out += slotMarker("on:" + pos, entries);
      events = true;
    }
  }
  return events ? out + eventSlotStamp(mode) : out;
}

/** One handler/ref position's marker entries (`occ:key[,occ:key…]`, "" for */
function claimEntries(pos, value, mode) {
  if (Array.isArray(value) && pos !== "ref") {
    // A handler tuple (`[row.key, 1]`): a marker names keys, never data, so
    if (true) {
      const sv = value.find(isSlotValue);
      if (sv !== undefined) {
        slotFinding(
          sv,
          "tuple",
          pos,
          `[${BINDING_SLOT_POSITION}] A \`${pos}\` handler position on a server-rendered element received ` +
            `an array. A position marker names the slot's keys, never data, so a tuple's data cannot reach ` +
            `the client — nothing binds here. Return the tuple from the fill (\`[handler, data]\`) and ` +
            `bind that one property.`
        );
      } else claimEntries(pos, value[0], mode);
    }
    return "";
  }
  if (Array.isArray(value)) {
    // Nested lists flatten: a merged duplicate of an array ref is
    let entries = "";
    for (const v of value) {
      const inner = claimEntries(pos, v, mode);
      if (inner) entries += (entries ? "," : "") + inner;
    }
    return entries;
  }
  if (isSlotValue(value)) {
    slotMarkupRead(value, pos);
    return slotEntry(value);
  }
  if ( typeof value === "function" && !value.$slotWarned && claimInScope(mode)) {
    // Once per function: a live hole evaluates its expression more than
    value.$slotWarned = true;
    devCheck({
      code: BINDING_SLOT_POSITION,
      kind: "ssr",
      severity: "warn",
      message:
        `[${BINDING_SLOT_POSITION}] A \`${pos}\` position on a server-rendered element received a server-local ` +
        `function — it can never run. Bind a slot's property there ` +
        `(\`const row = props.row(args); ${pos === "ref" ? "ref" : "onX"}={row.${pos === "ref" ? "ref" : "onX"}}\`) ` +
        `so the client supplies it, or bind a mutation to \`action=\`.`,
      data: { reason: "server-local", position: pos }
    });
  }
  return "";
}

function claimInScope(mode) {
  return (
    mode === CLAIMS_STREAM ||
    (typeof inServerComponentScope === "function" && inServerComponentScope())
  );
}

// --- <select value> resolution (solidjs/solid#3013) ---------------------------

// Decodes the entities our own escape() produces (attr and content forms).

export { slotText, slotAttribute, slotClassOrStyle, slotValueInline, slotMarker, slotEntry, eventSlotStamp, eventPosition, spreadBehaviorPosition, spreadBehaviorMarkers, collectSpreadSources, spreadPropPosition, spreadObjectAttribute, claimEntries, claimInScope, propOfOccurrence };
