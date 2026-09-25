import type { Body, Creature, Person, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { hurtVolumes, strikePoint, sweepSphereContact } from '../physical/combatGeometry';
import { applyInjury, injuryFromImpact } from '../physical/injury';
import { stopCombatAction } from '../physical/combatAction';
import { guardContact } from '../physical/guard';
import { isExternallyControlled } from '../runtime/controllers';
import { distance, visible } from './sensing';
import { ageDays, bodyScale } from './animals';
import type { AnimalEmbodiment, SpeciesSpec } from './types';

/**
 * Defensive wildlife behaviour: a species with a `defense` profile does not only flee. A threat
 * that comes close (or that has struck it) gets a readable warning display; pressing on — or
 * having attacked it — earns a charge and a strike. The strike is a swept volume tested against
 * the target's actual hurt volumes at each physical step, the same geometry human strikes use, so
 * sidestepping or backstepping out of its path genuinely avoids it and nothing is decided by dice.
 *
 * The strike's intent is to drive off, never to kill: a person brought to zero health is downed
 * (the ordinary non-lethal outcome), and the animal disengages from a downed target. Canonical
 * consequences (health, localized injury, knockback, an observable `attack` event with the
 * creature as actor) are the same kinds of state a human blow produces, so witnesses, victims,
 * concerns and conversation handle them through their ordinary paths.
 */
export type DefenseMode = 'warn' | 'charge' | 'strike' | 'recover' | 'retreat';
export interface DefenseState {
  mode: DefenseMode; targetBodyId: string; since: number;
  strikeAt?: number; yaw?: number; struck?: boolean;
}

const WARN_EVENT_GAP_S = 20;
/** Below this fraction of adult size an animal flees rather than defends. */
const JUVENILE_DEFENSE_SCALE = 0.6;

export function defenseProfile(spec: SpeciesSpec) { return spec.defense; }

/** Record that `attacker` struck this animal body; provocation drives charging regardless of distance. */
export function provokeAnimal(world: World, animal: Creature, body: Body, attackerBodyId: string): void {
  const state = animal.wildlife?.embodiments[body.id];
  const spec = world.ecology?.species[animal.species];
  if (!state || !spec?.defense || body.dead) return;
  state.provokedBy = { bodyId: attackerBodyId, until: world.physicalTime + spec.defense.provokedSeconds };
}

/** A mother with her own unweaned young close by stands her ground at a wider radius. */
function guardingYoung(world: World, animal: Creature, body: Body, spec: SpeciesSpec): boolean {
  if (animal.wildlife?.sex !== 'female') return false;
  const weanedAt = spec.reproduction.weaningDays * 86400;
  return world.nearbyPhysicalBodies(body.pos, 12).some(b => {
    const young = b.id !== body.id && !b.dead ? world.get<Creature>(b.ownerId) : undefined;
    return !!young?.wildlife && young.species === animal.species && young.wildlife.parentIds.includes(animal.id)
      && world.now - young.wildlife.bornAt < weanedAt;
  });
}

function faceYaw(from: Vec3, to: Vec3): number { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); }

/**
 * Called at the wildlife sense cadence with the nearest visible threat body (or null).
 * Returns true when defence owns the animal's behaviour this tick (so flight is not planned).
 */
export function senseDefense(world: World, animal: Creature, body: Body, state: AnimalEmbodiment, spec: SpeciesSpec, threat: Body | null, at: number): boolean {
  const d = spec.defense; if (!d) return false;
  // Young animals run to their mother; standing and charging is a grown animal's answer.
  if (bodyScale(spec, ageDays(animal, world.now)) < JUVENILE_DEFENSE_SCALE) { if (state.defense) state.defense = undefined; return false; }
  if (state.provokedBy && state.provokedBy.until <= at) state.provokedBy = undefined;
  const provoker = state.provokedBy ? world.body(state.provokedBy.bodyId) : undefined;
  const provokerVisible = !!provoker && provoker.present && !provoker.dead && provoker.pose !== 'downed'
    && visible(world, body.pos, provoker.pos, spec.senses.localRadiusM);
  const target = provokerVisible ? provoker! : threat;
  const cur = state.defense;
  // Badly hurt: give up the fight and run.
  if (body.health < body.maxHealth * d.retreatBelowHealth) { if (cur) state.defense = undefined; return false; }
  if (cur && (cur.mode === 'strike' || cur.mode === 'recover')) return true; // committed; the physical step finishes it
  if (cur?.mode === 'retreat') { if (at - cur.since < d.retreatSeconds) return false; state.defense = undefined; }
  if (!target) { if (cur) state.defense = undefined; return false; }
  const tb = target, dist = distance(body.pos, tb.pos);
  if (tb.pose === 'downed' || tb.dead) { state.defense = { mode: 'retreat', targetBodyId: tb.id, since: at }; return false; }
  const provoked = provokerVisible && tb === provoker;
  const warnRadius = d.warnRadiusM * (guardingYoung(world, animal, body, spec) ? d.protectiveRadiusFactor : 1);
  if (!provoked && dist > warnRadius) { if (cur) state.defense = undefined; return false; }
  if (!cur || cur.targetBodyId !== tb.id) {
    state.defense = { mode: provoked ? 'charge' : 'warn', targetBodyId: tb.id, since: at };
    if (!provoked && (state.lastWarnAt ?? -Infinity) < at - WARN_EVENT_GAP_S) {
      state.lastWarnAt = at;
      world.emit('animal_threat_display', { actor: animal.id, target: tb.ownerId, pos: { ...body.pos }, category: 'world', significance: 0.08,
        visibility: 20, loudness: 10, data: { species: animal.species, bodyId: body.id, targetBodyId: tb.id, distance: dist },
        summary: `A ${animal.name} bristled and snorted at ${world.nameOf(tb.ownerId)}` });
    }
  } else if (cur.mode === 'warn' && (provoked || dist <= d.chargeRadiusM || (at - cur.since > d.warnSeconds && dist <= warnRadius * 0.7))) {
    cur.mode = 'charge'; cur.since = at;
  }
  const s = state.defense!;
  body.vel = { x: 0, y: 0, z: 0 };
  if (s.mode === 'warn') { body.path = null; body.pathGoal = null; state.target = null; body.yaw = faceYaw(body.pos, tb.pos); body.pose = 'stand'; state.activity = 'idle'; }
  if (s.mode === 'charge') {
    state.activity = 'flee'; // presentation: moving at speed; the target, not a flight goal, drives it
    state.target = { pos: { ...tb.pos } };
    body.path = world.nav.findPath(body.pos, tb.pos, 64); body.pathIndex = 0; body.pathGoal = body.path ? { ...tb.pos } : null;
  }
  return true;
}

/** Physical sub-step: charge speed, strike timing and swept contact. `dt` is physical seconds. */
export function stepDefense(world: World, animal: Creature, body: Body, state: AnimalEmbodiment, spec: SpeciesSpec, now: number, dt: number): { owned: boolean; speed: number } {
  const d = spec.defense, s = state.defense; if (!d || !s) return { owned: false, speed: 0 };
  const tb = world.body(s.targetBodyId);
  if (!tb || tb.dead || !tb.present) { state.defense = undefined; return { owned: false, speed: 0 }; }
  if (s.mode === 'charge') {
    if (distance(body.pos, tb.pos) <= d.reachM + 0.55) { s.mode = 'strike'; s.strikeAt = now; s.yaw = faceYaw(body.pos, tb.pos); s.struck = false; body.path = null; body.pathGoal = null; state.target = null; }
    else return { owned: true, speed: d.chargeSpeedMps };
  }
  if (s.mode === 'strike') {
    body.vel = { x: 0, y: 0, z: 0 }; body.yaw = s.yaw!; body.pose = 'attack';
    const t0 = now - dt - s.strikeAt!, t1 = now - s.strikeAt!;
    const from = Math.max(t0, d.windupSeconds), to = Math.min(t1, d.windupSeconds + d.activeSeconds);
    if (!s.struck && to > from) {
      const steps = Math.max(1, Math.ceil((to - from) * 120));
      for (let i = 0; i < steps && !s.struck; i++) {
        const p0 = (from + (to - from) * i / steps - d.windupSeconds) / d.activeSeconds, p1 = (from + (to - from) * (i + 1) / steps - d.windupSeconds) / d.activeSeconds;
        const v0 = strikePoint(body.pos, s.yaw!, d.reachM, p0, 'low'), v1 = strikePoint(body.pos, s.yaw!, d.reachM, p1, 'low');
        for (const candidate of world.nearbyPhysicalBodies(body.pos, d.reachM + 2)) {
          if (candidate.id === body.id || candidate.dead || !candidate.present || candidate.shape !== 'humanoid') continue;
          const hv = hurtVolumes(candidate, candidate.crouch ?? 0);
          const hit = hv.find(h => sweepSphereContact(v0, v1, 0.22, h.center, h.center, h.radius) !== null);
          if (hit && world.grid.lineOfPassage({ ...body.pos, y: body.pos.y + 0.5 }, { ...candidate.pos, y: candidate.pos.y + 0.5 }, d.reachM + 1.5)) {
            // A strike's force follows the animal's actual size (a half-grown boar hits half as hard).
            s.struck = true; creatureBlow(world, animal, body, candidate, d.impact * bodyScale(spec, ageDays(animal, world.now)), hit.region); break;
          }
        }
      }
    }
    if (t1 >= d.windupSeconds + d.activeSeconds) {
      if (!s.struck) world.emit('attack_missed', { actor: animal.id, pos: { ...body.pos }, visibility: 20, loudness: 8, category: 'world', significance: 0.05,
        data: { species: animal.species, bodyId: body.id, targetBodyId: tb.id }, summary: `A ${animal.name}'s charge missed ${world.nameOf(tb.ownerId)}` });
      s.mode = 'recover'; s.since = now;
    }
    return { owned: true, speed: 0 };
  }
  if (s.mode === 'recover') {
    body.vel = { x: 0, y: 0, z: 0 }; body.pose = 'stand';
    if (now - s.since >= d.recoverySeconds) {
      // A downed or departed target ends it; otherwise the display resumes and may charge again.
      if (tb.pose === 'downed') { state.defense = { mode: 'retreat', targetBodyId: tb.id, since: now }; state.provokedBy = undefined; }
      else { s.mode = 'warn'; s.since = now; }
    }
    return { owned: true, speed: 0 };
  }
  return { owned: s.mode === 'warn', speed: 0 };
}

/** Consequences of an animal's strike on a person's body. Non-lethal by intent (drive off). */
export function creatureBlow(world: World, animal: Creature, ab: Body, tb: Body, impact: number, region: string): void {
  const victim = world.person(tb.ownerId);
  if (!victim?.alive || tb.dead) return;
  const defense = guardContact(world, ab, tb, impact); impact = defense.impact;
  const injury = injuryFromImpact(tb, impact, world.rng.next());
  if (injury) applyInjury(tb, injury);
  tb.health -= impact; tb.lastHitAt = world.physicalTime; tb.hitSeq++;
  const dx = tb.pos.x - ab.pos.x, dz = tb.pos.z - ab.pos.z, len = Math.hypot(dx, dz) || 1;
  tb.vel.x += dx / len * 5; tb.vel.z += dz / len * 5;
  if (tb.combatAction) stopCombatAction(world, tb, 'contact');
  const place = world.placeAt(tb.pos);
  const ev = world.emit('attack', { causes: defense.event ? [defense.event.id] : [], actor: animal.id, target: victim.id, pos: { ...tb.pos }, placeId: place?.id, category: 'world', significance: 0.6, visibility: 26, loudness: 14,
    data: { creature: true, species: animal.species, attackerBodyId: ab.id, targetBodyId: tb.id, region, injury: injury ?? null, intent: 'drive_off', impact },
    summary: `A ${animal.name} gored ${victim.name}${place ? ' at ' + place.name : ''}` });
  // The victim always knows what hit them.
  if (!ev.perceivedBy.some(x => x.who === victim.id)) ev.perceivedBy.push({ who: victim.id, how: 'saw', tick: world.now });
  if (tb.health <= 0) {
    tb.pose = 'downed'; tb.poseUntil = world.physicalTime + 45; tb.health = 1;
    victim.mind.plan = []; victim.mind.goal = null;
    world.emit('downed', { actor: victim.id, target: animal.id, pos: { ...tb.pos }, causes: [ev.id], category: 'world', significance: 0.5, visibility: 20, loudness: 6,
      data: { by: animal.id, species: animal.species }, summary: `${victim.name} was knocked down by a ${animal.name}` });
  } else {
    tb.pose = 'hit'; tb.poseUntil = world.physicalTime + 0.5;
    if (!isExternallyControlled(victim)) { victim.mind.alarm = 1; victim.mind.attention = animal.id; const cur = victim.mind.plan.find(a => a.status === 'active'); if (cur && cur.type !== 'attack') cur.status = 'failed'; }
  }
}

/** Nearby defending animals that are displaying at, charging or striking `p` — what a person can
 * actually see happening (used by minds to choose flight and by the client as a readable cue). */
export function menacingAnimals(world: World, p: Person, radius = 14): { animal: Creature; body: Body; mode: DefenseMode; distance: number }[] {
  const own = world.primaryBody(p.id); if (!own) return [];
  const out: { animal: Creature; body: Body; mode: DefenseMode; distance: number }[] = [];
  for (const b of world.nearbyPhysicalBodies(own.pos, radius)) {
    const animal = world.get<Creature>(b.ownerId);
    const st = animal?.kind === 'creature' ? animal.wildlife?.embodiments[b.id] : undefined;
    const mode = st?.defense?.mode;
    if (!st || b.dead || !mode || mode === 'retreat' || !p.bodies.includes(st.defense!.targetBodyId)) continue;
    if (!world.grid.lineOfSight({ ...own.pos, y: own.pos.y + 1.6 }, { ...b.pos, y: b.pos.y + 0.8 }, radius + 1)) continue;
    out.push({ animal: animal!, body: b, mode, distance: distance(own.pos, b.pos) });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
