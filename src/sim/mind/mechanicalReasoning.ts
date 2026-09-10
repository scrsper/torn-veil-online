import { manufactureComponent } from '../kernel/manufacture';
import type { Action, Goal, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import type { Method } from '../kernel/types';
import { apparentWear, inspectAssembly, workOnAssembly, type MechanicalEvidence, type MechanicalWork } from '../kernel/evolution';
import { reachable, operateAssembly, mayUseProperty } from '../kernel/mechanics';
import { cognitiveCapability, clamp } from '../core/human';
import { skillOf } from '../core/skills';
import { learn, eventClaim } from './knowledge';
import { knownComponents, componentSupplyPlan } from './componentSupply';
import { remember } from './memory';
import { developThroughUnderstanding } from '../core/development';
import { interpretSocial } from './people';
import { routineWeight } from './routine';

interface Hypothesis { kind: 'replace' | 'connect' | 'test'; part?: number; from?: number; to?: number; confidence: number; reason: string }
const evidenceKey = (id: string) => `mechanical-evidence:${id}`;
const hypothesisKey = (id: string) => `mechanical-hypothesis:${id}`;

function revise(world: World, p: Person, key: string, claim: Record<string, unknown>, eventId: string, confidence: number, type: 'witnessed' | 'inferred' | 'self'): KnowledgeItem {
  const item = learn(world, p, { key, kind: 'technique', claim, confidence, source: { type, viaEvent: eventId } }, true) ?? p.knowledge[key];
  Object.assign(item, { claim, confidence, learnedAt: world.now, source: { type, viaEvent: eventId }, sharedWith: [] });
  return item;
}
/** Hypotheses depend only on this person's lossy measurements and acquired component concepts.
 * Intellect changes coverage/order, never reveals an unobserved defect or the true graph. */
export function mechanicalHypotheses(p: Person, evidence: MechanicalEvidence): Hypothesis[] {
  const reasoning = cognitiveCapability(p).reasoning, skill = skillOf(p, 'crafting');
  const hypotheses: Hypothesis[] = evidence.parts.filter(part => part.wear).map(part => ({ kind: 'replace', part: part.index,
    confidence: clamp((part.wear === 'cracked' ? 0.65 : 0.28) + skill * 0.2, 0.1, 0.9), reason: `visible ${part.wear} part may interrupt the work` }));
  for (const from of evidence.looseEnds) {
    const source = evidence.parts.find(p => p.index === from), concepts = knownComponents(p);
    const a = concepts.find(d => d.id === source?.definition);
    for (const target of evidence.parts.filter(t => t.index !== from)) {
      const b = concepts.find(d => d.id === target.definition);
      if (a?.output && b?.input && a.output.medium === b.input.medium && a.output.coupling === b.input.coupling)
        hypotheses.push({ kind: 'connect', from, to: target.index, confidence: clamp(0.22 + skill * 0.4 + reasoning * 0.1, 0.1, 0.85), reason: 'these visible couplings may transfer motion' });
    }
  }
  hypotheses.push({ kind: 'test', confidence: evidence.powered === false ? 0.7 : 0.15, reason: evidence.powered === false ? 'the supply may lack energy' : 'another trial may distinguish explanations' });
  const breadth = Math.max(1, Math.floor(1 + reasoning * 1.5 + skill * 2));
  // Novices first attend to conspicuous wear; experienced reasoners compare alternatives.
  return (reasoning + skill > 1.4 ? hypotheses.sort((a, b) => b.confidence - a.confidence) : hypotheses).slice(0, breadth);
}

export function reverseEngineer(world: World, p: Person, evidence: MechanicalEvidence, cause: string): KnowledgeItem {
  const concepts = knownComponents(p), reasoning = cognitiveCapability(p).reasoning;
  const definitions = evidence.parts.map(part => part.definition ?? null);
  const connections = evidence.joints.map(e => ({ ...e }));
  // Unknown joints are conjectured, not read. Better reasoning compares port concepts and
  // roles; an impatient observer may assume adjacent parts join, including impossible joints.
  for (const part of evidence.parts) {
    if (connections.some(c => c.from === part.index)) continue;
    const d = concepts.find(d => d.id === part.definition); if (!d?.output) continue;
    const next = reasoning + skillOf(p, 'crafting') > 1.5
      ? evidence.parts.find(t => t.index !== part.index && !connections.some(c => c.to === t.index)
        && concepts.some(c => c.id === t.definition && c.input?.medium === d.output?.medium && c.input?.coupling === d.output?.coupling))
      : evidence.parts.find(t => t.index === part.index + 1);
    if (next) connections.push({ from: part.index, to: next.index });
  }
  const endpoint = concepts.find(d => definitions.includes(d.id) && (d.kind === 'process' || d.kind === 'transfer'));
  const effect = endpoint?.process ?? (endpoint?.phase ? `transfer:${endpoint.phase}` : 'unknown effect');
  const ev = world.emit('mechanism_hypothesized', { actor: p.id, causes: [cause], category: 'cognition', significance: 0.35,
    data: { assemblyId: evidence.assemblyId, basis: evidenceKey(evidence.assemblyId) }, summary: `${p.name} formed a possible mechanical model` });
  const complete = definitions.length >= 2 && definitions.every((d): d is string => !!d);
  const inferredMethod = { definitions, connections, effect, observation: evidence.eventId };
  const method: Method | undefined = complete ? { ruleset: world.kernel.ruleset.id, definitions, connections, effect, provenance: [evidence.eventId, ev.id] } : undefined;
  return revise(world, p, `inferred-method:${evidence.assemblyId}`, { inferredMethod, method }, ev.id, Math.min(0.8, 0.25 + reasoning * 0.15 + evidence.joints.length * 0.05), 'inferred');
}

export function mechanicalPersistence(p: Person, failures: number): number {
  return clamp(1 - failures * (0.55 - cognitiveCapability(p).persistence * 0.25) - p.emotions.stress * 0.25, 0, 1);
}
/** Neutral local wear evidence makes alternatives conceivable. Personal valuation chooses
 * whether investigating is worth anything, and competing goals can always win. */
export function maintenanceGoals(world: World, p: Person): Omit<Goal, 'key' | 'createdAt'>[] {
  const goals: Omit<Goal, 'key' | 'createdAt'>[] = [];
  if (!world.kernel.assemblies.length) return goals;
  for (const request of Object.values(p.knowledge).filter(k => k.claim.askedBy && world.now - k.learnedAt < 7200)) {
    const requester = request.claim.askedBy as string;
    if (!p.mind.percepts.some(pc => pc.entityId === requester && pc.how === 'saw' && pc.distance < 4)) continue;
    const held = p.knowledge['inferred-method:' + request.claim.assemblyId] ?? p.knowledge[evidenceKey(request.claim.assemblyId)];
    if (!held || held.sharedWith.includes(requester)) continue;
    const relationship = p.relationships[requester];
    const willingness = 0.25 + p.traits.sociability * 0.25 + (relationship?.affection ?? 0) * 0.2 - p.needs.energy * 0.15;
    if (willingness > 0.2) goals.push({ type: 'teach_method', utility: willingness, targetEntity: requester, data: { key: held.key }, reasons: ['I was asked about something I have examined', 'my willingness to spend time explaining'], causeEvent: request.source.viaEvent });
  }
  const candidates = new Set(Object.values(p.knowledge).flatMap(k => k.claim.mechanicalEvidence ? [k.claim.mechanicalEvidence.assemblyId as string] : k.claim.assemblyId && k.claim.damage > 0.2 ? [k.claim.assemblyId as string] : []));
  for (const id of candidates) {
    const a = world.kernel.assemblies.find(a => a.id === id);
    if (!a || !a.parts.length || !reachable(world, p, a.pos)) continue;
    const history = p.knowledge[`mechanical-history:${id}`];
    if ((history?.claim.abandonedUntil ?? 0) > world.now || history?.claim.lastOutput > 0) continue;
    const failures = history?.claim.failures ?? 0;
    const e = p.knowledge[evidenceKey(id)], h = p.knowledge[hypothesisKey(id)];
    const persistence = mechanicalPersistence(p, failures);
    const personalStake = a.ownerId === p.id || p.workId === a.bindings.placeId ? 0.3 : Math.max(0, p.relationships[a.ownerId]?.affection ?? 0) * 0.25;
    const utility = (0.2 + p.traits.curiosity * 0.45 + personalStake) * routineWeight(p) * persistence * (1 - p.needs.energy * 0.6);
    let task: Record<string, unknown> = { kind: 'inspect', assemblyId: id };
    if (e && (!h || h.learnedAt < e.learnedAt)) task.kind = 'diagnose';
    else if (h) {
      const hypotheses = h.claim.mechanicalHypothesis as Hypothesis[];
      const hypothesis = hypotheses[Math.min(failures, hypotheses.length - 1)];
      if (history?.claim.lastOutcome === 'fitted') task.kind = 'test';
      else if (hypothesis?.kind === 'replace') {
        const part = (e?.claim.mechanicalEvidence as MechanicalEvidence | undefined)?.parts.find(part => part.index === hypothesis.part);
        const spare = world.kernel.components.find(c => c.definition === part?.definition && !c.assemblyId && apparentWear(p, c) !== 'cracked'
          && (!c.holderId || c.holderId === p.id) && reachable(world, p, c.holderId === p.id ? a.pos : c.pos) && mayUseProperty(world, p, c.ownerId, a.bindings.placeId));
        task = spare ? { kind: 'replace', part: hypothesis.part, componentId: spare.id, assemblyId: id } : { kind: 'abandon', assemblyId: id };
      } else if (hypothesis) task = { ...hypothesis, assemblyId: id };
    }
    if (persistence < 0.2) task.kind = 'abandon';
    if (utility > 0.1 || task.kind === 'abandon') goals.push({ type: 'maintain_mechanism', utility: Math.max(utility, 0.12), targetPos: a.pos,
      data: task, reasons: ['I noticed a mechanical difficulty', 'curiosity, practical stake, fatigue and remembered setbacks'], causeEvent: h?.source.viaEvent ?? e?.source.viaEvent
        ?? Object.values(p.knowledge).find(k => k.claim.assemblyId === id)?.source.viaEvent });
  }
  return goals;
}

/** Shared handler for ordinary NPC plans and externally supplied intentions. */
export function actOnMechanicalTask(world: World, p: Person, action: Action, seconds: number): void {
  const data = action.data!;
  const a = world.kernel.assemblies.find(a => a.id === data.assemblyId);
  if (!a || !reachable(world, p, a.pos)) { action.status = 'failed'; return; }
  const body = world.bodies().find(b => b.ownerId === p.id && b.present && !b.dead && Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z) <= 3); if (body) body.pose = 'work';
  const cause = data.intentionEvent ?? p.mind.goal?.causeEvent;
  if (['inspect', 'diagnose', 'reverse_engineer'].includes(data.kind)) {
    const required = data.kind === 'inspect' ? 2 : 4 / cognitiveCapability(p).reasoning;
    const spent = Math.min(seconds, Math.max(0, required - (data.labor ?? 0))); data.labor = (data.labor ?? 0) + spent; a.laborSeconds += spent;
    if (data.labor < required - 1e-9) return;
    if (data.kind === 'inspect') {
      const evidence = inspectAssembly(world, p, a, cause);
      if (!evidence) { action.status = 'failed'; return; }
      const old = p.knowledge[evidenceKey(a.id)];
      if (!old) developThroughUnderstanding(world, p, evidenceKey(a.id), evidence.parts.length, data.labor, evidence.eventId);
      revise(world, p, evidenceKey(a.id), { mechanicalEvidence: evidence }, evidence.eventId, 0.8, 'witnessed');
      remember(world, p, { type: 'inspection', summary: 'I examined the visible parts of a mechanism', entities: [], eventId: evidence.eventId,
        significance: 0.25, valence: 0, source: { type: 'self', viaEvent: evidence.eventId } });
    } else {
      const e = p.knowledge[evidenceKey(a.id)]; if (!e) { action.status = 'failed'; return; }
      const evidence = e.claim.mechanicalEvidence as MechanicalEvidence;
      if (data.kind === 'reverse_engineer') reverseEngineer(world, p, evidence, e.source.viaEvent!);
      else {
        const hypotheses = mechanicalHypotheses(p, evidence);
        const ev = world.emit('mechanism_hypothesized', { actor: p.id, causes: [e.source.viaEvent!, cause].filter(Boolean), category: 'cognition', significance: 0.3,
          data: { assemblyId: a.id, premise: e.key, hypotheses }, summary: `${p.name} considered explanations for the observed mechanism` });
        reverseEngineer(world, p, evidence, ev.id);
        revise(world, p, hypothesisKey(a.id), { mechanicalHypothesis: hypotheses }, ev.id, hypotheses[0]?.confidence ?? 0.1, 'inferred');
      }
    }
    action.status = 'done'; return;
  }
  const key = `mechanical-history:${a.id}`, old = p.knowledge[key]?.claim ?? {};
  if (data.kind === 'abandon') {
    const ev = world.emit('mechanism_abandoned', { actor: p.id, causes: cause ? [cause] : [], category: 'cognition', significance: 0.2,
      data: { assemblyId: a.id }, summary: `${p.name} set aside the mechanical work` });
    revise(world, p, key, { ...old, abandonedUntil: world.now + 86400 }, ev.id, 1, 'self'); action.status = 'done'; return;
  }
  if (data.kind === 'test') {
    const spent = Math.min(seconds, Math.max(0, 1 - (data.labor ?? 0))); data.labor = (data.labor ?? 0) + spent; a.laborSeconds += spent;
    if (data.labor < 1 - 1e-9) return;
    const result = operateAssembly(world, p, a, 1, cause);
    const k = revise(world, p, `ev:${result.eventId}`, eventClaim(world, world.event(result.eventId)!, true), result.eventId, 1, 'self');
    revise(world, p, key, { ...old, lastOutput: result.output, lastOutcome: 'tested', failures: (old.failures ?? 0) + (result.output > 0 ? 0 : 1) }, result.eventId, 1, 'self');
    interpretSocial(world, p, k); action.status = 'done'; return;
  }
  if (data.kind === 'manufacture') {
    const definition = knownComponents(p).find(d => d.id === data.definition);
    const real = definition && world.kernel.ruleset.components.find(d => d.id === definition.id);
    if (!real) { action.status = 'failed'; return; }
    const result = manufactureComponent(world, p, a, real, seconds, 'spare');
    if (result === 'made') action.status = 'done';
    else if (result !== 'working') action.status = 'failed';
    return;
  }
  if (!['replace', 'connect', 'disconnect', 'dismantle'].includes(data.kind)) { action.status = 'failed'; return; }
  const result = workOnAssembly(world, p, a, data as MechanicalWork, data, seconds, cause);
  if (result === 'working') return;
  action.status = result === 'unavailable' ? 'failed' : 'done';
  if (result !== 'unavailable') revise(world, p, key, { ...old, lastOutcome: result, lastOutput: 0, failures: (old.failures ?? 0) + (result === 'damaged' ? 1 : 0) }, a.lastEvent!, 1, 'self');
}
