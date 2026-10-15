import type { Person, Body } from '../../core/types';
import type { World } from '../../core/world';
import { makeItem } from '../factory';
import { changeEquipment } from '../../physical/equipment';
import { learnArcaneSource } from '../../physical/arcana/runtime';

/** Reusable authored encounter kits. Threat grows through equipment, learned forms
 * and more opponents; no enemy rank comparison, attack slots or hidden damage grant. */
export type WardenArchetype = 'brawler' | 'skirmisher' | 'guardian' | 'caster' | 'heavy';
/** Distinct opponents from floor 2: a knife-carrying skirmisher, an armoured guardian and the
 * open-hand brawler, later joined by casters (5+) and axe-bearing heavies (10+). */
export const WARDEN_TRAITS: Record<WardenArchetype, { courage: number; aggression: number; sociability: number }> = {
  brawler: { courage: .8, aggression: .35, sociability: .2 }, skirmisher: { courage: .7, aggression: .5, sociability: .2 },
  guardian: { courage: .9, aggression: .25, sociability: .2 }, caster: { courage: .8, aggression: .35, sociability: .2 }, heavy: { courage: .85, aggression: .4, sociability: .2 },
};
export function trialKit(floor: number, index: number) {
  const caster = floor >= 5 && index % 3 === 0;
  const heavy = floor >= 10 && index % 3 === 1;
  const archetype: WardenArchetype = caster ? 'caster' : heavy ? 'heavy' : floor >= 2 && index % 3 === 2 ? 'skirmisher' : floor >= 2 && index % 3 === 1 ? 'guardian' : 'brawler';
  return { caster, heavy, archetype, weapon: floor < 4 ? (archetype === 'skirmisher' ? 'dagger' as const : null) : heavy ? 'axe' as const : 'dagger' as const,
    armor: floor === 1 ? 0 : 2 + floor * .4 + (index % 3 === 1 ? 1.5 : 0),
    amplitude: 1 + Math.max(0, floor - 12) * .1, aperture: 1 + Math.max(0, floor - 25) / 50,
    ability: ['book-ember', 'ess-bone', 'book-sigil', 'ess-storm', 'book-thunder', 'ess-gravity'][Math.min(5, Math.floor((floor - 1) / 16))] };
}
export function equipTrialKit(w: World, p: Person, b: Body, floor: number, index: number, origin: string) {
  const k = trialKit(floor, index);
  const make = (type: Parameters<typeof makeItem>[1], name: string) => {
    const i = makeItem(w, type, name, { owner: p.id, holder: p.id, condition: 1 });
    i.provenance.push({ tick: w.now, eventId: origin, from: null, to: p.id, how: 'finite authored warden kit' }); return i;
  };
  if (k.weapon) { const i = make(k.weapon, k.heavy ? 'Warden axe' : 'Warden dagger'); changeEquipment(w, p, i.id, true, b.id); }
  if (k.armor || k.caster) {
    const armor = make('armor', k.caster ? 'Prismatic focus mantle' : k.archetype === 'guardian' ? 'Guardian plate harness' : 'Warden harness');
    armor.physicalArmor = { version: 1, coverage: ['torso', 'arm'], absorption: k.armor };
    if (k.caster) armor.arcaneFocus = { version: 1, amplitude: k.amplitude, aperture: k.aperture, reserve: 100 };
    changeEquipment(w, p, armor.id, true, b.id);
  }
  if (k.caster) {
    const source = make('book', 'Warden field source');
    source.arcaneSource = { version: 1, abilityId: k.ability, kind: k.ability.startsWith('ess-') ? 'essence' : 'book' };
    learnArcaneSource(w, p, b.id, source.id);
  }
}
