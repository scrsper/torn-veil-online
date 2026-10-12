import {describe,it,expect} from 'vitest';import {mkdtempSync} from 'node:fs';import {resolve} from 'node:path';
import {RealmJournal} from '../src/server/realmJournal';
import {RealmSession} from '../src/sim/world/realms/session';import {loadFocusedGeometry} from '../src/server/focusedGeometryLoader';
describe('focused world canonical writer and replay replica',()=>{
 it('rejects an unknown generator without reinterpreting the original saved world',()=>{loadFocusedGeometry();const s=new RealmSession(918271);s.adoptFocusedWorld();const raw=JSON.parse(s.save());raw.realmSpec.focusedGenerator='unavailable-generator';expect(()=>new RealmSession(0,JSON.stringify(raw))).toThrow('invalid or incompatible');});
 it('adopts source geometry, preserves player truth and reloads the same physical world',async()=>{
  const dir=mkdtempSync(resolve('.debug/test-temp/focused-journal-')),path=resolve(dir,'world.json');const j=new RealmJournal(path,918271);await j.ready;
  const before=j.runtime.session.snapshot(),identity={person:before.person.id,body:before.body.id,rank:before.person.rank,inventory:before.person.inventory};
  j.apply({type:'adopt_focused'});await j.flush();await j.checkpoint();const adopted=j.runtime.session.snapshot();
  expect({person:adopted.person.id,body:adopted.body.id,rank:adopted.person.rank,inventory:adopted.person.inventory}).toEqual(identity);expect(adopted.focusedAssets).not.toBeNull();await j.close();
  const restored=new RealmJournal(path,918271);await restored.ready;expect(restored.runtime.session.snapshot().body.pos).toEqual(adopted.body.pos);expect(restored.runtime.session.grid.movementGeometryAt(adopted.body.pos.x,adopted.body.pos.z)).not.toBeNull();await restored.close();
 },60000);
});
