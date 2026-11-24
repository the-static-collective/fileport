import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequest } from "../functions/api/[[path]].js";

test("STATIC ID routes are isolated from private storage and disabled without deployment secrets",async()=>{
  const req=new Request("https://fileport.abundent.org/api/static-id/status");
  const response=await onRequest({request:req,env:{}});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:"Static ID is not configured"});
  const unrelated=await onRequest({request:new Request("https://fileport.abundent.org/api/health"),env:{}});
  assert.equal(unrelated.status,503);
  assert.deepEqual(await unrelated.json(),{error:"Fileport not configured"});
});
test("owner API explicitly supports pinned STATIC ID and independent legacy emergency bearer",async()=>{
  const source=await readFile(new URL("../functions/api/[[path]].js",import.meta.url),"utf8");
  assert.match(source,/requireStaticIdOwner/);
  assert.match(source,/adminAuthorized/);
  assert.match(source,/!recoveryAuthorized && !await requireStaticIdOwner/);
  assert.match(source,/handleStaticIdRequest/);
  assert.match(source,/pathname.startsWith\\("\/api\/static-id\/"\\)/);
  assert.ok(source.indexOf("pathname.startsWith(\\"/api/static-id/\\")")<source.indexOf("if (!configured(env))"));
  assert.doesNotMatch(source,/STATIC_ID_COOKIE_KEY\s*=\s*["']/);
});
test("browser sends same-origin cookies for SSO, not a blank owner key header",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(app,/owner && state.key/);
  assert.match(app,/credentials: owner && state.key \? "omit" : "same-origin"/);
  assert.match(app,/if \(state.key\) xhr.setRequestHeader/);
  assert.match(app,/checkStaticId/);
  assert.match(html,/id="static-id-login"/);
  assert.match(html,/Emergency owner-key recovery/);
  assert.doesNotMatch(html,/id="static-id-login"[^>]*hidden[^>]*>.*six-digit code/i);
});
