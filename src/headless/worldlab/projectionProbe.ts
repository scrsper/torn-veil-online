/** Explicit developer camera/region probe, NOT travel acceptance. One saved World is kept
 * throughout. Relocations are disclosed; real movement evidence lives in playable.ts. */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeSession } from '../../bridge/session';
import { RegionStream } from '../../bridge/regions';
const session=new BridgeSession(0,{save:readFileSync(process.argv[2]??'.debug/playable-acceptance.save.json','utf8')}),w=session.world;
const road=w.geography!.roads.slice().sort((a,b)=>a.length-b.length)[0];
const places=[w.settlements().find(s=>s.siteId===road.from)!.location,road.points[Math.floor(road.points.length/2)],w.settlements().find(s=>s.siteId===road.to)!.location];
let stage=-1;
function next() { stage=(stage+1)%places.length; const pos=places[stage],b=w.primaryBody(w.playerId!)!; b.pos={x:pos.x,y:w.nav.floorY(Math.floor(pos.x),Math.floor(pos.z)),z:pos.z}; for(let i=0;i<6;i++) session.step(.05); return {stage,label:['Settlement A','Wilderness','Settlement B'][stage],pos:b.pos,worldTime:w.now}; }
next();
const http=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/next'?next():{stage,worldTime:w.now}));});
const sockets=new Map<WebSocket,RegionStream>();
new WebSocketServer({server:http}).on('connection',(socket,request)=>{
  if(request.headers['x-torn-veil-client']!=='unreal'){socket.close();return;}
  console.log('Native projection observer connected');
  socket.send(JSON.stringify({version:1,type:'hello',controls:false,playerId:w.playerId})); socket.send(JSON.stringify(session.scene())); sockets.set(socket,new RegionStream()); socket.on('close',(code,reason)=>{sockets.delete(socket);console.log('Observer closed',code,reason.toString());});
});
setInterval(()=>{session.step(.05); for(const [socket,stream] of sockets) if(socket.readyState===WebSocket.OPEN&&socket.bufferedAmount<512000){socket.send(JSON.stringify(stream.frame(w)));socket.send(JSON.stringify(session.snapshot()));}},100);
http.listen(8787,'127.0.0.1',()=>console.log('DEVELOPER PROJECTION PROBE ONLY: /next relocates; not a travel result. No save writes.'));
