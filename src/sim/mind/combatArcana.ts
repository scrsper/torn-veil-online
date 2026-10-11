import type { Person, Body, ConflictIntent } from '../core/types';
import type { World } from '../core/world';
import { ARCANE_DEFINITIONS, KERNEL_GEOMETRY } from '../physical/arcana/definitions';
import { arcaneCapacity } from '../physical/arcana/growth';
import { requestArcaneCast } from '../physical/arcana/runtime';

/** An ordinary attack plan may use its actually learned ranged form against a
 * freshly seen opponent. Admission, geometry, costs and interruptions stay shared. */
export function tryCombatArcana(w: World, p: Person, b: Body, target: Body, intent?: ConflictIntent): boolean {
  if (!p.arcana || !p.mind.percepts.some(v => v.bodyId === target.id && v.how === 'saw' && w.now - v.tick <= 1)) return false;
  if (b.arcana?.cast && !b.arcana.cast.cancelled && b.arcana.cast.completeAt > w.physicalTime) return true;
  const distance = w.distance2d(b.pos, target.pos); if (distance < 2) return false;
  const capacity = arcaneCapacity(p, w, b);
  for (const id of Object.keys(p.arcana.learned).sort()) {
    const d = ARCANE_DEFINITIONS.get(id); if (!d || !KERNEL_GEOMETRY[d.kernel].damage || ['dash', 'blink'].includes(d.kernel)) continue;
    if (distance > KERNEL_GEOMETRY[d.kernel].range * capacity.aperture - .2) continue;
    if (requestArcaneCast(w, p, { bodyId: b.id, abilityId: id, target: { ...target.pos }, intent }) === 'accepted') return true;
  }
  return false;
}
