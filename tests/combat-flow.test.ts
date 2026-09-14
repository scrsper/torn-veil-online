import {describe,it,expect} from 'vitest';
import {createTestWorld,addPerson,v} from './helpers/world';
import {submitCombatInput,stopCombatAction} from '../src/sim/physical/combatAction';
import {configureCombatPractice} from '../src/sim/physical/combatPracticeProfile';
import {combatTransitionAt} from '../src/sim/physical/combatTransitions';
import {sampledStrike} from '../src/sim/physical/combatMotion';
import {serialize,deserialize} from '../src/sim/persist/save';
import {validSavedCombatAction} from '../src/sim/persist/combatAction';
import {combatState} from '../src/bridge/combatState';
import old from '../src/sim/physical/combatRepertoire.json';
import current from '../src/sim/physical/combatRepertoireV2.json';
function fixture(){const x=createTestWorld(123),p=addPerson(x,'Fighter','farmer',v(10,1,10),{controlled:true}),b=x.world.primaryBody(p.id)!;b.yaw=0;configureCombatPractice(x.world,[b.id],false);return {...x,p,b};}
function tick(x:ReturnType<typeof fixture>,n:number){for(let i=0;i<n;i++){x.world.physicalTime+=1/60;x.sim.step(1/60,1/60);}}
describe('continuous flow canonical commitment',()=>{
 it('jab → step → cross uses one executed strike and survives a save between actions',()=>{
  const x=fixture();expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');tick(x,20);
  expect(submitCombatInput(x.world,x.b.id,{kind:'backstep'})).toBe('accepted');tick(x,9);
  expect(x.b.combatAction).toMatchObject({kind:'backstep',priorStrike:'jab',repertoireRevision:2});
  const restored=deserialize(serialize(x.world))!.world;expect(restored.body(x.b.id)!.combatAction).toEqual(x.b.combatAction);
  expect(combatState(x.world,x.b)?.priorStrike).toBe('jab');
  restored.physicalTime=restored.body(x.b.id)!.combatAction!.startedAt+.25;
  expect(submitCombatInput(restored,x.b.id,{kind:'attack'})).toBe('accepted');expect(restored.body(x.b.id)!.combatAction?.moveId).toBe('cross');
  tick(x,8);expect(submitCombatInput(x.world,x.b.id,{kind:'attack'})).toBe('accepted');tick(x,8);
  expect(x.b.combatAction?.moveId).toBe('cross');expect(x.b.attackSeq).toBe(2);
  tick(x,80);expect(x.b.attackSeq).toBe(2);expect(x.b.combatAction?.queuedInput).toBeUndefined();
 });
 it('interruption breaks lineage and cannot manufacture a follow-up',()=>{
  const x=fixture();submitCombatInput(x.world,x.b.id,{kind:'attack'});tick(x,20);submitCombatInput(x.world,x.b.id,{kind:'backstep'});tick(x,9);
  stopCombatAction(x.world,x.b,'test');tick(x,40);submitCombatInput(x.world,x.b.id,{kind:'attack'});expect(x.b.combatAction?.moveId).toBe('jab');
 });
 it('keeps revision-one round saves and uses the new swept path only for new actions',()=>{
  const x=fixture();submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low'});tick(x,40);submitCombatInput(x.world,x.b.id,{kind:'attack',trajectory:'low'});
  const a=x.b.combatAction!;expect(a).toMatchObject({moveId:'round_kick',repertoireRevision:2});
  expect(a.activeAt-a.startedAt).toBeCloseTo(.42);expect(a.recoveryAt-a.activeAt).toBeCloseTo(.28);expect(a.completeAt-a.recoveryAt).toBeCloseTo(.5);
  expect(combatTransitionAt(a,'attack')-a.startedAt).toBeCloseTo(1.08);
  const legacy={...a,repertoireRevision:1 as const,activeAt:a.startedAt+.32,recoveryAt:a.startedAt+.52,completeAt:a.startedAt+.8};
  expect(validSavedCombatAction(legacy,x.b.id)).toBe(true);expect(combatTransitionAt(legacy,'attack')-a.startedAt).toBeCloseTo(.7);
  expect(sampledStrike('round',.5,1)).not.toEqual(sampledStrike('round',.5,2));
  x.b.combatAction=legacy;expect(deserialize(serialize(x.world))!.world.body(x.b.id)!.combatAction).toEqual(legacy);
 });
 it('preserves approved standalone front kick and all punch active geometry',()=>{
  for(const id of ['jab','cross','front_kick'] as const){const {chainAsset,chainStart,...move}=current.moves[id];expect(move).toEqual(old.moves[id]);}
  for(const variant of ['direct','hook','kick'] as const)for(const t of [0,.25,.5,.75,1])expect(sampledStrike(variant,t,2)).toEqual(sampledStrike(variant,t,1));
 });
 it('rejects malformed carried history instead of interpreting it as a move',()=>{
  const x=fixture();submitCombatInput(x.world,x.b.id,{kind:'backstep'});const a=x.b.combatAction!;
  expect(validSavedCombatAction({...a,priorStrike:'sword'},x.b.id)).toBe(false);
  expect(validSavedCombatAction({...a,priorStrike:'jab',repertoireRevision:1},x.b.id)).toBe(false);
 });
});
