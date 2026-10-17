import type { Person, Body } from '../../core/types';
import type { World } from '../../core/world';
import { makeItem } from '../factory';
import { changeEquipment } from '../../physical/equipment';
import { learnArcaneSource } from '../../physical/arcana/runtime';

import { trialKit } from './trialKitRules';
export { trialKit, WARDEN_TRAITS, type WardenArchetype } from './trialKitRules';
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
