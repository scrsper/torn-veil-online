import type { EntityId, Household, Person } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_DAY } from '../core/time';
import { annualMortalityHazard, ageInYears, lifeStageFor, physiologyProfileFor } from '../core/species';
import { makeBody, makePerson } from './factory';
import { joinHousehold, leaveHousehold, makeHousehold } from './household';
import { getRel, setRelTags } from '../mind/relationships';
import { scheduleFor } from '../mind/schedule';

const GIVEN_NAMES = [
  'Aster', 'Briar', 'Cora', 'Dain', 'Elowen', 'Flint', 'Galen', 'Hester', 'Iris', 'Jonas',
  'Kael', 'Lark', 'Maren', 'Nico', 'Orla', 'Perrin', 'Quill', 'Rhea', 'Silas', 'Thora',
  'Una', 'Vale', 'Wren', 'Yara', 'Zev',
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
  const partner = partneredWith(world, p); if (!partner) return;
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

function generatedName(world: World, gestationalParent: Person, otherParent: Person): string {
  const given = GIVEN_NAMES[Math.floor(world.demographicRng.next() * GIVEN_NAMES.length)];
  const surnameSource = world.demographicRng.next() < 0.5 ? gestationalParent : otherParent;
  const surname = surnameSource.name.trim().split(/\s+/).slice(-1)[0] || 'Vale';
  let name = `${given} ${surname}`;
  let suffix = 2;
  while (world.persons().some(p => p.name === name)) name = `${given} ${surname} ${suffix++}`;
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
  const tavern = world.places().find(x => x.type === 'tavern') ?? home;
  const square = world.places().find(x => x.type === 'square') ?? home;
  const chapel = world.places().find(x => x.type === 'chapel') ?? home;
  if (home && tavern && square && chapel) child.schedule = scheduleFor(child, { work: null, home: home.id, tavern: tavern.id, square: square.id, chapel: chapel.id });
  setRelTags(child, parent.id, 'parent'); setRelTags(child, other.id, 'parent');
  setRelTags(parent, child.id, 'child'); setRelTags(other, child.id, 'child');
  getRel(child, parent.id).affection = 0.9; getRel(child, other.id).affection = 0.9;
  getRel(parent, child.id).affection = 0.9; getRel(other, child.id).affection = 0.9;
  pregnancy.state = 'completed'; pregnancy.lastProgressAt = world.now;
  const ev = world.emit('birth', { actor: parent.id, target: child.id, placeId: child.homeId ?? undefined, causes: pregnancy.causeEventId ? [pregnancy.causeEventId] : [], category: 'history', significance: 0.8, visibility: 12, loudness: 4, data: { parentIds: child.parentIds, householdId: child.householdId, species: child.species }, summary: `${child.name} was born to ${parent.name} and ${other.name}` });
  void ev;
  return child;
}

function livingDescendants(world: World, personId: EntityId): Person[] {
  const out: Person[] = []; const queue = [personId]; const seen = new Set(queue);
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const p of world.persons()) if (!seen.has(p.id) && p.parentIds.includes(parentId)) {
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
  const ev = world.emit('inheritance', { actor: deceased.id, target: recipients[0]?.id, causes: [deathEventId], category: 'history', significance: 0.65, data: { heirs: recipients.map(x => x.id), amount, itemIds: items.map(x => x.id) }, summary: `${deceased.name}'s estate passed to ${recipients.map(x => x.name).join(', ')}` });
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
    if (oldStage !== p.lifeStage && p.lifeStage === 'adult') world.emit('coming_of_age', { actor: p.id, category: 'history', significance: 0.6, data: { age: p.age }, summary: `${p.name} came of age` });
    if (oldAge !== p.age) {
      // Re-derived from immutable base appearance/current age; never compounds prior attributes.
      const agePenalty = p.age < 18 ? 0.75 + p.age / 72 : p.age > 55 ? Math.max(0.6, 1 - (p.age - 55) * 0.01) : 1;
      p.physiologyTraits.conditioning = Math.max(0.65, Math.min(1.25, (0.85 + p.attributes.strength * 0.3) * agePenalty));
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
}
