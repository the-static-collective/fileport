// Same-origin invitation playback. No persistent cache or alternative authorization.
export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
export async function fetchPreview(file,{fetcher=fetch,signal}={}){
  const size=Number(file.size);
  if(!Number.isSafeInteger(size)||size<1||size>MAX_PREVIEW_BYTES)
    throw Error("This file exceeds the compatibility preview limit. Use Download.");
  const path="/api/share/file/"+encodeURIComponent(file.id);
  const response=await fetcher(path,{
    method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",
    headers:{Accept:file.type},signal
  });
  if(response.status!==200)throw Error("The full preview could not be loaded. Try Download.");
  const type=(response.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(type!==file.type)throw Error("Unexpected media response. Use Download.");
  const length=response.headers.get("Content-Length");
  if(length!==null&&Number(length)!==size)throw Error("Media size mismatch. Use Download.");
  if(!response.body)throw Error("Media response unavailable. Use Download.");
  const reader=response.body.getReader(),chunks=[];
  let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>size||total>MAX_PREVIEW_BYTES)throw Error("Media size mismatch. Use Download.");
      chunks.push(value);
    }
    if(total!==size)throw Error("Incomplete media response. Use Download.");
    return new Blob(chunks,{type});
  }catch(e){
    try{await reader.cancel();}catch{}
    throw e;
  }finally{reader.releaseLock();}
}
export function createPreview({media,file,onStatus,onFallback,fetcher=fetch,urls=URL}){
  let mode="stream",closed=false,objectUrl=null,abort=null;
  const path="/api/share/file/"+encodeURIComponent(file.id);
  function clearMedia(){
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
  function release(){
    if(objectUrl){urls.revokeObjectURL(objectUrl);objectUrl=null;}
  }
  function fail(){
    if(closed)return;
    const code=media.error?.code;
    if(mode==="stream"){void compatibility();return;}
    if(mode==="blob")onStatus(code===3||code===4
      ?"This browser could not decode the media. Download the original or try another browser."
      :"Compatibility playback failed. Download the original file.");
  }
  function ready(){
    if(closed)return;
    if(mode==="stream")onStatus("Streaming preview ready. Press Play.");
    if(mode==="blob")onStatus("Compatibility preview ready. Press Play.");
  }
  async function compatibility(){
    if(closed||mode!=="stream")return;
    mode="loading";
    onFallback();
    onStatus("Loading compatibility preview into memory…");
    clearMedia();
    abort=new AbortController();
    try{
      const blob=await fetchPreview(file,{fetcher,signal:abort.signal});
      if(closed)return;
      objectUrl=urls.createObjectURL(blob);
      mode="blob";
      media.src=objectUrl;
      media.load();
    }catch(e){
      if(closed)return;
      mode="failed";
      onStatus(e instanceof Error&&/^(This file exceeds|The full preview|Unexpected media|Media size|Media response|Incomplete media)/.test(e.message)
        ?e.message:"Compatibility preview unavailable. Download the original file.");
    }
  }
  media.addEventListener("error",fail);
  media.addEventListener("loadedmetadata",ready);
  return {
    start(){if(!closed&&mode==="stream"){media.src=path;media.load();}},
    compatibility,
    close(){
      if(closed)return;
      closed=true;
      abort?.abort();
      media.removeEventListener("error",fail);
      media.removeEventListener("loadedmetadata",ready);
      clearMedia();release();
    }
  };
}
