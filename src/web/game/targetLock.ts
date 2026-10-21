/**
 * Soft and hard target lock over whatever bodies the client can currently see.
 *
 * Soft lock is an aim assist: while nothing is hard-locked, attacks and the camera bias toward
 * the best hostile in front of the player, and the choice is re-evaluated continuously, with
 * hysteresis so it does not flicker between two equal candidates. Hard lock (Tab or a middle
 * click) pins one target until it dies, leaves range or stays out of sight; cycling walks the
 * candidates nearest-first. Presentation and command targeting only: the server still decides
 * reach, contact and outcome.
 */
export interface LockCandidate { bodyId: string; pos: { x: number; y: number; z: number }; hostile: boolean; dead: boolean; kind: 'person' | 'wildlife' }
export type LockMode = 'none' | 'soft' | 'hard';
export const LOCK = Object.freeze({
  softRange: 12, hardRange: 22, breakRange: 26, softCone: Math.cos(Math.PI / 3), hardCone: Math.cos(Math.PI * 0.42),
  /** A challenger must beat the soft target's score by this margin to take over. */
  hysteresis: 1.5, lostSightSeconds: 1.5,
});

export class TargetLock {
  mode: LockMode = 'none';
  bodyId: string | null = null;
  private unseenSince: number | null = null;
  onChange: ((bodyId: string | null, mode: LockMode) => void) | null = null;

  /** Toggle hard lock: release it, or pin the best candidate (the soft target when there is one). */
  toggle(candidates: readonly LockCandidate[], own: { x: number; z: number }, viewYaw: number): string | null {
    if (this.mode === 'hard') { this.set(null, 'none'); return null; }
    const best = this.mode === 'soft' && this.bodyId ? this.bodyId : rank(candidates, own, viewYaw, LOCK.hardRange, LOCK.hardCone)[0]?.c.bodyId ?? null;
    this.set(best, best ? 'hard' : 'none'); return best;
  }
  /** Next hard target, nearest-first, wrapping. */
  cycle(candidates: readonly LockCandidate[], own: { x: number; z: number }, viewYaw: number, direction: 1 | -1 = 1): string | null {
    const list = rank(candidates, own, viewYaw, LOCK.hardRange, -1).sort((a, b) => a.distance - b.distance || a.c.bodyId.localeCompare(b.c.bodyId));
    if (!list.length) { this.set(null, 'none'); return null; }
    const i = list.findIndex(x => x.c.bodyId === this.bodyId), next = list[((i < 0 ? (direction > 0 ? -1 : 0) : i) + direction + list.length) % list.length].c.bodyId;
    this.set(next, 'hard'); return next;
  }
  release(): void { this.set(null, 'none'); }
  /** Per frame: break a hard lock that is no longer valid; pick or keep the soft target. */
  update(now: number, candidates: readonly LockCandidate[], own: { x: number; z: number }, viewYaw: number, visible: (bodyId: string) => boolean = () => true): void {
    const current = this.bodyId ? candidates.find(c => c.bodyId === this.bodyId) : undefined;
    if (this.mode === 'hard') {
      const gone = !current || current.dead || Math.hypot(current.pos.x - own.x, current.pos.z - own.z) > LOCK.breakRange;
      if (!gone && !visible(current!.bodyId)) this.unseenSince ??= now; else this.unseenSince = null;
      if (gone || (this.unseenSince !== null && now - this.unseenSince > LOCK.lostSightSeconds)) this.set(null, 'none');
      else return;
    }
    const ranked = rank(candidates.filter(c => c.hostile && visible(c.bodyId)), own, viewYaw, LOCK.softRange, LOCK.softCone);
    if (!ranked.length) { if (this.mode === 'soft') this.set(null, 'none'); return; }
    const held = this.mode === 'soft' ? ranked.find(r => r.c.bodyId === this.bodyId) : undefined;
    const best = held && held.score - ranked[0].score < LOCK.hysteresis ? held : ranked[0];
    if (best.c.bodyId !== this.bodyId || this.mode !== 'soft') this.set(best.c.bodyId, 'soft');
  }
  private set(bodyId: string | null, mode: LockMode): void {
    const changed = bodyId !== this.bodyId || mode !== this.mode;
    this.bodyId = bodyId; this.mode = bodyId ? mode : 'none'; this.unseenSince = null;
    if (changed) this.onChange?.(this.bodyId, this.mode);
  }
}

/** Lower is better: distance, plus a penalty for being off the view axis; hostiles first. */
export function rank(candidates: readonly LockCandidate[], own: { x: number; z: number }, viewYaw: number, range: number, cone: number) {
  const fx = -Math.sin(viewYaw), fz = -Math.cos(viewYaw);
  return candidates.filter(c => !c.dead).flatMap(c => {
    const dx = c.pos.x - own.x, dz = c.pos.z - own.z, distance = Math.hypot(dx, dz) || 1e-3, facing = (dx * fx + dz * fz) / distance;
    return distance <= range && facing >= cone ? [{ c, distance, score: distance * (1.6 - facing) - (c.hostile ? 2 : 0) }] : [];
  }).sort((a, b) => a.score - b.score || a.c.bodyId.localeCompare(b.c.bodyId));
}
