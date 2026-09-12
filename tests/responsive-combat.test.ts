import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, v, wall } from './helpers/world';
import { submitCombatInput, requestCombatAction, stopCombatAction } from '../src/sim/physical/combatAction';
import { INTERACTION_SPEC as S } from '../src/sim/physical/prediction';
import { serialize, deserialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';

function arena(){
 const x=createTestWorld(123),p=addPerson(x,'Fighter','farmer',v(10,1,10),{controlled:true}),t=addPerson(x,'Partner','farmer',v(11.05,1,10),{controlled:true});
 const b=x.world.primaryBody(p.id)!,tb=x.world.primaryBody(t.id)!;b.yaw=-Math.PI/2;tb.yaw=Math.PI/2;
 return {...x,p,t,b,tb};
}
function tick(x:ReturnType<typeof arena>,n:number){for(let i=0;i<n;i++){x.world.physicalTime+=S.stepSeconds;x.sim.step(S.stepSeconds,S.stepSeconds);}}
describe('responsive combat repair',()=>{
 it.each(['none','distant','missing','obstructed'] as const)('selection %s never suppresses a free swing',selection=>{
  const x=arena();x.tb.pos.x=selection==='obstructed'?12.05:20;
  if(selection==='obstructed')wall(x,11,9,11);
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',targetBodyId:selection==='none'?undefined:selection==='missing'?'lost-body':x.tb.id,commandId:'free'})).toBe('accepted');
  expect(x.b.attackSeq).toBe(1);expect(x.tb.health).toBe(x.tb.maxHealth);tick(x,50);
  expect(x.b.combatAction?.outcome).toBe('miss');expect(x.tb.health).toBe(x.tb.maxHealth);
 });
 it('a body entering an already accepted free attack can make contact exactly once',()=>{
  const x=arena();x.tb.pos.z=12;
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'enter'})).toBe('accepted');tick(x,12);
  expect(x.b.combatAction?.outcome).toBe('pending');x.tb.pos.z=10;tick(x,40);
  expect(x.b.combatAction?.outcome).toBe('hit');expect(x.tb.health).toBeLessThan(x.tb.maxHealth);
  expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(1);tick(x,40);expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(1);
 });
 it.each(['withdrawn','deadBody','deceasedOwner'] as const)('rechecks %s eligibility at contact without suppressing the swing',state=>{
  const x=arena();expect(submitCombatInput(x.world,x.b.id,{kind:'attack',targetBodyId:x.tb.id})).toBe('accepted');tick(x,12);
  if(state==='withdrawn')x.tb.present=false;
  else if(state==='deadBody')x.tb.dead=true;
  else x.t.alive=false;
  tick(x,40);expect(x.b.combatAction?.outcome).toBe('miss');expect(x.tb.health).toBe(x.tb.maxHealth);
  expect(x.world.events.filter(e=>e.type==='attack')).toHaveLength(0);
 });
 it('replaces a single follow-up and starts it at the first legal step transition with one cost',()=>{
  const x=arena(),cost=x.p.physiology.fatigue;
  expect(submitCombatInput(x.world,x.b.id,{kind:'sidestep',side:1,commandId:'first'})).toBe('accepted');tick(x,7);
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'replaced'})).toBe('accepted');
  expect(submitCombatInput(x.world,x.b.id,{kind:'backstep',commandId:'last'})).toBe('accepted');tick(x,8);
  expect(x.b.combatAction?.commandId).toBe('last');expect(x.b.combatAction?.startedAt).toBeCloseTo(.25,8);
  expect(x.b.attackSeq).toBe(0);expect(x.p.physiology.fatigue-cost).toBeCloseTo(S.defenseEffort*2,3);
  tick(x,60);expect(x.world.events.filter(e=>e.type==='combat_action'&&e.data.phase==='accepted')).toHaveLength(2);
 });
 it('buffers light/light/heavy without creating a combo from one press',()=>{
  const x=arena();x.tb.pos.x=20;
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'one'})).toBe('accepted');tick(x,18);
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'two'})).toBe('accepted');tick(x,11);
  expect(x.b.combatAction).toMatchObject({commandId:'two',variant:'hook'});expect(x.b.combatAction!.startedAt).toBeCloseTo(29/60,8);
  tick(x,18);expect(submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low',commandId:'three'})).toBe('accepted');tick(x,11);
  expect(x.b.combatAction).toMatchObject({commandId:'three',variant:'kick'});tick(x,90);
  expect(x.b.attackSeq).toBe(3);expect(x.b.combatAction?.queuedInput).toBeUndefined();
 });
 it('rejects too-early input and clears a buffered input on contact interruption',()=>{
  const x=arena();expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');
  expect(submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'early'})).toBe('too_early');tick(x,18);
  expect(submitCombatInput(x.world,x.b.id,{kind:'sidestep',commandId:'buffer'})).toBe('accepted');
  stopCombatAction(x.world,x.b,'contact');tick(x,45);expect(x.b.combatAction?.queuedInput).toBeUndefined();expect(x.b.attackSeq).toBe(1);
 });
 it('normalizes and freezes forward/diagonal input, with collision-constrained travel',()=>{
  const x=arena(),direction={x:1,z:1};x.tb.pos.x=20;const start={...x.b.pos};
  expect(submitCombatInput(x.world,x.b.id,{kind:'sidestep',direction})).toBe('accepted');direction.x=-1;
  expect(x.b.combatAction?.direction.x).toBeCloseTo(Math.SQRT1_2);tick(x,30);
  expect(Math.hypot(x.b.pos.x-start.x,x.b.pos.z-start.z)).toBeCloseTo(S.sidestepMetres,5);
  const blocked=arena();blocked.b.pos.x=10.68;wall(blocked,11,9,11);
  expect(submitCombatInput(blocked.world,blocked.b.id,{kind:'sidestep',direction:{x:1,z:0}})).toBe('accepted');tick(blocked,30);
  expect(blocked.b.pos.x).toBeLessThanOrEqual(10.71);
 });
 it('revalidates effort at buffered startup',()=>{
  const x=arena();submitCombatInput(x.world,x.b.id,{kind:'sidestep'});tick(x,6);
  expect(submitCombatInput(x.world,x.b.id,{kind:'backstep',commandId:'tired'})).toBe('accepted');x.p.physiology.fatigue=.99;tick(x,20);
  expect(x.b.combatAction?.commandId).not.toBe('tired');expect(x.b.combatAction?.queuedInput).toBeUndefined();
  expect(x.world.events.some(e=>e.data.commandId==='tired'&&e.data.result==='exhausted')).toBe(true);
 });
 it('preserves the one pending input through save/load deterministically',()=>{
  // Save loading reconstructs the generated population before overlaying a save.
  // Start from that supported population, rather than comparing a two-body scratch
  // world with a 37-person reconstructed world that legitimately consumes more RNG.
  const base=arena(),initial=deserialize(serialize(base.world))!;
  const x={...base,world:initial.world,sim:new Simulation(initial.world),b:initial.world.body(base.b.id)!,tb:initial.world.body(base.tb.id)!};
  x.tb.pos.x=20;submitCombatInput(x.world,x.b.id,{kind:'attack',commandId:'a'});tick(x,18);
  submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low',commandId:'b'});
  const restored=deserialize(serialize(x.world))!;const sim=new Simulation(restored.world);
  for(let i=0;i<60;i++){tick(x,1);restored.world.physicalTime+=S.stepSeconds;sim.step(S.stepSeconds,S.stepSeconds);}
  expect(restored.world.body(x.b.id)?.combatAction).toEqual(x.b.combatAction);expect(restored.world.body(x.b.id)?.attackSeq).toBe(2);
 });
});
