// Ported from Solid's web/src/server.ts (MIT, Ryan Carniato and contributors): client assets a render needs — a
// manifest resolved per module, what lazy() components and boundaries register, and the links the head carries.
import { devCheck } from "./request.ts";

export type ManifestEntry = { file: string; css?: string[]; imports?: string[]; isEntry?: boolean; preloads?: Record<string, unknown>[] };
export type AssetManifest = Record<string, ManifestEntry> & { _base?: string };
export type ResolvedAssets = { js: string[]; css: (string | InlineStyle)[]; preloads?: Record<string, unknown>[] };
type InlineStyle = { id: string; content?: string; attrs?: Record<string, unknown> };
type InlineEntry = { id: string; content: string; attrs?: Record<string, unknown>; emitted: boolean };
export type PreloadEntry = { href?: string; attrs: Record<string, string>; attrHtml: string };

/** A render's CSP nonce: one for both, or one per destination (scripts, styles), with their attribute text. */
export type Nonce = { script?: string; style?: string; scriptAttr: string; styleAttr: string };
export function normalizeNonce(nonce: unknown): Nonce | undefined {
  if (nonce == null) return undefined;
  if (typeof nonce === "string") {
    const attr = nonce ? ` nonce="${attrEscape(nonce)}"` : "";
    return { script: nonce, style: nonce, scriptAttr: attr, styleAttr: attr };
  }
  const { script, style } = nonce as { script?: string; style?: string };
  if (!script && !style) return undefined;
  const attr = (v: unknown) => (typeof v === "string" && v ? ` nonce="${attrEscape(v)}"` : "");
  return { script, style, scriptAttr: attr(script), styleAttr: attr(style) };
}
export const nonceAttr = (nonce: Nonce | undefined, destination: "script" | "style" | null) =>
  !nonce || !destination ? "" : destination === "script" ? nonce.scriptAttr : nonce.styleAttr;

/** ASCII lower case (HTML compares rel and as that way). */
export const asciiLowerCase = (v: string) => v.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Attributes that make another request of the same URL (not integrity, referrer policy or priority). */
const RESOURCE_QUALIFIERS = ["as", "crossorigin", "type", "media", "imagesrcset", "imagesizes"];
/** One qualifier as the request sees it: false is absent, crossorigin is anonymous or use-credentials, as folds case. */
function qualifierValue(name: string, value: unknown): string | null {
  if (value == null || value === false) return null;
  if (name === "imagesrcset" || name === "imagesizes") return typeof value === "string" && value !== "" ? value : null;
  const v = value === true ? "" : String(value);
  if (name === "as") return asciiLowerCase(v);
  if (name !== "crossorigin") return v;
  return v.toLowerCase() === "use-credentials" ? "use-credentials" : "anonymous";
}
/** A resource tag's identity: URL and qualifiers, length-prefixed so no value can forge another. */
export function resourceIdentity(tag: string, props: Record<string, unknown>) {
  const url = String(props.href || props.src || "");
  let id = "res:" + tag + ":" + (props.rel || "") + ":" + url.length + ":" + url;
  for (const q of RESOURCE_QUALIFIERS) {
    const v = qualifierValue(q, props[q]);
    if (v !== null) id += ":" + q + "=" + v.length + ":" + v;
  }
  return id;
}

function joinAssetPath(base: unknown, file: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(file)) return file;
  let b = typeof base === "string" && base ? base : "/";
  if (b[b.length - 1] !== "/") b += "/";
  return b + (file[0] === "/" ? file.slice(1) : file);
}

/** Each candidate of a source set: its URL (commas inside it kept) and its descriptors. */
function eachCandidate(srcset: string, visit: (url: string, descriptors: string) => boolean) {
  let i = 0;
  const n = srcset.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(srcset[i]!)) i++;
    const start = i;
    while (i < n && !/\s/.test(srcset[i]!)) i++;
    if (i === start) return false;
    const raw = srcset.slice(start, i);
    const url = raw.replace(/,+$/, "");
    let descriptors = "";
    if (url === raw) {
      const from = i;
      while (i < n && srcset[i] !== ",") i++;
      descriptors = srcset.slice(from, i);
    }
    if (url && visit(url, descriptors)) return true;
  }
  return false;
}
const hasRelativeCandidate = (srcset: string) => eachCandidate(srcset, (url) => !/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/)/.test(url));
const hasWidthDescriptor = (srcset: string) => eachCandidate(srcset, (_, d) => /(?:^|\s)\d+(?:\.\d+)?w(?=\s|$)/.test(d));

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
        const srcset = typeof link?.imagesrcset === "string" && link.imagesrcset;
        if (!href && !srcset) continue;
        if (href) (preloads ??= []).push({ ...link, href: joinAssetPath(base, href) });
        else {
          // (An unusable href is left out, not the source set with it.)
          const { href: bad, ...rest } = link;
          if (bad !== undefined) preloadCheck("Preload href must be a non-empty string; dropping it.", "href", bad);
          (preloads ??= []).push(rest);
        }
        if (srcset && hasRelativeCandidate(srcset))
          preloadCheck(
            "imagesrcset candidates are not joined with the manifest base — they resolve against the document URL, so a relative candidate points somewhere else than the joined href; the integration should emit resolved URLs.",
            "imagesrcset",
            srcset,
          );
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
  let currentBoundaryId: string | null = null;
  return {
    boundaryModules,
    boundaryStyles,
    emittedAssets,
    inlineStyles,
    preloadLinks: null as PreloadEntry[] | null,
    /** Resource identities emitted (preloads and useHead's resources alike). */
    resources: new Set<string>(),
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

const preloadCheck = (message: string, field: string, value?: unknown) =>
  devCheck({ code: "PRELOAD_DESCRIPTOR_INVALID", kind: "head", severity: "warn", message: "[PRELOAD_DESCRIPTOR_INVALID] " + message, data: value === undefined ? { field } : { field, value } });
const PRELOAD_ATTRIBUTES = ["type", "crossorigin", "integrity", "referrerpolicy", "fetchpriority", "media", "imagesrcset", "imagesizes"];
const attrEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** Given at all: "" and false are not (crossorigin's "" is, so only the responsive pair asks this). */
const isSet = (v: unknown) => v != null && v !== false && v !== "";

/**
 * A `<link rel="preload">` for a descriptor, or null when it is not one (or one with its identity is out already).
 * The destination decides first whether a source set counts; a responsive attribute off an image is dropped, not the
 * link.
 */
export function preloadLink(tracking: AssetTracking, link: any, nonce?: Nonce): PreloadEntry | null {
  if (!link || typeof link !== "object") {
    preloadCheck('registerAsset("preload") requires a descriptor object.', "descriptor", link);
    return null;
  }
  if (typeof link.as !== "string") {
    preloadCheck('registerAsset("preload") requires an as destination.', "as");
    return null;
  }
  const as = asciiLowerCase(link.as);
  let destination: "script" | "style" | null = null;
  if (as === "script" || as === "style") destination = as;
  else if (as !== "fetch" && as !== "font" && as !== "image" && as !== "track") {
    preloadCheck(`registerAsset("preload") received an unsupported as destination "${link.as}".`, "as", link.as);
    return null;
  }
  const image = as === "image";
  if (!image && (isSet(link.imagesrcset) || isSet(link.imagesizes)))
    preloadCheck('registerAsset("preload") only supports imagesrcset and imagesizes with as="image".', isSet(link.imagesrcset) ? "imagesrcset" : "imagesizes");
  let srcset: string | null = null;
  let sizes: string | null = null;
  if (image)
    for (const name of ["imagesrcset", "imagesizes"]) {
      const v = link[name];
      if (!isSet(v)) continue;
      if (typeof v !== "string") {
        preloadCheck(`registerAsset("preload") expects a string ${name}.`, name, v);
        continue;
      }
      if (name === "imagesrcset") srcset = v;
      else sizes = v;
    }
  const href = typeof link.href === "string" && link.href ? link.href : null;
  if (!href && link.href != null && link.href !== false) preloadCheck("Preload href must be a non-empty string; dropping it.", "href", link.href);
  if (!href && !srcset) {
    preloadCheck('registerAsset("preload") requires a non-empty string href or imagesrcset.', "href");
    return null;
  }
  if (srcset && !sizes && hasWidthDescriptor(srcset))
    preloadCheck(
      "imagesrcset uses a width descriptor, so imagesizes is required; without it the source size defaults to 100vw and the preload may not match the image.",
      "imagesizes",
      srcset,
    );
  const props: Record<string, string> = { rel: "preload" };
  if (href) props.href = href;
  props.as = as;
  for (const name of PRELOAD_ATTRIBUTES) {
    if (name === "imagesrcset" || name === "imagesizes") {
      const v = name === "imagesrcset" ? srcset : sizes;
      if (v !== null) props[name] = v;
      continue;
    }
    const v = link[name];
    if (v == null || v === false) continue;
    props[name] = v === true ? "" : String(v);
  }
  const identity = resourceIdentity("link", props);
  if (tracking.resources.has(identity)) return null;
  if (props.crossorigin == null && (as === "font" || as === "fetch"))
    preloadCheck(`registerAsset("preload") with as="${as}" has no crossorigin and may not match the eventual request.`, "crossorigin");
  const attrs: Record<string, string> = {};
  let attrHtml = "";
  for (const name in props) {
    attrHtml += ` ${name}="${attrEscape(props[name]!)}"`;
    if (name !== "rel" && name !== "href") attrs[name] = props[name]!;
  }
  const n = destination && nonce?.[destination];
  if (typeof n === "string" && n) attrs.nonce = n;
  const entry = { href: props.href, attrs, attrHtml: attrHtml + nonceAttr(nonce, destination) };
  tracking.resources.add(identity);
  (tracking.preloadLinks ??= []).push(entry);
  return entry;
}

export function renderInlineStyle(entry: InlineEntry, nonce?: Nonce) {
  let attrs = "";
  let own = false;
  if (entry.attrs)
    for (const name in entry.attrs) {
      if (asciiLowerCase(name) === "nonce") own = true;
      attrs += ` ${name}="${attrEscape(String(entry.attrs[name]))}"`;
    }
  return `<style${own ? "" : nonceAttr(nonce, "style")} data-asset="${attrEscape(entry.id)}"${attrs}>${entry.content.replace(/<\/(style)/gi, "<\\/$1")}</style>`;
}

/** The head's links: modules preloaded, stylesheets, preload hints, then inline styles not emitted yet. */
export function renderHeadAssets(tracking: AssetTracking, nonce?: Nonce) {
  let head = "";
  for (const url of tracking.emittedAssets) head += isCssUrl(url) ? `<link rel="stylesheet" href="${url}"${nonceAttr(nonce, "style")}>` : `<link rel="modulepreload" href="${url}"${nonceAttr(nonce, "script")}>`;
  if (tracking.preloadLinks) for (const entry of tracking.preloadLinks) head += `<link${entry.attrHtml}>`;
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
