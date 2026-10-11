import type { Person, Body } from '../../core/types';
import type { World } from '../../core/world';
import { makeItem } from '../factory';
import { changeEquipment } from '../../physical/equipment';
import { learnArcaneSource } from '../../physical/arcana/runtime';

/** Reusable authored encounter kits. Threat grows through equipment, learned forms
 * and more opponents; no enemy rank comparison, attack slots or hidden damage grant. */
export function trialKit(floor: number, index: number) {
  const caster = floor >= 5 && index % 3 === 0;
  const heavy = floor >= 10 && index % 3 === 1;
  return { caster, heavy, weapon: floor < 4 ? null : heavy ? 'axe' as const : 'dagger' as const,
    armor: floor < 8 ? 0 : Math.min(24, 2 + floor * .2),
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
    const armor = make('armor', k.caster ? 'Prismatic focus mantle' : 'Warden harness');
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
