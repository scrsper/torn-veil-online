import { createHash } from 'node:crypto';
import { agencyWorkshop } from '../agency/showcase';
import { advanceKernelLab } from '../kernel/lab';
import { introduce, knownName } from '../../sim/mind/people';
import { observableSignature, readRecognition } from '../../sim/mind/encounter';
import { isExternallyControlled } from '../../sim/runtime/controllers';
import { serialize, deserialize } from '../../sim/persist/save';
import { Simulation } from '../../sim/mind/agent';
import type { World } from '../../sim/core/world';
import type { Action } from '../../sim/core/types';
import { B } from '../../sim/physical/blocks';
import { inspectAgency } from '../../sim/runtime/agencyInspection';

export interface AgencyWorldLabReport {
  seed: number; initialConditions: Record<string, unknown>; actions: Record<string, unknown>;
  outcomes: Record<string, unknown>; observerViews: Record<string, unknown>; invariantErrors: string[]; digest: string;
}

function digest(world: World): string {
  const parsed = JSON.parse(serialize(world));
  delete parsed.savedAt;
  const sorted = (value: any): any => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(sorted(parsed))).digest('hex');
}
function advance(world: World, sim: Simulation, seconds: number): void { advanceKernelLab(world, sim, seconds); }

/** Deterministic, disclosed-input agency slice. NPC cognition remains autonomous after setup. */
export function runAgencyWorldLab(seed = 741): AgencyWorldLabReport {
  const scene = agencyWorkshop(seed), { world, sim, a, b, c, avatar } = scene;
  const ab = world.primaryBody(a.id)!, bb = world.primaryBody(b.id)!, cb = world.primaryBody(c.id)!, vb = world.primaryBody(avatar.id)!;
  // Disclosed initial conditions: two residents and a visitor share a workplace; the controlled
  // stranger begins nearby. Needs are favorable so social/combat evidence, rather than starvation,
  // is the dominant cause of decisions.
  a.needs.social = b.needs.social = c.needs.social = 0.8;
  c.needs.social = 0.3;
  a.traits.courage = 1; a.traits.sociability = 0.9;
  ab.pos = { x: 10, y: 1, z: 10 }; bb.pos = { x: 17, y: 1, z: 10 }; cb.pos = { x: 10, y: 1, z: 12 }; vb.pos = { x: 10, y: 1, z: 11 };
  vb.yaw = Math.PI; cb.yaw = Math.PI;
  for (let z = 5; z <= 14; z++) for (let y = 1; y <= 3; y++) world.grid.set(14, y, z, B.Stone);
  world.nav.rebuildAll();
  const initial = { residents: [a.id, b.id, c.id], controlledStranger: avatar.id, workplace: scene.place.id, initialGoals: [a, b, c].map(p => p.mind.goal?.type ?? null) };

  // Human supplied actions use canonical introduction and combat. No NPC goal/plan is planted.
  advance(world, sim, 0.3);
  const firstLabel = knownName(a, avatar.id);
  const introduction = introduce(world, avatar, a);
  const attack = sim.resolveAttack({ attackerId: avatar.id, attackerBodyId: vb.id, targetBodyId: cb.id, attackMode: 'strike', intent: 'injure' });
  advance(world, sim, 12);
  const hearsayBefore = Object.values(b.knowledge).filter(k => k.claim.actor === avatar.id || k.claim.target === avatar.id).length;
  // Let the autonomous minds decide and communicate. This is deliberately a fixed duration,
  // never a loop waiting for a desired event.
  advance(world, sim, 108);
  const npcGoals = [a, b, c].map(p => ({ id: p.id, goal: p.mind.goal?.type ?? null, decisions: world.events.filter(e => e.type === 'goal_changed' && e.actor === p.id).map(e => ({ event: e.id, to: e.data.to, reasons: e.data.reasons, beliefInputs: e.data.beliefInputs, causes: e.causes })) }));
  // Human departure/return is a canonical movement intention handled by Simulation's action path.
  sim.submitIntention(avatar, { type: 'goto', pos: { x: 17, y: 1, z: 10 }, status: 'pending' } as Action); advance(world, sim, 20);
  const departurePosition = { ...vb.pos };
  const visibleAtDeparture = a.mind.percepts.some(pc => pc.bodyId === vb.id && pc.how === 'saw');
  sim.submitIntention(avatar, { type: 'goto', pos: { x: 10, y: 1, z: 11 }, status: 'pending' } as Action); advance(world, sim, 20);
  const returnedPercept = a.mind.percepts.find(pc => pc.bodyId === vb.id && pc.how === 'saw');
  const recognition = returnedPercept ? readRecognition(a, avatar.id, vb.id, observableSignature(world, vb)) : null;
  const saved = serialize(world), restored = deserialize(saved)!.world, resumed = new Simulation(restored);
  advance(world, sim, 3); advance(restored, resumed, 3);
  const saveReplayMatches = digest(world) === digest(restored);
  const errors: string[] = [];
  for (const p of [a, b, c, avatar]) {
    for (const id of p.bodies) if (!world.body(id)) errors.push(`missing body ${p.id}:${id}`);
    if (isExternallyControlled(p) !== (p.id === avatar.id)) errors.push(`control boundary ${p.id}`);
  }
  if (!attack.attempted) errors.push(`attack rejected: ${attack.rejection ?? 'unknown'}`);
  const indirect = Object.values(b.knowledge).filter(k => k.kind === 'event' && k.claim.actor === avatar.id && k.source.type === 'told');
  return { seed, initialConditions: { ...initial, separation: 'stone partition with open route around its north end', favorableNeeds: true, witnessCourage: a.traits.courage, witnessSociability: a.traits.sociability }, actions: { introduction, attack: { attempted: attack.attempted, rejection: attack.rejection }, departurePosition, visibleAtDeparture, returnPosition: { ...vb.pos } }, outcomes: {
    saveReplayMatches,
    firstLabel, indirectKnowledge: indirect.map(k => ({ key: k.key, claim: k.claim, source: k.source, confidence: k.confidence, hops: k.hops })),
    attackEvents: world.events.filter(e => ['attack', 'attack_missed'].includes(e.type) && e.actor === avatar.id).map(e => ({ id: e.id, type: e.type, at: e.tick, perceivedBy: e.perceivedBy })),
    autonomousNpcGoals: npcGoals, hearsayBefore, hearsayAfter: Object.values(b.knowledge).filter(k => k.claim.actor === avatar.id || k.claim.target === avatar.id).length,
    recognition: recognition ? { level: recognition } : null,
    residentLabelAfterReturn: knownName(a, avatar.id), retainedSignature: observableSignature(world, vb), readBack: readRecognition(a, avatar.id, vb.id, observableSignature(world, vb)),
  }, observerViews: { residentA: inspectAgency(world, a.id, avatar.id), residentB: inspectAgency(world, b.id, avatar.id), visitor: inspectAgency(world, c.id, avatar.id) }, invariantErrors: errors, digest: digest(world) };
}
