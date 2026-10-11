import { describe, expect, it } from 'vitest';
import { ALL_ELEMENTS, ALL_FORMS, ELEMENT_INFO, FORMS, REACTIONS, spellFor } from '../src/web/arena/magic';

describe('tower magic: element x form', () => {
  it('has ten elements and eight forms, giving eighty distinct named spells', () => {
    expect(ALL_ELEMENTS).toHaveLength(10); expect(ALL_FORMS).toHaveLength(8);
    const spells = ALL_ELEMENTS.flatMap(e => ALL_FORMS.map(f => spellFor(e, f)));
    expect(new Set(spells.map(s => s.id)).size).toBe(80);
    expect(new Set(spells.map(s => s.name)).size).toBe(80);
    for (const s of spells) { expect(s.mana).toBeGreaterThan(0); expect(s.riders).toEqual([s.element]); expect(s.kernel).toBe(FORMS[s.form as keyof typeof FORMS].kernel); }
  });

  it('is deterministic and names elements by their display names', () => {
    expect(spellFor('storm', 'bolt')).toEqual(spellFor('storm', 'bolt'));
    expect(spellFor('storm', 'bolt').name).toBe('Lightning Bolt');
    expect(spellFor('time', 'field').name).toBe('Stasis Field');
    expect(ELEMENT_INFO.swift.name).toBe('Wind'); expect(ELEMENT_INFO.iron.name).toBe('Earth');
  });

  it('makes time the costliest element and documents the reactions', () => {
    expect(spellFor('time', 'bolt').mana!).toBeGreaterThan(spellFor('flame', 'bolt').mana!);
    expect(REACTIONS.map(r => r.result)).toEqual(expect.arrayContaining(['Electrocute', 'Freeze', 'Shatter', 'Steam', 'Wildfire', 'Crush', 'Rupture']));
  });
});
