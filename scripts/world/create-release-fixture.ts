/** Explicit isolated acceptance fixture. Never imports or modifies a user campaign. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RealmSession } from '../../src/sim/world/realms/session';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';
import { makeItem } from '../../src/sim/world/factory';
import { learnArcaneSource, arcaneBody } from '../../src/sim/physical/arcana/runtime';
import { changeEquipment } from '../../src/sim/physical/equipment';
import { canonicalUniverseView } from '../../src/server/canonicalUniverse';

if (process.env.TV_RELEASE_FIXTURE !== '1') throw Error('Set TV_RELEASE_FIXTURE=1 to create a NEW isolated, endowed flight acceptance world. This is not earned progression.');
loadFocusedGeometry();
const s = new RealmSession(20261017);
s.adoptFocusedWorld();
s.person.physiology.energy = s.person.physiology.hydration = 1;
s.person.physiology.fatigue = s.person.physiology.bodyHeat = s.person.physiology.sleepDebt = 0;
s.person.physiologyTraits.bodySizeFactor = s.person.physiologyTraits.conditioning = 1;
s.person.skills.veilcraft = 0;
for (const id of ['book-well', 'book-ward']) {
  const book = makeItem(s.world, 'book', id, { owner: s.person.id, holder: s.person.id });
  book.arcaneSource = { version: 1, abilityId: id, kind: 'book' };
  if (learnArcaneSource(s.world, s.person, s.body.id, book.id) !== 'accepted') throw Error('Learning fixture failed');
}
const focus = makeItem(s.world, 'book', 'Isolated flight acceptance focus', { owner: s.person.id, holder: s.person.id });
focus.arcaneFocus = { version: 1, amplitude: 20, aperture: 12, reserve: 320 };
if (changeEquipment(s.world, s.person, focus.id, true, s.body.id) !== 'accepted') throw Error('Equipment fixture failed');
s.world.physicalTime += 200;
arcaneBody(s.world, s.body);
const folder = resolve('.debug', 'universe-release-' + new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(folder, { recursive: true });
const path = resolve(folder, 'world.json');
writeFileSync(path, s.save(), { flag: 'wx' });
const view = canonicalUniverseView(s);
console.log(JSON.stringify({ path, fixture: 'endowed acceptance only', seed: s.world.seed,
  person: s.person.id, body: s.body.id, pos: s.body.pos,
  canExplore: view.campaign.canExplore, flight: view.campaign.flight }, null, 2));
