import type { Goal, GoalCommitment, GoalType, Interruptibility, Person } from '../core/types';
import type { World } from '../core/world';
import { severityAtLeast, type Severity } from '../core/physiology';

/**
 * Goal commitment (v0.5 §III). Separates DESIRE (a candidate goal scored fresh every think()
 * tick, mind/agent.ts's `G(...)`) from COMMITMENT (a goal that has been adopted and should
 * persist through ordinary utility fluctuation). This is the fix for the v0.4-disclosed
 * pathology: a weak worker on a many-trip haul got stuck oscillating haul→eat→sleep→socialize
 * without completing another delivery, because each per-trip plan finishing (a normal,
 * frequent event — see agent.ts's `goal_completed`) reset goal selection to a fresh,
 * unprotected utility race every time, and mundane needs occasionally outscored a
 * momentarily-fatigued hauler's own utility. A `GoalCommitment` survives that reset: as long as
 * the underlying deliverable (the `HaulTask`/`ConstructionProject`) is still open, the
 * commitment keeps being offered protection across per-leg plan boundaries, not just within one
 * plan's own unfinished actions.
 *
 * Not a lock — `interruptionSeverityMet`/`EMERGENCY_GOAL_TYPES` below still let a genuine
 * physiological emergency or a real threat override it (Constitution v0.5 §8: "the goal is
 * stability, not lock-in").
 */

/** How resistant each goal TYPE is to preemption, once committed to. Everything absent from
 * this table is 'free' — pre-v0.5 behavior, unchanged (socializing, wandering, idling, shopping,
 * worship, schedule-driven work...). Only the two goal types with a real underlying deliverable
 * (a haul task, a construction project) get 'committed' protection; `sleep` gets the strongest
 * protection of all (v0.5 §9 "sleep should not be interrupted because hunger utility increased
 * slightly") without needing the full start/suspend/resume lifecycle below — see
 * `protectedContinuation` in mind/agent.ts. */
const INTERRUPTIBILITY: Partial<Record<GoalType, Interruptibility>> = {
  haul: 'committed',
  build: 'committed',
  sleep: 'emergency_only',
  // v0.8 §P0-G/H: without this, a helper who had already picked up someone else's lost item
  // (agent.ts's 'help_recover_item' — see `commitmentValidity` below) could get preempted by an
  // ordinary mundane goal (socialize, an idle schedule slot) mid-delivery, on a moment's utility
  // fluctuation — physically abandoning it with the item still in their inventory. Same shape,
  // same fix, as the v0.5 hauler-oscillation pathology this whole file exists for.
  help_recover_item: 'committed',
};
export function interruptibilityOf(type: GoalType): Interruptibility { return INTERRUPTIBILITY[type] ?? 'free'; }
export function isCommittable(type: GoalType): boolean { return interruptibilityOf(type) === 'committed'; }

/** Goal types that may always interrupt any commitment — genuine emergencies (a threat, a
 * dependent in need of help, yielding a lost fight) rather than ordinary competing desires. Heat
 * ('dangerous' forcing a rest `idle`) and an active `threat` are checked separately by the
 * caller, since those are conditions rather than goal types. */
export const EMERGENCY_GOAL_TYPES = new Set<GoalType>(['flee', 'attack', 'confront', 'surrender', 'help']);

/**
 * Whether `interruptingType` is allowed to break a goal with `interruptibility`, given the
 * interrupting person's OWN current need severity (v0.5 §10 "need-driven interruption
 * thresholds"). Ordinary competing goals (socializing, an idle schedule slot) never break a
 * 'committed'/'emergency_only' goal on utility alone — only a physiological need that has
 * actually crossed the relevant severity band does (the caller is responsible for the
 * threat/heat emergency bypass).
 */
export function interruptionSeverityMet(interruptibility: Interruptibility, interruptingType: GoalType, bands: { hunger: Severity; thirst: Severity; sleep: Severity }): boolean {
  if (interruptibility === 'free' || interruptibility === 'checkpoint') return true;
  const need: Severity | null = interruptingType === 'eat' ? bands.hunger : interruptingType === 'drink_water' ? bands.thirst : interruptingType === 'sleep' ? bands.sleep : null;
  if (!need) return false;
  const required: Severity = interruptibility === 'emergency_only' ? 'critical' : 'urgent';
  return severityAtLeast(need, required);
}

/** Adopt a fresh commitment for `goal` (Constitution v0.5 §8). Only called for goal types with
 * real 'committed' interruptibility (haul/build) — see mind/agent.ts's think(). */
export function startCommitment(world: World, p: Person, goal: Goal): GoalCommitment {
  const c: GoalCommitment = {
    goalKey: goal.key, goalType: goal.type, startedAt: world.now, commitmentStrength: 0.7,
    interruptibility: interruptibilityOf(goal.type), status: 'active',
    targetEntity: goal.targetEntity, targetPlace: goal.targetPlace, data: goal.data ? { ...goal.data } : undefined,
  };
  p.mind.commitment = c;
  world.emit('goal_committed', {
    actor: p.id, target: goal.targetEntity, placeId: goal.targetPlace, significance: 0.05,
    data: { goalType: goal.type, goalKey: goal.key }, summary: `${p.name} committed to ${goal.type}`,
  });
  return c;
}

/** A temporary physiological (or emergency) interruption sets the commitment aside rather than
 * destroying it (Constitution v0.5 §11 — "the agent should remember: I am still committed"). */
export function suspendCommitment(world: World, p: Person, reason: string): void {
  const c = p.mind.commitment; if (!c || c.status !== 'active') return;
  c.status = 'suspended'; c.suspendedBy = reason; c.suspendedAt = world.now;
  world.emit('goal_suspended', {
    actor: p.id, significance: 0.06, data: { goalType: c.goalType, goalKey: c.goalKey, reason },
    summary: `${p.name} set aside ${c.goalType} for now (${reason})`,
  });
}

/** The interrupting need has resolved — return to the suspended commitment. */
export function resumeCommitment(world: World, p: Person): void {
  const c = p.mind.commitment; if (!c || c.status !== 'suspended') return;
  c.status = 'active'; c.suspendedBy = undefined;
  world.emit('goal_resumed', {
    actor: p.id, significance: 0.06, data: { goalType: c.goalType, goalKey: c.goalKey },
    summary: `${p.name} returned to ${c.goalType}`,
  });
}

/** Terminal transition. 'completed' (the deliverable was actually fulfilled) is quiet — the
 * underlying request/haul/construction events already record that; 'abandoned' (Constitution
 * v0.5 §12: "canonical, observable, reason-coded") emits so a headless run/Chronicle can show
 * WHY a commitment ended without ever completing. Either way clears `mind.commitment` so normal
 * unprotected utility competition resumes on the next think() tick. */
export function finishCommitment(world: World, p: Person, outcome: 'completed' | 'abandoned', reason?: string): void {
  const c = p.mind.commitment; if (!c || c.status === 'completed' || c.status === 'abandoned') return;
  c.status = outcome;
  if (outcome === 'abandoned') {
    world.emit('goal_abandoned', {
      actor: p.id, significance: 0.12, data: { goalType: c.goalType, goalKey: c.goalKey, reason: reason ?? 'no longer available' },
      summary: `${p.name} gave up on ${c.goalType} — ${reason ?? 'no longer available'}`,
    });
  }
  p.mind.commitment = null;
}

/**
 * Canonical validity of a commitment's underlying deliverable, read straight from world state —
 * NOT from whether it happens to be proposed as a think() candidate this particular tick
 * (fatigue/threat can legitimately suppress a candidate for a tick or two without the
 * underlying work having gone away; that must not read as abandonment). Returns null for a goal
 * type with no external deliverable to check (nothing currently uses 'committed' for such a
 * type, but this keeps the function total rather than assuming the two known cases forever).
 */
export function commitmentValidity(world: World, c: GoalCommitment): 'valid' | 'completed' | 'abandoned' | null {
  if (c.goalType === 'haul') {
    const t = world.haulTasks.find(x => x.id === c.data?.taskId);
    if (!t) return 'abandoned';
    if (t.status === 'delivered') return 'completed';
    if (t.status === 'failed' || t.status === 'cancelled') return 'abandoned';
    return 'valid';
  }
  if (c.goalType === 'build') {
    const proj = world.constructionProjects.find(x => x.id === c.data?.projectId);
    if (!proj) return 'abandoned';
    if (proj.status === 'complete') return 'completed';
    if (proj.status === 'cancelled') return 'abandoned';
    return 'valid';
  }
  if (c.goalType === 'help_recover_item') {
    const it = c.targetEntity ? world.item(c.targetEntity) : undefined;
    const requester = c.data?.deliverTo ? world.person(c.data.deliverTo) : undefined;
    if (!it || !requester || !requester.alive) return 'abandoned';
    const desire = requester.desires.find(d => d.type === 'recover_item' && d.targetId === it.id);
    if (!desire) return 'abandoned'; // the request was withdrawn, or already resolved some other way
    if (desire.fulfilled) return 'completed';
    return 'valid';
  }
  return null;
}

export type { GoalCommitment };
