import {describe,it,expect} from 'vitest';
import {createCombatGym} from '../src/sim/world/combatGym';
import {performHandInteraction,handInteractions} from '../src/sim/physical/hand';
import {equippedItems,equipmentProjection,changeEquipment} from '../src/sim/physical/equipment';
import {combatWeapon} from '../src/sim/physical/combat';
import {BridgeSession} from '../src/bridge/session';
import {serialize,deserialize} from '../src/sim/persist/save';
import {makeCatalogItem,makeCatalogArmor,makeBody} from '../src/sim/world/factory';
describe('canonical equipment',()=>{
 it('equips and unequips catalog weapons and armor through ordinary interactions without duplicating inventory',()=>{
  const {world:w,sim}=createCombatGym(),p=w.person(w.playerId!)!,b=w.primaryBody(p.id)!;
  const ids=[...p.inventory],sword=w.items().find(i=>i.catalogId==='TV-010')!,helm=w.items().find(i=>i.catalogId==='TV-091')!;
  for(const i of [sword,helm])expect(performHandInteraction(sim,p,'equip:'+i.id)).toBe('accepted');
  expect(p.inventory).toEqual(ids);expect(equippedItems(w,p,b).map(i=>i.id)).toEqual([sword.id,helm.id]);
  expect(combatWeapon(w,p)?.id).toBe(sword.id);
  const projection=new BridgeSession(w.seed,{state:{world:w,sim}}).snapshot();
  expect(projection.carried.find(i=>i.id===helm.id)?.actions.map(a=>a.kind)).toContain('unequip');
  expect(projection.bodies.find(x=>x.bodyId===b.id)?.equipment).toContainEqual({id:helm.id,catalogId:'TV-091',type:'armor',slot:'head'});
  expect(performHandInteraction(sim,p,'unequip:'+sword.id)).toBe('accepted');expect(combatWeapon(w,p)).toBeNull();
  expect(performHandInteraction(sim,p,'unequip:'+helm.id)).toBe('accepted');expect(equippedItems(w,p,b)).toEqual([]);
  expect(w.events.filter(e=>e.type==='item_equipped')).toHaveLength(2);
 });
 it('revalidates ownership, body identity, occupied slots, quantities and incapacitation',()=>{
  const {world:w}=createCombatGym(),p=w.person(w.playerId!)!,b=w.primaryBody(p.id)!,other=w.persons()[1];
  const sword=w.items().find(i=>i.catalogId==='TV-010')!,second=makeCatalogItem(w,'TV-011',{holder:p.id});
  expect(changeEquipment(w,other,sword.id,true)).toBe('not_carried');
  expect(changeEquipment(w,p,sword.id,true,w.primaryBody(other.id)!.id)).toBe('incapacitated');
  expect(changeEquipment(w,p,sword.id,true)).toBe('accepted');expect(changeEquipment(w,p,second.id,true)).toBe('slot_occupied');
  const another=makeBody(w,p.id,{x:40,y:1,z:40});expect(changeEquipment(w,p,sword.id,true,another.id)).toBe('equipped_elsewhere');
  expect(changeEquipment(w,p,sword.id,false)).toBe('accepted');second.quantity=2;expect(changeEquipment(w,p,second.id,true)).toBe('unusable_item');
  b.pose='sleep';expect(changeEquipment(w,p,sword.id,true)).toBe('incapacitated');
 });
 it('persists physical bindings, drops them on transfer, and gives armor no invented abilities or protection',()=>{
  const {world:w,sim}=createCombatGym(),p=w.person(w.playerId!)!,b=w.primaryBody(p.id)!;
  const armor=makeCatalogArmor(w,'TV-100',{holder:p.id,owner:p.id});expect(changeEquipment(w,p,armor.id,true)).toBe('accepted');
  const restored=deserialize(serialize(w))!.world;expect(equipmentProjection(restored,restored.body(b.id)!)).toContainEqual({id:armor.id,catalogId:'TV-100',type:'armor',slot:'head'});
  expect(armor.damage).toBe(0);expect(armor).not.toHaveProperty('abilities');expect(armor).not.toHaveProperty('protection');
  sim.dropItem(p,armor,{x:27,y:1,z:32});expect(armor.equipped).toBeUndefined();expect(equippedItems(w,p,b)).toEqual([]);
 });
});
