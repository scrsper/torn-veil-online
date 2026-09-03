import { describe, expect, it } from 'vitest';
import { DialogueSystem } from '../src/sim/mind/dialogue';
import { Simulation } from '../src/sim/mind/agent';
import { learn } from '../src/sim/mind/knowledge';
import { remember } from '../src/sim/mind/memory';
import { adjustRel, getRel } from '../src/sim/mind/relationships';
import { newWorld } from '../src/sim/persist/save';
import { makeItem } from '../src/sim/world/factory';
import { SECONDS_PER_DAY, SECONDS_PER_HOUR } from '../src/sim/core/time';
import { addPerson, createTestWorld, step, v } from './helpers/world';

describe('existing core simulation', () => {
  it('starts cognition, follows schedules, and physically moves villagers', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    const garrick = gen.people.garrick;
    const start = { ...world.primaryBody(garrick.id)!.pos };
    for (let elapsed = 0; elapsed < 3; elapsed += 0.05) {
      const dt = 0.05; const worldDt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, worldDt);
    }

    const active = world.persons().filter(person => person.alive && !person.controlled);
    expect(active.length).toBeGreaterThan(25);
    expect(active.every(person => person.mind.goal && person.mind.decision)).toBe(true);
    expect(garrick.mind.goal?.type).toBe('work');
    expect(world.distance2d(start, world.primaryBody(garrick.id)!.pos)).toBeGreaterThan(1);
    expect(world.events.some(event => event.type === 'goal_changed' && event.actor === garrick.id)).toBe(true);
  });

  it('does not repeatedly complete meals while already satiated', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    const brigid = gen.people.brigid;
    const body = world.primaryBody(brigid.id)!;
    const home = world.place(brigid.homeId)!;
    world.clock.worldSeconds = 100 * SECONDS_PER_DAY + 9 * SECONDS_PER_HOUR + 20 * 60;
    body.pos = { ...home.inside }; brigid.needs.hunger = 0.01;

    for (let elapsed = 0; elapsed < 20; elapsed += 0.05) {
      const worldDt = world.clock.advance(0.05); world.physicalTime += 0.05; sim.step(0.05, worldDt);
    }

    expect(world.events.filter(event => event.type === 'meal' && event.actor === brigid.id)).toHaveLength(1);
  });

  it('keeps memories structured and bounded', () => {
    const tw = createTestWorld(111, 12);
    const person = addPerson(tw, 'Rememberer', 'farmer', v(3.5, 1, 3.5));
    for (let i = 0; i < 75; i++) remember(tw.world, person, { type: 'observed', summary: `memory ${i}`, entities: [person.id], significance: i / 100, valence: -0.2, source: { type: 'witnessed' } }, true);
    expect(person.memories).toHaveLength(60);
    expect(person.memories.every(memory => memory.id && memory.source.type === 'witnessed' && Array.isArray(memory.entities))).toBe(true);
    expect(person.memories.some(memory => memory.summary === 'memory 0')).toBe(false);
  });

  it('keeps relationships directional', () => {
    const tw = createTestWorld(112, 12);
    const a = addPerson(tw, 'A', 'farmer', v(3.5, 1, 3.5));
    const b = addPerson(tw, 'B', 'farmer', v(4.5, 1, 3.5));
    adjustRel(tw.world, a, b.id, { trust: -0.5, grudge: 0.4 }, 'test');
    expect(getRel(a, b.id)).toMatchObject({ trust: -0.5, grudge: 0.4 });
    expect(b.relationships[a.id]).toBeUndefined();
  });

  it('routes pickup, drop, and gift through consistent item state and semantic events', () => {
    const tw = createTestWorld(113, 12);
    const a = addPerson(tw, 'A', 'farmer', v(3.5, 1, 3.5));
    const b = addPerson(tw, 'B', 'farmer', v(4.5, 1, 3.5));
    const item = makeItem(tw.world, 'flowers', 'flowers', { pos: v(3.5, 1, 4.5) });
    const pickup = tw.sim.takeItem(a, item, 'pickup');
    expect(item).toMatchObject({ ownerId: a.id, holderId: a.id, pos: null, placeId: null });
    expect(a.inventory).toContain(item.id);
    expect(pickup.type).toBe('pickup');

    tw.sim.dropItem(a, item, v(4.5, 1, 4.5));
    expect(item).toMatchObject({ ownerId: a.id, holderId: null, pos: v(4.5, 1, 4.5) });
    expect(item.provenance.at(-1)).toMatchObject({ from: a.id, to: null, how: 'dropped' });

    tw.sim.takeItem(a, item, 'pickup');
    const gift = tw.sim.giveItem(a, b, item);
    expect(gift.type).toBe('gift');
    expect(item).toMatchObject({ ownerId: b.id, holderId: b.id, pos: null });
    expect(a.inventory).not.toContain(item.id);
    expect(b.inventory).toContain(item.id);
  });

  it('grounds dialogue in the NPC relationship, knowledge, and memory', () => {
    const tw = createTestWorld(114, 12);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(3.5, 1, 3.5), { controlled: true });
    const guard = addPerson(tw, 'Guard', 'guard', v(4.5, 1, 3.5));
    const victim = addPerson(tw, 'Tomas Reed', 'apprentice', v(5.5, 1, 3.5));
    learn(tw.world, guard, { key: 'ev:crime', kind: 'event', claim: { eventId: 'crime', type: 'attack', actor: player.id, target: victim.id, significance: 0.7 }, confidence: 0.8, source: { type: 'told', from: victim.id }, hops: 1 }, true);
    remember(tw.world, guard, { type: 'told', summary: `${victim.name} told me the Traveler attacked him`, eventId: 'crime', entities: [player.id, victim.id], significance: 0.7, source: { type: 'told', from: victim.id } }, true);
    adjustRel(tw.world, guard, player.id, { trust: -0.6, grudge: 0.5 }, 'credible report', undefined, true);

    const dialogue = new DialogueSystem(tw.world, tw.sim).start(guard, player);
    expect(dialogue.lines.join(' ')).toContain('what you did to Tomas Reed');
    const opinion = dialogue.options.find(option => option.label === 'What do you think of me?')!.next()!;
    expect(opinion.lines.join(' ')).toContain('I remember');
    expect(opinion.lines.join(' ')).toContain('Tomas Reed told me');
  });
});
