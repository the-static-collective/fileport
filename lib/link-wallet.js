import { json, validUuid, readObject } from "./core.js";
const MAX=200;
const fail=(message,status=400)=>json({error:message},status);
function short(v,max,required=false){
  if(typeof v!=="string" || v.length>max || (required&&!v.trim()) || /[\x00-\x1f\x7f]/.test(v))throw Error("Invalid text");
  return v.trim();
}
// Unlike SIA's PUBLIC profile, private wallet may retain capability fragments.
// No server fetch, redirect, preview, crawler or publication.
export function privateUrl(v){
  if(typeof v!=="string"||v.length>4096||/[\x00-\x20\x7f]/.test(v))throw Error("Enter a complete HTTPS link");
  let u;try{u=new URL(v);}catch{throw Error("Invalid URL");}
  if(u.protocol!=="https:"||u.username||u.password||!u.hostname)throw Error("HTTPS links without embedded username/password only");
  return v;
}
export function cleanLink(v){
  if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).some(k=>!["title","url","collection","note"].includes(k)))throw Error("Invalid link");
  const url=privateUrl(v.url);
  return {title:short(v.title,160,true),url,collection:short(v.collection??"",80),note:short(v.note??"",500)};
}
export function change(links,data,makeId=()=>crypto.randomUUID(),clock=()=>new Date().toISOString()){
  if(!Array.isArray(links)||links.length>MAX||!data||typeof data!=="object")throw Error("Invalid wallet");
  const allowed={add:["action","revision","link"],edit:["action","revision","id","link"],archive:["action","revision","id"],restore:["action","revision","id"],remove:["action","revision","id"]};
  if(!Object.hasOwn(allowed,data.action)||Object.keys(data).some(k=>!allowed[data.action].includes(k)))throw Error("Unknown wallet action");
  const now=clock();
  if(data.action==="add"){
    if(links.length>=MAX)throw Error("Wallet limit reached; remove an entry first");
    const link=cleanLink(data.link);
    if(links.some(x=>x.url===link.url))throw Error("Exact link already saved");
    return [{id:makeId(),...link,archived:false,createdAt:now,updatedAt:now},...links];
  }
  if(!validUuid(data.id)||!links.some(x=>x.id===data.id))throw Error("Link not found");
  if(data.action==="remove")return links.filter(x=>x.id!==data.id);
  const patch=data.action==="edit"?cleanLink(data.link):{archived:data.action==="archive"};
  if(data.action==="edit"&&links.some(x=>x.id!==data.id&&x.url===patch.url))throw Error("Exact link already saved");
  return links.map(x=>x.id===data.id?{...x,...patch,updatedAt:now}:x);
}
export async function wallet(request,env,sql,verify){
  // No recovery-key or share-cookie authorization; only the pinned StaticID owner.
  if(!await verify(request,env)||!validUuid(env.STATIC_ID_OWNER_SUB))return fail("StaticID owner login required",401);
  const owner=env.STATIC_ID_OWNER_SUB;
  if(!["GET","POST"].includes(request.method))return fail("Method not allowed",405);
  if(request.method==="POST"&&request.headers.get("Origin")!==new URL(request.url).origin)return fail("Same-origin request required",403);
  const rows=await sql.query("SELECT revision,links FROM public.fileport_link_wallets WHERE owner_sub=$1",[owner]);
  const row=rows[0]||{revision:0,links:[]};
  if(request.method==="GET")return json(row);
  let data,next;
  try{
    data=await readObject(request,8192);
    if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error("Invalid revision");
    if(data.revision!==row.revision)return fail("Wallet changed on another device. Refresh and try again.",409);
    next=change(row.links,data);
  }catch(e){return fail(e.message);}
  const values=[owner,JSON.stringify(next),row.revision];
  const written=row.revision===0?
    await sql.query("INSERT INTO public.fileport_link_wallets(owner_sub,links,revision) VALUES($1,$2::jsonb,1) ON CONFLICT DO NOTHING RETURNING revision,links",values.slice(0,2)):
    await sql.query("UPDATE public.fileport_link_wallets SET links=$2::jsonb,revision=revision+1,updated_at=now() WHERE owner_sub=$1 AND revision=$3 RETURNING revision,links",values);
  return written.length?json(written[0]):fail("Wallet changed on another device. Refresh and try again.",409);
}
