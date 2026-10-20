import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { advanceRecoil } from '../src/sim/physical/recoil';
import { meleeSpacing, applyMeleeSpacing } from '../src/sim/mind/meleeSpacing';
import { requestCombatAction } from '../src/sim/physical/combatAction';
import { B } from '../src/sim/physical/blocks';
import { deserialize } from '../src/sim/persist/save';
import { BridgeSession } from '../src/bridge/session';

function fixture() {
  const s = new RealmSession(424), w = s.world;
  const people = w.persons().filter(p => p.id !== s.person.id), p = people[0], b = w.primaryBody(p.id)!, other = people[1], ob = w.primaryBody(other.id)!;
  s.body.pos = { x: 3120.5, y: 1, z: 3092.5 }; s.body.yaw = Math.PI;
  b.pos = { x: 3120.5, y: 1, z: 3093.5 }; b.yaw = 0;
  ob.pos = { x: 3121.5, y: 1, z: 3093.5 };
  return { s, w, p, b, other, ob };
}
function step(s: RealmSession, dt: number) { s.world.physicalTime += dt; advanceRecoil(s.world, dt); }

describe('canonical physical contact response', () => {
  it('moves a contacted body once, with the same consumed response after mid-flight reload', () => {
    const { s, b } = fixture(); s.sim.applyHit(s.person, s.body, b, 7, 'injure');
    const hp = b.health, start = { ...b.pos }; step(s, .08);
    expect(b.pos.z).toBeGreaterThan(start.z); expect(b.recoil!.consumed).toBeGreaterThan(0);
    const loaded = new RealmSession(0, s.save());
    step(s, .16); step(loaded, .16);
    expect(loaded.world.body(b.id)!.pos).toEqual(b.pos); expect(b.recoil).toBeUndefined();
    const settled = { ...b.pos }; step(loaded, 2);
    expect(loaded.world.body(b.id)!.pos).toEqual(settled); expect(loaded.world.body(b.id)!.health).toBe(hp);
  });
  it('cannot push through a solid wall or open a door', () => {
    const { s, b } = fixture(); b.pos.z = 3093.6;
    for (let y = 1; y < 4; y++) s.grid.set(3120, y, 3094, B.Stone);
    s.sim.applyHit(s.person, s.body, b, 90, 'injure'); step(s, .24);
    expect(b.pos.z).toBeLessThan(3094); expect(s.grid.get(3120, 1, 3094)).toBe(B.Stone);
  });
  it('retains response through controller velocity resets and does not require a renderer', () => {
    const { s, b } = fixture();
    const bridge = new BridgeSession(0, { state: { world: s.world, sim: s.sim }, defaultPlayer: false });
    bridge.openChannel('contact-review', s.person.id); bridge.bindInteraction('contact-review', 'contact-review');
    const start = { ...s.body.pos }; s.sim.applyHit(s.world.person(b.ownerId)!, b, s.body, 7, 'injure');
    for (let n = 0; n < 20; n++) bridge.stepAll();
    expect(s.body.pos.z).toBeLessThan(start.z); expect(s.body.recoil).toBeUndefined();
  });
  it('rejects fabricated residual source/geometry and still reads pre-response saves', () => {
    const { s, b } = fixture(); s.sim.applyHit(s.person, s.body, b, 7);
    const raw = JSON.parse(s.save()), saved = raw.bodies.find((x: any) => x.id === b.id);
    saved.recoil.offset.x = 999; expect(deserialize(JSON.stringify(raw))).toBeNull();
    const legacy = JSON.parse(s.save()); legacy.version = 28; for (const body of legacy.bodies) { delete body.recoil; delete body.encounter; }
    expect(deserialize(JSON.stringify(legacy))).not.toBeNull();
  });
  it('does not displace a fully absorbed contact', () => {
    const { s, b } = fixture(); s.sim.applyHit(s.person, s.body, b, 0); expect(b.recoil).toBeUndefined();
  });
});

describe('perception-backed melee spacing', () => {
  it('waits on an observed commitment and physically guards/repositions through ordinary movement', () => {
    const { s, w, p, b, ob } = fixture(); b.pos.z += 1;
    requestCombatAction(w, { attackerId: ob.ownerId, attackerBodyId: ob.id, targetBodyId: s.body.id, attackMode: 'strike' });
    p.mind.percepts = [{ entityId: ob.ownerId, bodyId: ob.id, how: 'saw', tick: w.now, pos: { ...ob.pos }, distance: 2 }];
    const start = { ...b.pos }; expect(meleeSpacing(w, p, b, s.body).reason).toBe('observed_commitment');
    expect(applyMeleeSpacing(w, p, b, s.body, .05)).toBe(true);
    expect(b.pos).not.toEqual(start); expect(b.guard!.until).toBeGreaterThan(w.physicalTime);
    w.physicalTime += 1;
    expect(meleeSpacing(w, p, b, s.body).hold).toBe(false);
  });
  it('does not inspect unseen, stale, heard-only or occluded commitments', () => {
    const { s, w, p, b, ob } = fixture();
    requestCombatAction(w, { attackerId: ob.ownerId, attackerBodyId: ob.id, targetBodyId: s.body.id, attackMode: 'strike' });
    expect(meleeSpacing(w, p, b, s.body).hold).toBe(false);
    const sight = { entityId: ob.ownerId, bodyId: ob.id, how: 'saw' as const, tick: w.now, pos: { ...ob.pos }, distance: 2 };
    p.mind.percepts = [{ ...sight, how: 'heard' }]; expect(meleeSpacing(w, p, b, s.body).hold).toBe(false);
    p.mind.percepts = [{ ...sight, tick: w.now - 3 }]; expect(meleeSpacing(w, p, b, s.body).hold).toBe(false);
    p.mind.percepts = [sight]; for (let y = 1; y < 4; y++) w.grid.set(3121, y, 3093, B.Stone);
    expect(meleeSpacing(w, p, b, s.body).hold).toBe(false);
  });
  it('allows simultaneous attacks from clear approaches; no player immunity or global attacker slot', () => {
    const { s, w, p, b, ob } = fixture();
    p.mind.percepts = [{ entityId: ob.ownerId, bodyId: ob.id, how: 'saw', tick: w.now, pos: { ...ob.pos }, distance: 2 }];
    expect(meleeSpacing(w, p, b, s.body).hold).toBe(false);
    expect(requestCombatAction(w, { attackerId: p.id, attackerBodyId: b.id, targetBodyId: s.body.id, attackMode: 'strike' }).attempted).toBe(true);
    expect(requestCombatAction(w, { attackerId: ob.ownerId, attackerBodyId: ob.id, targetBodyId: s.body.id, attackMode: 'strike' }).attempted).toBe(true);
  });
});
