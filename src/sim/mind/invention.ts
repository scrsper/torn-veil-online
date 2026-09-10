import type { Action, Goal, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import type { Assembly, Bindings, ComponentDefinition, Method } from '../kernel/types';
import { portsMatch } from '../kernel/definitions';
import { acquireComponent, connect, dismantle, distance, installComponent, operateAssembly, owns, reachable, startAssembly } from '../kernel/mechanics';
import { stockItemsAt } from '../world/stock';
import { learn } from './knowledge';
import { remember } from './memory';

export interface PracticalNeed { effect: string; targetQuantity: number; bindings: Bindings; pos: { x: number; y: number; z: number } }
export const methodSignature = (m: Method) => JSON.stringify([m.ruleset, m.definitions, m.connections, m.effect]);
export const methodsHeld = (p: Person): KnowledgeItem[] => Object.values(p.knowledge).filter(k => k.kind === 'technique' && k.claim.method);
export function teachPrimitive(world: World, p: Person, definition: ComponentDefinition): void {
  learn(world, p, { key: `component:${definition.id}`, kind: 'affordance', claim: { component: structuredClone(definition) }, confidence: 1, source: { type: 'prior' } }, true);
}
export function practicalNeed(world: World, p: Person, key: string, need: PracticalNeed): void {
  learn(world, p, { key, kind: 'fact', claim: { practicalNeed: structuredClone(need) }, confidence: 1, source: { type: 'prior' } }, true);
}

/** This observation is local, sight/reach checked, and confined to the stock the person can
 * use. A desired quantity is intention; observed inventory is evidence, not another stock. */
function observeOutput(world: World, p: Person, key: string, need: PracticalNeed): number | null {
  if (!reachable(world, p, need.pos)) return null;
  let quantity = 0;
  if (need.bindings.outputId) {
    const tank = world.kernel.reservoirs.find(r => r.id === need.bindings.outputId);
    if (!tank || !owns(p, tank.ownerId) || !reachable(world, p, tank.pos)) return null;
    quantity = tank.quantity;
  } else {
    const process = world.kernel.ruleset.processes.find(r => r.id === need.effect);
    const material = world.kernel.ruleset.materials.find(m => m.id === process?.output.material);
    const place = world.place(need.bindings.placeId);
    if (!place || !reachable(world, p, place.inside) || !material?.legacyItem) return null;
    quantity = stockItemsAt(world, material.legacyItem, place.id).filter(i => owns(p, i.ownerId)).reduce((n, i) => n + i.quantity, 0);
  }
  learn(world, p, { key: `observed:${key}`, kind: 'fact', claim: { quantity, at: world.now, needKey: key }, confidence: 1, source: { type: 'witnessed' } }, true);
  return quantity;
}
const effectOf = (c: ComponentDefinition): string | undefined => c.kind === 'process' ? c.process : c.kind === 'transfer' ? `transfer:${c.phase}` : undefined;

/** Bounded graph search over beliefs, not canonical capability tables. Aggregate power is
 * deliberately unknown until attempted. Costs/order of primitive choices do not certify success.
 * No finished topology is supplied by the scenario or selected by its names. */
export function candidateMethods(world: World, p: Person, need: PracticalNeed): Method[] {
  const visible = world.kernel.components.filter(c => !c.assemblyId && (!c.holderId || c.holderId === p.id) && owns(p, c.ownerId) && reachable(world, p, c.holderId === p.id ? need.pos : c.pos));
  const available = (m: Method) => m.definitions.every((id, i) => visible.filter(c => c.definition === id).length >= m.definitions.slice(0, i + 1).filter(x => x === id).length);
  const failed = new Set(Object.values(p.knowledge).filter(k => k.claim.experiment && !k.claim.success).map(k => k.claim.signature as string));
  const taught = methodsHeld(p).filter(k => k.confidence > 0.2 && k.claim.method.ruleset === world.kernel.ruleset.id && k.claim.method.effect === need.effect).map(k => k.claim.method as Method).filter(available);
  const known = Object.values(p.knowledge).filter(k => k.kind === 'affordance' && k.claim.component && k.confidence > 0.2).map(k => k.claim.component as ComponentDefinition)
    .filter(d => visible.some(c => c.definition === d.id)).sort((a, b) => a.massKg - b.massKg || a.id.localeCompare(b.id));
  const methods: Method[] = [];
  let visits = 0;
  const visit = (path: ComponentDefinition[]): void => {
    if (++visits > 128 || methods.length >= 24) return;
    const last = path.at(-1)!;
    if (effectOf(last) === need.effect) {
      const m: Method = { ruleset: world.kernel.ruleset.id, definitions: path.map(c => c.id), connections: path.slice(1).map((_, i) => ({ from: i, to: i + 1 })), effect: need.effect };
      if (available(m)) methods.push(m); return;
    }
    if (path.length >= 6) return;
    for (const d of known) if (!path.includes(d) && portsMatch(last.output, d.input)) visit([...path, d]);
  };
  for (const d of known) if (d.kind === 'source') visit([d]);
  const unique = new Map<string, Method>();
  for (const m of [...taught, ...methods]) if (!failed.has(methodSignature(m))) unique.set(methodSignature(m), m);
  return [...unique.values()].slice(0, 24);
}

/** Candidate goals enter agent.ts's existing G() motivation bridge and normal competition. */
export function inventionGoals(world: World, p: Person): Partial<Goal>[] {
  if (!world.kernel.components.length) return [];
  const goals: Partial<Goal>[] = [];
  for (const k of Object.values(p.knowledge)) {
    const need = k.claim.practicalNeed as PracticalNeed | undefined; if (!need) continue;
    const observed = observeOutput(world, p, k.key, need); if (observed === null || observed >= need.targetQuantity) continue;
    const active = world.kernel.assemblies.find(a => a.ownerId === p.id && a.needKey === k.key && (a.parts.length > 0 || !a.tested));
    const candidate = active ? undefined : candidateMethods(world, p, need)[0];
    if (active || candidate) goals.push({ type: 'compose', utility: 0.72, targetPos: need.pos, data: { needKey: k.key, assemblyId: active?.id, method: candidate }, reasons: [`observed ${observed.toFixed(2)}; need ${need.targetQuantity}`, 'try known component capabilities'], causeEvent: k.source.viaEvent });
  }
  for (const k of methodsHeld(p)) {
    const listener = p.mind.percepts.find(percept => percept.how === 'saw' && percept.distance < 3 && !k.sharedWith.includes(percept.entityId) && world.person(percept.entityId)?.alive);
    if (listener) { goals.push({ type: 'teach_method', utility: 0.76, targetEntity: listener.entityId, data: { key: k.key }, reasons: ['share a reproducible method with someone nearby'], causeEvent: k.source.viaEvent }); break; }
  }
  return goals;
}

export function inventionPlan(world: World, p: Person, g: Goal): Action[] {
  const need = p.knowledge[g.data?.needKey]?.claim.practicalNeed as PracticalNeed | undefined;
  if (!need) return [];
  // Goal hysteresis intentionally retains the original Goal object. Resolve the current
  // project/candidate again when a completed plan is renewed, instead of replaying its old data.
  const a = world.kernel.assemblies.find(a => a.ownerId === p.id && a.needKey === g.data?.needKey && (a.parts.length > 0 || !a.tested));
  const ready = a && a.parts.length === a.method.definitions.length && a.connections.length === a.method.connections.length;
  const failed = a?.tested && a.lastReason !== 'productive';
  const candidate = a ? undefined : candidateMethods(world, p, need)[0];
  if (!a && !candidate) return [];
  return [{ type: 'goto', pos: need.pos, status: 'pending' }, { type: ready && !failed ? 'operate_mechanism' : 'construct_mechanism', status: 'pending', data: { needKey: g.data!.needKey, assemblyId: a?.id, method: candidate, bindings: need.bindings, pos: need.pos, dismantle: failed } }];
}

/** Ordinary physical actions; progress lives with the project, so a replanned action cannot
 * mint labor or lose partial construction. Each completed step emits a canonical event. */
export function actOnMechanism(world: World, p: Person, action: Action, seconds: number): void {
  const data = action.data!;
  let a = world.kernel.assemblies.find(a => a.id === data.assemblyId);
  if (!a && action.type === 'construct_mechanism') {
    const old = world.kernel.assemblies.find(x => x.ownerId === p.id && x.needKey === data.needKey && !x.tested);
    a = old ?? startAssembly(world, p, data.method, data.bindings, data.pos, data.needKey) ?? undefined;
    if (a) data.assemblyId = a.id;
  }
  if (!a || !reachable(world, p, a.pos) || a.ownerId !== p.id) { action.status = 'failed'; return; }
  const body = world.bodies().find(b => b.ownerId === p.id && b.present && !b.dead && distance(b.pos, a!.pos) <= 3); if (body) body.pose = 'work';
  const spend = (key: string, required: number): boolean => {
    const amount = Math.min(seconds, Math.max(0, required - (a!.progress[key] ?? 0)));
    a!.progress[key] = (a!.progress[key] ?? 0) + amount; a!.laborSeconds += amount;
    return a!.progress[key] >= required - 1e-9;
  };
  if (action.type === 'construct_mechanism') {
    if (a.parts.length < a.method.definitions.length) {
      const index = a.parts.length, definition = a.method.definitions[index];
      const c = world.kernel.components.find(c => c.definition === definition && !c.assemblyId && owns(p, c.ownerId) && (!c.holderId || c.holderId === p.id) && reachable(world, p, c.holderId === p.id ? a!.pos : c.pos));
      if (!c) { action.status = 'failed'; return; }
      if (!c.holderId && !acquireComponent(world, p, c.id)) { action.status = 'failed'; return; }
      const d = world.kernel.ruleset.components.find(d => d.id === definition)!;
      if (spend(`install:${index}`, d.installSeconds) && !installComponent(world, p, a, c.id)) action.status = 'failed';
      return;
    }
    const edge = a.method.connections.find(e => !a!.connections.some(c => c.from === e.from && c.to === e.to));
    if (edge) {
      if (spend(`join:${edge.from}:${edge.to}`, 0.5) && !connect(world, p, a, edge.from, edge.to)) { a.tested = true; a.lastReason = 'connection rejected'; recordTrial(world, p, a, false); dismantle(world, p, a); action.status = 'failed'; }
      return;
    }
    action.status = 'done'; return;
  }
  // A short one-physical-second supervised experiment. Progress and labor survive load.
  if (!spend('run', 1)) return;
  a.progress.run = 0;
  const result = operateAssembly(world, p, a, 1); a.tested = true;
  recordTrial(world, p, a, result.output > 0);
  if (!result.output) {
    // Failed candidates release their real, worn components for the next attempt.
    // Dismantling is a subsequent ordinary construction action with its own labor cost.
    action.type = 'construct_mechanism'; data.dismantle = true;
  } else action.status = 'done';
}

export function dismantleFailed(world: World, p: Person, action: Action, seconds: number): boolean {
  if (!action.data?.dismantle) return false;
  const a = world.kernel.assemblies.find(a => a.id === action.data!.assemblyId);
  if (!a || !reachable(world, p, a.pos) || a.ownerId !== p.id) { action.status = 'failed'; return true; }
  const n = Math.min(seconds, Math.max(0, 1 - (a.progress.dismantle ?? 0))); a.progress.dismantle = (a.progress.dismantle ?? 0) + n; a.laborSeconds += n;
  if (a.progress.dismantle >= 1 - 1e-9) { dismantle(world, p, a); action.status = 'done'; } return true;
}
function recordTrial(world: World, p: Person, a: Assembly, success: boolean): void {
  if (success) {
    const definitions = a.parts.map(id => world.kernel.components.find(c => c.id === id)!.definition);
    const work = definitions.map(id => world.kernel.ruleset.components.find(d => d.id === id)!).find(d => effectOf(d));
    // Reproduce what was physically observed, including substitutions. Planned intent is not
    // evidence that a particular component or connection participated in the result.
    a.method = { ruleset: world.kernel.ruleset.id, definitions, connections: structuredClone(a.connections), effect: effectOf(work!)! };
  }
  const signature = methodSignature(a.method);
  learn(world, p, { key: `experiment:${signature}`, kind: 'fact', claim: { experiment: true, signature, success, reason: a.lastReason, eventId: a.lastEvent, laborSeconds: a.laborSeconds, inputJ: a.inputJ, output: a.outputQuantity }, confidence: 1, source: { type: 'self', viaEvent: a.lastEvent }, cause: a.lastEvent });
  remember(world, p, { type: 'mechanism_trial', summary: `My arrangement ${a.lastReason}; ${a.inputJ.toFixed(1)} J used`, eventId: a.lastEvent, entities: [p.id], significance: 0.6, valence: success ? 0.4 : -0.2, source: { type: 'self', viaEvent: a.lastEvent } });
  if (success && !a.learned) {
    // Only observed real output makes a method. Store instance-independent instructions.
    a.learned = true;
    const key = `method:${signature}`, taught = p.knowledge[key];
    if (taught) { taught.lastConfirmedAt = world.now; taught.claim.verifiedEvent = a.lastEvent; }
    else learn(world, p, { key, kind: 'technique', claim: { method: structuredClone(a.method), eventId: a.lastEvent, significance: 0.7 }, confidence: 0.9, source: { type: 'self', viaEvent: a.lastEvent }, cause: a.lastEvent });
  }
}
