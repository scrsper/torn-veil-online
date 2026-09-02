import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/core/world';
import { generateVillage } from '../src/sim/world/village';

describe('world history integrity', () => {
  it('keeps every causal reference traversable after event compaction', () => {
    const world = new World(71);
    const root = world.emit('attack', { summary: 'root', significance: 1 });
    const perceived = world.emit('perceived', { causes: [root.id], summary: 'perceived', significance: 0.1 });
    const knowledge = world.emit('knowledge_gained', { causes: [perceived.id], summary: 'knowledge', significance: 0.1 });
    const response = world.emit('confrontation', { causes: [knowledge.id], summary: 'response', significance: 0.8 });
    for (let i = 0; i < 10; i++) world.emit('memory_formed', { summary: `noise ${i}`, significance: 0.01 });

    world.compactEvents(4);

    for (const event of world.events) {
      expect(event.causes.every(id => world.event(id))).toBe(true);
      expect(event.effects.every(id => world.event(id))).toBe(true);
    }
    expect(world.event(response.id)?.causes).toContain(root.id);
    expect(world.event(root.id)?.effects).toContain(response.id);
  });

  it('models important deceased people as semantic persons with no present bodies', () => {
    const world = new World(72);
    const generated = generateVillage(world);
    for (const key of ['anna', 'lissa', 'tam', 'mira']) {
      const person = generated.people[key];
      expect(person, `${key} should be a semantic person`).toBeDefined();
      expect(person.alive).toBe(false);
      expect(person.bodies).toEqual([]);
      expect(world.primaryBody(person.id)).toBeUndefined();
    }

    const anna = generated.people.anna;
    const lissa = generated.people.lissa;
    const tam = generated.people.tam;
    const mira = generated.people.mira;
    expect(world.events.some(e => e.type === 'marriage' && e.actor === generated.people.cedric.id && e.target === anna.id)).toBe(true);
    expect(world.events.some(e => e.type === 'death' && e.target === anna.id)).toBe(true);
    expect(world.events.some(e => e.type === 'death' && e.target === lissa.id)).toBe(true);
    expect(world.events.some(e => e.type === 'death' && e.target === tam.id)).toBe(true);
    expect(world.events.some(e => e.type === 'death' && e.target === mira.id)).toBe(true);
    for (const item of world.items()) for (const entry of item.provenance) {
      if (entry.from) expect(world.get(entry.from), `unknown provenance source ${entry.from}`).toBeDefined();
      if (entry.to) expect(world.get(entry.to), `unknown provenance destination ${entry.to}`).toBeDefined();
    }
  });
});
