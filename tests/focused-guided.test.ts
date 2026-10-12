import {beforeAll,describe,it,expect} from 'vitest';import {loadFocusedGeometry} from '../src/server/focusedGeometryLoader';import {RealmSession} from '../src/sim/world/realms/session';import {travelPath} from '../src/sim/physical/travel';import {portalPoint} from '../src/sim/world/realms/layout';
beforeAll(()=>loadFocusedGeometry());
describe('guided travel over actual focused asset seams',()=>{
 it('crosses diagonal paving mortar to the portal and follows the forest route to the Tower',()=>{
  const s=new RealmSession(918271);s.adoptFocusedWorld();s.body.pos.z+=2.5;expect(s.navigate('portal')).toBe(true);for(let i=0;i<3000&&s.body.path;i++)travelPath(s.world,s.body,1/60,3.3796,.3,1.8);expect(s.world.distance2d(s.body.pos,portalPoint('brass'))).toBeLessThan(3);
  expect(s.navigate('tower')).toBe(true);for(let i=0;i<6000&&s.body.path;i++)travelPath(s.world,s.body,1/60,3.3796,.3,1.8);expect(s.world.distance2d(s.body.pos,s.grid.focusedTown!.tower.entry)).toBeLessThan(.7);
 },60000);
});
