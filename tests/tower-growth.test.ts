import { describe, it, expect } from 'vitest';
import {readFileSync} from 'node:fs';
import { createTestWorld, addPerson, v, step } from './helpers/world';
import { makeItem, makeBody } from '../src/sim/world/factory';
import { drinkAt } from '../src/sim/world/metabolism';
import { performHandInteraction } from '../src/sim/physical/hand';
import { CommandQueue, type CommandEnvelope } from '../src/bridge/commands';
import { INTERACTION_SPEC } from '../src/sim/physical/prediction';
import { agreeCombatTrial, endCombatTrial } from '../src/sim/social/combatTrial';
import { learnArcaneSource, requestArcaneCast, stepArcana } from '../src/sim/physical/arcana/runtime';
import { advanceExertion } from '../src/sim/physical/exertion';
import { arcaneCapacity, assessArcaneTransformation, integrateArcaneSources, recordArcaneEncounter, TRANSFORMATIONS } from '../src/sim/physical/arcana/growth';
import { serialize, deserialize } from '../src/sim/persist/save';
import { ONTOLOGICAL_STAGES } from '../src/sim/core/stages';
import { changeEquipment } from '../src/sim/physical/equipment';
import { RealmSession } from '../src/sim/world/realms/session';
import { applyTowerCommand } from '../src/server/canonicalTower';
import { currentTowerFloor, observeCanonicalTower } from '../src/sim/world/interiors/tower';
import { FoldedRealmGrid } from '../src/sim/world/interiors/grid';
import { detailedPeople, detailedBodies, towerResidency } from '../src/sim/world/interiors/residency';
import { trialKit } from '../src/sim/world/interiors/trialKit';

function fixture() {
  const x = createTestWorld(917); x.world.clock.timeScale = 1;
  const p = addPerson(x, 'Learner', 'traveler', v(10,1,10), { controlled: true }), b = x.world.primaryBody(p.id)!;
  const source = (id: string, learn = true) => {
    const i = makeItem(x.world, 'book', id, { owner: p.id, holder: p.id });
    i.arcaneSource = { version: 1, abilityId: id, kind: id.startsWith('ess-') ? 'essence' : 'book' };
    if (learn) expect(learnArcaneSource(x.world,p,b.id,i.id)).toBe('accepted'); return i;
  };
  source('book-ember'); source('ess-bone');
  return { ...x,p,b,source };
}
/** Explicit isolated receipt fixture, not traversal or combat-strategy evidence. All
 * credits still pass the shared hit/consent/provenance path; no growth ledger writes. */
function victory(x: ReturnType<typeof fixture>, index: number, cast = true) {
  const t = addPerson(x,`Opponent ${index}`,'traveler',v(15,1,10),{controlled:true}), tb = x.world.primaryBody(t.id)!;
  const origin = x.world.emit('tower_entered',{actor:x.p.id}), id = `growth-fixture:${index}`;
  agreeCombatTrial(x.world,id,[[x.p],[t]],'injure',origin.id);
  if (cast) {
    expect(requestArcaneCast(x.world,x.p,{bodyId:x.b.id,abilityId:'book-ember',target:{...tb.pos}})).toBe('accepted');
    step(x,.9);
  }
  x.sim.applyHit(x.p,x.b,tb,100,'injure');
  const e = [...x.world.events].reverse().find(e => e.type==='attack'&&e.target===t.id)!;
  endCombatTrial(x.world,id,[e.id]); tb.pos = v(30,1,30);
  step(x,16); return {t,tb,e};
}
describe('earned source transformation',()=>{
  it('retains a genuine legacy Iron save and applies versioned requirements to new receipts',()=>{
    const raw=readFileSync(new URL('./fixtures/legacy-source-iron-v31.json',import.meta.url),'utf8');
    const loaded=deserialize(raw);expect(loaded).not.toBeNull();
    const w=loaded!.world,p=w.person('p_1')!,b=w.primaryBody(p.id)!;
    expect(p.ontology.stage).toBe('Iron');expect(Object.keys(p.arcana!.growth!.victories)).toHaveLength(12);
    expect(arcaneCapacity(p)).toEqual({amplitude:1.6,aperture:1.2,reserve:120});
    expect(assessArcaneTransformation(w,p,b).next?.victories).toBe(180);
    expect(integrateArcaneSources(w,p,b)).toBe('not_ready');
    w.event(p.ontology.breakthroughEventId!)!.data.growthPolicy=2;
    expect(deserialize(serialize(w))).toBeNull();
  });
  it('uses distinct opposed evidence and finite materials, without rank from idle casts or labels',()=>{
    const x=fixture(); x.b.injuries={arm:.12}; x.b.health=75;
    const spare=x.source('ess-bone',false), calendar=x.world.now;
    expect(integrateArcaneSources(x.world,x.p,x.b)).toBe('not_ready');
    for(let i=0;i<TRANSFORMATIONS[0].victories;i++)victory(x,i);
    expect(x.p.ontology.stage).toBe('Normal');expect(assessArcaneTransformation(x.world,x.p,x.b).eligible).toBe(true);
    const before={hp:x.b.health,injuries:{...x.b.injuries},mana:x.b.arcana!.mana,time:x.world.now};
    expect(integrateArcaneSources(x.world,x.p,x.b)).toBe('accepted');expect(x.p.ontology.stage).toBe('Iron');
    expect(spare.quantity).toBe(0);expect(x.b.health).toBe(before.hp);expect(x.b.injuries).toEqual(before.injuries);
    expect(x.b.arcana!.mana).toBe(before.mana);expect(x.world.now).toBe(before.time);expect(x.world.now-calendar).toBeLessThan(1000);
    expect(arcaneCapacity(x.p)).toEqual({amplitude:1.6,aperture:1.2,reserve:120});
    expect(integrateArcaneSources(x.world,x.p,x.b)).toBe('not_ready');
    const loaded=deserialize(serialize(x.world))!.world;expect(loaded.person(x.p.id)!.arcana).toEqual(x.p.arcana);
    const raw=JSON.parse(serialize(x.world));raw.persons.find((p:any)=>p.id===x.p.id).arcana.growth.transformation.amplitude=20;
    expect(deserialize(JSON.stringify(raw))).toBeNull();
  },30000);
  it('cannot credit a repeat opponent or a last tap',()=>{
    const x=fixture(),{tb,e}=victory(x,0);const before=structuredClone(x.p.arcana!.growth);
    recordArcaneEncounter(x.world,x.p,x.b,tb,e);expect(x.p.arcana!.growth).toEqual(before);
    expect(Object.keys(before!.victories)).toHaveLength(1);
    const t=addPerson(x,'Wounded stranger','traveler',v(15,1,10),{controlled:true}), target=x.world.primaryBody(t.id)!;
    const origin=x.world.emit('tower_entered',{actor:x.p.id});agreeCombatTrial(x.world,'last-tap',[[x.p],[t]],'injure',origin.id);
    target.health=1;x.sim.applyHit(x.p,x.b,target,1,'injure');expect(Object.keys(x.p.arcana!.growth!.victories)).toHaveLength(1);
    endCombatTrial(x.world,'last-tap',[]);
    const other=makeBody(x.world,tb.ownerId,v(15,1,10));x.world.person(tb.ownerId)!.bodies.push(other.id);
    agreeCombatTrial(x.world,'second-manifestation',[[x.p],[x.world.person(tb.ownerId)!]],'injure',origin.id);
    x.sim.applyHit(x.p,x.b,other,100,'injure');expect(Object.keys(x.p.arcana!.growth!.victories)).toHaveLength(1);
  });
  it('healing cannot erase received damage from advancement evidence',()=>{
    const x=fixture();x.source('book-mend');
    const opponent=addPerson(x,'Resisting partner','traveler',v(14,1,10),{controlled:true}),body=x.world.primaryBody(opponent.id)!;
    const cause=x.world.emit('tower_entered',{actor:x.p.id});agreeCombatTrial(x.world,'damage-proof',[[x.p],[opponent]],'injure',cause.id);
    const received=x.sim.applyHit(opponent,body,x.b,20,'injure')!;
    x.world.physicalTime+=2;x.world.clock.advance(2);
    expect(requestArcaneCast(x.world,x.p,{bodyId:x.b.id,abilityId:'book-mend'})).toBe('accepted');
    step(x,2);expect(x.b.health).toBe(80);
    x.sim.applyHit(x.p,x.b,body,100,'injure');
    expect(x.p.arcana!.growth!.victories[opponent.id]).toMatchObject({quality:.75,receivedEventIds:[received.id]});
    x.world.compactEvents(5);expect(deserialize(serialize(x.world))).not.toBeNull();
    const raw=JSON.parse(serialize(x.world));raw.persons.find((p:any)=>p.id===x.p.id).arcana.growth.victories[opponent.id].quality=1;
    expect(deserialize(JSON.stringify(raw))).toBeNull();
  });
  it('binds source integration, cancels queued requests and makes duplicate/reloaded requests idempotent',()=>{
    const x=fixture(),spare=x.source('ess-bone',false);for(let n=0;n<TRANSFORMATIONS[0].victories;n++)victory(x,n);
    const envelope:CommandEnvelope={version:2,type:'command',epoch:'growth-epoch',controllerId:x.p.id,bodyId:x.b.id,
      sequence:0,commandId:'growth-0',specRevision:INTERACTION_SPEC.revision,clientTimeMs:0,command:{type:'integrate_arcana'}};
    const q=new CommandQueue(envelope.epoch,envelope.controllerId,envelope.bodyId);
    expect(q.receive({...envelope,bodyId:'wrong'},0,0).result).toBe('binding_mismatch');
    q.receive(envelope,0,0);q.cancel(0,1);expect(q.apply(1,2,()=>integrateArcaneSources(x.world,x.p,x.b))).toHaveLength(0);
    expect(spare.quantity).toBe(1);
    const next={...envelope,sequence:1,commandId:'growth-1',clientTimeMs:1};q.receive(next,1,2);q.receive(next,1,3);
    expect(q.apply(2,4,()=>integrateArcaneSources(x.world,x.p,x.b))).toHaveLength(1);expect(spare.quantity).toBe(0);
    expect(q.receive(next,2,5).status).toBe('applied');
    const loaded=deserialize(serialize(x.world))!.world,p=loaded.person(x.p.id)!,b=loaded.body(x.b.id)!;
    expect(integrateArcaneSources(loaded,p,b)).toBe('not_ready');expect(loaded.item(spare.id)!.quantity).toBe(0);
  },30000);
  it('physical focuses change actual reach/force for any holder without granting classification or healing',()=>{
    const x=fixture(),focus=makeItem(x.world,'armor','finite focus',{owner:x.p.id,holder:x.p.id});
    focus.arcaneFocus={version:1,amplitude:7,aperture:5,reserve:220};
    expect(changeEquipment(x.world,x.p,focus.id,true,x.b.id)).toBe('accepted');
    expect(requestArcaneCast(x.world,x.p,{bodyId:x.b.id,abilityId:'book-ember',target:v(32,1,10)})).toBe('accepted');
    expect(x.b.arcana!.cast!.damage).toBe(112);expect(x.b.arcana!.cast!.range).toBe(35);
    expect(x.p.ontology.stage).toBe('Normal');expect(x.b.arcana!.mana).toBe(78);
    expect(deserialize(serialize(x.world))).not.toBeNull();
    expect(changeEquipment(x.world,x.p,focus.id,false,x.b.id)).toBe('accepted');
    expect(arcaneCapacity(x.p,x.world,x.b).amplitude).toBe(1); // Existing committed cast stays frozen.
    expect(x.b.arcana!.cast!.damage).toBe(112);
  });
  it('keeps the whole ontology ladder and makes Gold require substantially more than the Silver path',()=>{
    expect(ONTOLOGICAL_STAGES).toEqual(['Normal','Iron','Bronze','Silver','Gold','Diamond','God','Astral King','Astral Being','John Smith']);
    expect(TRANSFORMATIONS.map(t=>t.stage)).toEqual(['Iron','Bronze','Silver','Gold']);
    expect(TRANSFORMATIONS[3].victories).toBeGreaterThan(TRANSFORMATIONS[2].victories*2);
    expect(TRANSFORMATIONS[3].forms).toBeGreaterThan(TRANSFORMATIONS[2].forms);
  });
  it('executes four earned transformations through Gold with finite costs and saved receipts',()=>{
    // Mechanical threshold fixture: source/cast/hit APIs and elapsed cooldowns,
    // with direct finishing hits. This is explicitly NOT a timed or balanced climb.
    const x=fixture(),forms=['book-ember','ess-bone','book-sigil','book-thunder','ess-storm','ess-gravity'];
    for(const id of [...forms.slice(2),'ess-fire','ess-iron','ess-life'])x.source(id);
    for(let n=0;n<10;n++)x.source('ess-bone',false);
    let milestone=0;
    for(let n=0;n<TRANSFORMATIONS[3].victories;n++){
      const t=addPerson(x,`Threshold opponent ${n}`,'traveler',v(14,1,10),{controlled:true}),tb=x.world.primaryBody(t.id)!;
      const origin=x.world.emit('tower_entered',{actor:x.p.id}),trial=`threshold:${n}`;
      agreeCombatTrial(x.world,trial,[[x.p],[t]],'injure',origin.id);
      if(n<18){
        x.world.physicalTime+=30;x.world.clock.advance(30);advanceExertion(x.world);
        const abilityId=forms[Math.floor(n/3)];
        expect(requestArcaneCast(x.world,x.p,{bodyId:x.b.id,abilityId,target:{...tb.pos}})).toBe('accepted');
        x.world.physicalTime+=2;x.world.clock.advance(2);
        stepArcana(x.world,(p,b,target,damage,intent,event)=>x.sim.applyHit(p,b,target,damage,intent,undefined,event));
      }
      const e=x.sim.applyHit(x.p,x.b,tb,100,'injure')!;endCombatTrial(x.world,trial,[e.id]);tb.pos=v(35,1,35);
      if(n+1===TRANSFORMATIONS[milestone].victories){
        expect(assessArcaneTransformation(x.world,x.p,x.b).eligible).toBe(true);
        expect(integrateArcaneSources(x.world,x.p,x.b)).toBe('accepted');
        expect(x.world.event(x.p.ontology.breakthroughEventId!)?.data.growthPolicy).toBe(2);
        expect(x.p.ontology.stage).toBe(TRANSFORMATIONS[milestone].stage);milestone++;
      }
    }
    expect(milestone).toBe(4);expect(x.b.health).toBe(80);
    expect(arcaneCapacity(x.p)).toEqual({amplitude:20,aperture:12,reserve:320});
    const raw=serialize(x.world),loaded=deserialize(raw);expect(loaded).not.toBeNull();
    expect(loaded!.world.person(x.p.id)!.arcana).toEqual(x.p.arcana);
    expect(integrateArcaneSources(x.world,x.p,x.b)).toBe('not_ready');
    x.world.compactEvents(5);expect(deserialize(serialize(x.world))).not.toBeNull();
  });
});
describe('bounded old-floor residents and actual difficulty kits',()=>{
  it('refreshes residency when equal-sized canonical body indices are rebuilt',()=>{
    const x=fixture(),second=makeBody(x.world,x.p.id,v(12,1,10));x.p.bodies.push(second.id);
    second.present=false;x.world.rebuildLivingIndices();expect(detailedBodies(x.world).map(b=>b.id)).toEqual([x.b.id]);
    x.b.present=false;second.present=true;x.world.rebuildLivingIndices();
    expect(detailedBodies(x.world).map(b=>b.id)).toEqual([second.id]);
  });
  it('records other participants withdrawing without granting the player a personal victory',()=>{
    const s=new RealmSession(317),gate=s.grid.chunk('aether',32,32).buildings[0];s.body.pos={x:gate.door.x+.5,y:1,z:gate.z+4.5};
    applyTowerCommand(s,{type:'enter',id:'withdrawal-enter',revision:0});
    const f=currentTowerFloor(s.world)!,a=s.world.body(f.enemyBodyIds[0])!,b=s.world.body(f.enemyBodyIds[1])!;
    s.sim.applyHit(s.world.person(a.ownerId)!,a,b,1000,'injure');
    // A later unrelated nonterminal conflict must not hide the real terminal one.
    const third=s.world.body(f.enemyBodyIds[2])!;s.sim.applyHit(s.world.person(third.ownerId)!,third,b,0,'injure');
    observeCanonicalTower(s.world);
    expect(f.defeats.some(d=>d.bodyId===b.id)).toBe(true);expect(s.person.arcana?.growth?.victories[b.ownerId]).toBeUndefined();
    expect(new RealmSession(0,s.save()).world.canonicalTower!.floors[0].defeats).toEqual(f.defeats);
  });
  it('shares finite water between player and NPC consumption and retains depletion on reload',()=>{
    let s=new RealmSession(317);const gate=s.grid.chunk('aether',32,32).buildings[0];s.body.pos={x:gate.door.x+.5,y:1,z:gate.z+4.5};
    applyTowerCommand(s,{type:'enter',id:'water-enter',revision:0});
    const water=s.world.resourceNodes.find(n=>n.id.endsWith(':cistern'))!;
    expect(performHandInteraction(s.sim,s.person,`drink:${water.placeId}`)).toBe('accepted');expect(water.remaining).toBe(7.75);
    const npc=s.world.person(s.world.body(currentTowerFloor(s.world)!.enemyBodyIds[0])!.ownerId)!;
    for(let n=0;n<31;n++)expect(drinkAt(s.world,npc,water.placeId)).toBe(true);
    expect(drinkAt(s.world,npc,water.placeId)).toBe(false);
    expect(performHandInteraction(s.sim,s.person,`drink:${water.placeId}`)).not.toBe('accepted');
    s=new RealmSession(0,s.save());expect(s.world.resourceNodes.find(n=>n.id===water.id)!.remaining).toBe(0);
    s.world.canonicalTower!.active=false;expect(towerResidency(s.world).detailedPeople).toBe(5);
    s.world.canonicalTower!.active=true;expect(towerResidency(s.world).detailedPeople).toBe(8);
  });
  it('retains old identities and injuries while excluding them from detailed work through reload',()=>{
    let s=new RealmSession(317);const gate=s.grid.chunk('aether',32,32).buildings[0];s.body.pos={x:gate.door.x+.5,y:1,z:gate.z+4.5};
    applyTowerCommand(s,{type:'enter',id:'residency-enter',revision:0});
    // Structural residency fixture, not a claim of playing or balancing 100 floors.
    for(let floor=1;floor<100;floor++){
      const f=currentTowerFloor(s.world)!;
      for(const id of f.enemyBodyIds)s.sim.applyHit(s.person,s.body,s.world.body(id)!,1000,'injure');
      observeCanonicalTower(s.world);s.body.pos={...(s.grid as FoldedRealmGrid).interior(f.interiorId).exit};
      applyTowerCommand(s,{type:'ascend',id:`residency-next-${floor}`,revision:s.world.canonicalTower!.revision,runId:s.world.canonicalTower!.id});
    }
    const old=s.world.canonicalTower!.floors[0].enemyBodyIds[0], body=s.world.body(old)!, owner=s.world.person(body.ownerId)!;
    const injuries=structuredClone(body.injuries), budget=towerResidency(s.world);
    expect(budget.coarsePeople).toBeGreaterThan(1000);expect(budget.detailedPeople).toBeLessThanOrEqual(37);
    expect(detailedBodies(s.world).some(b=>b.id===old)).toBe(false);expect(detailedPeople(s.world).some(p=>p.id===owner.id)).toBe(false);
    expect(owner.alive).toBe(true);expect(body.present).toBe(true);
    const thought=owner.mind.thinkBudget;s.world.physicalTime+=1;s.world.clock.advance(1);s.sim.step(1,1);
    expect(owner.mind.thinkBudget).toBe(thought);expect(body.injuries).toEqual(injuries);
    s=new RealmSession(0,s.save());expect(towerResidency(s.world)).toEqual(budget);expect(s.world.body(old)!.injuries).toEqual(injuries);
    expect(s.world.livingIndexErrors()).toEqual([]);
    const f=currentTowerFloor(s.world)!;
    for(const id of f.enemyBodyIds)s.sim.applyHit(s.person,s.body,s.world.body(id)!,1000,'injure');
    observeCanonicalTower(s.world);expect(f.clearEventId).toBeTruthy();expect(s.world.canonicalTower!.status).toBe('open');
    s.body.pos={...(s.grid as FoldedRealmGrid).interior(f.interiorId).exit};
    expect(()=>applyTowerCommand(s,{type:'ascend',id:'summit-without-growth',revision:s.world.canonicalTower!.revision,runId:s.world.canonicalTower!.id})).toThrow('Silver');
    expect((s.grid as FoldedRealmGrid).cachedInteriors).toBeLessThanOrEqual(12);
  },120000);
  it('escalates real ranged kit, armor and force rather than copying the legacy attack-token system',()=>{
    expect(trialKit(1,0)).toMatchObject({caster:false,weapon:null,armor:0,amplitude:1});
    expect(trialKit(5,0).caster).toBe(true);expect(trialKit(10,1).heavy).toBe(true);
    expect(trialKit(100,0).amplitude).toBeGreaterThan(trialKit(50,0).amplitude);
    expect(trialKit(100,0).armor).toBeGreaterThan(trialKit(50,0).armor);
  });
});
