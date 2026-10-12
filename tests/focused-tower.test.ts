import {beforeAll,describe,it,expect} from 'vitest';
import {loadFocusedGeometry} from '../src/server/focusedGeometryLoader';
import {RealmSession} from '../src/sim/world/realms/session';
import {applyTowerCommand} from '../src/server/canonicalTower';
import {FoldedRealmGrid} from '../src/sim/world/interiors/grid';
import {currentTowerFloor} from '../src/sim/world/interiors/tower';
beforeAll(()=>loadFocusedGeometry());
describe('focused assets in the canonical Tower',()=>{
 it('enters through the physical landmark, preserves truth and reloads/revisits the same floor',()=>{
  let s=new RealmSession(918271);s.adoptFocusedWorld();s.body.pos={...s.grid.focusedTown!.tower.entry};const before={person:s.person.id,body:s.body.id,inventory:[...s.person.inventory],rank:s.person.ontology.stage,health:s.body.health};
  applyTowerCommand(s,{id:'focused-enter',type:'enter',revision:0});const f=currentTowerFloor(s.world)!,plan=(s.grid as FoldedRealmGrid).interior(f.interiorId);
  expect(plan.assetScene?.placements.length).toBeGreaterThan(2);const g=s.grid.movementGeometryAt(plan.start.x,plan.start.z)!;expect(g.fits(plan.start.x,plan.start.y,plan.start.z,.3,1.75)).toBe(true);expect(g.findPath(plan.start,plan.exit)).not.toBeNull();
  expect({person:s.person.id,body:s.body.id,inventory:s.person.inventory,rank:s.person.ontology.stage,health:s.body.health}).toEqual(before);expect(f.enemyBodyIds).toHaveLength(3);
  for(const id of f.enemyBodyIds){const b=s.world.body(id)!;expect(g.fits(b.pos.x,b.pos.y,b.pos.z,.3,1.75)).toBe(true);expect(g.findPath(plan.start,b.pos)).not.toBeNull();}
  s=new RealmSession(0,s.save());expect((s.grid as FoldedRealmGrid).interior(f.interiorId)).toEqual(plan);applyTowerCommand(s,{id:'focused-return',type:'return',revision:s.world.canonicalTower!.revision,runId:s.world.canonicalTower!.id});expect(s.body.pos).toEqual(s.grid.focusedTown!.tower.entry);
  applyTowerCommand(s,{id:'focused-reenter',type:'enter',revision:s.world.canonicalTower!.revision,runId:s.world.canonicalTower!.id});expect(currentTowerFloor(s.world)!.enemyBodyIds).toEqual(f.enemyBodyIds);expect(s.person.inventory).toEqual(before.inventory);
 },60000);
});
