import { detailedBodies } from '../world/interiors/residency';
import type { Body, Person } from '../core/types';
import type { World } from '../core/world';
import { ACTIVITY_ENERGY_MULT, ACTIVITY_FATIGUE_PER_HOUR, ACTIVITY_HYDRATION_MULT,
  ENERGY_DRAIN_PER_HOUR, HYDRATION_DRAIN_PER_HOUR, syncNeeds } from '../core/physiology';

/** Short physical exertion is a body reserve; cumulative fatigue remains physiology.
 * Nominal action effort is converted once through this shared policy, regardless of
 * controller, location, weapon, or rank. These are authored game pacing parameters. */
export const EXERTION_POLICY = Object.freeze({ burstScale: 5, effortSecondsPerUnit: 100,
  recoveryDelaySeconds: .8, standingRecoveryPerSecond: .12, movingRecoveryPerSecond: .06, guardedRecoveryPerSecond: .03 });
export interface PhysicalExertion { version: 1; load: number; updatedAt: number; lastSpentAt: number; }
export function canSpendExertion(p: Person, b: Body, effort: number): boolean {
  return Number.isFinite(effort) && effort >= 0 && p.physiology.fatigue < .97 && p.physiology.energy >= .1
    && p.physiology.hydration >= .1 && (b.exertion?.load ?? 0) + effort * EXERTION_POLICY.burstScale <= 1 + 1e-9;
}
/** Called only after ordinary admission, or for a guard broken by a real impact.
 * Recovering breath never refunds this work, restores injuries/HP, or creates food. */
export function spendExertion(w: World, p: Person, b: Body, effort: number) {
  const seconds = effort * EXERTION_POLICY.effortSecondsPerUnit, hours = seconds / 3600;
  const burstCost = effort * EXERTION_POLICY.burstScale;
  if (effort === 0) return { nominalEffort: 0, burstCost: 0, effortSeconds: 0, fatigue: 0 };
  b.exertion = { version: 1, load: Math.min(1, (b.exertion?.load ?? 0) + burstCost), updatedAt: w.physicalTime, lastSpentAt: w.physicalTime };
  // Existing heavy-work rates account for the incremental action work. Baseline
  // metabolism continues on the normal clock; it is not charged a second time here.
  const fatigue = hours * ACTIVITY_FATIGUE_PER_HOUR.quarry;
  p.physiology.fatigue = Math.min(1, p.physiology.fatigue + fatigue);
  p.physiology.energy = Math.max(0, p.physiology.energy - hours * ENERGY_DRAIN_PER_HOUR * (ACTIVITY_ENERGY_MULT.quarry - 1));
  p.physiology.hydration = Math.max(0, p.physiology.hydration - hours * HYDRATION_DRAIN_PER_HOUR * (ACTIVITY_HYDRATION_MULT.quarry - 1));
  syncNeeds(p); return { nominalEffort: effort, burstCost, effortSeconds: seconds, fatigue };
}
/** Once per elapsed physical interval. The saved timestamp prevents duplicate recovery
 * on reload or multiple scheduler visits. Committed actions do not recover breath. */
export function advanceExertion(w: World): void {
  for (const b of detailedBodies(w)) advanceBodyExertion(w, b);
}
/** Astral residency uses the same recovery law without inserting its body into
 * planar movement, perception or collision lists. */
export function advanceBodyExertion(w: World, b: Body, moving = Math.hypot(b.vel.x, b.vel.z) > .15): void {
    const e = b.exertion, p = w.person(b.ownerId); if (!e || !p || b.dead || !p.alive) return;
    const after = Math.max(e.updatedAt, e.lastSpentAt + EXERTION_POLICY.recoveryDelaySeconds,
      b.combatAction?.completeAt ?? 0, b.arcana?.cast?.completeAt ?? 0);
    const elapsed = Math.max(0, w.physicalTime - after); e.updatedAt = w.physicalTime;
    const rate = b.guard && b.guard.until > w.physicalTime ? EXERTION_POLICY.guardedRecoveryPerSecond
      : moving ? EXERTION_POLICY.movingRecoveryPerSecond : EXERTION_POLICY.standingRecoveryPerSecond;
    const reserves = Math.max(.2, Math.min(1, p.physiology.energy / .5, p.physiology.hydration / .5)) * (1 - p.physiology.fatigue * .5);
    e.load = Math.max(0, e.load - elapsed * rate * reserves);
}
export function validSavedExertion(value: unknown, at: number, version: number): boolean {
  if (value === undefined) return true;
  const e = value as PhysicalExertion;
  return version >= 30 && !!e && e.version === 1 && [e.load, e.updatedAt, e.lastSpentAt].every(Number.isFinite)
    && e.load >= 0 && e.load <= 1 && e.lastSpentAt >= 0 && e.lastSpentAt <= e.updatedAt && e.updatedAt <= at;
}
