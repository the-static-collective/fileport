import test from "node:test";
import assert from "node:assert/strict";
import { fetchPreview,createPreview,MAX_PREVIEW_BYTES } from "../public/media-preview.js";
const file={id:"00000000-0000-4000-8000-000000000001",size:4,type:"video/mp4"};
const ok=()=>new Response(new Uint8Array([1,2,3,4]),{headers:{"Content-Type":"video/mp4","Content-Length":"4"}});
test("compatibility uses full authenticated same-origin response and exact size",async()=>{
  const blob=await fetchPreview(file,{fetcher:async(path,opts)=>{
    assert.equal(path,"/api/share/file/"+file.id);
    assert.equal(opts.credentials,"same-origin");
    assert.equal(opts.cache,"no-store");
    assert.equal(opts.redirect,"error");
    assert.ok(!("Range" in opts.headers));
    return ok();
  }});
  assert.equal(blob.type,file.type);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[1,2,3,4]);
});
test("fail closed for access denied, partial response, type, size and oversize",async()=>{
  for(const response of [
    ()=>new Response("",{status:404}),
    ()=>new Response("1234",{status:206,headers:{"Content-Type":"video/mp4"}}),
    ()=>new Response("1234",{headers:{"Content-Type":"text/html"}}),
    ()=>new Response("12345",{headers:{"Content-Type":"video/mp4"}}),
    ()=>new Response("123",{headers:{"Content-Type":"video/mp4"}})
  ])await assert.rejects(()=>fetchPreview(file,{fetcher:async()=>response()}));
  await assert.rejects(()=>fetchPreview({...file,size:MAX_PREVIEW_BYTES+1},{fetcher:async()=>assert.fail("must not request")}),/limit/);
});
function fixture(){
  const media=new EventTarget();media.load=()=>{};media.pause=()=>{};
  media.removeAttribute=()=>{media.src="";};
  const statuses=[],revoked=[];
  const urls={createObjectURL:()=>"blob:fixture",revokeObjectURL:x=>revoked.push(x)};
  return {media,statuses,revoked,urls};
}
test("stream first, compatibility on demand, one attempt and cleanup",async()=>{
  const f=fixture();let calls=0,fallback=0;
  const controller=createPreview({...f,file,onStatus:x=>f.statuses.push(x),onFallback:()=>fallback++,
    fetcher:async()=>{calls++;return ok();}});
  controller.start();assert.equal(f.media.src,"/api/share/file/"+file.id);
  await controller.compatibility();await controller.compatibility();
  assert.equal(calls,1);assert.equal(fallback,1);assert.equal(f.media.src,"blob:fixture");
  f.media.dispatchEvent(new Event("loadedmetadata"));assert.match(f.statuses.at(-1),/ready/);
  f.media.error={code:4};f.media.dispatchEvent(new Event("error"));
  assert.match(f.statuses.at(-1),/decode/);
  controller.close();controller.close();assert.deepEqual(f.revoked,["blob:fixture"]);
});
test("native stream error triggers one compatibility attempt, close cancels pending work",async()=>{
  const f=fixture();let calls=0,signal,resolve;
  const waiting=new Promise(r=>resolve=r);
  const controller=createPreview({...f,file,onStatus:x=>f.statuses.push(x),onFallback:()=>{},
    fetcher:async(p,o)=>{calls++;signal=o.signal;return waiting;}});
  controller.start();
  f.media.dispatchEvent(new Event("error"));f.media.dispatchEvent(new Event("error"));
  assert.equal(calls,1);
  controller.close();assert.equal(signal.aborted,true);
  resolve(ok());await new Promise(r=>setImmediate(r));
  assert.equal(f.media.src,"");assert.deepEqual(f.revoked,[]);
});
