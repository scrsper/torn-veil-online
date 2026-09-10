import { describe, expect, it } from 'vitest';
import { attributeProfile } from '../src/sim/core/human';
import { inheritPotential, MAX_IMPRINT_DISTANCE } from '../src/sim/core/lineage';
import { develop } from '../src/sim/core/development';
import { giveBirth } from '../src/sim/world/demographics';
import { genealogyKey, genealogicalBeliefs, inferGenealogy, inferSurnameKin, genealogyGoals } from '../src/sim/mind/genealogy';
import { actOnRecord, teachNotation } from '../src/sim/mind/records';
import { learn } from '../src/sim/mind/knowledge';
import { makeItem } from '../src/sim/world/factory';
import { Simulation } from '../src/sim/mind/agent';
import { deserialize, serialize, newWorld } from '../src/sim/persist/save';
import type { Person, Action } from '../src/sim/core/types';
import type { World } from '../src/sim/core/world';
import { createTestWorld, addPerson, v } from './helpers/world';

const newborn = (world: World, a: Person, b: Person) => {
  a.physiology.pregnancy = { gestationalParentId: a.id, otherParentId: b.id, conceivedAt: world.now - 280 * 86400, dueAt: world.now, state: 'gestating', lastProgressAt: world.now };
  return giveBirth(world, a)!;
};
function family() {
  const tw = createTestWorld(71), pos = tw.world.place(tw.places.tavern)!.inside;
  const a = addPerson(tw, 'Ancestor Vale', 'villager', pos), b = addPerson(tw, 'Partner Ash', 'villager', pos);
  a.attributePotential = b.attributePotential = attributeProfile(10);
  // A fixture transformation; independent development tests create one through sustained activity.
  const ev = tw.world.emit('lineage_imprint', { actor: a.id, category: 'history', significance: 0.95 });
  a.lineage.imprints.push({ id: ev.id, originPersonId: a.id, attribute: 'strength', magnitude: 2, originatingEventId: ev.id, transmissibility: 0.85, generationDistance: 0, transmissionEventId: ev.id });
  return { tw, a, b };
}

describe('bounded canonical inheritance and fallible known ancestry', () => {
  it('transmits one origin through hidden carriers, diverges between siblings and never ratchets the base', () => {
    const { tw, a, b } = family();
    const children = Array.from({ length: 24 }, () => newborn(tw.world, a, b));
    const carrier = children.find(c => c.lineage.imprints.length && c.lineage.expressed.strength === 0)!;
    expect(carrier).toBeDefined();
    const grandchildren = Array.from({ length: 30 }, () => newborn(tw.world, carrier, b));
    expect(grandchildren.some(c => c.lineage.expressed.strength > 0)).toBe(true);
    expect(grandchildren.some(c => c.lineage.expressed.strength === 0)).toBe(true);
    for (const c of grandchildren) {
      expect(c.attributePotential.strength - c.lineage.expressed.strength).toBe(10);
      expect(c.lineage.expressed.strength).toBeLessThanOrEqual(2);
      expect(c.lineage.imprints.every(i => i.generationDistance === 2 && i.originPersonId === a.id)).toBe(true);
      expect(genealogicalBeliefs(c)).toHaveLength(0);
    }
    // Both parents carrying one origin still transmit it once, along one causal path.
    const coCarrier = children.find(c => c.id !== carrier.id && c.lineage.imprints.length)!;
    const child = newborn(tw.world, carrier, coCarrier);
    expect(new Set(child.lineage.imprints.map(i => i.id)).size).toBe(child.lineage.imprints.length);
    expect(() => inheritPotential(tw.world, child, carrier, coCarrier, child.lineage.birthEventId!)).toThrow('already fixed');
    for (let i = 0; i < 80; i++) tw.world.emit('weather', { actor: b.id });
    tw.world.compactEvents(10);
    expect(tw.world.event(carrier.lineage.imprints[0].originatingEventId)!.type).toBe('lineage_imprint');
    carrier.lineage.imprints[0].generationDistance = MAX_IMPRINT_DISTANCE;
    expect(newborn(tw.world, carrier, b).lineage.imprints).toHaveLength(0);
  });
  it('discovers an unknown ancestor by reading a physical record, without changing inherited potential', () => {
    const { tw, a, b } = family(), { world } = tw;
    const children = Array.from({ length: 16 }, () => newborn(world, a, b));
    const parent = children.find(c => c.lineage.imprints.length && !c.lineage.expressed.strength)!;
    parent.age = 25; // Controlled generational fixture, not a claim of intervening simulation.
    const grandchildren = Array.from({ length: 30 }, () => newborn(world, parent, b));
    const child = grandchildren.find(c => c.lineage.expressed.strength > 0)!; child.age = 18;
    expect(genealogicalBeliefs(child)).toHaveLength(0);
    const signature = JSON.stringify([child.attributePotential, child.lineage]);
    const knownParent = parent.knowledge[genealogyKey({ subjectId: child.id, relativeId: parent.id, relationship: 'parent' })];
    tw.sim.tell(parent, child, knownParent);
    inferGenealogy(world, child);
    expect(genealogicalBeliefs(child).some(k => k.claim.genealogy.relativeId === a.id)).toBe(false);
    const key = genealogyKey({ subjectId: parent.id, relativeId: a.id, relationship: 'parent' });
    teachNotation(world, a); teachNotation(world, child);
    const place = world.place(a.homeId)!; place.ownerId = a.id;
    makeItem(world, 'plank', 'record substrate', { owner: a.id, placeId: place.id, pos: place.inside, quantity: 1 });
    const write: Action = { type: 'write_record', status: 'pending', placeId: place.id, data: { key } };
    actOnRecord(world, a, write, 60); expect(write.status).toBe('done');
    const record = world.items().find(i => i.record)!;
    record.ownerId = child.id; record.holderId = child.id; child.inventory.push(record.id);
    const read: Action = { type: 'read_record', status: 'pending', data: { recordId: record.id } };
    actOnRecord(world, child, read, 60); expect(read.status).toBe('done');
    expect(child.knowledge[key].source.type).toBe('read'); expect(child.knowledge[key].source.from).toBe(record.id);
    expect(world.event(child.knowledge[key].source.viaEvent!)!.causes).toContain(record.record!.eventId);
    inferGenealogy(world, child);
    const discovered = genealogicalBeliefs(child).find(k => k.claim.genealogy.relativeId === a.id && k.claim.genealogy.subjectId === child.id)!;
    expect(discovered.claim.genealogy.relationship).toBe('ancestor'); expect(discovered.source.type).toBe('inferred');
    expect(discovered.claim.premises).toContain(key);
    expect(JSON.stringify([child.attributePotential, child.lineage])).toBe(signature);
  });
  it('offers immediate family testimony through social goals, never through a newborn ancestry copy', () => {
    const { tw, a, b } = family(), child = newborn(tw.world, a, b);
    a.mind.percepts = [{ entityId: child.id, bodyId: child.bodies[0], pos: tw.world.positionOf(child.id)!, distance: 1, how: 'saw', tick: tw.world.now }];
    expect(genealogyGoals(tw.world, a)).toHaveLength(0);
    child.age = 4;
    expect(genealogyGoals(tw.world, a).some(g => g.type === 'share_family')).toBe(true);
    const k = a.knowledge[genealogyKey({ subjectId: child.id, relativeId: a.id, relationship: 'parent' })];
    tw.sim.tell(a, child, k);
    expect(child.knowledge[k.key].source).toMatchObject({ type: 'told', from: a.id });
    expect(child.parentIds).toEqual([a.id, b.id]);
  });
  it('preserves uncertain and mistaken testimony, while surname inference never certifies ancestry', () => {
    const { tw, a } = family(); const child = addPerson(tw, 'Another Vale', 'villager', tw.world.positionOf(a.id)!);
    child.relationships[a.id] = { affection: 0.2, trust: 0.2, respect: 0, fear: 0, grudge: 0, familiarity: 0.5, tags: [], lastUpdated: tw.world.now };
    inferSurnameKin(tw.world, child, a);
    const belief = genealogicalBeliefs(child)[0]; expect(belief.claim.genealogy.relationship).toBe('possible_kin'); expect(belief.confidence).toBe(0.2);
    const g = { subjectId: child.id, relativeId: a.id, relationship: 'parent' as const };
    const rumor = learn(tw.world, a, { key: genealogyKey(g), kind: 'fact', claim: { genealogy: g }, confidence: 0.4, source: { type: 'prior' } })!;
    tw.sim.tell(a, child, rumor); expect(child.knowledge[rumor.key].confidence).toBeLessThan(0.4);
    expect(child.parentIds).not.toContain(a.id);
    tw.world.primaryBody(child.id)!.pos = v(2, 1, 2);
    expect(genealogyGoals(tw.world, a)).toHaveLength(0);
  });
  it('exactly continues development, inheritance RNG, beliefs and provenance after save/load', () => {
    const { world, gen } = newWorld(1907), a = gen.people.greta, b = gen.people.alwin;
    a.physiology.energy = a.physiology.hydration = 1;
    develop(world, a, { weights: { strength: 1, intellect: 0.5 }, seconds: 500, intensity: 1 });
    const child = newborn(world, a, b);
    const loaded = deserialize(serialize(world))!.world;
    expect(loaded.person(a.id)!.development).toEqual(a.development);
    expect(loaded.person(child.id)!.lineage).toEqual(child.lineage);
    for (const w of [world, loaded]) {
      w.clock.worldSeconds += 86400;
      develop(w, w.person(a.id)!, { weights: { strength: 1 }, seconds: 1000, intensity: 1 });
      newborn(w, w.person(a.id)!, w.person(b.id)!);
    }
    const clean = (w: World) => { const data = JSON.parse(serialize(w)); delete data.savedAt; return data; };
    expect(clean(loaded)).toEqual(clean(world));
  });
});
