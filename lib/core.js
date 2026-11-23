export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const SHARE_COOKIE = "__Host-fileport";

const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}

export function validUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
export function validSlug(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(value);
}
export function cleanName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\\/\x00-\x1f\x7f]/g, "_").trim().slice(0, 255);
}
export function mimeType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/.test(type) ? type : "application/octet-stream";
}
export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function adminAuthorized(request, env) {
  const expected = env.FILEPORT_ADMIN_TOKEN;
  const header = request.headers.get("Authorization") || "";
  if (typeof expected !== "string" || expected.length < 32 ||
      !header.startsWith("Bearer ") || header.length > 512) return false;
  const supplied = header.slice(7);
  if (!supplied) return false;
  const a = await sha256(supplied);
  const b = await sha256(expected);
  let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export function cookieToken(request) {
  const cookie = request.headers.get("Cookie") || "";
  const part = cookie.split(";").map(x => x.trim()).find(x => x.startsWith(SHARE_COOKIE + "="));
  const value = part ? part.slice(SHARE_COOKIE.length + 1) : "";
  return validToken(value) ? value : null;
}
export function shareCookie(token, seconds) {
  const maxAge = Math.max(0, Math.min(43200, Math.floor(seconds)));
  return SHARE_COOKIE + "=" + token + "; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=" + maxAge;
}
export function removeShareCookie() {
  return SHARE_COOKIE + "=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0";
}
export function contentDisposition(name, download) {
  const ascii = cleanName(name).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return (download ? "attachment" : "inline") +
    '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(cleanName(name));
}
export function safeInline(type) {
  return /^(?:video\/(?:mp4|webm)|audio\/(?:mpeg|mp4|ogg|wav)|image\/(?:png|jpeg|webp|gif)|application\/pdf|text\/plain)$/.test(type);
}
export async function readObject(request, limit = 8192) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) throw new Error("JSON required");
  const text = await request.text();
  if (text.length > limit) throw new Error("Request too large");
  const parsed = JSON.parse(text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Invalid JSON body");
  return parsed;
}
