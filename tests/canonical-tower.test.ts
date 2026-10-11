import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { applyTowerCommand, commitTower, type TowerCommand } from '../src/server/canonicalTower';
import { currentTowerFloor, observeCanonicalTower } from '../src/sim/world/interiors/tower';
import { FoldedRealmGrid } from '../src/sim/world/interiors/grid';
import { performHandInteraction, performContainerTransfer } from '../src/sim/physical/hand';
import { learnArcaneSource } from '../src/sim/physical/arcana/runtime';
import { trialGoal } from '../src/sim/social/combatTrial';
import { deserialize } from '../src/sim/persist/save';
import { B } from '../src/sim/physical/blocks';
import { portalPoint } from '../src/sim/world/realms/layout';
import { TowerController } from '../src/server/towerController';
import { recoverDownedBody } from '../src/sim/physical/recovery';
import { applyInteractionMovement } from '../src/sim/physical/interactionMovement';

let seq = 0;
function command(s: RealmSession, type: TowerCommand['type']): TowerCommand {
  return { id: `tower-test-${++seq}`, type, revision: s.world.canonicalTower?.revision ?? 0, runId: s.world.canonicalTower?.id };
}
function atrium(s: RealmSession, realm: 'aether' | 'brass' = 'aether') {
  const tower = s.grid.chunk(realm, 32, 32).buildings[0]; s.world.setDoorOpen(tower.door, true, s.person.id);
  s.body.pos = { x: tower.door.x + .5, y: 1, z: tower.z + 4.5 };
}
function entered() { const s = new RealmSession(); atrium(s); applyTowerCommand(s, command(s, 'enter')); return s; }
const plan = (s: RealmSession) => (s.grid as FoldedRealmGrid).interior(currentTowerFloor(s.world)!.interiorId);
/** Receipt fixture invokes canonical hit application; this is not timing or playability evidence. */
function down(s: RealmSession, id: string) {
  const body = s.world.body(id)!; s.sim.applyHit(s.person, s.body, body, 1000, 'injure'); observeCanonicalTower(s.world);
}

describe('host-owned physical Tower', () => {
  it('requires the real atrium and preserves identity, injuries, inventory and rank', () => {
    const s = new RealmSession(); expect(() => applyTowerCommand(s, command(s, 'enter'))).toThrow('atrium'); atrium(s);
    const person = s.person, body = s.body, inv = [...person.inventory], rank = structuredClone(person.ontology); body.health -= 9;
    applyTowerCommand(s, command(s, 'enter'));
    expect(s.person).toBe(person); expect(s.body).toBe(body); expect(person.inventory).toEqual(inv); expect(person.ontology).toEqual(rank);
    expect(body.health).toBe(body.maxHealth - 9); expect(body.pos).toEqual(plan(s).start);
    expect(s.snapshot().canonicalTower?.active).toBe(true); expect(s.navigate('portal')).toBe(false);
  });
  it('preserves geometry, ordinary edits, injuries, finite items and consent through reload', () => {
    let s = entered(); const before = structuredClone(plan(s)), floor = structuredClone(currentTowerFloor(s.world)!);
    s.grid.set(Math.floor(before.start.x), 0, Math.floor(before.start.z), B.Planks); s.body.health = 37;
    s = new RealmSession(0, s.save());
    expect(plan(s)).toEqual(before); expect(currentTowerFloor(s.world)).toEqual(floor); expect(s.body.health).toBe(37);
    expect(s.grid.get(Math.floor(before.start.x), 0, Math.floor(before.start.z))).toBe(B.Planks);
    s.grid.evict(); expect(plan(s)).toEqual(before);
    expect(s.world.person(s.world.body(floor.enemyBodyIds[0])!.ownerId)?.combatTrial?.sourceEventId).toBe(floor.agreementEventId);
  });
  it('uses finite ordinary pickup and source learning, not an entry stat grant', () => {
    const s = entered(), f = currentTowerFloor(s.world)!;
    expect(performHandInteraction(s.sim, s.person, `take:${f.sourceItemIds[0]}`)).toBe('accepted');
    expect(learnArcaneSource(s.world, s.person, s.body.id, f.sourceItemIds[0])).toBe('accepted');
    expect(s.person.arcana?.learned['book-ember'].itemId).toBe(f.sourceItemIds[0]);
    expect(s.world.item(f.sourceItemIds[0])?.holderId).toBe(s.person.id);
    expect(s.world.item(f.rewardItemIds[0])?.ownerId).toBe(f.placeId);
  });
  it('requires fresh perception and clear sight for a normal trial attack goal', () => {
    const s = entered(), b = s.world.body(currentTowerFloor(s.world)!.enemyBodyIds[0])!, p = s.world.person(b.ownerId)!;
    b.pos = { ...s.body.pos, z: s.body.pos.z - 3 }; p.mind.percepts = [];
    expect(trialGoal(s.world, p, b)).toBeNull();
    p.mind.percepts = [{ entityId: s.person.id, bodyId: s.body.id, tick: s.world.now, how: 'saw', pos: { ...s.body.pos }, distance: 3 }];
    expect(trialGoal(s.world, p, b)?.type).toBe('attack');
    p.mind.percepts[0].tick -= 2; expect(trialGoal(s.world, p, b)).toBeNull();
  });
  it('runs ordinary NPC perception/planning into physical combat on one shared clock', () => {
    const s = entered(), f = currentTowerFloor(s.world)!, rival = s.world.body(f.enemyBodyIds[0])!;
    // Placement is an explicit unit fixture, not an observed traversal.
    rival.pos = { ...s.body.pos, z: s.body.pos.z - 3 };
    rival.yaw = Math.PI; // The player is in front of this explicit perception fixture.
    const controller = new TowerController(s); controller.bind('tower-test');
    const start = s.world.physicalTime, worldStart = s.world.now;
    for (let step = 0; step < 60 * 15; step++) controller.step();
    expect(s.world.physicalTime - start).toBeCloseTo(15, 6); expect(s.world.now - worldStart).toBeCloseTo(15, 5);
    expect(s.world.events.some(e => e.type === 'goal_changed' && e.actor === rival.ownerId && e.data.to === 'attack')).toBe(true);
    expect(s.world.events.some(e => e.type === 'attack' && f.enemyBodyIds.some(id => s.world.body(id)?.ownerId === e.actor) && e.target === s.person.id)).toBe(true);
    expect(s.body.health).toBeLessThan(s.body.maxHealth);
    const restored = new RealmSession(0, s.save()); expect(restored.body.health).toBe(s.body.health);
    const next = new TowerController(restored); next.bind('tower-resumed'); next.step();
    expect(restored.world.physicalTime).toBeCloseTo(s.world.physicalTime + 1 / 60, 6);
  });
  it('releases an expired knockdown on controlled bodies without releasing custody or erasing injury', () => {
    const s = entered(); s.body.pose = 'downed'; s.body.health = 1; s.body.poseUntil = 1; s.body.injuries = { arm: .4 };
    const host = new TowerController(s); host.bind('recovery-test');
    for (let i = 0; i < 66; i++) host.step();
    expect(s.body.pose).toBe('stand'); expect(s.body.health).toBeGreaterThanOrEqual(24); expect(s.body.injuries.arm).toBeCloseTo(.4, 3);
    s.body.pose = 'downed'; s.person.surrender = { toId: 'p_6', at: s.world.now, reason: 'test fixture' };
    expect(recoverDownedBody(s.world, s.body)).toBe(false); expect(s.body.pose).toBe('downed');
  });
  it('binds sleep/wake to the current body and preserves sleep across reload', () => {
    let s = entered(), host = new TowerController(s), binding = host.bind('rest-controller');
    const request = { version: 2, type: 'command', ...binding, sequence: 0, commandId: 'rest-at-entrance', clientTimeMs: 0, command: { type: 'rest' } };
    expect(host.bridge.receiveCommand({ ...request, bodyId: 'wrong-body' })?.result).toBe('binding_mismatch');
    expect(host.bridge.receiveCommand(request)?.status).toBe('received');
    for (let n = 0; n < 6; n++) host.step(); expect(s.body.pose).toBe('sleep');
    for (let n = 1; n < 120; n++) {
      host.bridge.receiveCommand({ ...request, sequence: n, commandId: `idle-while-sleeping-${n}`, command: { type: 'move', x: 0, z: 0, sprint: false } });
      host.step();
    }
    expect(s.body.pose).toBe('sleep');
    // Direct movement callers (including realm locomotion) also preserve incapacity;
    // the bridge's own command rejection must not be the only protection.
    s.body.poseUntil = 0;
    applyInteractionMovement(s.world, s.person, s.body, { x: 0, z: 0, sprint: false }, 1 / 60);
    expect(s.body.pose).toBe('sleep');
    const save = s.save(); s = new RealmSession(0, save); expect(s.body.pose).toBe('sleep');
    host = new TowerController(s); binding = host.bind('rest-resumed');
    expect(host.bridge.receiveCommand(request)?.result).toBe('binding_mismatch');
    expect(host.bridge.receiveCommand({ ...request, ...binding, commandId: 'wake-at-entrance', command: { type: 'wake' } })?.status).toBe('received');
    host.step(); expect(s.body.pose).toBe('stand');
  });
  it('credits actual individual defeats once across recovery/reload and awards existing stock', () => {
    let s = entered(), f = currentTowerFloor(s.world)!; const itemCount = s.world.items().length;
    down(s, f.enemyBodyIds[0]); expect(f.defeats).toHaveLength(1); expect(f.clearEventId).toBeUndefined();
    s = new RealmSession(0, s.save()); f = currentTowerFloor(s.world)!;
    const retired = s.world.body(f.enemyBodyIds[0])!; retired.pose = 'stand'; retired.health = 20;
    expect(trialGoal(s.world, s.world.person(retired.ownerId)!, retired)).toBeNull();
    for (const id of f.enemyBodyIds.slice(1)) down(s, id);
    expect(f.clearEventId).toBeTruthy(); expect(s.world.items()).toHaveLength(itemCount);
    expect(s.world.container(f.rewardContainerId)?.ownerId).toBe(s.person.id);
    observeCanonicalTower(s.world); expect(s.world.events.filter(e => e.type === 'tower_floor_cleared')).toHaveLength(1);
    s = new RealmSession(0, s.save()); expect(currentTowerFloor(s.world)?.clearEventId).toBe(f.clearEventId);
    expect(() => applyTowerCommand(s, command(s, 'ascend'))).toThrow('stair');
    s.body.pos = { ...plan(s).exit };
    expect(performHandInteraction(s.sim, s.person, `open:${f.rewardContainerId}`)).toBe('accepted');
    for (const id of f.rewardItemIds) expect(performContainerTransfer(s.sim, s.person, f.rewardContainerId, id, 'out')).toBe('accepted');
    expect(learnArcaneSource(s.world, s.person, s.body.id, f.rewardItemIds[0])).toBe('accepted');
    s = new RealmSession(0, s.save()); expect(s.person.arcana?.learned['book-ward']).toBeTruthy();
    applyTowerCommand(s, command(s, 'ascend'));
    expect(s.world.canonicalTower?.floor).toBe(2); expect(s.body.pos).toEqual(plan(s).start);
    expect(new RealmSession(0, s.save()).world.canonicalTower?.floors).toHaveLength(2);
  });
  it('returns and crosses the realm portal with the same person and resumes the same floor', () => {
    let s = entered(); const identity = s.person.id, inv = [...s.person.inventory], id = s.world.canonicalTower!.id;
    applyTowerCommand(s, command(s, 'return')); expect(s.inTower()).toBe(true);
    s.body.pos = portalPoint('aether'); s.interact(); expect(s.confirm(s.snapshot().pending!.id)).toBe(true);
    atrium(s, 'brass'); applyTowerCommand(s, command(s, 'enter')); s = new RealmSession(0, s.save());
    expect(s.person.id).toBe(identity); expect(s.person.inventory).toEqual(inv); expect(s.world.canonicalTower?.id).toBe(id);
    applyTowerCommand(s, command(s, 'return')); expect(s.snapshot().realm).toBe('brass');
  });
  it('avoids an occupied landing and retains the floor when the whole landing is blocked', () => {
    const s = entered(), run = s.world.canonicalTower!;
    const blocker = s.world.bodies().find(b => b.id !== s.body.id)!; blocker.pos = { ...run.returnPos };
    const pass = commitTower(s, command(s, 'return'), () => {}); expect(pass.error).toBeUndefined();
    expect(s.world.distance2d(s.body.pos, blocker.pos)).toBeGreaterThanOrEqual(.7);
    const blocked = entered(), active = blocked.world.canonicalTower!;
    for (let x = Math.floor(active.returnPos.x) - 2; x <= Math.floor(active.returnPos.x) + 2; x++)
      for (let z = Math.floor(active.returnPos.z) - 2; z <= Math.floor(active.returnPos.z) + 2; z++) blocked.grid.set(x, 1, z, B.Stone);
    const result = commitTower(blocked, command(blocked, 'return'), () => { throw Error('must not write an obstructed crossing'); });
    expect(result.error).toContain('landing is obstructed');
    expect(result.session.world.canonicalTower?.active).toBe(true);
    expect(result.session.world.canonicalTower?.revision).toBe(active.revision);
    expect(result.session.body.pos).toEqual(plan(blocked).start);
  });
  it('rejects forged clearance, missing sources, wrong identity and an old-reader overlay', () => {
    const s = entered(), raw = JSON.parse(s.save());
    for (const mutate of [(r: any) => r.canonicalTower.bodyId = 'b_missing', (r: any) => r.version = 29,
      (r: any) => r.canonicalTower.floors[0].clearEventId = r.canonicalTower.openedEventId,
      (r: any) => r.canonicalTower.floors[0].rewardItemIds[0] = 'missing',
      (r: any) => r.interiors.descriptors[0].seed++]) {
      const changed = structuredClone(raw); mutate(changed); expect(deserialize(JSON.stringify(changed))).toBeNull();
    }
  });
  it('persists idempotent commands and rolls back all entry changes on disk failure', () => {
    let s = new RealmSession(); atrium(s); const c = command(s, 'enter'), count = s.world.persons().length;
    const fail = commitTower(s, c, () => { throw Error('disk full'); }); s = fail.session;
    expect(fail.error).toContain('disk full'); expect(s.world.persons()).toHaveLength(count); expect(s.world.canonicalTower).toBeUndefined();
    let raw = ''; const pass = commitTower(s, c, x => { raw = x; }); expect(pass.error).toBeUndefined(); s = new RealmSession(0, raw);
    expect(applyTowerCommand(s, c).id).toBe(s.world.canonicalTower?.id);
    expect(() => applyTowerCommand(s, { ...c, type: 'return' })).toThrow('different data');
    expect(() => applyTowerCommand(s, { ...command(s, 'return'), revision: 0 })).toThrow('changed');
  });
});
