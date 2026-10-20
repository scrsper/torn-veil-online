import type { Item, ItemType, Person } from '../../sim/core/types';
import { World } from '../../sim/core/world';
import { attributeProfile } from '../../sim/core/human';
import { makeBody, makeCreature, makeItem, makePerson, ITEM_DAMAGE } from '../../sim/world/factory';
import { equipTrialKit } from '../../sim/world/interiors/trialKit';
import { towerEncounter } from '../../sim/progression/towerEncounters';
import { TRANSFORMATIONS } from '../../sim/physical/arcana/growth';
import { WILDLIFE_SPECIES } from '../../sim/ecology/species';
import { creatureThreat, itemGrade, personThreat } from '../../sim/progression/threat';
import {
  defeatXp, EMBODIED_TRIALS, floorLevel, LEVELED_RANKS, peakXp, PRACTICE_XP_PER_HOUR, VESSELS, xpToNext, type LeveledRank,
} from '../../sim/progression/levels';

/** Deterministic calibration report for the level curve and threat scale. Every row is computed
 * from the same functions the simulation uses, on real entities built for the report only.
 * Constructed fixtures (ladder capacities, embodied foundations) are labelled as such. */
export function levelingReport() {
  const w = new World(1);
  const origin = w.emit('tower_entered', { summary: 'leveling report fixture' });
  const person = (name: string, attrs = 8, maxHealth = 80) => {
    const p = makePerson(w, { name, gender: 'f', age: 30, occupation: 'traveler', traits: {}, appearance: {}, bio: 'report fixture' });
    p.attributes = attributeProfile(attrs); const b = makeBody(w, p.id, { x: 0, y: 1, z: 0 }, 'humanoid', maxHealth); p.bodies.push(b.id);
    return { p, b };
  };
  const curve = LEVELED_RANKS.map(rank => {
    const floor = floorLevel(rank);
    let before = 0; for (let l = 1; l < floor; l++) before += xpToNext(l);
    return { rank, levels: `${floor}-${floor + 9}`, firstLevelXp: xpToNext(floor), lastLevelXp: xpToNext(floor + 9), peakXp: peakXp(rank),
      cumulativeAtFloor: before, sameLevelDefeatsPerLevel: Math.round(xpToNext(floor + 5) / defeatXp(floor + 5, floor + 5)),
      practiceHoursForPeak: Math.round(peakXp(rank) / PRACTICE_XP_PER_HOUR), vessel: VESSELS[rank] };
  });
  const species = Object.values(WILDLIFE_SPECIES).map(spec => {
    const c = makeCreature(w, spec.id, spec.name, null, null); c.wildlife = { bornAt: 0, sex: 'female', parentIds: [], senescenceAt: 1e12, nextBreedAt: 1e12, pregnancy: null, embodiments: {} };
    const b = makeBody(w, c.id, { x: 0, y: 1, z: 0 }, spec.bodyPlan.shape, 100); c.bodies.push(b.id);
    const t = creatureThreat(w, c, b); return { species: spec.id, level: t.level, grade: t.grade, power: round(t.power) };
  });
  const items: { item: string; level: number; grade: string; power: number }[] = (['dagger', 'stoneaxe', 'hammer', 'axe', 'sword'] as ItemType[]).map(type => {
    const i = { type, damage: ITEM_DAMAGE[type], quantity: 1, condition: 1 } as Item, g = itemGrade(i)!;
    return { item: type, level: g.level, grade: g.grade, power: round(g.power) };
  });
  for (const floor of [1, 10, 25, 50, 75, 100]) {
    const k = { physicalArmor: { version: 1 as const, coverage: ['torso', 'arm'] as ('torso' | 'arm')[], absorption: 2 + floor * .4 }, quantity: 1, condition: 1 } as Item;
    const g = itemGrade(k)!; items.push({ item: `warden harness (floor ${floor})`, level: g.level, grade: g.grade, power: round(g.power) });
    const amp = 1 + Math.max(0, floor - 12) * .1, ap = 1 + Math.max(0, floor - 25) / 50;
    const f = itemGrade({ arcaneFocus: { version: 1, amplitude: amp, aperture: ap, reserve: 100 }, quantity: 1, condition: 1 } as Item)!;
    items.push({ item: `warden focus (floor ${floor})`, level: f.level, grade: f.grade, power: round(f.power) });
  }
  const reference = person('Reference adult'), guard = person('Sword guard', 10, 110);
  const sword = makeItem(w, 'sword', 'guard sword', { owner: guard.p.id, holder: guard.p.id });
  const people: { who: string; level: number; grade: string; power: number }[] = [
    { who: 'ordinary adult (8s, unarmed, 80 HP)', ...pick(personThreat(w, reference.p, reference.b)) },
    { who: `guard (10s, ${sword.name}, 110 HP)`, ...pick(personThreat(w, guard.p, guard.b)) },
  ];
  // Real authored warden kits, equipped exactly as a Tower floor equips them.
  const wardens = [1, 5, 10, 25, 50, 75, 100].map(floor => {
    const levels = [0, 1, 2].map(index => { const x = person(`Warden ${floor}:${index}`); equipTrialKit(w, x.p, x.b, floor, index, origin.id); return personThreat(w, x.p, x.b).level; });
    return { floor, enemies: towerEncounter(floor).enemies, levels, max: Math.max(...levels) };
  });
  // Constructed capacity fixtures: what each implemented source rank plus its vessel can do.
  const ladder = (['Normal', ...TRANSFORMATIONS.map(t => t.stage)] as LeveledRank[]).map(stage => {
    const x = person(`Source ${stage}`), t = TRANSFORMATIONS.find(r => r.stage === stage);
    x.p.arcana = { version: 1, learned: { 'book-ember': { eventId: origin.id, itemId: 'fixture', applications: 0 }, 'ess-bone': { eventId: origin.id, itemId: 'fixture', applications: 0 } },
      ...(t ? { growth: { version: 1, victories: {}, demonstrations: {}, transformation: { eventId: origin.id, amplitude: t.amplitude, aperture: t.aperture, reserve: t.reserve } } } : {}) };
    vessel(x.p, x.b, stage);
    return { stage, band: `${floorLevel(stage)}-${floorLevel(stage) + 9}`, ...pick(personThreat(w, x.p, x.b)) };
  });
  const embodied = (['Bronze', 'Silver', 'Gold', 'Diamond'] as const).map(next => {
    const trial = EMBODIED_TRIALS[next], current = LEVELED_RANKS[LEVELED_RANKS.indexOf(next) - 1], x = person(`Embodied ${current}`, trial.support);
    x.p.attributes.strength = x.p.attributes.dexterity = trial.core; vessel(x.p, x.b, current);
    return { stage: `${current}, ready for ${next}`, foundations: `${trial.core}/${trial.support}`, ...pick(personThreat(w, x.p, x.b, { equipped: false })) };
  });
  return { curve, species, items, people, wardens, ladder, embodied };
}
function vessel(p: Person, b: { id: string; maxHealth: number; health: number }, stage: LeveledRank) {
  const v = VESSELS[stage]; b.maxHealth = b.health = Math.round(80 * v.resilience);
  p.vessel = { version: 1, stage, eventId: 'fixture', ...v, base: { [b.id]: 80 } };
}
const round = (n: number) => Math.round(n * 100) / 100;
const pick = (t: { level: number; grade: string; power: number }) => ({ level: t.level, grade: t.grade, power: round(t.power) });
export type LevelingReport = ReturnType<typeof levelingReport>;
