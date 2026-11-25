// Shared text is untrusted. Preserve the exact HTTPS target; never fetch or open it.
export const DRAFT_TTL=15*60*1000;
export const MAX_BODY=32768;
export function safeLink(value){
 if(typeof value!=="string"||!value||value.length>4096||/[\x00-\x20\x7f]/.test(value))throw Error("Invalid HTTPS link");
 const u=new URL(value);
 if(u.protocol!=="https:"||u.username||u.password||!u.hostname)throw Error("Only HTTPS links without embedded credentials");
 return value;
}
export function parseShared(params,now=Date.now()){
 if([...params.keys()].some(k=>!["title","text","url"].includes(k))||["title","text","url"].some(k=>params.getAll(k).length>1))throw Error("Invalid share");
 const title=(params.get("title")||"").replace(/[\x00-\x1f\x7f]/g," ").trim().slice(0,160);
 const explicit=(params.get("url")||"").trim(),text=(params.get("text")||"").trim();
 let url;
 if(explicit)url=safeLink(explicit);
 else{
   const matches=[...new Set(text.match(/https:\/\/[^\s<>"']+/gi)||[])];
   if(matches.length!==1)throw Error("Share one HTTPS link at a time");
   url=safeLink(matches[0]);
 }
 return {url,title:title||new URL(url).hostname,created:now};
}
export function validateDraft(value,now=Date.now()){
 if(!value||typeof value!=="object"||Object.keys(value).sort().join(",")!=="created,title,url"||
 !Number.isSafeInteger(value.created)||value.created>now||now-value.created>=DRAFT_TTL||
 typeof value.title!=="string"||!value.title.trim()||value.title.length>160||/[\x00-\x1f\x7f]/.test(value.title))throw Error("Expired or invalid shared draft");
 return {url:safeLink(value.url),title:value.title,created:value.created};
}
export async function readShare(request){
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded"))throw Error("Unsupported share format");
 const length=request.headers.get("content-length");if(length&&Number(length)>MAX_BODY)throw Error("Share too large");
 if(!request.body)throw Error("Missing share");
 const reader=request.body.getReader(),parts=[];let count=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>MAX_BODY){await reader.cancel();throw Error("Share too large");}parts.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return parseShared(new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
}
export async function shareResponse(request){
 const destination=new URL("/",request.url);
 try{const draft=await readShare(request);destination.hash="wallet-draft="+encodeURIComponent(JSON.stringify(draft));}
 catch{destination.hash="wallet-share-error";}
 return new Response(null,{status:303,headers:{Location:destination.href,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
export function isShareNavigation(request,origin){
 const u=new URL(request.url);
 return u.origin===origin&&u.pathname==="/api/wallet-capture"&&!u.search&&request.method==="POST"&&request.mode==="navigate";
}
