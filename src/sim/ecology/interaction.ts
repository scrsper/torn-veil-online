import type { Body, Creature } from '../core/types';
import type { World } from '../core/world';
import { ageDays, bodyScale } from './animals';
import { distance, visible } from './sensing';
import { senseDefense, stepDefense } from './defense';
import { travelPath } from '../physical/travel';
import { ECOLOGY_QUANTUM_SECONDS, stepWildlife } from './simulation';
import type { AnimalEmbodiment, EcologyState, SpeciesSpec } from './types';

export const WILDLIFE_SENSE_SECONDS = 0.2;
/** Physical encounter relevance, at least as broad as ordinary human close observation.
 * It selects compute only; species sensing still determines what the animal can know. */
const ENCOUNTER_PROXIMITY_M = 32;
const RELEASE_MARGIN_M = 4;
const THREAT_MEMORY_SECONDS = 2;
type Active = { animal: Creature; body: Body; state: AnimalEmbodiment; spec: SpeciesSpec };
const caches = new WeakMap<World, { ecology: EcologyState; active: Map<string, Active> }>();

/** Derived scheduler worklist. Identity, motion, sensed threat and elapsed time live on the
 * canonical creature/body, never on this cache or a presentation residency list. */
function activeBodies(world: World): Map<string, Active> {
  let cache = caches.get(world);
  if (!cache || cache.ecology !== world.ecology) {
    cache = { ecology: world.ecology!, active: new Map() };
    caches.set(world, cache);
    for (const animal of world.creatures()) for (const bodyId of animal.bodies) {
      const entry = supportedBody(world, bodyId);
      if (entry?.state.encounter?.active) cache.active.set(bodyId, entry);
    }
  }
  return cache.active;
}

function supportedBody(world: World, id: string): Active | null {
  const body = world.body(id), animal = body && world.get<Creature>(body.ownerId);
  const spec = animal && world.ecology?.species[animal.species];
  const state = body && animal?.wildlife?.embodiments[body.id];
  return body?.present && !body.dead && animal?.kind === 'creature' && animal.bodies.includes(id)
    && state && spec?.cognition.controller === 'reactive_wildlife' && spec.locomotion.walk
    ? { animal, body, state, spec } : null;
}

function stop(body: Body, state: AnimalEmbodiment): void {
  body.path = null; body.pathGoal = null; body.vel = { x: 0, y: 0, z: 0 };
  state.target = null;
  if (!body.dead) { body.pose = 'stand'; state.activity = 'idle'; }
}

function senseEncounters(world: World, active: Map<string, Active>, physicalAt: number): void {
  const ecology = world.ecology!;
  const radius = Math.max(0, ...Object.values(ecology.species).filter(s => s.cognition.controller === 'reactive_wildlife')
    .map(s => Math.max(ENCOUNTER_PROXIMITY_M, s.senses.localRadiusM) + RELEASE_MARGIN_M));
  const nearby = new Map<string, Active>();
  const observers = new Map<string, Body[]>();
  // Person presence is a possible disturbance whether player- or NPC-controlled. Scheduling
  // proximity grants no knowledge: the animal's own local sight test below is still required.
  for (const person of world.livingPersons()) for (const bodyId of person.bodies) {
    const personBody = world.body(bodyId);
    if (!person.alive || !personBody?.present || personBody.dead || personBody.ownerId !== person.id) continue;
    for (const body of world.nearbyPhysicalBodies(personBody.pos, radius)) {
      const entry = supportedBody(world, body.id);
      if (entry && distance(body.pos, personBody.pos) <= Math.max(ENCOUNTER_PROXIMITY_M, entry.spec.senses.localRadiusM) + RELEASE_MARGIN_M) {
        nearby.set(body.id, entry);
        let people = observers.get(body.id); if (!people) observers.set(body.id, people = []);
        people.push(personBody);
      }
    }
  }
  for (const [id, entry] of active) if (!nearby.has(id)) {
    if (entry.state.encounter) { entry.state.encounter.active = false; entry.state.encounter.threat = null; }
    entry.state.defense = undefined;
    if (entry.state.activity === 'flee') stop(entry.body, entry.state);
    else entry.body.vel = { x: 0, y: 0, z: 0 };
    active.delete(id);
  }
  for (const [id, entry] of nearby) {
    const { body, state, spec } = entry;
    if (!state.encounter?.active) {
      const walkingWorldSeconds = state.encounter?.walkingWorldSeconds ?? 0;
      state.encounter = { active: true, threat: null, nextRouteAt: physicalAt,
        // Pre-activation time has passed without executed motion. Charge it as idle;
        // it cannot be cashed out later as a coarse jump or a meal/recovery bonus.
        accountedWorldSeconds: ecology.pendingWorldSeconds, accountedPhysicalSeconds: ecology.pendingPhysicalSeconds, walkingWorldSeconds,
        sleepingWorldSeconds: state.encounter?.sleepingWorldSeconds ?? 0, intake: state.encounter?.intake ?? null };
      body.vel = { x: 0, y: 0, z: 0 };
    }
    active.set(id, entry);
    // Reuse the broad-phase pairs above: a dense animal group does not re-query every
    // other animal merely to find the few nearby Person manifestations.
    const threat = observers.get(id)!
      .filter(b => visible(world, body.pos, b.pos, spec.senses.localRadiusM))
      .sort((a, b) => distance(body.pos, a.pos) - distance(body.pos, b.pos) || a.id.localeCompare(b.id))[0];
    const encounter = state.encounter!;
    if (threat) {
      if (!encounter.threat) encounter.nextRouteAt = physicalAt;
      encounter.threat = { bodyId: threat.id, pos: { ...threat.pos }, seenAt: physicalAt };
    }
    else if (encounter.threat && physicalAt - encounter.threat.seenAt >= THREAT_MEMORY_SECONDS) encounter.threat = null;
    // A defending species may stand, display or charge instead of fleeing (ecology/defense.ts).
    if (senseDefense(world, entry.animal, body, state, spec, threat ?? null, physicalAt)) continue;
    // A calmed animal keeps away from where it was calmed rather than circling back.
    if (!encounter.threat && state.avoid && state.avoid.until > physicalAt && distance(body.pos, state.avoid.pos) < state.avoid.radiusM) {
      encounter.threat = { bodyId: '', pos: { ...state.avoid.pos }, seenAt: physicalAt };
    }
    if (!encounter.threat) { if (state.activity === 'flee') stop(body, state); continue; }
    state.activity = 'flee';
    if (physicalAt + 1e-9 >= encounter.nextRouteAt) {
      encounter.nextRouteAt = physicalAt + 0.6;
      fleeRoute(world, entry);
    }
  }
}

function fleeRoute(world: World, { body, state, spec }: Active): void {
  const from = state.encounter!.threat!.pos;
  const away = Math.atan2(body.pos.z - from.z, body.pos.x - from.x);
  stop(body, state); state.activity = 'flee';
  for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
    const reach = Math.min(6, spec.senses.localRadiusM);
    const x = Math.floor(body.pos.x + Math.cos(away + turn) * reach), z = Math.floor(body.pos.z + Math.sin(away + turn) * reach);
    const goal = { x: x + 0.5, y: world.nav.floorY(x, z), z: z + 0.5 };
    if (goal.y < 0 || world.nav.walkCost(x, z) >= 3 || !visible(world, body.pos, goal, spec.senses.localRadiusM)) continue;
    const path = world.nav.findPath(body.pos, goal, 128);
    if (!path?.length) continue;
    body.path = path; body.pathIndex = 0; body.pathGoal = goal; state.target = { pos: { ...goal } }; return;
  }
}

/** The realtime scheduler owns this entry point, once per interaction interval. Coarse
 * headless callers retain stepWildlife. Only active bodies move here; biological work still
 * runs once per 900 world seconds. A large explicit interval is split at sense/quantum
 * boundaries so it cannot execute one unbounded active endpoint jump. */
export function stepWildlifeInteraction(world: World, physicalSeconds: number, worldSeconds: number): void {
  const ecology = world.ecology; if (!ecology) return;
  if (![physicalSeconds, worldSeconds].every(Number.isFinite) || physicalSeconds < 0 || worldSeconds < 0) throw new Error('Invalid ecology time');
  const clock = ecology.interaction ??= { senseRemainingSeconds: 0 };
  const active = activeBodies(world);
  let physicalLeft = physicalSeconds, worldLeft = worldSeconds;
  if (physicalSeconds === 0) { stepWildlife(world, 0, worldSeconds); return; }
  while (physicalLeft > 1e-10) {
    const physicalAt = world.physicalTime - physicalLeft;
    if (clock.senseRemainingSeconds <= 1e-9) {
      senseEncounters(world, active, physicalAt); clock.senseRemainingSeconds = WILDLIFE_SENSE_SECONDS;
    }
    const toQuantum = worldLeft > 0 ? (ECOLOGY_QUANTUM_SECONDS - ecology.pendingWorldSeconds) * physicalLeft / worldLeft : Infinity;
    const dt = Math.min(physicalLeft, clock.senseRemainingSeconds, Math.max(1e-10, toQuantum));
    const wd = worldLeft * dt / physicalLeft;
    for (const [id, entry] of active) {
      if (!supportedBody(world, id)) {
        if (entry.state.encounter) entry.state.encounter.active = false;
        stop(entry.body, entry.state); active.delete(id); continue;
      }
      const { animal, body, state, spec } = entry, encounter = state.encounter!;
      const scale = bodyScale(spec, ageDays(animal, ecology.processedAt + ecology.pendingWorldSeconds));
      const defended = stepDefense(world, animal, body, state, spec, physicalAt + dt, dt);
      if (defended.owned) {
        let walked = 0;
        if (defended.speed > 0 && body.path) walked = travelPath(world, body, dt, defended.speed * Math.max(0.3, 1 - state.physiology.fatigue * 0.5), spec.bodyPlan.radiusM * Math.cbrt(scale), spec.bodyPlan.heightM * Math.cbrt(scale));
        state.distanceM += walked;
        encounter.accountedPhysicalSeconds += dt; encounter.accountedWorldSeconds += wd;
        if (walked > 0) { encounter.walkingWorldSeconds += wd; body.pose = 'run'; }
        continue;
      }
      const speed = spec.locomotion.walk.speedMps * Math.max(0.2, Math.cbrt(scale)) * Math.max(0.2, 1 - state.physiology.fatigue * 0.65);
      const target = state.target;
      let walked = 0;
      if (target && (encounter.threat || distance(body.pos, target.pos) > 1.3)) {
        if (!encounter.threat && physicalAt + 1e-9 >= encounter.nextRouteAt && (!body.path || !body.pathGoal || distance(body.pathGoal, target.pos) > 0.5)) {
          encounter.nextRouteAt = physicalAt + 0.6;
          body.path = world.nav.findPath(body.pos, target.pos, 128); body.pathIndex = 0; body.pathGoal = body.path ? { ...target.pos } : null;
        }
        walked = travelPath(world, body, dt, speed, spec.bodyPlan.radiusM * Math.cbrt(scale), spec.bodyPlan.heightM * Math.cbrt(scale));
      } else {
        body.path = null; body.pathGoal = null; body.vel = { x: 0, y: 0, z: 0 };
        if (!encounter.threat && target?.resourceId) {
          const previousActivity = state.activity;
          if (state.activity === 'seek_food') state.activity = 'eat';
          if (state.activity === 'seek_water') state.activity = 'drink';
          if (state.activity === 'eat' || state.activity === 'drink') {
            encounter.intake ??= { nodeId: target.resourceId, activity: state.activity, worldSeconds: 0, previousActivity };
            if (encounter.intake.nodeId === target.resourceId && encounter.intake.activity === state.activity) encounter.intake.worldSeconds += wd;
          }
        }
      }
      state.distanceM += walked;
      encounter.accountedPhysicalSeconds += dt; encounter.accountedWorldSeconds += wd;
      encounter.walkingWorldSeconds += wd * Math.min(1, walked / Math.max(1e-9, dt * speed));
      if (!encounter.threat && state.activity === 'sleep') encounter.sleepingWorldSeconds += wd;
      body.pose = walked > 0 ? 'walk' : state.activity === 'sleep' ? 'sleep' : state.activity === 'eat' || state.activity === 'drink' ? state.activity : 'stand';
    }
    stepWildlife(world, dt, wd);
    physicalLeft = Math.max(0, physicalLeft - dt); worldLeft = Math.max(0, worldLeft - wd);
    clock.senseRemainingSeconds = Math.max(0, clock.senseRemainingSeconds - dt);
  }
}
