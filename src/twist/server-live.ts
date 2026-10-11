// @ts-nocheck
// Ported from Solid's web/src/server.ts (MIT, Ryan Carniato and contributors): the live-hole engine a frame response
import { getOwner, runWithOwner, sharedConfig, NotReadyError } from "./signals.ts";
import { creationStamp, inServerComponentScope, ssrHandleError, ssrSanitizeError } from "./server-internal.ts";
import { html } from "./server.ts";

/** A value's html into a template result (Twist's renderer is string-based: no holes left over). */
function resolveSSRNode(v, result) {
  result.t[result.t.length - 1] += html(v, false);
}

/** A pending read under a hole: Twist's renderer waits for it itself (a Loading's fallback, or a shell hole). */
function buildAsyncWrap(err, hole) {
  const p = ssrHandleError(err);
  return p ? { fn: hole, p } : null;
}

function wireErrorMessage(err) {
  const wire = ssrSanitizeError(err, null);
  return String((wire && wire.message) || wire);
}

// ---- live markup holes (Stage 3): the DR-2 binding ledger generalized ----

// Per-template classification of hole positions, cached by template

export function createLiveHoles(sink, scoped) {
  let nextId = 0;
  const stamp = typeof creationStamp === "function" ? creationStamp : () => 0;
  // The document-face arming gate: one engine serves the whole render, but
  const inScope =
    scoped && typeof inServerComponentScope === "function" ? inServerComponentScope : null;
  // Baselines compare marker-free: a first render's html carries nested
  const stripMarkers = html => html.replace(/<!--lh:\/?\d+-->/g, "");
  // Sweeps re-evaluate under the mint-time render CONTEXT as well as the
  const swept = (owner, ctx, fn) => {
    const prev = sharedConfig.context;
    sharedConfig.context = ctx;
    try {
      return owner ? runWithOwner(owner, fn) : fn();
    } finally {
      sharedConfig.context = prev;
    }
  };
  // Resolve a hole thunk's value to a `{ t, h, p }` result.
  function resolveHoleValue(hole) {
    const result = { t: [""], h: [], p: [] };
    try {
      resolveSSRNode(hole(), result);
    } catch (err) {
      const wrap = buildAsyncWrap(err, hole);
      if (!wrap) throw err;
      result.h.push(wrap.fn);
      result.p.push(wrap.p);
      result.t.push("");
    }
    return result;
  }
  // Supersession: a hole that re-emits replaces its previous output
  function closeChildren(b) {
    for (const c of b.children) {
      c.closed = true;
      if (c.key) sink.closeBinding(c.key);
      closeChildren(c);
    }
    b.children.length = 0;
  }
  const engine = {
    // In-tag routing from `ssr()` and retry-chain resolution (`$lhSuppress`)
    suppressed: 0,
    sweeping: false,
    parent: null,
    // The impurity gates.
    recordStamp: 0,
    gateHit: false,
    /** Intercept a thunk content hole: resolve it, and — when the evaluation */
    content(hole) {
      // A retry fn of an escalated hole re-enters here on its re-pull —
      if (hole.$lhSuppress) {
        const r = { t: [""], h: [], p: [] };
        engine.suppressed++;
        try {
          try {
            resolveSSRNode(hole(), r);
          } catch (err) {
            const wrap = buildAsyncWrap(err, hole);
            // (A real error goes on to the boundary around it, as the resolver routes it there.)
            if (!wrap) throw err;
            r.h.push(wrap.fn);
            r.p.push(wrap.p);
            r.t.push("");
          }
        } finally {
          engine.suppressed--;
        }
        const b = hole.$lhBinding;
        if (b && !b.closed && !r.h.length && !engine.sweeping) {
          b.last = stripMarkers(r.t[0]);
        }
        return r.h.length ? r : r.t[0];
      }
      if (engine.suppressed || engine.sweeping) return null;
      // Slot positions are client-owned constants — the server can never
      if (hole.$lhSkip) return null;
      // Outside the arming scope (document face, non-component content):
      if (inScope && !inScope()) return null;
      const recordsBefore = engine.recordStamp;
      const ownersBefore = stamp();
      const owner = getOwner();
      const holeCtx = sharedConfig.context;
      const b = {
        key: null,
        children: [],
        last: null,
        closed: false,
        sweep() {
          if (b.closed) return;
          const prevSweeping = engine.sweeping;
          engine.sweeping = true;
          engine.gateHit = false;
          const sweepOwnersBefore = stamp();
          let res;
          try {
            res = swept(owner, holeCtx, () => resolveHoleValue(hole));
          } catch (err) {
            // A real error is terminal for the hole — the last emitted
            b.closed = true;
            sink.closeBinding(b.key);
            sink.error(b.key, wireErrorMessage(err));
            return;
          } finally {
            engine.sweeping = prevSweeping;
          }
          // An impure re-evaluation (slot records or reactive-scope
          if (engine.gateHit || stamp() !== sweepOwnersBefore) {
            b.closed = true;
            sink.closeBinding(b.key);
            return;
          }
          // Still pending: hold the last value and wait — the settle that
          if (res.h.length) return;
          // Baseline-gated emission.
          const html = res.t[0];
          if (b.last === null || html === b.last) return;
          b.last = html;
          closeChildren(b);
          sink.hole(b.key, html);
        }
      };
      if (engine.parent) engine.parent.children.push(b);
      const prevParent = engine.parent;
      // The parent frame spans EVALUATION as well as resolve: `ssr()`
      engine.parent = b;
      let value;
      let escalated = null;
      try {
        value = hole();
      } catch (err) {
        const wrap = buildAsyncWrap(err, hole);
        if (!wrap) {
          // Real error at first render: existing content semantics are
          engine.parent = prevParent;
          closeChildren(b);
          return "";
        }
        engine.parent = prevParent;
        throw err;
      }
      if (
        !escalated &&
        ((typeof value === "function" && value.$lhSkip) ||
          (value !== null && typeof value === "object" && value.$slot))
      ) {
        // …and a slot-tagged value resolves unmarked (suppressed, so a
        engine.parent = prevParent;
        const r = { t: [""], h: [], p: [] };
        engine.suppressed++;
        try {
          resolveSSRNode(value, r);
        } finally {
          engine.suppressed--;
        }
        return r.h.length ? r : r.t[0];
      }
      let res;
      if (escalated) {
        // The retry chain resolves mint-suppressed (`$lhSuppress`, which
        closeChildren(b);
        escalated.fn.$lhSuppress = true;
        escalated.fn.$lhBinding = b;
        res = { t: ["", ""], h: [escalated.fn], p: [escalated.p] };
      } else {
        res = { t: [""], h: [], p: [] };
        try {
          resolveSSRNode(value, res);
        } catch (_) {
          engine.parent = prevParent;
          closeChildren(b);
          return "";
        }
      }
      engine.parent = prevParent;
      // The impurity gate (see the engine fields): this evaluation emitted
      if (engine.recordStamp !== recordsBefore || stamp() !== ownersBefore) {
        return res.h.length ? res : res.t[0];
      }
      const id = nextId++;
      const key = (b.key = "lh:" + id);
      const open = `<!--lh:${id}-->`;
      const close = `<!--lh:/${id}-->`;
      if (!res.h.length) {
        b.last = stripMarkers(res.t[0]);
        sink.openBinding(key, b);
        return open + res.t[0] + close;
      }
      // Escalated mint: markers ride the template so the retry's splice
      const t = res.t.slice();
      t[0] = open + t[0];
      t[t.length - 1] += close;
      sink.openBinding(key, b);
      return { t, h: res.h, p: res.p };
    },
    /** The shared id counter — `ssr()` mints an attr address at injection */
    mint() {
      return nextId++;
    },
    /** Whether interception may arm at the current evaluation point — */
    active() {
      return !inScope || inScope();
    },
    /** Register an element's attr-hole capture (built by `ssr()`'s in-tag */
    attr(cap) {
      const owner = getOwner();
      const holeCtx = sharedConfig.context;
      const b = {
        key: "lha:" + cap.id,
        children: [],
        last: cap.base,
        closed: false,
        sweep() {
          if (b.closed) return;
          const prevSweeping = engine.sweeping;
          engine.sweeping = true;
          engine.gateHit = false;
          const sweepOwnersBefore = stamp();
          let html = "";
          try {
            let group = null;
            let groupVal = null;
            const run = () => {
              for (const part of cap.parts) {
                if (typeof part === "string") {
                  html += part;
                  continue;
                }
                let v;
                if (part.g) {
                  if (group !== part.g) {
                    group = part.g;
                    groupVal = part.g();
                  }
                  v = groupVal[part.i];
                } else {
                  v = part.f();
                }
                const vt = typeof v;
                if (vt === "string" || vt === "number") html += v;
              }
            };
            swept(owner, holeCtx, run);
          } catch (err) {
            // NotReady holds for a later commit (the end-latch sweep is the
            if (ssrHandleError(err, true)) return;
            b.closed = true;
            sink.closeBinding(b.key);
            sink.error("lha:" + cap.id, wireErrorMessage(err));
            return;
          } finally {
            engine.sweeping = prevSweeping;
          }
          if (engine.gateHit || stamp() !== sweepOwnersBefore) {
            b.closed = true;
            sink.closeBinding(b.key);
            return;
          }
          if (html === b.last) return;
          const before = attrNames(b.last);
          const after = attrNames(html);
          const removed = before.filter(n => !after.includes(n));
          b.last = html;
          sink.attr(String(cap.id), html, removed);
        }
      };
      // The first-render text is the digest source for the element's
      if (sink.attrBaseline) sink.attrBaseline(b.key, cap.base);
      sink.openBinding(b.key, b);
    }
  };
  return engine;
}

// Attribute NAMES in a rebuilt attr text.
function attrNames(text) {
  const names = [];
  const re = /(?:^|\s)([^\s=/>"']+)(?:="[^"]*")?/g;
  let m;
  while ((m = re.exec(text))) names.push(m[1]);
  return names;
}
