import type { WebSocket } from 'ws';
/** Monotonic process timing only; bounded diagnostics never participate in simulation. */
export const transportTimings:Record<string,number|string>[]=[];
export function timedSend(socket:WebSocket,message:object):void {
  const m=message as Record<string,unknown>,serializeStart=performance.now();
  const payload=JSON.stringify(message),serializeEnd=performance.now(),queuedBytes=socket.bufferedAmount;
  socket.send(payload,()=>{
    if(m.type!=='command_receipt'||m.status==='received')return;
    transportTimings.push({commandId:String(m.commandId),arrival:Number(m.receivedAtMs),nextTick:Number(m.tickStartedAtMs),application:Number(m.appliedAtMs),
      serializeStart,serializeEnd,socketSend:serializeEnd,socketFlushed:performance.now(),queuedBytes,bytes:Buffer.byteLength(payload)});
    if(transportTimings.length>2048)transportTimings.shift();
  });
}
