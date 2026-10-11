import { describe, expect, it } from 'vitest';
import { advancement, beginFloor, emergentClass, finishFloor, finishTrial, levelOf, migrateJourney, newSheet, practice, restoreFloor, reward, startJourney, validJourney, type CapabilitySheet, type Style } from '../src/sim/progression/tower';
import { advancementBlocked, IRON_PRACTICE_SECONDS } from '../src/sim/core/advancement';
import { planFloor } from '../src/web/arena/tower/floorgen';

const fresh = (seed = 7) => { const s = newSheet(); startJourney(s, seed); return s; };
function clear(s: CapabilitySheet, floor: number, damage: number, style: Style = 'blade') {
  const plan = planFloor(s.journey!.seed, floor);
  const targets = plan.foes.map((f, i) => ({ id: `${floor}:${i}`, hp: 100, kind: f.kind, boss: false }));
  if (plan.boss) targets.push({ id: `${floor}:boss`, hp: 600, kind: plan.boss.kind, boss: true });
  expect(beginFloor(s, floor, targets)).toBe(true);
  practice(s, { kind: 'hurt', fraction: damage });
  if (floor === 10) return finishTrial(s);
  for (const t of targets) {
    practice(s, { kind: 'hit', target: t.id, damage: t.hp, style });
    practice(s, { kind: 'kill', target: t.id, style });
  }
  return finishFloor(s, floor);
}
describe('canonical Tower expedition progression', () => {
  it('credits actual loot once, keeps receipts on reload, and cannot turn repeated rewards into advancement', () => {
    const s = fresh(); beginFloor(s, 1, [{ id: 'a', kind: 'goblin', hp: 100, boss: false }]);
    expect(reward(s, 1, 'book#1', { kind: 'tome', element: 'flame' })).toBe(true);
    const restored = JSON.parse(JSON.stringify(s)) as CapabilitySheet;
    expect(reward(restored, 1, 'book#1', { kind: 'tome', element: 'flame' })).toBe(false);
    expect(restored.affinity.flame).toBe(1); expect(restored.history.tomes).toBe(1);
    for (let n = 2; n < 100; n++) reward(restored, 1, `book#${n}`, { kind: 'tome', element: 'flame' });
    expect(restored.history.tomes).toBe(40); expect(advancement(restored).tier).toBe('Normal'); expect(levelOf(restored).level).toBe(1);
    expect(reward(restored, 10, 'fake-trial', { kind: 'trial', element: 'time', forms: [] })).toBe(false);
    expect(validJourney(restored.journey)).toBe(true);
  });
  it('allows practice teaching without granting expedition credit', () => {
    const s = fresh(); startJourney(s, 7, true);
    expect(reward(s, 0, 'demo-form', { kind: 'form', form: 'bolt' })).toBe(true);
    expect(reward(s, 0, 'bad-form', { kind: 'form', form: 'invented' })).toBe(false);
    expect(s.forms).toEqual(['bolt']); expect(emergentClass(s)).toBeNull(); expect(advancement(s).tier).toBe('Normal');
    expect(validJourney(s.journey)).toBe(true);
  });
  it('retains ordinary-world advancement gates and meaningful practice duration', () => {
    expect(IRON_PRACTICE_SECONDS).toBe(7200);
    for (const stage of ['Bronze', 'Silver', 'Gold'] as const) expect(advancementBlocked(stage)).toBe(true);
  });
  it('requires ordered, defeated encounter rosters rather than a floor counter or XP grant', () => {
    const s = fresh();
    expect(beginFloor(s, 99, [])).toBe(false);
    expect(beginFloor(s, 1, [{ id: 'a', kind: 'goblin', hp: 100, boss: false }])).toBe(true);
    expect(finishFloor(s, 1)).toBeNull();
    expect(practice(s, { kind: 'kill', target: 'unregistered', style: 'blade' })).toBe(false);
    expect(beginFloor(s, 1, [])).toBe(false);
    expect(advancement(s).tier).toBe('Normal');
  });
  it('bounds healing-target practice, repeated kills and casting; no duplicate floor rewards', () => {
    const s = fresh(); beginFloor(s, 1, [{ id: 'a', kind: 'goblin', hp: 100, boss: false }]);
    for (let i = 0; i < 10000; i++) { practice(s, { kind: 'hit', target: 'a', damage: 100, style: 'blade' }); practice(s, { kind: 'cast', mana: true, elements: ['flame'] }); }
    expect(s.style.blade).toBe(3); expect(s.manaControl).toBeCloseTo(.3); expect(s.affinity.flame).toBeCloseTo(.12);
    expect(practice(s, { kind: 'kill', target: 'a', style: 'blade' })).toBe(true);
    expect(practice(s, { kind: 'kill', target: 'a', style: 'blade' })).toBe(false);
    expect(finishFloor(s, 1)).not.toBeNull(); const state = JSON.stringify(s);
    expect(finishFloor(s, 1)).toBeNull(); expect(beginFloor(s, 1, [])).toBe(false); expect(JSON.stringify(s)).toBe(state);
  });
  it('preview and arbitrary elapsed time cannot earn ranks', () => {
    const s = fresh(); startJourney(s, 7, true); beginFloor(s, 99, [{ id: 'a', kind: 'boss', hp: 100, boss: true }]);
    expect(practice(s, { kind: 'kill', target: 'a', style: 'blade' })).toBe(false); expect(finishFloor(s, 99)).toBeNull(); expect(advancement(s).tier).toBe('Normal');
    const ordinary = fresh(); beginFloor(ordinary, 1, []);
    expect(practice(ordinary, { kind: 'time', seconds: 999999 })).toBe(false);
    for (let i = 0; i < 100; i++) practice(ordinary, { kind: 'time', seconds: .1 });
    expect(levelOf(ordinary).level).toBe(1); expect(advancement(ordinary).tier).toBe('Normal');
  });
  it('preserves earned history and prevents resetting partial-floor evidence on restore', () => {
    const s = fresh(); clear(s, 1, .3);
    const targets = [{ id: 'old', hp: 120, kind: 'goblin', boss: false }]; beginFloor(s, 2, targets);
    const saved = JSON.parse(JSON.stringify(s)) as CapabilitySheet;
    expect(validJourney(saved.journey)).toBe(true);
    expect(restoreFloor(saved, 2, [{ ...targets[0], id: 'new' }])).toBe(true);
    practice(saved, { kind: 'hit', target: 'new', damage: 80, style: 'blade' });
    expect(restoreFloor(saved, 2, targets)).toBe(false);
    expect(saved.journey!.cleared).toEqual(s.journey!.cleared);
    expect(fresh().history.kills).toBe(0); // death/new climb never inherits practice
  });
  it('migrates legacy equipment-era saves without inventing mastery or losing the attained level', () => {
    const s = newSheet(); expect(migrateJourney(s, 7, 81, 22, 130)).toBe(true);
    expect(levelOf(s)).toMatchObject({ level: 22, xp: 130 });
    expect(advancement(s).tier).toBe('Silver');
    for (let f = 81; f <= 100; f++) clear(s, f, 0);
    expect(advancement(s).tier).toBe('Silver'); expect(migrateJourney(s, 9, 1)).toBe(false);
  });
  it('spaces classes and elemental evolution across demonstrated history', () => {
    const s = fresh(); s.affinity.flame = 5;
    for (let f = 1; f <= 5; f++) clear(s, f, .3);
    expect(emergentClass(s)).toBeNull(); clear(s, 6, .3); expect(emergentClass(s)?.id).toBe('blade');
    for (let f = 7; f <= 18; f++) clear(s, f, .3);
    expect(emergentClass(s)?.id).toBe('blade+flame');
  });
  for (const seed of [1, 7, 918271, 20261008]) for (const style of ['fists', 'blade', 'heavy', 'axe', 'bow'] as Style[]) {
    it(`paces ${style} through all 100 floors for seed ${seed}, with Silver at the summit`, () => {
      const s = fresh(seed), milestones = new Map<number, string>();
      for (let f = 1; f <= 100; f++) { clear(s, f, .35, style); if ([9, 10, 29, 30, 64, 65, 99, 100].includes(f)) milestones.set(f, advancement(s).tier); }
      expect([...milestones.values()]).toEqual(['Normal', 'Iron', 'Iron', 'Bronze', 'Bronze', 'Silver', 'Silver', 'Silver']);
      expect(levelOf(s).level).toBeGreaterThan(15); expect(levelOf(s).level).toBeLessThan(40);
      expect(advancement(s).progress).toBeGreaterThan(.9); expect(validJourney(s.journey)).toBe(true);
    });
  }
  it('earns Gold through exceptional results, not a seed roll; good ordinary results stay Silver', () => {
    for (const seed of [1, 7, 918271]) {
      const exceptional = fresh(seed), ordinary = fresh(seed);
      for (let f = 1; f <= 100; f++) { clear(exceptional, f, .04); clear(ordinary, f, .2); }
      expect(advancement(exceptional).tier).toBe('Gold'); expect(advancement(ordinary).tier).toBe('Silver');
    }
  });
  it('rejects malformed progression snapshots', () => {
    const s = fresh(); clear(s, 1, 0);
    expect(validJourney({ ...s.journey, cleared: [{ ...s.journey!.cleared[0], mastery: Infinity }] })).toBe(false);
    expect(validJourney({ ...s.journey, cleared: [...s.journey!.cleared, ...s.journey!.cleared] })).toBe(false);
    expect(validJourney({ ...s.journey, legacyExperience: NaN })).toBe(false);
  });
});
