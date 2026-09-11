/** Disposable combat lab, never imported by production. Stage arrangement is explicit test
 * setup. Hits, exertion, injuries, body counters and NPC attacks use Simulation.attack.
 * Only signature/lineage/magic/mastery overlays below are synthetic presentation data. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { HumanoidFixture } from './humanoidFixtureServer';
import { ATTACK_COOLDOWN } from '../../sim/physical/combat';
import { combatPresentation } from '../../bridge/combatPresentation';
import { attributeProfile } from '../../sim/core/human';
import type { CombatPresentationEvent } from '../../bridge/combatPresentation';

type FixtureMotif = { fixture: true; techniqueId: string; lineageId?: string; magicDomain?: string; mastery?: number };
export class CombatChoreographyFixture extends HumanoidFixture {
  readonly opponent = this.session.world.persons().find(p => p.id !== this.player.id && p.id !== this.npc.id)!;
  readonly opponentBody = this.session.world.primaryBody(this.opponent.id)!;
  readonly motifs = new Map<number, FixtureMotif>();
  readonly startingPhysiology = new Map([this.player,this.npc,this.opponent].map(p=>[p.id,structuredClone(p.physiology)]));
  constructor() { super(); this.arrange(.8, 0, 8, 8); }
  arrange(distance: number, angle: number, strength: number, dexterity: number) {
    const w = this.session.world;
    for (const [p, b] of [[this.player,this.body],[this.npc,this.npcBody],[this.opponent,this.opponentBody]] as const) {
      p.alive = true; p.surrender = null; p.custody = null; p.physiology = structuredClone(this.startingPhysiology.get(p.id)!);
      p.physiology.fatigue = 0;
      b.health = b.maxHealth = 1000; b.dead = false; b.present = true; b.subduedUntil = 0;
      b.injuries = {}; b.pose = 'stand'; b.poseUntil = 0; b.vel = { x:0,y:0,z:0 }; b.path = null;
      b.lastAttackAt = -99; p.mind.plan = [{ type:'wait', duration:100000,status:'pending' }];
      // Clear held test items to explicitly exercise the supported unarmed family.
      for (const id of p.inventory) { const item=w.item(id); if(item) item.holderId=null; }
      p.inventory=[];
    }
    this.player.attributes = { ...attributeProfile(8), strength, dexterity };
    this.npc.attributes = { ...attributeProfile(8), strength, dexterity };
    this.body.pos = {x:18,y:1,z:18}; this.body.yaw=-Math.PI/2;
    this.npcBody.pos = {x:18+distance*Math.cos(angle),y:1,z:18+distance*Math.sin(angle)}; this.npcBody.yaw=Math.PI/2;
    this.opponentBody.pos={x:20.9,y:1,z:18}; this.opponentBody.yaw=Math.PI/2;
    this.twin.pos={x:23,y:1,z:21};
  }
  override snapshot() {
    const snap=super.snapshot();
    // The isolated lab explicitly opts into omniscient render visibility, never cognitive knowledge.
    const truth=this.session.developerSnapshot();
    const bodies=truth.bodies.filter(b=>[this.body.id,this.npcBody.id,this.twin.id,this.opponentBody.id].includes(b.bodyId)).map(b=>({...b,inventory:b.inventory.map(i=>({...i,name:i.type}))}));
    const stream=combatPresentation(this.session.world,new Set(bodies.map(b=>b.bodyId)));
    const events: (CombatPresentationEvent & Partial<FixtureMotif>)[]=stream.events.map(e=>({...e,...this.motifs.get(e.seq)}));
    return {...snap,bodies,combatPresentation:{...stream,events}};
  }
  override stage(name: string) {
    const presets: Record<string,[number,number,number,number]>={
      near:[.8,0,8,8],far:[1.4,0,8,8],left:[1.1,-Math.PI/6,8,8],right:[1.1,Math.PI/6,8,8],
      low:[1.05,0,5,3],capable:[1.05,0,16,18],force:[1.05,0,18,6],precision:[1.05,0,7,18],
      signature:[1.05,0,12,16],magic:[1.05,0,16,18],npc_duel:[1.05,0,12,16],burst:[1.05,0,12,14],
    };
    if(name.startsWith('arrange_') && presets[name.slice(8)]) { this.arrange(...presets[name.slice(8)]); if(name==='arrange_npc_duel'){this.npcBody.yaw=-Math.PI/2;this.opponentBody.pos={x:this.npcBody.pos.x+1.05,y:1,z:18};} this.stageName=name; return this.state(); }
    if(name==='strike' || name==='burst' || name==='npc_duel' || name==='signature' || name==='magic') {
      const w=this.session.world;
      const actor=name==='npc_duel'?this.npc:this.player;
      const ab=name==='npc_duel'?this.npcBody:this.body;
      const tb=name==='npc_duel'?this.opponentBody:this.npcBody;
      const count=name==='burst'?3:1;
      const seqs:number[]=[];
      for(let i=0;i<count;i++) {
        w.physicalTime+=ATTACK_COOLDOWN+.01;
        const result=this.session.sim.attack(actor,ab,tb);
        if(!result.attempted || !result.hit) throw Error(`Combat lab rejected ${result.rejection}`);
        const seq=w.getCounters().combat;seqs.push(seq);
        if(name==='signature' || name==='magic') this.motifs.set(seq,{fixture:true,techniqueId:'fixture:reed-cut',lineageId:'fixture:reed',mastery:.85,
          ...(name==='magic'?{magicDomain:'fixture:wind'}:{})});
      }
      this.actions.push({name,seqs,actorBodyId:ab.id,targetBodyId:tb.id,canonicalHits:count});
      this.stageName=name;return this.state();
    }
    return super.stage(name);
  }
}

export function startCombatChoreographyFixture(port=8787) {
  const fixture=new CombatChoreographyFixture();
  const http=createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    try {
      if(req.url==='/snapshot') res.end(JSON.stringify(fixture.snapshot()));
      else if(req.url==='/fixture') res.end(JSON.stringify(fixture.state()));
      else if(req.method==='POST' && req.url?.startsWith('/fixture/stage/')) res.end(JSON.stringify(fixture.stage(req.url.slice(15))));
      else {res.statusCode=404;res.end('{}');}
    } catch(error) {res.statusCode=400;res.end(JSON.stringify({error:String(error)}));}
  });
  const sockets=new WebSocketServer({server:http,maxPayload:8192});let controller:WebSocket|null=null;
  sockets.on('connection',socket=>{
    const controls=controller===null;if(controls){controller=socket;fixture.session.resetInput();}
    socket.send(JSON.stringify({version:1,type:'hello',controls,playerId:fixture.player.id}));
    socket.send(JSON.stringify(fixture.scene()));socket.send(JSON.stringify(fixture.snapshot()));
    socket.on('message',raw=>{if(socket!==controller)return;try{socket.send(JSON.stringify({version:1,type:'result',...fixture.session.intent(JSON.parse(raw.toString()))}));}catch{socket.close(1007,'Invalid fixture input');}});
    socket.on('close',()=>{if(controller===socket){controller=null;fixture.session.resetInput();}});
  });
  let tick=0;const timer=setInterval(()=>{
    fixture.session.step(.05);if(++tick%2)return;
    const payload=JSON.stringify(fixture.snapshot());for(const socket of sockets.clients)if(socket.readyState===WebSocket.OPEN)socket.send(payload);
  },50);
  http.listen(port,'127.0.0.1',()=>console.log(`COMBAT_CHOREOGRAPHY_FIXTURE http://127.0.0.1:${port}`));
  return {fixture,http,close:()=>{clearInterval(timer);for(const socket of sockets.clients)socket.terminate();sockets.close();http.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const running=startCombatChoreographyFixture(Number(process.env.TORN_VEIL_ACCEPTANCE_PORT??8787));process.on('SIGINT',running.close);process.on('SIGTERM',running.close);}
