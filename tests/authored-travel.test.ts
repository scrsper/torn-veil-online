import {describe,it,expect} from 'vitest';
import {authoredTravelBlend} from '../src/web/actors/sharedMotion';
import {weaponMotionBinding,SHARED_MOTION} from '../src/web/presentation/library';
import {sharedHeroLook} from '../src/web/actors/sharedCast';
import {cameraLocalTop} from '../src/web/realms/interiorCamera';
describe('authored motion ownership and composition',()=>{
 it('reserves sprint for canonical run, preserves stride at intermediate speed and bounds start/stop rates',()=>{
  const pace=(n:string)=>n.includes('sprint')?5.2:n.includes('jog')?3.4:1.5,len=(n:string)=>n.includes('walk')?1.2:.8;
  for(const speed of [0,.2,1.5,2.4,3.34,5.2])for(const sprint of [false,true]){
   const p=authoredTravelBlend(speed,sprint,pace,len);expect(p.blend).toBeGreaterThanOrEqual(0);expect(p.blend).toBeLessThanOrEqual(1);
   if(!sprint)expect(p.run).toBe('unarmed/run_jog');
   const stride=(1-p.blend)*pace(p.walk)*len(p.walk)+p.blend*pace(p.run)*len(p.run);
   if(speed>.2)expect(p.rate*stride).toBeCloseTo(speed);expect(Number.isFinite(p.rate)).toBe(true);
  }
 });
 it('uses actual weapon and trajectory even when counters or retained equipment differ',()=>{
  const stab=weaponMotionBinding({moveId:'dagger_mid',weight:'light',definition:'dagger_mid',trajectory:'mid'},'axe');
  expect(stab.clip).toBe('1H_Melee_Attack_Stab');expect(SHARED_MOTION.has(stab.clip)).toBe(true);
  const chop=weaponMotionBinding({moveId:'hammer_high',weight:'heavy',trajectory:'high'},'hammer');expect(chop.clip).toBe('1H_Melee_Attack_Chop');
  expect(weaponMotionBinding({moveId:'sword_high',weight:'light',trajectory:'low'},'sword').clip).not.toBe(stab.clip);
 });
 it('selects an explicit credited hero kit without mutating canonical appearance',()=>{
  const body={presentationSex:'f' as const,appearance:undefined};const original=JSON.stringify(body);expect(sharedHeroLook(body)).toBe('wren');expect(JSON.stringify(body)).toBe(original);
  expect(sharedHeroLook({presentationSex:'m',appearance:undefined})).toBe('ranger');
 });
 it('does not let a distant tall landmark lift local interior framing',()=>{
  expect(cameraLocalTop({x:0,y:2,z:0},{x:0,y:2,z:7},[{x:30,y:0,z:30,w:3,h:100,d:3}])).toBe(2.6);
  expect(cameraLocalTop({x:0,y:2,z:0},{x:0,y:2,z:7},[{x:-1,y:1,z:3,w:2,h:5,d:1}])).toBe(6.6);
 });
});
