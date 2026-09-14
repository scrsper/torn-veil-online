import type { Body, Creature, Vec3 } from '../sim/core/types';
import type { World } from '../sim/core/world';
import { ageDays, bodyScale } from '../sim/ecology/animals';

export interface WildlifeBodyProjection {
  bodyId: string; creatureId: string; speciesId: string; regionId: string | null;
  bodyPlan: { id: string; shape: Body['shape']; heightM: number; radiusM: number };
  pos: Vec3; yaw: number; vel: Vec3;
  scale: number; ageClass: 'juvenile' | 'adult';
  /** Coarse visible physical condition, normalized from the canonical body health. */
  condition: number;
  alive: boolean; dead: boolean; present: boolean;
  activity: 'idle' | 'walk' | 'forage' | 'eat' | 'drink' | 'rest' | 'sleep' | 'flee' | 'dead';
}

/** Complete current observation, not a lifecycle roster. Absence means leave presentation
 * residency; ONLY an observed dead:true means death. Returning to sight yields the same IDs.
 * No allocations here enter World and no species is initialized by projection. */
export function wildlifeProjection(world: World, viewer: Body | undefined, regions?: ReadonlySet<string>) {
  const bodies: WildlifeBodyProjection[] = [];
  const frame = { version: 1 as const, scope: 'observed' as const, complete: true as const, bodies };
  if (!viewer?.present || viewer.dead || viewer.pose === 'sleep' || !world.ecology) return frame;
  const range = world.weather.kind === 'fog' ? 14 : 28;
  const eye = { ...viewer.pos, y: viewer.pos.y + 1.5 };
  for (const body of world.nearbyPhysicalBodies(viewer.pos, range, true)) {
    const creature = world.get<Creature>(body.ownerId);
    if (creature?.kind !== 'creature' || !creature.wildlife) continue;
    const spec = world.ecology.species[creature.species], state = creature.wildlife.embodiments[body.id];
    if (!spec || !state || spec.cognition.controller !== 'reactive_wildlife') continue;
    const regionId = world.geography?.regionId(body.pos.x, body.pos.z) ?? null;
    if (regions && (!regionId || !regions.has(regionId))) continue;
    const dx = body.pos.x - viewer.pos.x, dz = body.pos.z - viewer.pos.z, d = Math.hypot(dx, dz);
    if (d > 2.5 && (-Math.sin(viewer.yaw) * dx - Math.cos(viewer.yaw) * dz) / d <= -0.1) continue;
    const size = Math.cbrt(bodyScale(spec, ageDays(creature, world.now)));
    if (!world.grid.lineOfSight(eye, { ...body.pos, y: body.pos.y + spec.bodyPlan.heightM * size * 0.6 }, range + 2)) continue;
    const moving = Math.hypot(body.vel.x, body.vel.z) > 0.01;
    const activity: WildlifeBodyProjection['activity'] = body.dead ? 'dead' : moving ? state.activity === 'flee' ? 'flee' : 'walk'
      : body.pose === 'eat' ? 'eat' : body.pose === 'drink' ? 'drink' : body.pose === 'sleep' ? 'sleep'
      : state.activity === 'rest' ? 'rest' : state.activity === 'seek_food' ? 'forage' : 'idle';
    bodies.push({ bodyId: body.id, creatureId: creature.id, speciesId: creature.species, regionId,
      bodyPlan: { id: spec.bodyPlan.id, shape: body.shape, heightM: spec.bodyPlan.heightM, radiusM: spec.bodyPlan.radiusM },
      pos: { ...body.pos }, yaw: body.yaw, vel: { ...body.vel }, scale: Math.round(size * 20) / 20,
      ageClass: size < 1 ? 'juvenile' : 'adult', condition: body.dead ? 0 : Math.max(0, Math.min(1, body.health / Math.max(1e-9, body.maxHealth))),
      alive: !body.dead, dead: body.dead, present: body.present, activity });
  }
  return frame;
}
