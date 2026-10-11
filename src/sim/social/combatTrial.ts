import type { Body, Goal, Person } from '../core/types';
import type { World } from '../core/world';
import { cancelArcaneCast } from '../physical/arcana/runtime';

/** An explicit, source-backed combat agreement. It grants no skills, stats, immunity,
 * perception or control. Ordinary goal competition and physical actions execute it. */
export interface CombatTrialConsent {
  version: 1; id: string; sourceEventId: string; opponents: string[];
  intent: 'injure' | 'kill'; endedEventId?: string;
}
export function agreeCombatTrial(w: World, id: string, sides: [Person[], Person[]], intent: CombatTrialConsent['intent'], cause: string): string {
  const participants = sides.flat();
  if (!id || sides.some(side => !side.length || side.length > 32) || participants.some(p => p.combatTrial && !p.combatTrial.endedEventId)
    || new Set(participants.map(p => p.id)).size !== participants.length || !w.event(cause)) throw Error('Invalid or conflicting combat agreement');
  const e = w.emit('combat_trial_agreed', { causes: [cause], actor: participants[0].id, visibility: 24,
    data: { trialId: id, sides: sides.map(s => s.map(p => p.id)), intent }, significance: .4,
    summary: `${participants.map(p => p.name).join(', ')} entered a ${intent === 'kill' ? 'lethal' : 'nonlethal'} combat trial` });
  sides.forEach((side, index) => side.forEach(p => {
    p.combatTrial = { version: 1, id, sourceEventId: e.id, opponents: sides[1 - index].map(q => q.id), intent };
  }));
  return e.id;
}
export function trialGoal(w: World, p: Person, b: Body): Partial<Goal> | null {
  const c = p.combatTrial;
  if (!c || c.endedEventId || !w.event(c.sourceEventId) || b.pose === 'downed' || p.surrender || p.custody?.active) return null;
  const visible = p.mind.percepts.filter(pc => pc.how === 'saw' && pc.tick <= w.now && w.now - pc.tick <= 1
    && c.opponents.includes(pc.entityId) && pc.distance <= 16).sort((a, z) => a.distance - z.distance || a.bodyId.localeCompare(z.bodyId));
  for (const pc of visible) {
    const target = w.body(pc.bodyId), other = w.person(pc.entityId);
    if (!target?.present || target.dead || target.pose === 'downed' || !other?.alive || other.surrender || other.custody?.active) continue;
    if (!w.grid.lineOfSight({ ...b.pos, y: b.pos.y + 1.5 }, { ...target.pos, y: target.pos.y + 1.1 }, 16)) continue;
    return { type: 'attack', utility: Math.max(0, Math.min(.88, .45 + p.traits.courage * .2 + b.health / b.maxHealth * .2 - p.physiology.fatigue * .3)),
      targetEntity: other.id, causeEvent: c.sourceEventId, data: { intent: c.intent, trialId: c.id },
      reasons: ['I agreed to this combat trial', 'an opponent is currently visible', 'my present health and fatigue'] };
  }
  return null;
}
/** Withdraw only the defeated participant; the agreement remains active for others. */
export function retireCombatTrialParticipant(w: World, p: Person, causes: string[]): string {
  const c = p.combatTrial; if (!c || c.endedEventId) throw Error('No active trial participation');
  const e = w.emit('combat_trial_ended', { actor: p.id, causes: [c.sourceEventId, ...causes], visibility: 24, significance: .5,
    data: { trialId: c.id, participants: [p.id] }, summary: p.name + ' completed their part in the trial' });
  c.endedEventId = e.id;
  for (const id of p.bodies) { const b = w.body(id); if (b && (b.dead || b.pose === 'downed')) cancelArcaneCast(w, b); }
  // Their accepted trial plan has ended. Any later aggression is evaluated normally.
  if (p.mind.goal?.data?.trialId === c.id) { p.mind.goal = null; p.mind.plan = []; const b = w.primaryBody(p.id); if (b) { b.path = null; b.attackTarget = null; } }
  return e.id;
}
export function endCombatTrial(w: World, id: string, causes: string[]): string {
  const participants = w.persons().filter(p => p.combatTrial?.id === id && !p.combatTrial.endedEventId);
  if (!participants.length) throw Error('No active combat trial');
  const e = w.emit('combat_trial_ended', { causes: [...new Set([...participants.map(p => p.combatTrial!.sourceEventId), ...causes])],
    visibility: 24, significance: .5, data: { trialId: id, participants: participants.map(p => p.id) }, summary: 'The combat trial ended' });
  for (const p of participants) p.combatTrial!.endedEventId = e.id;
  return e.id;
}
export function validCombatTrials(w: World, saveVersion: number): boolean {
  return w.persons().every(p => {
    const c = p.combatTrial; if (c === undefined) return true;
    if (saveVersion < 30 || !c || c.version !== 1 || typeof c.id !== 'string' || !c.id || c.id.length > 200 || typeof c.sourceEventId !== 'string'
      || !Array.isArray(c.opponents) || !c.opponents.length || c.opponents.length > 32 || new Set(c.opponents).size !== c.opponents.length
      || !['injure', 'kill'].includes(c.intent) || c.opponents.some(id => id === p.id || !w.person(id))) return false;
    const source = w.event(c.sourceEventId), sides = source?.data.sides;
    if (source?.type !== 'combat_trial_agreed' || source.data.trialId !== c.id || source.data.intent !== c.intent || !Array.isArray(sides) || sides.length !== 2) return false;
    const side = sides.findIndex((s: unknown) => Array.isArray(s) && s.includes(p.id));
    if (side < 0 || JSON.stringify(sides[1 - side]) !== JSON.stringify(c.opponents)) return false;
    return c.endedEventId === undefined || w.event(c.endedEventId)?.type === 'combat_trial_ended' && w.event(c.endedEventId)?.data.trialId === c.id && w.event(c.endedEventId)?.data.participants?.includes(p.id);
  });
}
