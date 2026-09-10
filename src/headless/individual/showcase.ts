import type { Person, Action } from '../../sim/core/types';
import type { World } from '../../sim/core/world';
import { attributeProfile, ironEligible } from '../../sim/core/human';
import { develop } from '../../sim/core/development';
import { newWorld, serialize, deserialize } from '../../sim/persist/save';
import { makePerson, makeBody, makeItem } from '../../sim/world/factory';
import { giveBirth, diePerson } from '../../sim/world/demographics';
import { Simulation } from '../../sim/mind/agent';
import { genealogyKey, genealogicalBeliefs, inferGenealogy } from '../../sim/mind/genealogy';
import { actOnRecord, teachNotation } from '../../sim/mind/records';
import { householdConsistencyErrors } from '../../sim/world/household';
import { createKernelLab, advanceKernelLab, kernelMetrics } from '../kernel/lab';

const DAY = 86400, YEAR = 365 * DAY;
function resident(world: World, name: string, homeId: string, gender: 'm' | 'f' = 'f'): Person {
  const p = makePerson(world, { name, gender, age: 18, occupation: 'villager', home: homeId, traits: {}, appearance: {}, bio: 'Controlled conditions for a bounded generational exposure experiment.',
    attributes: attributeProfile(8), attributePotential: attributeProfile(10) });
  const body = makeBody(world, p.id, world.place(homeId)!.inside); p.bodies.push(body.id);
  p.physiology.energy = p.physiology.hydration = 1; p.physiology.fatigue = p.physiology.sleepDebt = 0;
  return p;
}
function birth(world: World, parent: Person, other: Person): Person {
  // An explicit pregnancy fixture. No guarantee of conception/survival in ordinary worlds.
  world.clock.worldSeconds += YEAR;
  parent.age = Math.floor((world.now - parent.birthTick) / YEAR); other.age = Math.floor((world.now - other.birthTick) / YEAR);
  const event = world.emit('pregnancy_started', { actor: parent.id, target: other.id, category: 'history', data: { acceptanceFixture: true } });
  parent.physiology.pregnancy = { gestationalParentId: parent.id, otherParentId: other.id, conceivedAt: world.now - 280 * DAY, dueAt: world.now,
    state: 'gestating', lastProgressAt: world.now, causeEventId: event.id };
  return giveBirth(world, parent)!;
}
function siblings(world: World, a: Person, b: Person, count = 12): Person[] {
  return Array.from({ length: count }, () => birth(world, a, b));
}
function dailyExposure(world: World, p: Person, days: number): void {
  for (let i = 0; i < days; i++) {
    world.clock.worldSeconds += DAY;
    develop(world, p, { weights: { strength: 1, endurance: 0.8, vitality: 0.1, will: 0.3 }, seconds: 8 * 3600, intensity: 1 });
  }
  p.age = Math.floor((world.now - p.birthTick) / YEAR);
}
function populationState(world: World) {
  return world.persons().map(p => ({ id: p.id, attributes: p.attributes, potential: p.attributePotential, development: p.development, lineage: p.lineage, ontology: p.ontology, knowledge: p.knowledge }));
}

/** Deliberately bounded model-level exposure experiment, not a detailed 70-year world run.
 * Births, inheritance, title transfer, inscriptions, testimony, and discovery execute canonical
 * mechanics. Long intervals replay daily development stimuli under disclosed stable conditions.
 * This proves a possible pathway; it does not simulate food, jobs or survival in skipped years. */
export function runIndividualShowcase(seed = 0) {
  const { world, gen } = newWorld(seed);
  const home = gen.places.tavern;
  const ancestor = resident(world, 'First generation', home.id, 'm'); ancestor.attributePotential.strength = 14;
  // Starting at ordinary developed 8, not a pre-issued exceptional acquired attribute.
  dailyExposure(world, ancestor, 30 * 365);
  const imprint = ancestor.lineage.imprints.find(i => i.attribute === 'strength');
  const mate = resident(world, 'First partner', home.id);
  const children = siblings(world, mate, ancestor);
  const carrier = children.find(p => p.lineage.imprints.some(i => i.id === imprint?.id) && p.lineage.expressed.strength === 0);
  if (!imprint || !carrier) return { seed, pathway: false, reason: 'No qualifying imprint or unexpressed carrier in this bounded family', ancestor: { strength: ancestor.attributes.strength, imprints: ancestor.lineage.imprints.length } };

  // Real inscription of a known parent relationship; no future descendant is named in it.
  home.ownerId = ancestor.id; teachNotation(world, ancestor);
  const key = genealogyKey({ subjectId: carrier.id, relativeId: ancestor.id, relationship: 'parent' });
  makeItem(world, 'plank', 'Inscription substrate', { owner: ancestor.id, placeId: home.id, pos: home.inside, quantity: 1 });
  const write: Action = { type: 'write_record', status: 'pending', placeId: home.id, data: { key } };
  actOnRecord(world, ancestor, write, 60);
  if (write.status !== 'done') throw new Error('The ancestor could not make the physical record');
  const record = world.items().find(i => i.record?.knowledge.key === key)!;
  // Estate machinery chooses actual recipients. Physical placement gives descendants access.
  diePerson(world, ancestor, undefined, 'end of the controlled founder biography');

  world.clock.worldSeconds += 20 * YEAR;
  carrier.age = Math.floor((world.now - carrier.birthTick) / YEAR);
  const secondPartner = resident(world, 'Second partner', home.id, carrier.gender === 'm' ? 'f' : 'm');
  const mother = carrier.gender === 'f' ? carrier : secondPartner, father = carrier.gender === 'm' ? carrier : secondPartner;
  const grandchildren = siblings(world, mother, father);
  const descendant = grandchildren.find(p => p.lineage.expressed.strength > 0 && p.lineage.imprints.some(i => i.id === imprint.id));
  const sibling = grandchildren.find(p => !p.lineage.expressed.strength);
  if (!descendant || !sibling) return { seed, pathway: false, reason: 'This bounded later family did not contain both expression outcomes' };
  const inherited = JSON.stringify([descendant.attributePotential, descendant.lineage]);
  const unknownBefore = genealogicalBeliefs(descendant).length === 0;
  world.clock.worldSeconds += 18 * YEAR; descendant.age = Math.floor((world.now - descendant.birthTick) / YEAR);
  const sim = new Simulation(world);
  const selfParent = genealogyKey({ subjectId: descendant.id, relativeId: carrier.id, relationship: 'parent' });
  sim.tell(carrier, descendant, carrier.knowledge[selfParent]);
  // The estate title is preserved. A later explicit loan gives physical reading access.
  const loan = world.emit('gift', { actor: record.ownerId ?? undefined, target: descendant.id, item: record.id, category: 'history',
    data: { loan: true }, causes: record.provenance.at(-1)?.eventId ? [record.provenance.at(-1)!.eventId!] : [] });
  record.holderId = descendant.id; descendant.inventory.push(record.id);
  record.provenance.push({ tick: world.now, eventId: loan.id, from: record.ownerId, to: descendant.id, how: 'family record loan' });
  teachNotation(world, descendant);
  const read: Action = { type: 'read_record', status: 'pending', data: { recordId: record.id } };
  actOnRecord(world, descendant, read, 60); inferGenealogy(world, descendant);
  const ancestorBelief = genealogicalBeliefs(descendant).find(k => k.claim.genealogy.subjectId === descendant.id && k.claim.genealogy.relativeId === ancestor.id);

  const loaded = deserialize(serialize(world))!.world;
  dailyExposure(world, descendant, 20); dailyExposure(loaded, loaded.person(descendant.id)!, 20);
  const exactContinuation = JSON.stringify(populationState(world)) === JSON.stringify(populationState(loaded)) && world.demographicRng.state() === loaded.demographicRng.state();
  const ceiling = resident(world, 'Specialist foundation', home.id, 'm'); ceiling.attributes.strength = 20;
  develop(world, ceiling, { weights: { strength: 1 }, seconds: 28800, intensity: 1 });
  const atCeiling = { strength: ceiling.attributes.strength, ironEligible: ironEligible(ceiling) };
  ceiling.attributes = attributeProfile(15);

  return { seed, pathway: true,
    semantics: 'Daily standardized activity exposure under fixed healthy conditions; intervening economy, mortality and detailed decisions are not simulated. Controlled pregnancies and initial literacy; real canonical inheritance, records, estate and knowledge mechanics.',
    founder: { id: ancestor.id, potential: ancestor.attributePotential.strength, developed: ancestor.attributes.strength, yearsOfExposure: 30, imprint },
    siblings: children.slice(0, 4).map(p => ({ id: p.id, potential: p.attributePotential, expressed: p.lineage.expressed.strength })),
    hiddenCarrier: { id: carrier.id, expressed: carrier.lineage.expressed.strength },
    later: [descendant, sibling].map(p => ({ id: p.id, strengthPotential: p.attributePotential.strength, expressed: p.lineage.expressed.strength, imprints: p.lineage.imprints.map(i => ({ origin: i.originPersonId, distance: i.generationDistance })), expressions: p.lineage.expressions })),
    ancestry: { unknownBefore, discovered: !!ancestorBelief, source: ancestorBelief?.source, premises: ancestorBelief?.claim.premises, recordId: record.id,
      readingSource: descendant.knowledge[key]?.source, inheritanceUnchanged: inherited === JSON.stringify([descendant.attributePotential, descendant.lineage]) },
    exactContinuation, householdErrors: householdConsistencyErrors(world), atCeiling,
    readiness: { eligible: ironEligible(ceiling), stage: ceiling.ontology.stage },
  };
}

/** Autonomous choices are measured separately from long exposure. No disposition/potential
 * branch decides who works: the existing Simulation chooses among all ordinary goals. */
export function individualMotivationComparison() {
  return [0, 0.95].map(curiosity => {
    const lab = createKernelLab(918271), p = lab.inventor;
    p.traits.curiosity = curiosity; p.attributePotential.dexterity = curiosity === 0 ? 18 : 10;
    p.attributes.dexterity = 8; p.attributes.will = curiosity === 0 ? 8 : 18;
    advanceKernelLab(lab.world, lab.sim, 25);
    const observed = kernelMetrics(lab).people[0];
    // A controlled exposure response to repeated opportunities with the observed engagement.
    // This is explicitly an extrapolation experiment, not 20 years of autonomous decision replay.
    const engagement = Math.min(1, observed.laborSeconds / 25);
    for (let day = 0; day < 20 * 365; day++) {
      lab.world.clock.worldSeconds += DAY;
      develop(lab.world, p, { weights: { dexterity: 1, will: 0.3 }, seconds: 28800 * engagement, intensity: 1 });
    }
    return { curiosity, potential: p.attributePotential.dexterity, will: p.attributes.will, autonomousLaborSeconds: observed.laborSeconds,
      developedDexterity: p.attributes.dexterity, exposureHours: p.development.exposure.dexterity / 3600,
      semantics: '25 detailed physical seconds of ordinary decisions, followed by 20 years of controlled daily exposure scaled by observed engagement; no claim of detailed lifetime simulation.' };
  });
}
