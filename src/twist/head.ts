// The document head, kept by what registers tags (useHead), as Solid's head registry does: replaceable tags (title,
// meta, icons…) shown from the last group to register each identity, restored as groups go; resource hints mounted
// at once and kept; stylesheets warmed as preloads, holding what shows with them until they load, then made live and
// let go of once no one holds them.
import { createMemo, createRenderEffect, createRoot, onCleanup, runWithOwner, untrack } from "./signals.ts";

declare const process: { env: Record<string, string | undefined> };

export type HeadDesc = { tag: string; props?: Record<string, any>; key?: any };
type Tag = { tag: string; attrs: Record<string, unknown>; text: string | null; identity: string };
type Group = { seq: number; tags: Tag[] };

const HEAD_TAGS = new Set(["title", "meta", "link", "style", "script", "noscript", "base"]);
/** Written once by the document's shell: the client never takes them over. */
const SHELL_ONLY = new Set(["base"]);
/** Hints: mounted at once, deduped, never retracted. */
const HINT_RELS = new Set(["preload", "modulepreload", "prefetch", "preconnect", "dns-prefetch"]);
/** Attributes that only shape a stylesheet's fetch: it still gates (and they ride its preload). */
const FETCH_ONLY = new Set(["rel", "href", "crossorigin", "referrerpolicy", "integrity", "fetchpriority", "nonce", "blocking"]);

const read = (v: unknown) => (typeof v === "function" ? (v as () => unknown)() : v);

// ---------------------------------------------------------------- replaceable tags

const groups = new Set<Group>();
let seq = 0;
let scheduled = false;
/** What the document's own <title> said before any registration (or what the server stashed): shown when none is left. */
let fallbackTitle: string | null | undefined;
/** Elements this registry placed, by identity. */
const placed = new Map<string, Element[]>();

/** What a tag stands for: the one of its kind a later registration replaces. */
function identityOf(tag: string, a: Record<string, unknown>): string {
  if (tag === "title") return "title";
  const media = a.media != null ? `:media:${a.media}` : "";
  if (tag === "meta") {
    if (a.charset != null) return "meta:charset";
    for (const k of ["name", "property", "http-equiv", "itemprop"]) if (a[k] != null) return `meta:${k}:${a[k]}${media}`;
    return `meta:${JSON.stringify(a)}`;
  }
  if (tag === "link") return `link:${a.rel}:${a.sizes ?? ""}:${a.type ?? ""}${media}${a.rel === "alternate" ? `:${a.hreflang ?? ""}` : ""}`;
  return `${tag}:${a.id ?? a.key ?? JSON.stringify(a)}`;
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(apply);
}

function titleElement(create: boolean): HTMLTitleElement | null {
  let t = document.head.querySelector("title");
  if (!t && create) document.head.appendChild((t = document.createElement("title")));
  return t;
}

function initRegistry() {
  if (fallbackTitle !== undefined) return;
  const t = titleElement(false);
  // (A title the server already rewrote keeps the shell's text in its stash.)
  fallbackTitle = t ? (t.getAttribute("data-dhf") ?? t.textContent) : null;
}

function setAttrs(el: Element, attrs: Record<string, unknown>, identity: string) {
  for (const name of [...el.getAttributeNames()]) if (name !== "data-dh" && !(name in attrs)) el.removeAttribute(name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) el.removeAttribute(k);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.setAttribute("data-dh", identity);
}

/** The head made to match the registrations: per identity, the last group's tags. */
function apply() {
  scheduled = false;
  const winners = new Map<string, Tag[]>();
  const by = new Map<string, number>();
  for (const g of [...groups].sort((a, b) => a.seq - b.seq))
    for (const t of g.tags) {
      if (by.get(t.identity) !== g.seq) winners.set(t.identity, []), by.set(t.identity, g.seq);
      winners.get(t.identity)!.push(t);
    }
  // The title: the winner's text on the one <title>, else the shell's own back.
  const title = winners.get("title");
  const el = titleElement(!!title);
  if (title) {
    el!.textContent = title[title.length - 1]!.text ?? "";
    el!.setAttribute("data-dh", "title");
  } else if (el && el.hasAttribute("data-dh")) {
    if (fallbackTitle == null) el.remove();
    else el.textContent = fallbackTitle;
    el.removeAttribute("data-dh");
    el.removeAttribute("data-dhf");
  }
  winners.delete("title");
  for (const identity of new Set([...placed.keys(), ...winners.keys()])) {
    const want = winners.get(identity) ?? [];
    const have = placed.get(identity) ?? [];
    const next: Element[] = [];
    want.forEach((t, i) => {
      const e = have[i] ?? document.head.appendChild(document.createElement(t.tag));
      setAttrs(e, t.attrs, identity);
      if (t.text != null && e.textContent !== t.text) e.textContent = t.text;
      next.push(e);
    });
    for (let i = want.length; i < have.length; i++) have[i]!.remove();
    if (next.length) placed.set(identity, next);
    else placed.delete(identity);
  }
}

// ---------------------------------------------------------------- hints

/** A hint the head has already (the same rel, href and `as`). */
function findLink(rel: string, href: string, as?: unknown): HTMLLinkElement | null {
  for (const el of document.head.querySelectorAll("link"))
    if (el.getAttribute("rel") === rel && el.getAttribute("href") === href && (as == null || el.getAttribute("as") === String(as))) return el as HTMLLinkElement;
  return null;
}

/** What a hint's fetch is keyed on besides its rel and href (Solid's rule). */
const QUALIFIERS = ["as", "crossorigin", "type", "media", "imagesrcset", "imagesizes"];
/** A qualifier as hints compare it: `as` in lower case, any CORS spelling but credentials anonymous, empty source sets none. */
function qualifier(name: string, v: unknown): string | null {
  if (v == null || v === false) return null;
  if (name === "imagesrcset" || name === "imagesizes") return typeof v === "string" && v !== "" ? v : null;
  const s = v === true ? "" : String(v);
  if (name === "as") return s.toLowerCase();
  if (name !== "crossorigin") return s;
  return s.toLowerCase() === "use-credentials" ? "use-credentials" : "anonymous";
}
/** The head's hint these attributes name: the same href (or none, for a source set) and the same qualifiers. */
function sameHint(attrs: Record<string, unknown>): Element | null {
  const href = attrs.href == null ? null : String(attrs.href);
  for (const el of document.head.querySelectorAll(`link[rel="${attrs.rel}"]`))
    if (el.getAttribute("href") === href && QUALIFIERS.every((q) => qualifier(q, attrs[q]) === qualifier(q, el.getAttribute(q)))) return el;
  return null;
}

function hint(attrs: Record<string, unknown>) {
  if (sameHint(attrs)) return;
  const el = document.createElement("link");
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  document.head.appendChild(el);
}

// ---------------------------------------------------------------- stylesheets

/** One registration of a stylesheet: whether it holds the sheet yet. */
type Hold = { held: boolean };
type Sheet = { link: HTMLLinkElement; loaded: boolean; holders: number; waiting: Set<Hold>; ready: () => unknown };
const sheets = new Map<string, Sheet>();

/** A stylesheet's record: warming (a preload), or adopted from the head (one the server wrote is loaded already). */
function sheetOf(href: string, attrs: Record<string, unknown>): Sheet {
  let s = sheets.get(href);
  if (s) return s;
  let link = findLink("stylesheet", href) ?? findLink("preload", href, "style");
  // (The server's sheet, in the page: loaded by the time anything reveals.)
  const loaded = !!link && link.getAttribute("rel") === "stylesheet" && !!(link as any).sheet;
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "preload");
    link.setAttribute("as", "style");
    link.setAttribute("href", href);
    for (const [k, v] of Object.entries(attrs)) if (k !== "rel" && k !== "href" && v != null && v !== false) link.setAttribute(k, v === true ? "" : String(v));
    // (Before the document has a body: it holds the first paint, as a sheet in the head would.)
    if (!document.body) link.setAttribute("blocking", "render");
    document.head.appendChild(link);
  }
  let done!: () => void;
  const promise = new Promise<void>((ok) => (done = ok));
  // (Made detached: it takes no id from whatever registers the sheet.)
  const ready = runWithOwner(null, () => createRoot(() => createMemo(() => promise.then(() => true))));
  sheets.set(href, (s = { link, loaded, holders: 0, waiting: new Set(), ready }));
  if (loaded) done();
  // (Loaded: each registration still waiting holds it from now, and it is live.)
  const settle = () => {
    s!.loaded = true;
    for (const h of s!.waiting) take(s!, h);
    s!.waiting.clear();
    done();
  };
  link.addEventListener("load", settle);
  // (A sheet that fails holds nothing up: shown anyway.)
  link.addEventListener("error", settle);
  return s;
}

/** Held by one more registration, and live: the preload made the stylesheet. */
function take(s: Sheet, h: Hold) {
  if (h.held) return;
  h.held = true;
  s.holders++;
  if (s.link.getAttribute("rel") === "stylesheet") return;
  s.link.setAttribute("rel", "stylesheet");
  s.link.removeAttribute("as");
}
/** Let go of by one registration: removed once none holds it (after a turn, so a swap does not flash). */
function release(s: Sheet, href: string, h: Hold) {
  s.waiting.delete(h);
  if (!h.held) return;
  h.held = false;
  if (--s.holders > 0) return;
  setTimeout(() => {
    if (s.holders > 0) return;
    s.link.remove();
    sheets.delete(href);
  });
}

/** A stylesheet registration: warmed now, and (unless it only applies under a condition) holding until it loads. */
function stylesheet(attrs: Record<string, unknown>) {
  const href = String(attrs.href ?? "");
  const s = sheetOf(href, attrs);
  const gated = Object.keys(attrs).every((k) => FETCH_ONLY.has(k) || attrs[k] == null || attrs[k] === false);
  if (!gated) for (const [k, v] of Object.entries(attrs)) if (k !== "rel" && v != null && v !== false) s.link.setAttribute(k, v === true ? "" : String(v));
  // (Waiting for the load, which makes it hold the sheet; gone before then, it leaves the preload inert.)
  const h: Hold = { held: false };
  if (gated && !s.loaded) s.waiting.add(h);
  createRenderEffect(
    () => {
      // (Read as an async value: what waits on it holds as for any data, the committed view staying.)
      if (gated && !s.loaded) return s.ready();
      return true;
    },
    () => take(s, h),
    { transparent: true } as any,
  );
  onCleanup(() => release(s, href, h));
}

// ---------------------------------------------------------------- registration

/**
 * Tags for the document's head, kept current: the latest registration of each identity shows (a title, a meta, an
 * icon…), the one before it back when it goes; hints are added once; stylesheets hold what shows with them until
 * they load. Its props are read where it runs.
 */
export function useHead(tags: HeadDesc | HeadDesc[] | (() => HeadDesc | HeadDesc[])) {
  if (typeof document === "undefined") return;
  initRegistry();
  const group: Group = { seq: ++seq, tags: [] };
  groups.add(group);
  createRenderEffect(
    () => {
      const list = typeof tags === "function" ? tags() : tags;
      const replaceable: Tag[] = [];
      for (const d of Array.isArray(list) ? list : [list]) {
        if (!d) continue;
        if (!HEAD_TAGS.has(d.tag)) {
          if (process.env.NODE_ENV !== "production") console.warn(`useHead: <${d.tag}> is not a head tag; skipped.`);
          continue;
        }
        const attrs: Record<string, unknown> = {};
        for (const k of Object.keys(d.props ?? {})) if (k !== "children" && !/^on[A-Z]/.test(k)) attrs[k] = read(d.props![k]);
        if (SHELL_ONLY.has(d.tag) || (d.tag === "meta" && attrs.charset != null)) {
          if (process.env.NODE_ENV !== "production") console.warn(`useHead: <${d.tag}> is shell-only: the document's shell writes it; skipped on the client.`);
          continue;
        }
        const rel = d.tag === "link" ? String(attrs.rel ?? "") : "";
        if (rel === "stylesheet") untrack(() => stylesheet(attrs));
        else if (HINT_RELS.has(rel)) untrack(() => hint(attrs));
        else {
          const text = read(d.props?.children);
          replaceable.push({ tag: d.tag, attrs, text: text == null ? null : String(text), identity: identityOf(d.tag, attrs) });
        }
      }
      return replaceable;
    },
    (replaceable) => {
      group.tags = replaceable;
      schedule();
    },
    { transparent: true } as any,
  );
  onCleanup(() => {
    groups.delete(group);
    schedule();
  });
}

