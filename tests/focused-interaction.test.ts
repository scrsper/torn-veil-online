import {describe,it,expect} from 'vitest';
import {BridgeSession} from '../src/bridge/session';
import {makeItem} from '../src/sim/world/factory';
import {makeContainer} from '../src/sim/core/container';
import {B} from '../src/sim/physical/blocks';
describe('one observed contextual target contract',()=>{
 it('projects person and loose item independently; explicit Talk is not intercepted by pickup',()=>{
  const s=new BridgeSession(213),w=s.world,p=w.person(w.playerId)!,b=w.primaryBody(p.id)!;
  const other=w.bodies().find(o=>o.shape==='humanoid'&&o.ownerId!==p.id&&o.present&&!o.dead)!;
  other.pos={...b.pos,x:b.pos.x+.8};other.pose='stand';
  p.mind.percepts=[{entityId:other.ownerId,bodyId:other.id,how:'saw',pos:{...other.pos},tick:w.now,distance:.8}];
  const item=makeItem(w,'bread','Bread',{pos:{...b.pos,x:b.pos.x+.5}});
  const targets=s.snapshot().interactionTargets;
  expect(targets).toContainEqual(expect.objectContaining({targetId:other.id,actionId:`talk:${other.id}`,kind:'person'}));
  expect(targets).toContainEqual(expect.objectContaining({targetId:item.id,actionId:`take:${item.id}`,kind:'item'}));
  expect(s.intent({version:1,sequence:1,type:'talk',targetBodyId:other.id}).result).toBe('accepted');
  expect(w.item(item.id)?.holderId).toBeNull();
  p.mind.percepts=[];
  expect(s.snapshot().interactionTargets.some(t=>t.targetId===other.id)).toBe(false);
  expect(s.intent({version:1,sequence:2,type:'talk',targetBodyId:other.id}).result).toBe('interaction_unavailable');
 });
 it('projects every permitted nearby container and drops the selected carried item, not only last',()=>{
  const s=new BridgeSession(213),w=s.world,p=w.person(w.playerId)!,b=w.primaryBody(p.id)!;
  const a=makeContainer(w,{name:'A',capacity:8,pos:{...b.pos,x:b.pos.x+.5}}),c=makeContainer(w,{name:'B',capacity:8,pos:{...b.pos,x:b.pos.x+1}});
  expect(s.snapshot().interactionTargets.map(t=>t.targetId)).toEqual(expect.arrayContaining([a.id,c.id]));
  const first=makeItem(w,'bread','First',{holder:p.id,owner:p.id}),last=makeItem(w,'bread','Last',{holder:p.id,owner:p.id});
  expect(s.intent({version:1,sequence:1,type:'interact',interactionId:`drop:${first.id}`}).result).toBe('accepted');
  expect(w.item(last.id)?.holderId).toBe(p.id);expect(w.item(first.id)?.holderId).toBeNull();
 });
 it('door focus uses canonical operation and rejects stale/out-of-reach targets',()=>{
  const s=new BridgeSession(213),w=s.world,p=w.person(w.playerId)!,b=w.primaryBody(p.id)!;
  const x=Math.floor(b.pos.x)+1,z=Math.floor(b.pos.z),y=Math.floor(b.pos.y);
  w.grid.set(x,y,z,B.Door);
  const id=`open:door:${x}:${y}:${z}`;
  expect(s.snapshot().interactionTargets).toContainEqual(expect.objectContaining({actionId:id,targetId:`door:${x}:${y}:${z}`,kind:'door'}));
  expect(s.intent({version:1,sequence:1,type:'interact',interactionId:id}).result).toBe('accepted');
  expect(w.grid.isDoorOpen(x,y,z)).toBe(true);
  b.pos.x+=10;
  expect(s.intent({version:1,sequence:2,type:'interact',interactionId:`close:door:${x}:${y}:${z}`}).result).toBe('interaction_unavailable');
 });
});
