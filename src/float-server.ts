// Float on the server: React's resources (preloads, preconnects, stylesheets by precedence, async scripts) and its
// hoistables (<title>, <meta>, <link>), gathered while rendering and written into the document's <head>, or before
// a later boundary once the shell is out. Same dedupe states and same order as React's Fizz.

/** What a resource key has seen: written (EXISTS), preloaded without credentials, or preloaded with them. */
const EXISTS = null;
const NO_CREDS: readonly any[] = Object.freeze([]);
type KeyState = null | readonly any[];

/** A queued piece of markup; emptied when what it preloads is written instead (React's `chunks.length = 0`). */
type Chunk = { html: string };
const PENDING = 0, PRELOADED = 1, PREAMBLE = 2, LATE = 3;
type Sheet = { state: number; props: any };
type StyleQueue = { precedence: string; rules: string[]; hrefs: string[]; sheets: Map<string, Sheet> };

/** Builds a tag's markup from props, as the renderer writes elements (attributes escaped and named as React's). */
export type TagWriter = (tag: string, props: any, inner?: string) => string;

export class Resources {
  dns = new Set<string>();
  connect = { default: new Set<string>(), anonymous: new Set<string>(), credentials: new Set<string>() };
  image = new Map<string, KeyState>();
  style = new Map<string, KeyState>();
  script = new Map<string, KeyState>();
  module = new Map<string, KeyState>();
  unknown = new Map<string, Set<string>>();
  moduleUnknown = new Map<string, Set<string>>();

  charset: string[] = [];
  viewport: string[] = [];
  preconnects: Chunk[] = [];
  fontPreloads: Chunk[] = [];
  highImages: Chunk[] = [];
  styles = new Map<string, StyleQueue>();
  /** Every stylesheet met, by href (a boundary rendered again finds the ones it uses). */
  sheetByHref = new Map<string, Sheet>();
  bootstrap: Chunk[] = [];
  scripts: Chunk[] = [];
  bulk: Chunk[] = [];
  hoistables: string[] = [];
  preloads = { images: new Map<string, Chunk>(), stylesheets: new Map<string, Chunk>(), scripts: new Map<string, Chunk>(), moduleScripts: new Map<string, Chunk>() };
  /** Stylesheets and style rules met in the boundary being rendered: sent with it when it completes. */
  boundary: { sheets: Set<Sheet>; styles: Set<StyleQueue>; emitted?: string[] } | null = null;
  /** Hoistables a boundary sent in an earlier render of it: not sent again when it renders once more. */
  replay: Map<string, number> | null = null;

  /** A hoistable queued once: skipped if this boundary already sent it, remembered for the next time. */
  hoistInto(list: string[], html: string) {
    this.boundary && (this.boundary.emitted ??= []).push(html);
    const left = this.replay?.get(html);
    if (left) return void this.replay!.set(html, left - 1);
    list.push(html);
  }

  constructor(
    private tag: TagWriter,
    public styleNonce?: string,
  ) {}

  link(props: any) {
    return this.tag("link", props);
  }

  // ------------------------------------------------------------ ReactDOM.prefetchDNS, preconnect, preload, preinit…

  prefetchDNS(href: string) {
    if (typeof href !== "string" || !href || this.dns.has(href)) return;
    this.dns.add(href);
    this.preconnects.push({ html: this.link({ href, rel: "dns-prefetch" }) });
  }

  preconnect(href: string, crossOrigin?: string | null) {
    if (typeof href !== "string" || !href) return;
    const bucket = crossOrigin === "use-credentials" ? "credentials" : typeof crossOrigin === "string" ? "anonymous" : "default";
    if (this.connect[bucket].has(href)) return;
    this.connect[bucket].add(href);
    this.preconnects.push({ html: this.link({ rel: "preconnect", href, crossOrigin }) });
  }

  preload(href: string, as: string, options?: any) {
    if (!as || !href) return;
    switch (as) {
      case "image": {
        const key = options?.imageSrcSet ? options.imageSrcSet + "\n" + (options.imageSizes || "") : href;
        if (this.image.has(key)) return;
        this.image.set(key, NO_CREDS);
        const chunk = { html: this.link({ rel: "preload", href: options?.imageSrcSet ? undefined : href, as, ...options }) };
        if (options?.fetchPriority === "high") this.highImages.push(chunk);
        else {
          this.bulk.push(chunk);
          this.preloads.images.set(key, chunk);
        }
        return;
      }
      case "style": {
        if (this.style.has(href)) return;
        const chunk = { html: this.link({ rel: "preload", href, as, ...options }) };
        this.style.set(href, credentials(options));
        this.preloads.stylesheets.set(href, chunk);
        this.bulk.push(chunk);
        return;
      }
      case "script": {
        if (this.script.has(href)) return;
        const chunk = { html: this.link({ rel: "preload", href, as, ...options }) };
        this.preloads.scripts.set(href, chunk);
        this.bulk.push(chunk);
        this.script.set(href, credentials(options));
        return;
      }
      default: {
        let seen = this.unknown.get(as);
        if (!seen) this.unknown.set(as, (seen = new Set()));
        if (seen.has(href)) return;
        seen.add(href);
        const chunk = { html: this.link({ rel: "preload", href, as, ...options }) };
        (as === "font" ? this.fontPreloads : this.bulk).push(chunk);
      }
    }
  }

  preloadModule(href: string, options?: any) {
    if (!href) return;
    const as = typeof options?.as === "string" ? options.as : "script";
    const chunk = { html: "" };
    if (as === "script") {
      if (this.module.has(href)) return;
      this.module.set(href, credentials(options));
      this.preloads.moduleScripts.set(href, chunk);
    } else {
      let seen = this.moduleUnknown.get(as);
      if (!seen) this.moduleUnknown.set(as, (seen = new Set()));
      if (seen.has(href)) return;
      seen.add(href);
    }
    chunk.html = this.link({ rel: "modulepreload", href, ...options });
    this.bulk.push(chunk);
  }

  preinitScript(src: string, options?: any) {
    if (!src) return;
    const state = this.script.has(src) ? this.script.get(src)! : undefined;
    if (state === EXISTS) return;
    this.script.set(src, EXISTS);
    const props = { src, async: true, ...options };
    if (state) {
      if (state.length === 2) adopt(props, state);
      const pre = this.preloads.scripts.get(src);
      if (pre) pre.html = "";
    }
    this.scripts.push({ html: this.tag("script", props, "") });
  }

  preinitModuleScript(src: string, options?: any) {
    if (!src) return;
    const state = this.module.has(src) ? this.module.get(src)! : undefined;
    if (state === EXISTS) return;
    this.module.set(src, EXISTS);
    const props = { src, type: "module", async: true, ...options };
    if (state) {
      if (state.length === 2) adopt(props, state);
      const pre = this.preloads.moduleScripts.get(src);
      if (pre) pre.html = "";
    }
    this.scripts.push({ html: this.tag("script", props, "") });
  }

  preinitStyle(href: string, precedence?: string, options?: any) {
    if (!href) return;
    precedence ||= "default";
    const state = this.style.has(href) ? this.style.get(href)! : undefined;
    if (state === EXISTS) return;
    this.style.set(href, EXISTS);
    const sheet: Sheet = { state: PENDING, props: { rel: "stylesheet", href, "data-precedence": precedence, ...options } };
    if (state) this.fromPreload(href, state, sheet);
    this.queue(precedence).sheets.set(href, sheet);
    this.sheetByHref.set(href, sheet);
  }

  // ------------------------------------------------------------ elements rendered as resources or hoistables

  /** `<link rel="stylesheet" precedence>`: one per href, in its precedence. */
  stylesheet(props: any) {
    const { href, precedence } = props;
    const queue = this.styles.get(precedence);
    const state = this.style.has(href) ? this.style.get(href)! : undefined;
    if (state !== EXISTS) {
      this.style.set(href, EXISTS);
      const q = queue ?? this.queue(precedence);
      const sheet: Sheet = { state: PENDING, props: { ...props, "data-precedence": precedence, precedence: null } };
      if (state) this.fromPreload(href, state, sheet);
      q.sheets.set(href, sheet);
      this.sheetByHref.set(href, sheet);
      this.boundary?.sheets.add(sheet);
    } else {
      const sheet = this.sheetByHref.get(href);
      if (sheet) this.boundary?.sheets.add(sheet);
    }
  }

  /** `<style href precedence>`: its rules join its precedence's one <style>. */
  styleTag(props: any, text: string, warn: (msg: string) => void) {
    const { href, precedence, nonce } = props;
    let queue = this.styles.get(precedence);
    const state = this.style.has(href) ? this.style.get(href)! : undefined;
    if (state !== EXISTS) {
      this.style.set(href, EXISTS);
      if (state)
        warn(`React encountered a hoistable style tag for the same href as a preload: "${href}". When using a style tag to inline styles you should not also preload it as a stylsheet.`);
      queue ??= this.queue(precedence);
      if (this.styleNonce && this.styleNonce !== nonce)
        warn(
          `React encountered a style tag with \`precedence\` "${precedence}" and \`nonce\` "${nonce}". When React manages style rules using \`precedence\` it will only include rules if the nonce matches the style nonce "${this.styleNonce}" that was included with this render.`,
        );
      else {
        if (!this.styleNonce && nonce)
          warn(
            `React encountered a style tag with \`precedence\` "${precedence}" and \`nonce\` "${nonce}". When React manages style rules using \`precedence\` it will only include a nonce attributes if you also provide the same style nonce value as a render option.`,
          );
        queue.hrefs.push(escapeAttr(href));
        queue.rules.push(text);
      }
    }
    if (queue) this.boundary?.styles.add(queue);
  }

  /** `<script async src>`: one per src. */
  asyncScript(props: any) {
    const key = props.src;
    const module = props.type === "module";
    const states = module ? this.module : this.script;
    const preloads = module ? this.preloads.moduleScripts : this.preloads.scripts;
    const state = states.has(key) ? states.get(key)! : undefined;
    if (state === EXISTS) return;
    states.set(key, EXISTS);
    let p = props;
    if (state) {
      if (state.length === 2) adopt((p = { ...props }), state);
      const pre = preloads.get(key);
      if (pre) pre.html = "";
    }
    this.scripts.push({ html: this.tag("script", p, "") });
  }

  /** A rendered <img> React preloads: the first ten (or fetchPriority high) as high priority. */
  image_(props: any) {
    const { src, srcSet } = props;
    const sizes = typeof props.sizes === "string" ? props.sizes : undefined;
    const key = srcSet ? srcSet + "\n" + (sizes || "") : src;
    const promotable = this.preloads.images.get(key);
    if (promotable) {
      if (props.fetchPriority === "high" || this.highImages.length < 10) {
        this.preloads.images.delete(key);
        this.bulk = this.bulk.filter((c) => c !== promotable);
        this.highImages.push(promotable);
      }
      return;
    }
    if (this.image.has(key)) return;
    this.image.set(key, NO_CREDS);
    const co = props.crossOrigin;
    const chunk = {
      html: this.link({
        rel: "preload",
        as: "image",
        href: srcSet ? undefined : src,
        imageSrcSet: srcSet,
        imageSizes: sizes,
        crossOrigin: typeof co === "string" ? (co === "use-credentials" ? co : "") : undefined,
        integrity: props.integrity,
        type: props.type,
        fetchPriority: props.fetchPriority,
        referrerPolicy: props.referrerPolicy,
      }),
    };
    if (props.fetchPriority === "high" || this.highImages.length < 10) this.highImages.push(chunk);
    else {
      this.bulk.push(chunk);
      this.preloads.images.set(key, chunk);
    }
  }

  // ------------------------------------------------------------ writing

  /** Everything gathered so far, as React writes it into the shell's <head>. */
  preamble(importMap: string, bootstrapPreloads: string) {
    let out = take(this.charset) + flush(this.preconnects) + take(this.viewport) + flush(this.fontPreloads) + flush(this.highImages);
    for (const q of this.styles.values()) {
      const hasSheets = q.sheets.size > 0;
      for (const s of q.sheets.values()) {
        out += this.link(s.props);
        s.state = PREAMBLE;
      }
      q.sheets.clear();
      if (!hasSheets || q.hrefs.length) out += this.styleElement(q, false);
    }
    out += importMap + bootstrapPreloads + flush(this.bootstrap) + flush(this.scripts) + flush(this.bulk) + take(this.hoistables);
    return out;
  }

  /** What was gathered after the shell: written before the next chunk (stylesheets only preloaded here). */
  late() {
    let out = take(this.viewport) + flush(this.preconnects) + flush(this.fontPreloads) + flush(this.highImages);
    for (const q of this.styles.values()) {
      for (const s of q.sheets.values())
        if (s.state === PENDING) {
          s.state = PRELOADED;
          const p = s.props;
          out += this.link({ rel: "preload", as: "style", href: p.href, crossOrigin: p.crossOrigin, fetchPriority: p.fetchPriority, integrity: p.integrity, media: p.media, hrefLang: p.hrefLang, referrerPolicy: p.referrerPolicy });
        }
      q.sheets.clear();
    }
    return out + flush(this.scripts) + flush(this.bulk) + take(this.hoistables);
  }

  /** A completed boundary's own stylesheets (not yet in the document) and inline style rules. */
  /** Style rules a boundary has met so far, sent ahead hidden (media="not all") until it is revealed. */
  lateStyleTags(state: { styles: Set<StyleQueue> }) {
    let out = "";
    for (const q of state.styles) if (q.hrefs.length) out += this.styleElement(q, true);
    if (out) this.stylesToHoist = true;
    return out;
  }
  /** Late style tags were sent: the next boundary revealed moves them into <head> (React's stylesToHoist). */
  stylesToHoist = false;

  boundaryStyles(state: { sheets: Set<Sheet>; styles: Set<StyleQueue> }) {
    const styleTags = this.lateStyleTags(state);
    const sheets: [string, string, Record<string, string>][] = [];
    for (const s of state.sheets) {
      if (s.state === PREAMBLE) continue;
      if (s.state === LATE) {
        sheets.push([String(s.props.href), "", {}]);
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const k in s.props) {
        const v = s.props[k];
        if (v == null || k === "href" || k === "rel" || k === "precedence" || k === "data-precedence" || typeof v === "function" || typeof v === "symbol") continue;
        // As React's writeStyleResourceAttributeInJS: no handlers, no React-only props, hidden only when true.
        if (["innerHTML", "dangerouslySetInnerHTML", "suppressContentEditableWarning", "suppressHydrationWarning", "style", "ref", "children"].includes(k)) continue;
        if (k === "hidden") {
          if (v === false) continue;
          attrs.hidden = "";
          continue;
        }
        if (k !== "className" && ((k.length > 2 && (k[0] === "o" || k[0] === "O") && (k[1] === "n" || k[1] === "N")) || !/^[:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�][:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\-.0-9·̀-ͯ‿-⁀]*$/.test(k)))
          continue;
        attrs[k === "className" ? "class" : k.toLowerCase()] = String(v);
      }
      sheets.push([String(s.props.href), String(s.props["data-precedence"]), attrs]);
      s.state = LATE;
    }
    return { styleTags, sheets };
  }

  private styleElement(q: StyleQueue, late: boolean) {
    const open = `<style${this.styleNonce ? ` nonce="${escapeAttr(this.styleNonce)}"` : ""}${late ? ' media="not all"' : ""} data-precedence="${q.precedence}"`;
    const out = `${open}${q.hrefs.length ? ` data-href="${q.hrefs.join(" ")}"` : ""}>${q.rules.join("")}</style>`;
    q.rules.length = 0;
    q.hrefs.length = 0;
    return out;
  }

  private queue(precedence: string) {
    let q = this.styles.get(precedence);
    if (!q) this.styles.set(precedence, (q = { precedence: escapeAttr(precedence), rules: [], hrefs: [], sheets: new Map() }));
    return q;
  }

  private fromPreload(href: string, state: readonly any[], sheet: Sheet) {
    if (state.length === 2) adopt(sheet.props, state);
    const pre = this.preloads.stylesheets.get(href);
    if (pre && pre.html) pre.html = "";
    else sheet.state = PRELOADED;
  }
}

const credentials = (o: any): readonly any[] => (!o || (typeof o.crossOrigin !== "string" && typeof o.integrity !== "string") ? NO_CREDS : [o.crossOrigin, o.integrity]);
function adopt(target: any, state: readonly any[]) {
  if (target.crossOrigin == null) target.crossOrigin = state[0];
  if (target.integrity == null) target.integrity = state[1];
}
const flush = (chunks: Chunk[]) => {
  let out = "";
  // Written chunks are emptied, as React's are: a preload already sent is not sent again.
  for (const c of chunks) (out += c.html), (c.html = "");
  chunks.length = 0;
  return out;
};
const take = (list: string[]) => {
  const out = list.join("");
  list.length = 0;
  return out;
};
const escapeAttr = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`);
