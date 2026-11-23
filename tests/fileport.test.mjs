import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_UPLOAD_BYTES, SHARE_COOKIE, validUuid, validToken, validSlug,
  cleanName, mimeType, generateToken, sha256, adminAuthorized,
  cookieToken, shareCookie, removeShareCookie, contentDisposition,
  safeInline, readObject
} from "../lib/core.js";
import { onRequest } from "../functions/api/[[path]].js";

test("opaque invitations are 256-bit random, syntactically validated and hashable", async () => {
  const a = generateToken(), b = generateToken();
  assert.equal(a.length, 43); assert.equal(b.length, 43);
  assert.ok(validToken(a)); assert.notEqual(a,b);
  assert.match(await sha256(a), /^[0-9a-f]{64}$/);
  for(const value of ["short",null,"a".repeat(42),"a".repeat(44),"a".repeat(42)+"!"]) assert.equal(validToken(value),false);
});
test("workspace, file and name boundaries fail closed", () => {
  assert.ok(validSlug("static-collective")); assert.ok(validSlug("willowlab"));
  assert.equal(validSlug("../bad"),false); assert.equal(validSlug("A"),false);
  assert.ok(validUuid("1d6b37c4-06b7-4ddf-b2fd-ad83f8a6576c"));
  assert.equal(validUuid("file.mp4"),false);
  assert.equal(cleanName("../hello.mp4"),".._hello.mp4");
  assert.equal(cleanName("slash\\hidden"),"slash_hidden");
  assert.equal(mimeType("Video/MP4; charset=utf-8"),"video/mp4");
  assert.equal(mimeType("random"),"application/octet-stream");
  assert.equal(MAX_UPLOAD_BYTES,26214400);
});
test("owner access is not a cookie and requires a 32+ character secret", async () => {
  const secret = "z".repeat(44);
  const env = { FILEPORT_ADMIN_TOKEN: secret };
  const withKey = t => new Request("https://site.test/api/admin/status",{headers:{Authorization:"Bearer "+t}});
  assert.equal(await adminAuthorized(withKey(secret),env),true);
  assert.equal(await adminAuthorized(withKey("a".repeat(44)),env),false);
  assert.equal(await adminAuthorized(withKey(secret),{FILEPORT_ADMIN_TOKEN:"short"}),false);
  assert.equal(await adminAuthorized(new Request("https://site.test/api/admin/status"),env),false);
});
test("recipient cookie is secure, httpOnly, and bounded", () => {
  const tok=generateToken();
  const cookie=shareCookie(tok,86400);
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("Max-Age=43200"));
  assert.equal(cookieToken(new Request("https://example.test",{headers:{Cookie: SHARE_COOKIE+"="+tok}})),tok);
  assert.equal(cookieToken(new Request("https://example.test",{headers:{Cookie:"other=1"}})),null);
  assert.ok(removeShareCookie().includes("Max-Age=0"));
});
test("preview only trusted MIME types and keep file names safe", () => {
  assert.equal(safeInline("video/mp4"),true);
  assert.equal(safeInline("application/pdf"),true);
  assert.equal(safeInline("text/html"),false);
  assert.equal(safeInline("image/svg+xml"),false);
  assert.ok(contentDisposition("clip.mp4",false).startsWith("inline;"));
  assert.ok(contentDisposition("payload.html",true).startsWith("attachment;"));
});
test("JSON requests are strictly typed and limited", async () => {
  const req=payload=>new Request("https://example.test",{method:"POST",headers:{"Content-Type":"application/json"},body:payload});
  assert.deepEqual(await readObject(req('{"hello":1}')),{hello:1});
  await assert.rejects(()=>readObject(req("[]")),/Invalid JSON/);
  await assert.rejects(()=>readObject(req('"hello"')),/Invalid JSON/);
  await assert.rejects(()=>readObject(req("x".repeat(100)),10),/too large/);
});
test("unconfigured runtime fails closed rather than exposing secrets or files", async () => {
  const res=await onRequest({request:new Request("https://example.test/api/health"),env:{}});
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{error:"Fileport not configured"});
});
test("browser assets have no storage credentials or signed S3 URLs", async () => {
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.doesNotMatch(html+app,/S3_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|DATABASE_URL|X-Amz-Signature/);
  const source=await readFile(new URL("../functions/api/[[path]].js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/getSignedUrl|X-Amz-/);
  assert.match(source,/FILEPORT_BUCKET\.get/);
  assert.match(source,/revoked_at IS NULL AND expires_at > now\(\)/);
  assert.match(source,/f\.state='approved'/);
});
