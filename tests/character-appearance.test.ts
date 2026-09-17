import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GARMENT_PALETTES, HAIR_COLORS, SILHOUETTE_REQUIRES, SKIN_TONES, agePresentationFor,
  appearanceFromTraits, projectAppearanceTraits, statusForMeans, weatheredColour,
} from '../src/sim/core/appearance';
import type { AppearanceTraits } from '../src/sim/core/appearance';
import { RNG } from '../src/sim/core/rng';
import type { Occupation } from '../src/sim/core/types';
import { deserialize, newWorld, serialize } from '../src/sim/persist/save';
import { CHARACTER_ARCHETYPES } from '../src/sim/world/characterArchetypes';
import { resolveAppearance } from '../src/sim/world/characterAppearance';

const signature = (t: AppearanceTraits) => [
  t.archetype, t.presentation, t.skinTone, t.faceShape, t.hairStyle, t.hairColor, t.eyeColor,
  t.frame, t.stature, t.garmentSilhouette, t.garmentPalette, t.status, [...t.accessories].sort().join('+'),
].join('|');

const OCCUPATIONS: Occupation[] = ['smith', 'baker', 'farmer', 'guard', 'captain', 'priest', 'acolyte',
  'merchant', 'hunter', 'herbalist', 'miller', 'woodcutter', 'elder', 'server', 'innkeeper', 'villager', 'vagrant', 'cook'];

/** A deterministic sample population, standing in for a town the world has not generated yet. */
function samplePopulation(count: number, seed = 4242) {
  const rng = new RNG(seed);
  return Array.from({ length: count }, (_, index) => {
    const gender = rng.chance(0.5) ? 'm' as const : 'f' as const;
    const age = rng.int(6, 79);
    const occupation: Occupation = age < 14 ? 'child' : rng.pick(OCCUPATIONS);
    const wealth = rng.int(0, 320);
    return { age, gender, occupation, wealth, appearance: resolveAppearance({ seed: 77, identity: `resident_${index}`, age, gender, occupation, wealth }) };
  });
}

describe('reference archetypes', () => {
  it('each archetype names a committed reference image and a coherent trait vocabulary', () => {
    expect(CHARACTER_ARCHETYPES.length).toBeGreaterThanOrEqual(5);
    for (const archetype of CHARACTER_ARCHETYPES) {
      expect(existsSync(archetype.reference), `${archetype.id} reference ${archetype.reference}`).toBe(true);
      expect(archetype.referenceNote.length).toBeGreaterThan(40);
      for (const palette of [...archetype.dressPalettes, ...archetype.workPalettes]) {
        expect(GARMENT_PALETTES[palette], `${archetype.id} palette ${palette}`).toBeDefined();
      }
      for (const tone of archetype.skinTones) expect(SKIN_TONES[tone]).toBeDefined();
      for (const colour of archetype.hairColors) expect(HAIR_COLORS[colour]).toBeDefined();
      for (const list of [archetype.dressSilhouettes, archetype.workSilhouettes, archetype.hairStyles, archetype.frames, archetype.statures, archetype.faceShapes, archetype.eyeColors]) {
        expect(list.length).toBeGreaterThan(0);
      }
      expect(archetype.grooming[0]).toBeLessThanOrEqual(archetype.grooming[1]);
    }
  });

  it('covers all five committed reference sheets', () => {
    const referenced = new Set(CHARACTER_ARCHETYPES.map(a => a.reference));
    for (const file of ['hana.png', 'kaito.png', 'shogun.png', 'yuki.png', '-ren-ayami-shiro.png']) {
      expect([...referenced].some(path => path.endsWith(file)), file).toBe(true);
    }
  });

  it('every reference family reaches a large population', () => {
    const seen = new Set(samplePopulation(800).map(p => p.appearance.traits!.archetype));
    for (const archetype of CHARACTER_ARCHETYPES) expect(seen.has(archetype.id), archetype.id).toBe(true);
  });
});

describe('procedural variation', () => {
  it('produces individually distinct people inside recognisable families', () => {
    const population = samplePopulation(300);
    const signatures = new Set(population.map(p => signature(p.appearance.traits!)));
    // Distinct individuals...
    expect(signatures.size).toBeGreaterThan(280);
    // ...but drawn from a bounded set of authored families, not from noise.
    const families = new Set(population.map(p => p.appearance.traits!.archetype));
    expect(families.size).toBeLessThanOrEqual(CHARACTER_ARCHETYPES.length);
    const palettes = new Set(population.map(p => p.appearance.traits!.garmentPalette));
    for (const palette of palettes) expect(GARMENT_PALETTES[palette]).toBeDefined();
  });

  it('dresses a trade in something that trade could be wearing', () => {
    for (const person of samplePopulation(400)) {
      const required = SILHOUETTE_REQUIRES[person.appearance.traits!.garmentSilhouette];
      if (required) expect(required, `${person.occupation}: ${person.appearance.traits!.garmentSilhouette}`).toContain(person.occupation);
    }
  });

  it('keeps children out of adult kit and adult proportions', () => {
    const children = samplePopulation(400).filter(p => p.age < 13);
    expect(children.length).toBeGreaterThan(10);
    for (const child of children) {
      const traits = child.appearance.traits!;
      expect(traits.accessories).not.toContain('beard');
      expect(traits.accessories).not.toContain('scabbard');
      expect(traits.hairStyle).not.toBe('shaved');
      expect(child.appearance.height).toBeLessThan(0.95);
      // A child is dressed out of a household, never out of their own empty purse.
      expect(traits.status).not.toBe('destitute');
    }
  });

  it('wears clothes out by station and by trade', () => {
    const rich = resolveAppearance({ seed: 5, identity: 'rich', age: 40, gender: 'm', occupation: 'merchant', wealth: 600 });
    const poor = resolveAppearance({ seed: 5, identity: 'poor', age: 40, gender: 'm', occupation: 'vagrant', wealth: 1 });
    expect(rich.traits!.status).toBe('noble');
    expect(poor.traits!.status).toBe('destitute');
    expect(poor.traits!.wear).toBeGreaterThan(rich.traits!.wear + 0.4);
    // Wear is visible without a renderer change: it dulls the realized colour.
    expect(weatheredColour(0x7a1a24, 0)).toBe(0x7a1a24);
    expect(weatheredColour(0x7a1a24, 1)).not.toBe(0x7a1a24);
  });
});

describe('determinism and persistence', () => {
  it('is a pure function of world seed and person identity', () => {
    const args = { seed: 12345, identity: 'ashford:rowan', age: 38, gender: 'm' as const, occupation: 'captain' as Occupation, wealth: 90 };
    expect(resolveAppearance(args)).toEqual(resolveAppearance(args));
    expect(signature(resolveAppearance({ ...args, identity: 'ashford:hale' }).traits!)).not.toBe(signature(resolveAppearance(args).traits!));
    expect(signature(resolveAppearance({ ...args, seed: 999 }).traits!)).not.toBe(signature(resolveAppearance(args).traits!));
  });

  it('never draws from the world behaviour streams', () => {
    const { world } = newWorld(31337);
    const before = [world.rng.state(), world.weatherRng.state(), world.demographicRng.state()];
    for (let index = 0; index < 50; index++) {
      resolveAppearance({ seed: world.seed, identity: `probe_${index}`, age: 30, gender: 'f', occupation: 'farmer', wealth: 20 });
    }
    expect([world.rng.state(), world.weatherRng.state(), world.demographicRng.state()]).toEqual(before);
  });

  it('gives every generated resident a persistent description, stable across save and load', () => {
    const { world } = newWorld(24680);
    const before = new Map(world.persons().map(p => [p.id, p.appearance]));
    expect(before.size).toBeGreaterThan(20);
    for (const appearance of before.values()) expect(appearance.traits).toBeDefined();

    const restored = deserialize(serialize(world));
    expect(restored).not.toBeNull();
    const after = restored!.world;
    expect(after.persons().length).toBe(before.size);
    for (const person of after.persons()) {
      // Same person, same face, same clothes — identity survives the reload, not just the colours.
      expect(person.appearance, person.name).toEqual(before.get(person.id));
    }
  });

  it('regenerating the same world reproduces the same faces', () => {
    const first = newWorld(555).world.persons().map(p => `${p.slug ?? p.id}:${signature(p.appearance.traits!)}`);
    const second = newWorld(555).world.persons().map(p => `${p.slug ?? p.id}:${signature(p.appearance.traits!)}`);
    expect(second).toEqual(first);
  });
});

describe('authored characters and canonical derivation', () => {
  it('keeps every authored pin and makes the description agree with it', () => {
    const authored = { skin: 0x6b3f2a, hair: 0xe6e6e6, shirt: 0x8a2a2a, pants: 0x3a3a3a, hatStyle: 'helm' as const, height: 1.05, build: 1.1 };
    const resolved = resolveAppearance({ seed: 8, identity: 'rowan', age: 38, gender: 'm', occupation: 'captain', wealth: 90, authored });
    expect(resolved.skin).toBe(authored.skin);
    expect(resolved.hair).toBe(authored.hair);
    expect(resolved.shirt).toBe(authored.shirt);
    expect(resolved.hatStyle).toBe('helm');
    expect(resolved.traits!.skinTone).toBe('deep');
    expect(resolved.traits!.hairColor).toBe('white');
    expect(GARMENT_PALETTES[resolved.traits!.garmentPalette].primary).toBe(0x8a2a2a);
  });

  it('honours a forced archetype so a named character can be placed in a family', () => {
    for (const archetype of CHARACTER_ARCHETYPES) {
      const resolved = resolveAppearance({ seed: 3, identity: `named_${archetype.id}`, age: 34, gender: archetype.fits.gender?.[0] ?? 'f', occupation: 'traveler', wealth: 40, archetype: archetype.id });
      expect(resolved.traits!.archetype).toBe(archetype.id);
      expect(resolved.traits!.culturalTags).toEqual(archetype.culturalTags);
    }
  });

  it('derives age presentation and role cues at projection time rather than storing them', () => {
    const traits = resolveAppearance({ seed: 1, identity: 'smith', age: 46, gender: 'm', occupation: 'smith', wealth: 80 }).traits!;
    expect(traits).not.toHaveProperty('agePresentation');
    expect(traits).not.toHaveProperty('roleCues');
    const projected = projectAppearanceTraits(traits, 46, 'smith');
    expect(projected.agePresentation).toBe('middle_aged');
    expect(projected.roleCues).toContain('hammer');
    // The same person a quarter-century later needs no regeneration to read as older.
    expect(projectAppearanceTraits(traits, 71, 'smith').agePresentation).toBe('elder');
    expect(agePresentationFor(9)).toBe('child');
    expect(statusForMeans(0)).toBe('destitute');
  });

  it('realizes a trade\'s own kit without storing the trade twice', () => {
    const traits = resolveAppearance({ seed: 2, identity: 'baker', age: 30, gender: 'f', occupation: 'baker', wealth: 40 }).traits!;
    expect(traits.accessories).not.toContain('apron');
    expect(appearanceFromTraits(traits, ['apron']).apron).toBeDefined();
    expect(appearanceFromTraits(traits, []).apron).toBeUndefined();
  });
});
