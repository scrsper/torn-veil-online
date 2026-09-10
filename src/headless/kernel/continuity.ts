import type { Person, Place } from '../../sim/core/types';
import type { World } from '../../sim/core/world';
import { Simulation } from '../../sim/mind/agent';
import { methodsHeld, practicalNeed } from '../../sim/mind/invention';
import { defaultPhysiology, syncNeeds } from '../../sim/core/physiology';
import { teachNotation } from '../../sim/mind/records';
import { dailyScheduleFor } from '../../sim/mind/livelihood';
import { createLivingPressure, advanceLiving } from './living';

export function advanceUntil(world: World, sim: Simulation, condition: () => boolean, limit: number): boolean {
  for (let t = 0; t < limit && !condition(); t++) advanceLiving(world, sim, 1);
  return condition();
}

/** A disclosed favorable wind interval and sawn-stock education, using the earlier settlement
 * pressure scenario. Discovery, procurement, manufacture and record-making are autonomous. */
export function discoverAndRecord(seed = 17) {
  const lab = createLivingPressure(seed, undefined, { sawnOnly: true, steadyWind: 0.3 });
  if (!advanceUntil(lab.world, lab.sim, () => lab.world.items().some(i => i.record), 1800)) throw new Error('No autonomous record in the favorable interval');
  const record = lab.world.items().find(i => i.record)!;
  return { ...lab, record, inventor: lab.world.person(record.record!.authorId)! };
}

/** Acceptance initial conditions only: a voluntary assignment and healthy start of shift.
 * No selected goal, plan, method, proficiency, finished component or machine is installed. */
export function placeWorker(world: World, p: Person, place: Place): void {
  const old = world.place(p.workId); if (old) old.workers = old.workers.filter(id => id !== p.id);
  p.workId = place.id; if (!place.workers.includes(p.id)) place.workers.push(p.id);
  p.schedule = dailyScheduleFor(world, p, place.id);
  p.physiology = defaultPhysiology(world.now); p.physiology.energy = 0.95; p.physiology.hydration = 0.95; p.physiology.fatigue = 0;
  syncNeeds(p);
  p.mind.goal = null; p.mind.plan = [];
  const body = world.primaryBody(p.id)!; body.pos = { ...place.inside }; body.path = null; body.pose = 'stand';
}

export function observeNeed(world: World, p: Person, place: Place, quantity: number): void {
  const method = methodsHeld(p)[0]?.claim.method;
  if (!method) throw new Error('A learner must actually acquire instructions first');
  const energy = world.kernel.energy.find(e => e.pos.x === place.inside.x && e.pos.z === place.inside.z);
  if (!energy) throw new Error('No local collection boundary');
  practicalNeed(world, p, `continuity-need:${place.id}`, { effect: method.effect, targetQuantity: quantity,
    pos: place.inside, bindings: { placeId: place.id, energyId: energy.id } });
}

export function arrangeReader(world: World, author: Person, place: Place): Person {
  const reader = world.livingPersons().find(p => p.id !== author.id && p.age >= 18 && p.homeId !== author.homeId && p.occupation === 'farmer' && !methodsHeld(p).length && !(p.skills.crafting ?? 0))!;
  if (!reader) throw new Error('No adult household reader in this scenario');
  placeWorker(world, reader, place);
  teachNotation(world, reader); // Independent prior literacy, not method knowledge or craft skill.
  reader.traits.curiosity = 0.95;
  return reader;
}
