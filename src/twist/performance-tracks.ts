// @ts-nocheck
// `@solidjs/web/performance-tracks` on Twist (ported from Solid's, MIT): the attribution engine's records and the web
// runtime's call/frame records painted as Chrome Performance panel tracks (development tooling).
import { OBSERVE } from "./diagnostics.ts";
import { DEV } from "./core/index.ts";
import { attribution, formatRerun, formatOrigin } from "./core/attribution.ts";

declare const process: { env: Record<string, string | undefined> };
const IS_DEV = process.env.NODE_ENV !== "production";
const GROUP = "Solid";
const TRACKS = {
  interactions: "Interactions",
  propagation: "Propagation",
  effects: "Effects",
  memos: "Memos",
  async: "Async",
  holds: "Holds",
  navigations: "Navigations",
  server: "Server"
};
const noop = () => {};
function enablePerformanceTracks(options = {}) {
  if (instance !== null) return instance.join();
  const observe = OBSERVE;
  if (observe === undefined) return noop;
  if (typeof performance !== "object" || typeof performance.now !== "function") return noop;
  const emitter = createEmitter(options.rich ?? IS_DEV);
  if (emitter === undefined) return noop;
  const minMs = options.minMs ?? (0 );
  const painter = new Painter(emitter, minMs);
  const server = new ServerSpans(emitter);
  server.start();
  const {
    records
  } = observe;
  const releases = [() => server.dispose(), attribution.enable({
    log: false,
    ...options.attribution,
    checks: options.attribution?.checks ?? false
  }), records.subscribe("rerun", (e, node) => painter.rerun(e, node)), records.subscribe("create", (e, node) => painter.create(e, node)), records.subscribe("effect", (e, node) => painter.effect(e, node)), records.subscribe("flush", e => painter.flush(e)), records.subscribe("flight", (e, node) => painter.flight(e, node)), records.subscribe("fallback", (e, subtree) => painter.fallback(e, subtree)), records.subscribe("interaction", e => painter.interaction(e)), records.subscribe("hold", e => painter.hold(e)), records.subscribe("navigation", e => painter.navigation(e)), records.subscribe("call", (e, live) => {
    painter.call(e);
    server.call(e, live);
  }), records.subscribe("frame", e => painter.frame(e)), observe.diagnostics.subscribe((e, subject) => painter.diagnostic(e, subject))];
  const active = {
    holders: 0,
    join() {
      active.holders++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        if (--active.holders > 0 || instance !== active) return;
        instance = null;
        for (const release of releases) release();
        emitter.dispose();
      };
    }
  };
  instance = active;
  return active.join();
}
let instance = null;
function createEmitter(rich) {
  const hasMeasure = typeof performance.measure === "function";
  const hasTimeStamp = typeof console !== "undefined" && typeof console.timeStamp === "function";
  let emitter;
  if (rich && hasMeasure || !hasTimeStamp && hasMeasure) {
    const names = new Map();
    const markNames = new Map();
    let pending = 0;
    const clear = () => {
      pending = 0;
      clearOwned(names, "measure", performance.clearMeasures);
      clearOwned(markNames, "mark", performance.clearMarks);
    };
    const hasMark = typeof performance.mark === "function";
    emitter = {
      rich: true,
      span(label, start, end, track, color, tooltip, properties, task) {
        const devtools = {
          dataType: "track-entry",
          track,
          trackGroup: GROUP,
          color
        };
        if (tooltip !== undefined) devtools.tooltipText = tooltip;
        if (properties !== undefined) devtools.properties = properties;
        const measure = () => performance.measure(label, {
          start,
          end,
          detail: {
            devtools
          }
        });
        if (!guarded(measure, task)) return;
        names.set(label, (names.get(label) ?? 0) + 1);
        if (++pending >= CLEAR_EVERY) clear();
      },
      mark(label, color, tooltip, properties, issue, task) {
        if (!hasMark) return;
        const devtools = {
          dataType: "marker",
          color
        };
        if (tooltip !== undefined) devtools.tooltipText = tooltip;
        if (properties !== undefined) devtools.properties = properties;
        if (issue !== undefined) devtools.performanceIssue = issue;
        const mark = () => performance.mark(label, {
          detail: {
            devtools
          }
        });
        if (!guarded(mark, task)) return;
        markNames.set(label, (markNames.get(label) ?? 0) + 1);
        if (++pending >= CLEAR_EVERY) clear();
      },
      dispose: clear
    };
  } else if (hasTimeStamp) {
    const timeStamp = console.timeStamp;
    emitter = {
      rich: false,
      span(label, start, end, track, color, _tooltip, _properties, task) {
        guarded(() => timeStamp(label, start, end, track, GROUP, color), task);
      },
      mark(label, _color, _tooltip, _properties, _issue, task) {
        guarded(() => timeStamp(label), task);
      },
      dispose: noop
    };
  } else return undefined;
  for (const track of Object.values(TRACKS)) {
    emitter.span(track, SEED_AT, SEED_AT, track, "primary-light");
  }
  return emitter;
}
const SEED_AT = 0.003;
const CLEAR_EVERY = 500;
let warnedThrow = false;
function guarded(fn, task) {
  try {
    task !== undefined ? task.run(fn) : fn();
    return true;
  } catch (error) {
    if (!warnedThrow) {
      warnedThrow = true;
      console.warn("[performance-tracks] a timeline entry could not be emitted; dropped.", error);
    }
    return false;
  }
}
function clearOwned(owned, type, clearFn) {
  if (typeof clearFn !== "function" || typeof performance.getEntriesByName !== "function") {
    owned.clear();
    return;
  }
  for (const [name, count] of owned) {
    if (performance.getEntriesByName(name, type).length <= count) {
      clearFn.call(performance, name);
      owned.delete(name);
    }
  }
}
class Painter {
  roots = new Set();
  unchanged = 0;
  names = new Map();
  constructor(emit, minMs) {
    this.emit = emit;
    this.minMs = minMs;
    this.rich = emit.rich;
  }
  rerun(event, subject) {
    collectRoots(event.causes, this.roots);
    if (!event.changed) this.unchanged++;
    const node = describe(event.nodeName, OBSERVE.ownerPath(subject));
    this.names.set(event.nodeId, node.short);
    if (event.totalMs < this.minMs) return;
    const track = event.nodeKind === "effect" ? TRACKS.effects : TRACKS.memos;
    const color = event.phase === "optimistic" ? "tertiary" : !event.changed ? "warning" : bySelfTime(event.selfMs);
    let tooltip;
    let properties;
    if (this.rich) {
      tooltip = formatRerun(event);
      properties = [["Run", `${event.run} (run ${event.nodeRuns} of this node)`], ["Self time", ms(event.selfMs)], ["Total time", ms(event.totalMs)], ["Changed", event.changed ? "yes" : "no — unchanged (wasted)"], ["Phase", event.phase + (event.held ? ", held" : "")], ["Deps", String(event.depCount)]];
      this.identity(properties, node, event.nodeId);
      if (event.depsAdded.length > 0) properties.push(["Deps added", event.depsAdded.join(", ")]);
      if (event.depsRemoved.length > 0) properties.push(["Deps removed", event.depsRemoved.join(", ")]);
      if (event.causes.length > 0) properties.push(["Causes", event.causes.map(rootCause).join("; ")]);
      const origin = rootOrigin(event.causes);
      if (origin !== undefined && origin !== event.interaction) properties.push(["Origin", this.origin(origin)]);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    const end = event.at + event.totalMs;
    const task = taskOf(subject);
    this.emit.span(node.label, event.at, end, track, color, tooltip, properties, task);
    this.emit.span(`${node.label} ← ${this.causeLabels(event.causes)}`, event.at, end, TRACKS.propagation, color, tooltip, properties, task);
  }
  create(event, subject) {
    const node = describe(event.nodeName, OBSERVE.ownerPath(subject));
    this.names.set(event.nodeId, node.short);
    if (event.totalMs < this.minMs) return;
    let properties;
    if (this.rich) {
      properties = [["Self time", ms(event.selfMs)], ["Total time", ms(event.totalMs)], ["Phase", event.phase + (event.held ? ", held" : "")], ["Deps", String(event.depCount)]];
      this.identity(properties, node, event.nodeId);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    const label = `${node.label} · create`;
    const end = event.at + event.totalMs;
    const color = event.phase === "optimistic" ? "tertiary" : bySelfTime(event.selfMs);
    const task = taskOf(subject);
    this.emit.span(label, event.at, end, event.nodeKind === "effect" ? TRACKS.effects : TRACKS.memos, color, undefined, properties, task);
    this.emit.span(label, event.at, end, TRACKS.propagation, color, undefined, properties, task);
  }
  effect(event, subject) {
    if (event.durationMs < this.minMs) return;
    const node = describe(event.nodeName, OBSERVE.ownerPath(subject));
    let properties;
    if (this.rich) {
      properties = [["Duration", ms(event.durationMs)]];
      this.identity(properties, node, event.nodeId);
      if (event.run !== undefined) properties.push(["Run", String(event.run)]);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    const label = `${node.label} · callback`;
    const end = event.at + event.durationMs;
    const color = event.durationMs < 10 ? "secondary-light" : event.durationMs < 100 ? "secondary" : "error";
    const task = taskOf(subject);
    this.emit.span(label, event.at, end, TRACKS.effects, color, undefined, properties, task);
    this.emit.span(label, event.at, end, TRACKS.propagation, color, undefined, properties, task);
  }
  diagnostic(event, subject) {
    const owner = event.ownerPath?.join(" › ");
    const label = event.ownerPath !== undefined ? `${event.code} — ${nearest(event.ownerPath).join(" › ")}` : event.code;
    const color = event.severity === "error" ? "error" : event.severity === "warn" ? "warning" : "primary-light";
    let tooltip;
    let properties;
    let issue;
    if (this.rich) {
      tooltip = event.message;
      properties = [["Code", event.code], ["Kind", event.kind], ["Severity", event.severity]];
      if (owner !== undefined) properties.push(["Owner path", owner]);
      if (event.nodeName !== undefined) properties.push(["Node", event.nodeName]);
      properties.push(["Message", event.message]);
      if (event.data !== undefined) {
        for (const [key, value] of Object.entries(event.data)) {
          if (typeof value === "number") properties.push([key, Number.isInteger(value) ? String(value) : value.toFixed(2)]);else if (typeof value === "string" || typeof value === "boolean") properties.push([key, String(value)]);
        }
      }
      const guide = DEV.guideUrl(event.code) ;
      if (guide) properties.push(["Guide", guide]);
      if (event.severity !== "info") {
        issue = {
          name: `Solid: ${event.code}`,
          severity: event.severity === "error" ? "error" : "warning",
          description: tooltip,
          learnMoreUrl: guide
        };
      }
    }
    this.emit.mark(label, color, tooltip, properties, issue, taskOf(subject));
  }
  identity(properties, node, nodeId) {
    if (node.path !== undefined) properties.push(["Owner path", node.path]);
    if (node.internal !== undefined) properties.push(["Node", node.internal]);
    properties.push(["Node id", String(nodeId)]);
  }
  flush(event) {
    const roots = [...this.roots];
    const unchanged = this.unchanged;
    this.roots.clear();
    this.unchanged = 0;
    this.names.clear();
    let label = roots.length > 0 ? this.writes(roots, 3) : "flush";
    const origin = event.interaction ?? roots.map(r => r.origin).find(o => o !== undefined && o.kind !== "external");
    if (origin !== undefined) label += ` — ${this.origin(origin)}`;
    label += ` · ${event.runs} ${event.runs === 1 ? "run" : "runs"}`;
    if (unchanged > 0) label += `, ${unchanged} unchanged`;
    if (event.created > 0) label += `, ${event.created} created`;
    if (event.held) label += " · held";
    let properties;
    if (this.rich) {
      properties = [["Duration", ms(event.durationMs)], ["Writes", roots.length > 0 ? this.writes(roots, Infinity) : "none"], ["Re-runs", String(event.runs)], ["Unchanged", `${unchanged} (wasted)`], ["Created", String(event.created)], ["Held", event.held ? "yes — a transition parked" : "no"]];
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(label, event.at, event.at + event.durationMs, TRACKS.propagation, event.held ? "tertiary" : unchanged > 0 && unchanged * 2 >= event.runs ? "warning" : event.durationMs < 16 ? "primary" : "primary-dark", undefined, properties);
  }
  flight(event, subject) {
    const node = describe(event.nodeName, event.ownerPath);
    let properties;
    if (this.rich) {
      properties = [["In the air", ms(event.durationMs)], ["Outcome", event.outcome]];
      if (node.path !== undefined) properties.push(["Owner path", node.path]);
      if (node.internal !== undefined) properties.push(["Node", node.internal]);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(`${node.label}${event.outcome === "abandoned" ? " · abandoned" : ""}`, event.at, event.at + event.durationMs, TRACKS.async, event.outcome === "abandoned" ? "warning" : "secondary", undefined, properties, taskOf(subject));
  }
  fallback(event, subject) {
    const path = event.ownerPath;
    const label = `fallback${path !== undefined ? ` ${nearest(path).join(" › ")}` : ""}`;
    let properties;
    if (this.rich) {
      properties = [["Shown", ms(event.shownMs)]];
      if (path !== undefined && nearest(path).length !== path.length) properties.push(["Owner path", path.join(" › ")]);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(label, event.at, event.at + event.shownMs, TRACKS.async, "tertiary", undefined, properties, taskOf(subject));
  }
  interaction(event) {
    const label = this.origin(event.origin);
    const handlerStart = event.at + (event.inputDelayMs ?? 0);
    const handlerEnd = handlerStart + event.handlerMs;
    let properties;
    if (this.rich) {
      properties = [["Handler", ms(event.handlerMs)], ["Writes", String(event.writes)], ["Re-runs", `${event.runs} (${ms(event.runMs)} self time)`], ["Created", String(event.created)]];
      if (event.inputDelayMs !== undefined) properties.unshift(["Input delay", ms(event.inputDelayMs)]);
      if (event.settledMs !== undefined) properties.push(["Settled", ms(event.settledMs)]);
      if (event.outcome !== undefined) properties.push(["Outcome", event.outcome]);
      if (event.holds.length > 0) properties.push(["Holds", String(event.holds.length)]);
      if (event.navigations.length > 0) properties.push(["Navigations", event.navigations.map(n => this.origin(n.origin)).join("; ")]);
    }
    if (event.inputDelayMs !== undefined && event.inputDelayMs > 0) {
      this.emit.span("input delay", event.at, handlerStart, TRACKS.interactions, "primary-light");
    }
    this.emit.span(label, handlerStart, handlerEnd, TRACKS.interactions, "primary", undefined, properties);
    const outcome = event.outcome;
    if (event.settledMs === undefined || outcome === undefined || outcome === "idle") return;
    const settleEnd = event.at + event.settledMs;
    if (settleEnd <= handlerEnd) return;
    const silent = outcome === "held" && event.holds.some(h => h.silent);
    this.emit.span(outcome, handlerEnd, settleEnd, TRACKS.interactions, silent ? "warning" : outcome === "held" ? "tertiary" : "secondary-light", undefined, this.rich ? [["Settled", ms(event.settledMs)]] : undefined);
  }
  hold(event) {
    const {
      long,
      silent
    } = event;
    const what = event.blockers.length > 0 ? event.blockers.join(", ") : "a transition";
    const label = event.origin !== undefined ? `${this.origin(event.origin)} — waiting on ${what}` : `waiting on ${what}`;
    let properties;
    if (this.rich) {
      properties = [["Held", ms(event.holdMs)], ["Tail", `${ms(event.tailMs)} (last write → commit)`], ["Flushes", String(event.flushes)], ["Held writes", event.heldWrites.map(heldWrite).join(", ") || "none"], ["Acknowledged by", event.acknowledgements.map(a => `${a.kind}(${a.source})`).join(", ") || "nothing"], ["Painted during hold", String(event.paintedDuringHold)]];
      if (silent) properties.push(["Verdict", "silent hold — no feedback while waiting"]);
      if (long) properties.push(["Verdict", "long hold"]);
      if (event.action) properties.push(["Action", "yes"]);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(label, event.at, event.at + event.holdMs, TRACKS.holds, long ? "error" : silent ? "warning" : "tertiary", undefined, properties);
  }
  navigation(event) {
    if (event.settledMs === undefined) return;
    let properties;
    if (this.rich) {
      properties = [["Settled", ms(event.settledMs)], ["Writes", String(event.writes)]];
      if (event.to !== undefined) properties.push(["To", event.to]);
      if (event.from !== undefined) properties.push(["From", event.from]);
      if (event.params !== undefined) {
        const params = Object.entries(event.params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(", ");
        if (params) properties.push(["Params", params]);
      }
      if (event.redirects !== undefined) properties.push(["Redirected from", event.redirects.map(hop => hop.to ?? hop.name ?? "?").join(" → ")]);
      if (event.outcome !== undefined) properties.push(["Outcome", event.outcome]);
      if (event.interaction !== undefined) properties.push(["Interaction", this.origin(event.interaction)]);
    }
    this.emit.span(formatOrigin(event.origin), event.at, event.at + event.settledMs, TRACKS.navigations, event.outcome === "superseded" ? "secondary-light" : event.outcome === "held" ? "tertiary" : "secondary", undefined, properties);
  }
  call(event) {
    let label = `${event.method} ${event.id}`;
    if (event.status !== undefined) label += ` · ${event.status}`;
    let properties;
    if (this.rich) {
      properties = [["Duration", ms(event.durationMs)], ["Outcome", event.outcome]];
      if (event.status !== undefined) properties.push(["Status", String(event.status)]);
      if (event.deferred) properties.push(["Deferred", "the body is consumed by the caller"]);
      if (event.origin !== undefined) properties.push(["Origin", this.origin(event.origin)]);
    }
    this.emit.span(label, event.at, event.at + event.durationMs, TRACKS.server, event.outcome === "error" ? "error" : "secondary", undefined, properties);
  }
  frame(event) {
    if (event.side !== "client") return;
    const label = `frame ${event.id || "(unnamed)"}`;
    let properties;
    if (this.rich) {
      properties = [["Duration", ms(event.durationMs)], ["Outcome", event.outcome], ["Chunks", String(event.chunks)], ["Fragments", String(event.fragments)], ["Slots", String(event.slots)], ["Regions", String(event.regions)], ["Errors", String(event.errors)], ["Version", String(event.version)]];
      if (event.shellMs !== undefined) properties.splice(1, 0, ["Shell", ms(event.shellMs)]);
      if (event.address !== undefined) properties.push(["Applied as", event.address]);
    }
    if (event.shellMs !== undefined && event.shellMs > 0) {
      this.emit.span(`${label} · shell`, event.at, event.at + event.shellMs, TRACKS.server, "secondary-light");
    }
    this.emit.span(label, event.at, event.at + event.durationMs, TRACKS.server, event.outcome === "complete" ? "secondary" : "error", undefined, properties);
  }
  causeLabels(causes) {
    const labels = new Set();
    for (const c of causes) {
      const name = (c.kind === "derived" && c.nodeId !== undefined ? this.names.get(c.nodeId) : undefined) ?? c.name;
      labels.add(c.kind === "async" ? `${name} landed` : c.kind === "refresh" ? `refresh ${name}` : name);
    }
    return [...labels].join(", ");
  }
  writes(roots, limit) {
    const shown = roots.slice(0, limit).map(r => {
      let out = r.kind === "async" ? `${r.name} landed` : r.kind === "refresh" ? `refresh ${r.name}` : r.name;
      if (r.prev !== undefined) out += ` ${r.prev} → ${r.value}`;
      return out;
    });
    if (roots.length > limit) shown.push(`+${roots.length - limit} more`);
    return shown.join(", ");
  }
  origin(origin) {
    return formatOrigin(origin);
  }
}
const FLOW_INTERNALS = {
  "<Show>": new Set(["condition value", "condition", "value"]),
  "<Switch>": new Set(["children", "conditions", "condition value", "condition", "eval conditions"]),
  "<Loading>": new Set(["children", "boundary", "value"]),
  "<Errored>": new Set(["children", "boundary", "value"]),
  "<Reveal>": new Set(["reveal order"])
};
const FLOW_TAGS = new Set(["<Show>", "<For>", "<Repeat>", "<Switch>", "<Match>", "<Errored>", "<Loading>", "<Reveal>", "<Portal>", "<Dynamic>"]);
function nearest(segments) {
  for (let i = segments.length - 1; i > 0; i--) {
    const s = segments[i];
    if (s.charCodeAt(0) === 60  && !FLOW_TAGS.has(s)) return segments.slice(i);
  }
  return segments;
}
function describe(nodeName, path) {
  const full = path === undefined ? [nodeName] : path[path.length - 1] === nodeName ? path : [...path, nodeName];
  const segments = [];
  let flow;
  let internal;
  for (let i = 0; i < full.length; i++) {
    const name = full[i];
    let shown;
    if (flow !== undefined && flow.has(name)) {
      internal = name;
    } else {
      flow = FLOW_INTERNALS[name];
      const dot = name.indexOf(".");
      if (dot > 0 && name.charCodeAt(0) !== 60 ) {
        shown = name.slice(0, dot);
        internal = name.slice(dot + 1);
      } else {
        shown = name;
        internal = undefined;
      }
    }
    if (shown !== undefined && shown !== segments[segments.length - 1]) segments.push(shown);
  }
  const short = segments[segments.length - 1];
  const label = nearest(segments).join(" › ");
  const described = {
    label,
    short
  };
  if (internal !== undefined) described.internal = internal;
  const runtimePath = full.join(" › ");
  if (runtimePath !== label) described.path = runtimePath;
  return described;
}
function taskOf(subject) {
  if (!subject) return undefined;
  let owner = "_parent" in subject ? subject : subject._owner;
  for (; owner != null; owner = owner._parent) {
    const task = owner._component?.task;
    if (task !== undefined) return task;
  }
  return undefined;
}
function rootOrigin(causes) {
  for (const c of causes) {
    let root = c;
    while (root.causes !== undefined && root.causes.length > 0) root = root.causes[0];
    if (root.origin !== undefined && root.origin.kind !== "external") return root.origin;
  }
  return undefined;
}
function collectRoots(causes, out) {
  for (const c of causes) {
    if (c.kind === "derived") {
      if (c.causes !== undefined) collectRoots(c.causes, out);
    } else out.add(c);
  }
}
function bySelfTime(selfMs) {
  return selfMs < 0.5 ? "primary-light" : selfMs < 10 ? "primary" : selfMs < 100 ? "primary-dark" : "error";
}
const SOLID_METRIC = /^solid-(invocation|shell|boundary)$/;
const PENDING_MS = 30_000;
class ServerSpans {
  pending = [];
  constructor(emit) {
    this.emit = emit;
  }
  start() {
    this.navigation();
    if (typeof PerformanceObserver !== "function") return;
    try {
      const observer = new PerformanceObserver(list => this.resources(list.getEntries()));
      observer.observe({
        type: "resource",
        buffered: true
      });
      this.observer = observer;
    } catch {
      this.observer = undefined;
    }
  }
  dispose() {
    if (this.observer !== undefined) this.observer.disconnect();
    this.observer = undefined;
    this.pending.length = 0;
  }
  call(event, live) {
    const response = live.response;
    if (response === undefined) return;
    let header;
    try {
      header = response.headers.get("server-timing");
    } catch {
      return;
    }
    if (!header) return;
    const metrics = parseServerTiming(header).filter(m => SOLID_METRIC.test(m.name));
    if (metrics.length === 0) return;
    if (this.observer === undefined) {
      this.paint(metrics, event, undefined);
      return;
    }
    if (typeof performance.getEntriesByName === "function") {
      const entry = findResource(performance.getEntriesByName(response.url, "resource"), event);
      if (entry !== undefined) {
        this.paint(metrics, event, entry);
        return;
      }
    }
    this.pending.push({
      event,
      url: response.url,
      metrics,
      expires: performance.now() + PENDING_MS
    });
  }
  resources(entries) {
    const pending = this.pending;
    if (pending.length === 0) return;
    const now = performance.now();
    for (let i = pending.length - 1; i >= 0; i--) {
      const call = pending[i];
      if (call.expires <= now) {
        pending.splice(i, 1);
        continue;
      }
      const entry = findResource(entries.filter(e => e.name === call.url), call.event);
      if (entry === undefined) continue;
      pending.splice(i, 1);
      this.paint(call.metrics, call.event, entry);
    }
  }
  navigation() {
    if (typeof performance.getEntriesByType !== "function") return;
    const [nav] = performance.getEntriesByType("navigation");
    if (nav === undefined || !Array.isArray(nav.serverTiming) || !(nav.responseStart > 0)) return;
    const end = nav.responseStart;
    const rich = this.emit.rich;
    for (const metric of nav.serverTiming) {
      if (!SOLID_METRIC.test(metric.name)) continue;
      const kind = metric.name.slice(6);
      const path = kind === "boundary" ? metric.description.split(" > ") : undefined;
      const label = kind === "shell" ? "shell · server" : path !== undefined ? `boundary ${nearest(path).join(" › ")} · server` : `${metric.description} · server`;
      let properties;
      if (rich) {
        properties = [["Duration", ms(metric.duration)], ["Source", "Server-Timing on the document"], ["Placement", kind === "shell" ? "ends at responseStart — the head left when the shell was ready" : "ends with the shell — settled at or before the flush"]];
        if (path !== undefined && nearest(path).length !== path.length) properties.push(["Owner path", path.join(" › ")]);
      }
      this.emit.span(label, end - metric.duration, end, TRACKS.server, kind === "shell" ? "tertiary" : "tertiary-light", undefined, properties);
    }
  }
  paint(metrics, event, entry) {
    const rich = this.emit.rich;
    const end = entry !== undefined && entry.responseStart > 0 ? entry.responseStart : undefined;
    const mid = event.at + event.durationMs / 2;
    for (const metric of metrics) {
      const start = end !== undefined ? end - metric.duration : mid - metric.duration / 2;
      const stop = end !== undefined ? end : mid + metric.duration / 2;
      const label = `${metric.description || event.id} · server`;
      let properties;
      if (rich) {
        properties = [["Duration", ms(metric.duration)], ["Wire", ms(Math.max(0, event.durationMs - metric.duration))], ["Source", "Server-Timing"], ["Placement", end !== undefined ? "ends at the response's responseStart" : "centred in the call — no resource timing for this fetch"]];
      }
      this.emit.span(label, start, stop, TRACKS.server, "tertiary", undefined, properties);
    }
  }
}
function findResource(entries, event) {
  const from = event.at - 1;
  const to = event.at + event.durationMs + 1;
  for (const entry of entries) {
    if (entry.startTime >= from && entry.startTime <= to) {
      return entry;
    }
  }
  return undefined;
}
function parseServerTiming(value) {
  const out = [];
  let start = 0;
  let quoted = false;
  const take = end => {
    const entry = value.slice(start, end).trim();
    if (entry === "") return;
    const parts = splitParams(entry);
    const name = parts[0].trim().toLowerCase();
    if (name === "") return;
    let duration;
    let description = "";
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      if (eq === -1) continue;
      const key = parts[i].slice(0, eq).trim().toLowerCase();
      const raw = parts[i].slice(eq + 1).trim();
      if (key === "dur") duration = Number(raw);else if (key === "desc") description = unquote(raw);
    }
    if (duration === undefined || !(duration >= 0)) return;
    out.push({
      name,
      duration,
      description
    });
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\") i++;else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;else if (c === ",") {
      take(i);
      start = i + 1;
    }
  }
  take(value.length);
  return out;
}
function splitParams(entry) {
  const parts = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (quoted) {
      if (c === "\\") i++;else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;else if (c === ";") {
      parts.push(entry.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(entry.slice(start));
  return parts;
}
function unquote(raw) {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    return raw.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return raw;
}
function ms(value) {
  return `${value.toFixed(2)}ms`;
}
function rootCause(cause) {
  let root = cause;
  while (root.causes !== undefined && root.causes.length > 0) root = root.causes[0];
  let out = `${root.kind === "derived" ? "memo" : "signal"} "${root.name}" ${root.kind}`;
  if (root.prev !== undefined) out += ` ${root.prev} → ${root.value}`;
  if (root.origin !== undefined && root.origin.kind !== "external") out += ` — ${formatOrigin(root.origin)}`;
  return out;
}
function heldWrite(write) {
  return write.prev === undefined ? write.name : `${write.name} ${write.prev} → ${write.value}`;
}

export { enablePerformanceTracks };
