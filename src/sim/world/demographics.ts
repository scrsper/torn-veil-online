import { witnessParenthood } from '../mind/genealogy';
import { peopleTogether, placeForPerson } from './locality';
import type { EntityId, Household, Person } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_DAY } from '../core/time';
import { annualMortalityHazard, ageInYears, lifeStageFor, physiologyProfileFor } from '../core/species';
import { makeBody, makePerson } from './factory';
import { joinHousehold, leaveHousehold, makeHousehold } from './household';
import { getRel, setRelTags } from '../mind/relationships';
import { dailyScheduleFor, stepLivelihoods } from '../mind/livelihood';
import { inheritPotential } from '../core/lineage';
import { physicalAttribute } from '../core/human';
import { develop } from '../core/development';

/**
 * The pool a newborn's given name is drawn from.
 *
 * Widened from 25 to 120 because 25 was not a naming scheme, it was a collision generator: with
 * one surname per parent line, a village that has been running for a few generations exhausts the
 * distinct `<given> <surname>` pairs and every subsequent birth falls into `generatedName`'s
 * disambiguation loop. Culturally this is still one culture's pool — a second settlement with its
 * own naming is a world-generation concern (see the site/spec work), not a longer list here.
 */
const GIVEN_NAMES = [
  'Aster', 'Briar', 'Cora', 'Dain', 'Elowen', 'Flint', 'Galen', 'Hester', 'Iris', 'Jonas',
  'Kael', 'Lark', 'Maren', 'Nico', 'Orla', 'Perrin', 'Quill', 'Rhea', 'Silas', 'Thora',
  'Una', 'Vale', 'Wren', 'Yara', 'Zev',
  'Alder', 'Anwen', 'Arden', 'Bramble', 'Brenna', 'Calder', 'Cassia', 'Cedric', 'Delwyn', 'Doran',
  'Edda', 'Emrys', 'Fenn', 'Fern', 'Gwyn', 'Hallis', 'Harrow', 'Idris', 'Ilse', 'Ivor',
  'Juniper', 'Kerrin', 'Linnet', 'Lowan', 'Maeve', 'Marrow', 'Meriel', 'Morwen', 'Neve', 'Norrin',
  'Oriel', 'Osric', 'Peran', 'Petra', 'Rennick', 'Rill', 'Rowan', 'Sable', 'Saoirse', 'Selwyn',
  'Sorrel', 'Tamsin', 'Teagan', 'Torrin', 'Ulric', 'Verity', 'Wilder', 'Winnow', 'Yestin', 'Ysolde',
  'Ansel', 'Beryl', 'Corvin', 'Dessa', 'Eirian', 'Faron', 'Greer', 'Halla', 'Ingram', 'Jessa',
  'Kelda', 'Leoric', 'Mabon', 'Nerys', 'Ovid', 'Pell', 'Rhodri', 'Senna', 'Talwyn', 'Ulla',
  'Varian', 'Wenna', 'Yarrow', 'Zephyr', 'Alys', 'Brand', 'Coel', 'Dilwen', 'Ewan', 'Fable',
  'Gareth', 'Hesper', 'Isolde', 'Jarl', 'Kirsa', 'Lorcan', 'Mireth', 'Nolwen', 'Oren', 'Pryn',
];

function partneredWith(world: World, p: Person): Person | undefined {
  return Object.entries(p.relationships)
    .filter(([, r]) => r.tags.includes('spouse') || r.tags.includes('partner'))
    .map(([id]) => world.person(id))
    .find((q): q is Person => !!q?.alive);
}

export function courtshipCompatibility(world: World, p: Person, q: Person): number {
  if (!p.alive || !q.alive || p.id === q.id || p.species !== q.species) return 0;
  const profile = physiologyProfileFor(p.species);
  if (p.age < profile.adulthoodAge || q.age < profile.adulthoodAge) return 0;
  if (p.reproductiveRole === q.reproductiveRole || partneredWith(world, p) || partneredWith(world, q)) return 0;
  const rel = p.relationships[q.id];
  if (!rel || rel.tags.some(tag => ['parent', 'child', 'sibling', 'foster'].includes(tag))) return 0;
  if (p.custody?.active || q.custody?.active) return 0;
  return Math.max(0, Math.min(1, rel.affection * 0.48 + rel.trust * 0.27 + rel.familiarity * 0.25 - rel.fear * 0.4 - rel.grudge * 0.5));
}

export function marry(world: World, a: Person, b: Person, cause?: string): boolean {
  if (!peopleTogether(world, a, b)) return false;
  if (courtshipCompatibility(world, a, b) < 0.42 || courtshipCompatibility(world, b, a) < 0.35) return false;
  setRelTags(a, b.id, 'spouse'); setRelTags(b, a.id, 'spouse');
  const ar = getRel(a, b.id); const br = getRel(b, a.id);
  ar.tags = ar.tags.filter(t => t !== 'sweetheart' && t !== 'partner');
  br.tags = br.tags.filter(t => t !== 'sweetheart' && t !== 'partner');
  ar.affection = Math.max(ar.affection, 0.6); br.affection = Math.max(br.affection, 0.6);
  ar.trust = Math.max(ar.trust, 0.5); br.trust = Math.max(br.trust, 0.5);
  let household = world.get<Household>(a.householdId) ?? world.get<Household>(b.householdId);
  if (!household || household.kind !== 'household') household = makeHousehold(world, `${a.name} and ${b.name}'s household`, a.homeId ?? b.homeId);
  joinHousehold(world, a, household); joinHousehold(world, b, household);
  const pos = world.positionOf(a.id) ?? world.positionOf(b.id);
  world.emit('marriage', { actor: a.id, target: b.id, pos, causes: cause ? [cause] : [], category: 'history', significance: 0.75, visibility: 18, loudness: 8, data: { householdId: household.id }, summary: `${a.name} married ${b.name}` });
  return true;
}

function physiologicalFitness(world: World, p: Person): number {
  const body = world.primaryBody(p.id);
  const health = body ? body.health / body.maxHealth : 0;
  // Reserves are snapshots, not binary fertility switches: a missed meal should make
  // conception less likely, while sustained deprivation also lowers health and compounds the
  // reduction. This keeps scarcity causal without making the exact midnight sample an implicit
  // global "famine disables births" rule.
  return Math.max(0, Math.min(1, health * (0.6 + p.physiology.energy * 0.25 + p.physiology.hydration * 0.15)));
}

function tryConception(world: World, p: Person): void {
  if (p.reproductiveRole !== 'gestational' || p.physiology.pregnancy?.state === 'gestating') return;
  const partner = partneredWith(world, p); if (!partner || !peopleTogether(world, p, partner)) return;
  const profile = physiologyProfileFor(p.species);
  const [min, max] = profile.fertileAges.gestational;
  const [pmin, pmax] = profile.fertileAges.fertilizing;
  if (p.age < min || p.age > max || partner.age < pmin || partner.age > pmax) return;
  const fitness = Math.min(physiologicalFitness(world, p), physiologicalFitness(world, partner));
  // Roughly 55% annual chance at excellent condition, substantially reduced by poor reserves.
  // This is an opportunity, never a guarantee; pregnancy and gestation naturally limit cadence.
  const dailyChance = (1 - Math.exp(-0.55 / 365)) * fitness * fitness;
  if (world.demographicRng.next() >= dailyChance) return;
  const ev = world.emit('pregnancy_started', { actor: p.id, target: partner.id, category: 'history', significance: 0.45, data: { fitness }, summary: `${p.name} became pregnant by ${partner.name}` });
  p.physiology.pregnancy = { gestationalParentId: p.id, otherParentId: partner.id, conceivedAt: world.now, dueAt: world.now + profile.gestationDays * SECONDS_PER_DAY, state: 'gestating', lastProgressAt: world.now, causeEventId: ev.id };
}

/**
 * A newborn's name. The two RNG draws (given name, which parent's line the surname comes from)
 * happen exactly once regardless of how many names are already taken, so the demographic stream
 * stays deterministic and independent of cumulative population.
 *
 * The taken-name check used to walk `world.persons()` — the append-only historical bucket, the
 * dead included — once per iteration of a retry loop, per birth. That is the shape the year-scale
 * substrate exists to remove: invisible at 39 people, quadratic across a lineage, and increasingly
 * likely to iterate as the pool of distinct `<given> <surname>` pairs was consumed. One pass over
 * the bucket builds the set; the loop then only reads it.
 */
function generatedName(world: World, gestationalParent: Person, otherParent: Person): string {
  const given = GIVEN_NAMES[Math.floor(world.demographicRng.next() * GIVEN_NAMES.length)];
  const surnameSource = world.demographicRng.next() < 0.5 ? gestationalParent : otherParent;
  const surname = surnameSource.name.trim().split(/\s+/).slice(-1)[0] || 'Vale';
  const taken = new Set<string>();
  for (const p of world.persons()) taken.add(p.name);
  let name = `${given} ${surname}`;
  let suffix = 2;
  while (taken.has(name)) name = `${given} ${surname} ${suffix++}`;
  return name;
}

export function giveBirth(world: World, parent: Person): Person | null {
  const pregnancy = parent.physiology.pregnancy;
  if (!parent.alive || !pregnancy || pregnancy.state !== 'gestating' || world.now < pregnancy.dueAt) return null;
  const other = world.person(pregnancy.otherParentId); if (!other) return null;
  const name = generatedName(world, parent, other);
  const gender = world.demographicRng.next() < 0.5 ? 'f' : 'm';
  const child = makePerson(world, { name, gender, age: 0, occupation: 'child', home: parent.homeId, work: null, traits: {
    courage: (parent.traits.courage + other.traits.courage) / 2,
    sociability: (parent.traits.sociability + other.traits.sociability) / 2,
    honesty: (parent.traits.honesty + other.traits.honesty) / 2,
  }, appearance: { height: 0.35, build: 0.6 }, bio: `Born in ${world.nameOf(parent.homeId)} to ${parent.name} and ${other.name}.`, wealth: 0 });
  child.birthTick = world.now; child.createdAt = world.now; child.parentIds = [parent.id, other.id]; child.lifeStage = 'infant'; child.species = parent.species;
  child.factionId = parent.factionId;
  const faction = world.faction(child.factionId); if (faction && !faction.members.includes(child.id)) faction.members.push(child.id);
  const household = world.get<Household>(parent.householdId);
  if (household?.kind === 'household') joinHousehold(world, child, household);
  const home = world.place(child.homeId); if (home && !home.residents.includes(child.id)) home.residents.push(child.id);
  const pos = world.positionOf(parent.id) ?? home?.inside ?? { x: 96, y: 20, z: 96 };
  const body = makeBody(world, child.id, pos, 'humanoid', 35); child.bodies.push(body.id);
  // The everyday places a child's day is built around are resolved from where they actually
  // live (`world/locality.ts`), never from whichever tavern is first in the world's place list.
  child.schedule = dailyScheduleFor(world, child, null);
  setRelTags(parent, child.id, 'child'); setRelTags(other, child.id, 'child');
  getRel(child, parent.id).affection = 0.9; getRel(child, other.id).affection = 0.9;
  getRel(parent, child.id).affection = 0.9; getRel(other, child.id).affection = 0.9;
  pregnancy.state = 'completed'; pregnancy.lastProgressAt = world.now;
  const ev = world.emit('birth', { actor: parent.id, target: child.id, placeId: child.homeId ?? undefined, causes: pregnancy.causeEventId ? [pregnancy.causeEventId] : [], category: 'history', significance: 0.8, visibility: 12, loudness: 4, data: { parentIds: child.parentIds, householdId: child.householdId, species: child.species }, summary: `${child.name} was born to ${parent.name} and ${other.name}` });
  inheritPotential(world, child, parent, other, ev.id);
  witnessParenthood(world, parent, other, child, ev.id);
  return child;
}

/**
 * Everyone alive who descends from this person, in deterministic birth order.
 *
 * The BFS walks the lineage, and it used to re-scan `world.persons()` — the whole append-only
 * bucket, dead identities included — once per node it visited, on every death. Cost was therefore
 * O(cumulative people x descendants) per death and grew with the whole recorded history of the
 * world rather than with the family being settled. One pass now builds the parent -> children
 * index the walk actually needs; the walk itself touches only the lineage. Dead intermediate
 * generations still have to be traversed (a grandchild inherits through a dead parent), which is
 * why the index is built over `persons()` rather than `livingPersons()`.
 */
function livingDescendants(world: World, personId: EntityId): Person[] {
  const childrenOf = new Map<EntityId, Person[]>();
  for (const p of world.persons()) {
    for (const parentId of p.parentIds) {
      const bucket = childrenOf.get(parentId);
      if (bucket) bucket.push(p); else childrenOf.set(parentId, [p]);
    }
  }
  const out: Person[] = []; const queue = [personId]; const seen = new Set(queue);
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const p of childrenOf.get(parentId) ?? []) if (!seen.has(p.id)) {
      seen.add(p.id); queue.push(p.id); if (p.alive) out.push(p);
    }
  }
  return out.sort((a, b) => a.birthTick - b.birthTick || a.id.localeCompare(b.id));
}

function inheritanceRecipients(world: World, deceased: Person): Array<Person | Household> {
  const spouse = Object.entries(deceased.relationships).find(([id, r]) => r.tags.includes('spouse') && world.person(id)?.alive);
  if (spouse) return [world.person(spouse[0])!];
  const descendants = livingDescendants(world, deceased.id); if (descendants.length) return descendants;
  const household = world.get<Household>(deceased.householdId); if (household?.kind === 'household') return [household];
  return [makeHousehold(world, `${deceased.name}'s estate`, deceased.homeId)];
}

export function settleInheritance(world: World, deceased: Person, deathEventId: string): void {
  if (deceased.inheritanceSettled) return;
  deceased.inheritanceSettled = true;
  const recipients = inheritanceRecipients(world, deceased);
  const amount = deceased.wealth;
  deceased.wealth = 0;
  if (amount) {
    const each = amount / recipients.length;
    for (const recipient of recipients) recipient.wealth += each;
  }
  const items = world.items().filter(item => item.ownerId === deceased.id);
  const itemIds = new Set(items.map(item => item.id));
  deceased.inventory = deceased.inventory.filter(id => !itemIds.has(id));
  items.forEach((item, index) => {
    const recipient = recipients[index % recipients.length];
    item.ownerId = recipient.id;
    if (item.holderId === deceased.id) { item.holderId = null; item.pos = world.body(deceased.bodies[0])?.pos ?? null; item.placeId = deceased.homeId; }
  });
  // Connected hardware remains one asset. Title moves through the same estate; construction
  // intent and learned methods do not move with it. No material, condition or energy changes.
  const assets: string[] = [], placeIds: string[] = [];
  let heirIndex = 0;
  // A workplace/house is physical property too. Leaving title on a dead owner strands
  // inherited records, stocks and machinery behind a permanently dead access principal.
  for (const place of world.places().filter(place => place.ownerId === deceased.id)) {
    place.ownerId = recipients[0].id; placeIds.push(place.id);
  }
  for (const a of world.kernel.assemblies.filter(a => a.ownerId === deceased.id)) {
    a.creatorId ??= deceased.id; a.ownerId = recipients[heirIndex++ % recipients.length].id; assets.push(a.id);
    for (const c of world.kernel.components.filter(c => c.assemblyId === a.id)) { c.ownerId = a.ownerId; assets.push(c.id); }
  }
  for (const c of world.kernel.components.filter(c => c.ownerId === deceased.id && !c.assemblyId)) {
    c.ownerId = recipients[heirIndex++ % recipients.length].id; assets.push(c.id);
    if (c.holderId === deceased.id) { c.holderId = null; c.pos = { ...(world.positionOf(deceased.id) ?? c.pos) }; }
  }
  for (const boundary of [...world.kernel.reservoirs, ...world.kernel.energy].filter(b => b.ownerId === deceased.id)) {
    boundary.ownerId = recipients[heirIndex++ % recipients.length].id; assets.push(boundary.id);
  }
  const ev = world.emit('inheritance', { actor: deceased.id, target: recipients[0]?.id, causes: [deathEventId], category: 'history', significance: 0.65, data: { heirs: recipients.map(x => x.id), amount, itemIds: items.map(x => x.id), ...(placeIds.length ? { placeIds } : {}), ...(assets.length ? { kernelAssetIds: assets } : {}) }, summary: `${deceased.name}'s estate passed to ${recipients.map(x => x.name).join(', ')}` });
  for (const item of items) item.provenance.push({ tick: world.now, eventId: ev.id, from: deceased.id, to: item.ownerId, how: 'inheritance' });
}

export function diePerson(world: World, person: Person, causeEventId?: string, reason = 'natural causes'): string | null {
  if (!person.alive) return null;
  const pos = world.positionOf(person.id); const householdId = person.householdId;
  if (!world.markPersonDead(person)) return null;
  const event = world.emit('death', { target: person.id, pos, placeId: person.homeId ?? undefined, causes: causeEventId ? [causeEventId] : [], category: 'history', significance: 1, data: { reason, householdId }, summary: `${person.name} died of ${reason}` });
  if (person.physiology.pregnancy?.state === 'gestating') {
    person.physiology.pregnancy.state = 'lost'; person.physiology.pregnancy.lastProgressAt = world.now;
    world.emit('pregnancy_lost', { actor: person.id, target: person.physiology.pregnancy.otherParentId, causes: [event.id], category: 'history', significance: 0.7, summary: `${person.name}'s pregnancy ended with their death` });
  }
  settleInheritance(world, person, event.id);
  leaveHousehold(world, person);
  return event.id;
}

/** Once-per-calendar-day demographic maintenance. Call once for every crossed day boundary. */
export function stepDemographics(world: World): void {
  const living = [...world.livingPersons()];
  for (const p of living) {
    const oldAge = p.age; const oldStage = p.lifeStage;
    p.age = ageInYears(p.birthTick, world.now); p.lifeStage = lifeStageFor(p.species, p.age);
    // Healthy biological maturation is the explicit age-related exception, not adult idle XP.
    // A daily maintenance sample supports only modest VIT adaptation, capped at ordinary 8.
    // No skipped years are reconstructed as practice or healthy childhood.
    if (p.age < 18 && p.attributes.vitality < 8)
      develop(world, p, { weights: { vitality: 1 }, seconds: 2 * 3600, intensity: 0.5 });
    if (oldStage !== p.lifeStage && p.lifeStage === 'adult') {
      // Coming of age is a real transition, so it has a real consequence: a grown person stops
      // keeping a child's day. `scheduleFor` reads the occupation summary, and 'child' is no
      // longer a true summary of somebody who is eighteen — which is why a person born in a run
      // used to spend their whole adult life playing in the square. What they are called instead
      // is 'villager': a grown person with no trade of their own, which is exactly what they are
      // until their life makes something else of them (`mind/livelihood.ts`). No work is assigned
      // here and none is implied; the schedule below carries a null workplace.
      if (p.occupation === 'child' && !p.workId) { p.occupation = 'villager'; p.schedule = dailyScheduleFor(world, p, null); }
      world.emit('coming_of_age', { actor: p.id, category: 'history', significance: 0.6, data: { age: p.age, occupation: p.occupation }, summary: `${p.name} came of age` });
    }
    if (oldAge !== p.age) {
      // Re-derived from immutable base appearance/current age; never compounds prior attributes.
      const agePenalty = p.age < 18 ? 0.75 + p.age / 72 : p.age > 55 ? Math.max(0.6, 1 - (p.age - 55) * 0.01) : 1;
      p.physiologyTraits.conditioning = Math.max(0.65, Math.min(1.25, (0.85 + physicalAttribute(p.attributes.endurance) * 0.3) * agePenalty));
    }
    const pregnancy = p.physiology.pregnancy;
    if (pregnancy?.state === 'gestating') {
      pregnancy.lastProgressAt = world.now;
      const fitness = physiologicalFitness(world, p);
      const lossChance = fitness < 0.22 ? (0.0035 * (1 - fitness)) : 0.00008;
      if (world.demographicRng.next() < lossChance) {
        pregnancy.state = 'lost';
        world.emit('pregnancy_lost', { actor: p.id, target: pregnancy.otherParentId, causes: pregnancy.causeEventId ? [pregnancy.causeEventId] : [], category: 'history', significance: 0.6, summary: `${p.name}'s pregnancy ended before birth` });
      } else giveBirth(world, p);
    } else tryConception(world, p);
    if (!p.alive) continue;
    const body = world.primaryBody(p.id); const health = body ? body.health / body.maxHealth : 0.5;
    const annual = annualMortalityHazard(p.species, p.age) * (1 + Math.max(0, 0.45 - health) * 2 + Math.max(0, 0.2 - p.physiology.energy) * 1.5 + Math.max(0, 0.2 - p.physiology.hydration) * 2);
    const daily = 1 - Math.exp(-annual / 365);
    if (world.demographicRng.next() < daily) diePerson(world, p, undefined, p.age < 50 && physiologicalFitness(world, p) < 0.3 ? 'physical decline' : 'natural causes');
  }
  // Coming of age has a consumer: the same daily pass asks whether anybody's life has added up to
  // a trade yet (`mind/livelihood.ts`). Nothing here assigns anybody anything — the reading either
  // recognises a pattern the world already contains, or, far more often, does not.
  stepLivelihoods(world);
}
