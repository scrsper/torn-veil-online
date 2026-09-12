import { describe, expect, it } from 'vitest';
import { ecologyScenario, advanceEcology, ecologySnapshot } from '../src/headless/ecology/scenarios';
import { animalAlive, createAnimal, ageDays, isMature, attachAnimalBody } from '../src/sim/ecology/animals';
import { stepWildlife } from '../src/sim/ecology/simulation';
import { reproductiveEligibility } from '../src/sim/ecology/lifecycle';
import { ecologyQueries, senseResources } from '../src/sim/ecology/sensing';
import { consumeEcologicalResource } from '../src/sim/world/ecologyResources';
import { maintainResourceNodes } from '../src/sim/world/resources';
import { makeBody } from '../src/sim/world/factory';
import { B } from '../src/sim/physical/blocks';
import { SECONDS_PER_DAY as DAY } from '../src/sim/core/time';
import { buildChronicle } from '../src/sim/history/chronicle';

describe('embodied ecology', () => {
  it('healthy habitat sustains embodied founders and paid, parented births', () => {
    const w = ecologyScenario(701);
    advanceEcology(w, 100);
    const state = ecologySnapshot(w);
    expect(state.alive).toBeGreaterThanOrEqual(8);
    expect(state.born).toBeGreaterThan(0);
    expect(state.forageKg).toBeGreaterThan(0);
    for (const c of w.creatures().filter(c => c.wildlife!.parentIds.length)) {
      expect(w.get(c.wildlife!.parentIds[0])).toBeDefined();
      expect(w.body(c.bodies[0])?.ownerId).toBe(c.id);
      expect(c).not.toHaveProperty('mind');
    }
  }, 60000);

  it('overcrowding depletes real plants and suppresses births before starvation and recovery', () => {
    const w = ecologyScenario(702, 48, { foodKg: 5 });
    // The stream is impassable to this locomotion profile. Count its actual feeding bank.
    w.resourceNodes = w.resourceNodes.filter(n => n.kind === 'surface_water' || n.pos.x < 24);
    const feedingBank = w.resourceNodes.filter(n => n.kind === 'forage');
    for (const n of feedingBank) n.capacity = n.remaining = 5 / feedingBank.length;
    advanceEcology(w, 3);
    expect(ecologySnapshot(w).forageKg).toBeLessThan(1);
    advanceEcology(w, 17);
    const state = ecologySnapshot(w);
    expect(state.alive).toBeLessThan(24);
    expect(state.deaths.starvation).toBeGreaterThan(0);
    expect(state.born).toBe(0);
    // Recovery is only the existing per-node renewal, independent of animal count/controller.
    const before = state.forageKg;
    w.clock.worldSeconds += 30 * DAY;
    maintainResourceNodes(w);
    expect(ecologySnapshot(w).forageKg).toBeGreaterThan(before + 3);
    expect(ecologySnapshot(w).forageKg).toBeCloseTo(5, 2);
    expect(w.events.some(e => e.type === 'ecology_changed')).toBe(true);
    expect(buildChronicle(w).some(e => w.event(e.eventId)?.type === 'food_consumed')).toBe(false);
  }, 60000);

  it('thirst drives searching and inaccessible water causes dehydration deaths', () => {
    const w = ecologyScenario(703, 6, { water: false });
    advanceEcology(w, 3);
    expect(w.creatures().some(c => Object.values(c.wildlife!.embodiments).some(e => e.activity === 'seek_water'))).toBe(true);
    expect(ecologySnapshot(w).meanHydration).toBeLessThan(0.4);
    advanceEcology(w, 7);
    expect(ecologySnapshot(w).deaths.dehydration).toBeGreaterThan(0);
    expect(w.events.filter(e => e.type === 'water_consumed')).toHaveLength(0);
  }, 60000);

  it('spatial food/water choice moves animals toward viable ground, within physical speed', () => {
    const w = ecologyScenario(704, 0), c = createAnimal(w, 'field_hare', { x: 8.5, y: 1, z: 24.5 });
    const b = w.body(c.bodies[0])!, e = c.wildlife!.embodiments[b.id];
    w.resourceNodes = w.resourceNodes.filter(n => n.kind === 'surface_water' || n.pos.x >= 20);
    e.physiology.hydration = 0.32;
    const start = { ...b.pos };
    w.clock.worldSeconds += 900;
    stepWildlife(w, 0.5, 900);
    expect(Math.hypot(b.pos.x - start.x, b.pos.z - start.z)).toBeLessThanOrEqual(0.9);
    advanceEcology(w, 2);
    expect(b.pos.x).toBeGreaterThan(16);
    expect(e.waterLitres).toBeGreaterThan(0);
    expect(e.physiology.hydration).toBeGreaterThan(0.3);
  });

  it('bounded sensing cannot reveal a remote source or feed through a wall', () => {
    const w = ecologyScenario(705, 0, { size: 100 });
    const c = createAnimal(w, 'field_hare', { x: 8.5, y: 1, z: 8.5 }), b = w.body(c.bodies[0])!;
    expect(senseResources(w, ecologyQueries(w), b, w.ecology!.species.field_hare).some(n => n.kind === 'surface_water')).toBe(false);
    const node = w.resourceNodes.find(n => n.kind === 'forage' && n.pos.x === 8.5 && n.pos.z === 8.5)!;
    node.pos.x = 9.5;
    w.grid.set(9, 1, 8, B.Stone); w.grid.set(9, 2, 8, B.Stone);
    expect(consumeEcologicalResource(w, b, node, 1)).toBe(0);
  });

  it('water intake is finite, depletes its actual voxel, and cannot invent a replacement', () => {
    const w = ecologyScenario(706, 0), node = w.resourceNodes.find(n => n.kind === 'surface_water')!;
    const c = createAnimal(w, 'field_hare', node.pos), b = w.body(c.bodies[0])!;
    node.remaining = 0.1;
    expect(consumeEcologicalResource(w, b, node, 5)).toBe(0.1);
    expect(node.remaining).toBe(0);
    const voxel = node.blocks[0]; expect(w.grid.get(voxel.x, voxel.y, voxel.z)).toBe(B.Air);
    expect(consumeEcologicalResource(w, b, node, 5)).toBe(0);
    expect(consumeEcologicalResource(w, b, { ...node, remaining: 1000, state: 'available' }, 5)).toBe(0);
    w.clock.worldSeconds += 365 * DAY; maintainResourceNodes(w);
    expect(node.remaining).toBe(0);
  });

  it('maturation and old age are calendar-derived and preserve historical identity', () => {
    const w = ecologyScenario(707, 0), spec = w.ecology!.species.field_hare;
    const c = createAnimal(w, spec.id, { x: 20.5, y: 1, z: 20.5 }, { ageDays: 0, sex: 'female' });
    expect(isMature(c, spec, 0)).toBe(false);
    // Algebraic boundary checks without accelerating the biological profile.
    expect(ageDays(c, spec.lifecycle.maturityDays * DAY)).toBe(spec.lifecycle.maturityDays);
    expect(isMature(c, spec, spec.lifecycle.maturityDays * DAY)).toBe(true);
    c.wildlife!.bornAt = -spec.lifecycle.maturityDays * DAY;
    c.wildlife!.senescenceAt = 900;
    advanceEcology(w, 900 / DAY);
    expect(animalAlive(w, c)).toBe(false);
    expect(w.get(c.id)).toBe(c);
    expect(w.body(c.bodies[0])?.dead).toBe(true);
    expect(ecologySnapshot(w).deaths.old_age).toBe(1);
  });

  it('reproduction requires condition, actual local resources and a physically present mature mate', () => {
    const w = ecologyScenario(708, 2), female = w.creatures()[0], b = w.body(female.bodies[0])!, spec = w.ecology!.species.field_hare;
    let q = ecologyQueries(w), seen = senseResources(w, q, b, spec);
    expect(reproductiveEligibility(w, female, b, spec, seen, q)).toBe(true);
    female.wildlife!.embodiments[b.id].physiology.energy = 0.1;
    expect(reproductiveEligibility(w, female, b, spec, seen, q)).toBe(false);
    female.wildlife!.embodiments[b.id].physiology.energy = 0.9;
    for (const n of w.resourceNodes) if (n.kind === 'forage') n.remaining = 0;
    q = ecologyQueries(w); seen = senseResources(w, q, b, spec);
    expect(reproductiveEligibility(w, female, b, spec, seen, q)).toBe(false);
  });

  it('seeds repeat exactly and diverge in plausible histories', () => {
    const a = ecologyScenario(710), b = ecologyScenario(710), c = ecologyScenario(711);
    for (const w of [a, b, c]) advanceEcology(w, 55);
    expect(a.creatures()).toEqual(b.creatures());
    expect(a.resourceNodes).toEqual(b.resourceNodes);
    expect(a.creatures()).not.toEqual(c.creatures());
    expect(ecologySnapshot(a).alive).toBeGreaterThan(0); expect(ecologySnapshot(c).alive).toBeGreaterThan(0);
    expect(a.events.filter(e => e.type === 'animal_born').map(e => e.tick)).not.toEqual(c.events.filter(e => e.type === 'animal_born').map(e => e.tick));
  }, 60000);

  it('each manifestation has its own reserves and death does not kill another body', () => {
    const w = ecologyScenario(712, 1), c = w.creatures()[0], first = w.body(c.bodies[0])!;
    const second = makeBody(w, c.id, { x: 10.5, y: 1, z: 10.5 }, 'quadruped'); attachAnimalBody(w, c, second);
    const e = c.wildlife!.embodiments[first.id]; e.physiology.hydration = 0; e.dehydrationHours = 30;
    first.pos = { x: 2.5, y: 1, z: 2.5 };
    advanceEcology(w, 900 / DAY);
    expect(first.dead).toBe(true); expect(second.dead).toBe(false); expect(animalAlive(w, c)).toBe(true);
  });
});
