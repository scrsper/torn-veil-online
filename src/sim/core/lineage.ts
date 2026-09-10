import type { Person, LineageImprint } from './types';
import type { World } from './world';
import { ATTRIBUTE_IDS, attributeProfile, inheritedInteger } from './human';

export const MAX_INHERITED_IMPRINTS = 7;
export const MAX_IMPRINT_DISTANCE = 6;
export const MAX_IMPRINT_EXPRESSION = 2;

/** O(7 + bounded parental carriers), no ancestry traversal. Runs once at an actual birth.
 * Subtract explicitly expressed contributions before blending: the same origin cannot become
 * both a permanent baseline bonus and a second re-expressed ancestral bonus in every generation. */
export function inheritPotential(world: World, child: Person, a: Person, b: Person, birthEventId: string): void {
  if (child.lineage.birthEventId) throw new Error('Inheritance is already fixed at birth');
  if (world.event(birthEventId)?.type !== 'birth' || world.event(birthEventId)?.target !== child.id
    || !child.parentIds.includes(a.id) || !child.parentIds.includes(b.id)) throw new Error('Inheritance requires canonical birth and parents');
  const rng = world.demographicRng;
  const pool = new Map<string, LineageImprint>();
  for (const parent of [a, b]) for (const imprint of parent.lineage.imprints) {
    const existing = pool.get(imprint.id);
    if (!existing || imprint.generationDistance < existing.generationDistance
      || (imprint.generationDistance === existing.generationDistance && imprint.transmissionEventId < existing.transmissionEventId)) pool.set(imprint.id, imprint);
  }
  const imprints: LineageImprint[] = [];
  for (const i of [...pool.values()].sort((x, y) => x.generationDistance - y.generationDistance || x.id.localeCompare(y.id))) {
    if (i.generationDistance >= MAX_IMPRINT_DISTANCE || imprints.length >= MAX_INHERITED_IMPRINTS) continue;
    if (rng.next() >= i.transmissibility) continue;
    imprints.push({ ...i, generationDistance: i.generationDistance + 1 });
  }
  const expressed = attributeProfile(0);
  const expressions: Person['lineage']['expressions'] = [];
  for (const id of ATTRIBUTE_IDS) {
    const base = inheritedInteger(rng, a.attributePotential[id] - a.lineage.expressed[id], b.attributePotential[id] - b.lineage.expressed[id]);
    let unexpressedFraction = 1;
    for (const i of imprints.filter(i => i.attribute === id)) {
      const didExpress = rng.next() < 0.35, attenuation = Math.pow(0.72, i.generationDistance - 1);
      const strength = didExpress ? 0.5 + rng.next() * 0.5 : 0;
      const expression = Math.min(MAX_IMPRINT_EXPRESSION, i.magnitude * attenuation * strength);
      expressions.push({ imprintId: i.id, didExpress, strength, attenuation, contribution: expression });
      if (!didExpress) continue;
      unexpressedFraction *= 1 - expression / MAX_IMPRINT_EXPRESSION;
    }
    const contribution = MAX_IMPRINT_EXPRESSION * (1 - unexpressedFraction);
    // One unbiased stochastic rounding at generation, stored forever. No repeated ceil().
    expressed[id] = Math.min(20 - base, Math.floor(contribution) + (rng.next() < contribution % 1 ? 1 : 0));
    child.attributePotential[id] = base + expressed[id];
  }
  child.lineage = { imprints, expressed, birthEventId, expressions };
  if (imprints.length) {
    const ev = world.emit('lineage_transmitted', { actor: child.id, category: 'history', significance: 0.55,
      causes: [birthEventId, ...new Set(imprints.map(i => i.transmissionEventId))],
      data: { imprints: imprints.map(i => ({ id: i.id, originPersonId: i.originPersonId, generationDistance: i.generationDistance })), expressed: { ...expressed }, expressions: structuredClone(expressions) },
      summary: `Bounded lineage potential passed to ${child.name}` });
    for (const i of imprints) i.transmissionEventId = ev.id;
  }
}
