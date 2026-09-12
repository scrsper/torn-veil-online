import {describe,it,expect} from 'vitest';
import {createTestWorld,addPerson,v} from './helpers/world';
import {predictMovement,predictPosture,postureFits,INTERACTION_SPEC as S} from '../src/sim/physical/prediction';
import {applyInteractionMovement,movementState} from '../src/sim/physical/interactionMovement';
import {submitCombatInput,stopCombatAction} from '../src/sim/physical/combatAction';
import {crouchHeld,refreshCrouchHeld} from '../src/sim/physical/posture';
import {configureCombatPractice,arenaRepertoire} from '../src/sim/physical/combatPracticeProfile';
import {combatTransitionAt} from '../src/sim/physical/combatTransitions';
import {hurtVolumes,strikePoint} from '../src/sim/physical/combatGeometry';
import {serialize,deserialize} from '../src/sim/persist/save';
import {BridgeSession} from '../src/bridge/session';
import {arrangeCombatArena,setPracticeMode,tickPractice,practiceStatus} from '../src/bridge/combatArena';

const floor=()=>({floor:1,walkable:true,solids:[0]});
const initial={pos:v(10,1,10),yaw:0,speed:3,eligible:true,crouch:0};
function fixture(){const x=createTestWorld(123),p=addPerson(x,'Fighter','farmer',v(10,1,10),{controlled:true}),t=addPerson(x,'Target','farmer',v(11.05,1,10),{controlled:true});const b=x.world.primaryBody(p.id)!,tb=x.world.primaryBody(t.id)!;b.yaw=-Math.PI/2;tb.yaw=Math.PI/2;return {...x,p,t,b,tb};}
function tick(x:ReturnType<typeof fixture>,n:number,hold=false){for(let i=0;i<n;i++){if(hold)refreshCrouchHeld(x.world,x.b,true);x.world.physicalTime+=S.stepSeconds;x.sim.step(S.stepSeconds,S.stepSeconds);}}

describe('camera facing and held posture',()=>{
 it.each([[0,-1],[0,1],[-1,0],[1,0],[1,1]])('travel %j/%j keeps independently supplied facing',(x,z)=>{
  const next=predictMovement(initial,{x,z,sprint:false,facing:0},S.stepSeconds,floor);
  expect(next.yaw).toBe(0);expect(Math.hypot(next.pos.x-10,next.pos.z-10)).toBeCloseTo(3/60,8);
 });
 it('turns while stationary with bounded rate; NPC travel facing remains the default',()=>{
  const turned=predictMovement(initial,{x:0,z:0,sprint:false,facing:Math.PI/2},S.stepSeconds,floor);
  expect(turned.yaw).toBeCloseTo(S.facingRadiansPerSecond/60);expect(turned.pos).toEqual(initial.pos);
  expect(predictMovement(initial,{x:1,z:0,sprint:false},S.stepSeconds,floor).yaw).toBeCloseTo(-Math.PI/2);
  const backward=predictMovement(initial,{x:0,z:1,sprint:true,facing:0},S.stepSeconds,floor);
  expect(backward.pos.z-10).toBeCloseTo(3/60);
 });
 it('strafe then dodge freezes lateral direction; committed camera intent cannot rotate the strike',()=>{
  const x=fixture();x.tb.pos.x=20;
  applyInteractionMovement(x.world,x.p,x.b,{x:0,z:1,sprint:false,facing:-Math.PI/2},S.stepSeconds);
  expect(x.b.yaw).toBeCloseTo(-Math.PI/2);submitCombatInput(x.world,x.b.id,{kind:'sidestep'});
  expect(x.b.combatAction!.direction.z).toBeCloseTo(1);tick(x,30);
  submitCombatInput(x.world,x.b.id,{kind:'attack'});tick(x,13);const facing=x.b.yaw;
  applyInteractionMovement(x.world,x.p,x.b,{x:0,z:0,sprint:false,facing:0},S.stepSeconds);tick(x,1);expect(x.b.yaw).toBe(facing);
 });
 it('holds through heartbeats with one cost, moves slowly, then stands on release',()=>{
  const x=fixture();x.tb.pos.x=20;const cost=x.p.physiology.fatigue;
  expect(submitCombatInput(x.world,x.b.id,{kind:'duck',held:true})).toBe('accepted');tick(x,120,true);
  expect(x.b.crouch).toBe(1);expect(x.b.combatAction).toBeUndefined();expect(x.p.physiology.fatigue-cost).toBeCloseTo(S.crouchEffort,3);
  const state=movementState(x.world,x.p,x.b),next=predictMovement(state,{x:1,z:0,sprint:true,facing:x.b.yaw},S.stepSeconds,floor);
  expect(next.pos.x-state.pos.x).toBeCloseTo(state.speed*S.crouchSpeedMultiplier/60);
  const upright=hurtVolumes({pos:x.b.pos,yaw:x.b.yaw,shape:'humanoid'},0),duck=hurtVolumes({pos:x.b.pos,yaw:x.b.yaw,shape:'humanoid'},1);
  expect(duck.find(h=>h.region==='head')!.center.y).toBeLessThan(upright.find(h=>h.region==='head')!.center.y);
  submitCombatInput(x.world,x.b.id,{kind:'duck',held:false});tick(x,14);expect(x.b.crouch).toBe(0);
 });
 it('release cancels a queued posture, interruption cannot retain a new lease, stale heartbeats cannot resurrect it',()=>{
  const x=fixture();x.tb.pos.x=20;submitCombatInput(x.world,x.b.id,{kind:'attack'});tick(x,18);
  expect(submitCombatInput(x.world,x.b.id,{kind:'duck',held:true})).toBe('accepted');
  submitCombatInput(x.world,x.b.id,{kind:'duck',held:false});tick(x,40);expect(x.b.crouch??0).toBe(0);
  submitCombatInput(x.world,x.b.id,{kind:'sidestep'});stopCombatAction(x.world,x.b,'contact');
  expect(submitCombatInput(x.world,x.b.id,{kind:'duck',held:true})).toBe('interrupted');expect(crouchHeld(x.world,x.b)).toBe(false);
  refreshCrouchHeld(x.world,x.b,true);expect(crouchHeld(x.world,x.b)).toBe(false);
  tick(x,20);submitCombatInput(x.world,x.b.id,{kind:'duck',held:true});tick(x,40);expect(x.b.crouch).toBe(0);
  const cost=x.p.physiology.fatigue;submitCombatInput(x.world,x.b.id,{kind:'duck',held:true});expect(x.p.physiology.fatigue-cost).toBeCloseTo(S.crouchEffort,8);
 });
 it('clearance constrains standing, including partial release; replay is pure',()=>{
  // Fractional support tests the physical kernel; current arena voxels are whole metres.
  const state={...initial,pos:v(10,1.4,10),crouch:1},ceiling=()=>({floor:1.4,walkable:true,solids:[0,3]});
  expect(postureFits(state,1,ceiling)).toBe(true);expect(postureFits(state,0,ceiling)).toBe(false);
  let next=state;for(let i=0;i<30;i++)next=predictPosture(next,false,S.stepSeconds,ceiling) as typeof state;
  expect(next.crouch).toBeGreaterThan(0);expect(postureFits(next,next.crouch,ceiling)).toBe(true);
  expect(predictPosture(state,false,S.stepSeconds,ceiling)).toEqual(predictPosture(state,false,S.stepSeconds,ceiling));expect(state.crouch).toBe(1);
 });
 it('persists posture amount but releases control and arena entitlement across load',()=>{
  const x=fixture();configureCombatPractice(x.world,[x.b.id],true);submitCombatInput(x.world,x.b.id,{kind:'duck',held:true});tick(x,12,true);
  const loaded=deserialize(serialize(x.world))!.world,b=loaded.body(x.b.id)!;
  expect(b.crouch).toBe(1);expect(crouchHeld(loaded,b)).toBe(false);expect(arenaRepertoire(loaded,b.id)).toBe(false);
 });
 it.each(['high','low'] as const)('held posture changes high contact while preserving low contact: %s',trajectory=>{
  const x=fixture();submitCombatInput(x.world,x.tb.id,{kind:'duck',held:true});tick(x,12);
  expect(x.tb.crouch).toBe(1);submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory});
  for(let i=0;i<55;i++){refreshCrouchHeld(x.world,x.tb,true);tick(x,1);}
  expect(x.b.combatAction?.outcome).toBe(trajectory==='high'?'miss':'hit');
  expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(trajectory==='high'?0:1);
 });
 it('requires standing recovery before an attack and rejects unsupported startup',()=>{
  const x=fixture();x.tb.pos.x=20;submitCombatInput(x.world,x.b.id,{kind:'duck',held:true});tick(x,12,true);
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'rise'})).toBe('accepted');expect(x.b.combatAction?.definition).toBe('crouch_exit');tick(x,14);
  expect(x.b.crouch).toBe(0);expect(x.b.combatAction?.commandId).toBe('rise');
  tick(x,60);x.b.onGround=false;expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('unsupported');
 });
});
describe('bounded repertoire and arena resources',()=>{
 it('front kick chains to one distinct right-foot sweep only in the arena repertoire',()=>{
  const x=fixture();x.tb.pos.x=20;configureCombatPractice(x.world,[x.b.id],false);
  submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low'});expect(x.b.combatAction?.moveId).toBe('front_kick');tick(x,28);
  submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low',commandId:'round'});tick(x,10);
  expect(x.b.combatAction).toMatchObject({moveId:'round_kick',variant:'round'});expect(x.b.combatAction!.startedAt).toBeCloseTo(38/60,10);
  const front=strikePoint(v(0,0,0),0,S.unarmedPathReach,.5,'low','kick'),round=strikePoint(v(0,0,0),0,S.unarmedPathReach,.5,'low','round');expect(Math.hypot(front.x-round.x,front.z-round.z)).toBeGreaterThan(.15);
  tick(x,70);expect(x.b.attackSeq).toBe(2);
  const ordinary=fixture();ordinary.tb.pos.x=20;submitCombatInput(ordinary.world,ordinary.b.id,{kind:'attack',trajectory:'low'});tick(ordinary,40);submitCombatInput(ordinary.world,ordinary.b.id,{kind:'attack',trajectory:'low'});expect(ordinary.b.combatAction?.moveId).toBe('front_kick');
 });
 it('round kick establishes physical contact once and keeps its frozen meaning through save/load',()=>{
  const x=fixture();configureCombatPractice(x.world,[x.b.id],false);x.tb.pos.x=20;
  submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low'});tick(x,40);
  submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low'});tick(x,10);x.tb.pos.x=11.05;
  const restored=deserialize(serialize(x.world))!.world;expect(restored.body(x.b.id)!.combatAction).toEqual(x.b.combatAction);
  tick(x,60);expect(x.b.combatAction?.outcome).toBe('hit');expect(x.b.combatAction?.contact?.region).toBeTruthy();expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(1);
 });
 it('legacy saved attacks retain original completion and transition rules',()=>{
  const x=fixture();submitCombatInput(x.world,x.b.id,{kind:'attack'});const a=x.b.combatAction!;delete a.moveId;delete a.repertoireRevision;a.activeAt=.3;a.recoveryAt=.45;a.completeAt=.75;
  expect(combatTransitionAt(a,'attack')).toBe(.48);expect(combatTransitionAt(a,'move')).toBe(.75);
 });
 it('practice scales each participant once and quietly recovers fatigue without healing or world-time changes',()=>{
  const s=new BridgeSession(123,{arena:true});arrangeCombatArena(s,'idle');const [p,n]=s.world.persons(),pb=s.world.primaryBody(p.id)!,nb=s.world.primaryBody(n.id)!;
  const before=p.physiology.fatigue;submitCombatInput(s.world,pb.id,{kind:'backstep'});submitCombatInput(s.world,nb.id,{kind:'backstep'});
  expect(p.physiology.fatigue-before).toBeCloseTo(S.defenseEffort*.4);expect(n.physiology.fatigue-before).toBeCloseTo(S.defenseEffort*.4);
  pb.combatAction=nb.combatAction=undefined;pb.lastHitAt=nb.lastHitAt=-99;p.physiology.fatigue=n.physiology.fatigue=.5;pb.health-=5;
  const now=s.world.now,phys={...p.physiology};for(let i=0;i<600;i++){s.world.physicalTime+=1/60;tickPractice(s,1/60);}
  expect(p.physiology.fatigue).toBeCloseTo(.15,6);expect(n.physiology.fatigue).toBeCloseTo(.15,6);expect(pb.health).toBe(pb.maxHealth-5);expect(s.world.now).toBe(now);
  expect({...p.physiology,fatigue:phys.fatigue}).toEqual(phys);
  setPracticeMode(s,'normal');const fatigue=p.physiology.fatigue;tickPractice(s,1);expect(p.physiology.fatigue).toBe(fatigue);
  setPracticeMode(s,'repeat');n.physiology.fatigue=.91;expect(practiceStatus(s)!.status).toBe('exhausted');
  setPracticeMode(s,'reset');expect(practiceStatus(s)).toMatchObject({mode:'repeat',profile:'Normal Physiology',ready:false});expect(practiceStatus(s)!.status).toContain('reset in');
 });
});
