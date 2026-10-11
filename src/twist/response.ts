// Responses that carry control flow (redirects, revalidation, a value with a status) as plain Response objects, and
// the cookie codec. No codec, no transport: isomorphic.

const ENVELOPE = Symbol.for("solid.ResponseEnvelope");

/** A value paired with the response metadata it travels with. */
export interface ResponseEnvelope<T = unknown> {
  response: Response | undefined;
  value: T;
}
export const ResponseEnvelope: { new <T>(response: Response | undefined, value: T): ResponseEnvelope<T> } = /* @__PURE__ */ (() => {
  class ResponseEnvelope {
    constructor(
      public response: Response | undefined,
      public value: unknown,
    ) {}
  }
  (ResponseEnvelope.prototype as any)[ENVELOPE] = true;
  return ResponseEnvelope as any;
})();

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return !!(value && typeof value === "object" && (value as any)[ENVELOPE]);
}

/** Brand of URL-bearing values: `true`, or the value's logical path. */
/** Where the request store (an AsyncLocalStorage) is parked, for every copy of the runtime. */
export const RequestContext: unique symbol = Symbol.for("solid.RequestContext") as any;
export const HREF: unique symbol = Symbol.for("solid.Href") as any;
export interface Href {
  [HREF]: true | string;
  toString(): string;
}
export function isHref(value: unknown): value is Href {
  return !!(value && (typeof value === "object" || typeof value === "function") && (value as any)[HREF]);
}

export const SAFE_ERROR: unique symbol = Symbol.for("solid.SafeError") as any;
/** `error` marked as safe to send to the client as it is (not sanitized in production). */
export function markSafeError<E>(error: E): E {
  if (error && (typeof error === "object" || typeof error === "function")) Object.defineProperty(error, SAFE_ERROR, { value: true, enumerable: false, configurable: true });
  return error;
}
export function isSafeError(value: unknown): value is Error {
  return !!(value && (typeof value === "object" || typeof value === "function") && (value as any)[SAFE_ERROR]);
}

/** The cache keys a mutation invalidated, comma separated. */
export const REVALIDATE_HEADER = "X-Revalidate";
/** Every entry in every cache. */
export const REVALIDATE_ALL = "*";
export interface ResponseHelperInit extends ResponseInit {
  revalidate?: string | string[];
}
/** The largest header value the runtime composes (a longer one would break the whole response at a receiver). */
export const RESPONSE_HEADER_VALUE_LIMIT = 4096;
/** Headers describing a body the runtime composes itself. */
export const COMPOSED_BODY_FRAMING: ReadonlySet<string> = /*#__PURE__*/ new Set(["content-length", "content-encoding", "transfer-encoding"]);
/** Statuses that carry no body. */
export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** Whether `target` navigates over http(s). */
export function isHttpNavigationTarget(target: string): boolean {
  try {
    const protocol = new URL(target, "http://base.invalid").protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function initWithRevalidate(init: number | ResponseHelperInit = {}) {
  const { revalidate, ...responseInit }: any = typeof init === "number" ? { status: init } : init;
  // (Copied entry by entry: Set-Cookie values must not fold into one.)
  let headers: Headers;
  if (responseInit.headers?.getSetCookie) {
    headers = new Headers();
    responseInit.headers.forEach((value: string, key: string) => key !== "set-cookie" && headers.append(key, value));
    for (const cookie of responseInit.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  } else headers = new Headers(responseInit.headers);
  if (revalidate !== undefined) {
    const list = Array.isArray(revalidate) ? revalidate : [revalidate];
    if (list.length > 1 && list.includes(REVALIDATE_ALL))
      throw new TypeError(
        `revalidate names "${REVALIDATE_ALL}" alongside other keys; "${REVALIDATE_ALL}" already ` +
          `means every entry and stands alone — pass revalidate: "${REVALIDATE_ALL}" or the named keys.`,
      );
    const keys = list.join(",");
    if (keys.length > RESPONSE_HEADER_VALUE_LIMIT)
      throw new TypeError(
        `revalidate names ${keys.length} characters of cache keys; past ` +
          `${RESPONSE_HEADER_VALUE_LIMIT} the ${REVALIDATE_HEADER} header would overflow ` +
          `receivers (an 8 KiB proxy buffer holds the whole header block) and the response ` +
          `dies at the socket after the mutation committed. Split the invalidation across ` +
          `calls or use coarser keys — a dropped key would be a silently stale cache, so ` +
          `the runtime refuses rather than trims.`,
      );
    headers.set(REVALIDATE_HEADER, keys);
  }
  return { responseInit, headers };
}

/** A redirect to `url` (302 unless given), optionally naming the cache keys it invalidated. */
export function redirect(url: string | Href, init: number | ResponseHelperInit = 302) {
  if (typeof url !== "string" && !isHref(url)) throw new TypeError("redirect() expects a string URL or an Href-branded value (Symbol.for('solid.Href')).");
  const { responseInit, headers } = initWithRevalidate(init);
  if (responseInit.status === undefined) responseInit.status = 302;
  const target = typeof url === "string" ? url : url[HREF];
  const location = typeof target === "string" ? target : String(url);
  // Non-ASCII percent-encoded as UTF-8 (a Location is latin1 bytes); ASCII as it is.
  const encoded = location.replace(/[^\x00-\x7f]/gu, encodeURIComponent);
  if (encoded.length > RESPONSE_HEADER_VALUE_LIMIT)
    throw new TypeError(
      `redirect() target is ${encoded.length} characters; past ` +
        `${RESPONSE_HEADER_VALUE_LIMIT} the Location header (and the scripted transport's ` +
        `redirect header) would overflow receivers and the response dies at the socket. ` +
        `A target this size is usually unbounded input echoed into the url — carry the ` +
        `state server-side instead. Refused rather than trimmed: a cut target is a ` +
        `different address.`,
    );
  headers.set("Location", encoded);
  return new Response(null, { ...responseInit, headers });
}

/** An empty response asking for the named cache keys (or the host's default) to load again. */
export function reload(init: ResponseHelperInit = {}) {
  const { responseInit, headers } = initWithRevalidate(init);
  return new Response(null, { ...responseInit, headers });
}

/** `value` with response metadata; the response carries it as plain JSON for clients without the runtime. */
export function respond<T>(value: T, init: ResponseHelperInit = {}) {
  const { responseInit, headers } = initWithRevalidate(init);
  for (const header of COMPOSED_BODY_FRAMING) headers.delete(header);
  if (NULL_BODY_STATUSES.has(responseInit.status)) return new ResponseEnvelope(new Response(null, { ...responseInit, headers }), value);
  headers.set("Content-Type", "application/json");
  return new ResponseEnvelope(new Response(JSON.stringify(value), { ...responseInit, headers }), value);
}

// ---------------------------------------------------------------- cookies

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | "Lax" | "Strict" | "None";
  partitioned?: boolean;
}

/** A Cookie header as a name → value map (both decoded where they can be). */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') value = value.slice(1, -1);
    cookies[decodeSafe(part.slice(0, eq).trim())] = decodeSafe(value);
  }
  return cookies;
}
function decodeSafe(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const DEV = "_SOLID_DEV_" as unknown as boolean;

/** A Set-Cookie value; Path defaults to `/`, every other attribute only when given. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (DEV) assertServableCookie(name, options);
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  cookie += `; Path=${options.path === undefined ? "/" : options.path}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${Math.trunc(options.maxAge)}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.partitioned) cookie += "; Partitioned";
  if (options.sameSite) {
    const s = options.sameSite.toLowerCase();
    cookie += `; SameSite=${s === "none" ? "None" : s === "strict" ? "Strict" : "Lax"}`;
  }
  return cookie;
}

/** Cookies every browser drops without a word: refused while developing. */
function assertServableCookie(name: string, options: CookieOptions) {
  const reject = (reason: string) => {
    throw new Error(`serializeCookie: every browser silently rejects this cookie — ${reason}. ` + `It would never come back on a request, with no error anywhere.`);
  };
  const lower = name.toLowerCase();
  if (lower.startsWith("__host-")) {
    if (!options.secure) reject(`the __Host- prefix on \`${name}\` requires \`secure: true\``);
    if (options.path !== undefined && options.path !== "/")
      reject(`the __Host- prefix on \`${name}\` requires \`Path=/\` (got \`${options.path}\`) — ` + `host-locking is the prefix's whole contract, so it cannot be path-scoped`);
    if (options.domain) reject(`the __Host- prefix on \`${name}\` forbids \`Domain\` (got \`${options.domain}\`)`);
  } else if (lower.startsWith("__secure-") && !options.secure) reject(`the __Secure- prefix on \`${name}\` requires \`secure: true\``);
  if (options.sameSite && options.sameSite.toLowerCase() === "none" && !options.secure) reject("`SameSite=None` requires `secure: true`");
  if (options.partitioned && !options.secure) reject("`Partitioned` requires `secure: true`");
}

/** The cookie carrying a no-JS form post's outcome to the page after the redirect. */
export const FLASH_COOKIE = "flash";
const FLASH_MATCHER = /(?:^|;\s*)flash=([^;]+)/;
export function hasFlashCookie(cookieHeader: string | null): boolean {
  return !!cookieHeader && FLASH_MATCHER.test(cookieHeader);
}
export function matchFlashCookie(cookieHeader: string | null): string | undefined {
  const match = cookieHeader && cookieHeader.match(FLASH_MATCHER);
  return match ? match[1] : undefined;
}
export function clearFlashCookie(): string {
  return `${FLASH_COOKIE}=; Max-Age=0; Path=/`;
}
