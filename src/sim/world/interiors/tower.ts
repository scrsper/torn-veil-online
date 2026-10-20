import { equipTrialKit, trialKit, WARDEN_TRAITS } from './trialKit';
import { ONTOLOGICAL_STAGES } from '../../core/stages';
import type { Body, Item, Person, Vec3 } from '../../core/types';
import type { World } from '../../core/world';
import { makeContainer } from '../../core/container';
import { combatBusy } from '../../physical/combatAction';
import { movementState } from '../../physical/interactionMovement';
import { agreeCombatTrial, endCombatTrial, retireCombatTrialParticipant } from '../../social/combatTrial';
import { resolveConflict } from '../../social/conflict';
import { towerEncounter } from '../../progression/towerEncounters';
import { makeBody, makeItem, makePerson, makePlace } from '../factory';
import { realmAt, realmSeed } from '../realms/layout';
import { RealmGrid } from '../realms/grid';
import { attachInteriorGrid, FoldedRealmGrid } from './grid';
import type { CanonicalTowerFloor, CanonicalTowerRun } from './towerTypes';
import {focusedGuardianStations} from '../assets/focusedRuntime';
import { recordTowerExperience } from '../../progression/experience';

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function currentTowerFloor(w: World): CanonicalTowerFloor | undefined { return w.canonicalTower?.floors.find(f => f.floor === w.canonicalTower!.floor); }
function able(w: World, p: Person, b: Body) {
  return movementState(w, p, b).eligible && !combatBusy(b, w.physicalTime) && !b.recoil
    && !(b.arcana?.cast && !b.arcana.cast.cancelled && b.arcana.cast.completeAt > w.physicalTime);
}
function placeBody(w: World, b: Body, to: Vec3) {
  const landing = [[0,0],[.9,0],[-.9,0],[0,.9],[0,-.9],[.9,.9],[-.9,.9],[.9,-.9],[-.9,-.9]]
    .map(([x,z]) => ({ x: to.x + x, y: to.y, z: to.z + z })).find(pos =>
      (w.grid.movementGeometryAt(pos.x,pos.z)?.fits(pos.x,pos.y,pos.z,.3,1.75)??w.nav.isWalkable(Math.floor(pos.x), Math.floor(pos.z))) && [-.3,.3].every(dx => [-.3,.3].every(dz =>
        !w.grid.isSolidAt(pos.x + dx, pos.y + .2, pos.z + dz) && !w.grid.isSolidAt(pos.x + dx, pos.y + 1.6, pos.z + dz)))
      && !w.nearbyPhysicalBodies(pos, .7, true).some(other => other.id !== b.id && other.present && distance(other.pos, pos) < .7));
  if (!landing) throw Error('Tower landing is obstructed');
  b.pos = landing; b.vel = { x: 0, y: 0, z: 0 }; b.path = null; b.pathGoal = null; b.yaw = 0;
  w.nav.rebuildAll();
}
function provenance(w: World, item: Item, eventId: string, from: string | null, to: string | null, how: string) {
  item.provenance.push({ tick: w.now, eventId, from, to, how });
}
function createFloor(w: World, run: CanonicalTowerRun, floor: number): CanonicalTowerFloor {
  const existing = run.floors.find(f => f.floor === floor); if (existing) return existing;
  const grid = attachInteriorGrid(w), used = new Set(grid.interiors.descriptors.map(d => d.slot));
  let slot = 0; while (used.has(slot)) slot++;
  const id = `${run.id}:floor:${floor}`;
  grid.register({ version: 1, id, buildingId: run.towerId, seed: run.seed, floor, slot,...(w.realmSpec?.focusedKit?{assetKit:1 as const}:{}) }); w.nav.rebuildAll();
  const plan = grid.interior(id), place = makePlace(w, 'chapel', `Chrysanthus trial ${floor}`,
    { x0: plan.origin.x - plan.half, x1: plan.origin.x + plan.half, z0: plan.origin.z - plan.half, z1: plan.origin.z + plan.half, y0: 1, y1: 8 }, { inside: plan.exit, indoor: true });
  const opened = w.emit('tower_floor_opened', { actor: run.personId, placeId: place.id, pos: plan.start, causes: [run.openedEventId],
    data: { runId: run.id, floor, interiorId: id }, significance: .4, summary: `The physical trial on floor ${floor} opened` });
  // An actual finite water reserve uses the common water interaction, not a free
  // player hydration reset. Its shallow intake occupies the entrance floor surface.
  const waterPos = { ...plan.start, z: plan.start.z + 2 };
  const cistern = makePlace(w, 'well', `Floor ${floor} water intake`,
    { x0: waterPos.x - .5, x1: waterPos.x + .5, z0: waterPos.z - .5, z1: waterPos.z + .5, y0: 1, y1: 1.1 }, { inside: waterPos, indoor: true });
  w.resourceNodes.push({ id: `${id}:cistern`, kind: 'surface_water', yield: 'water', pos: waterPos, blocks: [],
    remaining: 8, capacity: 8, renewable: false, regrowHours: 0, state: 'available', placeId: cistern.id });
  const f: CanonicalTowerFloor = { floor, interiorId: id, placeId: place.id, openedEventId: opened.id,
    trialId: `${id}:trial`, agreementEventId: '', enemyBodyIds: [], sourceItemIds: [], enteredAt: w.physicalTime,
    rewardContainerId: '', rewardItemIds: [], defeats: [] };
  // Finite authored stores are instantiated with the floor. Clearing changes their
  // ownership; it never creates a second copy of a book or imports prototype loot.
  const rewardPos = [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4], [0, 0]].map(([dx, dz]) =>
    ({ x: plan.exit.x + dx, y: plan.exit.y, z: plan.exit.z + dz })).find(pos =>
      (w.grid.movementGeometryAt(pos.x,pos.z)?.fits(pos.x,pos.y,pos.z,.3,1.75)??w.nav.isWalkable(Math.floor(pos.x), Math.floor(pos.z))) && w.grid.lineOfSight({ ...plan.exit, y: 2.5 }, { ...pos, y: 1.7 }, 3));
  if (!rewardPos) throw Error('No accessible trial award position');
  const reward = makeContainer(w, { name: `Floor ${floor} sealed award`, capacity: 200, ownerId: place.id,
    pos: rewardPos, placeId: place.id, tags: ['tower-award'] });
  f.rewardContainerId = reward.id;
  const rewards = ['book-ward', 'book-mend', 'book-sigil', 'ess-swift', 'ess-bone', 'ess-iron', 'ess-life', 'ess-fire', 'ess-storm', 'ess-water', 'ess-gravity', 'ess-time', 'ess-ice', 'ess-blood', 'ess-shadow'];
  const abilityId = rewards[(floor - 1) % rewards.length];
  const book = makeItem(w, 'book', `${abilityId.startsWith('ess-') ? 'Essence' : 'Tome'} from trial ${floor}`, { owner: place.id, container: reward.id });
  book.arcaneSource = { version: 1, abilityId, kind: abilityId.startsWith('ess-') ? 'essence' : 'book' };
  // One learning dose and one integration dose, both finite stock present before the trial.
  if (book.arcaneSource.kind === 'essence') book.quantity = 2;
  const coin = makeItem(w, 'bread', 'Trial provisions', { owner: place.id, container: reward.id, quantity: 2 });
  for (const item of [book, coin]) { provenance(w, item, opened.id, null, place.id, 'finite authored Tower reserve'); f.rewardItemIds.push(item.id); }
  if (floor === 1) {
    const sources = [makeItem(w, 'book', 'Ember field manual', { pos: { ...plan.start, x: plan.start.x + 1 }, placeId: place.id }),
      makeItem(w, 'dagger', 'Trial steel dagger', { pos: { ...plan.start, x: plan.start.x - 1 }, placeId: place.id, condition: 1,...(plan.assetScene?{catalogId:'TV-011'}:{}) })];
    sources[0].arcaneSource = { version: 1, abilityId: 'book-ember', kind: 'book' };
    for (const item of sources) { provenance(w, item, opened.id, null, null, 'finite authored Tower stores'); f.sourceItemIds.push(item.id); }
  }
  const cells = (plan.assetScene?focusedGuardianStations(plan,grid.movementGeometryAt(plan.start.x,plan.start.z)!):plan.rooms.filter(r => r.role !== 'start').flatMap(r => {
    const out: Vec3[] = [];
    const spacing=plan.assetScene?2.5:6;
    for (let x = r.x + 3.5; x < r.x + r.w; x += spacing) for (let z = r.z + 3.5; z < r.z + r.d; z += spacing) {
      const g=w.grid.movementGeometryAt(x,z),y=g?.supportAt(x,z,plan.start.y)??1,p = { x, y, z }; if (distance(p, plan.start) > 20 && distance(p, plan.exit) > 2 && (g?g.fits(x,y,z,.3,1.75):w.nav.isWalkable(Math.floor(x), Math.floor(z)))) out.push(p);
    }
    return out;
  })).sort((a, b) => distance(b, plan.start) - distance(a, plan.start) || a.x - b.x || a.z - b.z);
  const count = Math.min(towerEncounter(floor).enemies, cells.length), rivals: Person[] = [];
  if(plan.assetScene&&count!==towerEncounter(floor).enemies)throw Error('Focused floor cannot support its canonical encounter budget');
  if (!count) throw Error('Trial has no physical guardian stations');
  for (let n = 0; n < count; n++) {
    const archetype = trialKit(floor, n).archetype;
    const p = makePerson(w, { name: `Trial ${floor} warden ${n + 1}`, slug: `${id}:warden:${n}`, gender: n % 2 ? 'f' : 'm', age: 28 + n,
      occupation: 'traveler', traits: { ...WARDEN_TRAITS[archetype] }, appearance: {}, home: place.id,
      bio: 'A resident warden who agreed to the Tower trial. Ordinary perception, needs and combat apply.', tags: ['tower-warden', `warden:${archetype}`] });
    const b = makeBody(w, p.id, cells[Math.floor(n * cells.length / count)]);
    p.bodies.push(b.id); p.towerUpkeepAt = w.now; equipTrialKit(w, p, b, floor, n, opened.id); f.enemyBodyIds.push(b.id); rivals.push(p);
  }
  f.agreementEventId = agreeCombatTrial(w, f.trialId, [[w.person(run.personId)!], rivals], 'injure', opened.id);
  run.floors.push(f); return f;
}
export function enterCanonicalTower(w: World, personId: string): CanonicalTowerRun {
  const p = w.person(personId), b = p && w.primaryBody(p.id), realm = b && realmAt(b.pos.x, b.pos.z);
  if (!p || !b || !realm || !able(w, p, b) || w.realmExpedition?.active || w.canonicalTower?.active || !(w.grid instanceof RealmGrid)) throw Error('This body cannot enter the canonical Tower');
  const tower = realm==='brass'&&w.grid.focusedTown?w.grid.focusedTown.tower:w.grid.chunk(realm, 32, 32).buildings[0];
  if (!(b.pos.x > tower.x && b.pos.x < tower.x + tower.w - 1 && b.pos.z > tower.z && b.pos.z < tower.z + tower.d - 1)) throw Error('Enter through the real Tower atrium');
  let run = w.canonicalTower;
  if (run && (run.personId !== p.id || run.bodyId !== b.id || run.status !== 'open')) throw Error('This Tower run cannot be resumed');
  const e = w.emit('tower_entered', { actor: p.id, pos: b.pos, causes: run ? [run.openedEventId] : [], significance: .5,
    data: { bodyId: b.id, towerId: tower.id, realm, resumed: !!run }, summary: `${p.name} entered the canonical Tower` });
  if (!run) run = { version: 1, authority: 'canonical', id: w.nextId('canonical-tower'), seed: realmSeed(w.seed, 'canonical-tower'), personId: p.id, bodyId: b.id,
    towerId: 'veil:tower:chrysanthus', realm, returnPos: { ...b.pos }, floor: 1, active: true, status: 'open', revision: 0, openedEventId: e.id, floors: [], commands: [] };
  else { run.realm = realm; run.returnPos = { ...b.pos }; run.active = true; }
  w.canonicalTower = run;
  const f = createFloor(w, run, run.floor), plan = (w.grid as FoldedRealmGrid).interior(f.interiorId);
  placeBody(w, b, plan.start); return run;
}
/** Derive completion from real conflict/death/surrender evidence, once. The renderer
 * cannot submit defeated rosters, damage totals, rewards or advancement labels. */
export function observeCanonicalTower(w: World): void {
  const run = w.canonicalTower, f = currentTowerFloor(w); if (!run?.active || !f || run.status !== 'open') return;
  const player = w.person(run.personId)!, body = w.body(run.bodyId)!;
  if (!player.alive || body.dead) {
    run.status = 'fallen';
    const death = [...w.events].reverse().find(e => (e.type === 'kill' && e.target === player.id) || (e.type === 'death' && e.actor === player.id));
    w.emit('tower_fallen', { actor: player.id, causes: [f.openedEventId, ...(death ? [death.id] : [])], data: { runId: run.id, floor: run.floor }, significance: 1, summary: `${player.name}'s Tower climb ended in death` });
    return;
  }
  if (f.clearEventId) { if (f.floor === 100 && ONTOLOGICAL_STAGES.indexOf(player.ontology.stage) >= ONTOLOGICAL_STAGES.indexOf('Silver')) run.status = 'completed'; return; }
  const causes: string[] = [];
  const participants = new Set([run.personId, ...f.enemyBodyIds.map(id => w.body(id)!.ownerId)]);
  for (const id of f.enemyBodyIds) {
    const enemy = w.body(id)!, person = w.person(enemy.ownerId)!;
    const conflict = [...w.conflicts].reverse().find(c => c.participants.includes(person.id) && c.participants.some(id => id !== person.id && participants.has(id))
      && c.startedAt >= w.event(f.openedEventId)!.tick && (enemy.dead || !person.alive
        || c.downed?.who === person.id && participants.has(c.downed.by)
        || person.surrender && participants.has(person.surrender.toId) && c.participants.includes(person.surrender.toId)));
    const beaten = enemy.dead || !person.alive || conflict?.downed?.who === person.id && participants.has(conflict.downed.by)
      || person.surrender && participants.has(person.surrender.toId);
    if (f.defeats.some(d => d.bodyId === id)) continue;
    if (!beaten || !conflict) continue;
    const evidence = [...w.events].reverse().find(e => ['attack', 'kill', 'entity_surrendered'].includes(e.type) && e.tick >= w.event(f.openedEventId)!.tick
      && (participants.has(e.actor!) && e.target === person.id && (e.type === 'kill' || e.type === 'attack' && e.data.targetBodyId === id && e.data.health <= 0)
        || e.type === 'entity_surrendered' && e.actor === person.id && participants.has(e.target!)));
    if (!evidence) continue;
    const endedEventId = retireCombatTrialParticipant(w, person, [evidence.id]);
    f.defeats.push({ bodyId: id, evidenceEventId: evidence.id, endedEventId });
    if (conflict.status !== 'resolved') resolveConflict(w, conflict, 'objective_completed', endedEventId);
  }
  if (f.defeats.length !== f.enemyBodyIds.length) return;
  causes.push(...f.defeats.flatMap(d => [d.evidenceEventId, d.endedEventId]));
  const trialEnded = endCombatTrial(w, f.trialId, causes);
  const event = w.emit('tower_floor_cleared', { actor: run.personId, placeId: f.placeId, pos: body.pos, causes: [f.openedEventId, trialEnded, ...causes],
    data: { runId: run.id, floor: f.floor, seconds: w.physicalTime - f.enteredAt, rewardContainerId: f.rewardContainerId }, significance: .65,
    summary: `${player.name} completed floor ${f.floor} through canonical combat` });
  f.clearEventId = event.id;
  recordTowerExperience(w, player, event, f.enemyBodyIds);
  const reserve = w.container(f.rewardContainerId)!; reserve.ownerId = run.personId;
  for (const id of f.rewardItemIds) { const item = w.item(id)!; provenance(w, item, event.id, item.ownerId, run.personId, 'earned Tower trial award'); item.ownerId = run.personId; }
  // The accepted trial has a real terminal outcome. This does not globally alter the
  // ordinary conflict lifecycle or suppress defense against future unconsented attacks.
  for (const c of w.conflicts) if (c.status !== 'resolved' && c.participants.includes(run.personId)
    && f.enemyBodyIds.some(id => c.participants.includes(w.body(id)!.ownerId))) resolveConflict(w, c, 'objective_completed', event.id);
  if (f.floor === 100 && ONTOLOGICAL_STAGES.indexOf(player.ontology.stage) >= ONTOLOGICAL_STAGES.indexOf('Silver')) run.status = 'completed';
}
export function ascendCanonicalTower(w: World): CanonicalTowerRun {
  const run = w.canonicalTower, f = currentTowerFloor(w);
  if (!run?.active || run.status !== 'open' || !f?.clearEventId || !(w.grid instanceof FoldedRealmGrid)) throw Error('The current physical trial is not complete');
  const p = w.person(run.personId)!, b = w.body(run.bodyId)!;
  if (!able(w, p, b) || distance(b.pos, w.grid.interior(f.interiorId).exit) > 2.4) throw Error('Reach the cleared floor stair');
  if (run.floor === 100) throw Error('The summit requires earned Silver capacity; integrate learned essence sources after recovering.');
  const next = createFloor(w, run, run.floor + 1); run.floor++;
  placeBody(w, b, w.grid.interior(next.interiorId).start); return run;
}
export function returnCanonicalTower(w: World): CanonicalTowerRun {
  const run = w.canonicalTower, f = currentTowerFloor(w);
  if (!run?.active || !f || !(w.grid instanceof FoldedRealmGrid)) throw Error('No active canonical Tower run');
  const p = w.person(run.personId)!, b = w.body(run.bodyId)!, plan = w.grid.interior(f.interiorId);
  if (!able(w, p, b) || distance(b.pos, plan.start) > 2.4) throw Error('Return through the floor entrance when able');
  const threat = w.nearbyPhysicalBodies(b.pos, 10).some(other => other.id !== b.id && !other.dead && other.pose !== 'downed'
    && f.enemyBodyIds.includes(other.id) && !f.clearEventId && w.grid.lineOfSight({ ...b.pos, y: b.pos.y + 1.5 }, { ...other.pos, y: other.pos.y + 1.1 }, 10));
  if (threat) throw Error('Break contact before returning');
  placeBody(w, b, run.returnPos); run.active = false;
  w.emit('tower_returned', { actor: p.id, pos: b.pos, causes: [f.clearEventId ?? f.openedEventId], significance: .4,
    data: { runId: run.id, floor: f.floor, bodyId: b.id }, summary: `${p.name} returned from the canonical Tower with the same body and belongings` });
  return run;
}
