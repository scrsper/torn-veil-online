/** Read-only transport evidence. Capture headers before awaiting a response
 * body, which a following page reload may make unavailable to Playwright. */
export function httpFailureEvidence(response,at){
 const path=new URL(response.url()).pathname;
 return{status:response.status(),path,method:response.request().method(),at,
  optionalMotion:/\/arena\/(?:mixamo_clips|unarmed_clips)\.glb$/i.test(path),
  condition:response.headers()['x-tv-universe-condition']??null};
}

/** Only the host's exact save-busy proof plus a later successful status read
 * establishes recovery. Other endpoints and unmarked failures remain failures. */
export function recoveredCrossingBackpressure(entry,lastSuccessAt){
 return entry.status===503&&entry.path==='/realms/universe'&&entry.method==='GET'
  &&(entry.condition==='saving-crossing'||entry.reason==='Saving the crossing. Try again shortly.')
  &&Number.isFinite(lastSuccessAt)&&lastSuccessAt>entry.at;
}

export function recordInputReceipts(page,report){
 report.inputReceipts??=[];report.controlFailures??=[];
 page.on('websocket',socket=>{
  if(new URL(socket.url()).pathname!=='/realms/universe/socket')return;
  socket.on('framereceived',event=>{try{
   const m=JSON.parse(String(event.payload));if(m.type!=='universe_input_receipt')return;
   const entry={at:Date.now(),seq:m.seq,phase:m.phase,ok:m.ok,
    ...(m.error?{error:String(m.error).slice(0,240)}:{})};
   if(report.inputReceipts.length<4096)report.inputReceipts.push(entry);
   if(!m.ok)report.controlFailures.push(entry);
  }catch{}});
 });
}
