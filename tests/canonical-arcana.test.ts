import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { makeItem } from '../src/sim/world/factory';
import { arcaneBody, cancelArcaneCast, learnArcaneSource, requestArcaneCast, stepArcana } from '../src/sim/physical/arcana/runtime';
import { changeEquipment } from '../src/sim/physical/equipment';
import { movementState } from '../src/sim/physical/interactionMovement';
import { deserialize } from '../src/sim/persist/save';
import { B } from '../src/sim/physical/blocks';
import type { Person } from '../src/sim/core/types';

function fixture() {
  const s = new RealmSession(917);
  const target = s.world.persons().find(p => p.id !== s.person.id)!;
  const tb = s.world.primaryBody(target.id)!;
  s.body.pos = { x: 3120.5, y: 1, z: 3092.5 }; s.body.yaw = Math.PI;
  tb.pos = { x: 3120.5, y: 1, z: 3095.5 }; tb.health = tb.maxHealth;
  for (const p of [s.person, target]) { p.physiology.energy = p.physiology.hydration = 1; p.physiology.fatigue = 0; }
  return { s, target, tb };
}
function book(s: RealmSession, abilityId: string, p: Person = s.person, kind: 'book' | 'essence' | 'scroll' = 'book') {
  const item = makeItem(s.world, 'book', abilityId, { owner: p.id, holder: p.id });
  item.arcaneSource = { version: 1, abilityId, kind }; return item;
}
function learn(s: RealmSession, id: string, p = s.person) {
  const i = book(s, id, p); expect(learnArcaneSource(s.world, p, s.world.primaryBody(p.id)!.id, i.id)).toBe('accepted'); return i;
}
function resolve(s: RealmSession, seconds = 2) {
  s.world.physicalTime += seconds; s.world.clock.advance(seconds);
  stepArcana(s.world, (p, b, target, damage, intent, e) => s.sim.applyHit(p, b, target, damage, intent, undefined, e));
}

describe('canonical source-backed arcana', () => {
  it('requires a real held source, preserves learning across reload and does not reward repeated reading', () => {
    let { s } = fixture(); const i = book(s, 'book-ember');
    expect(requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember' })).toBe('unknown_ability');
    i.holderId = null; expect(learnArcaneSource(s.world, s.person, s.body.id, i.id)).toBe('invalid_source'); i.holderId = s.person.id;
    expect(learnArcaneSource(s.world, s.person, s.body.id, i.id)).toBe('accepted');
    const count = s.world.events.length; s = new RealmSession(0, s.save());
    expect(learnArcaneSource(s.world, s.person, s.body.id, i.id)).toBe('accepted');
    expect(s.world.events.length).toBe(count); expect(s.world.item(i.id)!.quantity).toBe(1);
    expect(s.person.arcana!.learned['book-ember'].applications).toBe(0);
  });
  it('resolves contact after the windup, produces causal injury, and persists without a replayed hit', () => {
    let { s, tb } = fixture(); learn(s, 'book-ember'); const hp = tb.health;
    expect(requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember', target: tb.pos })).toBe('accepted');
    expect(tb.health).toBe(hp); const cast = s.body.arcana!.cast!;
    resolve(s, .2); expect(tb.health).toBe(hp);
    s = new RealmSession(0, s.save()); tb = s.world.body(tb.id)!; resolve(s, .4);
    expect(tb.health).toBeLessThan(hp); expect(tb.injuries!.torso).toBeGreaterThan(0);
    const hit = s.world.events.find(e => e.type === 'attack' && e.causes.includes(cast.eventId)); expect(hit).toBeDefined();
    const after = tb.health; s = new RealmSession(0, s.save()); resolve(s, .5);
    expect(s.world.body(tb.id)!.health).toBe(after); expect(s.person.arcana!.learned['book-ember'].applications).toBe(1);
  });
  it('rechecks obstacles and target movement at impact instead of accepting client hit claims', () => {
    const { s, tb } = fixture(); learn(s, 'book-ember'); const hp = tb.health;
    expect(requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember', target: tb.pos })).toBe('accepted');
    for (let y = 1; y <= 4; y++) s.grid.set(3120, y, 3094, B.Stone);
    resolve(s); expect(tb.health).toBe(hp); expect(s.person.arcana!.learned['book-ember'].applications).toBe(0);
    expect(s.body.arcana!.mana).toBeLessThan(100);
  });
  it('cancellation retains costs and cooldowns, while interrupted casts cannot land later', () => {
    const { s, tb } = fixture(); learn(s, 'book-ember'); const hp = tb.health;
    requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember', target: tb.pos });
    expect(cancelArcaneCast(s.world, s.body)).toBe(true); expect(cancelArcaneCast(s.world, s.body)).toBe(false);
    resolve(s, .5); expect(tb.health).toBe(hp);
    expect(requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember', target: tb.pos })).toBe('cooldown');
    resolve(s, 3); requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember', target: tb.pos });
    s.body.lastHitAt = s.world.physicalTime + .2; resolve(s, .6); expect(tb.health).toBe(hp);
  });
  it('uses the same rules for NPCs and consumes a finite scroll once even across reload', () => {
    let { s, target, tb } = fixture(); const i = book(s, 'scroll-mend', target, 'scroll'); tb.health = 30; tb.injuries = { arm: .5 };
    expect(requestArcaneCast(s.world, target, { bodyId: tb.id, abilityId: 'scroll-mend', scrollItemId: i.id })).toBe('accepted');
    expect(i.quantity).toBe(0); s = new RealmSession(0, s.save()); resolve(s);
    expect(s.world.body(tb.id)!.health).toBeGreaterThan(30); expect(s.world.body(tb.id)!.injuries!.arm).toBe(.5);
    expect(requestArcaneCast(s.world, s.world.person(target.id)!, { bodyId: tb.id, abilityId: 'scroll-mend', scrollItemId: i.id })).toBe('invalid_source');
  });
  it('physical equipment absorbs real impact and a ward is finite; a mesh/catalog label grants neither', () => {
    const { s, target, tb } = fixture(); const armor = makeItem(s.world, 'armor', 'Practice cuirass', { holder: target.id, owner: target.id });
    armor.physicalArmor = { version: 1, coverage: ['torso'], absorption: 8 };
    expect(changeEquipment(s.world, target, armor.id, true, tb.id)).toBe('accepted');
    const hp = tb.health; s.sim.applyHit(s.person, s.body, tb, 20); expect(tb.health).toBe(hp - 12); expect(armor.condition).toBeLessThan(1);
    learn(s, 'book-ward', target); requestArcaneCast(s.world, target, { bodyId: tb.id, abilityId: 'book-ward' }); resolve(s);
    const before = tb.health; s.sim.applyHit(s.person, s.body, tb, 20); expect(tb.health).toBe(before);
    s.sim.applyHit(s.person, s.body, tb, 50); expect(tb.health).toBeLessThan(before);
    const restored = new RealmSession(0, s.save()); expect(restored.world.item(armor.id)!.condition).toBe(armor.condition);
  });
  it('slowing is embodied and expires on canonical time; treatment never revives or erases injury', () => {
    const { s, tb, target } = fixture(); learn(s, 'book-sigil');
    const speed = movementState(s.world, target, tb).speed;
    requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-sigil', target: tb.pos }); resolve(s);
    expect(movementState(s.world, target, tb).speed).toBeLessThan(speed); resolve(s, 5);
    expect(movementState(s.world, target, tb).speed).toBe(speed);
    learn(s, 'book-mend', target); tb.dead = true;
    expect(requestArcaneCast(s.world, target, { bodyId: tb.id, abilityId: 'book-mend' })).toBe('incapacitated');
  });
  it('rejects corrupt reserves, forged source history and unsupported old-reader components', () => {
    const { s } = fixture(); learn(s, 'book-ember'); arcaneBody(s.world, s.body);
    const raw = JSON.parse(s.save()); raw.bodies.find((b: any) => b.id === s.body.id).arcana.mana = 100000;
    expect(deserialize(JSON.stringify(raw))).toBeNull();
    const other = JSON.parse(s.save()); other.persons.find((p: any) => p.id === s.person.id).arcana.learned['book-ember'].eventId = 'invented';
    expect(deserialize(JSON.stringify(other))).toBeNull();
    const old = JSON.parse(s.save()); old.version = 27; expect(deserialize(JSON.stringify(old))).toBeNull();
  });
  it('reproduces accepted ordered inputs from the same seed', () => {
    const run = () => { const { s, tb } = fixture(); learn(s, 'book-ember'); requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ember', target: tb.pos }); resolve(s); return { body: tb, events: s.world.events, mana: s.body.arcana!.mana }; };
    expect(run()).toEqual(run());
  });
  it('pins learned sources and active effects through history compaction', () => {
    const { s } = fixture(); learn(s, 'book-ward');
    requestArcaneCast(s.world, s.person, { bodyId: s.body.id, abilityId: 'book-ward' }); resolve(s, .6);
    const source = s.person.arcana!.learned['book-ward'].eventId, cast = s.body.arcana!.cast!.eventId;
    for (let n = 0; n < 100; n++) s.world.emit('arcane_resolved', { significance: 0, category: 'world', summary: 'Unreferenced compaction fixture' });
    s.world.compactEvents(10);
    expect(s.world.event(source)).toBeDefined(); expect(s.world.event(cast)).toBeDefined();
    expect(new RealmSession(0, s.save()).body.arcana!.effects[0].kind).toBe('ward');
  });
});
