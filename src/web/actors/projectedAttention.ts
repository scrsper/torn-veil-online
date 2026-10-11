import type { Vec3 } from '../net/messages';

interface Candidate { id: string; pos: Vec3; body?: { entityId: string } }

/** Resolve only an explicitly projected attention identity among visible bodies.
 * Multiple manifestations remain valid: prefer the nearest one, with a stable tie.
 * A conversation formation is a heading, not evidence that its subject is the player. */
export function facingBody(from: Pick<Candidate, 'id' | 'pos'>, entityId: string | null | undefined, visible: Iterable<Candidate>): string | null {
  if (!entityId) return null;
  let best: string | null = null, distance = 8;
  for (const candidate of visible) {
    if (candidate.id === from.id || candidate.body?.entityId !== entityId) continue;
    const d = Math.hypot(candidate.pos.x - from.pos.x, candidate.pos.y - from.pos.y, candidate.pos.z - from.pos.z);
    if (d < distance || (d === distance && best !== null && candidate.id < best)) { distance = d; best = candidate.id; }
  }
  return best;
}
