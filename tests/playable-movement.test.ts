import { expect, test } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { moveByIntent } from '../src/sim/physical/input';
import { authorizeExternalIntention, hasExternalIntention } from '../src/sim/runtime/controllers';
import { B } from '../src/sim/physical/blocks';

test('a completed external action releases its scheduler slot and subsequent running costs fatigue', () => {
  const tw=createTestWorld(912,80), {world,sim}=tw, p=addPerson(tw,'Walker','traveler',v(20,1,20),{controlled:true});
  world.clock.timeScale=60; const body=world.primaryBody(p.id)!, before=p.physiology.fatigue;
  authorizeExternalIntention(p); step(tw,.05); expect(hasExternalIntention(p)).toBe(false);
  for(let i=0;i<100;i++) { moveByIntent(sim,p,body,1,0,true,.05); step(tw,.05); }
  expect(body.pos.x).toBeGreaterThan(30); expect(body.pose).toBe('run'); expect(p.physiology.fatigue).toBeGreaterThan(before);
});

test('ordinary movement descends a one metre step and opens a canonical door, but cannot cross a wall',()=>{
  const tw=createTestWorld(913,30), p=addPerson(tw,'Walker','traveler',v(8.5,2,15.5),{controlled:true}), b=tw.world.primaryBody(p.id)!;
  for(let x=1;x<=9;x++) for(let z=1;z<29;z++) tw.world.grid.set(x,1,z,B.Stone);
  tw.world.grid.set(15,1,15,B.Door); tw.world.grid.set(18,1,15,B.Stone); tw.world.grid.set(18,2,15,B.Stone); tw.world.initNav();
  for(let i=0;i<100;i++) moveByIntent(tw.sim,p,b,1,0,false,.05);
  expect(b.pos.x).toBeGreaterThan(15.5); expect(b.pos.x).toBeLessThan(18); expect(b.pos.y).toBe(1);
  expect(tw.world.grid.isDoorOpen(15,1,15)).toBe(true);
  expect(tw.world.events.some(e=>e.actor===p.id&&e.type==='block_changed' && e.data.open===true)).toBe(true);
});
