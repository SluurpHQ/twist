// The flash cookie: a no-JS form post's outcome carried to the page after the redirect, as AES-GCM encrypted JSON
// (it holds what the user typed). The key derives from the deployment secret. Server only. (Solid's flash.)
// @ts-nocheck
import { FLASH_COOKIE, parseCookieHeader, serializeCookie } from "../response.ts";

/** (Off when run from source, as Solid's strict read of its build flag is.) */
const DEV = false;

// The secret: `configureServerFunctionsServer({ secret })`, else `globalThis.__SOLID_SECRET__`, else no flash.
let configuredSecret: string | undefined;
export function setFlashSecret(secret: string | undefined) {
  configuredSecret = secret;
}
const resolveSecret = () => (configuredSecret !== undefined ? configuredSecret : (globalThis as any).__SOLID_SECRET__);

// The key: PBKDF2-HMAC-SHA-256 over the secret, the domain string as salt (other uses of the secret derive their own).
const FLASH_KEY_DOMAIN = "solid.flash.v1\0";
const FLASH_KEY_ITERATIONS = 100_000;
let cachedSecret: string | undefined;
let cachedKey: Promise<CryptoKey> | undefined;
function resolveFlashKey() {
  const secret = resolveSecret();
  if (typeof secret !== "string" || secret.length === 0) return null;
  if (secret !== cachedSecret) {
    cachedSecret = secret;
    const encoder = new TextEncoder();
    cachedKey = crypto.subtle
      .importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"])
      .then((material) =>
        crypto.subtle.deriveKey({ name: "PBKDF2", salt: encoder.encode(FLASH_KEY_DOMAIN), iterations: FLASH_KEY_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ]),
      );
  }
  return cachedKey;
}

let warnedMissingKey = false;
function warnMissingKey() {
  if (!DEV || warnedMissingKey) return;
  warnedMissingKey = true;
  console.warn(
    "[solid] A no-JS form outcome was not flashed: the flash cookie is encrypted and no key " +
      "is configured. Set configureServerFunctionsServer({ secret }) — or build with the Solid " +
      "bundler plugin, which provides a per-deployment key automatically. The submission " +
      "committed and the redirect was served; only the outcome echo was withheld.",
  );
}

// `1.<base64url(iv || ciphertext || tag)>`
const FLASH_FORMAT_VERSION = "1.";
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
function toBase64url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(text: string) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function encryptFlashValue(key: CryptoKey, json: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(json)));
  const packed = new Uint8Array(IV_BYTES + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, IV_BYTES);
  return FLASH_FORMAT_VERSION + toBase64url(packed);
}
async function decryptFlashValue(key: CryptoKey, value: string) {
  if (!value.startsWith(FLASH_FORMAT_VERSION)) return;
  const packed = fromBase64url(value.slice(FLASH_FORMAT_VERSION.length));
  if (packed.length <= IV_BYTES + GCM_TAG_BYTES) return;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.subarray(0, IV_BYTES) }, key, packed.subarray(IV_BYTES));
  return new TextDecoder().decode(plain);
}

export interface FlashSubmission {
  input: any[];
  url: string;
  result?: any;
  error?: any;
  truncated?: boolean;
}

// Form payloads as entry pairs ($f FormData, $u URLSearchParams); files dropped.
function encodeInputValue(value: any) {
  if (value instanceof FormData) return { $f: [...value.entries()].filter(([, v]) => typeof v === "string") };
  if (value instanceof URLSearchParams) return { $u: [...value.entries()] };
  return value;
}
function decodeInputValue(value: any) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.$f)) {
      const form = new FormData();
      for (const [k, v] of value.$f) form.append(k, v);
      return form;
    }
    if (Array.isArray(value.$u)) return new URLSearchParams(value.$u);
  }
  return value;
}

/**
 * A no-JS call's outcome as a Set-Cookie value; null without a key, or when it cannot fit the 4 KB ceiling even
 * degraded (input dropped, value bounded, then refused: a cut url would name another submission).
 */
export async function encodeFlashCookie(url: string, result: any, input: any[], thrown?: boolean): Promise<string | null> {
  const key = resolveFlashKey();
  if (!key) {
    warnMissingKey();
    return null;
  }
  const isError = result instanceof Error;
  const payload: any = { url, result: isError ? result.message : result, error: isError, thrown: !!thrown, input: input.map(encodeInputValue) };
  if (fitsCookie(payload)) return flashCookie(payload, await key);
  payload.truncated = true;
  payload.input = [];
  if (!fitsCookie(payload)) {
    if (typeof payload.result === "string") {
      let prefix = payload.result;
      while (prefix.length > 0 && !fitsCookie({ ...payload, result: prefix })) prefix = prefix.slice(0, prefix.length >> 1);
      payload.result = prefix.length > 0 ? prefix : true;
    } else payload.result = true;
  }
  if (!fitsCookie(payload)) return null;
  return flashCookie(payload, await key);
}

// One-shot: a minute is plenty; Lax so it rides the GET that follows the 303.
const FLASH_MAX_AGE_SECONDS = 60;
async function flashCookie(payload: any, key: CryptoKey) {
  return serializeCookie(FLASH_COOKIE, await encryptFlashValue(key, JSON.stringify(payload)), { secure: true, httpOnly: true, sameSite: "lax", maxAge: FLASH_MAX_AGE_SECONDS });
}

/** Whether the encrypted value fits the cookie's 4000-byte name=value budget (computed from the plaintext's size). */
const COOKIE_PAIR_BUDGET = 4000;
function fitsCookie(payload: any) {
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  const packedBytes = IV_BYTES + plaintextBytes + GCM_TAG_BYTES;
  const valueLength = FLASH_FORMAT_VERSION.length + Math.ceil((packedBytes * 4) / 3);
  return FLASH_COOKIE.length + 1 + valueLength <= COOKIE_PAIR_BUDGET;
}

/** The flash cookie out of a Cookie header; undefined when absent or unreadable (never a throw). */
export async function decodeFlashCookie(cookieHeader: string | null): Promise<FlashSubmission | undefined> {
  const match = parseCookieHeader(cookieHeader)[FLASH_COOKIE];
  if (!match) return;
  try {
    const key = resolveFlashKey();
    if (!key) return;
    const json = await decryptFlashValue(await key, match);
    if (json === undefined) return;
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== "object" || !("result" in payload)) return;
    const result = payload.error ? new Error(payload.result) : payload.result;
    const submission: FlashSubmission = {
      input: Array.isArray(payload.input) ? payload.input.map(decodeInputValue) : [],
      url: payload.url,
      result: payload.thrown ? undefined : result,
      error: payload.thrown ? result : undefined,
    };
    if (payload.truncated) submission.truncated = true;
    return submission;
  } catch (error) {
    if (DEV) console.error(error);
  }
}
