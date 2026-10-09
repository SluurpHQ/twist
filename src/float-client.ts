// Float in the browser: ReactDOM.preload and friends put their <link>/<script> in the document's <head> once, and
// stylesheets with a precedence, async scripts and <style href precedence> are shared resources, as React's.
import { setProps } from "./props.ts";

const NOT_LOADED = 0, LOADED = 1, ERRORED = 2, SETTLED = 3, INSERTED = 4;
export type Resource = { type: "stylesheet" | "style" | "script" | "void"; instance: Element | null; count: number; state: { loading: number; preload: Element | null } | null };

/** Per document: what was preloaded (props a later stylesheet or script adopts) and which hints are in. */
const preloadProps = new WeakMap<Document, Map<string, any>>();
const preconnects = new WeakMap<Document, Set<string>>();
/** Per document or shadow root: its shared stylesheets and scripts. */
const roots = new WeakMap<Node, { styles: Map<string, Resource>; scripts: Map<string, Resource> }>();
/** Elements Float made or adopted (never a fiber's own). */
export const HOISTABLE = Symbol("hoistable");
const LOAD_PENDING = Symbol("loadPending");

const doc = (): Document | null => (typeof document === "undefined" ? null : document);
const mapOf = <K extends object, V>(m: WeakMap<K, V>, k: K, make: () => V) => {
  let v = m.get(k);
  if (!v) m.set(k, (v = make()));
  return v;
};
export const resourcesOf = (root: Node) => mapOf(roots, root, () => ({ styles: new Map(), scripts: new Map() }));
const preloadsOf = (d: Document) => mapOf(preloadProps, d, () => new Map());

export const escapeSelector = (v: string) => String(v).replace(/[\n"\\]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ");
export const styleKey = (href: string) => `href="${escapeSelector(href)}"`;
export const stylesheetSelector = (key: string) => `link[rel="stylesheet"][${key}]`;
export const scriptKey = (src: string) => `[src="${escapeSelector(src)}"]`;
export const scriptSelector = (key: string) => `script[async]${key}`;

const make = (d: Document, tag: string, props: any) => {
  const el = d.createElement(tag);
  (el as any)[HOISTABLE] = true;
  setProps(el, props, {}, false);
  // A <style>'s or <script>'s one text child is its content.
  const c = Array.isArray(props.children) ? (props.children.length < 2 ? props.children[0] : null) : props.children;
  if (typeof c === "string" || typeof c === "number" || typeof c === "bigint") el.textContent = String(c);
  return el;
};
export const markHoistable = (el: Element) => ((el as any)[HOISTABLE] = true);

function preconnectAs(rel: string, href: string, crossOrigin: any) {
  const d = doc();
  if (!d || typeof href !== "string" || !href) return;
  let selector = `link[rel="${rel}"][href="${escapeSelector(href)}"]`;
  if (typeof crossOrigin === "string") selector += `[crossorigin="${crossOrigin}"]`;
  const seen = mapOf(preconnects, d, () => new Set());
  if (seen.has(selector)) return;
  seen.add(selector);
  if (d.querySelector(selector) === null) d.head.appendChild(make(d, "link", { rel, crossOrigin, href }));
}

/** ReactDOM's dispatcher in the browser (Internals.d): D, C, L, m, X, S, M as React names them. */
export const clientDispatcher = {
  D(href: string) {
    preconnectAs("dns-prefetch", href, null);
  },
  C(href: string, crossOrigin: any) {
    preconnectAs("preconnect", href, crossOrigin);
  },
  L(href: string, as: string, options?: any) {
    const d = doc();
    if (!d || !href || !as) return;
    let selector = `link[rel="preload"][as="${escapeSelector(as)}"]`;
    if (as === "image" && options?.imageSrcSet) {
      selector += `[imagesrcset="${escapeSelector(options.imageSrcSet)}"]`;
      if (typeof options.imageSizes === "string") selector += `[imagesizes="${escapeSelector(options.imageSizes)}"]`;
    } else selector += `[href="${escapeSelector(href)}"]`;
    const key = as === "style" ? styleKey(href) : as === "script" ? scriptKey(href) : selector;
    const map = preloadsOf(d);
    if (map.has(key)) return;
    const props = { rel: "preload", href: as === "image" && options?.imageSrcSet ? undefined : href, as, ...options };
    map.set(key, props);
    if (d.querySelector(selector) !== null || (as === "style" && d.querySelector(stylesheetSelector(key))) || (as === "script" && d.querySelector(scriptSelector(key)))) return;
    const el = make(d, "link", props);
    if (as === "style") {
      (el as any)[LOAD_PENDING] = true;
      (el as any).onload = (el as any).onerror = () => ((el as any)[LOAD_PENDING] = false);
    }
    d.head.appendChild(el);
  },
  m(href: string, options?: any) {
    const d = doc();
    if (!d || !href) return;
    const as = typeof options?.as === "string" ? options.as : "script";
    const selector = `link[rel="modulepreload"][as="${escapeSelector(as)}"][href="${escapeSelector(href)}"]`;
    const scriptLike = ["audioworklet", "paintworklet", "serviceworker", "sharedworker", "worker", "script"].includes(as);
    const key = scriptLike ? scriptKey(href) : selector;
    const map = preloadsOf(d);
    if (map.has(key)) return;
    const props = { rel: "modulepreload", href, ...options };
    map.set(key, props);
    if (d.querySelector(selector) !== null) return;
    if (scriptLike && d.querySelector(scriptSelector(key))) return;
    d.head.appendChild(make(d, "link", props));
  },
  X(src: string, options?: any) {
    initScript(src, { src, async: true, ...options });
  },
  M(src: string, options?: any) {
    initScript(src, { src, async: true, type: "module", ...options });
  },
  S(href: string, precedence?: string, options?: any) {
    const d = doc();
    if (!d || !href) return;
    const styles = resourcesOf(d).styles;
    const key = styleKey(href);
    precedence ||= "default";
    if (styles.get(key)) return;
    const state = { loading: NOT_LOADED, preload: null };
    let el = d.querySelector(stylesheetSelector(key));
    if (el) state.loading = LOADED | INSERTED;
    else {
      const props = { rel: "stylesheet", href, "data-precedence": precedence, ...options };
      const pre = preloadsOf(d).get(key);
      if (pre) adoptForStylesheet(props, pre);
      el = stylesheetLink(d, props, state);
      state.loading |= INSERTED;
      insertStylesheet(el, precedence, d);
    }
    styles.set(key, { type: "stylesheet", instance: el, count: 1, state });
  },
};

function initScript(src: string, props: any) {
  const d = doc();
  if (!d || !src) return;
  const scripts = resourcesOf(d).scripts;
  const key = scriptKey(src);
  if (scripts.get(key)) return;
  let el = d.querySelector(scriptSelector(key));
  if (!el) {
    const pre = preloadsOf(d).get(key);
    if (pre) adoptForScript(props, pre);
    el = make(d, "script", props);
    d.head.appendChild(el);
  }
  scripts.set(key, { type: "script", instance: el, count: 1, state: null });
}

/** A stylesheet <link> whose load React waits on (`_p`), its state told when it loads or fails. */
function stylesheetLink(d: Document, props: any, state?: { loading: number }) {
  const el: any = make(d, "link", props);
  el._p = new Promise((resolve, reject) => {
    el.onload = resolve;
    el.onerror = reject;
  });
  el._p.catch(() => {});
  if (state) {
    el.addEventListener("load", () => (state.loading |= LOADED));
    el.addEventListener("error", () => (state.loading |= ERRORED));
  }
  return el as Element;
}

/** After the last of its precedence, or after the last precedence there is; first in <head> if none. */
export function insertStylesheet(el: Element, precedence: string, root: Document | ShadowRoot | Node) {
  const nodes = (root as ParentNode).querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]');
  const last = nodes.length ? nodes[nodes.length - 1]! : null;
  let prior = last;
  for (const node of nodes) {
    if ((node as HTMLElement).dataset.precedence === precedence) prior = node;
    else if (prior !== last) break;
  }
  if (prior) prior.parentNode!.insertBefore(el, prior.nextSibling);
  else {
    const parent = root.nodeType === 9 ? (root as Document).head : root;
    parent.insertBefore(el, parent.firstChild);
  }
}

function adoptForStylesheet(props: any, pre: any) {
  if (props.crossOrigin == null) props.crossOrigin = pre.crossOrigin;
  if (props.referrerPolicy == null) props.referrerPolicy = pre.referrerPolicy;
  if (props.title == null) props.title = pre.title;
}
function adoptForScript(props: any, pre: any) {
  if (props.crossOrigin == null) props.crossOrigin = pre.crossOrigin;
  if (props.referrerPolicy == null) props.referrerPolicy = pre.referrerPolicy;
  if (props.integrity == null) props.integrity = pre.integrity;
}

// ---------------------------------------------------------------- elements as resources and hoistables

/** Where a fiber's resources live: its container's document or shadow root. */
export function hoistableRoot(container: Node): Document | ShadowRoot {
  const r = typeof (container as any).getRootNode === "function" ? (container as any).getRootNode() : null;
  // A shadow root holds its own; a plain fragment (a render off the page) is its document's.
  if (r && (r.nodeType === 9 || (r.nodeType === 11 && (r as ShadowRoot).host))) return r;
  return container.nodeType === 9 ? (container as Document) : container.ownerDocument!;
}

// ---------------------------------------------------------------- commits that wait for stylesheets

/** A render's stylesheets not yet in the document: its commit waits for them (React's suspensey CSS). */
export type CommitWait = {
  count: number;
  stylesheets: Map<Resource, Document | ShadowRoot> | null;
  unsuspend: (() => void) | null;
};
export const newCommitWait = (): CommitWait => ({ count: 0, stylesheets: null, unsuspend: null });

/** A stylesheet the commit should wait on (React's suspendResource). */
export function suspendResource(state: CommitWait, root: Document | ShadowRoot, r: Resource, props: any) {
  if (r.type !== "stylesheet") return;
  if (typeof props.media === "string" && typeof matchMedia === "function" && matchMedia(props.media).matches === false) return;
  if ((r.state!.loading & INSERTED) !== NOT_LOADED) return;
  if (r.instance === null) {
    const key = styleKey(props.href);
    const found: any = root.querySelector(stylesheetSelector(key));
    if (found) {
      const p = found._p;
      if (p && typeof p === "object" && typeof p.then === "function") {
        state.count++;
        const done = () => unsuspended(state);
        p.then(done, done);
      }
      r.state!.loading |= INSERTED;
      r.instance = found;
      markHoistable(found);
      return;
    }
    const d: Document = (root as any).ownerDocument || root;
    const sp = { ...props, "data-precedence": props.precedence, precedence: null };
    const pre = preloadsOf(d).get(key);
    if (pre) adoptForStylesheet(sp, pre);
    r.instance = stylesheetLink(d, sp);
  }
  (state.stylesheets ??= new Map()).set(r, root);
  const preload = r.state!.preload;
  if (preload && (r.state!.loading & SETTLED) === NOT_LOADED) {
    state.count++;
    const done = () => unsuspended(state);
    preload.addEventListener("load", done);
    preload.addEventListener("error", done);
  }
}

/** How the commit goes on: at once (null), or by `wait(commit)` once the stylesheets have loaded (a minute at most). */
export function commitWhenReady(state: CommitWait): ((commit: () => void) => () => void) | null {
  if (state.stylesheets && state.count === 0) insertSuspended(state);
  if (state.count === 0) return null;
  return (commit) => {
    const timer = setTimeout(() => {
      if (state.stylesheets) insertSuspended(state);
      const go = state.unsuspend;
      state.unsuspend = null;
      go?.();
    }, 60000);
    state.unsuspend = commit;
    return () => {
      state.unsuspend = null;
      clearTimeout(timer);
    };
  };
}

function unsuspended(state: CommitWait) {
  state.count--;
  if (state.count !== 0) return;
  if (state.stylesheets) insertSuspended(state);
  else if (state.unsuspend) {
    const go = state.unsuspend;
    state.unsuspend = null;
    go();
  }
}

/** The waited-for stylesheets put in place, by precedence; the commit goes on once they have loaded. */
function insertSuspended(state: CommitWait) {
  const resources = state.stylesheets!;
  state.stylesheets = null;
  // Nothing waiting (their preloads had all loaded): the commit goes on and puts them in itself.
  if (state.unsuspend === null) return;
  state.count++;
  const byRoot = new Map<Node, Map<string | null, Element>>();
  for (const [r, root] of resources) {
    if (r.state!.loading & INSERTED) continue;
    let precedences = byRoot.get(root);
    let last: Element | null | undefined;
    if (precedences) last = precedences.get(null);
    else {
      precedences = new Map();
      byRoot.set(root, precedences);
      for (const node of root.querySelectorAll("link[data-precedence],style[data-precedence]")) {
        if (node.nodeName === "LINK" || node.getAttribute("media") !== "not all") {
          precedences.set((node as HTMLElement).dataset.precedence!, node);
          last = node;
        }
      }
      if (last) precedences.set(null, last);
    }
    const el = r.instance!;
    const precedence = el.getAttribute("data-precedence");
    const prior = precedences.get(precedence) || last;
    if (prior === last) precedences.set(null, el);
    precedences.set(precedence, el);
    state.count++;
    const done = () => unsuspended(state);
    el.addEventListener("load", done);
    el.addEventListener("error", done);
    if (prior) prior.parentNode!.insertBefore(el, prior.nextSibling);
    else {
      const parent = root.nodeType === 9 ? (root as Document).head : root;
      parent.insertBefore(el, parent.firstChild);
    }
    r.state!.loading |= INSERTED;
  }
  unsuspended(state);
}

/** The shared resource an element stands for, or null for a hoistable (<title>, <meta>, other <link>s). */
export function getResource(root: Document | ShadowRoot, type: string, props: any): Resource | null {
  switch (type) {
    case "meta":
    case "title":
      return null;
    case "style": {
      if (typeof props.precedence !== "string" || typeof props.href !== "string") return { type: "void", instance: null, count: 0, state: null };
      const styles = resourcesOf(root).styles;
      const key = styleKey(props.href);
      let r = styles.get(key);
      if (!r) styles.set(key, (r = { type: "style", instance: null, count: 0, state: null }));
      return r;
    }
    case "link": {
      if (props.rel !== "stylesheet" || typeof props.href !== "string" || typeof props.precedence !== "string") return null;
      const key = styleKey(props.href);
      const styles = resourcesOf(root).styles;
      let r = styles.get(key);
      if (!r) {
        const d = (root as any).ownerDocument || (root as Document);
        r = { type: "stylesheet", instance: null, count: 0, state: { loading: NOT_LOADED, preload: null } };
        styles.set(key, r);
        const existing: any = root.querySelector(stylesheetSelector(key));
        if (existing) {
          if (!existing._p) {
            r.instance = existing;
            r.state!.loading = LOADED | INSERTED;
          }
        } else {
          const map = preloadsOf(d);
          let pre = map.get(key);
          if (!pre) {
            pre = { rel: "preload", as: "style", href: props.href, crossOrigin: props.crossOrigin, integrity: props.integrity, media: props.media, hrefLang: props.hrefLang, referrerPolicy: props.referrerPolicy };
            map.set(key, pre);
          }
          preloadStylesheet(d, key, pre, r.state!);
        }
      }
      return r;
    }
    case "script": {
      const a = props.async;
      if (typeof props.src !== "string" || !a || typeof a === "function" || typeof a === "symbol") return { type: "void", instance: null, count: 0, state: null };
      const scripts = resourcesOf(root).scripts;
      const key = scriptKey(props.src);
      let r = scripts.get(key);
      if (!r) scripts.set(key, (r = { type: "script", instance: null, count: 0, state: null }));
      return r;
    }
  }
  return null;
}

function preloadStylesheet(d: Document, key: string, props: any, state: { loading: number; preload: Element | null }) {
  let el: any = d.querySelector(`link[rel="preload"][as="style"][${key}]`);
  if (el) {
    if (el[LOAD_PENDING] !== true) {
      state.loading = LOADED;
      return;
    }
  } else {
    el = make(d, "link", props);
    el[LOAD_PENDING] = true;
    el.onload = el.onerror = () => (el[LOAD_PENDING] = false);
    d.head.appendChild(el);
  }
  state.preload = el;
  el.addEventListener("load", () => (state.loading |= LOADED));
  el.addEventListener("error", () => (state.loading |= ERRORED));
}

/** The resource's element, made and put in place the first time it is used. */
export function acquireResource(root: Document | ShadowRoot, r: Resource, props: any): Element | null {
  r.count++;
  if (r.instance === null) {
    const d: Document = (root as any).ownerDocument || root;
    switch (r.type) {
      case "style": {
        const found = root.querySelector(`style[data-href~="${escapeSelector(props.href)}"]`);
        if (found) return markHoistable(found), (r.instance = found);
        const el = make(d, "style", { ...props, "data-href": props.href, "data-precedence": props.precedence, href: null, precedence: null });
        insertStylesheet(el, props.precedence, root);
        return (r.instance = el);
      }
      case "stylesheet": {
        const key = styleKey(props.href);
        const found = root.querySelector(stylesheetSelector(key));
        if (found) {
          r.state!.loading |= INSERTED;
          markHoistable(found);
          return (r.instance = found);
        }
        const sp = { ...props, "data-precedence": props.precedence, precedence: null };
        const pre = preloadsOf(d).get(key);
        if (pre) adoptForStylesheet(sp, pre);
        const el = stylesheetLink(d, sp);
        r.state!.loading |= INSERTED;
        insertStylesheet(el, props.precedence, root);
        return (r.instance = el);
      }
      case "script": {
        const key = scriptKey(props.src);
        const found = root.querySelector(scriptSelector(key));
        if (found) return markHoistable(found), (r.instance = found);
        let sp = props;
        const pre = preloadsOf(d).get(key);
        if (pre) adoptForScript((sp = { ...props }), pre);
        const el = make(d, "script", sp);
        d.head.appendChild(el);
        return (r.instance = el);
      }
      case "void":
        return null;
    }
  } else if (r.type === "stylesheet" && (r.state!.loading & INSERTED) === NOT_LOADED) {
    r.state!.loading |= INSERTED;
    insertStylesheet(r.instance, props.precedence, root);
  }
  return r.instance;
}

/** One user fewer; the element stays in the document (React leaves resources in place). */
export function releaseResource(r: Resource) {
  r.count--;
}

/** Whether an element is a resource or hoistable rather than a plain node in its place (React's isHostHoistableType). */
export function isHoistable(type: string, props: any, svg: boolean, inContainer: boolean, warn: (m: string) => void): boolean {
  const outside = !inContainer;
  if (svg || props.itemProp != null) {
    if (outside && props.itemProp != null && (type === "meta" || type === "title" || type === "style" || type === "link" || type === "script"))
      warn(
        `Cannot render a <${type}> outside the main document if it has an \`itemProp\` prop. \`itemProp\` suggests the tag belongs to an \`itemScope\` which can appear anywhere in the DOM. If you were intending for React to hoist this <${type}> remove the \`itemProp\` prop. Otherwise, try moving this tag into the <head> or <body> of the Document.`,
      );
    return false;
  }
  switch (type) {
    case "meta":
    case "title":
      return true;
    case "style":
      if (typeof props.precedence !== "string" || typeof props.href !== "string" || props.href === "") {
        if (outside)
          warn(
            'Cannot render a <style> outside the main document without knowing its precedence and a unique href key. React can hoist and deduplicate <style> tags if you provide a `precedence` prop along with an `href` prop that does not conflict with the `href` values used in any other hoisted <style> or <link rel="stylesheet" ...> tags.  Note that hoisting <style> tags is considered an advanced feature that most will not use directly. Consider moving the <style> tag to the <head> or consider adding a `precedence="default"` and `href="some unique resource identifier"`.',
          );
        return false;
      }
      return true;
    case "link": {
      if (typeof props.rel !== "string" || typeof props.href !== "string" || props.href === "" || props.onLoad || props.onError) {
        if (props.rel === "stylesheet" && typeof props.precedence === "string") {
          const names: string[] = [];
          if (props.onLoad) names.push("`onLoad`");
          if (props.onError) names.push("`onError`");
          if (props.disabled != null) names.push("`disabled`");
          let list = names.length <= 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
          list += names.length === 1 ? " prop" : " props";
          const which = names.length === 1 ? "an " + list : "the " + list;
          if (names.length)
            warn(
              `React encountered a <link rel="stylesheet" href="${props.href}" ... /> with a \`precedence\` prop that also included ${which}. The presence of loading and error handlers indicates an intent to manage the stylesheet loading state from your from your Component code and React will not hoist or deduplicate this stylesheet. If your intent was to have React hoist and deduplciate this stylesheet using the \`precedence\` prop remove the ${list}, otherwise remove the \`precedence\` prop.`,
            );
        }
        if (outside) {
          if (typeof props.rel !== "string" || typeof props.href !== "string" || props.href === "")
            warn("Cannot render a <link> outside the main document without a `rel` and `href` prop. Try adding a `rel` and/or `href` prop to this <link> or moving the link into the <head> tag");
          else if (props.onError || props.onLoad)
            warn(
              "Cannot render a <link> with onLoad or onError listeners outside the main document. Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or somewhere in the <body>.",
            );
        }
        return false;
      }
      if (props.rel === "stylesheet") {
        if (typeof props.precedence !== "string" && outside)
          warn('Cannot render a <link rel="stylesheet" /> outside the main document without knowing its precedence. Consider adding precedence="default" or moving it into the root <head> tag.');
        return typeof props.precedence === "string" && props.disabled == null;
      }
      return true;
    }
    case "script": {
      const a = props.async && typeof props.async !== "function" && typeof props.async !== "symbol";
      if (!a || props.onLoad || props.onError || !props.src || typeof props.src !== "string") {
        if (outside)
          warn(
            a
              ? props.onLoad || props.onError
                ? "Cannot render a <script> with onLoad or onError listeners outside the main document. Try removing onLoad={...} and onError={...} or moving it into the root <head> tag or somewhere in the <body>."
                : "Cannot render a <script> outside the main document without `async={true}` and a non-empty `src` prop. Ensure there is a valid `src` and either make the script async or move it into the root <head> tag or somewhere in the <body>."
              : 'Cannot render a sync or defer <script> outside the main document without knowing its order. Try adding async="" or moving it into the root <head> tag.',
          );
        return false;
      }
      return true;
    }
    case "noscript":
    case "template":
      if (outside) warn(`Cannot render <${type}> outside the main document. Try moving it into the root <head> tag.`);
  }
  return false;
}

/** A <title>, <meta> or <link> React keeps in <head>: a server one with the same key reused, or a new one put there. */
const tagCaches = new WeakMap<Document, Map<string, Element[] | null>>();
export function claimHoistable(d: Document, type: string, props: any): Element | null {
  const keyAttr = type === "title" ? null : type === "meta" ? "content" : "href";
  // Built once per commit (what streamed in since is found by the next one).
  const cache = mapOf(tagCaches, d, () => (queueMicrotask(() => tagCaches.delete(d)), new Map()));
  if (!cache.has(type)) {
    cache.set(type, null);
    for (const node of d.getElementsByTagName(type)) {
      if ((node as any)[HOISTABLE] || (node as any).__fiber || (type === "link" && node.getAttribute("rel") === "stylesheet") || node.namespaceURI === "http://www.w3.org/2000/svg") continue;
      const k = type + (keyAttr ? node.getAttribute(keyAttr) || "" : "");
      const list = cache.get(k);
      list ? list.push(node) : cache.set(k, [node]);
    }
  }
  const want = type === "title" ? (typeof props.children === "string" || typeof props.children === "number" ? String(props.children) : null) : null;
  const k = type + (keyAttr ? (props[keyAttr === "content" ? "content" : "href"] == null ? "" : String(props[keyAttr === "content" ? "content" : "href"])) : "");
  const list = cache.get(k);
  if (list)
    for (let i = 0; i < list.length; i++) {
      const node = list[i]!;
      if (matches(type, node, props, want)) {
        list.splice(i, 1);
        return node;
      }
    }
  return null;
}
function matches(type: string, node: Element, props: any, title: string | null) {
  if (type === "title") return title === null || node.textContent === title;
  if (type === "meta") {
    for (const a of ["name", "property", "http-equiv", "charset"]) {
      const p = a === "http-equiv" ? props.httpEquiv : a === "charset" ? props.charSet : props[a];
      if (node.getAttribute(a) !== (p == null ? null : String(p))) return false;
    }
    return true;
  }
  for (const a of ["rel", "title", "crossorigin", "media"]) {
    const p = a === "crossorigin" ? props.crossOrigin : props[a];
    if (node.getAttribute(a) !== (p == null ? null : String(p))) return false;
  }
  return true;
}

/** A new hoistable into <head> (a title before the first title there). */
export function mountHoistable(root: Document | ShadowRoot, type: string, el: Element) {
  const d: Document = (root as any).ownerDocument || root;
  d.head.insertBefore(el, type === "title" ? d.querySelector("head > title") : null);
}

export { NOT_LOADED, LOADED, ERRORED, SETTLED, INSERTED };
