import { beforeAll, describe, expect, it } from 'vitest';
import { loadFocusedGeometry } from '../src/server/focusedGeometryLoader';
import { RealmSession } from '../src/sim/world/realms/session';
import { applyTowerCommand } from '../src/server/canonicalTower';
import { FoldedRealmGrid } from '../src/sim/world/interiors/grid';
import { RealmRuntime } from '../src/server/realmRuntime';

beforeAll(() => loadFocusedGeometry());
const identity = (s: RealmSession) => ({ person:s.person.id, body:s.body.id,
  rank:structuredClone(s.person.ontology), inventory:[...s.person.inventory], health:s.body.health,
  items:structuredClone(s.person.inventory.map(id => s.world.item(id))),
  knowledge:structuredClone(s.person.knowledge), growth:structuredClone(s.body.arcana) });
function retained(realm:'brass'|'aether',active:boolean) {
  const s=new RealmSession(918271),tower=s.grid.chunk(realm,32,32).buildings[0];
  s.body.pos={x:tower.door.x+.5,y:1,z:tower.z+4.5};
  applyTowerCommand(s,{id:'migration-enter',type:'enter',revision:0});
  if(!active)applyTowerCommand(s,{id:'migration-return',type:'return',revision:s.world.canonicalTower!.revision,runId:s.world.canonicalTower!.id});
  return s;
}
describe('reversible focused geometry adoption with retained canonical progress',()=>{
  it('retains suppressed old parcel door states across adoption and reload',()=>{
    const s=new RealmSession(918271);
    for(const realm of ['aether','brass'] as const)for(const cx of [31,32])for(const cz of [32,33])for(const building of s.grid.chunk(realm,cx,cz).buildings.slice(0,3))s.grid.setDoorOpen(building.door.x,1,building.door.z,true);
    const doors=[...s.grid.doorStates];expect(doors.length).toBeGreaterThan(3);
    s.adoptFocusedWorld();expect([...s.grid.doorStates]).toEqual(doors);
    expect([...new RealmSession(0,s.save()).grid.doorStates]).toEqual(doors);
  });
  for(const realm of ['brass','aether'] as const)for(const active of [true,false]) {
    it(`preserves ${realm} ${active?'active':'returned'} run, literal floor and finite entities`,()=>{
      const s=retained(realm,active),before=s.save(),run=structuredClone(s.world.canonicalTower!),truth=identity(s),
        descriptors=structuredClone(s.world.interiors),body=structuredClone(s.body),
        oldPlan=(s.grid as FoldedRealmGrid).interior(run.floors[0].interiorId),
        enemies=structuredClone(run.floors[0].enemyBodyIds.map(id=>s.world.body(id)));
      s.adoptFocusedWorld({policy:'preserve-canonical-floors-v1',runId:run.id,revision:run.revision});
      expect(identity(s)).toEqual(truth);expect(s.world.interiors).toEqual(descriptors);
      expect((s.grid as FoldedRealmGrid).interior(run.floors[0].interiorId)).toEqual(oldPlan);
      expect(run.floors[0].enemyBodyIds.map(id=>s.world.body(id))).toEqual(enemies);
      expect({...s.world.canonicalTower,returnPos:run.returnPos}).toEqual(run);
      if(active)expect(s.body).toEqual(body);
      if(realm==='brass')expect(s.world.canonicalTower!.returnPos).toEqual(s.grid.focusedTown!.tower.entry);
      else expect(s.world.canonicalTower!.returnPos).toEqual(run.returnPos);
      const restored=new RealmSession(0,s.save());expect(identity(restored)).toEqual(truth);
      if(active)applyTowerCommand(restored,{id:'migrated-return',type:'return',revision:run.revision,runId:run.id});
      restored.body.pos={...restored.world.canonicalTower!.returnPos};
      applyTowerCommand(restored,{id:'migrated-reenter',type:'enter',revision:restored.world.canonicalTower!.revision,runId:run.id});
      expect(restored.world.canonicalTower!.floors).toEqual(run.floors);
      expect(new RealmSession(0,before).world.canonicalTower).toEqual(run); // untouched rollback source
    },60000);
  }
  it('rejects stale migration intent without resetting host controls or changing save truth',()=>{
    const runtime=new RealmRuntime(retained('brass',true)),before=runtime.session.save(),control=runtime.checkpoint(),run=runtime.session.world.canonicalTower!;
    expect(()=>runtime.apply({type:'adopt_focused',migration:{policy:'preserve-canonical-floors-v1',runId:run.id,revision:run.revision+1}})).toThrow('coordinated geometry migration');
    const after=JSON.parse(runtime.session.save()),original=JSON.parse(before);delete after.savedAt;delete original.savedAt;
    expect(after).toEqual(original);expect(runtime.checkpoint()).toEqual(control);
  });
});
