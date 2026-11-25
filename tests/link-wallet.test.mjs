import test from "node:test";
import assert from "node:assert/strict";
import {privateUrl,change,wallet} from "../lib/link-wallet.js";
const id="11111111-1111-4111-8111-111111111111",owner="22222222-2222-4222-8222-222222222222";
const item={title:"Example",url:"https://example.org/#share=synthetic",collection:"Music",note:""};
test("private HTTPS links preserve fragments; unsafe schemes and userinfo refused",()=>{
 assert.equal(privateUrl(item.url),item.url);
 for(const v of ["javascript:alert(1)","http://example.org","https://user:pass@example.org","https://example.org/\n"])assert.throws(()=>privateUrl(v));
});
test("stable pointer ID, exact duplicate rejection, archive, restore, removal",()=>{
 let a=change([],{action:"add",revision:0,link:item},()=>id);
 assert.throws(()=>change(a,{action:"add",link:item}));
 a=change(a,{action:"edit",id,link:{...item,url:"https://example.org/next"}});
 assert.equal(a[0].id,id);
 a=change(a,{action:"archive",id});assert.equal(a[0].archived,true);
 a=change(a,{action:"restore",id});assert.equal(a[0].archived,false);
 assert.deepEqual(change(a,{action:"remove",id}),[]);
});
test("unverified owner cannot even query wallet",async()=>{
 const r=await wallet(new Request("https://fileport.example/api/wallet"),{STATIC_ID_OWNER_SUB:owner},{query(){throw Error("must not query");}},async()=>false);
 assert.equal(r.status,401);
});
test("owner-scoped reads, same-origin mutations and stale revision refusal",async()=>{
 let queries=0;
 const sql={async query(q,args){queries++;assert.equal(args[0],owner);return [{revision:2,links:[]}];}};
 const env={STATIC_ID_OWNER_SUB:owner},verify=async()=>true;
 let r=await wallet(new Request("https://fileport.example/api/wallet"),env,sql,verify);
 assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);
 r=await wallet(new Request("https://fileport.example/api/wallet",{method:"POST",headers:{"Origin":"https://other.example"}}),env,sql,verify);
 assert.equal(r.status,403);
 r=await wallet(new Request("https://fileport.example/api/wallet",{method:"POST",headers:{"Origin":"https://fileport.example","Content-Type":"application/json"},body:JSON.stringify({action:"add",revision:1,link:item})}),env,sql,verify);
 assert.equal(r.status,409);assert.equal(queries,2);
});
test("concurrent first insert conflict is not overwritten",async()=>{
 const sql={async query(q,args){assert.equal(args[0],owner);return [];}};
 const r=await wallet(new Request("https://fileport.example/api/wallet",{method:"POST",headers:{"Origin":"https://fileport.example","Content-Type":"application/json"},body:JSON.stringify({action:"add",revision:0,link:item})}),{STATIC_ID_OWNER_SUB:owner},sql,async()=>true);
 assert.equal(r.status,409);
});
