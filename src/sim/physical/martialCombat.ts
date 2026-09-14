import type { Body, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import type { CombatAction } from './combatActionTypes';
import type { MartialInput } from '../core/martialTypes';
import { selectMartialAction, type MartialSelectionContext } from '../mind/martialSelection';
import { demonstratedClaim } from '../mind/martialKnowledge';
import { submitTechniqueUse } from '../mind/martialPractice';
import { combatTransitionAt } from './combatTransitions';

const inputFor = (a: CombatAction): MartialInput | null =>
  a.kind === 'attack' ? (a.trajectory === 'low' ? 'Heavy' : 'Light') : a.kind === 'duck' ? 'Duck' : 'Dodge';

/** Labels the move the existing native repertoire/defense system already chose with a
 * mechanical technique identity, using the same tested selector the martial-learning
 * subsystem uses everywhere else (`selectMartialAction`): an untrained person always gets
 * the shared innate motor primitive, a trained person gets the learned technique, and a
 * genuine learned chain (e.g. jab-to-cross) requires an actually mastered transition edge,
 * exactly like a fresh unchained attempt. This is a pure LABEL: it is derived from, but
 * never influences, which moveId/variant/timing/geometry the native repertoire/defense
 * system already selected. Called once at action creation, before accept()/phase() emit
 * any event for this action, so every phase (including the completion demonstration)
 * carries a consistent technique identity. Unarmed only, matching this slice's vocabulary. */
export function bindMartialLabel(w: World, p: Person, b: Body, a: CombatAction): void {
  const input = inputFor(a); if (!input) return;
  const previous = b.combatAction, now = w.physicalTime;
  const chain = !!previous && now < previous.completeAt;
  const context: MartialSelectionContext = { bodyId: b.id, stance: 'neutral',
    opportunity: { kind: chain ? 'chain' : 'ready', previousActionId: previous?.id,
      opensAt: chain ? combatTransitionAt(previous, a.kind) : now, closesAt: chain ? previous!.completeAt : now + 1,
      allowedInputs: [input] } };
  const selection = selectMartialAction(w, p, input, context);
  if (!selection) return;
  a.techniqueId = selection.techniqueId;
  a.transitionTechniqueId = selection.transitionTechniqueId;
  if (chain && previous!.techniqueId) a.previousTechniqueId = previous!.techniqueId;
  a.martialDemonstration = demonstratedClaim(p, selection.techniqueId);
}

/** Exactly one evidence settlement per action, regardless of normal completion or
 * interruption. Combat has already paid its physical cost; this only records what
 * mechanically happened for teaching/practice-mastery purposes. A miss or an unengaged
 * defense still counts as solo-capped practice; contact is the conservative proxy for a
 * genuinely responsive opponent (the native sweep does not yet track near-miss reaction). */
export function settleCombatLearning(w: World, a: CombatAction, event: WorldEvent, at: number): void {
  if (!a.techniqueId || a.learningEventId) return;
  a.learningEventId = event.id;
  const p = w.person(event.actor);
  const performed = a.stoppedAt === undefined ? at >= a.recoveryAt : at > a.activeAt;
  if (!p || !performed || at <= a.startedAt || a.outcome === 'cancelled') return;
  const feedback = a.contact ? 1 : a.targetBodyId ? 0.6 : 0.4;
  Object.assign(event.data, { techniqueId: a.techniqueId, previousTechniqueId: a.previousTechniqueId, responsiveTarget: !!a.contact, feedback,
    techniqueUse: { techniqueId: a.techniqueId, transitionTechniqueId: a.transitionTechniqueId, bodyId: a.actorBodyId,
      startPhysicalAt: a.startedAt, endPhysicalAt: at, effort: Math.min(1, a.exertionCost / 0.025), feedback,
      challenge: a.contact ? 0.8 : 0.3, targetBodyId: a.targetBodyId ?? undefined } });
  if (a.martialDemonstration && a.stoppedAt === undefined) {
    event.data.martialDemonstration = a.martialDemonstration;
    event.visibility = Math.max(event.visibility ?? 0, 8); event.loudness = Math.max(event.loudness ?? 0, 2);
  }
  submitTechniqueUse(w, p, event.id);
}
