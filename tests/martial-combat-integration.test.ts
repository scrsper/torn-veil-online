import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, v, step } from './helpers/world';
import { submitCombatInput, requestCombatAction, advanceCombat, captureCombatTransforms, stopCombatAction } from '../src/sim/physical/combatAction';
import { INTERACTION_SPEC as S } from '../src/sim/physical/prediction';
import { seedMartialBackground, masteryOf, knowsTechnique, techniqueKnowledge } from '../src/sim/mind/martialKnowledge';
import { submitTechniqueUse } from '../src/sim/mind/martialPractice';
import { martialPredictionChoices } from '../src/sim/physical/martialCombat';
import { serialize, deserialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { BridgeSession } from '../src/bridge/session';
import { arrangeCombatArena, setPracticeMode, practiceStatus } from '../src/bridge/combatArena';
import { skillOf } from '../src/sim/core/skills';
import { makeItem } from '../src/sim/world/factory';
import { attributeProfile } from '../src/sim/core/human';

const jab='unarmed:jab',cross='unarmed:cross',kick='unarmed:low-kick',edge='unarmed:jab-to-cross';
function fixture(profile:'untrained'|'partial'|'trained'='untrained') {
  const x=createTestWorld(198);x.world.clock.timeScale=1;
  const p=addPerson(x,'Actor','farmer',v(10,1,10),{controlled:true});
  const t=addPerson(x,'Partner','farmer',v(11.05,1,10),{controlled:true});
  p.knowledge={};p.skills={};p.attributes=attributeProfile(8);
  const b=x.world.primaryBody(p.id)!,tb=x.world.primaryBody(t.id)!;b.yaw=-Math.PI/2;tb.yaw=Math.PI/2;
  if(profile!=='untrained')for(const id of [jab,cross,kick,...(profile==='trained'?[edge,'unarmed:cross-to-low-kick']:[])])seedMartialBackground(x.world,p,id,.6,.6);
  return {...x,p,t,b,tb};
}
function tick(x:ReturnType<typeof fixture>,n:number) {for(let i=0;i<n;i++){x.world.physicalTime+=S.stepSeconds;x.sim.step(S.stepSeconds,S.stepSeconds);}}
function chain(profile:'untrained'|'partial'|'trained', edgeMastery=.6) {
  const x=fixture(profile);x.tb.pos.x=30;if(profile==='trained')x.p.martial!.mastery[edge].value=edgeMastery;
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');
  const ids=[x.b.combatAction!.techniqueId];
  tick(x,18);expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');
  tick(x,11);ids.push(x.b.combatAction!.techniqueId);expect(x.b.pose).toBe('attack');
  tick(x,18);expect(submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low'})).toBe('accepted');
  tick(x,11);ids.push(x.b.combatAction!.techniqueId);expect(x.b.pose).toBe('attack');
  return {x,ids};
}
describe('playable martial/realtime integration',()=>{
  it.each([
    ['untrained',['motor:basic-punch','motor:second-punch','motor:crude-kick']],
    ['partial',[jab,'motor:basic-punch','motor:crude-kick']],
    ['trained',[jab,cross,kick]],
  ] as const)('%s selects its own real buffered sequence without idle gaps', (profile,expected)=>{
    const {x,ids}=chain(profile);expect(ids).toEqual(expected);expect(x.b.attackSeq).toBe(3);
    const starts=x.world.events.filter(e=>e.type==='combat_action'&&e.actor===x.p.id&&e.data.phase==='preparation');
    expect(starts.map(e=>e.data.techniqueId)).toEqual(expected);
    for(let i=1;i<starts.length;i++)expect(starts[i].data.physicalTime-starts[i-1].data.physicalTime).toBeCloseTo(29/60,8);
    expect(x.tb.health).toBe(x.tb.maxHealth); // Selected sequence did not manufacture contact.
    if(profile==='untrained')expect(Object.values(x.p.knowledge).some(k=>k.claim.martialTechnique)).toBe(false);
  });
  it('charges once at admission, learns from resolved execution, and rejects replay without cost or reward',()=>{
    const x=fixture();x.tb.pos.x=30;const before=x.p.physiology.fatigue;
    expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');
    const cost=x.b.combatAction!.exertionCost;expect(x.p.physiology.fatigue-before).toBeCloseTo(cost,10);
    expect(masteryOf(x.p,'motor:basic-punch')).toBe(0);tick(x,47);
    const ev=x.world.event(x.b.combatAction!.learningEventId!)!;
    expect(ev.data.techniqueUse.techniqueId).toBe('motor:basic-punch');expect(ev.data.phase).toBe('complete');
    expect(masteryOf(x.p,'motor:basic-punch')).toBeGreaterThan(0);expect(skillOf(x.p,'unarmed')).toBeGreaterThan(0);
    const state=structuredClone({martial:x.p.martial,skills:x.p.skills,physiology:x.p.physiology});
    expect(submitTechniqueUse(x.world,x.p,ev.id)).toBe(0);
    expect({martial:x.p.martial,skills:x.p.skills,physiology:x.p.physiology}).toEqual(state);
    expect(knowsTechnique(x.p,jab)).toBe(false);
  });
  it('credits a performed learned transition without charging or practicing the family twice',()=>{
    const {x}=chain('trained',.1);expect(masteryOf(x.p,edge)).toBeGreaterThan(.1);expect(skillOf(x.p,'unarmed')).toBe(.6);
    const events=x.world.events.filter(e=>e.data.techniqueUse?.transitionTechniqueId===edge);
    expect(events).toHaveLength(1);expect(events[0].data.previousTechniqueId).toBe(jab);
    const before=structuredClone(x.p.physiology);expect(submitTechniqueUse(x.world,x.p,events[0].id)).toBe(0);expect(x.p.physiology).toEqual(before);
  });
  it('uses the same capability path for NPC/direct requests and player/queued intent',()=>{
    const a=fixture('partial'),b=fixture('partial');a.tb.pos.x=b.tb.pos.x=30;
    expect(requestCombatAction(a.world,{attackerId:a.p.id,attackerBodyId:a.b.id,targetBodyId:'',attackMode:'strike'}).attempted).toBe(true);
    expect(submitCombatInput(b.world,b.b.id,{kind:'attack'})).toBe('accepted');
    expect(a.b.combatAction).toEqual(b.b.combatAction);expect(a.p.physiology).toEqual(b.p.physiology);
  });
  it('normal save/load retains repertoire, frozen action, buffered continuation, and evidence replay ledger',()=>{
    const base=fixture('trained'),initial=deserialize(serialize(base.world))!;
    const a={...base,world:initial.world,sim:new Simulation(initial.world),p:initial.world.person(base.p.id)!,t:initial.world.person(base.t.id)!,b:initial.world.body(base.b.id)!,tb:initial.world.body(base.tb.id)!};
    a.tb.pos.x=30;submitCombatInput(a.world,a.b.id,{kind:'attack'});tick(a,18);
    submitCombatInput(a.world,a.b.id,{kind:'attack'});
    const loaded=deserialize(serialize(a.world))!;expect(loaded).not.toBeNull();
    const sim=new Simulation(loaded.world),p=loaded.world.person(a.p.id)!,body=loaded.world.body(a.b.id)!;
    for(let i=0;i<40;i++){tick(a,1);loaded.world.physicalTime+=S.stepSeconds;sim.step(S.stepSeconds,S.stepSeconds);}
    expect(body.combatAction).toEqual(a.b.combatAction);expect(p.martial).toEqual(a.p.martial);expect(p.knowledge).toEqual(a.p.knowledge);
    const event=loaded.world.events.find(e=>e.data.techniqueUse)!;expect(submitTechniqueUse(loaded.world,p,event.id)).toBe(0);
  });
  it('observes resolved demonstrated movement through ordinary sight; input alone grants no knowledge',()=>{
    const x=fixture('trained');x.tb.health=x.tb.maxHealth=10000;x.t.mind.thinkInterval=Infinity;
    const watch=addPerson(x,'Observer','farmer',v(10,1,11),{controlled:true});watch.attributes=attributeProfile(12);watch.knowledge={};
    for(let i=0;i<6;i++){
      expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');
      if(i===0)expect(techniqueKnowledge(watch,jab)).toBeUndefined();
      step(x,1.1,S.stepSeconds);
    }
    expect(techniqueKnowledge(watch,jab)?.source.type).toBe('witnessed');expect(masteryOf(watch,jab)).toBe(0);
    expect(x.world.events.some(e=>e.data.martialDemonstration&&e.perceivedBy.some(p=>p.who===watch.id&&p.how==='saw'))).toBe(true);
  });
  it('arena profiles are explicit debug fixtures and prediction is a detached canonical choice projection',()=>{
    const s=new BridgeSession(123,{arena:true});arrangeCombatArena(s,'idle');
    for(const profile of ['untrained','partial','trained'] as const){
      expect(setPracticeMode(s,profile)).toBe('accepted');expect(practiceStatus(s)?.martialProfile).toBe(profile);
      const p=s.world.persons()[0],b=s.world.primaryBody(p.id)!;const choices=martialPredictionChoices(s.world,p,b);
      expect(choices['ready|Light'].techniqueId).toBe(profile==='untrained'?'motor:basic-punch':jab);
      if(profile==='trained')expect(choices[jab+'|Light'].techniqueId).toBe(cross);
    }
    const ordinary=new BridgeSession(123);expect(setPracticeMode(ordinary,'trained')).toBe('arena_only');
  });
  it('explicit primitive intent cannot be overridden by a high-scoring learned edge',()=>{
    const {x}=chain('trained');tick(x,29);
    expect(submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low',primitive:'shove'})).toBe('accepted');
    expect(x.b.combatAction!.techniqueId).toBe('motor:shove');
    expect(martialPredictionChoices(x.world,x.p,x.b)[cross+'|Shove'].techniqueId).toBe('motor:shove');
  });
  it('an explicit shove with a carried weapon retains motor intent, contact, and zero weapon injury',()=>{
    const x=fixture('trained');makeItem(x.world,'sword','carried sword',{holder:x.p.id,damage:26});
    const projection=martialPredictionChoices(x.world,x.p,x.b)['ready|Shove'];const start=x.tb.pos.x,injuries=structuredClone(x.tb.injuries);
    expect(submitCombatInput(x.world,x.b.id,{kind:'attack',primitive:'shove'})).toBe('accepted');
    expect(x.b.combatAction!.techniqueId).toBe(projection.techniqueId);expect(x.b.combatAction!.weaponId).toBeNull();
    expect(x.b.combatAction!.impact).toBe(0);tick(x,46);
    expect(x.b.combatAction!.outcome).toBe('hit');expect(x.tb.pos.x).toBeGreaterThan(start);
    expect(x.tb.health).toBe(x.tb.maxHealth);expect(x.tb.injuries).toEqual(injuries);
  });
  it('settlement records the paid action without a second physical cost, including interruption and no-op rejection',()=>{
    const x=fixture();x.tb.pos.x=30;submitCombatInput(x.world,x.b.id,{kind:'attack'});
    const paid=structuredClone(x.p.physiology);
    expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('too_early');expect(x.p.physiology).toEqual(paid);
    for(let i=0;i<46;i++){const before=captureCombatTransforms(x.world);x.world.physicalTime+=S.stepSeconds;advanceCombat(x.world,S.stepSeconds,before,()=>{throw new Error('distant target must not be hit');});}
    expect(x.p.physiology).toEqual(paid);expect(masteryOf(x.p,'motor:basic-punch')).toBeGreaterThan(0);
    submitCombatInput(x.world,x.b.id,{kind:'attack'});const mastery=structuredClone(x.p.martial);
    stopCombatAction(x.world,x.b,'test interruption');expect(x.p.martial).toEqual(mastery);
  });
  it('refreshes the projection when physical ability changes and restores exact Arena continuation',()=>{
    const s=new BridgeSession(33,{arena:true});setPracticeMode(s,'trained');
    const p=s.world.persons()[0],b=s.world.primaryBody(p.id)!;
    expect(martialPredictionChoices(s.world,p,b)['ready|Light']).toBeDefined();
    p.physiology.fatigue=1;p.physiology.energy=0;p.physiology.hydration=0;
    expect(martialPredictionChoices(s.world,p,b)).toEqual({});setPracticeMode(s,'trained');
    const loaded=new BridgeSession(33,{arena:true,save:s.save()});
    expect(loaded.world.persons().map(p=>p.id)).toEqual(s.world.persons().map(p=>p.id));
    expect([loaded.world.grid.W,loaded.world.grid.H,loaded.world.grid.D]).toEqual([48,8,48]);
    expect(practiceStatus(loaded)?.martialProfile).toBe('trained');
    expect(martialPredictionChoices(loaded.world,loaded.world.persons()[0],loaded.world.primaryBody(p.id)!)).toEqual(martialPredictionChoices(s.world,p,b));
  });
  it('rejects malformed frozen technique/transition/evidence references in normal saves',()=>{
    const {x}=chain('trained');tick(x,47);const raw=JSON.parse(serialize(x.world));
    expect(deserialize(JSON.stringify(raw))).not.toBeNull();
    for(const patch of [{techniqueId:'unknown:move'},{transitionTechniqueId:'unarmed:step-to-jab'},{learningEventId:'event:missing'},{motion:'teleport'}]){
      const bad=structuredClone(raw);Object.assign(bad.bodies.find((b:any)=>b.id===x.b.id).combatAction,patch);
      expect(deserialize(JSON.stringify(bad))).toBeNull();
    }
  });
  it('all eight innate actions have a physical admission route; shove and cover do not invent injury',()=>{
    for(const input of [{kind:'attack'},{kind:'attack',trajectory:'low'},{kind:'attack',trajectory:'low',primitive:'shove'},
      {kind:'cover'},{kind:'duck'},{kind:'sidestep'},{kind:'backstep'}] as const){
      const x=fixture();expect(submitCombatInput(x.world,x.b.id,input)).toBe('accepted');
      expect(x.b.combatAction!.techniqueId?.startsWith('motor:')).toBe(true);
      if('primitive' in input||input.kind==='cover'){tick(x,46);expect(x.tb.health).toBe(x.tb.maxHealth);}
    }
  });
});
