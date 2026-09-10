import type { Action, Goal, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import type { Assembly, Bindings, ComponentDefinition, Method } from '../kernel/types';
import { portsMatch } from '../kernel/definitions';
import { acquireComponent, connect, contributeAssemblyLabor, dismantle, distance, installComponent, operateAssembly, owns, reachable, startAssembly, mayUseProperty, mayOperate, understandsAssembly } from '../kernel/mechanics';
import { stockItemsAt } from '../world/stock';
import { learn } from './knowledge';
import { remember } from './memory';
import { getPhysicalCapability } from '../core/attributes';
import { fulfillProductionRequest } from '../world/production';
import type { ProductionOpportunity } from './productionOpportunity';
import { manufactureComponent, manufactureStock } from '../kernel/manufacture';
import { canConsiderManufacture, componentSupplyPlan, knownComponents, observeMaterialSources } from './componentSupply';
import { cognitiveCapability, clamp } from '../core/human';
import { develop, developThroughUnderstanding } from '../core/development';

/** Local inspection can reveal damage, never a hidden method or unknown physical law.
 * Acuity changes the minimum discriminable signal; repeated looks at the same mark don't train. */
export function observeMechanisms(world: World, p: Person): void {
  const acuity = cognitiveCapability(p).observation;
  const local = world.kernel.components.filter(c => reachable(world, p, c.pos) && (!c.holderId || c.holderId === p.id)).slice(0, 8);
  for (const c of local) {
    const damage = 1 - c.condition;
    if (damage * acuity < 0.15) continue;
    const key = `mechanism-damage:${c.id}`, existing = p.knowledge[key];
    const detail = Math.round(damage * 10 * acuity) / (10 * acuity);
    if (existing && Math.abs(existing.claim.damage - detail) < 0.05) continue;
    const a = world.kernel.assemblies.find(a => a.id === c.assemblyId);
    const ev = world.emit('mechanism_observed', { actor: p.id, pos: c.pos, category: 'cognition', significance: 0.3,
      causes: a?.lastEvent ? [a.lastEvent] : [], data: { componentId: c.id, observedDamage: detail }, summary: `${p.name} noticed wear in a mechanical component` });
    // Re-observation replaces an old measurement, like inventory observation below.
    if (existing) { existing.claim.damage = detail; existing.source = { type: 'witnessed', viaEvent: ev.id }; existing.learnedAt = world.now; }
    else learn(world, p, { key, kind: 'fact', claim: { componentId: c.id, assemblyId: a?.id, damage: detail }, confidence: 0.8,
      source: { type: 'witnessed', viaEvent: ev.id } }, true);
  }
}

export interface PracticalNeed { effect: string; targetQuantity: number; bindings: Bindings; pos: { x: number; y: number; z: number }; requestId?: string; pressure?: number }
export const methodSignature = (m: Method) => JSON.stringify([m.ruleset, m.definitions, m.connections, m.effect]);
export const methodsHeld = (p: Person): KnowledgeItem[] => Object.values(p.knowledge).filter(k => k.kind === 'technique' && k.claim.method);
export function teachPrimitive(world: World, p: Person, definition: ComponentDefinition): void {
  learn(world, p, { key: `component:${definition.id}`, kind: 'affordance', claim: { component: structuredClone(definition), material: structuredClone(world.kernel.ruleset.materials.find(m => m.id === definition.material)) }, confidence: 1, source: { type: 'prior' } }, true);
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
    quantity = stockItemsAt(world, material.legacyItem, place.id).filter(i => mayUseProperty(world, p, i.ownerId, place.id)).reduce((n, i) => n + i.quantity, 0);
  }
  const observationKey = `observed:${key}`, observation = p.knowledge[observationKey];
  if (observation) {
    // A fresh direct inventory observation replaces the prior measurement. learn()'s normal
    // confidence/hops arbitration intentionally does not refresh equal-confidence claims.
    observation.claim = { quantity, at: world.now, needKey: key }; observation.source = { type: 'witnessed' };
    observation.learnedAt = world.now; observation.lastConfirmedAt = world.now; observation.confidence = 1; observation.hops = 0;
  } else learn(world, p, { key: observationKey, kind: 'fact', claim: { quantity, at: world.now, needKey: key }, confidence: 1, source: { type: 'witnessed' } }, true);
  return quantity;
}
const effectOf = (c: ComponentDefinition): string | undefined => c.kind === 'process' ? c.process : c.kind === 'transfer' ? `transfer:${c.phase}` : undefined;

function projectFor(world: World, p: Person, key: string, need: PracticalNeed): Assembly | undefined {
  return world.kernel.assemblies.find(a => a.ownerId === p.id && (a.creatorId ?? a.ownerId) === p.id && a.needKey === key && (a.parts.length > 0 || !a.tested))
    ?? world.kernel.assemblies.find(a => a.learned && a.parts.length > 0 && a.method.effect === need.effect
      && a.bindings.placeId === need.bindings.placeId && mayOperate(world, p, a) && understandsAssembly(p, a) && reachable(world, p, a.pos));
}

/** Infer when a replacement is physically equivalent from known properties. A cheaper stock
 * measure with identical power limits cannot cure the same observed transmission loss.
 * Unknown or different limits keep the replacement a distinct experiment. */
function physicalSignature(p: Person, method: Method): string {
  const known = knownComponents(p), materials = Object.values(p.knowledge).flatMap(k => k.confidence > 0.2 ? [k.claim.material, ...(k.claim.materials ?? [])].filter(Boolean) : []);
  const defs = method.definitions.map(id => known.find(d => d.id === id));
  if (defs.some(d => !d || !materials.some(m => m.id === d.material))) return methodSignature(method);
  return JSON.stringify([method.effect, method.connections, defs.map(d => ({ kind: d!.kind, input: d!.input, output: d!.output, efficiency: d!.efficiency,
    min: d!.minPowerW, max: d!.maxPowerW, materialMax: materials.find(m => m.id === d!.material).maxPowerW,
    process: d!.process, phase: d!.phase, joulesPerKg: d!.joulesPerKg, maxKgPerSecond: d!.maxKgPerSecond }))]);
}

/** Reconsider after an observable change, not merely after time passes. Consumption/wear from
 * the failed attempt itself is not a new opportunity to repeat the same structural mistake. */
function experimentContext(world: World, p: Person, need: PracticalNeed): string {
  const source = world.kernel.energy.find(e => e.id === need.bindings.energyId && reachable(world, p, e.pos));
  const process = world.kernel.ruleset.processes.find(d => d.id === need.effect);
  const input = world.kernel.ruleset.materials.find(m => m.id === process?.input.material)?.legacyItem;
  const inputPresent = input && need.bindings.placeId ? stockItemsAt(world, input, need.bindings.placeId).some(i => owns(p, i.ownerId) && i.quantity > 0) : world.kernel.reservoirs.some(r => r.id === need.bindings.inputId && reachable(world, p, r.pos) && r.quantity > 0);
  return JSON.stringify([need.bindings, inputPresent, source?.maxPowerW, !!source && source.remainingJ > 0]);
}

function supplyContext(world: World, p: Person, need: PracticalNeed): string {
  return JSON.stringify([
    knownComponents(p).filter(d => d.fabrication).map(d => [d.id, need.bindings.placeId ? manufactureStock(world, p, d, need.bindings.placeId) > 0 : false]),
    Object.values(p.knowledge).filter(k => k.claim.materialSource).map(k => [k.key, k.source.viaEvent]),
  ]);
}

/** Bounded graph search over beliefs, not canonical capability tables. Aggregate power is
 * deliberately unknown until attempted. Costs/order of primitive choices do not certify success.
 * No finished topology is supplied by the scenario or selected by its names. */
export function candidateMethods(world: World, p: Person, need: PracticalNeed): Method[] {
  const visible = world.kernel.components.filter(c => !c.assemblyId && (!c.holderId || c.holderId === p.id) && owns(p, c.ownerId) && reachable(world, p, c.holderId === p.id ? need.pos : c.pos));
  const definitions = knownComponents(p);
  const available = (m: Method) => m.definitions.every((id, i) => visible.filter(c => c.definition === id).length >= m.definitions.slice(0, i + 1).filter(x => x === id).length
    || definitions.some(d => d.id === id && canConsiderManufacture(world, p, d, need.bindings.placeId)));
  const context = experimentContext(world, p, need);
  const supplies = supplyContext(world, p, need);
  const failed = new Set(Object.values(p.knowledge).filter(k => k.claim.experiment && !k.claim.success && (!k.claim.context || k.claim.context === context)
    && !(k.claim.reason === 'material unavailable' && k.claim.supplyContext !== supplies)).map(k => k.claim.signature as string));
  const physicallyFailed = new Set(Object.values(p.knowledge).filter(k => k.claim.experiment && !k.claim.success && k.claim.physicalSignature && k.claim.context === context && k.claim.reason === 'insufficient power').map(k => k.claim.physicalSignature));
  const taught = methodsHeld(p).filter(k => k.confidence > 0.2 && k.claim.method.ruleset === world.kernel.ruleset.id && k.claim.method.effect === need.effect).map(k => k.claim.method as Method).filter(available);
  const known = definitions.filter(d => visible.some(c => c.definition === d.id) || canConsiderManufacture(world, p, d, need.bindings.placeId))
    .sort((a, b) => a.massKg - b.massKg || a.id.localeCompare(b.id));
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
  for (const m of [...taught, ...methods]) if (!failed.has(methodSignature(m)) && !physicallyFailed.has(physicalSignature(p, m))) unique.set(methodSignature(m), m);
  const cost = (m: Method) => m.definitions.reduce((n, id) => n + (visible.some(c => c.definition === id) ? 0 : definitions.find(d => d.id === id)?.fabrication?.seconds ?? 0), 0);
  const instructed = new Set(taught.map(methodSignature));
  // Same 128 visits / 24 hypotheses at every INT and LOD. Reasoning quality changes the
  // ordering of known alternatives through inferred losses, not the amount of CPU purchased.
  const reasoning = Math.max(0, cognitiveCapability(p).reasoning - 1);
  const estimatedLoss = (m: Method) => 1 - m.definitions.reduce((eff, id) => eff * clamp(definitions.find(d => d.id === id)?.efficiency ?? 1, 0, 1), 1);
  return [...unique.values()].sort((a, b) => Number(instructed.has(methodSignature(b))) - Number(instructed.has(methodSignature(a)))
    || (cost(a) + estimatedLoss(a) * reasoning * 60) - (cost(b) + estimatedLoss(b) * reasoning * 60)).slice(0, 24);
}

/** Candidate goals enter agent.ts's existing G() motivation bridge and normal competition. */
export function inventionGoals(world: World, p: Person, opportunities: ProductionOpportunity[] = []): Partial<Goal>[] {
  if (!world.kernel.ruleset.components.length) return [];
  observeMaterialSources(world, p);
  observeMechanisms(world, p);
  const goals: Partial<Goal>[] = [];
  for (const o of opportunities) {
    if (!mayUseProperty(world, p, o.place.ownerId, o.place.id)) continue;
    const effect = world.kernel.ruleset.processes.find(d => world.kernel.ruleset.materials.find(m => m.id === d.output.material)?.legacyItem === o.process.output)?.id;
    const known = effect && (methodsHeld(p).some(k => k.claim.method.effect === effect) || knownComponents(p).some(d => d.process === effect));
    if (!known) continue;
    const energy = world.kernel.energy.find(e => mayUseProperty(world, p, e.ownerId, o.place.id) && reachable(world, p, e.pos));
    if (!energy) continue;
    const key = `production-need:${o.place.id}`;
    const need: PracticalNeed = { effect: effect!, targetQuantity: o.output + o.deficit, bindings: { placeId: o.place.id, energyId: energy.id }, pos: o.place.inside, requestId: o.request.id, pressure: o.pressure };
    const existing = p.knowledge[key];
    if (existing) { existing.claim = { practicalNeed: need }; existing.source = { type: 'inferred', viaEvent: o.belief.source.viaEvent }; existing.learnedAt = world.now; }
    else learn(world, p, { key, kind: 'fact', claim: { practicalNeed: need }, confidence: 0.8, source: { type: 'inferred', viaEvent: o.belief.source.viaEvent } }, true);
  }
  const capacity = getPhysicalCapability(p, world).currentExertionCapacity;
  for (const k of Object.values(p.knowledge)) {
    const need = k.claim.practicalNeed as PracticalNeed | undefined; if (!need) continue;
    const active = projectFor(world, p, k.key, need);
    if (need.requestId && !active && !opportunities.some(o => o.place.id === need.bindings.placeId)) continue;
    // A supply trip doesn't erase the observation that motivated it. Away from the bin use
    // only that remembered measurement, and verify again on return.
    const observed = observeOutput(world, p, k.key, need) ?? (active ? Number(p.knowledge[`observed:${k.key}`]?.claim.quantity) : null);
    if (observed === null || !Number.isFinite(observed) || observed >= need.targetQuantity) continue;
    if (capacity <= 0.15) continue;
    const candidate = active ? undefined : candidateMethods(world, p, need)[0];
    const method = active?.method ?? candidate;
    if (method) {
      const familiar = methodsHeld(p).some(k => methodSignature(k.claim.method) === methodSignature(method));
      const remaining = active?.learned ? 1 : method.definitions.slice(active?.parts.length ?? 0).reduce((n, id) => {
        const d = knownComponents(p).find(d => d.id === id);
        const present = world.kernel.components.some(c => c.definition === id && owns(p, c.ownerId) && !c.assemblyId && reachable(world, p, c.pos));
        return n + (d?.installSeconds ?? 2) + (present ? 0 : (d?.fabrication?.seconds ?? 0));
      }, 1) + method.connections.length * 0.5;
      const pressure = need.pressure ?? Math.min(1, (need.targetQuantity - observed) / Math.max(1, need.targetQuantity));
      const manufactured = knownComponents(p).some(d => method.definitions.includes(d.id) && d.fabrication);
      const outputPerBatch = world.kernel.ruleset.processes.find(d => d.id === method.effect)?.output.quantity ?? 1;
      const prospectiveBatches = manufactured ? Math.max(1, (need.targetQuantity - observed) / outputPerBatch) : 1;
      const setbacks = Object.values(p.knowledge).filter(b => b.claim.experiment && !b.claim.success && b.claim.needKey === k.key).length;
      // Preserve the calibrated ordinary foundation. Lower Will is more discouraged, higher
      // Will better maintains effort; both remain bounded and compete with survival/motivation.
      const persistence = clamp(1 + setbacks * 0.12 * (cognitiveCapability(p).persistence - 1), 0.5, 1.25);
      const utility = capacity * (0.18 + pressure * (0.28 + (familiar ? 0.32 : p.traits.curiosity * 0.38))) / (1 + remaining / (30 * prospectiveBatches)) * (familiar ? 1 : persistence);
      goals.push({ type: 'compose', utility, targetPos: need.pos, data: { needKey: k.key, assemblyId: active?.id, method: candidate }, reasons: [`observed ${observed.toFixed(2)}; need ${need.targetQuantity}`, `${familiar ? 'learned method' : 'uncertain experiment'}; estimated ${remaining.toFixed(1)} seconds labor`], causeEvent: k.source.viaEvent });
    }
  }
  for (const k of Object.values(p.knowledge).filter(k => k.claim.method || (k.claim.notation && methodsHeld(p).length > 0))) {
    for (const percept of p.mind.percepts) {
      const listener = world.person(percept.entityId);
      if (!listener?.alive || listener.age < 8 || percept.how !== 'saw' || percept.distance >= 3 || k.sharedWith.includes(listener.id)) continue;
      const rel = p.relationships[listener.id];
      if ((rel?.trust ?? 0) < -0.25 || (rel?.affection ?? 0) < -0.25) continue;
      // Shared work/home and MY relationship are observable reasons; never inspect the
      // listener's private needs, knowledge or wallet to decide whether to volunteer a method.
      const relevance = (p.workId && p.workId === listener.workId) || (p.homeId && p.homeId === listener.homeId) ? 0.35 : 0;
      const utility = 0.1 + relevance + p.traits.sociability * 0.2 + Math.max(0, rel?.affection ?? 0) * 0.25;
      if (utility > 0.3) goals.push({ type: 'teach_method', utility, targetEntity: listener.id, data: { key: k.key }, reasons: ['a nearby person may have use for this method', 'willingness from shared work/home and relationship'], causeEvent: k.source.viaEvent });
    }
  }
  return goals;
}

export function inventionPlan(world: World, p: Person, g: Goal): Action[] {
  const need = p.knowledge[g.data?.needKey]?.claim.practicalNeed as PracticalNeed | undefined;
  if (!need) return [];
  // Goal hysteresis intentionally retains the original Goal object. Resolve the current
  // project/candidate again when a completed plan is renewed, instead of replaying its old data.
  const a = projectFor(world, p, g.data?.needKey, need);
  const ready = a && a.parts.length === a.method.definitions.length && a.connections.length === a.method.connections.length;
  const failed = a?.tested && !a.learned && a.lastReason !== 'productive';
  const candidate = a ? undefined : candidateMethods(world, p, need)[0];
  if (!a && !candidate) return [];
  if (a && !failed && a.parts.length < a.method.definitions.length) {
    const present = world.kernel.components.some(c => c.definition === a.method.definitions[a.parts.length] && !c.assemblyId && owns(p, c.ownerId) && reachable(world, p, c.pos));
    const supply = !present ? componentSupplyPlan(world, p, a) : null;
    if (supply) return supply;
  }
  return [{ type: 'goto', pos: need.pos, status: 'pending' }, { type: ready && !failed ? 'operate_mechanism' : 'construct_mechanism', status: 'pending', data: { needKey: g.data!.needKey, assemblyId: a?.id, method: candidate, bindings: need.bindings, pos: need.pos, dismantle: failed } }];
}

/** Ordinary physical actions; progress lives with the project, so a replanned action cannot
 * mint labor or lose partial construction. Each completed step emits a canonical event. */
export function actOnMechanism(world: World, p: Person, action: Action, seconds: number): void {
  const data = action.data!;
  let a = world.kernel.assemblies.find(a => a.id === data.assemblyId);
  if (!a && action.type === 'construct_mechanism') {
    const old = world.kernel.assemblies.find(x => x.ownerId === p.id && (x.creatorId ?? x.ownerId) === p.id && x.needKey === data.needKey && !x.tested);
    a = old ?? startAssembly(world, p, data.method, data.bindings, data.pos, data.needKey) ?? undefined;
    if (a) data.assemblyId = a.id;
  }
  if (!a || !reachable(world, p, a.pos) || (action.type === 'operate_mechanism' ? !mayOperate(world, p, a) : a.ownerId !== p.id)) { action.status = 'failed'; return; }
  const body = world.bodies().find(b => b.ownerId === p.id && b.present && !b.dead && distance(b.pos, a!.pos) <= 3); if (body) body.pose = 'work';
  const spend = (key: string, required: number) => contributeAssemblyLabor(world, p, a!, key, required, seconds);
  if (action.type === 'construct_mechanism') {
    if (a.parts.length < a.method.definitions.length) {
      const index = a.parts.length, definition = a.method.definitions[index];
      const c = world.kernel.components.find(c => c.definition === definition && !c.assemblyId && owns(p, c.ownerId) && (!c.holderId || c.holderId === p.id) && reachable(world, p, c.holderId === p.id ? a!.pos : c.pos));
      if (!c) {
        const d = world.kernel.ruleset.components.find(d => d.id === definition)!;
        const result = manufactureComponent(world, p, a, d, seconds);
        if (result === 'missing' || result === 'inaccessible') {
          action.status = 'failed';
          if (result === 'missing' && !componentSupplyPlan(world, p, a)) {
            const ev = world.emit('component_supply_failed', { actor: p.id, placeId: a.bindings.placeId, pos: a.pos, causes: a.lastEvent ? [a.lastEvent] : [], visibility: 6, significance: 0.25,
              data: { assemblyId: a.id, reason: 'no known accessible material source' }, summary: `${p.name} could not supply the planned component` });
            a.lastEvent = ev.id; a.tested = true; a.lastReason = 'material unavailable'; recordTrial(world, p, a, false);
          }
        }
        return;
      }
      if (!c.holderId && !acquireComponent(world, p, c.id)) { action.status = 'failed'; return; }
      const d = world.kernel.ruleset.components.find(d => d.id === definition)!;
      if (spend(`install:${index}`, d.installSeconds) && !installComponent(world, p, a, c.id)) action.status = 'failed';
      return;
    }
    const edge = a.method.connections.find(e => !a!.connections.some(c => c.from === e.from && c.to === e.to));
    if (edge) {
      if (spend(`join:${edge.from}:${edge.to}`, 0.5) && !connect(world, p, a, edge.from, edge.to)) {
        const ev = world.emit('assembly_changed', { actor: p.id, pos: a.pos, causes: a.lastEvent ? [a.lastEvent] : [], visibility: 8, significance: 0.3,
          data: { assemblyId: a.id, operation: 'connection rejected', from: edge.from, to: edge.to }, summary: `${p.name} could not join the components` });
        a.lastEvent = ev.id; a.tested = true; a.lastReason = 'connection rejected'; recordTrial(world, p, a, false);
        data.dismantle = true;
      }
      return;
    }
    action.status = 'done'; return;
  }
  // A short one-physical-second supervised experiment. Progress and labor survive load.
  if (!spend('run', 1)) return;
  a.progress.run = 0;
  const result = operateAssembly(world, p, a, 1); a.tested = true;
  const need = p.knowledge[data.needKey]?.claim.practicalNeed as PracticalNeed | undefined;
  const request = world.requests.find(r => r.id === need?.requestId);
  if (request && result.output > 0) fulfillProductionRequest(world, request, p, result.output);
  recordTrial(world, p, a, result.output > 0);
  if (!result.output && !a.learned && a.ownerId === p.id) {
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
    a.method = { ruleset: world.kernel.ruleset.id, definitions, connections: structuredClone(a.connections), effect: effectOf(work!)!, provenance: [a.lastEvent!].filter(Boolean) };
  }
  const signature = methodSignature(a.method);
  const need = p.knowledge[a.needKey ?? '']?.claim.practicalNeed as PracticalNeed | undefined;
  const context = need ? experimentContext(world, p, need) : undefined;
  const trialKey = `experiment:${signature}:${context ?? ''}`;
  const novel = !p.knowledge[trialKey];
  learn(world, p, { key: trialKey, kind: 'fact', claim: { experiment: true, needKey: a.needKey, signature, physicalSignature: physicalSignature(p, a.method), context, supplyContext: need ? supplyContext(world, p, need) : undefined, success, reason: a.lastReason, eventId: a.lastEvent, laborSeconds: a.laborSeconds, inputJ: a.inputJ, output: a.outputQuantity }, confidence: 1, source: { type: 'self', viaEvent: a.lastEvent }, cause: a.lastEvent });
  if (novel) {
    developThroughUnderstanding(world, p, trialKey, a.method.connections.length + 1, Math.min(60, a.laborSeconds), a.lastEvent);
    develop(world, p, { weights: { perception: 0.5, will: 0.5 }, seconds: Math.min(60, a.laborSeconds), intensity: 0.6, causeEventId: a.lastEvent });
  }
  remember(world, p, { type: 'mechanism_trial', summary: `My arrangement ${a.lastReason}; ${a.inputJ.toFixed(1)} J used`, eventId: a.lastEvent, entities: [p.id], significance: 0.6, valence: success ? 0.4 : -0.2, source: { type: 'self', viaEvent: a.lastEvent } });
  if (success && !a.learned) {
    // Only observed real output makes a method. Store instance-independent instructions.
    a.learned = true;
    const key = `method:${signature}`, taught = p.knowledge[key];
    const ev = world.emit(taught ? 'method_reproduced' : 'method_discovered', { actor: p.id, pos: a.pos, placeId: a.bindings.placeId,
      category: 'history', visibility: 8, significance: 0.85, causes: [...new Set([a.lastEvent, taught?.source.viaEvent].filter((id): id is string => !!id))],
      data: { key, assemblyId: a.id, method: structuredClone(a.method), learnedFrom: taught?.source, componentIds: [...a.parts] },
      summary: `${p.name} ${taught ? 'reproduced learned instructions in a separate working assembly' : 'discovered a working practical method'}` });
    a.lastEvent = ev.id;
    if (taught) { taught.lastConfirmedAt = world.now; taught.claim.verifiedEvent = a.lastEvent; }
    else learn(world, p, { key, kind: 'technique', claim: { method: structuredClone(a.method), components: a.method.definitions.map(id => structuredClone(world.kernel.ruleset.components.find(d => d.id === id)!)),
      materials: Object.values(p.knowledge).filter(k => k.claim.material).map(k => structuredClone(k.claim.material)), eventId: a.lastEvent, significance: 0.7 }, confidence: 0.9, source: { type: 'self', viaEvent: a.lastEvent }, cause: a.lastEvent });
  }
}
