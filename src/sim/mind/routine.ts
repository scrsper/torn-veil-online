import type { Person } from '../core/types';
import { clamp } from '../core/human';
import type { World } from '../core/world';
import { learn } from './knowledge';

/** Crop state enters the mind only through local visible plots. A shift/home address does not
 * reveal remote harvests. This is evidence; it proposes no action and assigns no worker. */
export function observeFields(world: World, p: Person): void {
  if (world.physicalTime - (p.mind.fieldObservationAt ?? -Infinity) < 2) return;
  p.mind.fieldObservationAt = world.physicalTime;
  const body = world.primaryBody(p.id); if (!body || body.pose === 'sleep') return;
  const eye = { ...body.pos, y: body.pos.y + 1.5 };
  for (const field of world.fields) {
    const place = world.place(field.placeId);
    if (!place || Math.hypot(place.inside.x - body.pos.x, place.inside.z - body.pos.z) > 24) continue;
    let visible = false, ripe = false, fallow = false;
    for (const plot of field.plots) {
      const mature = plot.state === 'mature', bare = plot.state === 'fallow' || plot.state === 'harvested';
      // Once a state is witnessed, further identical plots add no evidence to this claim.
      if (visible && (!mature || ripe) && (!bare || fallow)) continue;
      if (Math.hypot(plot.x - body.pos.x, plot.z - body.pos.z) >= 16
        || !world.grid.lineOfSight(eye, { x: plot.x + 0.5, y: plot.y + 1, z: plot.z + 0.5 }, 20)) continue;
      visible = true; ripe ||= mature; fallow ||= bare;
      if (ripe && fallow) break;
    }
    if (!visible) continue;
    const claim = { fieldId: field.id, placeId: field.placeId, ripe, fallow };
    const key = `field-observation:${field.id}`, prior = p.knowledge[key];
    if (prior && JSON.stringify(prior.claim) === JSON.stringify(claim)) { prior.lastConfirmedAt = world.now; continue; }
    const ev = world.emit('production_observed', { actor: p.id, pos: body.pos, category: 'cognition', significance: 0.2,
      data: { ...claim }, summary: `${p.name} noticed the visible state of a field` });
    const k = learn(world, p, { key, kind: 'state', claim, confidence: 0.9, source: { type: 'witnessed', viaEvent: ev.id } }, true) ?? prior;
    if (k) Object.assign(k, { claim, learnedAt: world.now, lastConfirmedAt: world.now, source: { type: 'witnessed', viaEvent: ev.id }, sharedWith: [] });
  }
}

/** A familiar shift is a personal expectation. The world supplies no priority or command. */
export function routineWeight(p: Person): number {
  const welfare = Math.max(0, ...(p.mind.concerns ?? []).filter(c => c.kind === 'welfare' && c.status === 'active')
    .map(c => c.intensity * (0.35 + Math.max(0, p.relationships[c.subjectId ?? '']?.affection ?? 0) * 0.65)));
  // Obligations already contribute through the shared motivation bridge in think().
  return clamp(0.65 + p.traits.loyalty * 0.35 - welfare * 0.8 - p.emotions.stress * 0.15 - p.needs.energy * 0.12, 0.1, 1.1);
}
