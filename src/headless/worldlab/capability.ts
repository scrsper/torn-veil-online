import { agencyWorkshop } from '../agency/showcase';
import { createComponent } from '../../sim/kernel/mechanics';
import { workOnAssembly } from '../../sim/kernel/evolution';
import { serialize, deserialize } from '../../sim/persist/save';
import { assessAdvancement, advanceToIron } from '../../sim/core/advancement';
import { attributeProfile } from '../../sim/core/human';
import { learn } from '../../sim/mind/knowledge';
import { buildChronicle } from '../../sim/history/chronicle';
import type { World } from '../../sim/core/world';
import type { Person } from '../../sim/core/types';

/** Explicit synthetic near-threshold history. It is never part of ordinary world generation.
 * The three dated records summarize authored past practice; no lifetime simulation is claimed. */
export function initializeNearIronFixture(world: World, person: Person) {
  person.attributes = attributeProfile(15); person.skills.crafting = 0.8;
  person.physiology.energy = person.physiology.hydration = 0.95;
  person.physiology.fatigue = person.physiology.sleepDebt = 0;
  const now = world.now, events: string[] = [];
  for (let day = 2; day >= 0; day--) {
    world.clock.worldSeconds = now - day * 86400;
    const e = world.emit('mechanism_worked', { actor: person.id, significance: 0,
      data: { fixture: true, operation: 'replace', outcome: 'fitted', laborSeconds: 3600, capabilityCredits: { [person.id]: 3600 } },
      summary: 'Synthetic near-Iron fixture: earlier paid fitting experience' });
    events.push(e.id);
  }
  world.clock.worldSeconds = now;
  person.capability = { bySkill: { crafting: { effectiveSeconds: 8 * 3600 - 0.1, actions: 100, lastTick: now, lastEventId: events.at(-1)!, sourceEventIds: events } },
    creditedEventIds: [...events], repetitionCounts: {}, recent: [], dailySeconds: 0, dailyRawSeconds: 0, day: Math.floor(now / 86400) };
  const lesson = world.emit('told', { actor: person.id, target: person.id, significance: 0, data: { fixture: true, skill: 'crafting' }, summary: 'Synthetic fixture: prior instruction in fitting' });
  learn(world, person, { key: 'technique:crafting', kind: 'technique', claim: { skill: 'crafting' }, confidence: 0.8, source: { type: 'prior', viaEvent: lesson.id } }, true);
}

export function runCapabilityWorldLab(seed = 912) {
  const scene = agencyWorkshop(seed), { world, a: p, assembly } = scene;
  const before = structuredClone(p.skills);
  const events: { event: string; outcome: string; seconds: number; effectiveSeconds: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const spare = createComponent(world, `${world.kernel.ruleset.id}/belt`, p.id, assembly.pos);
    const outcome = workOnAssembly(world, p, assembly, { kind: 'replace', part: 2, componentId: spare.id }, {}, 60);
    const event = [...world.events].reverse().find(e => e.type === 'mechanism_worked')!;
    events.push({ event: event.id, outcome, seconds: event.data.laborSeconds, effectiveSeconds: event.data.capabilityCredits?.[p.id] ?? 0 });
  }
  const natural = { before, after: structuredClone(p.skills), experience: structuredClone(p.capability), events, stage: p.ontology.stage };
  const loaded = deserialize(serialize(world))!.world.person(p.id)!;
  const persistenceMatches = JSON.stringify(loaded.capability) === JSON.stringify(p.capability) && JSON.stringify(loaded.skills) === JSON.stringify(p.skills);
  initializeNearIronFixture(world, p);
  const initiallyReady = assessAdvancement(world, p).eligible;
  const spare = createComponent(world, `${world.kernel.ruleset.id}/belt`, p.id, assembly.pos);
  workOnAssembly(world, p, assembly, { kind: 'replace', part: 2, componentId: spare.id }, {}, 60);
  const beforeCost = { energy: p.physiology.energy, hydration: p.physiology.hydration, fatigue: p.physiology.fatigue, conditioning: p.physiologyTraits.conditioning };
  const readiness = assessAdvancement(world, p), advanced = advanceToIron(world, p);
  return { seed, disclosedConditions: 'Existing workshop, spare parts and tools; four real paid repair attempts. Separate explicitly synthetic near-Iron history for transition test.',
    natural, persistenceMatches, breakthroughFixture: { initiallyReady, readiness, advanced, beforeCost,
      chronicle: buildChronicle(world).filter(entry => entry.sourceEventIds.includes(p.ontology.breakthroughEventId ?? '')),
      afterCost: { energy: p.physiology.energy, hydration: p.physiology.hydration, fatigue: p.physiology.fatigue, conditioning: p.physiologyTraits.conditioning }, stage: p.ontology.stage } };
}
