import type { Body, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import type { MartialInput, MartialStance } from '../core/martialTypes';
import { techniqueDefinition } from '../core/martialDefinitions';
import { selectMartialAction, chooseMartialMovement, martialRepertoire, type MartialSelection } from '../mind/martialSelection';
import { demonstratedClaim } from '../mind/martialKnowledge';
import { submitTechniqueUse } from '../mind/martialPractice';
import type { CombatAction, CombatInput } from './combatActionTypes';
import { combatTransitionAt } from './combatTransitions';
import { getPhysicalCapability } from '../core/attributes';

export function semanticCombatInput(input: CombatInput): MartialInput {
  return input.kind === 'attack' ? input.primitive === 'shove' || input.trajectory === 'low' ? 'Heavy' : 'Light'
    : input.kind === 'duck' ? 'Duck' : input.kind === 'cover' ? 'Light' : 'Dodge';
}
function preference(input: CombatInput) {
  return input.primitive === 'shove' ? 'shove' as const : input.kind === 'cover' ? 'cover' as const
    : input.kind === 'backstep' ? 'backstep' as const : input.kind === 'sidestep' ? 'sidestep' as const : undefined;
}
function stance(b: Body, chain: boolean): MartialStance { return chain ? b.combatAction?.endStance ?? 'neutral' : 'neutral'; }

/** All controllers enter here at actual startup; the existing buffer stores intent only. */
export function selectCombatMovement(w: World, p: Person, b: Body, input: CombatInput): MartialSelection | null {
  const previous = b.combatAction, chain = !!previous && w.physicalTime < previous.completeAt;
  return selectMartialAction(w, p, semanticCombatInput(input), { bodyId: b.id, stance: stance(b, chain), preferredMotion: preference(input),
    opportunity: { kind: chain ? 'chain' : 'ready', previousActionId: previous?.id,
      opensAt: chain ? combatTransitionAt(previous, input.kind) : w.physicalTime,
      closesAt: chain ? previous!.completeAt : w.physicalTime + 1, allowedInputs: [semanticCombatInput(input)] } });
}

/** Animation variant selects an existing canonical sampled contact path, never a hit. */
export function movementVariant(techniqueId: string, motion: string): 'direct' | 'hook' | 'kick' {
  return motion === 'kick' ? 'kick' : techniqueId === 'motor:second-punch' || techniqueId === 'unarmed:cross' || techniqueId === 'unarmed:hook' ? 'hook' : 'direct';
}
export function bindMartialMovement(w: World, p: Person, b: Body, a: CombatAction, selected: MartialSelection): void {
  a.techniqueId = selected.techniqueId; a.transitionTechniqueId = selected.transitionTechniqueId;
  a.motion = selected.motion; a.endStance = selected.endStance;
  if (b.combatAction && w.physicalTime < b.combatAction.completeAt) {
    a.previousActionId = b.combatAction.id; a.previousTechniqueId = b.combatAction.techniqueId;
  }
  a.variant = movementVariant(selected.techniqueId, selected.motion);
  // Freeze only content actually demonstrated. No teacher, origin or hidden lineage leaks.
  a.martialDemonstration = demonstratedClaim(p, selected.techniqueId);
}

/** Exactly one evidence settlement, regardless of normal completion, recovery replacement,
 * interruption or restored continuation. Combat has already paid its physical cost. */
export function settleCombatLearning(w: World, a: CombatAction, event: WorldEvent, at: number): void {
  if (!a.techniqueId || a.learningEventId) return;
  a.learningEventId = event.id;
  const p = w.person(event.actor), duration = at - a.startedAt;
  const performed = a.stoppedAt === undefined ? at >= a.recoveryAt : at > a.activeAt;
  if (!p || !performed || duration <= 0 || a.outcome === 'cancelled') return;
  const responsive=!!a.responsiveTargetBodyId&&(!a.contact||a.contact.bodyId===a.responsiveTargetBodyId);
  const target = a.contact?.bodyId ?? a.responsiveTargetBodyId;
  const feedback = a.contact ? 1 : a.responsiveTargetBodyId ? 0.8 : 0.45;
  Object.assign(event.data, { techniqueId: a.techniqueId, previousTechniqueId: a.previousTechniqueId,
    previousActionId: a.previousActionId, responsiveTarget: responsive,
    feedback, techniqueUse: { techniqueId: a.techniqueId, transitionTechniqueId: a.transitionTechniqueId, bodyId: a.actorBodyId,
      startPhysicalAt: a.startedAt, endPhysicalAt: at, effort: Math.min(1, a.exertionCost / 0.025),
      feedback, challenge: responsive ? 0.8 : 0.3, targetBodyId: target } });
  if (a.martialDemonstration && a.stoppedAt === undefined) {
    event.data.martialDemonstration = a.martialDemonstration;
    event.visibility = 8; event.loudness = 2;
  }
  submitTechniqueUse(w, p, event.id);
}

export interface ProjectedMartialChoice { techniqueId: string; name: string; transitionTechniqueId?: string; motion: string; variant: string; }
const inputs = ['Light', 'Heavy', 'Dodge', 'Duck', 'Backstep', 'Cover', 'Shove'] as const;
const projectionCache = new WeakMap<Body, { signature: string; choices: Record<string, ProjectedMartialChoice> }>();
/** Detached capability projection, not a second knowledge model. Cached between relevant
 * repertoire/mastery/body changes. Prediction consumes the result; authority selects again. */
export function martialPredictionChoices(w: World, p: Person, b: Body): Record<string, ProjectedMartialChoice> {
  const beliefs = Object.values(p.knowledge).filter(k => k.claim.martialTechnique);
  const signature = JSON.stringify([b.present, b.dead, b.shape, b.injuries, b.subduedUntil > w.physicalTime,
    p.alive, p.bodies, w.martialDefinitions, p.skills, p.martial?.mastery, beliefs.map(k => [k.key, k.confidence, k.claim.understanding]),
    getPhysicalCapability(p,w,{body:b}).currentExertionCapacity > 0.1]);
  const cached = projectionCache.get(b); if (cached?.signature === signature) return cached.choices;
  const repertoire = martialRepertoire(w, p, b.id), choices: Record<string, ProjectedMartialChoice> = {};
  for (const previous of [undefined, ...repertoire.filter(d => d.selection).map(d => d.techniqueId)]) {
    const previousStance = previous ? techniqueDefinition(w, previous)?.selection?.endStance ?? 'neutral' : 'neutral';
    for (const semantic of inputs) {
      const input: MartialInput = semantic === 'Backstep' ? 'Dodge' : semantic === 'Cover' ? 'Light' : semantic === 'Shove' ? 'Heavy' : semantic;
      const preferredMotion = semantic === 'Backstep' ? 'backstep' : semantic === 'Cover' ? 'cover' : semantic === 'Shove' ? 'shove' : undefined;
      const selected = chooseMartialMovement(w, p, input, { bodyId: b.id, stance: previousStance, preferredMotion }, previous, repertoire);
      if (selected) choices[`${previous ?? 'ready'}|${semantic}`] = { techniqueId: selected.techniqueId,
        name: techniqueDefinition(w, selected.techniqueId)!.name, transitionTechniqueId: selected.transitionTechniqueId,
        motion: selected.motion, variant: movementVariant(selected.techniqueId, selected.motion) };
    }
  }
  projectionCache.set(b, { signature, choices }); return choices;
}
