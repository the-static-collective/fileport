import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {parseShared,validateDraft,shareResponse,isShareNavigation,MAX_BODY} from "../public/share-draft.js";
const origin="https://fileport.example",secret="https://example.org/#share=synthetic%2Btoken";
const request=p=>new Request(origin+"/api/wallet-capture",{method:"POST",body:new URLSearchParams(p)});
test("manifest share target is POST, explicit scope, real raster icons",async()=>{
 const m=JSON.parse(await readFile(new URL("../public/manifest.webmanifest",import.meta.url),"utf8"));
 assert.equal(m.share_target.method,"POST");assert.equal(m.share_target.action,"/api/wallet-capture");assert.equal(m.scope,"/");
 for(const i of m.icons){const b=await readFile(new URL("../public"+i.src,import.meta.url));assert.equal(b.subarray(1,4).toString(),"PNG");assert.equal(b.readUInt32BE(16),Number(i.sizes.split("x")[0]));assert.equal(b.readUInt32BE(20),Number(i.sizes.split("x")[1]));}
});
test("explicit URL and text fallback retain exact capability fragments",()=>{
 assert.equal(parseShared(new URLSearchParams({url:secret,title:"Song"})).url,secret);
 assert.equal(parseShared(new URLSearchParams({text:"Listen "+secret})).url,secret);
 assert.throws(()=>parseShared(new URLSearchParams({text:secret+" https://example.net/"})));
 for(const url of ["javascript:alert(1)","http://example.org/","https://user:password@example.org/","https://example.org/ x"])assert.throws(()=>parseShared(new URLSearchParams({url})));
});
test("draft expiry and forged fields rejected",()=>{
 const d=parseShared(new URLSearchParams({url:secret}),1000);
 assert.equal(validateDraft(d,1001).url,secret);assert.throws(()=>validateDraft(d,901000));assert.throws(()=>validateDraft({...d,extra:true},1001));
});
test("share POST becomes fragment-only local draft, no URL query or external redirect",async()=>{
 const r=await shareResponse(request({url:secret,title:"Song"}));assert.equal(r.status,303);
 const u=new URL(r.headers.get("location"));assert.equal(u.origin,origin);assert.equal(u.pathname,"/");assert.equal(u.search,"");
 assert.equal(JSON.parse(new URLSearchParams(u.hash.slice(1)).get("wallet-draft")).url,secret);
 assert.match(r.headers.get("cache-control"),/no-store/);
 const bad=await shareResponse(request({text:"x".repeat(MAX_BODY+1)}));assert.equal(new URL(bad.headers.get("location")).hash,"#wallet-share-error");
});
test("worker only handles exact same-origin share navigation; private API/receiver untouched",()=>{
 const r={url:origin+"/api/wallet-capture",method:"POST",mode:"navigate"};
 assert.equal(isShareNavigation(r,origin),true);
 for(const patch of [{method:"GET"},{mode:"cors"},{url:origin+"/api/wallet"},{url:origin+"/api/share/open"},{url:origin+"/api/wallet-capture?x=1"},{url:"https://other.example/api/wallet-capture"}])assert.equal(isShareNavigation({...r,...patch},origin),false);
});
test("no private cache, server fetch, or auto-save in capture path",async()=>{
 const sw=await readFile(new URL("../public/sw.js",import.meta.url),"utf8"),draft=await readFile(new URL("../public/share-draft.js",import.meta.url),"utf8");
 assert.doesNotMatch(sw+draft,/caches\.|fetch\(|localStorage|\/api\/wallet["']/);
});
