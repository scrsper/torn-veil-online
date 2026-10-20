/** Pure warden-kit rules, shared by the canonical floor builder and browser presentation.
 * No World, item or equipment access lives here (see trialKit.ts for equipping). */
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
