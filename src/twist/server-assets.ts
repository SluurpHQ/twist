// Ported from Solid's web/src/server.ts (MIT, Ryan Carniato and contributors): client assets a render needs — a
// manifest resolved per module, what lazy() components and boundaries register, and the links the head carries.
import { devCheck } from "./request.ts";

export type ManifestEntry = { file: string; css?: string[]; imports?: string[]; isEntry?: boolean; preloads?: Record<string, unknown>[] };
export type AssetManifest = Record<string, ManifestEntry> & { _base?: string };
export type ResolvedAssets = { js: string[]; css: (string | InlineStyle)[]; preloads?: Record<string, unknown>[] };
type InlineStyle = { id: string; content?: string; attrs?: Record<string, unknown> };
type InlineEntry = { id: string; content: string; attrs?: Record<string, unknown>; emitted: boolean };
export type PreloadEntry = { href?: string; attrHtml: string };

function joinAssetPath(base: unknown, file: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(file)) return file;
  let b = typeof base === "string" && base ? base : "/";
  if (b[b.length - 1] !== "/") b += "/";
  return b + (file[0] === "/" ? file.slice(1) : file);
}

/** A module's client assets from a manifest: its file and imports' files, their css, their preloads. */
export function resolveAssets(moduleUrl: string, manifest: AssetManifest | null | undefined): ResolvedAssets | null {
  if (!manifest) return null;
  const base = manifest._base;
  if (!manifest[moduleUrl]) return null;
  const css: string[] = [];
  const js: string[] = [];
  let preloads: Record<string, unknown>[] | undefined;
  const visited = new Set<string>();
  const walk = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    const e = manifest[key] as ManifestEntry | undefined;
    if (!e) return;
    js.push(joinAssetPath(base, e.file));
    if (e.css) for (const c of e.css) css.push(joinAssetPath(base, c));
    if (e.preloads)
      for (const link of e.preloads) {
        const href = typeof link?.href === "string" && link.href;
        if (!href && !(typeof link?.imagesrcset === "string" && link.imagesrcset)) continue;
        (preloads ??= []).push(href ? { ...link, href: joinAssetPath(base, href) } : (({ href: _, ...rest }) => rest)(link));
      }
    if (e.imports) for (const i of e.imports) walk(i);
  };
  walk(moduleUrl);
  const assets: ResolvedAssets = { js, css };
  if (preloads) assets.preloads = preloads;
  return assets;
}

/** The entry's assets (its css, its imports' modules, its preloads) registered with the render. */
export function registerEntryAssets(ctx: any, manifest: unknown) {
  if (!manifest || typeof manifest === "function" || typeof (manifest as any).resolve === "function") return;
  if (!ctx?.registerAsset) return;
  for (const key in manifest as AssetManifest) {
    if (!(manifest as AssetManifest)[key]!.isEntry) continue;
    const assets = resolveAssets(key, manifest as AssetManifest);
    if (assets) {
      if (assets.preloads) for (const p of assets.preloads) ctx.registerAsset("preload", p);
      for (const c of assets.css) ctx.registerAsset("style", c);
      for (let i = 1; i < assets.js.length; i++) ctx.registerAsset("module", assets.js[i]);
    }
    return;
  }
}

/** What one render registered: modules per boundary, styles per boundary, the assets emitted, inline styles. */
export function createAssetTracking() {
  const boundaryModules = new Map<string, Record<string, string>>();
  const boundaryStyles = new Map<string, Set<string | InlineEntry>>();
  const emittedAssets = new Set<string>();
  const inlineStyles = new Map<string, InlineEntry>();
  const preloadLinks: PreloadEntry[] = [];
  let currentBoundaryId: string | null = null;
  return {
    boundaryModules,
    boundaryStyles,
    emittedAssets,
    inlineStyles,
    preloadLinks,
    registerInlineStyle(desc: InlineStyle) {
      let entry = inlineStyles.get(desc.id);
      if (!entry) inlineStyles.set(desc.id, (entry = { id: desc.id, content: desc.content || "", attrs: desc.attrs, emitted: false }));
      if (currentBoundaryId) {
        let styles = boundaryStyles.get(currentBoundaryId);
        if (!styles) boundaryStyles.set(currentBoundaryId, (styles = new Set()));
        styles.add(entry);
      }
      return entry;
    },
    get currentBoundaryId() {
      return currentBoundaryId;
    },
    set currentBoundaryId(v: string | null) {
      currentBoundaryId = v;
    },
    registerModule(key: string, entryUrl: string) {
      const id = currentBoundaryId || "";
      let map = boundaryModules.get(id);
      if (!map) boundaryModules.set(id, (map = {}));
      map[key] = entryUrl;
    },
    getBoundaryModules: (id: string) => boundaryModules.get(id) || null,
    getBoundaryStyles: (id: string) => boundaryStyles.get(id) || null,
  };
}
export type AssetTracking = ReturnType<typeof createAssetTracking>;

function warnUnresolved(moduleUrl: string, warned: Set<string>) {
  if (warned.has(moduleUrl)) return;
  warned.add(moduleUrl);
  console.error(
    `Asset manifest returned no client assets for module "${moduleUrl}". ` +
      "If this module is a server-rendered lazy() component, its entry will be missing from the serialized hydration " +
      "asset map and hydration will fail. Check the integration's asset resolver.",
  );
}

/** The render context's asset hooks: the current boundary, module registration, and a resolver over the manifest. */
export function applyAssetTracking(context: any, tracking: AssetTracking, manifest: any) {
  const warned = new Set<string>();
  const guard = (resolve: (url: string) => any) => (url: string) => {
    const result = resolve(url);
    if (result && typeof result.then === "function")
      return result.then((a: ResolvedAssets | null) => (!a?.js?.length && warnUnresolved(url, warned), a));
    if (!result?.js?.length) warnUnresolved(url, warned);
    return result;
  };
  Object.defineProperty(context, "_currentBoundaryId", {
    get: () => tracking.currentBoundaryId,
    set: (v) => (tracking.currentBoundaryId = v),
    configurable: true,
    enumerable: true,
  });
  context.registerModule = tracking.registerModule;
  context.getBoundaryModules = tracking.getBoundaryModules;
  context._lazyAssets = new Map();
  if (typeof manifest === "function") context.resolveAssets = guard(manifest);
  else if (manifest && typeof manifest.resolve === "function") {
    context.resolveAssets = guard((k) => manifest.resolve(k));
    if (typeof manifest.resolveSync === "function") context.resolveAssetsSync = (k: string) => manifest.resolveSync(k);
  } else if (manifest) {
    const resolve = (url: string) => resolveAssets(url, manifest);
    context.resolveAssets = guard(resolve);
    context.resolveAssetsSync = resolve;
  }
}

export function isCssUrl(url: string) {
  const q = url.search(/[?#]/);
  return (q === -1 ? url : url.slice(0, q)).endsWith(".css");
}

/** What a preload can be fetched as (browsers ignore the rest). */
const PRELOAD_DESTINATIONS = new Set(["fetch", "font", "image", "script", "style", "track"]);
const preloadCheck = (message: string, field: string, value: unknown) =>
  devCheck({ code: "PRELOAD_DESCRIPTOR_INVALID", kind: "head", severity: "warn", message: "[PRELOAD_DESCRIPTOR_INVALID] " + message, data: { field, value } });
const PRELOAD_ATTRIBUTES = ["type", "crossorigin", "integrity", "referrerpolicy", "fetchpriority", "media", "imagesrcset", "imagesizes"];
const attrEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** A `<link rel="preload">` for a descriptor (once per href), or null when it is not one. */
export function preloadLink(tracking: AssetTracking, link: any): PreloadEntry | null {
  if (!link || typeof link !== "object" || typeof link.as !== "string") {
    devCheck({ code: "PRELOAD_DESCRIPTOR_INVALID", kind: "head", severity: "warn", message: '[PRELOAD_DESCRIPTOR_INVALID] registerAsset("preload") requires a descriptor object with an as destination.' });
    return null;
  }
  const href = typeof link.href === "string" && link.href ? link.href : null;
  if (!href && !(typeof link.imagesrcset === "string" && link.imagesrcset)) {
    preloadCheck("a preload descriptor needs an href (or an imagesrcset): skipped", "href", link.href);
    return null;
  }
  const as = link.as.toLowerCase();
  if (!PRELOAD_DESTINATIONS.has(as)) {
    preloadCheck(`unsupported as destination "${as}": skipped`, "as", as);
    return null;
  }
  const props: Record<string, string> = { rel: "preload" };
  if (href) props.href = href;
  props.as = as;
  for (const name of PRELOAD_ATTRIBUTES) {
    const v = link[name];
    if (v == null || v === false) continue;
    props[name] = v === true ? "" : String(v);
  }
  let attrHtml = "";
  for (const name in props) attrHtml += props[name] === "" ? ` ${name}` : ` ${name}="${attrEscape(props[name]!)}"`;
  if (tracking.preloadLinks.some((p) => p.attrHtml === attrHtml)) return null;
  const entry = { href: props.href, attrHtml };
  tracking.preloadLinks.push(entry);
  return entry;
}

export function renderInlineStyle(entry: InlineEntry, nonce?: string) {
  let attrs = "";
  if (entry.attrs) for (const name in entry.attrs) attrs += ` ${name}="${attrEscape(String(entry.attrs[name]))}"`;
  const n = nonce ? ` nonce="${attrEscape(nonce)}"` : "";
  return `<style${n} data-asset="${attrEscape(entry.id)}"${attrs}>${entry.content.replace(/<\/(style)/gi, "<\\/$1")}</style>`;
}

/** The head's links: modules preloaded, stylesheets, preload hints, then inline styles not emitted yet. */
export function renderHeadAssets(tracking: AssetTracking, nonce?: string) {
  let head = "";
  const n = nonce ? ` nonce="${attrEscape(nonce)}"` : "";
  for (const url of tracking.emittedAssets) head += isCssUrl(url) ? `<link rel="stylesheet" href="${url}"${n}>` : `<link rel="modulepreload" href="${url}"${n}>`;
  for (const entry of tracking.preloadLinks) head += `<link${entry.attrHtml}>`;
  for (const entry of tracking.inlineStyles.values()) {
    if (entry.emitted) continue;
    entry.emitted = true;
    head += renderInlineStyle(entry, nonce);
  }
  return head;
}

/** A boundary's module map, serialized for the client to preload before it hydrates the boundary. */
export function serializeFragmentAssets(key: string, tracking: AssetTracking, context: any, name = key) {
  const map = tracking.boundaryModules.get(key);
  if (!map || !Object.keys(map).length) return;
  context.serialize(name + "_assets", { ...map });
}

/** A streamed boundary's stylesheets (not in the head already) and inline styles. */
export function collectStreamStyles(key: string, tracking: AssetTracking, headStyles: Set<string> | null) {
  const styles = tracking.getBoundaryStyles(key);
  const links: (string | PreloadEntry)[] = [];
  const inline: InlineEntry[] = [];
  if (!styles) return { links, inline };
  for (const entry of styles) {
    if (typeof entry === "string") {
      if (!headStyles || !headStyles.has(entry)) links.push(entry);
    } else if (!entry.emitted) {
      entry.emitted = true;
      inline.push(entry);
    }
  }
  return { links, inline };
}

/** A nested boundary's styles carried up to the boundary it streams within. */
export function propagateBoundaryStyles(childKey: string, parentKey: string, tracking: AssetTracking) {
  const child = tracking.getBoundaryStyles(childKey);
  if (!child) return;
  let parent = tracking.boundaryStyles.get(parentKey);
  if (!parent) tracking.boundaryStyles.set(parentKey, (parent = new Set()));
  for (const s of child) parent.add(s);
}
