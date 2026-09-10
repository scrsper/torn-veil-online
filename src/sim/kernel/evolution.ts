import { portsMatch } from './definitions';
import type { Person } from '../core/types';
import type { World } from '../core/world';
import type { Assembly, Bindings, Component, Connection, Method } from './types';
import { connect, disconnect, dismantle, mayUseProperty, reachable, owns } from './mechanics';
import { cognitiveCapability, clamp } from '../core/human';
import { skillOf, practiceSkill } from '../core/skills';
import { getPhysicalCapability } from '../core/attributes';
import { bestToolFor, toolWorkMultiplier, wearTool } from '../core/tools';

export interface MechanicalEvidence {
  assemblyId: string; pos: { x: number; y: number; z: number }; eventId: string;
  parts: { index: number; componentId: string; definition?: string; wear?: 'worn' | 'cracked'; role?: string }[];
  joints: Connection[];
  looseEnds: number[];
  powered?: boolean;
  bindings: Partial<Bindings>;
}
export function apparentWear(p: Person, component: Component): 'worn' | 'cracked' | undefined {
  return (1 - component.condition) * cognitiveCapability(p).observation >= 0.35
    ? component.condition <= 0.15 ? 'cracked' : 'worn' : undefined;
}
/** Observation is an intentionally lossy surface measurement. No intended method, hidden
 * graph, exact condition/efficiency, creator knowledge or past output counters are returned. */
export function inspectAssembly(world: World, p: Person, a: Assembly, cause?: string): MechanicalEvidence | null {
  if (!reachable(world, p, a.pos)) return null;
  const acuity = cognitiveCapability(p).observation;
  const parts = a.parts.flatMap((id, index) => {
    const c = world.kernel.components.find(c => c.id === id); if (!c) return [];
    const d = world.kernel.ruleset.components.find(d => d.id === c.definition);
    const familiar = Object.values(p.knowledge).some(k => k.confidence > 0.2 && k.claim.component?.id === c.definition);
    const wear = apparentWear(p, c);
    return [{ index, componentId: id, definition: familiar ? c.definition : undefined, role: familiar ? d?.kind : undefined, wear }];
  });
  // Small couplings are harder to distinguish than large moving parts. An unseen joint is
  // absent from the observer's map, never a proof of disconnection.
  const joints = a.connections.filter((_, i) => acuity * (0.95 - i * 0.16) >= 0.82).map(e => ({ ...e }));
  const looseEnds = acuity >= 0.95 ? parts.filter(part => {
    const d = world.kernel.ruleset.components.find(d => d.id === part.definition);
    return d?.output && !a.connections.some(e => e.from === part.index);
  }).map(part => part.index) : [];
  const source = world.kernel.energy.find(e => e.id === a.bindings.energyId);
  const powered = source && reachable(world, p, source.pos) && acuity >= 0.85 ? source.maxPowerW > 0 && source.remainingJ > 0 : undefined;
  const bindings: Partial<Bindings> = { placeId: world.placeAt(a.pos)?.id };
  if (source && reachable(world, p, source.pos)) bindings.energyId = source.id;
  for (const key of ['inputId', 'outputId'] as const) {
    const reservoir = world.kernel.reservoirs.find(r => r.id === a.bindings[key]);
    if (reservoir && reachable(world, p, reservoir.pos)) bindings[key] = reservoir.id;
  }
  const ev = world.emit('mechanism_inspected', { actor: p.id, pos: a.pos, causes: [a.lastEvent, cause].filter((x): x is string => !!x),
    visibility: 7, significance: 0.25, data: { assemblyId: a.id }, summary: `${p.name} examined a mechanism` });
  return { assemblyId: a.id, pos: { ...a.pos }, eventId: ev.id, parts, joints, looseEnds, powered, bindings };
}

export type MechanicalWork = { kind: 'replace'; part: number; componentId: string }
  | { kind: 'connect' | 'disconnect'; from: number; to: number } | { kind: 'dismantle' };
export function fittingCompetence(p: Person): number {
  // Practical skill dominates intellect; intellect is useful to diagnosis, not magic hands.
  return clamp(0.12 + skillOf(p, 'crafting') * 0.7 + p.attributes.dexterity * 0.01 + p.attributes.intellect * 0.002, 0.08, 0.96);
}
/** Paid physical attempt. Progress belongs to this action, preventing one person's partial
 * work on a different component from authorizing a free replacement. No condition reset. */
export function workOnAssembly(world: World, p: Person, a: Assembly, task: MechanicalWork, progress: { labor?: number; work?: number }, seconds: number, cause?: string): 'working' | 'fitted' | 'damaged' | 'unavailable' {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60 || !reachable(world, p, a.pos) || !mayUseProperty(world, p, a.ownerId, a.bindings.placeId)) return 'unavailable';
  const capability = getPhysicalCapability(p, world); if (capability.currentExertionCapacity <= 0.15) return 'unavailable';
  const old = task.kind === 'replace' ? world.kernel.components.find(c => c.id === a.parts[task.part]) : undefined;
  const replacement = task.kind === 'replace' ? world.kernel.components.find(c => c.id === task.componentId) : undefined;
  if (task.kind === 'replace' && (!old || !replacement || old.id === replacement.id || replacement.assemblyId || replacement.holderId && replacement.holderId !== p.id
    || !mayUseProperty(world, p, replacement.ownerId, a.bindings.placeId) || !reachable(world, p, replacement.holderId === p.id ? a.pos : replacement.pos))) return 'unavailable';
  const d = old && world.kernel.ruleset.components.find(d => d.id === old.definition);
  const required = task.kind === 'replace' ? 3 + (d?.massKg ?? 2) : task.kind === 'dismantle' ? 2 + a.parts.length : 2;
  const candidateTool = bestToolFor(world, p, 'construct', a.bindings.placeId);
  const tool = candidateTool && mayUseProperty(world, p, candidateTool.ownerId, a.bindings.placeId) ? candidateTool : null;
  const physical = clamp(0.6 + p.attributes.strength / 40, 0.5, 1.2) * capability.currentExertionCapacity;
  const rate = (0.4 + fittingCompetence(p)) * toolWorkMultiplier('construct', tool) * physical;
  const spent = Math.min(seconds, Math.max(0, required - (progress.work ?? 0)) / rate);
  progress.work = (progress.work ?? 0) + spent * rate; progress.labor = (progress.labor ?? 0) + spent; a.laborSeconds += spent;
  wearTool(world, tool, spent / 3600);
  if (progress.work < required - 1e-9) return 'working';
  let result: 'fitted' | 'damaged' = 'fitted';
  const before = a.lastEvent;
  if (task.kind === 'replace') {
    const precision = fittingCompetence(p) * (tool ? 1 : 0.75);
    if (world.rng.next() > precision) {
      old!.condition = Math.max(0, old!.condition - 0.1); replacement!.condition = Math.max(0, replacement!.condition - 0.15); result = 'damaged';
    } else {
      old!.assemblyId = null; old!.holderId = null; old!.pos = { ...a.pos };
      replacement!.assemblyId = a.id; replacement!.holderId = null; replacement!.ownerId = a.ownerId; replacement!.pos = { ...a.pos };
      a.parts[task.part] = replacement!.id;
      const definitions = a.parts.map(id => world.kernel.ruleset.components.find(d => d.id === world.kernel.components.find(c => c.id === id)!.definition)!);
      a.connections = a.connections.filter(edge => portsMatch(definitions[edge.from].output, definitions[edge.to].input));
      // Fitting is not proof that a substitute works. Incompatible material/ports/power limits
      // remain real and are tested by operateAssembly.
      practiceSkill(p, 'crafting', 0.3, world);
    }
  } else {
    // Existing graph validators remain authoritative. Employee permission is checked above;
    // helpers now use the same property permission for these operations.
    if (task.kind === 'connect') {
      a.progress[`join:${task.from}:${task.to}`] = 0.5;
      if (!connect(world, p, a, task.from, task.to)) result = 'damaged';
    } else if (task.kind === 'disconnect') { if (!disconnect(world, p, a, task.from, task.to)) result = 'damaged'; }
    else if (!dismantle(world, p, a)) result = 'damaged';
  }
  const ev = world.emit('mechanism_worked', { actor: p.id, pos: a.pos, visibility: 8, loudness: 4, significance: 0.4,
    causes: [before, cause, replacement?.madeEvent].filter((x): x is string => !!x), data: { assemblyId: a.id, operation: task.kind, outcome: result,
      laborSeconds: progress.labor, oldComponent: old?.id, replacement: replacement?.id, toolId: tool?.id }, summary: `${p.name} attempted ${task.kind}: ${result}` });
  a.lastEvent = ev.id; a.tested = false;
  recordTechnology(world, a, ev.id, task.kind, before ? [before] : []);
  return result;
}

/** Physical history, not a globally known method or global version. */
export function recordTechnology(world: World, a: Assembly, eventId: string, operation: string, parents: string[]): void {
  const method: Method = { ruleset: world.kernel.ruleset.id,
    definitions: a.parts.map(id => world.kernel.components.find(c => c.id === id)!.definition),
    connections: a.connections.map(c => ({ ...c })), effect: a.method.effect, provenance: [eventId] };
  (a.history ??= []).push({ eventId, operation, parents: [...new Set(parents)], method });
}
