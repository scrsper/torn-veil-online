import type { Person } from '../core/types';
import type { World } from '../core/world';
import type { MartialInput, MartialMotion, MartialStance, TechniqueDefinition } from '../core/martialTypes';
import { INNATE_TECHNIQUE_IDS, techniqueDefinition } from '../core/martialDefinitions';
import { clamp } from '../core/human';
import { canExecuteTechnique, masteryOf } from './martialKnowledge';
import { techniqueExecutionProfile } from './martialPractice';

/** Supplied by the canonical combat transition operator, never by a transport payload.
 * This selector cannot open a timing window, consume input, shorten commitment, charge
 * effort or resolve contact. The producer must revalidate its opportunity at acceptance. */
export interface MartialSelectionContext {
  bodyId: string;
  stance: MartialStance;
  opportunity: { kind: 'ready' | 'chain'; previousActionId?: string; opensAt: number; closesAt: number;
    allowedInputs: readonly MartialInput[] };
  /** A canonical local tactical choice. No hidden opponent state is queried here. */
  preferredMotion?: 'shove' | 'cover' | 'sidestep' | 'backstep';
}
export interface MartialSelection {
  type: 'single-action';
  techniqueId: string;
  availability: 'innate' | 'learned';
  motion: MartialMotion;
  endStance: MartialStance;
  transitionTechniqueId?: string;
  transitionQuality: number;
  execution: NonNullable<ReturnType<typeof techniqueExecutionProfile>>;
}

export function martialRepertoire(world: World, p: Person, bodyId: string): TechniqueDefinition[] {
  // Innate access is explicit ontology/embodiment. Learned entries come from this mind's
  // actual beliefs. Canonical registry contents cannot silently expand its repertoire.
  const ids = new Set([...INNATE_TECHNIQUE_IDS, ...Object.values(p.knowledge)
    .filter(k => k.kind === 'technique' && typeof k.claim.martialTechnique === 'string').map(k => k.claim.martialTechnique as string)]);
  return [...ids].sort().map(id => techniqueDefinition(world, id)).filter((d): d is TechniqueDefinition => !!d && canExecuteTechnique(world, p, d.techniqueId, bodyId));
}

/** Pure deterministic choice of exactly one action, with no combo sequence or outcome.
 * Current Body.combatAction is the only previous-action truth; no combo index is saved. */
export function selectMartialAction(world: World, p: Person, input: MartialInput, context: MartialSelectionContext): MartialSelection | null {
  const body = world.body(context.bodyId), opportunity = context.opportunity, now = world.physicalTime;
  if (!body || body.ownerId !== p.id || !p.bodies.includes(body.id) || !Number.isFinite(opportunity.opensAt) || !Number.isFinite(opportunity.closesAt)
    || now < opportunity.opensAt || now > opportunity.closesAt || opportunity.closesAt < opportunity.opensAt || !opportunity.allowedInputs.includes(input)) return null;
  const previous = body.combatAction;
  if (previous && (previous.actorBodyId !== body.id || opportunity.previousActionId !== previous.id)) return null;
  if (!previous && opportunity.previousActionId) return null;
  if (opportunity.kind === 'chain') {
    if (!previous || !previous.techniqueId || previous.phase !== 'recovery' || ['interrupted', 'cancelled'].includes(previous.outcome)
      || now < previous.recoveryAt || now >= previous.completeAt || opportunity.opensAt < previous.recoveryAt) return null;
  } else if (previous && now < previous.completeAt) return null;
  const repertoire = martialRepertoire(world, p, body.id), predecessor = opportunity.kind === 'chain' ? previous!.techniqueId : undefined;
  const candidates: { d: TechniqueDefinition; edge?: TechniqueDefinition; score: number }[] = [];
  for (const d of repertoire) {
    const selection = d.selection;
    if (!selection || d.category === 'transition' || selection.input !== input || !selection.stances.includes(context.stance)) continue;
    let edge: TechniqueDefinition | undefined;
    if (predecessor && d.availability !== 'innate') {
      edge = repertoire.filter(t => t.transition?.from === predecessor && t.transition.to === d.techniqueId
        && masteryOf(p, t.techniqueId) >= t.transition.minimumMastery)
        .sort((a, b) => masteryOf(p, b.techniqueId) - masteryOf(p, a.techniqueId) || a.techniqueId.localeCompare(b.techniqueId))[0];
      if (!edge) continue;
    } else if (!predecessor && !selection.entry) continue;
    let score = selection.priority + masteryOf(p, d.techniqueId) * 2 + (d.availability !== 'innate' ? 20 : 0) + (edge ? 100 : 0);
    if (context.preferredMotion) score += selection.motion === context.preferredMotion ? 60 : -60;
    // Alternating crude punches is motor sequencing, not an invented learned edge.
    if (predecessor === 'motor:basic-punch' && d.techniqueId === 'motor:second-punch') score += 5;
    if (predecessor === 'motor:second-punch' && d.techniqueId === 'motor:basic-punch') score += 5;
    candidates.push({ d, edge, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.d.techniqueId.localeCompare(b.d.techniqueId));
  const selected = candidates[0]; if (!selected) return null;
  const execution = techniqueExecutionProfile(world, p, body.id, selected.d.techniqueId); if (!execution) return null;
  return { type: 'single-action', techniqueId: selected.d.techniqueId, availability: selected.d.availability ?? 'learned',
    motion: selected.d.selection!.motion, endStance: selected.d.selection!.endStance,
    transitionTechniqueId: selected.edge?.techniqueId,
    transitionQuality: clamp(execution.balance * 0.3 + execution.recoveryEfficiency * 0.2
      + (selected.edge ? 0.15 + masteryOf(p, selected.edge.techniqueId) * 0.35 : 0), 0, 1), execution };
}
