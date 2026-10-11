import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { RealmGrid } from '../src/sim/world/realms/grid';
import { generateRealmChunk, realmResidency, spawnPoint, portalPoint, CENTER, REALMS } from '../src/sim/world/realms/layout';
import { B } from '../src/sim/physical/blocks';

const spec = { version: 1 as const, seed: 918271 };
describe('connected realm canonical baseline', () => {
  it('projects shared human bodies from canonical identity without adding people or rank truth',()=>{
    const s=new RealmSession(spec.seed),before=s.world.persons().length,view=s.snapshot();
    expect(view.avatar.bodyId).toBe(view.body.id);expect(view.avatar.entityId).toBe(view.person.id);
    expect(view.person.rank).toBe(s.person.ontology.stage);expect(view.avatar.equipment).toEqual([]);
    for(const n of view.residents){expect(n.visual.bodyId).toBe(s.world.primaryBody(n.id)!.id);expect(n.visual.entityId).toBe(n.id);}
    expect(s.world.persons()).toHaveLength(before);
  });
  it('reproduces parcel, district and interior identities independent of load order', () => {
    const a = generateRealmChunk(spec, 'aether', 32, 31);
    generateRealmChunk(spec, 'brass', 3, 6);
    expect(generateRealmChunk(spec, 'aether', 32, 31)).toEqual(a);
    expect(generateRealmChunk({ ...spec, seed: 8 }, 'aether', 32, 31)).not.toEqual(a);
    const b = generateRealmChunk(spec, 'brass', 32, 31);
    expect(a.buildings.every(b => b.roof === 'terrace')).toBe(true);
    expect(b.buildings.every(b => ['gable', 'spire'].includes(b.roof))).toBe(true);
    expect(new Set([...a.buildings, ...b.buildings].map(b => b.id)).size).toBe(8);
    for (const realm of ['aether', 'brass'] as const) {
      const tower = generateRealmChunk(spec, realm, 32, 32).buildings[0];
      expect(tower.windows.some(p => p.z < tower.z && p.y < 8 && p.x + .6 > tower.door.x - 2 && p.x - .6 < tower.door.x + 3)).toBe(false);
    }
  });
  it('keeps roads and collisions continuous at chunk borders, including realm edges', () => {
    const g = new RealmGrid(spec);
    for (const realm of ['aether', 'brass'] as const) for (let z = CENTER - 100; z <= CENTER + 100; z++) {
      const x = REALMS[realm].offset + CENTER + 4;
      expect(g.get(x, 0, z)).toBe(B.Stone); expect(g.isSolidAt(x, 1, z)).toBe(false);
    }
    expect(g.isSolidAt(6145, 1, 100)).toBe(true);
  });
  it('bounds residency and regeneration caches, retaining canonical edits through eviction', () => {
    const session = new RealmSession(spec.seed), g = session.grid;
    g.set(CENTER + 4, 1, CENTER + 4, B.Crate);
    for (let i = 0; i < 250; i++) g.chunk('aether', i % 64, Math.floor(i / 64));
    expect(g.cachedChunks).toBeLessThanOrEqual(128); g.evict();
    expect(g.get(CENTER + 4, 1, CENTER + 4)).toBe(B.Crate);
    const restored = new RealmSession(0, session.save()); restored.grid.evict();
    expect(restored.grid.get(CENTER + 4, 1, CENTER + 4)).toBe(B.Crate);
    expect(restored.world.nav.floorY(CENTER + 4, CENTER + 4)).toBe(2);
    expect(realmResidency(spawnPoint('aether'))).toHaveLength(81);
    expect(realmResidency(spawnPoint('aether')).filter(c => c.lod === 0)).toHaveLength(9);
  });
  it('uses ordinary navigation and rejects wall penetration, including large-step input', () => {
    const s = new RealmSession(); const b = s.grid.chunk('aether', 32, 32).buildings[0];
    expect(s.world.nav.findPath(s.body.pos, { ...portalPoint('aether'), z: portalPoint('aether').z - 2 })).not.toBeNull();
    s.body.pos = { x: b.x + 3, y: 1, z: b.z - .4 };
    for (let i = 0; i < 80; i++) { s.move({ x: 0, z: 1, sprint: true }); s.step(.05); }
    expect(s.body.pos.z).toBeLessThan(b.z); const p = { ...s.body.pos };
    s.step(100); expect(s.body.pos).toEqual(p);
  });
  it('opens a real Tower doorway and permits entry and return on the same body', () => {
    const s = new RealmSession(); const b = s.grid.chunk('aether', 32, 32).buildings[0], id = s.body.id;
    s.body.pos = { x: b.door.x + .5, y: 1, z: b.z - 2 };
    expect(s.grid.isSolidAt(b.door.x, 2, b.z)).toBe(true);
    expect(s.interact()).toContain('open');
    expect(s.grid.isSolidAt(b.door.x, 2, b.z)).toBe(false);
    for (let i = 0; i < 50; i++) { s.move({ x: 0, z: 1, sprint: false }); s.step(.05); }
    expect(s.inTower()).toBe(true); expect(s.body.id).toBe(id);
    for (let i = 0; i < 50; i++) { s.move({ x: 0, z: -1, sprint: false }); s.step(.05); }
    expect(s.inTower()).toBe(false); expect(s.body.id).toBe(id);
  });
  it('preserves canonical identity, inventory and ontology across repeated portal trips and saves', () => {
    let s = new RealmSession(); const id = s.person.id, bodyId = s.body.id, inventory = [...s.person.inventory];
    const ontology = { ...s.person.ontology };
    for (let i = 0; i < 6; i++) {
      const realm = i % 2 ? 'brass' : 'aether'; s.body.pos = { ...portalPoint(realm), z: portalPoint(realm).z - 2 };
      s.interact(); const pending = s.snapshot().pending!;
      expect(s.confirm(pending.id + 1)).toBe(false); expect(s.confirm(pending.id)).toBe(true); expect(s.confirm(pending.id)).toBe(false);
      s = new RealmSession(0, s.save());
      expect(s.person.id).toBe(id); expect(s.body.id).toBe(bodyId); expect(s.person.inventory).toEqual(inventory); expect(s.person.ontology).toEqual(ontology);
    }
    expect(s.world.events.filter(e => e.type === 'realm_crossed')).toHaveLength(6);
  });
  it('cancels transitions on command, disconnect or reload and retains door state', () => {
    let s = new RealmSession(); const b = s.grid.chunk('aether', 32, 32).buildings[0];
    s.world.setDoorOpen(b.door, true, s.person.id);
    s.body.pos = portalPoint('aether'); s.interact(); const pending = s.snapshot().pending!;
    s.cancel(); expect(s.confirm(pending.id)).toBe(false);
    s.interact(); s.stop(); expect(s.snapshot().pending).toBeNull();
    s.interact(); s = new RealmSession(0, s.save());
    expect(s.snapshot().pending).toBeNull(); expect(s.snapshot().realm).toBe('aether');
    expect(s.world.isDoorOpen(b.door)).toBe(true); expect(s.grid.isSolidAt(b.door.x, 2, b.z)).toBe(false);
  });
  it('retains invalid saves instead of silently starting over', () => {
    expect(() => new RealmSession(1, '{')).toThrow();
    const s = new RealmSession(); const saved = JSON.parse(s.save()); expect(saved.version).toBe(31); saved.realmSpec.version = 9;
    expect(() => new RealmSession(1, JSON.stringify(saved))).toThrow();
  });
  it('uses the same bodily incapacity and injury limits while exploring either realm', () => {
    const normal = new RealmSession(), injured = new RealmSession(); injured.body.injuries = { leg: .7 };
    const z = normal.body.pos.z;
    for (const s of [normal, injured]) { s.move({ x: 0, z: -1, sprint: false }); s.step(.05); }
    expect(Math.abs(injured.body.pos.z - z)).toBeLessThan(Math.abs(normal.body.pos.z - z));
    injured.body.pose = 'downed'; injured.body.poseUntil = 40;
    const at = { ...injured.body.pos }; injured.move({ x: 1, z: 0, sprint: true }); injured.step(.05);
    expect(injured.body.pos).toEqual(at); expect(injured.navigate('portal')).toBe(false);
    injured.body.pos = portalPoint('aether'); expect(injured.interact()).toBe('This body cannot interact.');
  });
});
