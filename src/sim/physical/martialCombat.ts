import type { Body, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import type { CombatAction, DefenseKind } from './combatActionTypes';
import type { MartialInput } from '../core/martialTypes';
import { selectMartialAction, martialRepertoire, type MartialSelectionContext } from '../mind/martialSelection';
import { demonstratedClaim } from '../mind/martialKnowledge';
import { submitTechniqueUse } from '../mind/martialPractice';
import { combatTransitionAt } from './combatTransitions';
import { nextUnarmedMove, type CombatMoveId } from './combatRepertoire';

/** Techniques with a real current physical move/asset/trajectory/timing. A technique
 * outside this table is fully learnable/practicable through the martial system (teaching,
 * manuals, observation, solo/sparring practice) but is never SELECTED for live combat: no
 * geometry, timing or presentation is faked for it. Extend this table, not the canonical
 * martial definitions, when a new physical adapter is actually implemented. No Unreal
 * animation paths belong here or in martialDefinitions.ts — this only names which of the
 * four existing native moves (jab/cross/front_kick; round_kick is an escalation of
 * front_kick, handled separately) a technique currently maps onto. */
const PHYSICAL_ADAPTER: Partial<Record<string, 'jab' | 'cross' | 'front_kick'>> = {
  'motor:basic-punch': 'jab', 'unarmed:jab': 'jab',
  'motor:second-punch': 'cross', 'unarmed:cross': 'cross',
  'motor:crude-kick': 'front_kick', 'unarmed:low-kick': 'front_kick',
};
/** Restricts martial selection's candidate pool to physically-adapted techniques, so an
 * unimplemented one (e.g. unarmed:hook, unarmed:feint-counter) is simply never chosen —
 * falling back to whatever eligible technique remains — rather than chosen and then faked.
 * Transition-category entries (edges) stay in the pool even when their destination is
 * excluded: they are never themselves a direct pick, only a bonus toward an included one. */
function attackRepertoire(w: World, p: Person, bodyId: string) {
  return martialRepertoire(w, p, bodyId).filter(d => d.category === 'transition' || Object.hasOwn(PHYSICAL_ADAPTER, d.techniqueId));
}

/** Same carry-through native repertoire's own `precedingStrike` already implements for
 * moveId ("one executed strike may carry through one dodge"), but for the martial technique
 * identity: an intervening DEFENSE action is not itself what the next attack chains from —
 * it only carries whatever strike preceded IT (its own `previousTechniqueId`, set by
 * `bindDefenseLabel` below). Only an actual attack's own techniqueId is a real predecessor. */
function precedingTechnique(a: CombatAction | undefined, at: number): string | undefined {
  if (!a || at > a.completeAt + .3 || a.outcome === 'interrupted' || a.outcome === 'cancelled') return undefined;
  return a.kind === 'attack' ? a.techniqueId : a.previousTechniqueId;
}

export interface AttackMoveResolution {
  moveId: CombatMoveId; techniqueId?: string; transitionTechniqueId?: string;
  previousTechniqueId?: string; martialDemonstration?: Record<string, unknown>;
}
/** THE seam: martial selection decides WHICH implemented strike is eligible — an untrained
 * body gets only the shared innate motor primitive; a trained one gets a learned technique;
 * a learned CHAIN transition (e.g. jab-to-cross) requires an actually mastered edge, exactly
 * like a fresh unchained attempt, never merely knowing both endpoints. That selection is
 * mapped onto a real CombatMoveId here. Everything downstream — whether the action can
 * begin now, commitment window, timing, collision, swept contact, hit/miss, interruption,
 * injury, physical cost (combatAction.ts/advanceCombat) — remains entirely the existing
 * combat operator's, unaffected by training. `nextUnarmedMove`'s own native choice is kept
 * as the unconditional fallback: if this adapter's selection ever returns null on some
 * timing/stance edge case it does not anticipate, an attack that always used to work must
 * never be blocked by it. */
export function resolveAttackMove(w: World, p: Person, b: Body, trajectory: 'high' | 'mid' | 'low', arena: boolean): AttackMoveResolution {
  const input: MartialInput = trajectory === 'low' ? 'Heavy' : 'Light';
  const previous = b.combatAction, now = w.physicalTime;
  const fallback = nextUnarmedMove(previous, now, input === 'Heavy', arena);
  const chain = !!previous && now < previous.completeAt;
  const predecessor = chain ? precedingTechnique(previous, now) : undefined;
  const context: MartialSelectionContext = { bodyId: b.id, stance: 'neutral',
    opportunity: { kind: chain ? 'chain' : 'ready', previousActionId: previous?.id,
      opensAt: chain ? combatTransitionAt(previous, 'attack') : now, closesAt: chain ? previous!.completeAt : now + 1,
      allowedInputs: [input] } };
  const selection = selectMartialAction(w, p, input, context, attackRepertoire(w, p, b.id), predecessor);
  if (!selection) return { moveId: fallback };
  const base = PHYSICAL_ADAPTER[selection.techniqueId];
  // Same escalation rule nextUnarmedMove already used: round_kick only follows a front_kick
  // in the arena-progression profile. This is native timing/geometry policy, unaffected by
  // which technique identity selected the kick.
  const moveId: CombatMoveId = base === 'front_kick' ? (arena && previous?.moveId === 'front_kick' ? 'round_kick' : 'front_kick') : base ?? fallback;
  return { moveId, techniqueId: selection.techniqueId, transitionTechniqueId: selection.transitionTechniqueId,
    previousTechniqueId: predecessor, martialDemonstration: demonstratedClaim(p, selection.techniqueId) };
}

const DEFENSE_INPUT: Partial<Record<DefenseKind, MartialInput>> = { duck: 'Duck', sidestep: 'Dodge', backstep: 'Dodge' };
/** Defense has no native moveId/asset-selection concept (unlike attacks, `requestDefense`
 * already names its own DefenseKind directly) — this only labels the innate motor
 * technique for evidence/mastery/observation bookkeeping, never gates or changes which
 * defense kind executes, its timing, or its geometry. */
export function bindDefenseLabel(w: World, p: Person, b: Body, a: CombatAction): void {
  const input = DEFENSE_INPUT[a.kind as DefenseKind]; if (!input) return;
  const previous = b.combatAction, now = w.physicalTime;
  const chain = !!previous && now < previous.completeAt;
  const predecessor = chain ? precedingTechnique(previous, now) : undefined;
  const context: MartialSelectionContext = { bodyId: b.id, stance: 'neutral',
    opportunity: { kind: chain ? 'chain' : 'ready', previousActionId: previous?.id,
      opensAt: chain ? combatTransitionAt(previous, a.kind) : now, closesAt: chain ? previous!.completeAt : now + 1,
      allowedInputs: [input] } };
  const selection = selectMartialAction(w, p, input, context, undefined, predecessor);
  if (!selection) return;
  a.techniqueId = selection.techniqueId;
  a.transitionTechniqueId = selection.transitionTechniqueId;
  if (predecessor) a.previousTechniqueId = predecessor;
  a.martialDemonstration = demonstratedClaim(p, selection.techniqueId);
}

/** Exactly one evidence settlement per action, regardless of normal completion or
 * interruption. Combat has already paid its physical cost; this only records what
 * mechanically happened for teaching/practice-mastery purposes. A miss or an unengaged
 * defense still counts as solo-capped practice; contact is the conservative proxy for a
 * genuinely responsive opponent (the native sweep does not track near-miss reaction). */
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
