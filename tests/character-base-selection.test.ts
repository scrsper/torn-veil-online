import { describe, expect, it } from 'vitest';
import { resolveCharacterBase } from '../src/web/actors/characterBaseSelection';
import { sharedHeroLook, sharedLook } from '../src/web/actors/sharedCast';
import { RealmSession } from '../src/sim/world/realms/session';
import type { BodyState } from '../src/web/net/messages';

const body = (changes: Partial<BodyState> = {}): BodyState => ({
  bodyId: 'body-a', entityId: 'person-a', presentationSex: 'f', presentationSpecies: 'human',
  appearance: { description: { presentation: 'feminine', agePresentation: 'adult' } },
  ...changes,
} as BodyState);

describe('canonical character base selection (asset-independent)', () => {
  it('uses canonical sex consistently for the player and residents even when appearance differs', () => {
    const input = body({ presentationSex: 'm' });
    expect(resolveCharacterBase(input).bodyPreset).toBe('male');
    expect(sharedHeroLook(input)).toBe('ranger');
    expect(['ranger', 'brann', 'soldier', 'archer', 'mystic']).toContain(sharedLook(input));
  });

  it('routes both adult bases for human/elf without claiming elf artwork or loading a model', () => {
    for (const race of ['human', 'elf']) for (const sex of ['f', 'm'] as const) {
      const selection = resolveCharacterBase(body({ presentationSpecies: race, presentationSex: sex }));
      expect(selection).toMatchObject({ race, bodyPreset: sex === 'f' ? 'female' : 'male', eligible: true });
      expect(selection.elfArtworkSupported).toBe(false);
    }
  });

  it('never guesses unknown species, missing sex or adult status, and excludes minors', () => {
    for (const race of [undefined, 'orc', 'dwarf', 'Human', '']) {
      expect(resolveCharacterBase(body({ presentationSpecies: race }))).toMatchObject({ eligible: false, reason: 'unsupported-species' });
      expect(sharedHeroLook(body({ presentationSpecies: race, presentationSex: 'm' }))).toBe('wren'); // Existing out-of-scope fallback unchanged.
    }
    for (const agePresentation of ['child', 'adolescent', '', 'unknown']) {
      const input = body(); input.appearance!.description!.agePresentation = agePresentation;
      expect(resolveCharacterBase(input)).toMatchObject({ eligible: false, reason: 'not-confirmed-adult' });
    }
    expect(resolveCharacterBase(body({ appearance: undefined })).eligible).toBe(false);
    const input = body({ presentationSex: undefined });
    input.appearance!.description!.presentation = 'androgynous';
    expect(resolveCharacterBase(input)).toMatchObject({ eligible: false, reason: 'unknown-body-preset' });
  });

  it('falls back to explicit appearance sex and produces stable independent identity seeds without mutation', () => {
    const input = body({ presentationSex: undefined });
    const before = structuredClone(input), first = resolveCharacterBase(input);
    expect(first.bodyPreset).toBe('female');
    expect(resolveCharacterBase(structuredClone(input))).toEqual(first);
    expect(resolveCharacterBase(body({ entityId: 'person-b', bodyId: 'body-b' })).variationSeed).not.toBe(first.variationSeed);
    expect(input).toEqual(before);
  });

  it('projects actual species on player and every resident without changing canonical people', () => {
    const session = new RealmSession(918271);
    const before = session.save(), snapshot = session.snapshot();
    expect(snapshot.residents.length).toBeGreaterThan(0);
    for (const visual of [snapshot.avatar, ...snapshot.residents.map(r => r.visual)]) {
      const person = session.world.person(visual.entityId)!;
      expect(visual.presentationSpecies).toBe(person.species);
      expect(visual.presentationSex).toBe(person.gender);
    }
    // The projector may refresh recognition caches, but never canonical identity.
    const restored = new RealmSession(0, before);
    expect(session.world.persons().map(p => [p.id, p.species, p.gender, p.age]))
      .toEqual(restored.world.persons().map(p => [p.id, p.species, p.gender, p.age]));
  });
});
