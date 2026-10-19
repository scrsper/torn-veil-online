import type { Body, BodyRegion, Person } from '../core/types';
import type { World } from '../core/world';
import { equippedItems } from './equipment';

/** Protection comes from authored physical components on equipped Items, never from their
 * display names, rarity, mesh thickness or catalog descriptions. Broken/unheld gear does not
 * protect. Every body (including additional embodiments) uses its own equipment binding. */
export function absorbImpact(w: World, b: Body, incoming: number, region: BodyRegion = 'torso'): { damage: number; absorbed: number; itemIds: string[] } {
  let damage = Math.max(0, incoming); const itemIds: string[] = [], p = w.person(b.ownerId);
  if (p) for (const i of equippedItems(w, p, b).sort((a, z) => a.id.localeCompare(z.id))) {
    if (!i.physicalArmor?.coverage.includes(region) || i.condition === 0) continue;
    const reduction = Math.min(damage * .65, i.physicalArmor.absorption * (i.condition ?? 1));
    if (reduction <= 0) continue;
    damage -= reduction; itemIds.push(i.id);
    i.condition = Math.max(0, (i.condition ?? 1) - reduction / 2000);
  }
  const ward = b.arcana?.effects.find(e => e.kind === 'ward' && e.until > w.physicalTime && e.strength > 0);
  if (ward) { const reduction = Math.min(damage, ward.strength); damage -= reduction; ward.strength -= reduction; }
  return { damage, absorbed: incoming - damage, itemIds };
}

export function embodiedStrikeMultiplier(w: World, p: Person, b: Body): number {
  const frenzy = b.arcana?.effects.find(e => e.kind === 'frenzy' && e.until > w.physicalTime);
  // A breakthrough's remade body strikes harder (progression/levels.ts VESSELS); absent = 1.
  return (1 + Math.min(.5, frenzy?.strength ?? 0)) * (p.vessel?.force ?? 1);
}
