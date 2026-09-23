import { createHash } from 'node:crypto';
import { World } from '../sim/core/world';
import { generatePlayableWorld } from '../sim/world/playable';
import { SAVE_VERSION } from '../sim/persist/save';

/**
 * A digest of the deterministic *baseline* a save is overlaid on. Saves store only the historical
 * overlay and regenerate the base from seed + geography spec, so a generator change would silently
 * move terrain, settlements, people or resources under an existing world. The live server records
 * this digest at world creation and recomputes it at every start; a mismatch refuses the start
 * (an explicit migration must be written) instead of loading a quietly different world.
 *
 * It regenerates a fresh throw-away World for the same seed — a few seconds at startup — and
 * digests settlement sites, roads, the initial population's identities, places, resource nodes in
 * the settlement regions, and a coarse terrain lattice across the whole map.
 */
export const GENERATOR_VERSION = 'playable-1';

export function playableBaselineFingerprint(seed: number): string {
  const w = new World(seed);
  generatePlayableWorld(w);
  const h = createHash('sha256');
  const put = (label: string, value: unknown) => { h.update(label); h.update('\u0000'); h.update(JSON.stringify(value)); h.update('\u0001'); };
  const g = w.geography!;
  put('spec', g.spec);
  put('sites', g.sites.map(s => [s.id, s.x, s.z]));
  put('roads', g.roads.map(r => [r.from, r.to, Math.round(r.length * 100)]));
  put('settlements', w.settlements().map(s => [s.id, s.location]).sort());
  put('people', w.persons().map(p => [p.id, p.name, p.age, p.gender, p.occupation, p.homeId, p.workId ?? null]));
  put('places', w.places().map(p => [p.id, p.type, p.bounds]));
  put('resources', w.resourceNodes.map(n => [n.id, n.kind, n.pos.x, n.pos.y, n.pos.z, n.remaining]));
  const step = 768, heights: number[] = [];
  for (let x = 0; x < g.spec.size; x += step) for (let z = 0; z < g.spec.size; z += step) heights.push(w.grid.groundHeight(x, z));
  put('terrain', heights);
  return createHash('sha256').update(`${GENERATOR_VERSION}|save${SAVE_VERSION}|`).update(h.digest()).digest('hex');
}
