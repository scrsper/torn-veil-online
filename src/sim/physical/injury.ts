import type { Body, BodyRegion, LocalizedInjury } from '../core/types';

const REGIONS: readonly BodyRegion[] = ['head', 'torso', 'arm', 'leg'];
/** Reuse the resolver's seeded draw: one draw still resolves one legal strike. Region and
 * force variation are correlated in this deliberately coarse model. Non-humanoid anatomy
 * remains deferred. Severity is impact as a fraction of this body's full health capacity. */
export function injuryFromImpact(body: Body, impact: number, roll: number): LocalizedInjury | null {
  if (body.shape !== 'humanoid' || impact <= 0 || body.maxHealth <= 0) return null;
  return { region: REGIONS[Math.min(3, Math.max(0, Math.floor(roll * 4)))], severity: Math.min(1, impact / body.maxHealth) };
}
/** Keep the strongest consequence in each region, bounding state to four entries. Repeated
 * lesser impacts still subtract health; stacking/treatment belong to a later health model. */
export function applyInjury(body: Body, injury: LocalizedInjury): void {
  body.injuries ??= {};
  body.injuries[injury.region] = Math.max(body.injuries[injury.region] ?? 0, injury.severity);
}
